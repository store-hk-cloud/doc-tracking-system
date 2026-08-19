export const GOODS_RECEIPT_SUBJECT = 'ใบรับสินค้า';
export const ACCOUNTING_DEPARTMENT_CODE = '0-ADM03';
export const PURCHASING_DEPARTMENT_CODE = '0-BSN10';
export const INSPECTOR_DEPARTMENT_CODES = ['0-ADM04', '0-PDT01'] as const;

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
