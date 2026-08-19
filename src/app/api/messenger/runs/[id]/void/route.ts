import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireCapability } from '@/lib/supabase/auth-helpers';
import { appendAudit, getActorName } from '@/lib/messenger-audit';

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

    const { data: job } = await supabase.from('messenger_jobs').select('*').eq('id', jobId).single();
    if (!job) return NextResponse.json({ success: false, error: 'ไม่พบงานนี้' }, { status: 404 });
    if (job.status === 'closed' || job.status === 'cancelled') {
      return NextResponse.json({ success: false, error: 'งานนี้ปิดแล้ว' }, { status: 409 });
    }

    const { data: deposit } = await supabase
      .from('bank_deposits')
      .select('*')
      .eq('job_id', jobId)
      .neq('status', 'voided')
      .maybeSingle();

    if (deposit) {
      const { error } = await supabase
        .from('bank_deposits')
        .update({ status: 'voided', void_reason: voidReason })
        .eq('id', deposit.id)
        .neq('status', 'voided');
      if (error) throw error;
    }

    const closerSignature = await getActorName(ctx.user.id, ctx.user.email);

    // งานที่ยังไม่ได้ฝากเงิน -> cancelled ได้ตรง ๆ
    // งานที่ฝากแล้ว -> ปิดเป็น closed พร้อมเหตุผล เพราะเงินเคลื่อนไปจริงแล้ว
    if (job.status === 'open' || job.status === 'picked_up') {
      await supabase
        .from('messenger_jobs')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: ctx.user.id,
          cancel_reason: voidReason,
        })
        .eq('id', jobId)
        .in('status', ['open', 'picked_up']);
    } else {
      await supabase
        .from('messenger_jobs')
        .update({
          status: 'closed',
          closed_at: new Date().toISOString(),
          closed_by: ctx.user.id,
          closer_signature: closerSignature,
        })
        .eq('id', jobId)
        .in('status', ['deposited', 'completed', 'pending_review']);
    }

    await appendAudit(ctx, {
      job_id: jobId,
      entity: 'deposit',
      entity_id: deposit?.id ?? jobId,
      action: 'void_run',
      from_status: job.status,
      to_status: 'voided',
      amount_satang: deposit?.actual_amount_satang ?? null,
      variance_satang: deposit?.variance_satang ?? null,
      reason: voidReason,
    }, request);

    return NextResponse.json({ success: true, data: { job_id: jobId, voided_deposit_id: deposit?.id ?? null } });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
