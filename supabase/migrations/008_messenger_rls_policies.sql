-- ============================================================
-- RLS สำหรับโมดูลเงินสด
--
-- ข้อควรเข้าใจ: ทุก API route ใช้ service-role client ซึ่ง bypass RLS ทั้งหมด
-- policy ในไฟล์นี้จึงคุมเฉพาะการอ่านตรงจาก browser (anon/authenticated key)
-- ไม่ใช่กลไก integrity ของยอดเงิน — อันนั้นอยู่ใน CHECK + TRIGGER ของ 007
--
-- หลักการ: ตารางเงินให้ SELECT เท่าที่จำเป็น และ **ไม่ให้ INSERT/UPDATE/DELETE
-- กับใครเลยผ่าน RLS** การเขียนต้องผ่าน API route ที่ audit ครบเท่านั้น
-- ============================================================

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE approved_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE messenger_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messenger_job_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_pickups ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_variance_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_variance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE messenger_job_audit ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- helper: ใครดูข้อมูลการเงินได้ / ใครเป็นแมสเซนเจอร์
-- STABLE + SECURITY DEFINER เพื่อไม่ให้ policy วน recursion กับ profiles
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_dept_code()
RETURNS TEXT AS $$
  SELECT d.code
  FROM profiles p
  LEFT JOIN departments d ON d.id = p.department_id
  WHERE p.id = auth.uid() AND p.is_active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_role_name()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid() AND is_active = true;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION can_view_cash()
RETURNS BOOLEAN AS $$
  SELECT current_role_name() = 'super_admin' OR current_dept_code() IN ('FIN', 'ACC');
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ------------------------------------------------------------
-- ตารางอ้างอิง: ทุกคนที่ล็อกอินอ่านได้ (ต้องใช้ทำ dropdown)
-- เขียนได้เฉพาะ super_admin
-- ------------------------------------------------------------
CREATE POLICY "branches_read_all" ON branches FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "branches_super_admin_write" ON branches FOR ALL USING (
  current_role_name() = 'super_admin'
);
CREATE POLICY "banks_read_all" ON approved_banks FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "banks_super_admin_write" ON approved_banks FOR ALL USING (
  current_role_name() = 'super_admin'
);

-- ------------------------------------------------------------
-- งาน: แมสเซนเจอร์เห็นงานตัวเอง / การเงินเห็นทุกงาน
-- ไม่มี policy INSERT/UPDATE/DELETE — เขียนผ่าน API route เท่านั้น
-- ------------------------------------------------------------
CREATE POLICY "msg_jobs_select" ON messenger_jobs FOR SELECT USING (
  assigned_to = auth.uid() OR created_by = auth.uid() OR can_view_cash()
);

CREATE POLICY "msg_photos_select" ON messenger_job_photos FOR SELECT USING (
  uploaded_by = auth.uid()
  OR can_view_cash()
  OR EXISTS (
    SELECT 1 FROM messenger_jobs j
    WHERE j.id = messenger_job_photos.job_id AND j.assigned_to = auth.uid()
  )
);

CREATE POLICY "cash_pickups_select" ON cash_pickups FOR SELECT USING (
  received_by = auth.uid()
  OR cashier_profile_id = auth.uid()
  OR can_view_cash()
);

-- ------------------------------------------------------------
-- ตารางเงิน: อ่านได้เฉพาะการเงิน + แมสเซนเจอร์ที่เป็นเจ้าของรายการ
-- ยอดเงินของคนอื่นไม่ควรรั่วให้ role user ทั่วไปเห็น
-- ------------------------------------------------------------
CREATE POLICY "bank_deposits_select" ON bank_deposits FOR SELECT USING (
  submitted_by = auth.uid() OR can_view_cash()
);

CREATE POLICY "variance_reports_select" ON cash_variance_reports FOR SELECT USING (
  reported_by = auth.uid() OR can_view_cash()
);

CREATE POLICY "variance_reviews_select" ON cash_variance_reviews FOR SELECT USING (
  reviewed_by = auth.uid()
  OR can_view_cash()
  OR EXISTS (
    SELECT 1 FROM cash_variance_reports p
    WHERE p.id = cash_variance_reviews.report_id AND p.reported_by = auth.uid()
  )
);

-- audit อ่านได้เฉพาะการเงิน — ประวัติทั้งหมดของเงินไม่ใช่ข้อมูลสาธารณะ
CREATE POLICY "msg_audit_select" ON messenger_job_audit FOR SELECT USING (can_view_cash());

-- ------------------------------------------------------------
-- view สำหรับรายงาน — mask เลขที่ใบนำฝากเหลือ 4 ตัวท้าย
-- ใช้เวลาส่งข้อมูลออกนอกฝ่ายการเงิน (เช่น CSV ที่แชร์กว้าง)
-- ------------------------------------------------------------
CREATE VIEW bank_deposit_summary AS
SELECT
  d.id,
  d.job_id,
  j.job_no,
  j.branch_id,
  b.name AS bank_name,
  d.bank_branch_name,
  d.status,
  d.slip_status,
  d.expected_total_satang,
  d.actual_amount_satang,
  d.variance_satang,
  CASE
    WHEN d.variance_satang = 0 THEN 'match'
    WHEN d.variance_satang < 0 THEN 'short'
    ELSE 'over'
  END AS variance_kind,
  CASE
    WHEN length(d.reference_no) <= 4 THEN repeat('•', length(d.reference_no))
    ELSE repeat('•', length(d.reference_no) - 4) || right(d.reference_no, 4)
  END AS reference_no_masked,
  d.deposited_at,
  d.submitted_by,
  d.submitted_signature,
  d.created_at
FROM bank_deposits d
JOIN messenger_jobs j ON j.id = d.job_id
JOIN approved_banks b ON b.id = d.bank_id;
