// ============================================================
// จดหมาย พัสดุ เอกสารภายใน — การควบคุมเอกสาร
// TypeScript Types
// ============================================================

// ── Department ──
export interface Department {
  id: string;
  name: string;
  code: string;
  created_at: string;
}

// ── User Role ──
export type UserRole = 'super_admin' | 'admin' | 'user';

// ── Profile ──
export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  department_id: string;
  department_name?: string;
  /**
   * departments.code — ใช้ตัดสินสิทธิ์ของโมดูลเงินสด (ดู src/lib/capabilities.ts)
   * ต้องใช้ code ไม่ใช่ department_name เพราะชื่อแผนกแก้ได้จาก /admin/departments
   * ถ้า gate ด้วยชื่อ สิทธิ์จะพังเงียบ ๆ เมื่อมีคนเปลี่ยนชื่อแผนก
   */
  department_code?: string;
  /** ชื่อผู้ใช้สำหรับล็อกอินแทนอีเมล (แมสเซนเจอร์) */
  username?: string | null;
  /**
   * สิทธิ์ของโมดูลเงินสด คำนวณที่ server แล้วส่งมากับ /api/profile
   * client อ่านอย่างเดียว ห้ามคำนวณเอง (ดู src/lib/capabilities.ts)
   */
  capabilities?: {
    isMessenger: boolean;
    canViewCash: boolean;
    canCloseShortage: boolean;
    canApproveOverage: boolean;
  };
  is_active: boolean;
  created_at: string;
}

// ── Document Status ──
export type DocumentStatus = 'registered' | 'delivered' | 'signed' | 'closed' | 'rejected';

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  registered: 'ลงทะเบียน',
  delivered: 'ส่งมอบแล้ว',
  signed: 'ลงนามแล้ว',
  closed: 'ปิดงานแล้ว',
  rejected: 'แจ้งปัญหา',
};

export const DOCUMENT_STATUS_COLORS: Record<DocumentStatus, string> = {
  registered: 'status-badge',
  delivered: 'status-badge success',
  signed: 'status-badge success',
  closed: 'status-badge success',
  rejected: 'status-badge error',
};

// ── Document ──
// NOTE: since multi-department support, each "document" a client sees is really
// one document_recipients row flattened with its parent document's shared fields.
// `id` = document_recipients.id (used for sign/deliveries/redeliver/delete),
// `document_id` = the shared documents.id (rarely needed directly by the UI).
export interface Document {
  id: string;
  document_id: string;
  running_no: number;
  received_date: string;
  doc_number: string | null;
  tax_invoice_no: string | null;
  sender: string;
  subject: string;
  recipient_dept_id: string;
  recipient_dept_name?: string;
  inspector_signature: string | null;
  purchasing_signature: string | null;
  note: string | null;
  status: DocumentStatus;
  is_damaged: boolean;
  damage_image_url: string | null;
  recorded_by: string;
  recorded_by_name?: string;
  admin_signature: string | null;
  admin_signed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Delivery Log ──
export interface DeliveryLog {
  id: string;
  document_id: string;
  document?: Document;
  recipient_id: string;
  recipient_name?: string;
  recipient_signature: string;
  recipient_signed_at: string;
  is_verified: boolean;
  verification_note: string | null;
  verified_by_admin: boolean;
  verified_by_admin_at: string | null;
  created_at: string;
}

// ── Auth ──
export interface AuthUser {
  id: string;
  email: string;
  profile: Profile | null;
}

// ── API Response ──
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ── Dashboard Stats ──
export interface DashboardStats {
  total_documents: number;
  today_documents: number;
  registered: number;
  delivered: number;
  signed: number;
  closed: number;
  rejected: number;
  damaged: number;
  by_department: { dept_name: string; count: number }[];
}

// ── Search Filters ──
export interface SearchFilters {
  keyword?: string;
  status?: DocumentStatus | '';
  department_id?: string;
  date_from?: string;
  date_to?: string;
  sender?: string;
}

// ============================================================
// Module การรับ–ส่งเอกสารเงินสด (Messenger Cash Handover)
// เงินทุกค่าเป็น "สตางค์" (integer) เท่านั้น ดู src/lib/money.ts
// ============================================================

// ── Reference data ──
export interface Branch {
  id: string;
  name: string;
  code: string;
  department_id?: string | null;
  is_active: boolean;
}

export interface ApprovedBank {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

// ── Job ──
export type MessengerJobKind = 'cash_handover' | 'errand' | 'internal_doc' | 'expense_claim';

export type MessengerJobStatus =
  | 'open'
  | 'picked_up'
  | 'deposited'
  | 'completed'
  | 'pending_review'
  | 'closed'
  | 'cancelled';

export const MESSENGER_JOB_STATUS_LABELS: Record<MessengerJobStatus, string> = {
  open: 'รอรับเงิน',
  picked_up: 'รับเงินแล้ว',
  deposited: 'ฝากแล้ว',
  completed: 'ยอดตรง',
  pending_review: 'รอการเงินตรวจ',
  closed: 'ปิดงานแล้ว',
  cancelled: 'ยกเลิก',
};

export const MESSENGER_JOB_STATUS_COLORS: Record<MessengerJobStatus, string> = {
  open: 'status-badge',
  picked_up: 'status-badge holding',
  deposited: 'status-badge',
  completed: 'status-badge success',
  pending_review: 'status-badge locked',
  closed: 'status-badge success',
  cancelled: 'status-badge error',
};

export interface MessengerJob {
  id: string;
  job_no: number;
  job_kind: MessengerJobKind;
  status: MessengerJobStatus;
  branch_id: string;
  branch_name?: string;
  note: string | null;
  assigned_to: string;
  assigned_to_name?: string;
  created_by: string;
  picked_up_at: string | null;
  deposited_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
  closer_signature: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ── Evidence photos ──
export type PhotoKind = 'payin_slip' | 'cash_envelope' | 'deposit_slip' | 'variance_doc' | 'other';

export interface MessengerJobPhoto {
  id: string;
  job_id: string;
  photo_kind: PhotoKind;
  drive_file_id: string | null;
  view_link: string;
  caption: string | null;
  taken_lat: number | null;
  taken_lng: number | null;
  uploaded_by: string;
  uploader_signature: string;
  created_at: string;
}

// ── SCREEN 1: จุดรับเงินจากแคชเชียร์ ──
export interface CashPickup {
  id: string;
  job_id: string;
  branch_id: string;
  branch_name?: string;
  cashier_profile_id: string | null;
  cashier_name: string;
  envelope_count: number;
  payin_amount_satang: number;
  payin_photo_id: string;
  payin_photo_link?: string;
  picked_up_at: string;
  lat: number | null;
  lng: number | null;
  gps_accuracy_m: number | null;
  received_by: string;
  receiver_signature: string;
  deposit_id: string | null;
  branch_confirmed_at: string | null;
  branch_confirmed_by: string | null;
  branch_confirmed_amount_satang: number | null;
}

// ── SCREEN 2: นำฝากธนาคาร ──
export type BankDepositStatus =
  | 'recorded'
  | 'matched'
  | 'variance_pending'
  | 'variance_resolved'
  | 'voided';

export const BANK_DEPOSIT_STATUS_LABELS: Record<BankDepositStatus, string> = {
  recorded: 'บันทึกแล้ว',
  matched: 'ยอดตรง',
  variance_pending: 'รออนุมัติ',
  variance_resolved: 'ปิดยอดต่างแล้ว',
  voided: 'ยกเลิกรายการ',
};

export interface BankDeposit {
  id: string;
  job_id: string;
  status: BankDepositStatus;
  bank_id: string;
  bank_name?: string;
  bank_branch_name: string;
  expected_total_satang: number;
  actual_amount_satang: number;
  /** GENERATED column ใน DB = actual - expected (DB เป็นเจ้าของความจริง) */
  variance_satang: number;
  reference_no: string;
  slip_photo_id: string | null;
  slip_photo_link?: string;
  slip_status: 'pending' | 'attached';
  deposited_at: string;
  submitted_by: string;
  submitted_signature: string;
  resolved_review_id: string | null;
  void_reason: string | null;
  created_at: string;
}

// ── SCREEN 3: รายงานเงินขาด/เกิน ──
export type VarianceKind = 'short' | 'over';

export const VARIANCE_KIND_LABELS: Record<VarianceKind, string> = {
  short: 'เงินขาด',
  over: 'เงินเกิน',
};

export type VarianceCauseCode =
  | 'bank_fee'
  | 'miscount_at_pickup'
  | 'damaged_note_rejected'
  | 'mixed_envelope'
  | 'wrong_account'
  | 'other';

export const VARIANCE_CAUSE_LABELS: Record<VarianceCauseCode, string> = {
  bank_fee: 'ค่าธรรมเนียมธนาคาร',
  miscount_at_pickup: 'นับเงินคลาดเคลื่อนตอนรับ',
  damaged_note_rejected: 'ธนาคารปฏิเสธแบงก์ชำรุด',
  mixed_envelope: 'ซองเงินปนกัน',
  wrong_account: 'ฝากผิดบัญชี',
  other: 'อื่นๆ',
};

export type VarianceReportStatus = 'pending_review' | 'approved' | 'rejected' | 'returned';

export const VARIANCE_REPORT_STATUS_LABELS: Record<VarianceReportStatus, string> = {
  pending_review: 'รอการเงินตรวจ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
  returned: 'ตีกลับให้แก้',
};

export interface CashVarianceReport {
  id: string;
  deposit_id: string;
  variance_satang_snapshot: number;
  variance_kind: VarianceKind;
  cause_code: VarianceCauseCode;
  cause_detail: string;
  reported_by: string;
  reporter_signature: string;
  reported_at: string;
  status: VarianceReportStatus;
}

export interface CashVarianceReview {
  id: string;
  report_id: string;
  decision: 'approved' | 'rejected' | 'returned';
  variance_satang_at_decision: number;
  actual_amount_satang_at_decision: number;
  reason: string;
  slip_checked: boolean;
  reviewed_by: string;
  reviewer_signature: string;
  reviewer_role: string;
  reviewer_dept_code: string | null;
  created_at: string;
}

// ── Audit ──
export interface MessengerJobAuditEntry {
  id: number;
  job_id: string;
  entity: 'job' | 'pickup' | 'deposit' | 'variance_report' | 'variance_review' | 'photo';
  entity_id: string | null;
  action: string;
  from_status: string | null;
  to_status: string | null;
  amount_satang: number | null;
  variance_satang: number | null;
  reason: string | null;
  actor_id: string;
  actor_signature: string;
  actor_role: string;
  actor_dept_code: string | null;
  created_at: string;
}

// ── มุมมองรวมของงานหนึ่งใบ (ที่ /api/messenger/runs/[id] คืนกลับมา) ──
export interface CashRunDetail {
  job: MessengerJob;
  pickup: CashPickup | null;
  deposit: BankDeposit | null;
  report: CashVarianceReport | null;
  reviews: CashVarianceReview[];
  photos: MessengerJobPhoto[];
  audit?: MessengerJobAuditEntry[];
}

// ── สรุปประจำวันของฝ่ายการเงิน ──
export interface CashDailySummary {
  date: string;
  received_satang: number;
  deposited_satang: number;
  /** เงินสดที่ยังอยู่ในมือแมสเซนเจอร์ (รับแล้วแต่ยังไม่ฝาก) — ตัวชี้วัดที่ต้องดูทุกเย็น */
  in_hand_satang: number;
  short_satang: number;
  over_satang: number;
  pending_review_count: number;
  awaiting_slip_count: number;
  awaiting_branch_confirm_count: number;
  job_count: number;
}
