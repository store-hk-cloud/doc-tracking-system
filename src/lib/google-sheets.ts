import { getSheetsClient } from './google-auth';
import { createClient } from '@supabase/supabase-js';

const SHEET_NAMES = {
  INCOMING: 'เอกสารเข้า',
  DELIVERY_HISTORY: 'ประวัติการส่งมอบ',
} as const;

const HEADERS = {
  [SHEET_NAMES.INCOMING]: [
    'Running No.', 'วันที่รับ', 'เลขที่เอกสาร', 'ผู้ส่ง', 'เรื่อง',
    'หน่วยงาน', 'สถานะ', 'ลายเซ็น Admin', 'เวลา Admin ลงนาม',
    'ลายเซ็นผู้รับ', 'เวลาผู้รับลงนาม', 'เสียหาย', 'รูปความเสียหาย',
    'หมายเหตุ', 'ผู้บันทึก', 'created_at', 'updated_at',
  ],
  [SHEET_NAMES.DELIVERY_HISTORY]: [
    'Running No.', 'ผู้ส่ง', 'เรื่อง', 'ผู้รับ', 'หน่วยงาน',
    'ลายเซ็นผู้รับ', 'เวลาที่รับ', 'ผลตรวจสอบ', 'หมายเหตุ', 'สถานะตรวจสอบ', '',
  ],
} as const;

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
      return data.value;
    }
  }

  // Auto-create spreadsheet
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `ระบบรับ-ส่งเอกสาร (${new Date().toISOString().split('T')[0]})` },
      sheets: [
        { properties: { title: SHEET_NAMES.INCOMING } },
        { properties: { title: SHEET_NAMES.DELIVERY_HISTORY } },
      ],
    },
  });

  const spreadsheetId = res.data.spreadsheetId!;
  cachedSpreadsheetId = spreadsheetId;

  // Write headers
  for (const [name, headers] of Object.entries(HEADERS)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${name}!A1:Z1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    });
  }

  // Persist to Supabase
  if (supabaseUrl && supabaseKey) {
    const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    await sb.from('app_settings').upsert(
      { key: 'google_spreadsheet_id', value: spreadsheetId },
      { onConflict: 'key' }
    );
  }

  console.log(`[Google Sheets] Created spreadsheet: ${spreadsheetId}`);
  return spreadsheetId;
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
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
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
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A${rowIndex}:Z${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] },
    });
  } catch (error) {
    console.error(`[Google Sheets] Update error:`, error);
  }
}

export async function findRowByValue(sheetName: string, column: number, value: string): Promise<number | null> {
  try {
    const spreadsheetId = await getSpreadsheetId();
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });
    const rows = res.data.values || [];
    for (let i = 1; i < rows.length; i++) { // Skip header (index 0)
      if (rows[i][column - 1]?.toString() === value) {
        return i + 1; // 1-indexed (row 1 = header, so data starts at row 2)
      }
    }
    return null;
  } catch (error) {
    console.error(`[Google Sheets] Find error:`, error);
    return null;
  }
}

/** Get the current spreadsheet URL for sharing */
export async function getSpreadsheetUrl(): Promise<string | null> {
  try {
    const id = await getSpreadsheetId();
    return `https://docs.google.com/spreadsheets/d/${id}`;
  } catch {
    return null;
  }
}
