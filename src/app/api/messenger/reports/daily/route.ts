import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { requireCapability, forbiddenResponse } from '@/lib/supabase/auth-helpers';
import { canViewCash } from '@/lib/permissions';

/**
 * GET /api/messenger/reports/daily — รายงานสรุปยอดผ่านประจำวัน
 *
 * ตัวเลขที่สำคัญที่สุดคือ in_hand_satang: เงินสดที่แมสเซนเจอร์รับไปแล้วแต่ยัง
 * ไม่ได้ฝาก ฝ่ายการเงินต้องเห็นค่านี้ทุกเย็นเพื่อรู้ว่าคืนนี้มีใครถือเงินอยู่
 *
 * การรวมยอดทำจาก BIGINT สตางค์ทั้งหมด จำนวนเต็มในช่วง safe จึงบวกได้แม่นยำ 100%
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireCapability({});
    if (auth.response) return auth.response;
    if (!(await canViewCash(auth.context!))) return forbiddenResponse();

    const supabase = getServiceSupabase();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const dayStart = `${date}T00:00:00.000Z`;
    const dayEnd = `${date}T23:59:59.999Z`;

    const [
      { data: pickupsToday },
      { data: depositsToday },
      { data: openPickups },
      { data: pendingReports },
      { data: awaitingSlip },
      { data: unconfirmed },
    ] = await Promise.all([
      supabase
        .from('cash_pickups')
        .select('envelope_amount_satang, job_id')
        .gte('picked_up_at', dayStart)
        .lte('picked_up_at', dayEnd),
      supabase
        .from('bank_deposits')
        .select('actual_amount_satang, variance_satang, status, slip_status, job_id')
        .neq('status', 'voided')
        .gte('deposited_at', dayStart)
        .lte('deposited_at', dayEnd),
      // เงินคงค้างในมือ: ไม่จำกัดวัน เพราะเงินที่ค้างมาจากเมื่อวานยังเป็นเงินที่ค้าง
      supabase
        .from('cash_pickups')
        .select('envelope_amount_satang, messenger_jobs!inner(status)')
        .is('deposit_id', null),
      supabase.from('cash_variance_reports').select('id').eq('status', 'pending_review'),
      supabase
        .from('bank_deposits')
        .select('id')
        .eq('slip_status', 'pending')
        .neq('status', 'voided'),
      supabase.from('cash_pickups').select('id').is('branch_confirmed_at', null),
    ]);

    const received = (pickupsToday || []).reduce((s: number, r: any) => s + (r.envelope_amount_satang || 0), 0);
    const deposited = (depositsToday || []).reduce((s: number, r: any) => s + (r.actual_amount_satang || 0), 0);

    let short = 0;
    let over = 0;
    for (const d of depositsToday || []) {
      const v = d.variance_satang || 0;
      if (v < 0) short += -v;
      else if (v > 0) over += v;
    }

    // นับเฉพาะงานที่ยังเดินอยู่ — งานที่ยกเลิกไม่ถือว่ามีเงินอยู่ในมือ
    const inHand = (openPickups || [])
      .filter((r: any) => {
        const status = Array.isArray(r.messenger_jobs) ? r.messenger_jobs[0]?.status : r.messenger_jobs?.status;
        return status === 'picked_up';
      })
      .reduce((s: number, r: any) => s + (r.envelope_amount_satang || 0), 0);

    return NextResponse.json({
      success: true,
      data: {
        date,
        received_satang: received,
        deposited_satang: deposited,
        in_hand_satang: inHand,
        short_satang: short,
        over_satang: over,
        pending_review_count: (pendingReports || []).length,
        awaiting_slip_count: (awaitingSlip || []).length,
        awaiting_branch_confirm_count: (unconfirmed || []).length,
        job_count: new Set((pickupsToday || []).map((r: any) => r.job_id)).size,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
