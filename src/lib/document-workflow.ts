export const GOODS_RECEIPT_SUBJECT = 'ใบรับสินค้า';
export const WITHDRAWAL_SLIP_SUBJECT = 'ใบเบิก';
export const ACCOUNTING_DEPARTMENT_CODE = '0-ADM03';
export const WITHDRAWAL_ACCOUNTING_DEPARTMENT_CODE = '0-ADM03-1';
export const PURCHASING_DEPARTMENT_CODE = '0-BSN10';
export const INSPECTOR_DEPARTMENT_CODES = ['0-ADM04', '0-PDT01'] as const;

/**
 * เอกสารที่ต้องมีฝ่ายบัญชีเป็นปลายทางหลักเสมอ — และ "ฝ่ายบัญชี" ไม่ใช่หน่วยงาน
 * เดียวกันทุกประเภท
 *
 * ใบเบิกไปที่ ACC/บัญชี ใบเบิก-ใบรับ (0-ADM03-1) ซึ่งเป็นทีมที่ดูแลใบเบิกจริง
 * ส่วนใบรับสินค้าไปที่ ACC/บัญชี (0-ADM03) ซึ่งเป็นด่านปิดงานของ workflow สามด่าน
 *
 * ก่อนหน้านี้โค้ดถือว่ามีบัญชีหน่วยงานเดียวแล้วล็อกทุกประเภทไปที่ 0-ADM03
 * ใบเบิกจึงไปโผล่ผิดทีม — ทีมที่รับผิดชอบไม่เห็นงานของตัวเอง
 *
 * ห้ามประกาศ set/แผนที่นี้ซ้ำในไฟล์อื่น: เดิม register/page.tsx และ
 * api/documents/route.ts ถือสำเนาของตัวเองคนละชุด ซึ่งเป็นเหตุที่ความผิดพลาด
 * แบบนี้กระจายไปสองที่พร้อมกัน
 */
export const ACCOUNTING_DESTINATION_BY_SUBJECT: Record<string, string> = {
  [WITHDRAWAL_SLIP_SUBJECT]: WITHDRAWAL_ACCOUNTING_DEPARTMENT_CODE,
  [GOODS_RECEIPT_SUBJECT]: ACCOUNTING_DEPARTMENT_CODE,
};

/** รหัสหน่วยงานบัญชีทุกตัวที่ถูกใช้เป็นปลายทางบังคับ — ใช้ตอนถอนของเรื่องเดิมออก */
export const ACCOUNTING_DESTINATION_CODES = new Set(Object.values(ACCOUNTING_DESTINATION_BY_SUBJECT));

/** รหัสหน่วยงานบัญชีที่ต้องเป็นปลายทางของเรื่องนี้ — null ถ้าเรื่องนี้เลือกได้อิสระ */
export function accountingDestinationFor(subject: string | null | undefined): string | null {
  return ACCOUNTING_DESTINATION_BY_SUBJECT[String(subject || '').trim()] || null;
}

export function requiresAccountingDestination(subject: string | null | undefined): boolean {
  return accountingDestinationFor(subject) !== null;
}

export type GoodsReceiptWorkflowAction = 'inspector' | 'purchasing' | 'recipient' | null;

export function isGoodsReceipt(subject: string | null | undefined) {
  return subject === GOODS_RECEIPT_SUBJECT;
}

// สิทธิ์ขึ้นกับ "หน่วยงาน" ไม่ใช่ role: คลังสินค้า/FAC-PP เลือกเซ็นได้หนึ่งฝ่าย,
// จากนั้นจัดซื้อ และปิดด้วย ACC/บัญชีเท่านั้น.
export function getGoodsReceiptWorkflowAction(
  departmentCode: string | null | undefined,
  status: string | null | undefined,
): GoodsReceiptWorkflowAction {
  if (!departmentCode || !status) return null;
  if (INSPECTOR_DEPARTMENT_CODES.includes(departmentCode as typeof INSPECTOR_DEPARTMENT_CODES[number])) {
    return ['awaiting_inspector', 'awaiting_purchasing'].includes(status) ? 'inspector' : null;
  }
  if (departmentCode === PURCHASING_DEPARTMENT_CODE) {
    return ['awaiting_purchasing', 'awaiting_recipient'].includes(status) ? 'purchasing' : null;
  }
  if (departmentCode === ACCOUNTING_DEPARTMENT_CODE) {
    return status === 'awaiting_recipient' ? 'recipient' : null;
  }
  return null;
}

export function canViewGoodsReceiptWorkflow(
  departmentCode: string | null | undefined,
  status: string | null | undefined,
) {
  if (getGoodsReceiptWorkflowAction(departmentCode, status)) return true;
  return departmentCode === ACCOUNTING_DEPARTMENT_CODE && ['closed', 'signed', 'rejected'].includes(status || '');
}
