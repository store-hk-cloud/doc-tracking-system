import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireCapability, forbiddenResponse } from '@/lib/supabase/auth-helpers';
import { appendAudit, getActorName } from '@/lib/messenger-audit';
import { MoneyParseError, parseBahtToSatang } from '@/lib/money';
import { financeDepartmentIds } from '@/lib/messenger-data';
import { notifyDepartment } from '@/lib/upstash';

/**
 * POST /api/messenger/runs/[id]/pickup — SCREEN 1 จุดรับเงินจากแคชเชียร์
 *
 * ยอดตามใบ Pay-in ที่บันทึกที่นี่คือฐานของการเทียบยอดทั้งหมด และเป็น write-once
 * ที่ระดับ trigger (cash_pickups_guard) แก้ย้อนหลังไม่ได้ ต้อง void งานแล้วเปิดใหม่
 *
 * ข้อจำกัดที่ต้องรู้: ยอดนี้แมสเซนเจอร์เป็นคนคีย์เอง ระบบจับได้แค่ "คีย์ยอดกับ
 * ฝากไม่ตรง" ไม่ใช่ "รับเงินมาไม่ครบ" กลไกที่ปิดช่องนั้นคือให้สาขายืนยันยอด
 * (คอลัมน์ branch_confirmed_* เตรียมไว้แล้ว)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCapability({});
    if (auth.response) return auth.response;
    const ctx = auth.context!;

    const { id: jobId } = await params;
    const supabase = getServiceSupabase();
    const body = await request.json();

    const { data: job } = await supabase
      .from('messenger_jobs')
      .select('*')
      .eq('id', jobId)
      .single();
    if (!job) return NextResponse.json({ success: false, error: 'ไม่พบงานนี้' }, { status: 404 });
    // รับเงินได้เฉพาะแมสเซนเจอร์ที่ถูกมอบหมายงานใบนี้เท่านั้น
    if (job.assigned_to !== ctx.user.id) return forbiddenResponse();

    // ── ตรวจ input ──
    let payinSatang: number;
    try {
      payinSatang = parseBahtToSatang(body.payin_amount);
    } catch (e) {
      const message = e instanceof MoneyParseError ? e.message : 'จำนวนเงินไม่ถูกต้อง';
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }
    if (payinSatang <= 0) {
      return NextResponse.json({ success: false, error: 'ยอดเงินตามใบ Pay-in ต้องมากกว่า 0' }, { status: 400 });
    }

    const envelopeCount = Number(body.envelope_count);
    if (!Number.isInteger(envelopeCount) || envelopeCount < 1 || envelopeCount > 1000) {
      return NextResponse.json({ success: false, error: 'จำนวนซองที่รับไม่ถูกต้อง' }, { status: 400 });
    }
    const cashierName = String(body.cashier_name || '').trim();
    if (!cashierName) {
      return NextResponse.json({ success: false, error: 'กรุณาระบุชื่อแคชเชียร์ผู้ส่งมอบ' }, { status: 400 });
    }
    if (!body.payin_photo_id) {
      return NextResponse.json(
        { success: false, error: 'ต้องแนบรูปใบ Pay-in / ซองเงินก่อนยืนยันรับมอบ' },
        { status: 400 }
      );
    }

    // รูปต้องเป็นของงานนี้และเป็นชนิด payin_slip — ห้ามยืมรูปงานอื่นมาอ้าง
    const { data: photo } = await supabase
      .from('messenger_job_photos')
      .select('id, job_id, photo_kind')
      .eq('id', body.payin_photo_id)
      .single();
    if (!photo || photo.job_id !== jobId || photo.photo_kind !== 'payin_slip') {
      return NextResponse.json(
        { success: false, error: 'รูปใบ Pay-in ไม่ถูกต้องหรือไม่ใช่ของงานนี้' },
        { status: 400 }
      );
    }

    const receiverSignature = await getActorName(ctx.user.id, ctx.user.email);
    const pickedUpAt = new Date().toISOString();

    // ── ย้ายสถานะงานก่อน (conditional update) ──
    // ถ้ามีสองคำขอชนกัน มีแค่คำขอเดียวที่ WHERE status='open' สำเร็จ
    // อีกคำขอได้ 409 ไม่ใช่สร้าง pickup ซ้อนกันสองใบ
    const { data: movedJob, error: moveError } = await supabase
      .from('messenger_jobs')
      .update({ status: 'picked_up', picked_up_at: pickedUpAt })
      .eq('id', jobId)
      .eq('assigned_to', ctx.user.id)
      .eq('status', 'open')
      .select()
      .single();
    if (moveError || !movedJob) {
      return NextResponse.json(
        { success: false, error: 'งานนี้บันทึกการรับเงินไปแล้ว' },
        { status: 409 }
      );
    }

    const { data: pickup, error: pickupError } = await supabase
      .from('cash_pickups')
      .insert({
        job_id: jobId,
        branch_id: job.branch_id,
        cashier_profile_id: body.cashier_profile_id || null,
        cashier_name: cashierName,
        envelope_count: envelopeCount,
        payin_amount_satang: payinSatang,
        payin_photo_id: body.payin_photo_id,
        picked_up_at: pickedUpAt,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
        gps_accuracy_m: body.gps_accuracy_m ?? null,
        received_by: ctx.user.id,
        receiver_signature: receiverSignature,
      })
      .select()
      .single();
    if (pickupError) throw pickupError;

    await appendAudit(ctx, {
      job_id: jobId,
      entity: 'pickup',
      entity_id: pickup.id,
      action: 'record_pickup',
      from_status: 'open',
      to_status: 'picked_up',
      amount_satang: payinSatang,
      payload: {
        branch_id: job.branch_id,
        cashier_name: cashierName,
        envelope_count: envelopeCount,
        has_gps: body.lat != null && body.lng != null,
      },
    }, request);

    // แจ้งสาขาและฝ่ายบัญชี/การเงิน — สาขาต้องเห็นทันทีว่าเงินถูกรับไปแล้ว
    const [{ data: branch }, financeDepts] = await Promise.all([
      supabase.from('branches').select('name, department_id').eq('id', job.branch_id).single(),
      financeDepartmentIds(),
    ]);
    const targets = [...new Set([branch?.department_id, ...financeDepts].filter(Boolean) as string[])];
    await Promise.all(
      targets.map((deptId) =>
        notifyDepartment(deptId, {
          title: 'แมสเซนเจอร์รับเงินสดแล้ว',
          body: `${branch?.name || 'สาขา'} · ${envelopeCount} ซอง · ผู้รับ ${receiverSignature}`,
          docId: jobId,
          runningNo: job.job_no,
        })
      )
    );

    return NextResponse.json({ success: true, data: pickup });
  } catch (error: any) {
    console.error('[Messenger Pickup] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
