-- ใบรับสินค้า: แต่ละหน่วยงานปลายทางต้องผ่านผู้ตรวจสอบ → จัดซื้อ → ผู้รับ
-- เก็บประวัติผู้กดเซ็น/เวลา และ archive รายการค้างเดิมก่อนล้างเพื่อเริ่ม workflow ใหม่
BEGIN;

ALTER TABLE document_recipients
  DROP CONSTRAINT IF EXISTS document_recipients_status_check;

ALTER TABLE document_recipients
  ADD CONSTRAINT document_recipients_status_check
  CHECK (status IN (
    'registered', 'awaiting_inspector', 'awaiting_purchasing', 'awaiting_recipient',
    'delivered', 'signed', 'closed', 'rejected'
  ));

ALTER TABLE document_recipients
  ADD COLUMN IF NOT EXISTS inspector_signed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inspector_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purchasing_signed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchasing_signed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS document_approval_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_recipient_id UUID NOT NULL REFERENCES document_recipients(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('inspector', 'purchasing')),
  action TEXT NOT NULL CHECK (action IN ('signed', 'updated', 'reset')),
  signature TEXT,
  previous_signature TEXT,
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_approval_audit_recipient_created
  ON document_approval_audit(document_recipient_id, created_at DESC);

-- เก็บ snapshot ที่กู้คืนได้ก่อนลบเฉพาะปลายทางใบรับสินค้าที่ยังไม่ปิดงาน
CREATE TABLE IF NOT EXISTS document_workflow_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_reason TEXT NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  document_id UUID NOT NULL,
  document_recipient_id UUID NOT NULL,
  document_snapshot JSONB NOT NULL,
  recipient_snapshot JSONB NOT NULL,
  delivery_logs_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_document_workflow_archive_recipient
  ON document_workflow_archive(document_recipient_id);

INSERT INTO document_workflow_archive (
  archive_reason, document_id, document_recipient_id,
  document_snapshot, recipient_snapshot, delivery_logs_snapshot
)
SELECT
  'clear_pending_goods_receipts_before_approval_workflow',
  d.id,
  dr.id,
  to_jsonb(d),
  to_jsonb(dr),
  COALESCE(jsonb_agg(to_jsonb(dl)) FILTER (WHERE dl.id IS NOT NULL), '[]'::jsonb)
FROM document_recipients dr
JOIN documents d ON d.id = dr.document_id
LEFT JOIN delivery_logs dl ON dl.document_recipient_id = dr.id
WHERE d.subject = 'ใบรับสินค้า'
  AND dr.status IN ('registered', 'delivered', 'signed', 'rejected')
GROUP BY d.id, dr.id;

DELETE FROM delivery_logs dl
USING document_recipients dr, documents d
WHERE dl.document_recipient_id = dr.id
  AND d.id = dr.document_id
  AND d.subject = 'ใบรับสินค้า'
  AND dr.status IN ('registered', 'delivered', 'signed', 'rejected');

DELETE FROM document_recipients dr
USING documents d
WHERE d.id = dr.document_id
  AND d.subject = 'ใบรับสินค้า'
  AND dr.status IN ('registered', 'delivered', 'signed', 'rejected');

-- ลบ parent เฉพาะเมื่อไม่มีปลายทาง (รวมรายการ closed) เหลืออยู่แล้ว
DELETE FROM documents d
WHERE d.subject = 'ใบรับสินค้า'
  AND NOT EXISTS (
    SELECT 1 FROM document_recipients dr WHERE dr.document_id = d.id
  );

COMMIT;
