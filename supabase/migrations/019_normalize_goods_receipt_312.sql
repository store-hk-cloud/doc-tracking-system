-- ปรับเอกสารทดสอบ #312 ตาม workflow ใหม่ที่มี recipient task เดียวคือ ACC/บัญชี
-- เก็บ snapshot ทุกแถวก่อนรีเซ็ต เพื่อให้ตรวจสอบหรือกู้ข้อมูลเก่าได้.
BEGIN;

INSERT INTO document_workflow_archive (
  archive_reason, document_id, document_recipient_id,
  document_snapshot, recipient_snapshot, delivery_logs_snapshot
)
SELECT
  'normalize_goods_receipt_312_to_static_routing',
  d.id,
  dr.id,
  to_jsonb(d),
  to_jsonb(dr),
  COALESCE(jsonb_agg(to_jsonb(dl)) FILTER (WHERE dl.id IS NOT NULL), '[]'::jsonb)
FROM documents d
JOIN document_recipients dr ON dr.document_id = d.id
LEFT JOIN delivery_logs dl ON dl.document_recipient_id = dr.id
WHERE d.running_no = 312
  AND d.subject = 'ใบรับสินค้า'
GROUP BY d.id, dr.id;

DELETE FROM delivery_logs dl
USING documents d, document_recipients dr
WHERE d.id = dr.document_id
  AND dl.document_recipient_id = dr.id
  AND d.running_no = 312
  AND d.subject = 'ใบรับสินค้า';

DELETE FROM document_recipients dr
USING documents d, departments dep
WHERE d.id = dr.document_id
  AND dep.id = dr.department_id
  AND d.running_no = 312
  AND d.subject = 'ใบรับสินค้า'
  AND dep.code <> '0-ADM03';

UPDATE document_recipients dr
SET
  status = 'awaiting_inspector',
  inspector_signature = NULL,
  inspector_signed_by = NULL,
  inspector_signed_at = NULL,
  purchasing_signature = NULL,
  purchasing_signed_by = NULL,
  purchasing_signed_at = NULL
FROM documents d, departments dep
WHERE d.id = dr.document_id
  AND dep.id = dr.department_id
  AND d.running_no = 312
  AND d.subject = 'ใบรับสินค้า'
  AND dep.code = '0-ADM03';

UPDATE documents d
SET recipient_dept_id = dep.id
FROM departments dep
WHERE d.running_no = 312
  AND d.subject = 'ใบรับสินค้า'
  AND dep.code = '0-ADM03';

COMMIT;
