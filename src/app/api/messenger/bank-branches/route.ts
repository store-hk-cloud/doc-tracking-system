import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { forbiddenResponse, requireCapability } from '@/lib/supabase/auth-helpers';
import { getCashCapabilities } from '@/lib/permissions';

/**
 * ข้อมูลธนาคาร — **แมสเซนเจอร์เป็นผู้ดูแล** ทั้งรายชื่อธนาคารและสาขาธนาคาร
 *
 * เหตุผล: แมสเซนเจอร์เป็นคนเดียวที่รู้ว่าไปฝากที่ธนาคาร/สาขาไหนจริง และรู้ตอน
 * อยู่หน้าเคาน์เตอร์ ถ้าต้องรอฝ่ายอื่นเพิ่มรายชื่อก่อนจึงบันทึกได้ จะเกิดช่วงที่
 * เงินฝากไปแล้วแต่ยังไม่เข้าระบบ ซึ่งเป็นความเสี่ยงที่ใหญ่กว่าความสะอาดของรายชื่อ
 *
 * ฝ่ายบัญชี/การเงินดูได้ (canViewCash) แต่แก้ไม่ได้
 * ส่วน "สาขาบริษัท" (จุดรับซองเงิน) เป็นของฝ่ายบัญชี — ดู /api/admin/cash-master
 *
 * ⚠️ ข้อควรรู้เรื่องการควบคุม: ตาราง approved_banks เดิมมีความหมายว่า
 * "ธนาคารที่บริษัทอนุมัติให้ฝาก" เมื่อผู้ที่นำฝากเป็นผู้เพิ่มรายชื่อได้เอง
 * รายการนี้จึงกลายเป็น "ธนาคารที่เคยใช้" ไม่ใช่ "ที่ได้รับอนุมัติ" อีกต่อไป
 * การเพิ่ม/แก้ทุกครั้งถูกบันทึกใน admin_action_log เพื่อให้ยังตรวจย้อนได้ว่า
 * ใครเพิ่มธนาคารใดเมื่อไหร่
 *
 * ไม่มี DELETE — รายการที่เคยใช้ถูกอ้างจากรายการฝากย้อนหลัง ปิดใช้งานแทน
 */

/**
 * บันทึกการเปลี่ยนรายชื่อธนาคารลง admin_action_log (append-only)
 *
 * จำเป็นเพราะผู้ที่นำฝากเงินเป็นผู้เพิ่มรายชื่อธนาคารได้เอง ถ้าไม่บันทึกไว้
 * จะไม่มีทางรู้ย้อนหลังว่าธนาคารปลายทางถูกเพิ่มเข้ามาเมื่อไหร่และโดยใคร
 * ล็อกล้มไม่ทำให้คำสั่งล้ม (ข้อมูลถูกแก้ไปแล้ว) แต่ต้องเห็นใน server log
 */
async function logBankAction(
  ctx: NonNullable<Awaited<ReturnType<typeof requireCapability>>['context']>,
  request: NextRequest,
  action: string,
  label: string,
  targetId: string
) {
  const supabase = getServiceSupabase();
  const { data: actor } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', ctx.user.id)
    .single();
  const { error } = await supabase.from('admin_action_log').insert({
    action,
    target_profile_id: null,
    target_label: label,
    actor_id: ctx.user.id,
    actor_signature: (actor as any)?.full_name || ctx.user.email || 'ไม่ทราบชื่อ',
    actor_role: (actor as any)?.role || ctx.profile.role,
    request_ip:
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      null,
    user_agent: request.headers.get('user-agent'),
    detail: { entity: 'approved_banks', target_id: targetId },
  });
  if (error) console.error('[Bank master] บันทึก admin_action_log ไม่สำเร็จ:', error);
}

async function gate(needWrite: boolean) {
  const auth = await requireCapability({});
  if (auth.response) return { response: auth.response, ctx: null };
  const ctx = auth.context!;
  const caps = await getCashCapabilities(ctx);
  const isSuper = ctx.profile.role === 'super_admin';
  if (needWrite && !caps.isMessenger && !isSuper) return { response: forbiddenResponse(), ctx: null };
  if (!needWrite && !caps.isMessenger && !caps.canViewCash) {
    return { response: forbiddenResponse(), ctx: null };
  }
  return { response: null, ctx };
}

export async function GET() {
  const g = await gate(false);
  if (g.response) return g.response;

  try {
    const supabase = getServiceSupabase();
    const [{ data: banks }, { data: branches }, { data: used }] = await Promise.all([
      // คืนทั้งที่เปิดและปิดใช้งาน เพราะหน้านี้ใช้ "จัดการ" ไม่ใช่ทำ dropdown
      // (dropdown ของแมสเซนเจอร์อ่านจาก /api/messenger/lookups ซึ่งกรอง is_active)
      supabase.from('approved_banks').select('*').order('name'),
      supabase.from('bank_branches').select('*').order('name'),
      supabase.from('bank_deposits').select('bank_id, bank_branch_id').neq('status', 'voided'),
    ]);

    const branchUsage = new Map<string, number>();
    const bankUsage = new Map<string, number>();
    for (const r of used || []) {
      const bid = (r as any).bank_branch_id;
      if (bid) branchUsage.set(bid, (branchUsage.get(bid) || 0) + 1);
      const bankId = (r as any).bank_id;
      if (bankId) bankUsage.set(bankId, (bankUsage.get(bankId) || 0) + 1);
    }

    return NextResponse.json({
      success: true,
      data: {
        banks: (banks || []).map((b: any) => ({ ...b, usage_count: bankUsage.get(b.id) || 0 })),
        branches: (branches || []).map((b: any) => ({ ...b, usage_count: branchUsage.get(b.id) || 0 })),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const g = await gate(true);
  if (g.response) return g.response;

  try {
    const supabase = getServiceSupabase();
    const body = await request.json();
    const name = String(body.name || '').trim();

    // เพิ่มธนาคารใหม่
    if (body.entity === 'bank') {
      const code = String(body.code || '').trim().toUpperCase();
      if (!name || !/^[A-Za-z0-9._-]{1,50}$/.test(code)) {
        return NextResponse.json(
          { success: false, error: 'กรุณากรอกชื่อธนาคาร และรหัสย่อ (A-Z 0-9 ไม่เกิน 50 ตัว)' },
          { status: 400 }
        );
      }
      const { data: created, error: bankError } = await supabase
        .from('approved_banks')
        .insert({ name, code, is_active: true })
        .select()
        .single();
      if (bankError) {
        if ((bankError as any).code === '23505') {
          return NextResponse.json({ success: false, error: `รหัส ${code} ถูกใช้แล้ว` }, { status: 409 });
        }
        throw bankError;
      }
      await logBankAction(g.ctx!, request, 'add_bank', `${name} (${code})`, created.id);
      return NextResponse.json({ success: true, data: created });
    }

    if (!body.bank_id || !name) {
      return NextResponse.json({ success: false, error: 'กรุณาเลือกธนาคารและกรอกชื่อสาขา' }, { status: 400 });
    }

    const { data: bank } = await supabase
      .from('approved_banks')
      .select('id, is_active')
      .eq('id', body.bank_id)
      .maybeSingle();
    if (!bank || !bank.is_active) {
      return NextResponse.json(
        { success: false, error: 'ธนาคารนี้ไม่อยู่ในรายชื่อที่บริษัทอนุมัติ' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('bank_branches')
      .insert({
        bank_id: bank.id,
        name,
        branch_code: String(body.branch_code || '').trim() || null,
        is_active: true,
      })
      .select()
      .single();
    if (error) {
      if ((error as any).code === '23505') {
        return NextResponse.json(
          { success: false, error: `ธนาคารนี้มีสาขา "${name}" อยู่แล้ว` },
          { status: 409 }
        );
      }
      throw error;
    }
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * PUT — แก้ชื่อ/รหัสสาขา หรือปิดใช้งาน
 *
 * ธนาคารเจ้าของสาขาแก้ไม่ได้: รายการฝากที่ผูกอยู่ถูกตรวจโดย trigger ว่าสาขาต้อง
 * เป็นของธนาคารเดียวกัน ย้ายสาขาข้ามธนาคารจะทำให้หลักฐานเก่าขัดกันเอง
 */
export async function PUT(request: NextRequest) {
  const g = await gate(true);
  if (g.response) return g.response;

  try {
    const supabase = getServiceSupabase();
    const body = await request.json();
    if (!body.id) {
      return NextResponse.json({ success: false, error: 'ไม่พบรายการที่จะแก้ไข' }, { status: 400 });
    }

    if (body.entity === 'bank') {
      const bankUpdates: Record<string, any> = {};
      if (typeof body.name === 'string') {
        const n = body.name.trim();
        if (!n) return NextResponse.json({ success: false, error: 'ชื่อธนาคารว่างไม่ได้' }, { status: 400 });
        bankUpdates.name = n;
      }
      if ('is_active' in body) bankUpdates.is_active = body.is_active === true;
      // รหัสธนาคารแก้ไม่ได้ — ปรากฏในรายงานย้อนหลัง
      if (Object.keys(bankUpdates).length === 0) {
        return NextResponse.json({ success: false, error: 'ไม่มีข้อมูลที่จะแก้ไข' }, { status: 400 });
      }
      const { data: updatedBank, error: bankError } = await supabase
        .from('approved_banks')
        .update(bankUpdates)
        .eq('id', body.id)
        .select()
        .single();
      if (bankError) throw bankError;
      if (!updatedBank) {
        return NextResponse.json({ success: false, error: 'ไม่พบธนาคารนี้' }, { status: 404 });
      }
      await logBankAction(
        g.ctx!,
        request,
        bankUpdates.is_active === false ? 'disable_bank' : 'edit_bank',
        `${updatedBank.name} (${updatedBank.code})`,
        updatedBank.id
      );
      return NextResponse.json({ success: true, data: updatedBank });
    }

    const updates: Record<string, any> = {};
    if (typeof body.name === 'string') {
      const name = body.name.trim();
      if (!name) return NextResponse.json({ success: false, error: 'ชื่อสาขาว่างไม่ได้' }, { status: 400 });
      updates.name = name;
    }
    if ('branch_code' in body) updates.branch_code = String(body.branch_code || '').trim() || null;
    if ('is_active' in body) updates.is_active = body.is_active === true;
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'ไม่มีข้อมูลที่จะแก้ไข' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('bank_branches')
      .update(updates)
      .eq('id', body.id)
      .select()
      .single();
    if (error) {
      if ((error as any).code === '23505') {
        return NextResponse.json({ success: false, error: 'ชื่อสาขานี้ซ้ำกับที่มีอยู่' }, { status: 409 });
      }
      throw error;
    }
    if (!data) return NextResponse.json({ success: false, error: 'ไม่พบสาขานี้' }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
