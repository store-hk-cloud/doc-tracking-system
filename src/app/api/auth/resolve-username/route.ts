import { NextRequest, NextResponse } from 'next/server';
import { escapeLikePattern, getServiceSupabase } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * POST /api/auth/resolve-username — เข้าสู่ระบบด้วยชื่อผู้ใช้
 *
 * Supabase Auth ผูกกับอีเมลเสมอ แต่ห้ามส่งอีเมลที่ resolve ได้กลับไปยัง browser
 * เพราะผู้ที่ยังไม่ล็อกอินจะใช้ endpoint นี้เดาได้ทั้งอีเมลและชื่อผู้ใช้ที่มีอยู่
 *
 * route จึง resolve และตรวจรหัสผ่านบน server ในคำขอเดียว แล้วส่งกลับเฉพาะ token
 * ที่ Supabase ออกให้หลังตรวจ credential สำเร็จเท่านั้น
 */

const GENERIC_ERROR = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
const FALLBACK_EMAIL = 'unknown-username@invalid.local';
const MIN_RESPONSE_TIME_MS = 250;

function waitForMinimumResponseTime(startedAt: number) {
  const remaining = MIN_RESPONSE_TIME_MS - (Date.now() - startedAt);
  return remaining > 0
    ? new Promise<void>((resolve) => setTimeout(resolve, remaining))
    : Promise.resolve();
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  try {
    const body = await request.json();
    const username = String(body.username || '').trim();
    const password = typeof body.password === 'string' ? body.password : '';

    if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username) || !password) {
      await waitForMinimumResponseTime(startedAt);
      return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
    }

    // `_` เป็น wildcard ของ ILIKE และ regex ข้างบนก็อนุญาต `_` ในชื่อผู้ใช้
    // ผลคือ "_______" แมตช์ชื่อผู้ใช้ยาว 7 ตัวอักษรใด ๆ แล้วคืนอีเมลจริงออกมา
    // ซึ่งพัง user enumeration ที่ไฟล์นี้ตั้งใจกันไว้ทั้งหมด — ต้อง escape ก่อน
    // (ยัง ilike อยู่เพื่อคงพฤติกรรมเดิมที่ชื่อผู้ใช้ไม่สนตัวพิมพ์เล็กใหญ่)
    const escaped = escapeLikePattern(username);

    const { data, error: profileError } = await getServiceSupabase()
      .from('profiles')
      .select('email, is_active')
      .ilike('username', escaped)
      .maybeSingle();

    // เรียก Supabase Auth ทุกครั้งที่ input ถูกต้อง เพื่อลดความต่างของเวลาตอบ
    // ระหว่างชื่อผู้ใช้ที่พบกับไม่พบ โดยไม่ส่งอีเมลของ profile ออกนอก server
    const email = !profileError && data?.is_active ? data.email : FALLBACK_EMAIL;
    const supabase = await createServerSupabase();
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });

    await waitForMinimumResponseTime(startedAt);

    if (profileError || !data || data.is_active === false || authError || !authData.session) {
      return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      data: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
      },
    });
  } catch {
    await waitForMinimumResponseTime(startedAt);
    return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
  }
}
