import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireCapability, forbiddenResponse } from '@/lib/supabase/auth-helpers';
import { appendAudit, getActorName } from '@/lib/messenger-audit';
import { classifyVariance, formatSatangToBaht } from '@/lib/money';
import { financeDepartmentIds } from '@/lib/messenger-data';
import { notifyDepartment } from '@/lib/upstash';

const CAUSE_CODES = [
  'bank_fee',
  'miscount_at_pickup',
  'damaged_note_rejected',
  'mixed_envelope',
  'wrong_account',
  'other',
] as const;

/**
 * POST /api/messenger/runs/[id]/variance-report — SCREEN 3 รายงานเงินขาด/เกิน
 *
 * ผลต่างเป็น Auto-calculate: client ส่งค่ามาไม่ได้ เราอ่านจาก
 * bank_deposits.variance_satang (generated column) แล้ว trigger
 * assert_variance_snapshot ตรวจซ้ำอีกชั้นตอน insert
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCapability({});
    if (auth.response) return auth.response;
    const ctx = auth.context!;

    const { id: jobId } = await params;
    const supabase = getServiceSupabase();
    const body = await request.json();

    const { data: deposit } = await supabase
      .from('bank_deposits')
      .select('*')
      .eq('job_id', jobId)
      .neq('status', 'voided')
      .maybeSingle();
    if (!deposit) {
      return NextResponse.json({ success: false, error: 'ไม่พบรายการฝากเงินของงานนี้' }, { status: 404 });
    }
    if (deposit.submitted_by !== ctx.user.id) return forbiddenResponse();

    const variance = deposit.variance_satang as number;
    const kind = classifyVariance(variance);
    if (kind === 'match') {
      return NextResponse.json(
        { success: false, error: 'ยอดตรงกันอยู่แล้ว ไม่ต้องทำรายงานผลต่าง' },
        { status: 400 }
      );
    }

    const causeCode = String(body.cause_code || '');
    if (!CAUSE_CODES.includes(causeCode as any)) {
      return NextResponse.json({ success: false, error: 'กรุณาเลือกสาเหตุเบื้องต้น' }, { status: 400 });
    }
    const causeDetail = String(body.cause_detail || '').trim();
    if (causeDetail.length < 10) {
      return NextResponse.json(
        { success: false, error: 'กรุณาอธิบายรายละเอียดอย่างน้อย 10 ตัวอักษร' },
        { status: 400 }
      );
    }

    // มีรายงานที่ยังไม่ถูกตีกลับอยู่แล้ว = ส่งซ้ำไม่ได้
    const { data: existing } = await supabase
      .from('cash_variance_reports')
      .select('id, status')
      .eq('deposit_id', deposit.id)
      .neq('status', 'returned')
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'ส่งรายงานผลต่างของรายการนี้ไปแล้ว' },
        { status: 409 }
      );
    }

    const reporterSignature = await getActorName(ctx.user.id, ctx.user.email);

    const { data: report, error } = await supabase
      .from('cash_variance_reports')
      .insert({
        deposit_id: deposit.id,
        variance_satang_snapshot: variance,
        variance_kind: kind,
        cause_code: causeCode,
        cause_detail: causeDetail,
        reported_by: ctx.user.id,
        reporter_signature: reporterSignature,
        status: 'pending_review',
      })
      .select()
      .single();
    if (error) throw error;

    await appendAudit(ctx, {
      job_id: jobId,
      entity: 'variance_report',
      entity_id: report.id,
      action: `report_${kind}`,
      to_status: 'pending_review',
      amount_satang: deposit.actual_amount_satang,
      variance_satang: variance,
      reason: causeDetail,
      payload: { cause_code: causeCode },
    }, request);

    // แจ้งฝ่ายการเงิน/บัญชีทันที — real-time notification ตาม flow
    const financeDepts = await financeDepartmentIds();
    const { data: job } = await supabase
      .from('messenger_jobs')
      .select('job_no')
      .eq('id', jobId)
      .single();
    await Promise.all(
      financeDepts.map((deptId) =>
        notifyDepartment(deptId, {
          title: kind === 'over' ? '🚨 รายงานเงินเกิน รออนุมัติ' : '⚠️ รายงานเงินขาด รอตรวจสอบ',
          body: `ผลต่าง ${formatSatangToBaht(Math.abs(variance))} บาท · ผู้รายงาน ${reporterSignature}`,
          docId: jobId,
          runningNo: job?.job_no ?? 0,
        })
      )
    );

    return NextResponse.json({ success: true, data: report });
  } catch (error: any) {
    console.error('[Variance Report] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
