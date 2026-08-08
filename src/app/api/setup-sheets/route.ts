import { NextResponse } from 'next/server';
import { getSheetsClient } from '@/lib/google-auth';
import { createClient } from '@supabase/supabase-js';
import { requireRoles } from '@/lib/supabase/auth-helpers';
import { HEADERS } from '@/lib/google-sheets';

export async function GET() {
  try {
    const auth = await requireRoles(['super_admin']);
    if (auth.response) return auth.response;

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
        properties: { title: 'จดหมาย พัสดุ เอกสารภายใน' },
        sheets: [{ properties: { title: today } }],
      },
    });

    spreadsheetId = res.data.spreadsheetId!;

    // Write headers (unified layout, 21 columns)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${today}!A1:U1`,
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
