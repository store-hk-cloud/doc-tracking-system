-- 012_envelope_pickup_and_multi_stop_runs.sql
--
-- ปรับตัวแบบข้อมูลให้ตรงกับงานจริงตามที่ฝ่ายบัญชีแจ้ง 4 ข้อ
--
-- (1)(2) ใบ Pay-in อยู่ "ข้างในซอง" แมสเซนเจอร์แกะไม่ได้จนถึงเคาน์เตอร์ธนาคาร
--        ตอนรับของจึงอ่านยอดได้จาก **หน้าซอง** เท่านั้น และถ่ายรูปได้แค่ซอง
--        สคีมาเดิมตั้งชื่อว่า payin_amount / payin_photo ซึ่งทำให้คนอ่านฐานข้อมูล
--        ในอนาคตเข้าใจผิดว่ายอดนี้มาจากใบ Pay-in — เปลี่ยนชื่อให้ตรงความจริง
--        (ตารางยังไม่มีข้อมูลจริงแม้แถวเดียว การเปลี่ยนชื่อจึงไม่มีความเสี่ยง)
--
-- (3)    ใบ Pay-in ไม่มีเลขรันมาให้ ระบบต้องออกเลขอ้างอิงเองได้
--        เพิ่ม reference_no_source เพื่อให้แยกออกว่าเลขไหนมาจากธนาคารจริง
--        (กระทบยอดกับ statement ได้) เลขไหนระบบออกเอง (กระทบยอดไม่ได้)
--        ถ้าไม่แยกไว้ ภายหลังจะไม่มีใครรู้ว่าเลขไหนเชื่อถือได้
--
-- (4)    งานจริงคือเก็บซองจากหลายจุดในทริปเดียวแล้วฝากรวมครั้งเดียว
--        สคีมาเดิมบังคับ 1 งาน = 1 จุดรับ ด้วย uq_cash_pickups_job
--        ต้องถอด index นั้นออก และให้ messenger_jobs.branch_id เป็น NULL ได้
--        เพราะทริปหนึ่งไม่ผูกกับสาขาเดียวอีกแล้ว — สาขาย้ายไปอยู่ที่ระดับ
--        cash_pickups ซึ่งมี branch_id ของตัวเองอยู่แล้ว
--
--        หมายเหตุ: assert_expected_matches_pickups() เดิม SUM ทุก pickup ของงาน
--        อยู่แล้ว จึงรองรับหลายจุดรับได้ทันทีโดยไม่ต้องแก้

-- ══════════════════════════════════════════════════════════════
-- 1. ยอดและรูป: ใบ Pay-in -> หน้าซอง
-- ══════════════════════════════════════════════════════════════

ALTER TABLE cash_pickups RENAME COLUMN payin_amount_satang TO envelope_amount_satang;
ALTER TABLE cash_pickups RENAME COLUMN payin_photo_id TO envelope_photo_id;

-- CHECK ที่ประกาศแบบ inline ได้ชื่ออัตโนมัติจากชื่อคอลัมน์เดิม
-- เปลี่ยนชื่อตามให้คนอ่าน error ในอนาคตไม่สับสน (ข้ามได้ถ้าไม่พบ)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'cash_pickups'::regclass
      AND conname = 'cash_pickups_payin_amount_satang_check'
  ) THEN
    ALTER TABLE cash_pickups RENAME CONSTRAINT cash_pickups_payin_amount_satang_check
      TO cash_pickups_envelope_amount_satang_check;
  END IF;
END $$;

COMMENT ON COLUMN cash_pickups.envelope_amount_satang IS
  'ยอดเงินที่เขียนไว้บนหน้าซอง (สตางค์) — ไม่ใช่ยอดจากใบ Pay-in ซึ่งอยู่ในซองและแกะดูไม่ได้ตอนรับของ';
COMMENT ON COLUMN cash_pickups.envelope_photo_id IS
  'รูปซองเงินตอนรับมอบ ต้องเป็น photo_kind = cash_envelope';

-- รูปตอนรับของต้องเป็นรูปซอง และต้องเป็นของงานเดียวกัน
-- (เดิมมีการตรวจแบบนี้เฉพาะรูปใบนำฝาก ฝั่ง pickup ไม่มีเลย)
CREATE OR REPLACE FUNCTION assert_envelope_photo_matches_job()
RETURNS TRIGGER AS $$
DECLARE v_job UUID; v_kind TEXT;
BEGIN
  SELECT job_id, photo_kind INTO v_job, v_kind
  FROM messenger_job_photos WHERE id = NEW.envelope_photo_id;
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'envelope_photo_id % does not exist', NEW.envelope_photo_id;
  END IF;
  IF v_job IS DISTINCT FROM NEW.job_id THEN
    RAISE EXCEPTION 'the envelope photo belongs to a different job';
  END IF;
  IF v_kind <> 'cash_envelope' THEN
    RAISE EXCEPTION 'envelope_photo_id must reference a photo of kind cash_envelope, got %', v_kind;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cash_pickups_envelope_photo_matches_job ON cash_pickups;
CREATE TRIGGER cash_pickups_envelope_photo_matches_job
  BEFORE INSERT OR UPDATE ON cash_pickups
  FOR EACH ROW EXECUTE FUNCTION assert_envelope_photo_matches_job();

-- รูปซองก็ต้องกันใช้ซ้ำเหมือนรูปสลิป — ถ่ายซองใบเดิมส่งสองงานไม่ได้
DROP INDEX IF EXISTS uq_msg_photos_slip_hash;
CREATE UNIQUE INDEX uq_msg_photos_evidence_hash
  ON messenger_job_photos(content_sha256)
  WHERE photo_kind IN ('cash_envelope', 'payin_slip', 'deposit_slip')
    AND content_sha256 IS NOT NULL;

-- ชื่อฟิลด์ใน guard ต้องเปลี่ยนตาม ไม่งั้น trigger อ้างคอลัมน์ที่ไม่มีแล้ว
CREATE OR REPLACE FUNCTION cash_pickups_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
    RAISE EXCEPTION 'job_id is immutable';
  END IF;
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'branch_id is immutable once the pickup is recorded';
  END IF;
  -- ยอดหน้าซองคือฐานของการเทียบยอดทั้งหมด แก้ไม่ได้เด็ดขาด
  -- ต้องการแก้ = void งานทั้งใบแล้วสร้างใหม่ ซึ่งทิ้งร่องรอยใน audit
  IF NEW.envelope_amount_satang IS DISTINCT FROM OLD.envelope_amount_satang THEN
    RAISE EXCEPTION 'envelope_amount_satang is write-once; void the job and create a new one instead';
  END IF;
  IF NEW.envelope_photo_id IS DISTINCT FROM OLD.envelope_photo_id THEN
    RAISE EXCEPTION 'the envelope photo is immutable';
  END IF;
  IF NEW.envelope_count IS DISTINCT FROM OLD.envelope_count THEN
    RAISE EXCEPTION 'envelope_count is write-once';
  END IF;
  IF NEW.received_by IS DISTINCT FROM OLD.received_by
     OR NEW.receiver_signature IS DISTINCT FROM OLD.receiver_signature
     OR NEW.picked_up_at IS DISTINCT FROM OLD.picked_up_at THEN
    RAISE EXCEPTION 'the pickup record (who/when) is immutable';
  END IF;
  IF NEW.cashier_profile_id IS DISTINCT FROM OLD.cashier_profile_id
     OR NEW.cashier_name IS DISTINCT FROM OLD.cashier_name THEN
    RAISE EXCEPTION 'the handing cashier is immutable';
  END IF;
  IF OLD.branch_confirmed_at IS NOT NULL
     AND (NEW.branch_confirmed_at IS DISTINCT FROM OLD.branch_confirmed_at
          OR NEW.branch_confirmed_by IS DISTINCT FROM OLD.branch_confirmed_by
          OR NEW.branch_confirmed_amount_satang IS DISTINCT FROM OLD.branch_confirmed_amount_satang) THEN
    RAISE EXCEPTION 'the branch confirmation is write-once';
  END IF;
  IF OLD.deposit_id IS NOT NULL AND NEW.deposit_id IS DISTINCT FROM OLD.deposit_id THEN
    RAISE EXCEPTION 'deposit_id is write-once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assert_expected_matches_pickups()
RETURNS TRIGGER AS $$
DECLARE v_sum BIGINT;
BEGIN
  SELECT COALESCE(SUM(envelope_amount_satang), 0) INTO v_sum
  FROM cash_pickups WHERE job_id = NEW.job_id;
  IF v_sum = 0 THEN
    RAISE EXCEPTION 'cannot record a deposit before any cash pickup exists for job %', NEW.job_id;
  END IF;
  IF NEW.expected_total_satang <> v_sum THEN
    RAISE EXCEPTION 'expected_total_satang (%) does not match the sum of envelope amounts (%)',
      NEW.expected_total_satang, v_sum;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ══════════════════════════════════════════════════════════════
-- 2. หลายจุดรับ -> ฝากรวมครั้งเดียว
-- ══════════════════════════════════════════════════════════════

-- index นี้คือสิ่งเดียวที่บังคับ 1 งาน = 1 จุดรับ
DROP INDEX IF EXISTS uq_cash_pickups_job;
-- ยังต้องเรียกดู pickup ทั้งหมดของงานเป็นชุดได้เร็ว
CREATE INDEX IF NOT EXISTS idx_cash_pickups_job ON cash_pickups(job_id, picked_up_at);
-- กันรับซ้ำสาขาเดิมในทริปเดียวโดยไม่ตั้งใจ (กดปุ่มสองครั้ง / เน็ตกระตุก)
-- ถ้าต้องรับสองรอบจากสาขาเดียวกันจริง ให้เปิดทริปใหม่ เพื่อให้ยอดแยกกันชัด
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_pickups_job_branch
  ON cash_pickups(job_id, branch_id);

-- ทริปหนึ่งไม่ผูกกับสาขาเดียวอีกแล้ว สาขาอยู่ที่ระดับ pickup
ALTER TABLE messenger_jobs ALTER COLUMN branch_id DROP NOT NULL;

COMMENT ON COLUMN messenger_jobs.branch_id IS
  'เลิกใช้กับงาน cash_handover ตั้งแต่ 012 — ทริปหนึ่งเก็บได้หลายสาขา ดู cash_pickups.branch_id'
  ' คงคอลัมน์ไว้สำหรับ job_kind อื่นที่ผูกกับสาขาเดียว';

-- branch_id ยังห้ามแก้หลังตั้งค่าแล้ว แต่ต้องยอมให้เป็น NULL ได้ตั้งแต่ต้น
CREATE OR REPLACE FUNCTION messenger_jobs_guard()
RETURNS TRIGGER AS $$
DECLARE legal BOOLEAN := false;
BEGIN
  IF OLD.branch_id IS NOT NULL AND NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'branch_id is immutable once set';
  END IF;
  IF NEW.job_kind IS DISTINCT FROM OLD.job_kind THEN
    RAISE EXCEPTION 'job_kind is immutable';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'created_by is immutable';
  END IF;
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND OLD.status <> 'open' THEN
    RAISE EXCEPTION 'assigned_to may only change while the job is still open';
  END IF;

  IF NEW.status = OLD.status THEN
    legal := true;
  ELSE
    legal := (OLD.status, NEW.status) IN (
      ('open', 'picked_up'),          ('open', 'cancelled'),
      ('picked_up', 'deposited'),     ('picked_up', 'pending_review'),
      ('picked_up', 'cancelled'),
      ('deposited', 'completed'),     ('deposited', 'pending_review'),
      ('pending_review', 'closed'),   ('pending_review', 'picked_up'),
      ('completed', 'closed')
    );
  END IF;
  IF NOT legal THEN
    RAISE EXCEPTION 'illegal messenger_jobs status transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ══════════════════════════════════════════════════════════════
-- 3. เลขที่ใบนำฝากที่ระบบออกเอง
-- ══════════════════════════════════════════════════════════════

ALTER TABLE bank_deposits
  ADD COLUMN IF NOT EXISTS reference_no_source VARCHAR(10) NOT NULL DEFAULT 'bank'
    CHECK (reference_no_source IN ('bank', 'auto'));

COMMENT ON COLUMN bank_deposits.reference_no_source IS
  'bank = เลขที่อยู่บนหลักฐานของธนาคารจริง กระทบยอดกับ statement ได้ / '
  'auto = ระบบออกเลขให้เพราะหลักฐานไม่มีเลขรัน กระทบยอดกับ statement ไม่ได้';

-- source ก็ต้อง write-once เหมือน reference_no เอง ไม่งั้นเปลี่ยนเลขที่ระบบออก
-- ให้กลายเป็น "เลขจากธนาคาร" ย้อนหลังได้ ซึ่งทำให้หลักฐานอ่านผิด
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

-- ลำดับเลขอ้างอิงที่ระบบออกเอง — ใช้ sequence ไม่ใช่ COUNT(*)+1
-- เพราะสองคนกดฝากพร้อมกันด้วย COUNT จะได้เลขเดียวกันแล้วชน unique index
CREATE SEQUENCE IF NOT EXISTS deposit_auto_ref_seq START 1;

CREATE OR REPLACE FUNCTION next_deposit_auto_ref()
RETURNS TEXT AS $$
  SELECT 'AUTO-' || to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYMMDD')
         || '-' || lpad(nextval('deposit_auto_ref_seq')::TEXT, 5, '0');
$$ LANGUAGE sql VOLATILE;

COMMENT ON FUNCTION next_deposit_auto_ref() IS
  'ออกเลขอ้างอิงรูปแบบ AUTO-YYMMDD-00001 สำหรับกรณีหลักฐานการฝากไม่มีเลขรัน';
