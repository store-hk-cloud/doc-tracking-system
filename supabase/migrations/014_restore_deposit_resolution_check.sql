-- 014_restore_deposit_resolution_check.sql
--
-- แก้การถดถอยที่เกิดจาก 012/013
--
-- migration 012 และ 013 เขียน bank_deposits_guard() ใหม่ทั้งฟังก์ชัน (เพื่อเพิ่ม
-- reference_no_source และ bank_branch_name เข้าไปในรายการ write-once) แต่ตอนคัดลอก
-- เนื้อฟังก์ชันเดิมมา **ตกบล็อกสุดท้ายของ 007 ไป** ซึ่งเป็นบล็อกที่ตรวจว่า
-- ใบอนุมัติที่ใช้ปลดล็อกรายการเงินเกิน เป็นใบอนุมัติของรายการนั้นจริง
--
-- ผลของการตกบล็อกนี้: เอาใบอนุมัติของ "รายการอื่น" มาปิดรายการเงินเกินได้
-- ซึ่งทำลายการล็อกเงินเกินทั้งหมด — อนุมัติเงินเกิน 20 บาทหนึ่งครั้ง แล้วนำ
-- ใบเดียวกันไปปิดรายการเงินเกิน 20,000 บาทได้ CHECK bank_deposits_overage_lock
-- ตรวจแค่ว่า "มี resolved_review_id" ไม่ได้ตรวจว่าเป็นของใคร
--
-- ตรวจพบด้วย scripts/verify-cash-triggers.mjs ข้อ 10 (38 ผ่าน / 1 ไม่ผ่าน)
-- ยังไม่มีข้อมูลจริงในระบบตอนที่พบ จึงไม่มีรายการใดถูกปิดผิดวิธี
--
-- บทเรียนที่เขียนไว้กันซ้ำ: ถ้าต้องแก้ฟังก์ชัน guard เหล่านี้อีก ให้แก้แบบเพิ่ม
-- เงื่อนไขทีละข้อ อย่าคัดลอกฟังก์ชันทั้งก้อนมาแก้ และรัน verify-cash-triggers.mjs
-- ทุกครั้งก่อน push

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
  -- เติม bank_branch_id ได้ครั้งเดียว (กรณีผูกรายการเก่าเข้ารายชื่อสาขาภายหลัง)
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

  -- *** บล็อกที่ 012/013 ทำตกไป — หัวใจของการล็อกเงินเกิน ***
  -- ปลดล็อกออกจาก variance_pending ต้องมีใบอนุมัติที่เป็นของรายการนี้จริง
  -- และต้องเป็นใบที่ "อนุมัติ" ไม่ใช่ใบที่ตีกลับหรือไม่อนุมัติ
  IF OLD.status = 'variance_pending' AND NEW.status = 'variance_resolved' THEN
    IF NEW.resolved_review_id IS NULL THEN
      RAISE EXCEPTION 'cannot resolve a variance without a review record';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM cash_variance_reviews r
      JOIN cash_variance_reports p ON p.id = r.report_id
      WHERE r.id = NEW.resolved_review_id
        AND p.deposit_id = OLD.id
        AND r.decision = 'approved'
    ) THEN
      RAISE EXCEPTION 'review % does not approve a variance report of deposit %',
        NEW.resolved_review_id, OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
