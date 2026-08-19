-- ============================================================
-- ปรับโมดูลเงินสดให้ตรงกับโครงสร้างองค์กรจริง + ล็อกอินด้วยชื่อผู้ใช้
--
-- ที่มา: หน่วยงานจริงใช้รหัสแบบ 0-ADM03 / 0-BSN06 ไม่ใช่ FIN/ACC ที่ 007
-- hardcode ไว้ ผลคือไม่มีใครอนุมัติเงินได้เลยนอกจาก super_admin
--
-- แก้โดยย้ายรหัสแผนกผู้อนุมัติไปเก็บใน app_settings เพื่อให้เปลี่ยนได้ภายหลัง
-- โดยไม่ต้องแก้ trigger หรือ deploy ใหม่ (ค่าเริ่มต้น = 0-ADM03 ACC/บัญชี)
-- ============================================================

-- ------------------------------------------------------------
-- 1. รหัสแผนกที่มีอำนาจเรื่องเงิน — เก็บเป็นค่าตั้ง ไม่ hardcode
--    เก็บเป็นรายการคั่นด้วย comma เพราะ app_settings.value เป็น TEXT
-- ------------------------------------------------------------
INSERT INTO app_settings (key, value) VALUES
  -- อนุมัติ "เงินเกิน" ได้ (ต้องเป็น role admin ในแผนกนี้ หรือ super_admin)
  ('cash_approver_dept_codes', '0-ADM03'),
  -- ปิด "เงินขาด" ได้ (ทุก role ในแผนกนี้ หรือ super_admin)
  ('cash_shortage_dept_codes', '0-ADM03,0-ADM03-1'),
  -- ดูข้อมูลเงินได้ (อ่านอย่างเดียว)
  ('cash_viewer_dept_codes', '0-ADM03,0-ADM03-1,0-SDM01'),
  -- แผนกแมสเซนเจอร์
  ('messenger_dept_codes', 'MSG')
ON CONFLICT (key) DO NOTHING;

-- helper: อ่านรายการรหัสแผนกจาก app_settings แล้วคืนเป็น array
CREATE OR REPLACE FUNCTION cash_setting_codes(p_key TEXT, p_fallback TEXT)
RETURNS TEXT[] AS $$
  SELECT string_to_array(
    btrim(COALESCE(NULLIF((SELECT value FROM app_settings WHERE key = p_key), ''), p_fallback)),
    ','
  );
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------
-- 2. เปลี่ยน trigger ผู้อนุมัติให้อ่านรหัสจากค่าตั้ง
--    ตรรกะอื่นคงเดิมทั้งหมด (segregation / snapshot / ต้องมีสลิป)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_variance_approver()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
  v_code TEXT;
  v_report cash_variance_reports;
  v_deposit bank_deposits;
  v_pickup cash_pickups;
  v_approver_codes TEXT[];
  v_shortage_codes TEXT[];
BEGIN
  SELECT p.role, d.code INTO v_role, v_code
  FROM profiles p
  LEFT JOIN departments d ON d.id = p.department_id
  WHERE p.id = NEW.reviewed_by AND p.is_active = true;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'reviewer % is not an active profile', NEW.reviewed_by;
  END IF;

  SELECT * INTO v_report FROM cash_variance_reports WHERE id = NEW.report_id FOR UPDATE;
  IF v_report.id IS NULL THEN
    RAISE EXCEPTION 'variance report % not found', NEW.report_id;
  END IF;
  IF v_report.status <> 'pending_review' THEN
    RAISE EXCEPTION 'variance report % is already %', v_report.id, v_report.status;
  END IF;

  SELECT * INTO v_deposit FROM bank_deposits WHERE id = v_report.deposit_id FOR UPDATE;
  SELECT * INTO v_pickup FROM cash_pickups WHERE job_id = v_deposit.job_id;

  v_approver_codes := cash_setting_codes('cash_approver_dept_codes', '0-ADM03');
  v_shortage_codes := cash_setting_codes('cash_shortage_dept_codes', '0-ADM03');

  -- *** สิทธิ์: เงินเกินเข้มกว่าเงินขาด ***
  IF v_report.variance_kind = 'over' THEN
    IF NOT (v_role = 'super_admin' OR (v_role = 'admin' AND v_code = ANY(v_approver_codes))) THEN
      RAISE EXCEPTION 'only super_admin or an admin in departments %  may decide a cash overage (got role=%, dept=%)',
        v_approver_codes, v_role, v_code;
    END IF;
  ELSE
    IF NOT (v_role = 'super_admin' OR v_code = ANY(v_shortage_codes)) THEN
      RAISE EXCEPTION 'only super_admin or staff in departments % may decide a cash shortage (got role=%, dept=%)',
        v_shortage_codes, v_role, v_code;
    END IF;
  END IF;

  -- แยกหน้าที่: ใครที่แตะเงินก้อนนี้มาแล้ว อนุมัติเองไม่ได้
  IF NEW.reviewed_by = v_deposit.submitted_by THEN
    RAISE EXCEPTION 'the messenger who recorded this deposit cannot review its variance';
  END IF;
  IF NEW.reviewed_by = v_report.reported_by THEN
    RAISE EXCEPTION 'the person who filed this variance report cannot review it';
  END IF;
  IF v_pickup.id IS NOT NULL THEN
    IF NEW.reviewed_by = v_pickup.received_by THEN
      RAISE EXCEPTION 'the messenger who received the cash cannot review its variance';
    END IF;
    IF v_pickup.cashier_profile_id IS NOT NULL AND NEW.reviewed_by = v_pickup.cashier_profile_id THEN
      RAISE EXCEPTION 'the cashier who handed over the cash cannot review its variance';
    END IF;
  END IF;

  IF NEW.variance_satang_at_decision IS DISTINCT FROM v_deposit.variance_satang
     OR NEW.actual_amount_satang_at_decision IS DISTINCT FROM v_deposit.actual_amount_satang THEN
    RAISE EXCEPTION 'review snapshot does not match the current deposit amounts';
  END IF;

  IF NEW.decision = 'approved' AND v_deposit.slip_photo_id IS NULL THEN
    RAISE EXCEPTION 'cannot approve a deposit whose slip photo has not been attached yet';
  END IF;

  NEW.reviewer_role := v_role;
  NEW.reviewer_dept_code := v_code;

  UPDATE cash_variance_reports SET status = NEW.decision WHERE id = NEW.report_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 3. สาขาจริง — แมสเซนเจอร์รับเงินได้ทุกสาขา
--    ผูกกับ departments เพื่อให้ notification ตอนรับเงินไปถึงหน่วยงานเจ้าของสาขา
-- ------------------------------------------------------------
-- สาขาตัวอย่างที่ 007 ใส่ไว้ ไม่ใช่ของจริง เอาออกก่อน (ยังไม่มีงานอ้างถึง)
DELETE FROM branches WHERE code IN ('HQ', 'BR01', 'BR02')
  AND NOT EXISTS (SELECT 1 FROM messenger_jobs j WHERE j.branch_id = branches.id);

-- สร้างสาขาจากหน่วยงานสายธุรกิจจริง (0-BSN*) ซึ่งเป็นที่ตั้งที่มีแคชเชียร์
INSERT INTO branches (name, code, department_id)
SELECT d.name, d.code, d.id
FROM departments d
WHERE d.code LIKE '0-BSN%'
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      department_id = EXCLUDED.department_id,
      is_active = true;

-- ------------------------------------------------------------
-- 4. ล็อกอินด้วยชื่อผู้ใช้ (สำหรับแมสเซนเจอร์ที่ไม่มีอีเมลบริษัท)
--
--    Supabase Auth ผูกกับอีเมลเสมอ จึงไม่เปลี่ยนกลไก auth
--    แต่เก็บ username ไว้ที่ profiles แล้วให้ฝั่ง server แปลง
--    username -> email ก่อนเรียก signInWithPassword
--    (บัญชีแบบนี้ใช้อีเมลสังเคราะห์ <username>@msg.hillkoff.local ซึ่งส่งเมลไม่ได้
--     และไม่ต้องส่ง เพราะไม่ใช้ยืนยันตัวตนทางอีเมล)
-- ------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username VARCHAR(64);

-- ห้ามซ้ำแบบไม่สนตัวพิมพ์เล็กใหญ่ กันคนพิมพ์ Somchai/somchai แล้วได้คนละบัญชี
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_username_lower
  ON profiles (lower(username)) WHERE username IS NOT NULL;

-- อนุญาตแค่ a-z 0-9 . _ - ความยาว 3-64 กันช่องว่างและอักขระที่ทำให้สับสน
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_username_format;
ALTER TABLE profiles ADD CONSTRAINT profiles_username_format
  CHECK (username IS NULL OR username ~ '^[a-zA-Z0-9._-]{3,64}$');

COMMENT ON COLUMN profiles.username IS
  'ชื่อผู้ใช้สำหรับล็อกอินแทนอีเมล (แมสเซนเจอร์) ฝั่ง server แปลงเป็นอีเมลก่อนเรียก Supabase Auth';

-- ------------------------------------------------------------
-- 5. ติดตามการแจ้งเตือนเอกสารค้างรับเกิน 24 ชม.
--    ตารางนี้กันการส่งเมลซ้ำทุกครั้งที่ cron ทำงาน
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_overdue_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_recipient_id UUID NOT NULL REFERENCES document_recipients(id) ON DELETE CASCADE,
  -- ระดับการเตือน: 24 ชม., 48 ชม., ... เก็บเป็นชั่วโมงเพื่อขยายภายหลังได้
  threshold_hours INT NOT NULL,
  sent_to TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  UNIQUE (document_recipient_id, threshold_hours)
);

CREATE INDEX IF NOT EXISTS idx_overdue_alerts_recipient
  ON document_overdue_alerts(document_recipient_id);
CREATE INDEX IF NOT EXISTS idx_overdue_alerts_sent
  ON document_overdue_alerts(sent_at DESC);

ALTER TABLE document_overdue_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "overdue_alerts_admin_read" ON document_overdue_alerts FOR SELECT USING (
  auth.uid() IN (SELECT id FROM profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin'))
);

-- ค่าตั้งของการเตือน ปรับได้จากฐานข้อมูลโดยไม่ต้อง deploy
INSERT INTO app_settings (key, value) VALUES
  ('overdue_alert_hours', '24'),
  -- อีเมลที่รับสำเนาทุกฉบับ (เว้นว่างได้)
  ('overdue_alert_cc', '')
ON CONFLICT (key) DO NOTHING;
