-- ============================================================
-- Module การรับ–ส่งเอกสารเงินสด (Messenger Cash Handover)
--
-- แมสเซนเจอร์รับเงินสด + ใบ Pay-in จากแคชเชียร์สาขา -> นำฝากธนาคาร
-- -> ระบบเทียบยอดอัตโนมัติ -> ตรงกันปิดงานเอง / ไม่ตรงต้องทำ variance report
--    แล้วรอ Accounting/Finance ปิด (เงินเกินถูกล็อก ต้องผู้อนุมัติเท่านั้น)
--
-- เงินเก็บเป็น BIGINT สตางค์ ห้ามใช้ NUMERIC/float: ทุก route อ่านค่าผ่าน
-- PostgREST ซึ่งส่ง numeric ออกมาเป็น JSON number แล้วกลายเป็น IEEE-754 double
-- ทำให้ variance = 0 เชื่อถือไม่ได้ และจะล็อก "เงินเกิน" แบบ false positive
--
-- ทุก API route ใช้ service-role client ซึ่ง bypass RLS ทั้งหมด ดังนั้นกลไก
-- กันแก้ยอดเงินอยู่ใน CHECK constraint + TRIGGER (ทำงานกับ service-role ด้วย)
-- ไม่ใช่ RLS
-- ============================================================

-- ------------------------------------------------------------
-- 0. แผนกแมสเซนเจอร์ + ตารางอ้างอิง
-- ------------------------------------------------------------
INSERT INTO departments (name, code) VALUES ('แมสเซนเจอร์', 'MSG')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  -- แผนกที่ดูแลสาขานี้ ใช้ส่ง notification ตอนแมสเซนเจอร์รับเงิน
  department_id UUID REFERENCES departments(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE approved_banks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ปรับเปลี่ยนตามสาขาจริงของบริษัท
INSERT INTO branches (name, code) VALUES
  ('สำนักงานใหญ่', 'HQ'),
  ('สาขา 1', 'BR01'),
  ('สาขา 2', 'BR02');

INSERT INTO approved_banks (name, code) VALUES
  ('ธนาคารกสิกรไทย', 'KBANK'),
  ('ธนาคารไทยพาณิชย์', 'SCB'),
  ('ธนาคารกรุงเทพ', 'BBL'),
  ('ธนาคารกรุงไทย', 'KTB'),
  ('ธนาคารกรุงศรีอยุธยา', 'BAY');

-- ------------------------------------------------------------
-- Guard กลาง: ทำให้ตารางเป็น append-only แม้เรียกด้วย service_role
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION forbid_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'table %.% is append-only; % is not permitted',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 1. MESSENGER JOBS — ร่มของทุกงานแมสเซนเจอร์
--    เฟสนี้ทำ UI แค่ cash_handover ส่วน kind อื่นเตรียม constraint ไว้แล้ว
-- ------------------------------------------------------------
CREATE TABLE messenger_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_no SERIAL,
  job_kind VARCHAR(30) NOT NULL DEFAULT 'cash_handover'
    CHECK (job_kind IN ('cash_handover', 'errand', 'internal_doc', 'expense_claim')),
  status VARCHAR(30) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'picked_up', 'deposited', 'completed', 'pending_review', 'closed', 'cancelled')),

  branch_id UUID NOT NULL REFERENCES branches(id),
  note TEXT,

  assigned_to UUID NOT NULL REFERENCES profiles(id),
  created_by UUID NOT NULL REFERENCES profiles(id),

  picked_up_at TIMESTAMPTZ,
  deposited_at TIMESTAMPTZ,

  completed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES profiles(id),
  closer_signature TEXT,

  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES profiles(id),
  cancel_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT messenger_jobs_cancel_reason_required
    CHECK (status <> 'cancelled' OR (cancel_reason IS NOT NULL AND cancelled_by IS NOT NULL)),
  CONSTRAINT messenger_jobs_closed_needs_closer
    CHECK (status <> 'closed' OR (closed_by IS NOT NULL AND closer_signature IS NOT NULL))
);

CREATE INDEX idx_msg_jobs_status ON messenger_jobs(status);
CREATE INDEX idx_msg_jobs_kind ON messenger_jobs(job_kind);
CREATE INDEX idx_msg_jobs_assigned ON messenger_jobs(assigned_to);
CREATE INDEX idx_msg_jobs_branch ON messenger_jobs(branch_id);
CREATE INDEX idx_msg_jobs_created ON messenger_jobs(created_at DESC);
-- คิวงานที่ยังไม่จบของแมสเซนเจอร์คนหนึ่ง (คิวรีที่ร้อนที่สุด)
CREATE INDEX idx_msg_jobs_open_queue ON messenger_jobs(assigned_to, status)
  WHERE status IN ('open', 'picked_up', 'deposited', 'pending_review');

CREATE TRIGGER messenger_jobs_updated_at
  BEFORE UPDATE ON messenger_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- งานลบไม่ได้ ยกเลิกได้เท่านั้น (บล็อก service_role ด้วย)
CREATE TRIGGER messenger_jobs_no_delete
  BEFORE DELETE ON messenger_jobs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE OR REPLACE FUNCTION messenger_jobs_guard()
RETURNS TRIGGER AS $$
DECLARE legal BOOLEAN := false;
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'branch_id is immutable once the job exists';
  END IF;
  IF NEW.job_kind IS DISTINCT FROM OLD.job_kind THEN
    RAISE EXCEPTION 'job_kind is immutable';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'created_by is immutable';
  END IF;
  -- ห้ามโยนงานให้คนอื่นหลังรับเงินไปแล้ว ไม่งั้นความรับผิดชอบต่อเงินสดขาดตอน
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

CREATE TRIGGER messenger_jobs_guard_trg
  BEFORE UPDATE ON messenger_jobs
  FOR EACH ROW EXECUTE FUNCTION messenger_jobs_guard();

-- ------------------------------------------------------------
-- 2. หลักฐานภาพ — append-only ทั้งตาราง
--    ถ่ายทับเพื่อกลบร่องรอยไม่ได้ ทำได้แค่ถ่ายเพิ่ม ซึ่ง audit เห็นทั้งคู่
-- ------------------------------------------------------------
CREATE TABLE messenger_job_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES messenger_jobs(id),
  photo_kind VARCHAR(30) NOT NULL
    CHECK (photo_kind IN ('payin_slip', 'cash_envelope', 'deposit_slip', 'variance_doc', 'other')),
  drive_file_id VARCHAR(255),
  view_link TEXT NOT NULL,
  -- sha256 ของไบต์ที่อัปโหลด คำนวณฝั่ง server ไม่รับจาก client
  content_sha256 CHAR(64),
  caption TEXT,
  taken_lat NUMERIC(9,6),
  taken_lng NUMERIC(9,6),
  gps_accuracy_m NUMERIC(8,2),
  uploaded_by UUID NOT NULL REFERENCES profiles(id),
  uploader_signature TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_msg_photos_job ON messenger_job_photos(job_id);
CREATE INDEX idx_msg_photos_kind ON messenger_job_photos(job_id, photo_kind);

-- รูปสลิป Pay-in / ใบนำฝาก ใบเดียวใช้ได้กับงานเดียวตลอดกาล
-- อัปไบต์เดิมซ้ำเพื่อโกงสองงาน = DB ปฏิเสธ
CREATE UNIQUE INDEX uq_msg_photos_slip_hash
  ON messenger_job_photos(content_sha256)
  WHERE photo_kind IN ('payin_slip', 'deposit_slip') AND content_sha256 IS NOT NULL;

CREATE TRIGGER messenger_job_photos_append_only
  BEFORE UPDATE OR DELETE ON messenger_job_photos
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ------------------------------------------------------------
-- 3. SCREEN 1 — จุดรับเงินจากแคชเชียร์
-- ------------------------------------------------------------
CREATE TABLE cash_pickups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES messenger_jobs(id),
  branch_id UUID NOT NULL REFERENCES branches(id),

  -- "ชื่อแคชเชียร์ผู้ส่งมอบ — Dropdown/พิมพ์": เลือกจากระบบได้ หรือพิมพ์ชื่อ
  cashier_profile_id UUID REFERENCES profiles(id),
  cashier_name VARCHAR(255) NOT NULL,

  envelope_count INT NOT NULL CHECK (envelope_count > 0 AND envelope_count <= 1000),
  -- ยอดเงินตามใบ Pay-in เป็นสตางค์ เพดาน 1e12 สตางค์ = หมื่นล้านบาท
  payin_amount_satang BIGINT NOT NULL
    CHECK (payin_amount_satang > 0 AND payin_amount_satang <= 1000000000000),
  payin_photo_id UUID NOT NULL REFERENCES messenger_job_photos(id),

  picked_up_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat NUMERIC(9,6),
  lng NUMERIC(9,6),
  gps_accuracy_m NUMERIC(8,2),

  received_by UUID NOT NULL REFERENCES profiles(id),
  receiver_signature TEXT NOT NULL,

  -- nullable ตั้งแต่แรกเพื่อรองรับหลายจุดรับ -> ฝากครั้งเดียว ในอนาคต
  deposit_id UUID,

  -- เตรียมไว้สำหรับ "สาขายืนยันยอด" ซึ่งเป็นกลไกเดียวที่ปิดช่อง
  -- "แมสเซนเจอร์คีย์ยอด Pay-in ต่ำกว่าจริงแล้วฝากตามที่คีย์" ได้
  branch_confirmed_at TIMESTAMPTZ,
  branch_confirmed_by UUID REFERENCES profiles(id),
  branch_confirmed_amount_satang BIGINT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX uq_cash_pickups_job ON cash_pickups(job_id);
CREATE INDEX idx_cash_pickups_branch ON cash_pickups(branch_id);
CREATE INDEX idx_cash_pickups_deposit ON cash_pickups(deposit_id);
CREATE INDEX idx_cash_pickups_receiver ON cash_pickups(received_by, picked_up_at DESC);
-- รายงาน "รอสาขายืนยัน"
CREATE INDEX idx_cash_pickups_unconfirmed ON cash_pickups(picked_up_at DESC)
  WHERE branch_confirmed_at IS NULL;

CREATE TRIGGER cash_pickups_updated_at
  BEFORE UPDATE ON cash_pickups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER cash_pickups_no_delete
  BEFORE DELETE ON cash_pickups
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE OR REPLACE FUNCTION cash_pickups_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
    RAISE EXCEPTION 'job_id is immutable';
  END IF;
  -- ยอดตามใบ Pay-in คือฐานของการเทียบยอดทั้งหมด แก้ไม่ได้เด็ดขาด
  -- ต้องการแก้ = void งานทั้งใบแล้วสร้างใหม่ ซึ่งทิ้งร่องรอยใน audit
  IF NEW.payin_amount_satang IS DISTINCT FROM OLD.payin_amount_satang THEN
    RAISE EXCEPTION 'payin_amount_satang is write-once; void the job and create a new one instead';
  END IF;
  IF NEW.payin_photo_id IS DISTINCT FROM OLD.payin_photo_id THEN
    RAISE EXCEPTION 'the pay-in slip photo is immutable';
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

CREATE TRIGGER cash_pickups_guard_trg
  BEFORE UPDATE ON cash_pickups
  FOR EACH ROW EXECUTE FUNCTION cash_pickups_guard();

-- ------------------------------------------------------------
-- 4. SCREEN 2 — นำฝากธนาคาร (ตารางเงิน)
--    variance เป็น GENERATED column: ไม่มีใครเก็บ variance ที่ขัดกับ
--    (ยอดฝากจริง - ยอดที่ควรฝาก) ได้ แม้แต่ raw SQL
-- ------------------------------------------------------------
CREATE TABLE bank_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES messenger_jobs(id),
  status VARCHAR(30) NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'matched', 'variance_pending', 'variance_resolved', 'voided')),

  bank_id UUID NOT NULL REFERENCES approved_banks(id),
  bank_branch_name VARCHAR(255) NOT NULL,

  -- snapshot ผลรวม cash_pickups.payin_amount_satang ที่ผูกกับงานนี้ (server เขียน)
  expected_total_satang BIGINT NOT NULL
    CHECK (expected_total_satang > 0 AND expected_total_satang <= 1000000000000),
  actual_amount_satang BIGINT NOT NULL
    CHECK (actual_amount_satang >= 0 AND actual_amount_satang <= 1000000000000),
  variance_satang BIGINT GENERATED ALWAYS AS
    (actual_amount_satang - expected_total_satang) STORED,
  currency CHAR(3) NOT NULL DEFAULT 'THB' CHECK (currency = 'THB'),

  reference_no VARCHAR(120) NOT NULL,

  -- nullable เพราะยอดเงินต้องบันทึกได้แม้อัปรูปไม่สำเร็จ (เงินออกไปแล้ว)
  -- แต่ปิดงานไม่ได้จนกว่าจะมีรูป — บังคับที่ CHECK ตอนปิด ไม่ใช่ตอน insert
  slip_photo_id UUID REFERENCES messenger_job_photos(id),
  slip_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (slip_status IN ('pending', 'attached')),

  deposited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_by UUID NOT NULL REFERENCES profiles(id),
  submitted_signature TEXT NOT NULL,

  -- write-once: ใบอนุมัติที่ปลดล็อกรายการนี้
  resolved_review_id UUID,
  void_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT bank_deposits_slip_status_consistent
    CHECK ((slip_status = 'attached' AND slip_photo_id IS NOT NULL)
           OR (slip_status = 'pending' AND slip_photo_id IS NULL)),
  -- จบงานไม่ได้ถ้ายังไม่มีรูปใบนำฝาก
  CONSTRAINT bank_deposits_final_needs_slip
    CHECK (status NOT IN ('matched', 'variance_resolved') OR slip_photo_id IS NOT NULL),
  -- *** การล็อกเงินเกินที่ระดับ DB ***
  -- ฝากเกินยอดที่ควรฝาก -> ไปสถานะจบไม่ได้ถ้าไม่มีใบอนุมัติจริง
  CONSTRAINT bank_deposits_overage_lock
    CHECK (variance_satang <= 0
           OR status IN ('recorded', 'variance_pending', 'voided')
           OR resolved_review_id IS NOT NULL),
  -- ยอดไม่ตรงจะไป matched ไม่ได้ ต้องผ่านเส้นทาง variance
  CONSTRAINT bank_deposits_matched_means_zero
    CHECK (status <> 'matched' OR variance_satang = 0),
  CONSTRAINT bank_deposits_void_reason
    CHECK (status <> 'voided' OR void_reason IS NOT NULL)
);

CREATE UNIQUE INDEX uq_bank_deposits_live_job
  ON bank_deposits(job_id) WHERE status <> 'voided';
-- เลขที่ใบนำฝากซ้ำในธนาคารเดียวกันไม่ได้
CREATE UNIQUE INDEX uq_bank_deposits_ref
  ON bank_deposits(bank_id, reference_no) WHERE status <> 'voided';
CREATE INDEX idx_bank_deposits_status ON bank_deposits(status);
CREATE INDEX idx_bank_deposits_job ON bank_deposits(job_id);
CREATE INDEX idx_bank_deposits_date ON bank_deposits(deposited_at DESC);
CREATE INDEX idx_bank_deposits_variance ON bank_deposits(variance_satang)
  WHERE variance_satang <> 0;
CREATE INDEX idx_bank_deposits_open ON bank_deposits(status, deposited_at DESC)
  WHERE status IN ('recorded', 'variance_pending');

ALTER TABLE cash_pickups
  ADD CONSTRAINT cash_pickups_deposit_fk
  FOREIGN KEY (deposit_id) REFERENCES bank_deposits(id);

CREATE TRIGGER bank_deposits_updated_at
  BEFORE UPDATE ON bank_deposits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER bank_deposits_no_delete
  BEFORE DELETE ON bank_deposits
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- รูปใบนำฝากต้องเป็นชนิด deposit_slip และเป็นของงานเดียวกัน
CREATE OR REPLACE FUNCTION assert_slip_matches_job()
RETURNS TRIGGER AS $$
DECLARE v_job UUID; v_kind TEXT;
BEGIN
  IF NEW.slip_photo_id IS NULL THEN RETURN NEW; END IF;
  SELECT job_id, photo_kind INTO v_job, v_kind
  FROM messenger_job_photos WHERE id = NEW.slip_photo_id;
  IF v_job IS DISTINCT FROM NEW.job_id THEN
    RAISE EXCEPTION 'the deposit slip photo belongs to a different job';
  END IF;
  IF v_kind <> 'deposit_slip' THEN
    RAISE EXCEPTION 'slip_photo_id must reference a photo of kind deposit_slip';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bank_deposits_slip_matches_job
  BEFORE INSERT OR UPDATE ON bank_deposits
  FOR EACH ROW EXECUTE FUNCTION assert_slip_matches_job();

-- expected_total ต้องเท่ากับผลรวมของ pay-in ที่ผูกกับงานนี้จริง
-- (กันการส่ง expected ปลอมมาจาก route เพื่อทำให้ variance เป็นศูนย์)
CREATE OR REPLACE FUNCTION assert_expected_matches_pickups()
RETURNS TRIGGER AS $$
DECLARE v_sum BIGINT;
BEGIN
  SELECT COALESCE(SUM(payin_amount_satang), 0) INTO v_sum
  FROM cash_pickups WHERE job_id = NEW.job_id;
  IF v_sum = 0 THEN
    RAISE EXCEPTION 'cannot record a deposit before any cash pickup exists for job %', NEW.job_id;
  END IF;
  IF NEW.expected_total_satang <> v_sum THEN
    RAISE EXCEPTION 'expected_total_satang (%) does not match the sum of pay-in amounts (%)',
      NEW.expected_total_satang, v_sum;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bank_deposits_expected_matches_pickups
  BEFORE INSERT ON bank_deposits
  FOR EACH ROW EXECUTE FUNCTION assert_expected_matches_pickups();

-- ยอดเงินเป็น write-once ทั้งหมด แก้ไม่ได้ ได้แค่ void แล้วสร้างใหม่
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
  IF NEW.bank_id IS DISTINCT FROM OLD.bank_id THEN
    RAISE EXCEPTION 'bank_id is write-once';
  END IF;
  IF NEW.deposited_at IS DISTINCT FROM OLD.deposited_at
     OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.submitted_signature IS DISTINCT FROM OLD.submitted_signature THEN
    RAISE EXCEPTION 'the deposit record (who/when) is immutable';
  END IF;
  -- แนบรูปได้ครั้งเดียว ถ่ายทับเพื่อกลบร่องรอยไม่ได้
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

  -- ปลดล็อกออกจาก variance_pending ต้องมีใบอนุมัติที่เป็นของรายการนี้จริง
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

-- ------------------------------------------------------------
-- 5. SCREEN 3 — รายงานเงินขาด/เกิน
-- ------------------------------------------------------------
CREATE TABLE cash_variance_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id UUID NOT NULL REFERENCES bank_deposits(id),
  variance_satang_snapshot BIGINT NOT NULL CHECK (variance_satang_snapshot <> 0),
  variance_kind VARCHAR(10) NOT NULL CHECK (variance_kind IN ('short', 'over')),

  cause_code VARCHAR(50) NOT NULL
    CHECK (cause_code IN ('bank_fee', 'miscount_at_pickup', 'damaged_note_rejected',
                          'mixed_envelope', 'wrong_account', 'other')),
  cause_detail TEXT NOT NULL CHECK (length(btrim(cause_detail)) >= 10),

  reported_by UUID NOT NULL REFERENCES profiles(id),
  reporter_signature TEXT NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  status VARCHAR(20) NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'rejected', 'returned')),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT cash_variance_reports_kind_matches_sign
    CHECK ((variance_kind = 'short' AND variance_satang_snapshot < 0)
           OR (variance_kind = 'over' AND variance_satang_snapshot > 0))
);

CREATE UNIQUE INDEX uq_variance_reports_deposit
  ON cash_variance_reports(deposit_id) WHERE status <> 'returned';
CREATE INDEX idx_variance_reports_status ON cash_variance_reports(status, reported_at);
CREATE INDEX idx_variance_reports_kind ON cash_variance_reports(variance_kind);

CREATE TRIGGER cash_variance_reports_updated_at
  BEFORE UPDATE ON cash_variance_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER cash_variance_reports_no_delete
  BEFORE DELETE ON cash_variance_reports
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- snapshot ต้องตรงกับ variance จริงของ deposit ณ เวลารายงาน
CREATE OR REPLACE FUNCTION assert_variance_snapshot()
RETURNS TRIGGER AS $$
DECLARE v_variance BIGINT;
BEGIN
  SELECT variance_satang INTO v_variance FROM bank_deposits WHERE id = NEW.deposit_id;
  IF v_variance IS NULL THEN
    RAISE EXCEPTION 'deposit % not found', NEW.deposit_id;
  END IF;
  IF NEW.variance_satang_snapshot <> v_variance THEN
    RAISE EXCEPTION 'variance snapshot (%) does not match the deposit variance (%)',
      NEW.variance_satang_snapshot, v_variance;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cash_variance_reports_snapshot
  BEFORE INSERT ON cash_variance_reports
  FOR EACH ROW EXECUTE FUNCTION assert_variance_snapshot();

CREATE OR REPLACE FUNCTION cash_variance_reports_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.deposit_id IS DISTINCT FROM OLD.deposit_id
     OR NEW.variance_satang_snapshot IS DISTINCT FROM OLD.variance_satang_snapshot
     OR NEW.variance_kind IS DISTINCT FROM OLD.variance_kind
     OR NEW.cause_code IS DISTINCT FROM OLD.cause_code
     OR NEW.cause_detail IS DISTINCT FROM OLD.cause_detail
     OR NEW.reported_by IS DISTINCT FROM OLD.reported_by
     OR NEW.reporter_signature IS DISTINCT FROM OLD.reporter_signature THEN
    RAISE EXCEPTION 'a variance report is immutable except for its review status';
  END IF;
  IF OLD.status <> 'pending_review' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'variance report % is already %', OLD.id, OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cash_variance_reports_guard_trg
  BEFORE UPDATE ON cash_variance_reports
  FOR EACH ROW EXECUTE FUNCTION cash_variance_reports_guard();

-- ------------------------------------------------------------
-- 6. การตัดสินของฝ่ายการเงิน — append-only
--    หัวใจของการล็อกเงินเกิน: trigger อ่าน role/dept สด ๆ จาก DB
--    ไม่เชื่อ payload จาก route ปลอมไม่ได้ ปิด route ทิ้งก็ยังบล็อก
-- ------------------------------------------------------------
CREATE TABLE cash_variance_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES cash_variance_reports(id),
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('approved', 'rejected', 'returned')),

  -- snapshot พิสูจน์ว่าอนุมัติยอดไหน
  variance_satang_at_decision BIGINT NOT NULL,
  actual_amount_satang_at_decision BIGINT NOT NULL,

  reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
  -- ติ๊กยืนยันว่าเปิดรูปใบนำฝากเทียบยอดแล้ว
  slip_checked BOOLEAN NOT NULL CHECK (slip_checked),

  reviewed_by UUID NOT NULL REFERENCES profiles(id),
  reviewer_signature TEXT NOT NULL,
  reviewer_role VARCHAR(50) NOT NULL,
  reviewer_dept_code VARCHAR(50),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_variance_reviews_report ON cash_variance_reviews(report_id);
CREATE INDEX idx_variance_reviews_reviewer ON cash_variance_reviews(reviewed_by, created_at DESC);

CREATE TRIGGER cash_variance_reviews_append_only
  BEFORE UPDATE OR DELETE ON cash_variance_reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE bank_deposits
  ADD CONSTRAINT bank_deposits_review_fk
  FOREIGN KEY (resolved_review_id) REFERENCES cash_variance_reviews(id);

-- bank_deposits_guard อ้างถึง cash_variance_reviews จึงติดตั้ง trigger ที่นี่
CREATE TRIGGER bank_deposits_guard_trg
  BEFORE UPDATE ON bank_deposits
  FOR EACH ROW EXECUTE FUNCTION bank_deposits_guard();

CREATE OR REPLACE FUNCTION assert_variance_approver()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
  v_code TEXT;
  v_report cash_variance_reports;
  v_deposit bank_deposits;
  v_pickup cash_pickups;
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

  -- *** สิทธิ์: เงินเกินเข้มกว่าเงินขาด ***
  IF v_report.variance_kind = 'over' THEN
    IF NOT (v_role = 'super_admin' OR (v_role = 'admin' AND v_code = 'FIN')) THEN
      RAISE EXCEPTION 'only super_admin or an admin in the FIN department may decide a cash overage (got role=%, dept=%)',
        v_role, v_code;
    END IF;
  ELSE
    IF NOT (v_role = 'super_admin' OR v_code = 'FIN') THEN
      RAISE EXCEPTION 'only super_admin or FIN staff may decide a cash shortage (got role=%, dept=%)',
        v_role, v_code;
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

  -- snapshot ต้องตรงกับความจริงตอนตัดสิน กันอนุมัติยอดเก่า
  IF NEW.variance_satang_at_decision IS DISTINCT FROM v_deposit.variance_satang
     OR NEW.actual_amount_satang_at_decision IS DISTINCT FROM v_deposit.actual_amount_satang THEN
    RAISE EXCEPTION 'review snapshot does not match the current deposit amounts';
  END IF;

  -- อนุมัติได้ต่อเมื่อมีรูปใบนำฝากแล้ว — ทางเลี่ยง "รอแนบสลิป" ปิดตาย
  IF NEW.decision = 'approved' AND v_deposit.slip_photo_id IS NULL THEN
    RAISE EXCEPTION 'cannot approve a deposit whose slip photo has not been attached yet';
  END IF;

  -- role/dept ณ เวลาตัดสิน เขียนโดย DB ไม่รับจาก client
  NEW.reviewer_role := v_role;
  NEW.reviewer_dept_code := v_code;

  -- ปิดรายงานที่นี่ ไม่ใช่ที่ route: SELECT ... FOR UPDATE ด้านบนทำให้คำขอที่
  -- ชนกันเข้าคิว คนแรกผ่านแล้วรายงานเปลี่ยนสถานะ คนที่สองมาเจอ status ที่ไม่ใช่
  -- pending_review แล้ว RAISE ที่เช็คด้านบน → ตัดสินได้ครั้งเดียวเสมอ
  -- (ถ้าให้ route flip สถานะก่อน insert เช็ค pending_review ด้านบนจะ RAISE ทุกครั้ง)
  UPDATE cash_variance_reports SET status = NEW.decision WHERE id = NEW.report_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cash_variance_reviews_assert_approver
  BEFORE INSERT ON cash_variance_reviews
  FOR EACH ROW EXECUTE FUNCTION assert_variance_approver();

-- ------------------------------------------------------------
-- 7. AUDIT — append-only เต็มรูปแบบ
--    BIGSERIAL ทำให้ตรวจ gap ได้: ถ้ามีคนลบผ่าน superuser เลข id จะกระโดด
-- ------------------------------------------------------------
CREATE TABLE messenger_job_audit (
  id BIGSERIAL PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES messenger_jobs(id),
  entity VARCHAR(30) NOT NULL
    CHECK (entity IN ('job', 'pickup', 'deposit', 'variance_report', 'variance_review', 'photo')),
  entity_id TEXT,
  action VARCHAR(50) NOT NULL,
  from_status VARCHAR(30),
  to_status VARCHAR(30),
  amount_satang BIGINT,
  variance_satang BIGINT,
  reason TEXT,

  actor_id UUID NOT NULL REFERENCES profiles(id),
  actor_signature TEXT NOT NULL,
  actor_role VARCHAR(50) NOT NULL,
  actor_dept_code VARCHAR(50),
  request_ip VARCHAR(64),
  user_agent TEXT,
  payload JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_msg_audit_job ON messenger_job_audit(job_id, id);
CREATE INDEX idx_msg_audit_actor ON messenger_job_audit(actor_id, created_at DESC);
CREATE INDEX idx_msg_audit_entity ON messenger_job_audit(entity, entity_id);
CREATE INDEX idx_msg_audit_money ON messenger_job_audit(created_at DESC)
  WHERE amount_satang IS NOT NULL;

-- ไม่มี UPDATE ไม่มี DELETE ไม่มี TRUNCATE ตลอดกาล รวมถึง service_role
CREATE TRIGGER messenger_job_audit_append_only
  BEFORE UPDATE OR DELETE ON messenger_job_audit
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER messenger_job_audit_no_truncate
  BEFORE TRUNCATE ON messenger_job_audit
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
