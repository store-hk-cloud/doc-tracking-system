import { NextResponse } from 'next/server';
import { requireRoles } from '@/lib/supabase/auth-helpers';
import { getSpreadsheetUrl } from '@/lib/google-sheets';

export async function GET() {
  try {
    const auth = await requireRoles(['super_admin']);
    if (auth.response) return auth.response;

    // Always resolve through the same logic the app uses to actually read/write
    // (env var first, then Supabase app_settings, then auto-create) — this used
    // to have its own separate Supabase-only lookup here, which could point at
    // a stale spreadsheet ID different from the one the app was really syncing to.
    const url = await getSpreadsheetUrl();
    if (!url) throw new Error('ไม่พบ Google Sheet และสร้างใหม่ไม่สำเร็จ');

    return NextResponse.redirect(url);
  } catch (error: any) {
    console.error('[Setup Sheets] Error:', error);
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
