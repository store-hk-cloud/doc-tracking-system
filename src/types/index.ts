// ============================================================
// ระบบรับ-ส่งจดหมายพัสดุ และการควบคุมเอกสาร
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
export interface Document {
  id: string;
  running_no: number;
  received_date: string;
  doc_number: string | null;
  sender: string;
  subject: string;
  recipient_dept_id: string;
  recipient_dept_name?: string;
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