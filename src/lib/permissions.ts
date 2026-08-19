import type { AuthContext } from '@/lib/supabase/auth-helpers';
import { getCashDeptCodes } from '@/lib/cash-settings';

/**
 * ชั้น capability ฝั่ง server สำหรับโมดูลเงินสด
 *
 * ทำไมต้องมีไฟล์นี้: `profiles.role` ถูก pin ด้วย CHECK constraint ไว้ที่
 * super_admin | admin | user และจะไม่เพิ่ม role ใหม่ ดังนั้นสิทธิ์ของ
 * แมสเซนเจอร์/การเงิน จึงต้องมาจาก `departments.code`
 *
 * รหัสแผนกไม่ได้ hardcode แต่อ่านจาก app_settings (ดู src/lib/cash-settings.ts)
 * ซึ่งเป็นค่าชุดเดียวกับที่ trigger ใน DB ใช้ ทั้งสองชั้นจึงไม่หลุดจากกัน
 *
 * หมายเหตุ: `canAccessDepartment()` เดิมเป็น strict equality ซึ่งทำให้
 * admin/super_admin fail ด้วย — ห้ามใช้กับโมดูลนี้ ให้ใช้ฟังก์ชันในไฟล์นี้
 *
 * และกฎเหล่านี้เป็นเพียงชั้นแรก การล็อกจริงอยู่ใน CHECK + TRIGGER ของ
 * migration 007/009 ซึ่งอ่าน role/dept สด ๆ จาก DB จึงปลอมผ่าน body ไม่ได้
 */

type Ctx = AuthContext | null | undefined;

export type CashCapabilities = {
  isMessenger: boolean;
  canViewCash: boolean;
  canCloseShortage: boolean;
  canApproveOverage: boolean;
};

export const NO_CAPABILITIES: CashCapabilities = {
  isMessenger: false,
  canViewCash: false,
  canCloseShortage: false,
  canApproveOverage: false,
};

/**
 * คำนวณสิทธิ์ทั้งชุดในครั้งเดียว — เรียกครั้งเดียวต่อ request แล้วส่งต่อ
 * ดีกว่าเรียกฟังก์ชันแยกทีละอันซึ่งจะอ่านค่าตั้งซ้ำ
 */
export async function getCashCapabilities(ctx: Ctx): Promise<CashCapabilities> {
  if (!ctx) return NO_CAPABILITIES;

  const codes = await getCashDeptCodes();
  const { role, department_code: dept } = ctx.profile;
  const isSuper = role === 'super_admin';
  const inList = (list: string[]) => !!dept && list.includes(dept);

  // เงินขาดและเงินเกินสำคัญเท่ากัน จึงใช้กติกาเดียวกันและเป็นกติกาที่เข้มกว่า:
  // ต้องเป็น admin ในแผนกผู้อนุมัติ หรือ super_admin เท่านั้น
  //
  // คงสองคีย์แยกไว้โดยเจตนา (ไม่รวมเป็นคีย์เดียว) เพราะหน้าจอและ route อ้างอิง
  // ชื่อเหล่านี้อยู่ และการแยกชื่อทำให้ย้อนกลับไปให้เงินขาดหย่อนกว่าได้ในภายหลัง
  // โดยแก้ที่นี่จุดเดียว — แต่ถ้าแก้ ต้องแก้ trigger assert_variance_approver ด้วย
  // ไม่งั้นปุ่มจะเปิดให้กดแล้วฐานข้อมูลปฏิเสธ
  const canDecideVariance = isSuper || (role === 'admin' && inList(codes.cash_approver_dept_codes));

  return {
    isMessenger: inList(codes.messenger_dept_codes),
    canViewCash: isSuper || inList(codes.cash_viewer_dept_codes) || inList(codes.cash_shortage_dept_codes),
    canCloseShortage: canDecideVariance,
    canApproveOverage: canDecideVariance,
  };
}

export async function isMessenger(ctx: Ctx): Promise<boolean> {
  return (await getCashCapabilities(ctx)).isMessenger;
}

export async function canViewCash(ctx: Ctx): Promise<boolean> {
  return (await getCashCapabilities(ctx)).canViewCash;
}

export async function canCloseShortage(ctx: Ctx): Promise<boolean> {
  return (await getCashCapabilities(ctx)).canCloseShortage;
}

export async function canApproveOverage(ctx: Ctx): Promise<boolean> {
  return (await getCashCapabilities(ctx)).canApproveOverage;
}

/** สร้างงานฝากเงินได้ — แมสเซนเจอร์เอง หรือฝ่ายการเงินสั่งงานให้ */
export async function canCreateCashJob(ctx: Ctx): Promise<boolean> {
  const c = await getCashCapabilities(ctx);
  return c.isMessenger || c.canViewCash;
}

/** อัปโหลดรูปหลักฐานได้ */
export async function canUploadEvidence(ctx: Ctx): Promise<boolean> {
  const c = await getCashCapabilities(ctx);
  return c.isMessenger || c.canViewCash;
}

/** เห็นงานใบนี้ได้ไหม (แมสเซนเจอร์เห็นงานตัวเอง / การเงินเห็นทุกงาน) */
export function canSeeJobWith(
  caps: CashCapabilities,
  ctx: Ctx,
  job: { assigned_to?: string | null; created_by?: string | null }
): boolean {
  if (!ctx) return false;
  if (caps.canViewCash) return true;
  return job.assigned_to === ctx.user.id || job.created_by === ctx.user.id;
}

export async function canSeeJob(
  ctx: Ctx,
  job: { assigned_to?: string | null; created_by?: string | null }
): Promise<boolean> {
  return canSeeJobWith(await getCashCapabilities(ctx), ctx, job);
}

/** เห็น audit trail ได้ — เฉพาะฝ่ายการเงิน ประวัติเงินไม่ใช่ข้อมูลสาธารณะ */
export async function canReadAudit(ctx: Ctx): Promise<boolean> {
  return (await getCashCapabilities(ctx)).canViewCash;
}
