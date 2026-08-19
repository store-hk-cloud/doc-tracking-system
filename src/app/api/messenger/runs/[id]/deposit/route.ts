import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireCapability, forbiddenResponse } from '@/lib/supabase/auth-helpers';
import { appendAudit, getActorName } from '@/lib/messenger-audit';
import { MoneyParseError, classifyVariance, formatSatangToBaht, parseBahtToSatang } from '@/lib/money';
import { financeDepartmentIds } from '@/lib/messenger-data';
import { notifyDepartment } from '@/lib/upstash';

/**
 * POST /api/messenger/runs/[id]/deposit — SCREEN 2 นำฝากธนาคาร + Decision เทียบยอด
 *
 * `variance_satang` เป็น GENERATED column ใน DB (actual - expected) โค้ดที่นี่
 * แค่อ่านผลลัพธ์มาตัดสินเส้นทาง ไม่ได้คำนวณเอง DB จึงเป็นเจ้าของความจริงเรื่องผลต่าง
 *
 * สำคัญ: รูปใบนำฝากเป็นตัวเลือก **ตอนบันทึก** แต่บังคับ **ตอนปิดงาน**
 * เพราะเงินออกไปแล้วจริง ถ้าผูกยอดเงินไว้กับการอัปรูป (ครึ่งเมกะไบต์บน 3G)
 * แล้วรูปล้ม = ยอดเงินไม่ถูกบันทึกเลย ซึ่งเป็นผลลัพธ์ที่แย่ที่สุด
 * ทางเลี่ยงถูกปิดด้วย CHECK bank_deposits_final_needs_slip + trigger ตอนอนุมัติ
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCapability({});
    if (auth.response) return auth.response;
    const ctx = auth.context!;

    const { id: jobId } = await params;
    const supabase = getServiceSupabase();
    const body = await request.json();

    const { data: job } = await supabase.from('messenger_jobs').select('*').eq('id', jobId).single();
    if (!job) return NextResponse.json({ success: false, error: 'ไม่พบงานนี้' }, { status: 404 });
    if (job.assigned_to !== ctx.user.id) return forbiddenResponse();

    const { data: pickup } = await supabase
      .from('cash_pickups')
      .select('*')
      .eq('job_id', jobId)
      .maybeSingle();
    if (!pickup) {
      return NextResponse.json(
        { success: false, error: 'ต้องบันทึกการรับเงินจากแคชเชียร์ก่อน' },
        { status: 409 }
      );
    }

    // ── ตรวจ input ──
    let actualSatang: number;
    try {
      actualSatang = parseBahtToSatang(body.actual_amount);
    } catch (e) {
      const message = e instanceof MoneyParseError ? e.message : 'จำนวนเงินไม่ถูกต้อง';
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }

    const referenceNo = String(body.reference_no || '').trim();
    if (!referenceNo) {
      return NextResponse.json({ success: false, error: 'กรุณากรอกเลขที่ใบนำฝาก' }, { status: 400 });
    }
    const bankBranchName = String(body.bank_branch_name || '').trim();
    if (!body.bank_id || !bankBranchName) {
      return NextResponse.json(
        { success: false, error: 'กรุณาเลือกธนาคารและระบุสาขา/สถานที่ที่ฝาก' },
        { status: 400 }
      );
    }
    const { data: bank } = await supabase
      .from('approved_banks')
      .select('id, name, is_active')
      .eq('id', body.bank_id)
      .single();
    if (!bank || !bank.is_active) {
      return NextResponse.json(
        { success: false, error: 'ธนาคารนี้ไม่อยู่ในรายชื่อที่บริษัทอนุมัติ' },
        { status: 400 }
      );
    }

    // รูปใบนำฝาก (ถ้ามีตอนนี้) ต้องเป็นของงานนี้และชนิด deposit_slip
    let slipPhotoId: string | null = null;
    if (body.slip_photo_id) {
      const { data: photo } = await supabase
        .from('messenger_job_photos')
        .select('id, job_id, photo_kind')
        .eq('id', body.slip_photo_id)
        .single();
      if (!photo || photo.job_id !== jobId || photo.photo_kind !== 'deposit_slip') {
        return NextResponse.json(
          { success: false, error: 'รูปใบนำฝากไม่ถูกต้องหรือไม่ใช่ของงานนี้' },
          { status: 400 }
        );
      }
      slipPhotoId = photo.id;
    }

    const submittedSignature = await getActorName(ctx.user.id, ctx.user.email);
    const depositedAt = body.deposited_at || new Date().toISOString();

    // ── ย้ายสถานะงานก่อน: ยิงซ้ำสองครั้งเพื่อชนกันแล้วเลือกยอดที่ต่ำกว่า จะแพ้ที่นี่ ──
    const { data: movedJob, error: moveError } = await supabase
      .from('messenger_jobs')
      .update({ status: 'deposited', deposited_at: depositedAt })
      .eq('id', jobId)
      .eq('assigned_to', ctx.user.id)
      .eq('status', 'picked_up')
      .select()
      .single();
    if (moveError || !movedJob) {
      return NextResponse.json(
        { success: false, error: 'งานนี้บันทึกการฝากเงินไปแล้ว' },
        { status: 409 }
      );
    }

    // expected_total ถูก trigger assert_expected_matches_pickups ตรวจซ้ำกับ
    // ผลรวม pay-in จริงใน DB ส่งค่าปลอมมาไม่ได้
    const { data: deposit, error: depositError } = await supabase
      .from('bank_deposits')
      .insert({
        job_id: jobId,
        status: 'recorded',
        bank_id: bank.id,
        bank_branch_name: bankBranchName,
        expected_total_satang: pickup.payin_amount_satang,
        actual_amount_satang: actualSatang,
        reference_no: referenceNo,
        slip_photo_id: slipPhotoId,
        slip_status: slipPhotoId ? 'attached' : 'pending',
        deposited_at: depositedAt,
        submitted_by: ctx.user.id,
        submitted_signature: submittedSignature,
      })
      .select()
      .single();

    if (depositError) {
      // rollback สถานะงานเพื่อให้ผู้ใช้กรอกใหม่ได้ ไม่ค้างอยู่ในสถานะ deposited
      // ที่ไม่มี deposit จริง (ไม่มี transaction ข้าม HTTP ได้กับ supabase-js)
      await supabase
        .from('messenger_jobs')
        .update({ status: 'picked_up', deposited_at: null })
        .eq('id', jobId)
        .eq('status', 'deposited');
      const duplicateRef = /uq_bank_deposits_ref/.test(depositError.message || '');
      return NextResponse.json(
        {
          success: false,
          error: duplicateRef
            ? 'เลขที่ใบนำฝากนี้ถูกบันทึกไปแล้วกับธนาคารเดียวกัน'
            : depositError.message,
        },
        { status: duplicateRef ? 409 : 500 }
      );
    }

    await supabase.from('cash_pickups').update({ deposit_id: deposit.id }).eq('id', pickup.id);

    // ── Decision: ยอดตรงหรือไม่ (อ่านจาก generated column) ──
    const variance = deposit.variance_satang as number;
    const kind = classifyVariance(variance);

    await appendAudit(ctx, {
      job_id: jobId,
      entity: 'deposit',
      entity_id: deposit.id,
      action: 'record_deposit',
      from_status: 'picked_up',
      to_status: 'deposited',
      amount_satang: actualSatang,
      variance_satang: variance,
      payload: {
        bank_id: bank.id,
        bank_branch_name: bankBranchName,
        expected_total_satang: pickup.payin_amount_satang,
        slip_status: deposit.slip_status,
        variance_kind: kind,
      },
    }, request);

    const financeDepts = await financeDepartmentIds();

    if (kind === 'match') {
      // ยอดตรง -> ปิดงานอัตโนมัติ (deposit ไป matched ได้ต่อเมื่อมีรูปแล้ว
      // ตาม CHECK bank_deposits_final_needs_slip ถ้ายังรอรูปจะค้างที่ recorded)
      if (deposit.slip_photo_id) {
        await supabase
          .from('bank_deposits')
          .update({ status: 'matched' })
          .eq('id', deposit.id)
          .eq('status', 'recorded');
      }
      await supabase
        .from('messenger_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('status', 'deposited');

      await Promise.all(
        financeDepts.map((deptId) =>
          notifyDepartment(deptId, {
            title: 'ฝากเงินสำเร็จ ยอดตรง',
            body: `${formatSatangToBaht(actualSatang)} บาท · ${bank.name} · ผู้ฝาก ${submittedSignature}`,
            docId: jobId,
            runningNo: job.job_no,
          })
        )
      );

      return NextResponse.json({
        success: true,
        data: { deposit, variance_kind: kind, requires_variance_report: false },
      });
    }

    // ── ยอดไม่ตรง -> ต้องทำ Cash Variance Report ก่อน ปิดเองไม่ได้ ──
    await supabase
      .from('bank_deposits')
      .update({ status: 'variance_pending' })
      .eq('id', deposit.id)
      .eq('status', 'recorded');
    await supabase
      .from('messenger_jobs')
      .update({ status: 'pending_review' })
      .eq('id', jobId)
      .eq('status', 'deposited');

    await Promise.all(
      financeDepts.map((deptId) =>
        notifyDepartment(deptId, {
          title: kind === 'over' ? '🚨 เงินเกิน — ถูกล็อกรออนุมัติ' : '⚠️ เงินขาด — รอตรวจสอบ',
          body: `ผลต่าง ${formatSatangToBaht(Math.abs(variance))} บาท · ${bank.name} · ผู้ฝาก ${submittedSignature}`,
          docId: jobId,
          runningNo: job.job_no,
        })
      )
    );

    return NextResponse.json({
      success: true,
      data: { deposit, variance_kind: kind, requires_variance_report: true },
    });
  } catch (error: any) {
    console.error('[Messenger Deposit] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/messenger/runs/[id]/deposit — แนบรูปใบนำฝากที่อัปไม่สำเร็จตอนแรก
 *
 * นี่คือขาที่สองของการแยกธุรกรรม "บันทึกยอด" กับ "แนบรูป"
 * แนบได้ครั้งเดียว (trigger บล็อกการเปลี่ยนรูป) และ **ไม่มีทางแก้ยอดผ่าน route นี้**
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCapability({});
    if (auth.response) return auth.response;
    const ctx = auth.context!;

    const { id: jobId } = await params;
    const supabase = getServiceSupabase();
    const body = await request.json();

    if (!body.slip_photo_id) {
      return NextResponse.json({ success: false, error: 'กรุณาระบุรูปใบนำฝาก' }, { status: 400 });
    }

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
    if (deposit.slip_photo_id) {
      return NextResponse.json(
        { success: false, error: 'รายการนี้แนบรูปใบนำฝากแล้ว ไม่สามารถเปลี่ยนรูปได้' },
        { status: 409 }
      );
    }

    const { data: photo } = await supabase
      .from('messenger_job_photos')
      .select('id, job_id, photo_kind')
      .eq('id', body.slip_photo_id)
      .single();
    if (!photo || photo.job_id !== jobId || photo.photo_kind !== 'deposit_slip') {
      return NextResponse.json(
        { success: false, error: 'รูปใบนำฝากไม่ถูกต้องหรือไม่ใช่ของงานนี้' },
        { status: 400 }
      );
    }

    const { data: updated, error } = await supabase
      .from('bank_deposits')
      .update({ slip_photo_id: photo.id, slip_status: 'attached' })
      .eq('id', deposit.id)
      .is('slip_photo_id', null)
      .select()
      .single();
    if (error || !updated) {
      return NextResponse.json(
        { success: false, error: error?.message || 'แนบรูปไม่สำเร็จ' },
        { status: 409 }
      );
    }

    // ยอดตรงและตอนนี้มีรูปแล้ว -> ปิดรายการฝากได้
    if (updated.variance_satang === 0) {
      await supabase
        .from('bank_deposits')
        .update({ status: 'matched' })
        .eq('id', updated.id)
        .eq('status', 'recorded');
    }

    await appendAudit(ctx, {
      job_id: jobId,
      entity: 'deposit',
      entity_id: updated.id,
      action: 'attach_slip',
      amount_satang: updated.actual_amount_satang,
      variance_satang: updated.variance_satang,
      payload: { photo_id: photo.id },
    }, request);

    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
