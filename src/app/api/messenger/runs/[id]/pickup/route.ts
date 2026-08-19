import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireCapability, forbiddenResponse } from '@/lib/supabase/auth-helpers';
import { appendAudit, getActorName } from '@/lib/messenger-audit';
import { MoneyParseError, parseBahtToSatang } from '@/lib/money';
import { financeDepartmentIds } from '@/lib/messenger-data';
import { notifyDepartment } from '@/lib/upstash';

/**
 * POST /api/messenger/runs/[id]/pickup — จุดรับซองเงินจากแคชเชียร์สาขา
 *
 * เรียกได้ **หลายครั้งต่อหนึ่งทริป** ครั้งละหนึ่งสาขา เพราะงานจริงคือเก็บซอง
 * จากหลายจุดแล้วนำฝากรวมครั้งเดียว (สาขาอยู่ที่ระดับ pickup ไม่ใช่ระดับงาน)
 *
 * ยอดที่บันทึกคือ **ยอดที่เขียนบนหน้าซอง** ไม่ใช่ยอดจากใบ Pay-in เพราะใบ Pay-in
 * อยู่ในซองและแมสเซนเจอร์แกะไม่ได้จนถึงเคาน์เตอร์ธนาคาร รูปที่แนบจึงเป็นรูปซอง
 *
 * ยอดนี้เป็นฐานของการเทียบยอดทั้งหมด และเป็น write-once ที่ระดับ trigger
 * (cash_pickups_guard) แก้ย้อนหลังไม่ได้ ต้อง void งานแล้วเปิดใหม่
 *
 * มีสองเส้นทางในการบันทึกยอด:
 *
 *   1. **รับซองที่แคชเชียร์ส่งมาในระบบ** (ส่ง handover_id) — เส้นทางหลัก
 *      ยอดมาจากการประกาศของแคชเชียร์ แมสเซนเจอร์คีย์ยอดเองไม่ได้เลย
 *      หน้าที่ของแมสเซนเจอร์คือ "ยืนยันว่ายอดในระบบตรงกับที่เขียนหน้าซอง"
 *      → สองฝ่ายยืนยันยอดต้นทาง ปิดช่อง "รับเงินมาไม่ครบตั้งแต่ต้น"
 *
 *   2. **คีย์ยอดเอง** (ไม่ส่ง handover_id) — สำหรับสาขาที่ยังไม่มีบัญชีแคชเชียร์
 *      เส้นทางนี้ยังมีช่องเดิม: ระบบจับได้แค่ "คีย์ยอดกับฝากไม่ตรง" ไม่ใช่
 *      "รับเงินมาไม่ครบ" รายงานประจำวันจึงนับแยกให้เห็นว่ามีกี่จุดที่ไม่มี
 *      การยืนยันจากต้นทาง
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
    // เก็บเพิ่มได้ตลอดจนกว่าจะไปฝาก — หลังฝากแล้วยอดที่ควรฝากถูก snapshot ไว้
    // ถ้ายอมให้เพิ่ม pickup หลังจากนั้น ผลต่างที่คำนวณไว้จะกลายเป็นเท็จ
    if (job.status !== 'open' && job.status !== 'picked_up') {
      return NextResponse.json(
        { success: false, error: 'ทริปนี้บันทึกการนำฝากไปแล้ว เพิ่มจุดรับไม่ได้' },
        { status: 409 }
      );
    }

    // ── ตรวจ input ──
    // ถ้ารับซองที่แคชเชียร์ประกาศไว้ ยอด/จำนวนซอง/ชื่อแคชเชียร์ มาจากใบประกาศ
    // ไม่รับค่าจาก body เลย (trigger assert_pickup_matches_handover ตรวจซ้ำที่ DB)
    const handoverId = body.handover_id ? String(body.handover_id) : null;
    let handover: any = null;
    let envelopeSatang: number;
    let envelopeCount: number;
    let cashierName: string;
    let cashierProfileId: string | null;

    if (handoverId) {
      const { data: row } = await supabase
        .from('cash_handovers')
        .select('*')
        .eq('id', handoverId)
        .maybeSingle();
      if (!row) {
        return NextResponse.json({ success: false, error: 'ไม่พบซองที่แคชเชียร์ส่งไว้' }, { status: 404 });
      }
      if (row.status !== 'pending') {
        return NextResponse.json(
          { success: false, error: 'ซองนี้ถูกดำเนินการไปแล้ว (อาจมีคนรับไปก่อน หรือถูกยกเลิก)' },
          { status: 409 }
        );
      }
      // แมสเซนเจอร์ต้องกดยืนยันว่ายอดในระบบตรงกับที่เขียนหน้าซอง
      // ถ้าไม่ตรงต้องใช้ปุ่มแจ้งยอดไม่ตรง ไม่ใช่กดรับแล้วไปแก้ที่ปลายทาง
      if (body.face_value_confirmed !== true) {
        return NextResponse.json(
          { success: false, error: 'ต้องยืนยันว่ายอดในระบบตรงกับที่เขียนบนหน้าซองก่อนกดรับ' },
          { status: 400 }
        );
      }
      handover = row;
      envelopeSatang = Number(row.declared_amount_satang);
      envelopeCount = Number(row.envelope_count);
      cashierProfileId = row.declared_by;
      const { data: declarer } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', row.declared_by)
        .maybeSingle();
      cashierName = (declarer as any)?.full_name || row.declarer_signature;
    } else {
      try {
        envelopeSatang = parseBahtToSatang(body.envelope_amount);
      } catch (e) {
        const message = e instanceof MoneyParseError ? e.message : 'จำนวนเงินไม่ถูกต้อง';
        return NextResponse.json({ success: false, error: message }, { status: 400 });
      }
      if (envelopeSatang <= 0) {
        return NextResponse.json({ success: false, error: 'ยอดเงินตามหน้าซองต้องมากกว่า 0' }, { status: 400 });
      }
      envelopeCount = Number(body.envelope_count);
      if (!Number.isInteger(envelopeCount) || envelopeCount < 1 || envelopeCount > 1000) {
        return NextResponse.json({ success: false, error: 'จำนวนซองที่รับไม่ถูกต้อง' }, { status: 400 });
      }
      cashierName = String(body.cashier_name || '').trim();
      if (!cashierName) {
        return NextResponse.json({ success: false, error: 'กรุณาระบุชื่อแคชเชียร์ผู้ส่งมอบ' }, { status: 400 });
      }
      cashierProfileId = body.cashier_profile_id || null;
    }
    if (!body.envelope_photo_id) {
      return NextResponse.json(
        { success: false, error: 'ต้องแนบรูปซองเงินก่อนยืนยันรับมอบ' },
        { status: 400 }
      );
    }

    // สาขาต้องมีอยู่จริงและยังเปิดใช้งาน — กันการรับเงินเข้าสาขาที่ปิดไปแล้ว
    // สาขามาจากใบประกาศเมื่อรับซอง มิฉะนั้นมาจากที่แมสเซนเจอร์เลือก
    const branchIdInput = handover ? handover.branch_id : body.branch_id || '';
    const { data: branch } = await supabase
      .from('branches')
      .select('id, name, department_id, is_active')
      .eq('id', branchIdInput)
      .maybeSingle();
    if (!branch || !branch.is_active) {
      return NextResponse.json(
        { success: false, error: 'กรุณาเลือกสาขาที่รับเงิน (สาขาที่เลือกไม่มีอยู่หรือถูกปิดใช้งาน)' },
        { status: 400 }
      );
    }

    // รูปต้องเป็นของงานนี้และเป็นรูปซอง — ห้ามยืมรูปงานอื่นมาอ้าง
    // (trigger assert_envelope_photo_matches_job ตรวจซ้ำที่ระดับ DB อีกชั้น)
    const { data: photo } = await supabase
      .from('messenger_job_photos')
      .select('id, job_id, photo_kind')
      .eq('id', body.envelope_photo_id)
      .single();
    if (!photo || photo.job_id !== jobId || photo.photo_kind !== 'cash_envelope') {
      return NextResponse.json(
        { success: false, error: 'รูปซองเงินไม่ถูกต้องหรือไม่ใช่ของทริปนี้' },
        { status: 400 }
      );
    }

    const receiverSignature = await getActorName(ctx.user.id, ctx.user.email);
    const pickedUpAt = new Date().toISOString();

    // ── จับจองซองก่อนสร้างจุดรับ ──
    // conditional update pending -> accepted เป็นจุด serialize เดียว: ถ้าสองคน
    // กดรับซองใบเดียวกันพร้อมกัน มีคนเดียวที่ผ่าน อีกคนได้ 409
    // (trigger บังคับด้วยว่า pickup อ้าง handover ที่ยัง pending ไม่ได้)
    if (handover) {
      const { data: claimed, error: claimError } = await supabase
        .from('cash_handovers')
        .update({ status: 'accepted', accepted_by: ctx.user.id, accepted_at: pickedUpAt })
        .eq('id', handover.id)
        .eq('status', 'pending')
        .select()
        .single();
      if (claimError || !claimed) {
        return NextResponse.json(
          { success: false, error: 'ซองนี้ถูกรับไปแล้วโดยคนอื่น' },
          { status: 409 }
        );
      }
    }

    // ── บันทึกเงินก่อน แล้วค่อยขยับสถานะ ──
    // ลำดับนี้ตั้งใจ: หลักฐานการรับเงินสำคัญกว่าสถานะงาน ถ้าขั้นที่สองล้ม
    // ยอดยังอยู่ในระบบและกดซ้ำได้ ไม่ใช่เงินหายจากระบบ
    //
    // การกดซ้ำ/เน็ตกระตุกถูกกันด้วย unique index (job_id, branch_id) ที่ระดับ DB
    // ไม่ได้พึ่ง conditional update เหมือนก่อน เพราะสถานะ picked_up ตอนนี้รับ
    // การเพิ่ม pickup ได้หลายครั้งโดยชอบธรรม
    const { data: pickup, error: pickupError } = await supabase
      .from('cash_pickups')
      .insert({
        job_id: jobId,
        branch_id: branch.id,
        handover_id: handover ? handover.id : null,
        cashier_profile_id: cashierProfileId,
        cashier_name: cashierName,
        envelope_count: envelopeCount,
        envelope_amount_satang: envelopeSatang,
        envelope_photo_id: body.envelope_photo_id,
        picked_up_at: pickedUpAt,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
        gps_accuracy_m: body.gps_accuracy_m ?? null,
        received_by: ctx.user.id,
        receiver_signature: receiverSignature,
      })
      .select()
      .single();
    if (pickupError) {
      // คืนซองกลับเป็น pending ถ้าสร้างจุดรับไม่สำเร็จ ไม่งั้นซองจะค้างสถานะ
      // accepted โดยไม่มีจุดรับจริง แล้วไม่มีใครรับได้อีก
      if (handover) {
        await supabase
          .from('cash_handovers')
          .update({ status: 'pending', accepted_by: null, accepted_at: null })
          .eq('id', handover.id)
          .eq('status', 'accepted');
      }
      if ((pickupError as any).code === '23505') {
        return NextResponse.json(
          {
            success: false,
            error: `ทริปนี้บันทึกการรับเงินจาก ${branch.name} ไปแล้ว ` +
              'ถ้าต้องรับอีกรอบจากสาขาเดียวกัน กรุณาเปิดทริปใหม่เพื่อให้ยอดแยกกันชัดเจน',
          },
          { status: 409 }
        );
      }
      throw pickupError;
    }

    // ผูกใบประกาศกับจุดรับที่เกิดขึ้นจริง
    if (handover) {
      await supabase
        .from('cash_handovers')
        .update({ accepted_pickup_id: pickup.id })
        .eq('id', handover.id)
        .is('accepted_pickup_id', null);
    }

    const { error: moveError } = await supabase
      .from('messenger_jobs')
      .update({ status: 'picked_up', picked_up_at: job.picked_up_at || pickedUpAt })
      .eq('id', jobId)
      .in('status', ['open', 'picked_up']);
    if (moveError) {
      console.error('[Messenger Pickup] ขยับสถานะงานไม่สำเร็จ แต่บันทึกยอดแล้ว:', moveError);
    }

    await appendAudit(ctx, {
      job_id: jobId,
      entity: 'pickup',
      entity_id: pickup.id,
      action: 'record_pickup',
      from_status: job.status,
      to_status: 'picked_up',
      amount_satang: envelopeSatang,
      payload: {
        branch_id: branch.id,
        branch_name: branch.name,
        cashier_name: cashierName,
        envelope_count: envelopeCount,
        // แยกให้ชัดว่ายอดนี้มีการยืนยันจากต้นทางหรือมาจากแมสเซนเจอร์ฝ่ายเดียว
        source: handover ? 'cashier_declaration' : 'messenger_keyed',
        handover_no: handover ? handover.handover_no : null,
        has_gps: body.lat != null && body.lng != null,
      },
    }, request);

    // แจ้งสาขาและฝ่ายบัญชี/การเงิน — สาขาต้องเห็นทันทีว่าเงินถูกรับไปแล้ว
    const financeDepts = await financeDepartmentIds();
    const targets = [...new Set([branch.department_id, ...financeDepts].filter(Boolean) as string[])];
    await Promise.all(
      targets.map((deptId) =>
        notifyDepartment(deptId, {
          title: 'แมสเซนเจอร์รับเงินสดแล้ว',
          body: `${branch.name} · ${envelopeCount} ซอง · ผู้รับ ${receiverSignature}`,
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
