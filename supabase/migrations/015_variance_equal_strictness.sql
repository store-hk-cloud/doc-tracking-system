-- 015_variance_equal_strictness.sql
--
-- "เงินขาดและเงินเกินสำคัญทั้งคู่ เซนสิทีฟหมด"
--
-- เดิม 009 ให้เงินขาดเข้มน้อยกว่าเงินเกิน (เงินขาดใครก็ได้ในแผนกบัญชีปิดได้
-- เงินเกินต้องเป็นธุรการในแผนกผู้อนุมัติ) migration นี้ยก **เงินขาดขึ้นมาใช้
-- กติกาเดียวกับเงินเกิน** ไม่ใช่ลดเงินเกินลงมา
--
-- ทิศทางนี้สำคัญ: การทำให้เท่ากันโดยลดข้างที่เข้มลง จะเป็นการถอดการควบคุมออก
-- หนึ่งชั้นโดยที่ไม่มีใครขอ ส่วนการยกข้างที่หย่อนขึ้นมา เพิ่มการควบคุมทั้งสองทาง
--
-- แก้บั๊กที่หลุดมาจาก 012 ไปพร้อมกัน:
--   assert_variance_approver() เดิมอ่านจุดรับด้วย
--     SELECT * INTO v_pickup FROM cash_pickups WHERE job_id = ...
--   ซึ่งได้แถวเดียวแบบสุ่ม ตอนที่ทริปหนึ่งมีจุดรับเดียวก็ถูกต้องพอดี แต่หลัง 012
--   ที่ทริปหนึ่งเก็บได้หลายสาขา การตรวจ "แคชเชียร์/ผู้รับเงินอนุมัติเองไม่ได้"
--   จะครอบแค่จุดรับเดียว → แคชเชียร์ของจุดที่ 2 อนุมัติผลต่างของทริปนั้นได้
--   ที่นี่เปลี่ยนเป็นตรวจทุกจุดรับด้วย EXISTS

CREATE OR REPLACE FUNCTION assert_variance_approver()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
  v_code TEXT;
  v_report cash_variance_reports;
  v_deposit bank_deposits;
  v_approver_codes TEXT[];
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

  v_approver_codes := cash_setting_codes('cash_approver_dept_codes', '0-ADM03');

  -- *** สิทธิ์เดียวกันทั้งเงินขาดและเงินเกิน ***
  -- ทั้งสองกรณีคือเงินของบริษัทไม่ตรงกับหลักฐาน จึงต้องผ่านผู้อนุมัติระดับเดียวกัน
  IF NOT (v_role = 'super_admin' OR (v_role = 'admin' AND v_code = ANY(v_approver_codes))) THEN
    RAISE EXCEPTION
      'only super_admin or an admin in departments % may decide a cash variance (kind=%, got role=%, dept=%)',
      v_approver_codes, v_report.variance_kind, v_role, v_code;
  END IF;

  -- แยกหน้าที่: ใครที่แตะเงินก้อนนี้มาแล้ว อนุมัติเองไม่ได้
  IF NEW.reviewed_by = v_deposit.submitted_by THEN
    RAISE EXCEPTION 'the messenger who recorded this deposit cannot review its variance';
  END IF;
  IF NEW.reviewed_by = v_report.reported_by THEN
    RAISE EXCEPTION 'the person who filed this variance report cannot review it';
  END IF;
  -- ตรวจ **ทุกจุดรับ** ของทริป ไม่ใช่จุดเดียว (ดูหมายเหตุหัวไฟล์)
  IF EXISTS (
    SELECT 1 FROM cash_pickups
    WHERE job_id = v_deposit.job_id AND received_by = NEW.reviewed_by
  ) THEN
    RAISE EXCEPTION 'the messenger who received the cash cannot review its variance';
  END IF;
  IF EXISTS (
    SELECT 1 FROM cash_pickups
    WHERE job_id = v_deposit.job_id
      AND cashier_profile_id IS NOT NULL
      AND cashier_profile_id = NEW.reviewed_by
  ) THEN
    RAISE EXCEPTION 'a cashier who handed over cash on this run cannot review its variance';
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

-- ล็อกที่ระดับ CHECK ให้ครอบทั้งสองทิศทางเช่นกัน
-- เดิมชื่อ bank_deposits_overage_lock และตรวจเฉพาะ variance > 0
-- ตอนนี้ผลต่างทุกทิศทางไปสถานะจบไม่ได้ถ้าไม่มีใบอนุมัติจริง
ALTER TABLE bank_deposits DROP CONSTRAINT IF EXISTS bank_deposits_overage_lock;
ALTER TABLE bank_deposits
  ADD CONSTRAINT bank_deposits_variance_lock
  CHECK (variance_satang = 0
         OR status IN ('recorded', 'variance_pending', 'voided')
         OR resolved_review_id IS NOT NULL);

COMMENT ON CONSTRAINT bank_deposits_variance_lock ON bank_deposits IS
  'ผลต่างทั้งขาดและเกินไปสถานะจบไม่ได้ถ้าไม่มี resolved_review_id (ดู 015) '
  'คู่กับ trigger ที่ตรวจว่าใบอนุมัตินั้นเป็นของรายการนี้จริง (ดู 014)';
