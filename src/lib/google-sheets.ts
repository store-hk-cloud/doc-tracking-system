import { getSheetsClient } from './google-auth';
import { createClient } from '@supabase/supabase-js';

const HEADERS_DOCUMENTS = [
  'Running No.', 'วันที่รับ', 'เลขที่เอกสาร', 'ผู้ส่ง', 'เรื่อง',
  'หน่วยงาน', 'สถานะ', 'ลายเซ็น Admin', 'เวลา Admin ลงนาม',
  'ลายเซ็นผู้รับ', 'เวลาผู้รับลงนาม', 'เสียหาย', 'รูปความเสียหาย',
  'หมายเหตุ', 'ผู้บันทึก', 'created_at', 'updated_at',
];

const HEADERS_DELIVERY_HISTORY = [
  'Running No.', 'ผู้ส่ง', 'เรื่อง', 'ชื่อผู้รับ', 'หน่วยงาน',
  'ลายเซ็นผู้รับ', 'เวลาลงนาม', 'ผลการตรวจสอบ', 'หมายเหตุ', 'สถานะ', '',
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
    // Auto-create spreadsheet with today's sheet + delivery history sheet
    const sheets = getSheetsClient();
    const today = todaySheetName();
    const res = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: `ระบบรับ-ส่งเอกสาร` },
        sheets: [
          { properties: { title: today } },
          { properties: { title: 'ประวัติการส่งมอบ' } },
        ],
      },
    });
    cachedSpreadsheetId = res.data.spreadsheetId!;

    // Write headers for today's sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId: cachedSpreadsheetId,
      range: `${today}!A1:Z1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [HEADERS_DOCUMENTS] },
    });

    // Write headers for delivery history sheet
    await sheets.spreadsheets.values.update({
      spreadsheetId: cachedSpreadsheetId,
      range: `ประวัติการส่งมอบ!A1:Z1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [HEADERS_DELIVERY_HISTORY] },
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
 * Get or create today's sheet tab (for daily documents).
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
    // Insert today's sheet at index 1 (after "ประวัติการส่งมอบ" at index 0)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title: today, index: 1 },
          },
        }],
      },
    });
    // Write headers
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${today}!A1:Z1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [HEADERS_DOCUMENTS] },
    });
    console.log(`[Google Sheets] Created daily sheet: ${today}`);
  }

  return today;
}

/**
 * Get or create a sheet by name (e.g. "ประวัติการส่งมอบ").
 */
async function getOrCreateNamedSheet(sheetName: string, headers: string[]): Promise<string> {
  const spreadsheetId = await getSpreadsheetId();
  const sheets = getSheetsClient();

  // Get existing sheets
  const { data: sheetInfo } = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = sheetInfo?.sheets || [];
  const hasSheet = existingSheets.some((s: any) => s.properties?.title === sheetName);

  if (!hasSheet) {
    // Add sheet at the end
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title: sheetName },
          },
        }],
      },
    });
    // Write headers
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:Z1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    });
    console.log(`[Google Sheets] Created sheet: ${sheetName}`);
  }

  return sheetName;
}

async function getSpreadsheetId(): Promise<string> {
  try {
    return await getOrCreateSpreadsheet();
  } catch (error) {
    console.error('[Google Sheets] Failed to get/create spreadsheet:', error);
    throw error;
  }
}

export async function appendRow(sheetName: string, values: string[]) {
  try {
    const spreadsheetId = await getSpreadsheetId();
    const sheets = getSheetsClient();

    // Determine which sheet to write to based on name
    let targetSheet: string;
    if (sheetName === 'ประวัติการส่งมอบ') {
      targetSheet = await getOrCreateNamedSheet('ประวัติการส่งมอบ', HEADERS_DELIVERY_HISTORY);
    } else {
      targetSheet = await getOrCreateDailySheet();
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${targetSheet}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] },
    });
  } catch (error) {
    console.error(`[Google Sheets] Append error:`, error);
  }
}

export async function updateRow(sheetName: string, rowIndex: number, values: string[]) {
  try {
    const spreadsheetId = await getSpreadsheetId();
    const sheets = getSheetsClient();

    // Determine which sheet to update based on name
    let targetSheet: string;
    if (sheetName === 'ประวัติการส่งมอบ') {
      targetSheet = 'ประวัติการส่งมอบ';
    } else {
      targetSheet = todaySheetName();
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${targetSheet}!A${rowIndex}:Z${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] },
    });
  } catch (error) {
    console.error(`[Google Sheets] Update error:`, error);
  }
}

// Update a row in a specific sheet (used by findRowByValue result)
export async function updateRowInSheet(sheet: string, rowIndex: number, values: string[]) {
  try {
    const spreadsheetId = await getSpreadsheetId();
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheet}!A${rowIndex}:Z${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] },
    });
  } catch (error) {
    console.error(`[Google Sheets] Update in sheet error:`, error);
  }
}

async function findRowByValueAndSheet(column: number, value: string): Promise<{ sheet: string; row: number } | null> {
  const spreadsheetId = await getSpreadsheetId();
  const sheets = getSheetsClient();
  const today = todaySheetName();
  const { data: info } = await sheets.spreadsheets.get({ spreadsheetId });
  const allSheets = (info?.sheets || []).map((s: any) => s.properties?.title).filter(Boolean);

  const targetSheets = allSheets.includes(today)
    ? [today, ...allSheets.filter((s: string) => s !== today && s !== 'ประวัติการส่งมอบ')]
    : allSheets.filter((s: string) => s !== 'ประวัติการส่งมอบ');

  for (const sheet of targetSheets) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheet}!A:Z`,
    });
    const rows = res.data.values || [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][column - 1]?.toString() === value) {
        return { sheet, row: i + 1 };
      }
    }
  }
  return null;
}

// Backward-compatible: return just the row number (for today's sheet)
export async function findRowByValue(_sheetName: string, column: number, value: string): Promise<number | null> {
  try {
    const result = await findRowByValueAndSheet(column, value);
    return result ? result.row : null;
  } catch (error) {
    console.error(`[Google Sheets] Find error:`, error);
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