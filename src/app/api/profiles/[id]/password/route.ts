import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireRoles } from '@/lib/supabase/auth-helpers';

const MIN_PASSWORD_LENGTH = 8;

/**
 * POST /api/profiles/[id]/password — ตั้งรหัสผ่านใหม่ให้ผู้ใช้คนอื่น
 *
 * ทำไมต้องมี: บัญชีแมสเซนเจอร์ล็อกอินด้วยชื่อผู้ใช้ อีเมลเป็นของสังเคราะห์
 * (@msg.hillkoff.local) ส่งจริงไม่ได้ จึงไม่มีทางรีเซ็ตรหัสผ่านด้วยตัวเอง
 *
 * ทำไมจำกัดที่ super_admin: การตั้งรหัสผ่านให้คนอื่นเท่ากับเข้าใช้บัญชีนั้นแทนได้
 * ถ้าเปิดให้ role ธุรการทำได้ ผู้อนุมัติเงินเกิน (ธุรการใน 0-ADM03) จะสวมเป็น
 * แมสเซนเจอร์แล้วสร้างรายการรับ-ฝากเงินเองได้ ซึ่งทำลายการแยกหน้าที่ที่ trigger
 * assert_variance_approver บังคับไว้ทั้งหมด
 *
 * ทุกครั้งที่สำเร็จจะบันทึกลง admin_action_log ซึ่งเป็นตาราง append-only
 * (ไม่เก็บรหัสผ่าน เก็บแค่ว่าใครตั้งให้ใครเมื่อไหร่)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRoles(['super_admin']);
    if (auth.response) return auth.response;

    const { id } = await params;
    const supabase = getServiceSupabase();
    const body = await request.json().catch(() => ({}));

    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { success: false, error: `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร` },
        { status: 400 }
      );
    }

    const { data: target, error: targetError } = await supabase
      .from('profiles')
      .select('id, full_name, username, email, role, is_active')
      .eq('id', id)
      .single();
    if (targetError || !target) {
      return NextResponse.json({ success: false, error: 'ไม่พบผู้ใช้รายนี้' }, { status: 404 });
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(id, { password });
    if (updateError) throw updateError;

    // ลายเซ็นผู้กระทำอ่านจาก DB ไม่รับจาก body (กฎเดียวกับ messenger-audit)
    const { data: actor } = await supabase
      .from('profiles')
      .select('full_name, role')
      .eq('id', auth.context!.user.id)
      .single();

    const { error: logError } = await supabase.from('admin_action_log').insert({
      action: 'reset_password',
      target_profile_id: target.id,
      target_label: `${target.full_name} (${target.username || target.email})`,
      actor_id: auth.context!.user.id,
      actor_signature: actor?.full_name || auth.context!.user.email || 'ไม่ทราบชื่อ',
      actor_role: actor?.role || auth.context!.profile.role,
      request_ip:
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        request.headers.get('x-real-ip') ||
        null,
      user_agent: request.headers.get('user-agent'),
      // ห้ามใส่รหัสผ่านลงนี่
      detail: { login_kind: target.username ? 'username' : 'email', target_role: target.role },
    });
    // รหัสผ่านถูกเปลี่ยนไปแล้ว ย้อนกลับไม่ได้ — ถ้า log ล้มต้องเห็นใน server log
    // ไม่ใช่ตอบ error ให้ผู้ใช้กดซ้ำจนตั้งรหัสใหม่ทับไปเรื่อย ๆ
    if (logError) {
      console.error('[Profiles] บันทึก admin_action_log ไม่สำเร็จ:', logError);
    }

    return NextResponse.json({
      success: true,
      data: { id: target.id, full_name: target.full_name, logged: !logError },
    });
  } catch (error: any) {
    console.error('[Profiles] reset password error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
