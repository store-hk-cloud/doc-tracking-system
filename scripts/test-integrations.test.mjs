import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

test('image uploads use the public Supabase Storage bucket', async () => {
  let sent;
  const storage = {
    from(bucket) {
      return {
        async upload(...args) { sent = { bucket, args }; return { error: null }; },
        getPublicUrl(path) { return { data: { publicUrl: `https://storage.example.invalid/${path}` } }; },
      };
    },
  };
  const blob = loadModule('src/lib/supabase-storage.ts', {
    '@/lib/supabase/admin': { getServiceSupabase: () => ({ storage }) },
  }, { process: { env: { SUPABASE_STORAGE_BUCKET: 'doc-attachments' } } });
  const buffer = Buffer.from('test image');
  const url = await blob.uploadImage('damage/image.jpg', buffer, 'image/png');
  assert.equal(url, `https://storage.example.invalid/${sent.args[0]}`);
  assert.equal(sent.bucket, 'doc-attachments');
  assert.match(sent.args[0], /^damage\/[^/]+image\.jpg$/);
  assert.equal(sent.args[1], buffer);
  assert.equal(sent.args[2].contentType, 'image/png');
  assert.equal(sent.args[2].upsert, false);
});

test('two image uploads with the same original path never collide or overwrite evidence', async () => {
  const paths = new Set();
  const storage = { from: () => ({
    async upload(path) {
      if (paths.has(path)) return { error: { message: 'duplicate object' } };
      paths.add(path);
      return { error: null };
    },
    getPublicUrl: (path) => ({ data: { publicUrl: `https://storage.example.invalid/${path}` } }),
  }) };
  const images = loadModule('src/lib/supabase-storage.ts', {
    '@/lib/supabase/admin': { getServiceSupabase: () => ({ storage }) },
  });
  const urls = await Promise.all([
    images.uploadImage('damage/same-image.jpg', Buffer.from('image')),
    images.uploadImage('damage/same-image.jpg', Buffer.from('image')),
  ]);
  assert.equal(paths.size, 2);
  assert.notEqual(urls[0], urls[1]);
});

// โมดูลถูกรันใน vm context ใหม่ จึงต้องส่ง global ของ Web API เข้าไปเอง (fetch ถูก stub ต่อเทสต์)
const googleGlobals = { crypto: globalThis.crypto, TextEncoder, atob, btoa };
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OAUTH_ENV = { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_REFRESH_TOKEN: 'test-refresh' };
const RSA_ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

/** fetch ปลอมที่บันทึกคำขอทุกครั้ง; คำขอไป token endpoint ได้ access token เสมอ */
function stubFetch(apiResponse) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), ...init });
    return String(url) === TOKEN_URL
      ? jsonResponse({ access_token: 'test-access-token', expires_in: 3600 })
      : apiResponse(String(url));
  };
  return { fetch, calls };
}

function loadGoogleAuth(fetch, env) {
  return loadModule('src/lib/google-auth.ts', {}, { ...googleGlobals, fetch, process: { env } });
}

const decodePart = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

test('Google OAuth refresh-token client caches clients and shares one access token across Sheets/Drive calls', async () => {
  const { fetch, calls } = stubFetch(() => jsonResponse({ id: 'test-file' }));
  const auth = loadGoogleAuth(fetch, OAUTH_ENV);
  assert.equal(auth.hasGoogleCredentials(), true);
  const sheets = auth.getSheetsClient();
  const drive = auth.getDriveClient();
  assert.equal(sheets, auth.getSheetsClient());
  assert.equal(drive, auth.getDriveClient());

  await Promise.all([
    sheets.spreadsheets.values.update({ spreadsheetId: 'test-sheet', range: '2026-11-06!A1:U1', valueInputOption: 'USER_ENTERED', requestBody: { values: [['ทดสอบ']] } }),
    drive.files.create({ requestBody: { name: 'test.jpg', parents: ['test-folder'] } }),
  ]);
  await sheets.spreadsheets.get({ spreadsheetId: 'test-sheet' });

  const tokenCalls = calls.filter((call) => call.url === TOKEN_URL);
  assert.equal(tokenCalls.length, 1, 'concurrent and later calls must share a single token request');
  assert.equal(tokenCalls[0].method, 'POST');
  const form = new URLSearchParams(tokenCalls[0].body);
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('client_id'), 'test-client');
  assert.equal(form.get('client_secret'), 'test-secret');
  assert.equal(form.get('refresh_token'), 'test-refresh');

  const apiCalls = calls.filter((call) => call.url !== TOKEN_URL);
  assert.equal(apiCalls.length, 3);
  for (const call of apiCalls) assert.equal(call.headers.Authorization, 'Bearer test-access-token');

  const update = apiCalls.find((call) => call.method === 'PUT');
  assert.equal(
    update.url,
    `https://sheets.googleapis.com/v4/spreadsheets/test-sheet/values/${encodeURIComponent('2026-11-06!A1:U1')}?valueInputOption=USER_ENTERED`,
  );
  assert.deepEqual(JSON.parse(update.body), { values: [['ทดสอบ']] });

  const folder = apiCalls.find((call) => call.url === 'https://www.googleapis.com/drive/v3/files');
  assert.equal(folder.method, 'POST');
  assert.deepEqual(JSON.parse(folder.body), { name: 'test.jpg', parents: ['test-folder'] });
});

test('Google service-account client signs a verifiable RS256 JWT, exchanges it once and maps Sheets URLs', async () => {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { ...RSA_ALGORITHM, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify'],
  );
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  const { fetch, calls } = stubFetch(() => jsonResponse({ values: [] }));
  // secret ในโฮสต์เก็บ \n เป็นตัวอักษรสองตัว
  const auth = loadGoogleAuth(fetch, {
    GOOGLE_SHEETS_CLIENT_EMAIL: 'test@example.invalid',
    GOOGLE_SHEETS_PRIVATE_KEY: pem.replace(/\n/g, '\\n'),
  });
  const sheets = auth.getSheetsClient();
  await sheets.spreadsheets.values.get({ spreadsheetId: 'sheet-1', range: 'สรุป!A:U' });
  await sheets.spreadsheets.values.batchGet({ spreadsheetId: 'sheet-1', ranges: ['2026-11-05!A:U', '2026-11-06!A:U'] });
  await sheets.spreadsheets.values.append({ spreadsheetId: 'sheet-1', range: '2026-11-06!A:U', valueInputOption: 'RAW', requestBody: { values: [['x']] } });

  const tokenCalls = calls.filter((call) => call.url === TOKEN_URL);
  assert.equal(tokenCalls.length, 1);
  const form = new URLSearchParams(tokenCalls[0].body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const jwt = form.get('assertion');
  const parts = jwt.split('.');
  assert.equal(parts.length, 3);
  for (const part of parts) assert.match(part, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodePart(parts[0]), { alg: 'RS256', typ: 'JWT' });
  const claims = decodePart(parts[1]);
  assert.equal(claims.iss, 'test@example.invalid');
  assert.equal(claims.aud, TOKEN_URL);
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive');
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(
    await crypto.subtle.verify(RSA_ALGORITHM.name, publicKey, Buffer.from(parts[2], 'base64url'), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)),
    true,
  );

  const base = 'https://sheets.googleapis.com/v4/spreadsheets/sheet-1';
  const [get, batchGet, append] = calls.filter((call) => call.url !== TOKEN_URL);
  assert.equal(get.method, 'GET');
  assert.equal(get.url, `${base}/values/${encodeURIComponent('สรุป!A:U')}`);
  assert.equal(batchGet.url, `${base}/values:batchGet?ranges=${encodeURIComponent('2026-11-05!A:U')}&ranges=${encodeURIComponent('2026-11-06!A:U')}`);
  assert.equal(append.method, 'POST');
  assert.equal(append.url, `${base}/values/${encodeURIComponent('2026-11-06!A:U')}:append?valueInputOption=RAW`);
  assert.deepEqual(JSON.parse(append.body), { values: [['x']] });
});

test('Google Drive upload sends one multipart request carrying the Buffer bytes', async () => {
  const { fetch, calls } = stubFetch(() => jsonResponse({ id: 'file-1' }));
  const drive = loadGoogleAuth(fetch, OAUTH_ENV).getDriveClient();
  const bytes = Buffer.from([0xff, 0xd8, 0x00, 0x0d, 0x0a, 0xff]);
  const { data } = await drive.files.create({
    requestBody: { name: 'รูป.jpg', parents: ['folder-1'] },
    media: { mimeType: 'image/jpeg', body: bytes },
  });
  assert.equal(data.id, 'file-1');

  const upload = calls.find((call) => call.url.startsWith('https://www.googleapis.com/upload/'));
  assert.equal(upload.url, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
  assert.equal(upload.method, 'POST');
  const boundary = upload.headers['Content-Type'].match(/^multipart\/related; boundary=(.+)$/)[1];
  const body = Buffer.from(upload.body);
  const [, metadataPart, mediaPart] = body.toString('latin1').split(`--${boundary}`);
  assert.ok(metadataPart.startsWith('\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'));
  const metadata = Buffer.from(metadataPart.split('\r\n\r\n')[1].trimEnd(), 'latin1').toString('utf8');
  assert.deepEqual(JSON.parse(metadata), { name: 'รูป.jpg', parents: ['folder-1'] });
  assert.ok(mediaPart.startsWith('\r\nContent-Type: image/jpeg\r\n\r\n'));
  assert.ok(body.includes(bytes));
  assert.ok(body.toString('latin1').endsWith(`\r\n--${boundary}--`));
});

test('Google client errors carry numeric code/status and the Google message so callWithRetry can detect 429', async () => {
  const { fetch } = stubFetch(() => jsonResponse({ error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }, 429));
  const sheets = loadGoogleAuth(fetch, OAUTH_ENV).getSheetsClient();
  await assert.rejects(
    sheets.spreadsheets.get({ spreadsheetId: 'sheet-1' }),
    (error) => error.code === 429 && error.status === 429 && /Quota exceeded/.test(error.message),
  );
});
