import { getSheetsClient } from './google-auth';
import { createClient } from '@supabase/supabase-js';

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

let cachedSpreadsheetId: string | null = null;

async function getOrCreateSpreadsheet(): Promise<string> {
  // Check env
  if (process.env.GOOGLE_SHEETS_SPREADSHEET_ID) {
    return process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  }

  // Check cache
  if (cachedSpreadsheetId) return cachedSpreadsheetId;

  // Try to get from Supabase (persisted across deploys)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && supabaseKey) {
    const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    const { data } = await sb.from('app_settings').select('value').eq('key', 'google_spreadsheet_id').single();
    if (data?.value) {
      cachedSpreadsheetId = data.value;
    }
  }

  if (!cachedSpreadsheetId) {
    // Auto-create spreadsheet with today's sheet
    const sheets = getSheetsClient();
    const today = todaySheetName();
    const res = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: `จดหมาย พัสดุ เอกสารภายใน` },
        sheets: [{ properties: { title: today } }],
      },
    });
    cachedSpreadsheetId = res.data.spreadsheetId!;

    // Write headers
    await sheets.spreadsheets.values.update({
      spreadsheetId: cachedSpreadsheetId,
      range: `${today}!A1:U1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [HEADERS] },
    });

    // Persist to Supabase
    if (supabaseUrl && supabaseKey) {
      const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
      await sb.from('app_settings').upsert(
        { key: 'google_spreadsheet_id', value: cachedSpreadsheetId },
        { onConflict: 'key' }
      );
    }
    console.log(`[Google Sheets] Created spreadsheet: ${cachedSpreadsheetId}`);
  }

  return cachedSpreadsheetId;
}

/**
 * Get or create today's sheet tab.
 * Newest day is inserted at index 0 (leftmost).
 */
async function getOrCreateDailySheet(): Promise<string> {
  const spreadsheetId = await getSpreadsheetId();
  const sheets = getSheetsClient();
  const today = todaySheetName();

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
  if (updates.length === 0) return;
  try {
    const spreadsheetId = await getSpreadsheetId();
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates.map((u) => ({ range: `${sheet}!A${u.row}:U${u.row}`, values: [u.values] })),
      },
    });
  } catch (error) {
    console.error('[Google Sheets] Batch update error:', error);
  }
}

export async function appendRow(sheetName: string, values: string[]) {
  try {
    const spreadsheetId = await getSpreadsheetId();
    const sheets = getSheetsClient();
    const today = await getOrCreateDailySheet();
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${today}!A:U`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] },
    });
  } catch (error) {
    console.error(`[Google Sheets] Append error:`, error);
  }
}

// Update a row in a specific sheet tab (use findRowLocation first — a row may
// live in an older daily tab, not today's, once its document isn't from today).
export async function updateRowInSheet(sheet: string, rowIndex: number, values: string[]) {
  try {
    const spreadsheetId = await getSpreadsheetId();
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheet}!A${rowIndex}:U${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] },
    });
  } catch (error) {
    console.error(`[Google Sheets] Update in sheet error:`, error);
  }
}

// Returns which sheet TAB a row lives in, not just its row number — a match found
// in an older daily tab must be updated there, not in today's tab (see updateRowInSheet).
export async function findRowLocation(column: number, value: string): Promise<{ sheet: string; row: number } | null> {
  try {
    const spreadsheetId = await getSpreadsheetId();
    const sheets = getSheetsClient();
    const today = todaySheetName();
    const { data: info } = await sheets.spreadsheets.get({ spreadsheetId });
    const allSheets = (info?.sheets || []).map((s: any) => s.properties?.title).filter(Boolean);

    const targetSheets = allSheets.includes(today)
      ? [today, ...allSheets.filter((s: string) => s !== today)]
      : allSheets;

    for (const sheet of targetSheets) {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheet}!A:U`,
      });
      const rows = res.data.values || [];
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][column - 1]?.toString() === value) {
          return { sheet, row: i + 1 };
        }
      }
    }
    return null;
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