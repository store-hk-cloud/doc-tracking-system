import { getSheetsClient } from './google-auth';

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
  'Running No.',       // A
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
  return new Date().toISOString().split('T')[0];
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
  if (activeSheetsCalls >= SHEETS_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => sheetsQueue.push(resolve));
  }
  activeSheetsCalls += 1;
  try {
    return await callWithRetry(fn);
  } finally {
    activeSheetsCalls -= 1;
    sheetsQueue.shift()?.();
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
let dailySheetEnsuredFor: string | null = null;

async function getOrCreateDailySheet(): Promise<string> {
  const spreadsheetId = await getSpreadsheetId();
  const sheets = getSheetsClient();
  const today = todaySheetName();

  if (dailySheetEnsuredFor === today) return today;

  // Get existing sheets
  const { data: sheetInfo } = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = sheetInfo?.sheets || [];
  const hasToday = existingSheets.some((s: any) => s.properties?.title === today);

  if (!hasToday) {
    // Insert today's sheet at index 0 (leftmost)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title: today, index: 0 },
          },
        }],
      },
    });
    // Write headers
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${today}!A1:U1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [HEADERS] },
    });
    console.log(`[Google Sheets] Created daily sheet: ${today}`);
  }

  dailySheetEnsuredFor = today;

  return today;
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
  const { data: info } = await sheets.spreadsheets.get({ spreadsheetId });
  return (info?.sheets || []).map((s: any) => s.properties?.title).filter(Boolean);
}

/** Read all rows (including header) of a given sheet tab, columns A:U. */
export async function getSheetValues(sheet: string): Promise<string[][]> {
  const spreadsheetId = await getSpreadsheetId();
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheet}!A:U` });
  return res.data.values || [];
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
      valueInputOption: 'USER_ENTERED',
      data: updates.map((u) => ({ range: `${sheet}!A${u.row}:U${u.row}`, values: [u.values] })),
    },
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
  const today = await getOrCreateDailySheet();
  await withSheetsSlot(() => sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${today}!A:U`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  }));
  // แถวที่เพิ่งเพิ่มยังไม่อยู่ในดัชนี — ทิ้งดัชนีเพื่อไม่ให้ findRowLocation หาไม่เจอ
  // แล้วต้อง rebuild เองทุกครั้งที่ถูกเรียกถึงแถวใหม่
  locationIndexes.clear();
}

// Update a row in a specific sheet tab (use findRowLocation first — a row may
// live in an older daily tab, not today's, once its document isn't from today).
export async function updateRowInSheet(sheet: string, rowIndex: number, values: string[]) {
  try {
    const spreadsheetId = await getSpreadsheetId();
    const sheets = getSheetsClient();
    await withSheetsSlot(() => sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheet}!A${rowIndex}:U${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] },
    }));
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

async function buildLocationIndex(column: number): Promise<Map<string, RowLocation>> {
  const spreadsheetId = await getSpreadsheetId();
  const sheets = getSheetsClient();
  const today = todaySheetName();
  const { data: info } = await withSheetsSlot<any>(() => sheets.spreadsheets.get({ spreadsheetId }));
  const allSheets = (info?.sheets || []).map((s: any) => s.properties?.title).filter(Boolean);

  // เรียงแท็บวันนี้ไว้หน้าสุด และเก็บ "ค่าแรกที่เจอ" เพื่อให้ผลลัพธ์ตรงกับการ
  // ค้นแบบเดิมทุกกรณี รวมถึงกรณีรหัสอ้างอิงซ้ำข้ามแท็บ
  const targetSheets = allSheets.includes(today)
    ? [today, ...allSheets.filter((s: string) => s !== today)]
    : allSheets;

  const byValue = new Map<string, RowLocation>();
  for (const sheet of targetSheets) {
    const res = await withSheetsSlot<any>(() => sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheet}!A:U`,
    }));
    const rows = res.data.values || [];
    for (let i = 1; i < rows.length; i++) {
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

  const build = buildLocationIndex(column)
    .then((byValue) => {
      locationIndexes.set(column, { builtAt: Date.now(), byValue });
      return byValue;
    })
    .finally(() => locationIndexBuilds.delete(column));
  locationIndexBuilds.set(column, build);
  return build;
}

// Returns which sheet TAB a row lives in, not just its row number — a match found
// in an older daily tab must be updated there, not in today's tab (see updateRowInSheet).
export async function findRowLocation(column: number, value: string): Promise<RowLocation | null> {
  try {
    const hit = (await getLocationIndex(column, false)).get(value);
    if (hit) return hit;
    // ไม่เจอในดัชนี = อาจเป็นแถวที่ถูก append หลังดัชนีถูกสร้าง จึงสร้างใหม่หนึ่งครั้ง
    // ก่อนจะสรุปว่าไม่มีจริง (ราคาเท่าการสแกนแบบเดิม ไม่แพงกว่า)
    return (await getLocationIndex(column, true)).get(value) || null;
  } catch (error) {
    console.error('[Google Sheets] Find error:', error);
    return null;
  }
}

export async function getSpreadsheetUrl(): Promise<string | null> {
  try {
    const id = await getSpreadsheetId();
    return `https://docs.google.com/spreadsheets/d/${id}`;
  } catch {
    return null;
  }
}