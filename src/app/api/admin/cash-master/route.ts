import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/admin';
import { forbiddenResponse, requireCapability } from '@/lib/supabase/auth-helpers';
import { getCashCapabilities } from '@/lib/permissions';

/**
 * จัดการข้อมูลหลักของโมดูลเงินสด: สาขาบริษัทที่ไปรับซองเงิน และธนาคารที่อนุมัติ
 *
 * "สาขา" ที่นี่คือ **สาขาบริษัท** (จุดรับซองเงิน) ไม่ใช่สาขาธนาคาร
 * สาขาธนาคารเป็นข้อความอิสระที่แมสเซนเจอร์กรอกตอนบันทึกการนำฝาก
 *
 * สิทธิ์: ธุรการที่อยู่ในแผนกฝ่ายบัญชี/การเงิน (ตาม app_settings) หรือผู้ดูแลระบบ
 * เจตนาให้ฝ่ายบัญชีดูแลข้อมูลชุดนี้เองได้ ไม่ต้องรอฝ่ายไอที
 *
 * **ไม่มี DELETE โดยเจตนา** — ทั้งสองตารางถูกอ้างด้วย FK จากรายการเงินย้อนหลัง
 * ลบแล้วประวัติจะอ่านไม่ออก ปิดใช้งาน (is_active = false) แทน ซึ่งทำให้หายจาก
 * dropdown ทันทีแต่รายการเก่ายังแสดงชื่อได้
 */

type Table = 'branches' | 'approved_banks';

const CODE_PATTERN = /^[A-Za-z0-9._-]{1,50}$/;

function resolveTable(value: unknown): Table | null {
  if (value === 'branches' || value === 'approved_banks') return value;
  return null;
}

/** ธุรการบัญชีขึ้นไป — ผู้ใช้ทั่วไปในแผนกบัญชีดูได้แต่แก้ไม่ได้ */
async function requireCashMasterEditor() {
  const auth = await requireCapability({});
  if (auth.response) return { response: auth.response, ctx: null };
  const ctx = auth.context!;
  const caps = await getCashCapabilities(ctx);
  const isEditor =
    ctx.profile.role === 'super_admin' || (ctx.profile.role === 'admin' && caps.canViewCash);
  if (!isEditor) return { response: forbiddenResponse(), ctx: null };
  return { response: null, ctx };
}

// GET — รายชื่อทั้งหมด รวมที่ปิดใช้งานแล้ว (ต่างจาก /api/messenger/lookups
// ที่คืนเฉพาะที่เปิดใช้งาน เพราะหน้านั้นเอาไปทำ dropdown ให้แมสเซนเจอร์)
export async function GET() {
  const gate = await requireCashMasterEditor();
  if (gate.response) return gate.response;

  try {
    const supabase = getServiceSupabase();
    const [{ data: branches }, { data: banks }, { data: departments }] = await Promise.all([
      supabase.from('branches').select('*').order('code'),
      supabase.from('approved_banks').select('*').order('name'),
      supabase.from('departments').select('id, name, code').order('code'),
    ]);

    // นับการใช้งานจริง เพื่อบอกผู้ใช้ได้ว่ารายการไหนมีประวัติผูกอยู่แล้ว
    const { data: usedBranches } = await supabase.from('cash_pickups').select('branch_id');
    const { data: usedBanks } = await supabase.from('bank_deposits').select('bank_id');
    const branchUse = new Map<string, number>();
    for (const r of usedBranches || []) {
      branchUse.set((r as any).branch_id, (branchUse.get((r as any).branch_id) || 0) + 1);
    }
    const bankUse = new Map<string, number>();
    for (const r of usedBanks || []) {
      bankUse.set((r as any).bank_id, (bankUse.get((r as any).bank_id) || 0) + 1);
    }

    return NextResponse.json({
      success: true,
      data: {
        branches: (branches || []).map((b: any) => ({ ...b, usage_count: branchUse.get(b.id) || 0 })),
        banks: (banks || []).map((b: any) => ({ ...b, usage_count: bankUse.get(b.id) || 0 })),
        departments: departments || [],
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST — เพิ่มรายการใหม่
export async function POST(request: NextRequest) {
  const gate = await requireCashMasterEditor();
  if (gate.response) return gate.response;

  try {
    const supabase = getServiceSupabase();
    const body = await request.json();
    const table = resolveTable(body.table);
    if (!table) {
      return NextResponse.json({ success: false, error: 'ระบุประเภทข้อมูลไม่ถูกต้อง' }, { status: 400 });
    }

    const name = String(body.name || '').trim();
    const code = String(body.code || '').trim().toUpperCase();
    if (!name) {
      return NextResponse.json({ success: false, error: 'กรุณากรอกชื่อ' }, { status: 400 });
    }
    if (!CODE_PATTERN.test(code)) {
      return NextResponse.json(
        { success: false, error: 'รหัสใช้ได้เฉพาะ A-Z 0-9 . _ - และยาวไม่เกิน 50 ตัวอักษร' },
        { status: 400 }
      );
    }

    const row: Record<string, any> = { name, code, is_active: body.is_active !== false };
    if (table === 'branches') row.department_id = body.department_id || null;

    const { data, error } = await supabase.from(table).insert(row).select().single();
    if (error) {
      if ((error as any).code === '23505') {
        return NextResponse.json({ success: false, error: `รหัส ${code} ถูกใช้แล้ว` }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * PUT — แก้ชื่อ / แผนกที่ดูแล / เปิด-ปิดใช้งาน
 *
 * รหัส (code) แก้ไม่ได้โดยเจตนา: มันเป็นตัวชี้ตัวตนที่ปรากฏในรายงานและหลักฐาน
 * ย้อนหลัง เปลี่ยนแล้วเอกสารเก่าจะอ้างถึงรหัสที่ไม่มีอยู่ ถ้าตั้งรหัสผิดจริง
 * ให้ปิดใช้งานรายการนั้นแล้วสร้างใหม่ ซึ่งทิ้งร่องรอยไว้ทั้งสองรายการ
 */
export async function PUT(request: NextRequest) {
  const gate = await requireCashMasterEditor();
  if (gate.response) return gate.response;

  try {
    const supabase = getServiceSupabase();
    const body = await request.json();
    const table = resolveTable(body.table);
    if (!table || !body.id) {
      return NextResponse.json({ success: false, error: 'ข้อมูลไม่ครบ' }, { status: 400 });
    }

    const updates: Record<string, any> = {};
    if (typeof body.name === 'string') {
      const name = body.name.trim();
      if (!name) return NextResponse.json({ success: false, error: 'ชื่อว่างไม่ได้' }, { status: 400 });
      updates.name = name;
    }
    if ('is_active' in body) updates.is_active = body.is_active === true;
    if (table === 'branches' && 'department_id' in body) {
      updates.department_id = body.department_id || null;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'ไม่มีข้อมูลที่จะแก้ไข' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from(table)
      .update(updates)
      .eq('id', body.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ success: false, error: 'ไม่พบรายการนี้' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
