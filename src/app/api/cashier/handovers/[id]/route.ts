import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { forbiddenResponse, requireCapability } from '@/lib/supabase/auth-helpers';
import { getCashCapabilities } from '@/lib/permissions';
import { getActorName } from '@/lib/messenger-audit';
import { formatSatangToBaht } from '@/lib/money';
import { financeDepartmentIds } from '@/lib/messenger-data';
import { notifyDepartment } from '@/lib/upstash';

/**
 * PATCH /api/cashier/handovers/[id] — ปิดซองที่ยังไม่ถูกรับ
 *
 * สองการกระทำ ต่างคนทำ:
 *   action=cancel  — แคชเชียร์ยกเลิกซองของตัวเอง (เขียนยอดผิด / ยกเลิกการฝาก)
 *   action=dispute — แมสเซนเจอร์กด "ยอดในระบบไม่ตรงกับที่เขียนหน้าซอง"
 *
 * ทำไม dispute ต้องมี: ถ้าไม่มีทางแจ้งว่าไม่ตรง แมสเซนเจอร์จะถูกบังคับให้เลือก
 * ระหว่าง "กดรับทั้งที่รู้ว่าไม่ตรง" หรือ "ไม่รับเลยแล้วเงินค้างที่สาขา"
 * ทางที่สามคือแจ้งไว้ในระบบตั้งแต่อยู่หน้าเคาน์เตอร์ ให้สองฝ่ายเคลียร์กันตรงนั้น
 * ก่อนเงินออกจากสาขา — ซึ่งเป็นจุดเดียวที่ยังแก้ได้โดยไม่มีเงินเดินทาง
 *
 * ทั้งสองการกระทำทำได้เฉพาะตอนสถานะยังเป็น pending และเป็นสถานะปลายทาง
 * ซองที่ยอดไม่ตรงไม่ถูกดัดกลับมาใช้ ต้องออกใบใหม่ (บังคับที่ trigger)
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireCapability({});
    if (auth.response) return auth.response;
    const ctx = auth.context!;
    const caps = await getCashCapabilities(ctx);
    const isSuper = ctx.profile.role === 'super_admin';

    const { id } = await params;
    const supabase = getServiceSupabase();
    const body = await request.json();
    const action = body.action === 'dispute' ? 'dispute' : body.action === 'cancel' ? 'cancel' : null;
    if (!action) {
      return NextResponse.json({ success: false, error: 'ระบุการกระทำไม่ถูกต้อง' }, { status: 400 });
    }

    const reason = String(body.reason || '').trim();
    if (reason.length < 5) {
      return NextResponse.json(
        { success: false, error: 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร' },
        { status: 400 }
      );
    }

    const { data: handover } = await supabase
      .from('cash_handovers')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!handover) {
      return NextResponse.json({ success: false, error: 'ไม่พบซองนี้' }, { status: 404 });
    }
    if (handover.status !== 'pending') {
      return NextResponse.json(
        { success: false, error: 'ซองนี้ถูกดำเนินการไปแล้ว' },
        { status: 409 }
      );
    }

    if (action === 'cancel') {
      // ยกเลิกได้เฉพาะเจ้าของซอง (หรือผู้ดูแลระบบ)
      if (!isSuper && handover.declared_by !== ctx.user.id) return forbiddenResponse();
    } else {
      // แจ้งยอดไม่ตรงได้เฉพาะแมสเซนเจอร์ที่มารับ (หรือผู้ดูแลระบบ)
      if (!isSuper && !caps.isMessenger) return forbiddenResponse();
    }

    const actorName = await getActorName(ctx.user.id, ctx.user.email);
    const updates =
      action === 'cancel'
        ? { status: 'cancelled', cancel_reason: `${reason} (โดย ${actorName})` }
        : {
            status: 'disputed',
            dispute_reason: `${reason} (แจ้งโดย ${actorName})`,
            disputed_at: new Date().toISOString(),
          };

    // conditional update กันสองคนกดชนกัน — ผู้แพ้ได้ 409 ไม่ใช่เขียนทับ
    const { data: updated, error } = await supabase
      .from('cash_handovers')
      .update(updates)
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .single();
    if (error || !updated) {
      return NextResponse.json(
        { success: false, error: 'ซองนี้ถูกดำเนินการไปแล้ว' },
        { status: 409 }
      );
    }

    // ยอดไม่ตรงเป็นเรื่องที่ต้องรู้ทันที ไม่ใช่รอดูรายงานสิ้นวัน
    if (action === 'dispute') {
      const [{ data: branch }, financeDepts] = await Promise.all([
        supabase.from('branches').select('name, department_id').eq('id', updated.branch_id).maybeSingle(),
        financeDepartmentIds(),
      ]);
      const targets = [
        ...new Set([branch?.department_id, ...financeDepts].filter(Boolean) as string[]),
      ];
      await Promise.all(
        targets.map((deptId) =>
          notifyDepartment(deptId, {
            title: '⚠️ ยอดหน้าซองไม่ตรงกับที่แจ้งในระบบ',
            body:
              `${branch?.name || 'สาขา'} · แจ้งไว้ ${formatSatangToBaht(updated.declared_amount_satang)} บาท · ` +
              `${reason}`,
            docId: updated.id,
            runningNo: updated.handover_no,
          })
        )
      );
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('[Cashier Handover PATCH] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
