import { NextResponse } from 'next/server';
import { getSheetsClient } from '@/lib/google-auth';
import { createClient } from '@supabase/supabase-js';

const HEADERS = [
  'Running No.', 'วันที่รับ', 'เลขที่เอกสาร', 'ผู้ส่ง', 'เรื่อง',
  'หน่วยงาน', 'สถานะ', 'ลายเซ็น Admin', 'เวลา Admin ลงนาม',
  'ลายเซ็นผู้รับ', 'เวลาผู้รับลงนาม', 'เสียหาย', 'รูปความเสียหาย',
  'หมายเหตุ', 'ผู้บันทึก', 'created_at', 'updated_at',
];

export async function GET() {
  try {
    // Check if already exists
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    let spreadsheetId: string | null = null;

    if (supabaseUrl && supabaseKey) {
      const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
      const { data } = await sb.from('app_settings').select('value').eq('key', 'google_spreadsheet_id').single();
      if (data?.value) {
        spreadsheetId = data.value;
      }
    }

    if (spreadsheetId) {
      // Redirect directly to the spreadsheet
      return NextResponse.redirect(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
    }

    // Create new spreadsheet
    const sheets = getSheetsClient();
    const today = new Date().toISOString().split('T')[0];
    
    const res = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: 'ระบบรับ-ส่งเอกสาร' },
        sheets: [{ properties: { title: today } }],
      },
    });

    spreadsheetId = res.data.spreadsheetId!;

    // Write headers
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${today}!A1:Z1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [HEADERS] },
    });

    // Persist to Supabase
    if (supabaseUrl && supabaseKey) {
      const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
      await sb.from('app_settings').upsert(
        { key: 'google_spreadsheet_id', value: spreadsheetId },
        { onConflict: 'key' }
      );
    }

    // Redirect to the newly created spreadsheet
    return NextResponse.redirect(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  } catch (error: any) {
    console.error('[Setup Sheets] Error:', error);
    // Return HTML page with error
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2>❌ ไม่สามารถสร้าง/เปิด Google Sheet</h2>
        <p style="color:red">${error.message}</p>
        <hr>
        <p>สาเหตุที่เป็นไปได้:</p>
        <ul style="text-align:left;max-width:400px;margin:auto">
          <li>GOOGLE_REFRESH_TOKEN หมดอายุ → ต้องขอใหม่ที่ OAuth Playground</li>
          <li>GOOGLE_CLIENT_ID หรือ GOOGLE_CLIENT_SECRET ไม่ถูกต้อง</li>
          <li>ไม่ได้เพิ่ม scope sheets + drive ใน OAuth Playground</li>
        </ul>
        <p><a href="/dashboard">← กลับไปหน้า Dashboard</a></p>
      </body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    );
  }
}
