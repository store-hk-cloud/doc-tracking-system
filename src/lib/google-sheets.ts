import { getSheetsClient } from './google-auth';
import { bangkokDate } from './thai-date';

// Permanently pinned to this spreadsheet — do not resolve this from a mutable
// DB row again (a stale app_settings.google_spreadsheet_id value previously
// caused the app to silently sync to a different spreadsheet than this one).
// Set the GOOGLE_SHEETS_SPREADSHEET_ID env var to override, if ever needed.
const PINNED_SPREADSHEET_ID = '1qremvBM2GKrh5IXV9JH9KNZ6W-M8TFXgOi5_ReitEWI';

/**
 * NEW unified header - 1 row has everything:
 * document info + admin sign + recipient sign + delivery result
 */
export const HEADERS = [
  'เลขที่รับเข้า',      // A (รูปแบบ 2026-08/001 นับใหม่ทุกเดือน)
  'วันที่รับ',          // B
  'เลขที่เอกสาร',       // C
  'ผู้ส่ง',             // D
  'เรื่อง',             // E
  'หน่วยงาน',          // F
  'สถานะ',             // G - registered → delivered → signed/rejected
  'ลายเซ็น Admin',     // H
  'เวลา Admin ลงนาม',  // I
  'ชื่อผู้รับ',         // J
  'ลายเซ็นผู้รับ',      // K
  'เวลาผู้รับลงนาม',    // L
  'ผลการตรวจสอบ',      // M - ถูกต้อง / ไม่ถูกต้อง
  'หมายเหตุ (ผู้รับ)',  // N
  'เสียหาย',           // O
  'รูปความเสียหาย',    // P
  'หมายเหตุ',          // Q - note at creation
  'ผู้บันทึก',          // R
  'updated_at',        // S
  'เลขใบกำกับภาษี',     // T
  'รหัสอ้างอิง',        // U - document_recipients.id, used to find/update this row
];

/** Get today's date as YYYY-MM-DD */
function todaySheetName(): string {
  return bangkokDate();
}

// แท็บข้อมูลของระบบมีได้เฉพาะวันที่ ISO เท่านั้น แท็บ suffix _conflict... เป็น
// ซากจากบัคเดิมที่ Google เติมชื่อให้ตอน create พร้อมกัน ห้ามใช้เป็นแหล่งค้นหา
// หรือปลายทางเขียน มิฉะนั้นสถานะใหม่จะไปอัปเดตสำเนาเก่าแทนแถวหลัก.
function isDailySheetName(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/* ─────────────────────── กันชนโควตาของ Google Sheets ───────────────────────
 *
 * โควตาคือ 300 คำขอ/นาที ต่อโปรเจกต์ และ 60 คำขอ/นาที ต่อผู้ใช้ ซึ่งที่นี่คือ
 * service account ตัวเดียว หน้าเว็บยิงการลงนามพร้อมกันทั้งหมดได้ (หลายสิบใบ)
 * และแต่ละใบต้องอ่านทุกแท็บเพื่อหาแถวของตัวเอง ถ้าปล่อยตามนั้นจะเกินโควตาทันที
 *
 * กันสามชั้น: จำกัดจำนวนคำขอที่ออกไปพร้อมกัน · retry แบบถอยหลังเมื่อโดน 429
 * · ทำดัชนีตำแหน่งแถวครั้งเดียวแล้วใช้ร่วมกันทุกคำขอ (ดู getLocationIndex)
 * ทั้งหมดอยู่ฝั่งเซิร์ฟเวอร์ หน้าเว็บจึงยังยิงพร้อมกันได้เหมือนเดิม
 */
const SHEETS_MAX_CONCURRENT = 5;
let activeSheetsCalls = 0;
const sheetsQueue: (() => void)[] = [];

const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

async function callWithRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let delay = 600;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error: any) {
      const status = Number(error?.code ?? error?.status ?? error?.response?.status);
      if (attempt >= attempts || !RETRYABLE_STATUSES.includes(status)) throw error;
      // jitter กันไม่ให้คำขอที่โดน 429 พร้อมกันกลับมายิงพร้อมกันอีกรอบ
      await new Promise((resolve) => setTimeout(resolve, delay + Math.random() * 300));
      delay *= 2;
      console.warn(`[Google Sheets] โดน ${status} ลองใหม่ครั้งที่ ${attempt + 1}`);
    }
  }
}

/** ปล่อยคำขอออกไปได้ไม่เกิน SHEETS_MAX_CONCURRENT ตัวพร้อมกัน ที่เหลือเข้าคิว */
async function withSheetsSlot<T>(fn: () => Promise<T>): Promise<T> {
  // ตอนปล่อยต้อง "ส่งต่อ slot" ให้คนที่รออยู่ ไม่ใช่ลดตัวนับแล้วปลุก
  //
  // เดิมลดตัวนับก่อนแล้วค่อย resolve คนที่รอ ซึ่งเปิดช่องให้คำขอใหม่ที่แทรกเข้ามา
  // ระหว่างนั้นเห็นตัวนับต่ำกว่าเพดานแล้วผ่านไปได้ ทำให้วิ่งเกินเพดานพร้อมกัน
  // ช่องนี้ปิดอยู่เองด้วยลำดับ microtask (คนที่รอกลับมาก่อนคำขอใหม่ที่มาจาก I/O
  // เสมอ) จึงยังไม่เคยหลุดจริง — แก้ให้ค่าคงที่ถูกบังคับด้วยโครงสร้างแทนการ
  // พึ่งลำดับ scheduler ซึ่งไม่ใช่สิ่งที่โค้ดนี้ควรต้องรู้
  if (activeSheetsCalls >= SHEETS_MAX_CONCURRENT) {
    // ได้ slot ที่ถูกส่งต่อมาแล้ว ตัวนับถูกถือไว้ให้ จึงไม่บวกซ้ำ
    await new Promise<void>((resolve) => sheetsQueue.push(resolve));
  } else {
    activeSheetsCalls += 1;
  }
  try {
    return await callWithRetry(fn);
  } finally {
    const next = sheetsQueue.shift();
    if (next) next();
    else activeSheetsCalls -= 1;
  }
}

async function getOrCreateSpreadsheet(): Promise<string> {
  return process.env.GOOGLE_SHEETS_SPREADSHEET_ID || PINNED_SPREADSHEET_ID;
}

/**
 * Get or create today's sheet tab.
 * Newest day is inserted at index 0 (leftmost).
 */
// Avoids re-checking/re-creating today's tab on every single append within the
// same warm serverless instance — cuts a metadata read per call down to one.
const ensuredDailySheets = new Set<string>();
const dailySheetBuilds = new Map<string, Promise<string>>();
const headerRepairBuilds = new Map<string, Promise<string>>();

function deterministicSheetId(date: string): number {
  return Number(date.replaceAll('-', ''));
}

function hasExpectedHeader(row: unknown): boolean {
  return Array.isArray(row) && HEADERS.every((header, index) => row[index] === header);
}

function looksLikeHeader(row: unknown[]): boolean {
  return row[0] === HEADERS[0]
    || row[0] === 'Running No.'
    || row[20] === HEADERS[20];
}

async function ensureDailyHeader(
  spreadsheetId: string,
  sheets: ReturnType<typeof getSheetsClient>,
  date: string,
  sheetId: number,
  repairDocumentRow: boolean,
): Promise<boolean> {
  const { data } = await withSheetsSlot<any>(() => sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${date}!A1:U1`,
  }));
  const firstRow = data?.values?.[0] || [];
  if (hasExpectedHeader(firstRow)) return false;

  // หัวตารางรุ่นเก่าเปลี่ยนได้ตรง ๆ แต่ข้อมูลจริงแถวแรกต้องเลื่อนลงก่อน
  // เพื่อไม่ให้การซ่อมแท็บที่เคยสร้างพลาดทำเอกสารแถวแรกหายไป
  if (firstRow.some((value: unknown) => value !== '') && !looksLikeHeader(firstRow)) {
    if (!repairDocumentRow) return false;
    await withSheetsSlot(() => sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            insertDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
              inheritFromBefore: false,
            },
          },
          {
            updateCells: {
              start: { sheetId, rowIndex: 0, columnIndex: 0 },
              rows: [{
                values: HEADERS.map((header) => ({ userEnteredValue: { stringValue: header } })),
              }],
              fields: 'userEnteredValue',
            },
          },
        ],
      },
    }));
  } else {
    await withSheetsSlot(() => sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${date}!A1:U1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    }));
  }
  invalidateLocationIndexes();
  return true;
}

async function ensureDailySheet(date: string, repairExistingHeader = false): Promise<string> {
  const spreadsheetId = await getSpreadsheetId();
  const sheets = getSheetsClient();
  let created = false;

  // Get existing sheets
  const { data: sheetInfo } = await withSheetsSlot<any>(() =>
    sheets.spreadsheets.get({ spreadsheetId })
  );
  const existingSheets = sheetInfo?.sheets || [];
  let dailySheet = existingSheets.find((s: any) => s.properties?.title === date);

  if (!dailySheet) {
    try {
      // sheetId ที่คำนวณจากวันที่ทำให้ serverless หลาย instance ที่สร้างแท็บ
      // พร้อมกันชนกันด้วย ID เดียว แล้วมีเพียงคำขอแรกที่สำเร็จ แทนที่ Google
      // จะเปลี่ยนชื่อคำขอถัดไปเป็น `<date>_conflict...` และกระจายข้อมูลคนละแท็บ
      await withSheetsSlot(() => sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: { sheetId: deterministicSheetId(date), title: date, index: 0 },
            },
          }],
        },
      }));
      created = true;
      dailySheet = { properties: { sheetId: deterministicSheetId(date), title: date } };
    } catch (error) {
      // อีก instance อาจสร้างแท็บสำเร็จระหว่าง metadata read กับ addSheet
      // ยอมรับ error ได้เฉพาะเมื่ออ่านซ้ำแล้วพบแท็บหลักจริงเท่านั้น
      const { data: latest } = await withSheetsSlot<any>(() =>
        sheets.spreadsheets.get({ spreadsheetId })
      );
      dailySheet = (latest?.sheets || []).find((s: any) => s.properties?.title === date);
      if (!dailySheet) throw error;
    }
  }

  const sheetId = dailySheet?.properties?.sheetId;
  if (typeof sheetId !== 'number') throw new Error(`Daily sheet ${date} has no sheet ID`);
  await ensureDailyHeader(spreadsheetId, sheets, date, sheetId, created || repairExistingHeader);
  if (created) console.log(`[Google Sheets] Created daily sheet: ${date}`);

  ensuredDailySheets.add(date);
  return date;
}

async function getOrCreateDailySheet(date = todaySheetName()): Promise<string> {
  if (ensuredDailySheets.has(date)) return date;
  const inFlight = dailySheetBuilds.get(date);
  if (inFlight) return inFlight;

  const build = ensureDailySheet(date).finally(() => dailySheetBuilds.delete(date));
  dailySheetBuilds.set(date, build);
  return build;
}

// ใช้ก่อนอ่านแท็บรายวันในงานซ่อม เพื่อให้ข้อมูลแถวแรกไม่ถูกตีความว่าเป็น header
// แล้วหลุดจากการเทียบกับฐานข้อมูล.
export async function ensureDailySheetReady(date: string): Promise<string> {
  if (!isDailySheetName(date)) throw new Error(`Invalid daily sheet name: ${date}`);
  const inFlightRepair = headerRepairBuilds.get(date);
  if (inFlightRepair) return inFlightRepair;

  const repair = (async () => {
    const inFlightBuild = dailySheetBuilds.get(date);
    if (inFlightBuild) await inFlightBuild;
    return ensureDailySheet(date, true);
  })().finally(() => headerRepairBuilds.delete(date));
  headerRepairBuilds.set(date, repair);
  return repair;
}

export async function getSpreadsheetId(): Promise<string> {
  try {
    return await getOrCreateSpreadsheet();
  } catch (error) {
    console.error('[Google Sheets] Failed to get/create spreadsheet:', error);
    throw error;
  }
}

/** List every existing sheet tab name (e.g. daily tabs), newest-first as they appear in the spreadsheet. */
export async function listSheetTabs(): Promise<string[]> {
  const spreadsheetId = await getSpreadsheetId();
  const sheets = getSheetsClient();
  const { data: info } = await withSheetsSlot<any>(() =>
    sheets.spreadsheets.get({ spreadsheetId })
  );
  return (info?.sheets || []).map((s: any) => s.properties?.title).filter(isDailySheetName);
}

/** Read all rows (including header) of a given sheet tab, columns A:U. */
export async function getSheetValues(sheet: string): Promise<string[][]> {
  const spreadsheetId = await getSpreadsheetId();
  const sheets = getSheetsClient();
  // ต้องผ่าน withSheetsSlot ด้วย: api/admin/backfill-sheets วนเรียกฟังก์ชันนี้
  // ทีละแท็บ (แท็บละวัน = หลายร้อยแท็บ) ถ้าไม่ผ่านชั้นกันโควตา เจอ 429 ครั้งเดียว
  // ก็ throw แล้ว backfill ล้มทั้งงาน ทั้งที่ไฟล์นี้มี retry ไว้แล้ว
  const res = await withSheetsSlot<any>(() =>
    sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheet}!A:U` })
  );
  return res.data.values || [];
}

/** Read multiple daily tabs in one API request to keep maintenance below Sheets read quota. */
export async function getSheetValuesBatch(sheetNames: string[]): Promise<Map<string, string[][]>> {
  const names = [...new Set(sheetNames.filter(isDailySheetName))];
  const rowsBySheet = new Map<string, string[][]>();
  if (names.length === 0) return rowsBySheet;

  const spreadsheetId = await getSpreadsheetId();
  const sheets = getSheetsClient();
  for (let start = 0; start < names.length; start += 100) {
    const chunk = names.slice(start, start + 100);
    const { data } = await withSheetsSlot<any>(() => sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: chunk.map((sheet) => `${sheet}!A:U`),
    }));
    const valueRanges = data?.valueRanges || [];
    for (let index = 0; index < chunk.length; index += 1) {
      rowsBySheet.set(chunk[index], valueRanges[index]?.values || []);
    }
  }
  return rowsBySheet;
}

/** Overwrite multiple full rows (A:U) within a single sheet tab in one API call. */
export async function batchUpdateRows(sheet: string, updates: { row: number; values: string[] }[]) {
  try {
    await batchUpdateRowsOrThrow(sheet, updates);
  } catch (error) {
    console.error('[Google Sheets] Batch update error:', error);
  }
}

// Throwing variant — use where the caller needs to know a write actually
// succeeded (e.g. an admin-triggered backfill), instead of the fire-and-forget
// swallow-errors behavior other callers rely on.
export async function batchUpdateRowsOrThrow(sheet: string, updates: { row: number; values: string[] }[]) {
  if (updates.length === 0) return;
  const spreadsheetId = await getSpreadsheetId();
  const sheets = getSheetsClient();
  await withSheetsSlot(() => sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates.map((u) => ({ range: `${sheet}!A${u.row}:U${u.row}`, values: [u.values] })),
    },
  }));
}

export async function updateRowInSheetOrThrow(sheet: string, rowIndex: number, values: string[]) {
  const spreadsheetId = await getSpreadsheetId();
  const sheets = getSheetsClient();
  await withSheetsSlot(() => sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheet}!A${rowIndex}:U${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [values] },
  }));
}

export async function appendRow(sheetName: string, values: string[]) {
  return appendRows(sheetName, [values]);
}

// Append many rows in a single API call — use this instead of looping appendRow
// when writing more than one row at once (e.g. bulk backfills), since each
// appendRow call otherwise costs its own read+write quota.
export async function appendRows(sheetName: string, rows: string[][]) {
  try {
    await appendRowsOrThrow(sheetName, rows);
  } catch (error) {
    console.error(`[Google Sheets] Append error:`, error);
  }
}

// Throwing variant — see batchUpdateRowsOrThrow.
export async function appendRowsOrThrow(sheetName: string, rows: string[][]) {
  if (rows.length === 0) return;
  const spreadsheetId = await getSpreadsheetId();
  const sheets = getSheetsClient();
  const preferredDate = isDailySheetName(sheetName) ? sheetName : todaySheetName();
  const targetSheet = await getOrCreateDailySheet(preferredDate);
  await withSheetsSlot(() => sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${targetSheet}!A:U`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  }));
  // แถวที่เพิ่งเพิ่มยังไม่อยู่ในดัชนี — ทิ้งดัชนีเพื่อไม่ให้ findRowLocation หาไม่เจอ
  // แล้วต้อง rebuild เองทุกครั้งที่ถูกเรียกถึงแถวใหม่
  invalidateLocationIndexes();
}

// Update a row in a specific sheet tab (use findRowLocation first — a row may
// live in an older daily tab, not today's, once its document isn't from today).
export async function updateRowInSheet(sheet: string, rowIndex: number, values: string[]) {
  try {
    await updateRowInSheetOrThrow(sheet, rowIndex, values);
  } catch (error) {
    console.error(`[Google Sheets] Update in sheet error:`, error);
  }
}

type RowLocation = { sheet: string; row: number };

// ดัชนี "ค่าในคอลัมน์ → แท็บ+แถว" ต่อหนึ่งคอลัมน์ อ่านทุกแท็บครั้งเดียวแล้วใช้ซ้ำ
// เดิมทุกคำขอสแกนทุกแท็บของตัวเอง การรับ 50 ใบจึงเท่ากับสแกนสเปรดชีต 50 รอบ
// TTL สั้นเพราะดัชนีเก็บ "เลขแถว" ถ้ามีคนแทรก/ลบแถวในสเปรดชีตด้วยมือ เลขแถวที่
// จำไว้จะเลื่อน และการเขียนอาจไปทับแถวข้างเคียง 60 วินาทีคือหน้าต่างที่ยอมรับได้
const LOCATION_INDEX_TTL_MS = 60_000;
const locationIndexes = new Map<number, { builtAt: number; byValue: Map<string, RowLocation> }>();
// คำขอที่มาพร้อมกันต้องรอดัชนีชุดเดียวกัน ไม่ใช่ต่างคนต่างสร้าง
const locationIndexBuilds = new Map<number, Promise<Map<string, RowLocation>>>();
let locationIndexGeneration = 0;

function invalidateLocationIndexes() {
  locationIndexGeneration += 1;
  locationIndexes.clear();
}

async function buildLocationIndex(column: number): Promise<Map<string, RowLocation>> {
  const spreadsheetId = await getSpreadsheetId();
  const sheets = getSheetsClient();
  const today = todaySheetName();
  const { data: info } = await withSheetsSlot<any>(() => sheets.spreadsheets.get({ spreadsheetId }));
  const dailySheets = (info?.sheets || []).filter((s: any) => isDailySheetName(s.properties?.title));
  const allSheets = dailySheets.map((s: any) => s.properties.title);

  // เรียงแท็บวันนี้ไว้หน้าสุด และเก็บ "ค่าแรกที่เจอ" เพื่อให้ผลลัพธ์ตรงกับการ
  // ค้นแบบเดิมทุกกรณี รวมถึงกรณีรหัสอ้างอิงซ้ำข้ามแท็บ
  const targetSheets = allSheets.includes(today)
    ? [today, ...allSheets.filter((s: string) => s !== today)]
    : allSheets;
  const rowsBySheet = await getSheetValuesBatch(targetSheets);

  const byValue = new Map<string, RowLocation>();
  for (const sheet of targetSheets) {
    const rows = rowsBySheet.get(sheet) || [];
    const firstDataRow = hasExpectedHeader(rows[0] || []) || looksLikeHeader(rows[0] || []) ? 1 : 0;
    for (let i = firstDataRow; i < rows.length; i++) {
      const key = rows[i][column - 1]?.toString();
      if (key && !byValue.has(key)) byValue.set(key, { sheet, row: i + 1 });
    }
  }
  return byValue;
}

async function getLocationIndex(column: number, forceRebuild: boolean): Promise<Map<string, RowLocation>> {
  const cached = locationIndexes.get(column);
  if (!forceRebuild && cached && Date.now() - cached.builtAt < LOCATION_INDEX_TTL_MS) {
    return cached.byValue;
  }
  const inFlight = locationIndexBuilds.get(column);
  if (inFlight) return inFlight;

  const build = (async () => {
    // การซ่อมหัวตารางอาจเลื่อนเลขแถวระหว่างที่อ่านดัชนี ต้องทิ้ง snapshot เก่าด้วย
    let generation: number;
    let byValue: Map<string, RowLocation>;
    do {
      generation = locationIndexGeneration;
      byValue = await buildLocationIndex(column);
    } while (generation !== locationIndexGeneration);
    locationIndexes.set(column, { builtAt: Date.now(), byValue });
    return byValue;
  })()
    .finally(() => locationIndexBuilds.delete(column));
  locationIndexBuilds.set(column, build);
  return build;
}

// Returns which sheet TAB a row lives in, not just its row number — a match found
// in an older daily tab must be updated there, not in today's tab (see updateRowInSheet).
export async function findRowLocation(column: number, value: string): Promise<RowLocation | null> {
  const hit = (await getLocationIndex(column, false)).get(value);
  if (hit) return hit;
  // ไม่เจอในดัชนี = อาจเป็นแถวที่ถูก append หลังดัชนีถูกสร้าง จึงสร้างใหม่หนึ่งครั้ง
  // ก่อนจะสรุปว่าไม่มีจริง (ราคาเท่าการสแกนแบบเดิม ไม่แพงกว่า)
  return (await getLocationIndex(column, true)).get(value) || null;
}

// serialize งานของผู้รับคนเดียวกันใน instance เดียว: ถ้าทั้งสองคำขอค้นหาแถว
// ก่อนที่คำขอแรกจะ append สำเร็จ ต่างคนต่างเห็นว่าไม่พบและสร้างสำเนาซ้ำได้.
const rowSyncQueues = new Map<string, Promise<void>>();

/** อัปเดตแถวเดิม หรือเติมแถวที่เคยซิงก์พลาดลงแท็บของวันที่รับเอกสาร */
async function syncRowInSheetOnce(preferredSheet: string, values: string[]) {
  try {
    const referenceId = values[20];
    const location = referenceId ? await findRowLocation(21, referenceId) : null;
    if (location) await updateRowInSheetOrThrow(location.sheet, location.row, values);
    else await appendRowsOrThrow(preferredSheet, [values]);
  } catch (error) {
    console.error('[Google Sheets] Sync row error:', error);
  }
}

export async function syncRowInSheet(preferredSheet: string, values: string[]) {
  const referenceId = values[20];
  if (!referenceId) return syncRowInSheetOnce(preferredSheet, values);

  const key = String(referenceId);
  const previous = rowSyncQueues.get(key);
  const queued = (previous || Promise.resolve())
    .catch(() => undefined)
    .then(() => syncRowInSheetOnce(preferredSheet, values))
    .finally(() => {
      if (rowSyncQueues.get(key) === queued) rowSyncQueues.delete(key);
    });
  rowSyncQueues.set(key, queued);
  return queued;
}

export async function getSpreadsheetUrl(): Promise<string | null> {
  try {
    const id = await getSpreadsheetId();
    return `https://docs.google.com/spreadsheets/d/${id}`;
  } catch {
    return null;
  }
}
