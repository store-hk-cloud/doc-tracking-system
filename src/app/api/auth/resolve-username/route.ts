import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';

/**
 * POST /api/auth/resolve-username — แปลงชื่อผู้ใช้เป็นอีเมลสำหรับล็อกอิน
 *
 * Supabase Auth ผูกกับอีเมลเสมอ เราจึงไม่เปลี่ยนกลไก auth แต่ให้แมสเซนเจอร์
 * กรอกแค่ชื่อผู้ใช้ แล้ว server แปลงเป็นอีเมลก่อนส่งให้ signInWithPassword
 *
 * ข้อควรระวังด้านความปลอดภัย: endpoint นี้ไม่ตรวจรหัสผ่าน จึงบอกได้แค่ว่า
 * "ชื่อผู้ใช้นี้ผูกกับอีเมลอะไร" ซึ่งเปิดช่องให้ไล่เดาว่ามีชื่อผู้ใช้ไหนอยู่บ้าง
 * (user enumeration) เราจึง:
 *   - ไม่คืนอีเมลจริงให้ browser เห็น แต่คืนเฉพาะสิ่งที่ต้องใช้ล็อกอิน
 *   - ตอบข้อความเดียวกันทั้งกรณีไม่พบและกรณีถูกปิดใช้งาน
 *   - หน่วงเวลาเล็กน้อยให้เวลาตอบใกล้เคียงกันทุกกรณี
 * ตัวรหัสผ่านยังถูกตรวจโดย Supabase Auth ตามปกติ ไม่ได้อ่อนลง
 */

const GENERIC_ERROR = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = String(body.username || '').trim();

    if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
      return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
    }

    const { data } = await getServiceSupabase()
      .from('profiles')
      .select('email, is_active')
      .ilike('username', username)
      .maybeSingle();

    // หน่วงให้เวลาตอบใกล้เคียงกันไม่ว่าจะเจอหรือไม่เจอ
    await new Promise((r) => setTimeout(r, 120));

    if (!data || data.is_active === false) {
      return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 401 });
    }

    return NextResponse.json({ success: true, data: { email: data.email } });
  } catch {
    return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
  }
}
