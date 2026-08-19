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
 * นี่คือประตูเดียวที่ปิดงานยอดไม่ตรงได้ และเป็นจุดที่กฎ "เงินเกินเข้มกว่าเงินขาด"
 * ถูกบังคับ 4 ชั้น:
 *   1. capability ที่ route นี้ (canApproveOverage vs canCloseShortage)
 *   2. conditional update `.eq('status','pending_review')` กันสองคนกดชนกัน
 *   3. CHECK bank_deposits_overage_lock — เงินเกินไปสถานะจบไม่ได้ถ้าไม่มีใบอนุมัติ
 *   4. TRIGGER assert_variance_approver — อ่าน role/dept สด ๆ จาก DB
 *      + บล็อกการอนุมัติงานตัวเอง (segregation of duties)
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

    // ── สิทธิ์: เงินเกินต้องเป็น super_admin หรือ admin ในแผนก FIN เท่านั้น ──
    if (isOverage ? !(await canApproveOverage(ctx)) : !(await canCloseShortage(ctx))) {
      return forbiddenResponse();
    }

    // แยกหน้าที่ — เช็คที่นี่เพื่อให้ได้ข้อความไทยที่อ่านรู้เรื่อง
    // (trigger ใน DB บล็อกซ้ำอีกชั้นด้วยข้อความภาษาอังกฤษ)
    const { data: pickup } = await supabase
      .from('cash_pickups')
      .select('received_by, cashier_profile_id')
      .eq('job_id', deposit.job_id)
      .maybeSingle();
    const conflicted = [
      deposit.submitted_by,
      report.reported_by,
      pickup?.received_by,
      pickup?.cashier_profile_id,
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

    // ── บันทึกการตัดสิน ──
    // trigger assert_variance_approver ทำทั้งการตรวจ (role/dept/segregation/snapshot)
    // และการปิดรายงานในคำสั่งเดียว โดย SELECT ... FOR UPDATE ทำให้คำขอที่ชนกัน
    // เข้าคิว คนที่สองจะเจอรายงานที่ไม่ใช่ pending_review แล้วถูกปฏิเสธ
    // จึงไม่ต้อง (และต้องไม่) flip สถานะรายงานจากฝั่ง route ก่อน
    const { data: review, error: reviewError } = await supabase
      .from('cash_variance_reviews')
      .insert({
        report_id: reportId,
        decision,
        variance_satang_at_decision: deposit.variance_satang,
        actual_amount_satang_at_decision: deposit.actual_amount_satang,
        reason,
        slip_checked: true,
        reviewed_by: ctx.user.id,
        reviewer_signature: reviewerSignature,
        // reviewer_role / reviewer_dept_code ถูกเขียนโดย trigger จากค่าใน DB
        reviewer_role: ctx.profile.role,
        reviewer_dept_code: ctx.profile.department_code,
      })
      .select()
      .single();

    if (reviewError) {
      // trigger ปฏิเสธ แปลว่ารายงานไม่ถูกแตะเลย (การ insert ทั้งชุดล้มพร้อมกัน)
      // จึงไม่ต้องคืนสถานะอะไร
      const alreadyDecided = /is already/.test(reviewError.message || '');
      return NextResponse.json(
        { success: false, error: alreadyDecided ? 'รายงานนี้ถูกตัดสินไปแล้ว' : reviewError.message },
        { status: alreadyDecided ? 409 : 403 }
      );
    }

    // ── ปลดล็อกรายการฝากและปิดงาน ──
    if (decision === 'approved') {
      const { error: depError } = await supabase
        .from('bank_deposits')
        .update({ status: 'variance_resolved', resolved_review_id: review.id })
        .eq('id', deposit.id)
        .eq('status', 'variance_pending');
      if (depError) throw depError;

      await supabase
        .from('messenger_jobs')
        .update({
          status: 'closed',
          closed_at: new Date().toISOString(),
          closed_by: ctx.user.id,
          closer_signature: reviewerSignature,
        })
        .eq('id', deposit.job_id)
        .eq('status', 'pending_review');
    } else if (decision === 'rejected') {
      // ไม่อนุมัติ: ปิดงานแต่ทำเครื่องหมายไว้ว่าผลต่างไม่ได้รับการยอมรับ
      // deposit ยังค้างที่ variance_pending เป็นหลักฐานว่าเรื่องยังไม่จบทางบัญชี
      await supabase
        .from('messenger_jobs')
        .update({
          status: 'closed',
          closed_at: new Date().toISOString(),
          closed_by: ctx.user.id,
          closer_signature: reviewerSignature,
        })
        .eq('id', deposit.job_id)
        .eq('status', 'pending_review');
    } else {
      // ตีกลับให้แมสเซนเจอร์แก้รายงาน — งานกลับไปที่ picked_up ไม่ได้เพราะเงินฝากแล้ว
      // จึงคงไว้ที่ pending_review และให้ยื่นรายงานใหม่ได้ (unique index ยกเว้น returned)
      await supabase
        .from('messenger_jobs')
        .update({ status: 'pending_review' })
        .eq('id', deposit.job_id);
    }

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
