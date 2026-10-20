import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { forbiddenResponse, requireCapability } from '@/lib/supabase/auth-helpers';

/**
 * POST /api/messenger/runs/[id]/void — ยกเลิกรายการฝากที่บันทึกผิด
 *
 * นี่คือทางเดียวที่ "แก้ยอด" ได้ และมันไม่ใช่การแก้: รายการเดิมถูกทำเครื่องหมาย
 * voided ไว้ตลอดกาล (ลบไม่ได้ ยอดเดิมยังอ่านได้) แล้วเปิดงานใหม่บันทึกยอดใหม่
 * เจตนาคือให้การแก้ยอดทิ้งร่องรอยเสมอ
 *
 * super_admin เท่านั้น — และแม้แต่ super_admin ก็ลบข้อมูลไม่ได้ (trigger บล็อก)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCapability({ roles: ['super_admin'] });
    if (auth.response) return auth.response;
    const ctx = auth.context!;

    const { id: jobId } = await params;
    const supabase = getServiceSupabase();
    const body = await request.json();

    const voidReason = String(body.void_reason || '').trim();
    if (voidReason.length < 10) {
      return NextResponse.json(
        { success: false, error: 'กรุณาระบุเหตุผลการยกเลิกอย่างน้อย 10 ตัวอักษร' },
        { status: 400 }
      );
    }

    // สถานะใบฝาก ทริป และ audit ต้อง commit พร้อมกัน หากส่วนหนึ่งล้มต้องยกเลิกทั้งหมด
    const forwarded = request.headers.get('x-forwarded-for');
    const { data, error } = await supabase.rpc('void_cash_run', {
      p_job_id: jobId,
      p_actor_id: ctx.user.id,
      p_reason: voidReason,
      p_request_ip: (forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip')) || null,
      p_user_agent: request.headers.get('user-agent')?.slice(0, 500) || null,
    });
    if (error) {
      if (error.message === 'void_forbidden') return forbiddenResponse();
      if (error.message === 'cash_job_not_found') {
        return NextResponse.json({ success: false, error: 'ไม่พบงานนี้' }, { status: 404 });
      }
      if (error.message === 'cash_job_already_processed') {
        return NextResponse.json({ success: false, error: 'งานนี้ปิดแล้ว กรุณาโหลดข้อมูลล่าสุด' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
