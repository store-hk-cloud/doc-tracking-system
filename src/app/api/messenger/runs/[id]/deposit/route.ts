import { NextRequest, NextResponse } from 'next/server';
import { escapeLikePattern, getServiceSupabase } from '@/lib/supabase/admin';
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

    // การรวมยอดและผูก pickup ต้องทำใต้ล็อกเดียวกับการสร้างใบฝาก เพื่อไม่ให้
    // คำขอรับซองอีกชุดแทรกระหว่างคำนวณยอดกับการฝาก

    // ── ตรวจ input ──
    let actualSatang: number;
    try {
      actualSatang = parseBahtToSatang(body.actual_amount);
    } catch (e) {
      const message = e instanceof MoneyParseError ? e.message : 'จำนวนเงินไม่ถูกต้อง';
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }

    // เลขที่ใบนำฝาก: หลักฐานการฝากบางแบบไม่มีเลขรันมาให้ (ใบ Pay-in ไม่มี)
    // ถ้าไม่กรอก ระบบออกเลขให้เอง และบันทึกไว้ว่าเลขนี้ "ระบบออก" ไม่ใช่ของธนาคาร
    // การแยกนี้สำคัญ เพราะเลขที่ระบบออกเอาไปกระทบยอดกับ statement ธนาคารไม่ได้
    let referenceNo = String(body.reference_no || '').trim();
    let referenceNoSource: 'bank' | 'auto' = 'bank';
    if (!referenceNo) {
      const { data: autoRef, error: refError } = await supabase.rpc('next_deposit_auto_ref');
      if (refError || !autoRef) {
        return NextResponse.json(
          { success: false, error: 'ออกเลขอ้างอิงอัตโนมัติไม่สำเร็จ กรุณากรอกเลขที่ใบนำฝากเอง' },
          { status: 500 }
        );
      }
      referenceNo = String(autoRef);
      referenceNoSource = 'auto';
    }
    if (!body.bank_id) {
      return NextResponse.json({ success: false, error: 'กรุณาเลือกธนาคาร' }, { status: 400 });
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

    // สาขาธนาคาร: เลือกจากรายชื่อกลางเป็นเส้นทางปกติ แต่พิมพ์เองได้ถ้าสาขานั้น
    // ยังไม่มีในรายชื่อ — ห้ามบล็อกการบันทึก เพราะเงินออกไปแล้วจริง
    // (trigger assert_bank_branch_matches_bank ตรวจซ้ำว่าสาขาเป็นของธนาคารนี้)
    let bankBranchId: string | null = null;
    let bankBranchName = String(body.bank_branch_name || '').trim();
    if (body.bank_branch_id) {
      const { data: bankBranch } = await supabase
        .from('bank_branches')
        .select('id, bank_id, name, is_active')
        .eq('id', body.bank_branch_id)
        .maybeSingle();
      if (!bankBranch || !bankBranch.is_active || bankBranch.bank_id !== bank.id) {
        return NextResponse.json(
          { success: false, error: 'สาขาธนาคารที่เลือกไม่ถูกต้องหรือไม่ใช่สาขาของธนาคารนี้' },
          { status: 400 }
        );
      }
      bankBranchId = bankBranch.id;
      // เก็บสำเนาชื่อไว้ด้วย เพื่อให้หลักฐานอ่านได้แม้รายชื่อกลางถูกแก้ภายหลัง
      bankBranchName = bankBranch.name;
    }
    if (!bankBranchName) {
      return NextResponse.json(
        { success: false, error: 'กรุณาเลือกสาขาธนาคาร หรือพิมพ์ชื่อสาขาที่ไปฝาก' },
        { status: 400 }
      );
    }

    // พิมพ์ชื่อสาขาใหม่ = เพิ่มเข้ารายชื่อกลางให้เลย แล้วผูกรายการนี้กับสาขานั้น
    //
    // แมสเซนเจอร์เป็นผู้ดูแลรายชื่อสาขาธนาคาร (เป็นคนเดียวที่รู้ว่าไปฝากที่ไหนจริง)
    // การให้ "พิมพ์แล้วเข้ารายชื่อเอง" ดีกว่าให้ไปเพิ่มในหน้าตั้งค่าก่อนแล้วค่อย
    // กลับมาบันทึก เพราะตอนอยู่หน้าเคาน์เตอร์ทุกขั้นที่เพิ่มคือโอกาสที่เงินจะ
    // ฝากไปแล้วแต่ยังไม่เข้าระบบ
    //
    // unique index (bank_id, lower(btrim(name))) กันชื่อซ้ำอยู่แล้ว ถ้าชนแปลว่า
    // มีสาขานี้อยู่ก่อน ให้ผูกกับของเดิมแทนการสร้างใหม่
    let bankBranchCreated = false;
    if (!bankBranchId) {
      const { data: existing } = await supabase
        .from('bank_branches')
        .select('id, name')
        .eq('bank_id', bank.id)
        .ilike('name', escapeLikePattern(bankBranchName))
        .maybeSingle();
      if (existing) {
        bankBranchId = existing.id;
        bankBranchName = existing.name;
      } else {
        const { data: created, error: createError } = await supabase
          .from('bank_branches')
          .insert({ bank_id: bank.id, name: bankBranchName, is_active: true })
          .select('id, name')
          .single();
        if (created) {
          bankBranchId = created.id;
          bankBranchName = created.name;
          bankBranchCreated = true;
        } else {
          // เพิ่มรายชื่อไม่สำเร็จก็ไม่หยุด — บันทึกเงินสำคัญกว่าความสะอาดของรายชื่อ
          // รายการนี้จะมี bank_branch_id เป็น NULL ให้ตามเก็บภายหลังได้
          console.error('[Messenger Deposit] เพิ่มสาขาธนาคารเข้ารายชื่อไม่สำเร็จ:', createError);
        }
      }
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

    // สร้างใบฝาก, ผูกทุก pickup และตัดสินสถานะสุดท้ายใน transaction เดียว
    // หาก unique/FK/trigger ใดล้ม สถานะงานยังเป็น picked_up และกรอกใหม่ได้ทันที
    const { data: transaction, error: transactionError } = await supabase.rpc('record_bank_deposit', {
      p_job_id: jobId,
      p_actor_id: ctx.user.id,
      p_bank_id: bank.id,
      p_bank_branch_id: bankBranchId,
      p_bank_branch_name: bankBranchName,
      p_actual_amount_satang: actualSatang,
      p_reference_no: referenceNo,
      p_reference_no_source: referenceNoSource,
      p_slip_photo_id: slipPhotoId,
      p_deposited_at: depositedAt,
      p_submitted_signature: submittedSignature,
    });
    if (transactionError || !transaction) {
      const message = transactionError?.message || 'บันทึกการฝากเงินไม่สำเร็จ';
      const duplicateRef = /uq_bank_deposits_ref|duplicate key/i.test(message);
      const noPickups = /no_cash_pickups/.test(message);
      const alreadyDeposited = /deposit_not_allowed/.test(message);
      return NextResponse.json(
        {
          success: false,
          error: noPickups
            ? 'ต้องบันทึกการรับซองเงินอย่างน้อยหนึ่งจุดก่อน'
            : duplicateRef
            ? 'เลขที่ใบนำฝากนี้ถูกบันทึกไปแล้วกับธนาคารเดียวกัน'
            : alreadyDeposited
              ? 'งานนี้บันทึกการฝากเงินไปแล้ว'
              : message,
        },
        { status: duplicateRef || noPickups || alreadyDeposited ? 409 : 500 }
      );
    }
    const result = transaction as any;
    const deposit = result.deposit;
    const expectedTotalSatang = Number(result.expected_total_satang);
    const pickupCount = Number(result.pickup_count);

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
        bank_branch_from_list: !!bankBranchId && !bankBranchCreated,
        bank_branch_created: bankBranchCreated,
        expected_total_satang: expectedTotalSatang,
        pickup_count: pickupCount,
        reference_no_source: referenceNoSource,
        slip_status: deposit.slip_status,
        variance_kind: kind,
      },
    }, request);

    const financeDepts = await financeDepartmentIds();

    if (kind === 'match') {
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

    // แนบรูปและเปลี่ยนรายการยอดตรงเป็น matched พร้อมกัน เพราะทั้งสองการเปลี่ยน
    // กลับไม่ได้หลังแนบรูปสำเร็จ หากขั้นใดล้ม RPC จะ rollback ทั้งคู่
    const { data: transaction, error } = await supabase.rpc('attach_bank_deposit_slip', {
      p_deposit_id: deposit.id,
      p_actor_id: ctx.user.id,
      p_slip_photo_id: photo.id,
    });
    if (error || !transaction) {
      return NextResponse.json(
        { success: false, error: error?.message || 'แนบรูปไม่สำเร็จ' },
        { status: 409 }
      );
    }
    const updated = (transaction as any).deposit;

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
