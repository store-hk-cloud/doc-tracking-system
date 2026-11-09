// ไคลเอนต์ Google REST แบบบาง ๆ ที่ใช้ fetch ล้วน แทน SDK เต็มของ Google
// เหตุผล: SDK นั้นรวมเป็นชั้น 11 MB ที่โหลดทุก API route หลัก การประเมินโมดูลนั้นใน isolate
// ใหม่กินเวลา CPU หลายร้อย ms จนเกินเพดาน 10 ms ของ Cloudflare Workers แผน free (exceededResources)
// รูปแบบเมธอดและผลลัพธ์ `{ data }` คงเดิมตาม SDK เดิม เพื่อให้ google-sheets.ts / google-drive.ts ไม่ต้องแก้มาก

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];
// ต่ออายุก่อนหมดอายุจริง เผื่อ clock เพี้ยนและคำขอที่กำลังบิน
const TOKEN_REFRESH_MARGIN_MS = 60_000;

type GoogleCall = (params?: any) => Promise<{ data: any }>;

type AuthConfig =
  | { mode: 'oauth'; clientId: string; clientSecret: string; refreshToken: string }
  | { mode: 'service-account'; clientEmail: string; privateKey: string };

let cachedAuth: AuthConfig | null = null;
let cachedSheets: any = null;
let cachedDrive: any = null;
let cachedToken: { value: string; expiresAt: number } | null = null;
let pendingToken: Promise<string> | null = null;
let cachedSigningKey: Promise<CryptoKey> | null = null;

/**
 * OAuth2 refresh token (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN) มาก่อน
 * ถ้าไม่ครบจึง fallback เป็น Service Account (GOOGLE_SHEETS_CLIENT_EMAIL + GOOGLE_SHEETS_PRIVATE_KEY)
 */
function getAuth(): AuthConfig | null {
  if (cachedAuth) return cachedAuth;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;

  if (clientId && clientSecret && refreshToken) {
    cachedAuth = { mode: 'oauth', clientId, clientSecret, refreshToken };
  } else if (clientEmail && privateKey) {
    // secret ที่เก็บในโฮสต์เป็นบรรทัดเดียว \n เป็นตัวอักษรสองตัว ต้องแปลงกลับเป็นขึ้นบรรทัดใหม่
    cachedAuth = { mode: 'service-account', clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') };
  }
  return cachedAuth;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeJsonPart(value: object): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function importSigningKey(pem: string): Promise<CryptoKey> {
  if (!cachedSigningKey) {
    const base64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
    const der = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    cachedSigningKey = crypto.subtle
      .importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
      .catch((error) => {
        // key พังต้องไม่ถูกจำไว้ ไม่งั้นทุกคำขอถัดไปจะล้มด้วย promise เดิม
        cachedSigningKey = null;
        throw error;
      });
  }
  return cachedSigningKey;
}

async function signServiceAccountJwt(auth: Extract<AuthConfig, { mode: 'service-account' }>): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${encodeJsonPart({ alg: 'RS256', typ: 'JWT' })}.${encodeJsonPart({
    iss: auth.clientEmail,
    scope: SCOPES.join(' '),
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  })}`;
  const key = await importSigningKey(auth.privateKey);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${toBase64Url(new Uint8Array(signature))}`;
}

function formBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

/** แปลงผลตอบกลับของ Google ที่ไม่ใช่ 2xx เป็น Error ที่มี .code/.status ให้ callWithRetry อ่านได้ */
function googleError(status: number, text: string): Error {
  let message = text;
  try {
    const parsed = JSON.parse(text);
    message = parsed?.error?.message || parsed?.error_description || (typeof parsed?.error === 'string' ? parsed.error : text);
  } catch {
    // เนื้อหาไม่ใช่ JSON ใช้ข้อความดิบ
  }
  const error: any = new Error(message || `Google API request failed with ${status}`);
  error.code = status;
  error.status = status;
  return error;
}

async function requestAccessToken(auth: AuthConfig): Promise<{ value: string; expiresAt: number }> {
  const body = auth.mode === 'oauth'
    ? formBody({
        grant_type: 'refresh_token',
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
        refresh_token: auth.refreshToken,
      })
    : formBody({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: await signServiceAccountJwt(auth),
      });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw googleError(res.status, text);
  const parsed = JSON.parse(text);
  return { value: parsed.access_token, expiresAt: Date.now() + Number(parsed.expires_in ?? 3600) * 1000 };
}

function getAccessToken(auth: AuthConfig): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return Promise.resolve(cachedToken.value);
  }
  // คำขอที่มาพร้อมกันใช้การต่ออายุครั้งเดียวร่วมกัน
  if (!pendingToken) {
    pendingToken = requestAccessToken(auth)
      .then((token) => {
        cachedToken = token;
        return token.value;
      })
      .finally(() => {
        pendingToken = null;
      });
  }
  return pendingToken;
}

function buildQuery(params: Record<string, any>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

async function googleFetch(
  auth: AuthConfig,
  method: string,
  url: string,
  options: { headers?: Record<string, string>; body?: string | Uint8Array<ArrayBuffer> } = {},
): Promise<{ data: any }> {
  const token = await getAccessToken(auth);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
    body: options.body,
  });
  const text = await res.text();
  if (!res.ok) throw googleError(res.status, text);
  // files.delete ตอบ 204 ไม่มีเนื้อหา
  return { data: text ? JSON.parse(text) : '' };
}

function jsonRequest(auth: AuthConfig, method: string, url: string, requestBody?: unknown) {
  return googleFetch(auth, method, url, requestBody === undefined
    ? {}
    : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
}

function createSheetsClient(auth: AuthConfig) {
  const base = (spreadsheetId: string) => `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}`;
  // ค่า query ที่เหลือจาก path param ส่งต่อให้ Google ตรง ๆ (valueInputOption, fields, ...)
  const rest = (params: any) => {
    const query = { ...params };
    delete query.spreadsheetId;
    delete query.range;
    delete query.requestBody;
    return buildQuery(query);
  };
  const valuesPath = (p: any) => `${base(p.spreadsheetId)}/values/${encodeURIComponent(p.range)}`;

  const get: GoogleCall = (p) => jsonRequest(auth, 'GET', `${base(p.spreadsheetId)}${rest(p)}`);
  const batchUpdate: GoogleCall = (p) => jsonRequest(auth, 'POST', `${base(p.spreadsheetId)}:batchUpdate${rest(p)}`, p.requestBody);
  const valuesGet: GoogleCall = (p) => jsonRequest(auth, 'GET', `${valuesPath(p)}${rest(p)}`);
  const valuesBatchGet: GoogleCall = (p) => jsonRequest(auth, 'GET', `${base(p.spreadsheetId)}/values:batchGet${rest(p)}`);
  const valuesUpdate: GoogleCall = (p) => jsonRequest(auth, 'PUT', `${valuesPath(p)}${rest(p)}`, p.requestBody);
  const valuesBatchUpdate: GoogleCall = (p) => jsonRequest(auth, 'POST', `${base(p.spreadsheetId)}/values:batchUpdate${rest(p)}`, p.requestBody);
  const valuesAppend: GoogleCall = (p) => jsonRequest(auth, 'POST', `${valuesPath(p)}:append${rest(p)}`, p.requestBody);

  return {
    spreadsheets: {
      get,
      batchUpdate,
      values: { get: valuesGet, batchGet: valuesBatchGet, update: valuesUpdate, batchUpdate: valuesBatchUpdate, append: valuesAppend },
    },
  };
}

function createDriveClient(auth: AuthConfig) {
  const list: GoogleCall = (p) => jsonRequest(auth, 'GET', `${DRIVE_BASE}/files${buildQuery(p ?? {})}`);

  const create: GoogleCall = ({ requestBody, media }) => {
    if (!media) return jsonRequest(auth, 'POST', `${DRIVE_BASE}/files`, requestBody);

    const encoder = new TextEncoder();
    const boundary = `doc-tracking-${crypto.randomUUID()}`;
    const head = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(requestBody ?? {})}\r\n`
      + `--${boundary}\r\nContent-Type: ${media.mimeType || 'application/octet-stream'}\r\n\r\n`,
    );
    const tail = encoder.encode(`\r\n--${boundary}--`);
    const content: Uint8Array = media.body;
    const body = new Uint8Array(head.length + content.length + tail.length);
    body.set(head, 0);
    body.set(content, head.length);
    body.set(tail, head.length + content.length);
    return googleFetch(auth, 'POST', DRIVE_UPLOAD_URL, {
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  };

  const createPermission: GoogleCall = ({ fileId, requestBody }) =>
    jsonRequest(auth, 'POST', `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/permissions`, requestBody);

  const remove: GoogleCall = ({ fileId }) =>
    jsonRequest(auth, 'DELETE', `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}`);

  return { files: { list, create, delete: remove }, permissions: { create: createPermission } };
}

export function getSheetsClient(): any {
  const auth = getAuth();
  if (!auth) throw new Error('Google Sheets not configured. Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN in the hosting environment');
  if (cachedSheets) return cachedSheets;
  cachedSheets = createSheetsClient(auth);
  return cachedSheets;
}

export function getDriveClient(): any {
  const auth = getAuth();
  if (!auth) throw new Error('Google Drive not configured. Set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN in the hosting environment');
  if (cachedDrive) return cachedDrive;
  cachedDrive = createDriveClient(auth);
  return cachedDrive;
}

/** Returns true if Google credentials are configured */
export function hasGoogleCredentials(): boolean {
  return !!(
    (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) ||
    (process.env.GOOGLE_SHEETS_CLIENT_EMAIL && process.env.GOOGLE_SHEETS_PRIVATE_KEY)
  );
}

export function resetClients() {
  cachedAuth = null;
  cachedSheets = null;
  cachedDrive = null;
  cachedToken = null;
  pendingToken = null;
  cachedSigningKey = null;
}
