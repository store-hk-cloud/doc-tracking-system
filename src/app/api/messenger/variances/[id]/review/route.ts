import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireCapability, forbiddenResponse } from '@/lib/supabase/auth-helpers';
import { canApproveOverage, canCloseShortage } from '@/lib/permissions';
import { appendAudit, getActorName } from '@/lib/messenger-audit';
import { formatSatangToBaht } from '@/lib/money';
import { notifyDepartment } from '@/lib/upstash';

/**
 * POST /api/messenger/variances/[id]/review — ฝ่ายการเงินตัดสินผลต่าง
 *
 * นี่คือประตูเดียวที่ปิดงานยอดไม่ตรงได้ เงินขาดและเงินเกินใช้กติกาเดียวกัน
 * (สำคัญเท่ากันทั้งคู่) และเป็นกติกาที่เข้มกว่าของเดิม — ถูกบังคับ 4 ชั้น:
 *   1. capability ที่ route นี้ — ต้องเป็น admin ในแผนกผู้อนุมัติ หรือ super_admin
 *   2. conditional update `.eq('status','pending_review')` กันสองคนกดชนกัน
 *   3. CHECK bank_deposits_variance_lock — ผลต่างทุกทิศทางไปสถานะจบไม่ได้
 *      ถ้าไม่มีใบอนุมัติ (+ 014 ตรวจว่าใบอนุมัตินั้นเป็นของรายการนี้จริง)
 *   4. TRIGGER assert_variance_approver — อ่าน role/dept สด ๆ จาก DB
 *      + บล็อกการอนุมัติงานตัวเอง ครอบทุกจุดรับของทริป (segregation of duties)
 * สองชั้นล่างอยู่ใน DB จึงยังทำงานแม้ route นี้ถูกแก้หรือถูกข้าม
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCapability({});
    if (auth.response) return auth.response;
    const ctx = auth.context!;

    const { id: reportId } = await params;
    const supabase = getServiceSupabase();
    const body = await request.json();

    const decision = String(body.decision || '');
    if (!['approved', 'rejected', 'returned'].includes(decision)) {
      return NextResponse.json({ success: false, error: 'ผลการตัดสินไม่ถูกต้อง' }, { status: 400 });
    }
    const reason = String(body.reason || '').trim();
    if (reason.length < 10) {
      return NextResponse.json(
        { success: false, error: 'กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร' },
        { status: 400 }
      );
    }
    if (body.slip_checked !== true) {
      return NextResponse.json(
        { success: false, error: 'กรุณายืนยันว่าได้เปิดรูปใบนำฝากเทียบยอดแล้ว' },
        { status: 400 }
      );
    }

    const { data: report } = await supabase
      .from('cash_variance_reports')
      .select('*, bank_deposits!inner(*)')
      .eq('id', reportId)
      .single();
    if (!report) {
      return NextResponse.json({ success: false, error: 'ไม่พบรายงานผลต่างนี้' }, { status: 404 });
    }
    if (report.status !== 'pending_review') {
      return NextResponse.json(
        { success: false, error: 'รายงานนี้ถูกตัดสินไปแล้ว' },
        { status: 409 }
      );
    }

    const deposit = report.bank_deposits;
    const isOverage = report.variance_kind === 'over';

    // ── สิทธิ์: ทั้งเงินขาดและเงินเกินต้องเป็น super_admin หรือ admin ในแผนกผู้อนุมัติ ──
    // สองฟังก์ชันนี้คืนค่าเท่ากันตั้งใจ (ดู lib/permissions.ts) เรียกตามชนิดผลต่าง
    // เพื่อให้ถ้าวันหนึ่งแยกกติกากันอีก จุดนี้ไม่ต้องแก้
    if (isOverage ? !(await canApproveOverage(ctx)) : !(await canCloseShortage(ctx))) {
      return forbiddenResponse();
    }

    // แยกหน้าที่ — เช็คที่นี่เพื่อให้ได้ข้อความไทยที่อ่านรู้เรื่อง
    // (trigger ใน DB บล็อกซ้ำอีกชั้นด้วยข้อความภาษาอังกฤษ)
    // ต้องดึง **ทุกจุดรับ** ของทริป ไม่ใช่ maybeSingle() — ทริปหนึ่งมีได้หลายสาขา
    // ถ้าดึงใบเดียว แคชเชียร์ของจุดที่ 2 จะผ่านการตรวจนี้ไปได้
    const { data: pickups } = await supabase
      .from('cash_pickups')
      .select('received_by, cashier_profile_id')
      .eq('job_id', deposit.job_id);
    const conflicted = [
      deposit.submitted_by,
      report.reported_by,
      ...(pickups || []).map((p: any) => p.received_by),
      ...(pickups || []).map((p: any) => p.cashier_profile_id),
    ].filter(Boolean);
    if (conflicted.includes(ctx.user.id)) {
      return NextResponse.json(
        { success: false, error: 'คุณเกี่ยวข้องกับเงินก้อนนี้ จึงไม่สามารถเป็นผู้อนุมัติได้' },
        { status: 403 }
      );
    }

    if (decision === 'approved' && !deposit.slip_photo_id) {
      return NextResponse.json(
        { success: false, error: 'รายการนี้ยังไม่ได้แนบรูปใบนำฝาก ไม่สามารถอนุมัติได้' },
        { status: 409 }
      );
    }

    const reviewerSignature = await getActorName(ctx.user.id, ctx.user.email);

    // review, report, deposit และ job ต้อง commit/rollback พร้อมกัน มิฉะนั้น
    // review ที่บันทึกแล้วอาจล็อกรายงานไว้ทั้งที่งานยังปิดไม่สำเร็จ
    const { data: transaction, error: reviewError } = await supabase.rpc('review_cash_variance', {
      p_report_id: reportId,
      p_decision: decision,
      p_reason: reason,
      p_actor_id: ctx.user.id,
      p_reviewer_signature: reviewerSignature,
    });
    if (reviewError || !transaction) {
      const message = reviewError?.message || 'บันทึกการตัดสินไม่สำเร็จ';
      const alreadyDecided = /is already|variance_report_not_pending|variance_job_not_pending/.test(message);
      const forbidden = /only |cannot review|reviewer .* active|cannot approve/.test(message);
      return NextResponse.json(
        { success: false, error: alreadyDecided ? 'รายงานนี้ถูกตัดสินไปแล้ว' : message },
        { status: alreadyDecided ? 409 : forbidden ? 403 : 500 }
      );
    }
    const review = (transaction as any).review;

    await appendAudit(ctx, {
      job_id: deposit.job_id,
      entity: 'variance_review',
      entity_id: review.id,
      action: `review_${report.variance_kind}_${decision}`,
      from_status: 'pending_review',
      to_status: decision,
      amount_satang: deposit.actual_amount_satang,
      variance_satang: deposit.variance_satang,
      reason,
      payload: {
        report_id: reportId,
        deposit_id: deposit.id,
        variance_kind: report.variance_kind,
        reviewer_dept_code: ctx.profile.department_code,
      },
    }, request);

    // แจ้งแมสเซนเจอร์ผ่านแผนกของตัวเอง
    const { data: submitter } = await supabase
      .from('profiles')
      .select('department_id')
      .eq('id', deposit.submitted_by)
      .single();
    if (submitter?.department_id) {
      const { data: job } = await supabase
        .from('messenger_jobs')
        .select('job_no')
        .eq('id', deposit.job_id)
        .single();
      await notifyDepartment(submitter.department_id, {
        title:
          decision === 'approved'
            ? 'ผลต่างได้รับการอนุมัติ ปิดงานแล้ว'
            : decision === 'rejected'
              ? 'ผลต่างไม่ได้รับการอนุมัติ'
              : 'รายงานผลต่างถูกตีกลับให้แก้',
        body: `ผลต่าง ${formatSatangToBaht(Math.abs(deposit.variance_satang))} บาท · ผู้ตัดสิน ${reviewerSignature}`,
        docId: deposit.job_id,
        runningNo: job?.job_no ?? 0,
      });
    }

    // สถานะรายงานถูก trigger ตั้งเป็น decision ไปแล้ว
    return NextResponse.json({
      success: true,
      data: { review, report: { ...(report as any), bank_deposits: undefined, status: decision } },
    });
  } catch (error: any) {
    console.error('[Variance Review] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
