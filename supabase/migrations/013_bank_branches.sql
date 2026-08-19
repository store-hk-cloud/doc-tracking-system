-- 013_bank_branches.sql
--
-- รายชื่อ **สาขาธนาคาร** ที่ใช้นำฝาก ให้ฝ่ายบัญชีดูแลเองได้
--
-- เดิม bank_deposits.bank_branch_name เป็นข้อความอิสระที่แมสเซนเจอร์พิมพ์เอง
-- ผลคือสาขาเดียวกันถูกสะกดหลายแบบ ("มหิดล" / "สาขามหิดล" / "MHD") ซึ่งทำให้
-- จัดกลุ่มรายงานตามสาขาธนาคารไม่ได้เลย และกระทบยอดกับ statement ยากขึ้น
--
-- ทางแก้: มีรายชื่อกลางให้เลือก แต่ **ไม่บังคับ**
--   bank_branch_id  = อ้างรายชื่อกลาง (เส้นทางปกติ ข้อมูลสะอาด)
--   bank_branch_name = ข้อความที่บันทึกจริง เก็บไว้ทุกกรณี
--
-- ทำไมไม่บังคับ: ถ้าแมสเซนเจอร์ไปฝากที่สาขาที่ยังไม่มีในรายชื่อ แล้วระบบ
-- ไม่ยอมให้บันทึก = เงินออกไปแล้วแต่เข้าระบบไม่ได้ ซึ่งเป็นผลลัพธ์ที่แย่ที่สุด
-- ในโมดูลนี้ กรณีนั้นจึงยอมให้พิมพ์เองแล้วขึ้นให้บัญชีเห็นว่า "ไม่อยู่ในรายชื่อ"
-- เพื่อไปเพิ่มรายชื่อภายหลัง

CREATE TABLE IF NOT EXISTS bank_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id UUID NOT NULL REFERENCES approved_banks(id),
  name VARCHAR(255) NOT NULL,
  -- รหัสสาขาของธนาคาร (ถ้ามีบนสมุด/สลิป) ช่วยกระทบยอดกับ statement
  branch_code VARCHAR(50),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ชื่อสาขาห้ามซ้ำภายในธนาคารเดียวกัน (ต่างธนาคารชื่อซ้ำกันได้ตามปกติ)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_branches_bank_name
  ON bank_branches(bank_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS idx_bank_branches_bank
  ON bank_branches(bank_id) WHERE is_active;

DROP TRIGGER IF EXISTS bank_branches_updated_at ON bank_branches;
CREATE TRIGGER bank_branches_updated_at
  BEFORE UPDATE ON bank_branches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE bank_deposits
  ADD COLUMN IF NOT EXISTS bank_branch_id UUID REFERENCES bank_branches(id);

COMMENT ON COLUMN bank_deposits.bank_branch_id IS
  'สาขาธนาคารจากรายชื่อกลาง — NULL หมายถึงแมสเซนเจอร์พิมพ์ชื่อเอง ให้บัญชีตรวจแล้วเพิ่มรายชื่อ';
COMMENT ON COLUMN bank_deposits.bank_branch_name IS
  'ชื่อสาขาธนาคารที่บันทึกจริง มีค่าเสมอ (สำเนาชื่อจากรายชื่อกลาง หรือข้อความที่พิมพ์เอง)';

-- สาขาที่เลือกต้องเป็นสาขาของธนาคารที่เลือก ไม่ใช่ของธนาคารอื่น
CREATE OR REPLACE FUNCTION assert_bank_branch_matches_bank()
RETURNS TRIGGER AS $$
DECLARE v_bank UUID;
BEGIN
  IF NEW.bank_branch_id IS NULL THEN RETURN NEW; END IF;
  SELECT bank_id INTO v_bank FROM bank_branches WHERE id = NEW.bank_branch_id;
  IF v_bank IS NULL THEN
    RAISE EXCEPTION 'bank_branch_id % does not exist', NEW.bank_branch_id;
  END IF;
  IF v_bank IS DISTINCT FROM NEW.bank_id THEN
    RAISE EXCEPTION 'the selected bank branch belongs to a different bank';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bank_deposits_branch_matches_bank ON bank_deposits;
CREATE TRIGGER bank_deposits_branch_matches_bank
  BEFORE INSERT OR UPDATE ON bank_deposits
  FOR EACH ROW EXECUTE FUNCTION assert_bank_branch_matches_bank();

-- สาขาที่ฝากเป็นส่วนหนึ่งของหลักฐาน แก้ย้อนหลังไม่ได้เหมือนยอดและธนาคาร
CREATE OR REPLACE FUNCTION bank_deposits_guard()
RETURNS TRIGGER AS $$
DECLARE legal BOOLEAN := false;
BEGIN
  IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
    RAISE EXCEPTION 'job_id is immutable';
  END IF;
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'currency is immutable';
  END IF;
  IF NEW.actual_amount_satang IS DISTINCT FROM OLD.actual_amount_satang THEN
    RAISE EXCEPTION 'actual_amount_satang is write-once; void this deposit and record a new one instead';
  END IF;
  IF NEW.expected_total_satang IS DISTINCT FROM OLD.expected_total_satang THEN
    RAISE EXCEPTION 'expected_total_satang is write-once';
  END IF;
  IF NEW.reference_no IS DISTINCT FROM OLD.reference_no THEN
    RAISE EXCEPTION 'reference_no is write-once';
  END IF;
  IF NEW.reference_no_source IS DISTINCT FROM OLD.reference_no_source THEN
    RAISE EXCEPTION 'reference_no_source is write-once';
  END IF;
  IF NEW.bank_id IS DISTINCT FROM OLD.bank_id THEN
    RAISE EXCEPTION 'bank_id is write-once';
  END IF;
  IF NEW.bank_branch_name IS DISTINCT FROM OLD.bank_branch_name THEN
    RAISE EXCEPTION 'bank_branch_name is write-once';
  END IF;
  -- ยอมให้เติม bank_branch_id ครั้งเดียวได้ (กรณีบัญชีเพิ่มสาขาเข้ารายชื่อ
  -- ภายหลังแล้วผูกรายการเก่าเข้ากับสาขานั้น) แต่เปลี่ยนของที่ผูกแล้วไม่ได้
  IF OLD.bank_branch_id IS NOT NULL AND NEW.bank_branch_id IS DISTINCT FROM OLD.bank_branch_id THEN
    RAISE EXCEPTION 'bank_branch_id is write-once once linked';
  END IF;
  IF NEW.deposited_at IS DISTINCT FROM OLD.deposited_at
     OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.submitted_signature IS DISTINCT FROM OLD.submitted_signature THEN
    RAISE EXCEPTION 'the deposit record (who/when) is immutable';
  END IF;
  IF OLD.slip_photo_id IS NOT NULL AND NEW.slip_photo_id IS DISTINCT FROM OLD.slip_photo_id THEN
    RAISE EXCEPTION 'the deposit slip photo is immutable once attached';
  END IF;
  IF OLD.resolved_review_id IS NOT NULL
     AND NEW.resolved_review_id IS DISTINCT FROM OLD.resolved_review_id THEN
    RAISE EXCEPTION 'resolved_review_id is write-once';
  END IF;

  IF NEW.status = OLD.status THEN
    legal := true;
  ELSE
    legal := (OLD.status, NEW.status) IN (
      ('recorded', 'matched'),
      ('recorded', 'variance_pending'),
      ('recorded', 'voided'),
      ('variance_pending', 'variance_resolved'),
      ('variance_pending', 'voided'),
      ('matched', 'voided'),
      ('variance_resolved', 'voided')
    );
  END IF;
  IF NOT legal THEN
    RAISE EXCEPTION 'illegal bank_deposits status transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- อ่านได้เฉพาะผ่าน route ที่ตรวจสิทธิ์แล้ว (เหมือนตารางอื่นในโมดูลนี้)
ALTER TABLE bank_branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bank_branches_read" ON bank_branches FOR SELECT USING (
  auth.uid() IS NOT NULL
);
