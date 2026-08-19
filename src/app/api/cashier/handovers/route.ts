import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { forbiddenResponse, requireCapability } from '@/lib/supabase/auth-helpers';
import { getCashCapabilities } from '@/lib/permissions';
import { getActorName } from '@/lib/messenger-audit';
import { MoneyParseError, parseBahtToSatang } from '@/lib/money';
import { financeDepartmentIds } from '@/lib/messenger-data';
import { notifyDepartment } from '@/lib/upstash';

/**
 * การส่งซองของแคชเชียร์
 *
 * แคชเชียร์เป็นเจ้าของยอดต้นทาง: เขียนใบ Pay-in ใส่เงิน ปิดผนึกซอง เขียนยอดหน้าซอง
 * แล้วประกาศยอดนั้นในระบบ ("ส่งซอง") แมสเซนเจอร์มารับแล้วกดยืนยัน ("รับซอง")
 *
 * ยอดที่ประกาศแก้ไม่ได้หลังกดส่ง (trigger cash_handovers_guard) เขียนผิดต้องยกเลิก
 * แล้วออกใบใหม่ ซึ่งเหลือร่องรอยทั้งสองใบ ต่างจากการแก้ทับที่ไม่เหลืออะไรให้ตรวจ
 *
 * "แคชเชียร์" ไม่ใช่ role ใหม่ — คือผู้ใช้ที่อยู่หน่วยงานเจ้าของสาขารับเงิน
 * (ดู getCashCapabilities) จึงไม่ต้องดูแลรายชื่อซ้ำสองที่
 */

// GET — คิวซองที่เกี่ยวข้องกับผู้เรียก
//   แคชเชียร์: ซองของสาขาตัวเอง
//   แมสเซนเจอร์: ซองที่ยังรอรับ (ทุกสาขา) เพื่อวางแผนเส้นทาง
//   บัญชี/การเงิน: ดูได้ทั้งหมด
export async function GET(request: NextRequest) {
  try {
    const auth = await requireCapability({});
    if (auth.response) return auth.response;
    const ctx = auth.context!;
    const caps = await getCashCapabilities(ctx);

    if (!caps.isCashier && !caps.isMessenger && !caps.canViewCash) {
      return forbiddenResponse();
    }

    const supabase = getServiceSupabase();
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.getAll('status');
    const branchFilter = searchParams.get('branch_id');

    let query = supabase
      .from('cash_handovers')
      .select('*')
      .order('declared_at', { ascending: false })
      .limit(200);

    if (statusFilter.length > 0) query = query.in('status', statusFilter);
    if (branchFilter) query = query.eq('branch_id', branchFilter);

    // แคชเชียร์ที่ไม่มีสิทธิ์ดูภาพรวม เห็นได้แค่สาขาตัวเอง
    if (caps.isCashier && !caps.isMessenger && !caps.canViewCash) {
      query = query.in(
        'branch_id',
        caps.cashierBranchIds.length ? caps.cashierBranchIds : ['00000000-0000-0000-0000-000000000000']
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data || []) as any[];
    const branchIds = [...new Set(rows.map((r) => r.branch_id))];
    const peopleIds = [
      ...new Set(rows.flatMap((r) => [r.declared_by, r.accepted_by]).filter(Boolean)),
    ];
    const [{ data: branches }, { data: people }] = await Promise.all([
      supabase.from('branches').select('id, name').in('id', branchIds.length ? branchIds : ['none']),
      supabase.from('profiles').select('id, full_name').in('id', peopleIds.length ? peopleIds : ['none']),
    ]);
    const branchMap = new Map((branches || []).map((b: any) => [b.id, b.name]));
    const nameMap = new Map((people || []).map((p: any) => [p.id, p.full_name]));

    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        branch_name: branchMap.get(r.branch_id) || null,
        declared_by_name: nameMap.get(r.declared_by) || null,
        accepted_by_name: r.accepted_by ? nameMap.get(r.accepted_by) || null : null,
      })),
      meta: {
        can_declare: caps.isCashier,
        my_branch_ids: caps.cashierBranchIds,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST — ส่งซอง
export async function POST(request: NextRequest) {
  try {
    const auth = await requireCapability({});
    if (auth.response) return auth.response;
    const ctx = auth.context!;
    const caps = await getCashCapabilities(ctx);
    const isSuper = ctx.profile.role === 'super_admin';
    if (!caps.isCashier && !isSuper) return forbiddenResponse();

    const supabase = getServiceSupabase();
    const body = await request.json();

    let declaredSatang: number;
    try {
      declaredSatang = parseBahtToSatang(body.declared_amount);
    } catch (e) {
      const message = e instanceof MoneyParseError ? e.message : 'จำนวนเงินไม่ถูกต้อง';
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }
    if (declaredSatang <= 0) {
      return NextResponse.json({ success: false, error: 'ยอดเงินต้องมากกว่า 0' }, { status: 400 });
    }

    const envelopeCount = Number(body.envelope_count ?? 1);
    if (!Number.isInteger(envelopeCount) || envelopeCount < 1 || envelopeCount > 1000) {
      return NextResponse.json({ success: false, error: 'จำนวนซองไม่ถูกต้อง' }, { status: 400 });
    }

    // สาขาต้องเป็นสาขาของตัวเอง (super_admin ทำแทนได้ และยังถูกบันทึกว่าเป็นคนทำ)
    // trigger assert_declarer_belongs_to_branch ตรวจซ้ำที่ระดับฐานข้อมูล
    const branchId = String(body.branch_id || '');
    if (!isSuper && !caps.cashierBranchIds.includes(branchId)) {
      return NextResponse.json(
        { success: false, error: 'ส่งซองได้เฉพาะสาขาของหน่วยงานตัวเอง' },
        { status: 403 }
      );
    }

    const { data: branch } = await supabase
      .from('branches')
      .select('id, name, department_id, is_active')
      .eq('id', branchId)
      .maybeSingle();
    if (!branch || !branch.is_active) {
      return NextResponse.json({ success: false, error: 'สาขาไม่ถูกต้องหรือปิดใช้งานแล้ว' }, { status: 400 });
    }

    const signature = await getActorName(ctx.user.id, ctx.user.email);

    const { data: handover, error } = await supabase
      .from('cash_handovers')
      .insert({
        branch_id: branch.id,
        declared_amount_satang: declaredSatang,
        envelope_count: envelopeCount,
        note: body.note ? String(body.note).trim() || null : null,
        declared_by: ctx.user.id,
        declarer_signature: signature,
        status: 'pending',
      })
      .select()
      .single();
    if (error) throw error;

    // แจ้งแมสเซนเจอร์ว่ามีซองรออยู่ + ให้บัญชีเห็นตั้งแต่ต้นทาง
    const [financeDepts, { data: msgDept }] = await Promise.all([
      financeDepartmentIds(),
      supabase.from('departments').select('id').eq('code', 'MSG').maybeSingle(),
    ]);
    const targets = [...new Set([msgDept?.id, ...financeDepts].filter(Boolean) as string[])];
    await Promise.all(
      targets.map((deptId) =>
        notifyDepartment(deptId, {
          title: 'มีซองเงินรอแมสเซนเจอร์มารับ',
          body: `${branch.name} · ${envelopeCount} ซอง · แจ้งโดย ${signature}`,
          docId: handover.id,
          runningNo: handover.handover_no,
        })
      )
    );

    return NextResponse.json({ success: true, data: handover });
  } catch (error: any) {
    console.error('[Cashier Handover] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
