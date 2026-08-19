-- 016_cashier_envelope_handover.sql
--
-- แคชเชียร์ระบุยอดหน้าซองในระบบเอง แล้ว "ส่งซอง" → แมสเซนเจอร์ "รับซอง"
--
-- ทำไมข้อนี้สำคัญกว่าทุกข้อที่ผ่านมา: ก่อนหน้านี้ยอดต้นทางมาจากแมสเซนเจอร์
-- ฝ่ายเดียว ระบบจับได้แค่ "ยอดที่คีย์ ≠ ยอดที่ฝาก" แต่จับไม่ได้ว่า
-- "รับเงินมาไม่ครบตั้งแต่ต้น" migration นี้ย้ายเจ้าของยอดต้นทางไปเป็นแคชเชียร์
-- แล้วให้แมสเซนเจอร์เป็นผู้ "ยืนยันรับ" — กลายเป็นสองฝ่ายยืนยันยอดเดียวกัน
-- ซึ่งเป็นกลไกเดียวที่ปิดช่องนั้นได้จริง
--
-- หลักการสำคัญของสคีมานี้: เมื่อซองมาจากการประกาศของแคชเชียร์
-- **แมสเซนเจอร์คีย์ยอดเองไม่ได้เลย** ยอดใน cash_pickups ต้องเท่ากับยอดที่
-- แคชเชียร์ประกาศไว้ทุกสตางค์ บังคับด้วย trigger ไม่ใช่ด้วยหน้าจอ
--
-- ยังยอมให้มีจุดรับที่ไม่มีการประกาศ (handover_id IS NULL) เพราะช่วงเปลี่ยนผ่าน
-- สาขาที่ยังไม่มีบัญชีแคชเชียร์ต้องทำงานได้ต่อ แต่รายงานประจำวันนับแยกให้เห็น
-- ว่ามีกี่จุดที่ไม่มีการยืนยันจากต้นทาง เพื่อให้ตามเก็บได้

-- ══════════════════════════════════════════════════════════════
-- 1. ตารางการส่งซองของแคชเชียร์
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cash_handovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handover_no SERIAL,
  branch_id UUID NOT NULL REFERENCES branches(id),

  -- ยอดที่แคชเชียร์เขียนไว้บนหน้าซอง (สตางค์) — เจ้าของตัวเลขคือแคชเชียร์
  declared_amount_satang BIGINT NOT NULL
    CHECK (declared_amount_satang > 0 AND declared_amount_satang <= 1000000000000),
  envelope_count INT NOT NULL DEFAULT 1
    CHECK (envelope_count > 0 AND envelope_count <= 1000),
  note TEXT,

  declared_by UUID NOT NULL REFERENCES profiles(id),
  declarer_signature TEXT NOT NULL,
  declared_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'disputed', 'cancelled')),

  -- ผูกกับจุดรับที่เกิดขึ้นจริงตอนแมสเซนเจอร์กดรับ (FK เพิ่มหลังตาราง pickup)
  accepted_pickup_id UUID,
  accepted_by UUID REFERENCES profiles(id),
  accepted_at TIMESTAMPTZ,

  -- แมสเซนเจอร์กด "ยอดไม่ตรงกับหน้าซอง" ต้องระบุเหตุผล
  dispute_reason TEXT,
  disputed_at TIMESTAMPTZ,
  -- แคชเชียร์ยกเลิกซองที่ยังไม่มีใครรับ
  cancel_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT cash_handovers_dispute_needs_reason
    CHECK (status <> 'disputed' OR (dispute_reason IS NOT NULL AND btrim(dispute_reason) <> '')),
  CONSTRAINT cash_handovers_cancel_needs_reason
    CHECK (status <> 'cancelled' OR (cancel_reason IS NOT NULL AND btrim(cancel_reason) <> '')),
  CONSTRAINT cash_handovers_accepted_needs_actor
    CHECK (status <> 'accepted' OR (accepted_by IS NOT NULL AND accepted_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_cash_handovers_branch_status
  ON cash_handovers(branch_id, status);
-- คิวที่แมสเซนเจอร์ต้องเห็น (คิวรีที่ร้อนที่สุดของหน้าจอรับซอง)
CREATE INDEX IF NOT EXISTS idx_cash_handovers_pending
  ON cash_handovers(declared_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cash_handovers_declarer
  ON cash_handovers(declared_by, declared_at DESC);

DROP TRIGGER IF EXISTS cash_handovers_updated_at ON cash_handovers;
CREATE TRIGGER cash_handovers_updated_at
  BEFORE UPDATE ON cash_handovers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ลบไม่ได้: การประกาศยอดเป็นหลักฐานต้นทาง ยกเลิกได้พร้อมเหตุผลเท่านั้น
DROP TRIGGER IF EXISTS cash_handovers_no_delete ON cash_handovers;
CREATE TRIGGER cash_handovers_no_delete
  BEFORE DELETE ON cash_handovers
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE OR REPLACE FUNCTION cash_handovers_guard()
RETURNS TRIGGER AS $$
DECLARE legal BOOLEAN := false;
BEGIN
  -- ตัวเลขของแคชเชียร์แก้ไม่ได้เลยหลังกดส่งซอง ถ้าเขียนผิดต้องยกเลิกแล้วออกใบใหม่
  -- ซึ่งทิ้งร่องรอยไว้ทั้งสองใบ ต่างจากการแก้ทับที่ไม่เหลืออะไรให้ตรวจ
  IF NEW.declared_amount_satang IS DISTINCT FROM OLD.declared_amount_satang THEN
    RAISE EXCEPTION 'declared_amount_satang is write-once; cancel this handover and issue a new one';
  END IF;
  IF NEW.envelope_count IS DISTINCT FROM OLD.envelope_count THEN
    RAISE EXCEPTION 'envelope_count is write-once';
  END IF;
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'branch_id is immutable';
  END IF;
  IF NEW.declared_by IS DISTINCT FROM OLD.declared_by
     OR NEW.declarer_signature IS DISTINCT FROM OLD.declarer_signature
     OR NEW.declared_at IS DISTINCT FROM OLD.declared_at THEN
    RAISE EXCEPTION 'the declaration (who/when) is immutable';
  END IF;
  IF OLD.accepted_pickup_id IS NOT NULL
     AND NEW.accepted_pickup_id IS DISTINCT FROM OLD.accepted_pickup_id THEN
    RAISE EXCEPTION 'accepted_pickup_id is write-once';
  END IF;

  IF NEW.status = OLD.status THEN
    legal := true;
  ELSE
    -- accepted / disputed / cancelled เป็นสถานะปลายทางทั้งหมด
    -- ซองที่ยอดไม่ตรงจะไม่ถูกดัดกลับมาใช้ ต้องออกใบใหม่
    legal := (OLD.status, NEW.status) IN (
      ('pending', 'accepted'),
      ('pending', 'disputed'),
      ('pending', 'cancelled')
    );
  END IF;
  IF NOT legal THEN
    RAISE EXCEPTION 'illegal cash_handovers status transition % -> %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cash_handovers_guard_trg ON cash_handovers;
CREATE TRIGGER cash_handovers_guard_trg
  BEFORE UPDATE ON cash_handovers
  FOR EACH ROW EXECUTE FUNCTION cash_handovers_guard();

-- ผู้ประกาศต้องเป็นคนของสาขานั้นจริง (ตามหน่วยงานที่ผูกกับสาขา)
-- กันแคชเชียร์สาขา A ประกาศยอดในนามสาขา B
CREATE OR REPLACE FUNCTION assert_declarer_belongs_to_branch()
RETURNS TRIGGER AS $$
DECLARE v_branch_dept UUID; v_person_dept UUID; v_role TEXT;
BEGIN
  SELECT department_id INTO v_branch_dept FROM branches WHERE id = NEW.branch_id;
  SELECT department_id, role INTO v_person_dept, v_role
  FROM profiles WHERE id = NEW.declared_by AND is_active = true;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'declarer % is not an active profile', NEW.declared_by;
  END IF;
  -- super_admin ทำแทนได้เพื่อแก้ปัญหาหน้างาน แต่ยังถูกบันทึกว่าเป็นคนทำ
  IF v_role = 'super_admin' THEN RETURN NEW; END IF;
  -- สาขาที่ยังไม่ผูกหน่วยงานไว้ ไม่บล็อก (ไม่มีข้อมูลให้เทียบ)
  IF v_branch_dept IS NULL THEN RETURN NEW; END IF;
  IF v_person_dept IS DISTINCT FROM v_branch_dept THEN
    RAISE EXCEPTION 'declarer does not belong to the department that owns this branch';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cash_handovers_declarer_branch ON cash_handovers;
CREATE TRIGGER cash_handovers_declarer_branch
  BEFORE INSERT ON cash_handovers
  FOR EACH ROW EXECUTE FUNCTION assert_declarer_belongs_to_branch();

-- ══════════════════════════════════════════════════════════════
-- 2. ผูกจุดรับกับการประกาศ และบังคับให้ยอดตรงกันทุกสตางค์
-- ══════════════════════════════════════════════════════════════

ALTER TABLE cash_pickups
  ADD COLUMN IF NOT EXISTS handover_id UUID REFERENCES cash_handovers(id);

-- ซองที่แคชเชียร์ประกาศหนึ่งใบ ถูกรับได้ครั้งเดียว
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_pickups_handover
  ON cash_pickups(handover_id) WHERE handover_id IS NOT NULL;

ALTER TABLE cash_handovers
  ADD CONSTRAINT cash_handovers_pickup_fk
  FOREIGN KEY (accepted_pickup_id) REFERENCES cash_pickups(id);

COMMENT ON COLUMN cash_pickups.handover_id IS
  'การประกาศยอดของแคชเชียร์ที่จุดรับนี้รับมา — NULL = สาขายังไม่มีบัญชีแคชเชียร์ '
  '(ยอดมาจากแมสเซนเจอร์ฝ่ายเดียว ไม่มีการยืนยันจากต้นทาง)';

/**
 * หัวใจของ migration นี้
 *
 * ถ้าจุดรับอ้างการประกาศของแคชเชียร์ ยอดและจำนวนซองต้องเท่ากันเป๊ะ และต้องเป็น
 * สาขาเดียวกัน แมสเซนเจอร์จึงคีย์ยอดต่างจากที่แคชเชียร์ประกาศไม่ได้ ไม่ว่าจะ
 * ผ่านหน้าจอ ผ่าน API ตรง หรือผ่าน service-role ก็ตาม
 */
CREATE OR REPLACE FUNCTION assert_pickup_matches_handover()
RETURNS TRIGGER AS $$
DECLARE h cash_handovers;
BEGIN
  IF NEW.handover_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO h FROM cash_handovers WHERE id = NEW.handover_id;
  IF h.id IS NULL THEN
    RAISE EXCEPTION 'handover % does not exist', NEW.handover_id;
  END IF;
  IF h.branch_id IS DISTINCT FROM NEW.branch_id THEN
    RAISE EXCEPTION 'this handover belongs to a different branch';
  END IF;
  IF h.declared_amount_satang IS DISTINCT FROM NEW.envelope_amount_satang THEN
    RAISE EXCEPTION
      'envelope amount (%) must equal the amount declared by the cashier (%)',
      NEW.envelope_amount_satang, h.declared_amount_satang;
  END IF;
  IF h.envelope_count IS DISTINCT FROM NEW.envelope_count THEN
    RAISE EXCEPTION 'envelope count (%) must equal the declared count (%)',
      NEW.envelope_count, h.envelope_count;
  END IF;
  -- ต้องถูกเปลี่ยนเป็น accepted มาก่อนแล้ว (route ทำ conditional update
  -- pending -> accepted เป็นจุด serialize กันสองคนกดรับซองใบเดียวกัน)
  IF h.status <> 'accepted' THEN
    RAISE EXCEPTION 'handover % must be accepted before a pickup can reference it (got %)',
      h.id, h.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cash_pickups_matches_handover ON cash_pickups;
CREATE TRIGGER cash_pickups_matches_handover
  BEFORE INSERT OR UPDATE ON cash_pickups
  FOR EACH ROW EXECUTE FUNCTION assert_pickup_matches_handover();

-- handover_id เขียนครั้งเดียว เปลี่ยนไปอ้างใบอื่นภายหลังไม่ได้
CREATE OR REPLACE FUNCTION cash_pickups_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.job_id IS DISTINCT FROM OLD.job_id THEN
    RAISE EXCEPTION 'job_id is immutable';
  END IF;
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION 'branch_id is immutable once the pickup is recorded';
  END IF;
  IF NEW.handover_id IS DISTINCT FROM OLD.handover_id THEN
    RAISE EXCEPTION 'handover_id is immutable';
  END IF;
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

-- ══════════════════════════════════════════════════════════════
-- 3. RLS — อ่านตรงจาก browser ไม่ได้ ต้องผ่าน route ที่ตรวจสิทธิ์
-- ══════════════════════════════════════════════════════════════

ALTER TABLE cash_handovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cash_handovers_read" ON cash_handovers FOR SELECT USING (
  auth.uid() IS NOT NULL
);
