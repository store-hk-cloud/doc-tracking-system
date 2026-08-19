-- ใบรับสินค้าเลือกหน่วยงานกำกับได้หลายหน่วยงาน แต่มีปลายทาง workflow เดียว
-- (คลังสินค้า/FAC-PP → จัดซื้อ → ACC/บัญชี) จึงแยก metadata ออกจาก recipient task.
BEGIN;

CREATE TABLE IF NOT EXISTS document_department_tags (
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_document_department_tags_department
  ON document_department_tags(department_id);

-- เก็บหน่วยงานที่เคยเลือกไว้กับใบรับสินค้าเก่าเป็น metadata โดยไม่เปลี่ยนสถานะงานเดิม
INSERT INTO document_department_tags (document_id, department_id)
SELECT dr.document_id, dr.department_id
FROM document_recipients dr
JOIN documents d ON d.id = dr.document_id
WHERE d.subject = 'ใบรับสินค้า'
ON CONFLICT (document_id, department_id) DO NOTHING;

COMMIT;
