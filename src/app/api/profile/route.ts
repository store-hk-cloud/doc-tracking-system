import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { getAuthContext, unauthorizedResponse } from '@/lib/supabase/auth-helpers';
import { getCashCapabilities } from '@/lib/permissions';

export async function GET() {
  try {
    const context = await getAuthContext();
    if (!context) return unauthorizedResponse();

    const supabase = getServiceSupabase();

    // Fetch profile and department in parallel
    const [{ data: profile }, { data: depts }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', context.user.id).single(),
      // code ต้องส่งไปให้ client ด้วย เพราะ nav/page gating ของโมดูลเงินสด
      // ตัดสินจาก department code ไม่ใช่ role (ดู src/lib/capabilities.ts)
      supabase.from('departments').select('id, name, code'),
    ]);

    if (!profile) {
      return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
    }

    const deptMap = new Map((depts || []).map((d: any) => [d.id, d.name]));
    const codeMap = new Map((depts || []).map((d: any) => [d.id, d.code]));
    const department_name = profile.department_id ? deptMap.get(profile.department_id) : undefined;
    const department_code = profile.department_id ? codeMap.get(profile.department_id) : undefined;

    // สิทธิ์ของโมดูลเงินสดคำนวณที่ server แล้วส่งเป็น boolean ให้ client
    // เพื่อไม่ให้ตรรกะรหัสแผนก (ซึ่งอยู่ใน app_settings) ถูกคัดลอกไปฝั่ง browser
    // client จึงไม่มีทางเห็นภาพสิทธิ์ที่ต่างจาก server
    const capabilities = await getCashCapabilities(context);

    return NextResponse.json({
      success: true,
      data: { ...profile, department_name, department_code, capabilities },
    });
  } catch (error: any) {
    console.error('[Profile API] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
