-- ============================================================
-- ปิดช่องเขียนตารางเอกสารตรงจาก browser
--
-- โมดูลเงินสดถูกล็อกไว้แล้วใน 008 ด้วยหลักการ "ไม่ให้ INSERT/UPDATE/DELETE
-- กับใครเลยผ่าน RLS การเขียนต้องผ่าน API route ที่ audit ครบเท่านั้น"
-- แต่โมดูลเอกสารไม่เคยถูกทำแบบเดียวกัน ตรวจข้อมูลจริงพบว่า:
--
--   document_approval_audit   RLS ปิด + anon มี INSERT/UPDATE/DELETE
--   document_department_tags  RLS ปิด + anon มี INSERT/UPDATE/DELETE
--   documents                 policy เขียนเป็น auth.role() = 'authenticated'
--   delivery_logs             policy เขียนเป็น auth.role() = 'authenticated'
--
-- anon key ฝังอยู่ในหน้าเว็บ (NEXT_PUBLIC_SUPABASE_ANON_KEY) ใครก็อ่านได้
-- ยิงทดสอบแล้ว: insert เข้า document_approval_audit ด้วย anon key ผ่านด่านสิทธิ์
-- (ตกที่ FK ไม่ใช่ที่ permission) = ใครบนอินเทอร์เน็ตก็ปลอมหลักฐานการเซ็นได้
-- ส่วน documents/delivery_logs ผู้ใช้ที่ล็อกอินแล้ว "คนไหนก็ได้" ลบเอกสารหรือ
-- แก้ลายเซ็นผู้รับได้ตรง ๆ ผ่าน PostgREST โดยข้ามการตรวจสิทธิ์ทั้งหมดใน API route
--
-- ที่นี่ตัดเฉพาะสิทธิ์ "เขียน" ออก และคง policy อ่านไว้ทั้งหมด
-- ปลอดภัยเพราะฝั่ง browser แตะแค่ตาราง departments (ดู register/page.tsx)
-- ทุกการอ่าน/เขียนของแอปจริงไปทาง API route ที่ใช้ service-role ซึ่งข้าม RLS
-- ============================================================

-- ── ตารางที่ไม่มี RLS เลย: เปิด RLS โดยไม่ใส่ policy = service-role เท่านั้น ──
ALTER TABLE document_approval_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_department_tags ENABLE ROW LEVEL SECURITY;

-- GRANT ยังเปิดอยู่จาก default ของ Supabase ถอนสิทธิ์เขียนออกให้ชัดอีกชั้น
-- (RLS กันอยู่แล้ว แต่ถอน GRANT ทำให้ไม่ต้องพึ่ง RLS ชั้นเดียว)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON document_approval_audit FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON document_department_tags FROM anon, authenticated;

-- ── documents: ถอน policy เขียนแบบเปิดกว้าง คงเฉพาะการอ่าน ──
DROP POLICY IF EXISTS documents_insert_auth ON documents;
DROP POLICY IF EXISTS documents_update_auth ON documents;
DROP POLICY IF EXISTS documents_delete_auth ON documents;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON documents FROM anon, authenticated;

-- ── delivery_logs: ลายเซ็นผู้รับและการยืนยันปิดงานอยู่ในตารางนี้ ──
DROP POLICY IF EXISTS delivery_insert_auth ON delivery_logs;
DROP POLICY IF EXISTS delivery_update_auth ON delivery_logs;
DROP POLICY IF EXISTS delivery_delete_auth ON delivery_logs;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON delivery_logs FROM anon, authenticated;

-- ── document_recipients: policy เดิมเป็น FOR ALL ให้ admin ──
-- แยกเป็น SELECT อย่างเดียว เพื่อคงการอ่านของ admin ไว้แต่ตัดการเขียนออก
DROP POLICY IF EXISTS doc_recipients_admin_all ON document_recipients;
CREATE POLICY doc_recipients_admin_select ON document_recipients FOR SELECT USING (
  auth.uid() IN (
    SELECT profiles.id FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role::text = ANY (ARRAY['super_admin'::text, 'admin'::text])
  )
);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON document_recipients FROM anon, authenticated;

COMMENT ON TABLE document_approval_audit IS
  'หลักฐานการเซ็นรายด่าน — เขียนได้เฉพาะ service-role ผ่าน API route (ดู 023)';
