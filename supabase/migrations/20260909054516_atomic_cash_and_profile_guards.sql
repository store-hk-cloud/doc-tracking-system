BEGIN;

-- งานรับเงินหนึ่งใบต้องมีเจ้าของเพียงคนเดียวระหว่างที่ยังไม่จบ การตรวจด้วย
-- SELECT ใน API อย่างเดียวแพ้คำขอที่มาถึงพร้อมกัน จึงให้ unique index เป็นด่านสุดท้าย
CREATE UNIQUE INDEX IF NOT EXISTS uq_messenger_jobs_active_cash_handover
  ON public.messenger_jobs(assigned_to)
  WHERE job_kind = 'cash_handover'
    AND status IN ('open', 'picked_up', 'deposited', 'pending_review');

-- การรับซองต้องย้าย handover, สร้าง pickup และเปลี่ยนงานเป็น picked_up พร้อมกัน
-- เพราะการย้อน accepted -> pending ภายหลังผิดกับ state machine และทำให้ซองค้างได้
CREATE OR REPLACE FUNCTION public.record_cash_pickup(
  p_job_id UUID,
  p_actor_id UUID,
  p_branch_id UUID,
  p_handover_id UUID,
  p_cashier_profile_id UUID,
  p_cashier_name TEXT,
  p_envelope_count INTEGER,
  p_envelope_amount_satang BIGINT,
  p_envelope_photo_id UUID,
  p_picked_up_at TIMESTAMPTZ,
  p_lat NUMERIC,
  p_lng NUMERIC,
  p_gps_accuracy_m NUMERIC,
  p_receiver_signature TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job public.messenger_jobs;
  v_handover public.cash_handovers;
  v_pickup public.cash_pickups;
  v_picked_up_at TIMESTAMPTZ := COALESCE(p_picked_up_at, now());
BEGIN
  -- ทุกทางที่เพิ่ม pickup ต้องล็อกงานก่อน เพื่อไม่ให้ฝากพร้อมกับเพิ่มจุดรับ
  SELECT * INTO v_job
  FROM public.messenger_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'messenger_job_not_found';
  END IF;
  IF v_job.assigned_to IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'pickup_not_assigned';
  END IF;
  IF v_job.status NOT IN ('open', 'picked_up') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'pickup_not_allowed';
  END IF;

  IF p_handover_id IS NOT NULL THEN
    SELECT * INTO v_handover
    FROM public.cash_handovers
    WHERE id = p_handover_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'cash_handover_not_found';
    END IF;
    IF v_handover.status <> 'pending' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cash_handover_unavailable';
    END IF;

    UPDATE public.cash_handovers
    SET status = 'accepted', accepted_by = p_actor_id, accepted_at = v_picked_up_at
    WHERE id = p_handover_id;
  END IF;

  INSERT INTO public.cash_pickups (
    job_id, branch_id, handover_id, cashier_profile_id, cashier_name,
    envelope_count, envelope_amount_satang, envelope_photo_id, picked_up_at,
    lat, lng, gps_accuracy_m, received_by, receiver_signature
  ) VALUES (
    p_job_id, p_branch_id, p_handover_id, p_cashier_profile_id, p_cashier_name,
    p_envelope_count, p_envelope_amount_satang, p_envelope_photo_id, v_picked_up_at,
    p_lat, p_lng, p_gps_accuracy_m, p_actor_id, p_receiver_signature
  )
  RETURNING * INTO v_pickup;

  IF p_handover_id IS NOT NULL THEN
    UPDATE public.cash_handovers
    SET accepted_pickup_id = v_pickup.id
    WHERE id = p_handover_id
      AND accepted_pickup_id IS NULL;
  END IF;

  UPDATE public.messenger_jobs
  SET status = 'picked_up', picked_up_at = COALESCE(v_job.picked_up_at, v_picked_up_at)
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  RETURN jsonb_build_object('pickup', to_jsonb(v_pickup), 'job', to_jsonb(v_job));
END;
$$;

-- การฝากต้องสร้าง bank_deposit, ผูก pickup ทุกใบ และเปลี่ยนสถานะงานใน transaction
-- เดียวกัน เพื่อให้ unique/FK/trigger ที่ล้มเหลวคืนสถานะเดิมโดยอัตโนมัติ
CREATE OR REPLACE FUNCTION public.record_bank_deposit(
  p_job_id UUID,
  p_actor_id UUID,
  p_bank_id UUID,
  p_bank_branch_id UUID,
  p_bank_branch_name TEXT,
  p_actual_amount_satang BIGINT,
  p_reference_no TEXT,
  p_reference_no_source TEXT,
  p_slip_photo_id UUID,
  p_deposited_at TIMESTAMPTZ,
  p_submitted_signature TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job public.messenger_jobs;
  v_deposit public.bank_deposits;
  v_expected_total BIGINT;
  v_pickup_count INTEGER;
  v_linked_count INTEGER;
  v_deposited_at TIMESTAMPTZ := COALESCE(p_deposited_at, now());
  v_completed_at TIMESTAMPTZ := now();
BEGIN
  -- ใช้ล็อกเดียวกับ record_cash_pickup: ระหว่างคำนวณยอดกับฝาก จะเพิ่ม pickup ไม่ได้
  SELECT * INTO v_job
  FROM public.messenger_jobs
  WHERE id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'messenger_job_not_found';
  END IF;
  IF v_job.assigned_to IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'deposit_not_assigned';
  END IF;
  IF v_job.status <> 'picked_up' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'deposit_not_allowed';
  END IF;

  SELECT COALESCE(SUM(envelope_amount_satang), 0), COUNT(*)::INTEGER
  INTO v_expected_total, v_pickup_count
  FROM public.cash_pickups
  WHERE job_id = p_job_id;
  IF v_pickup_count = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'no_cash_pickups';
  END IF;

  INSERT INTO public.bank_deposits (
    job_id, status, bank_id, bank_branch_id, bank_branch_name,
    expected_total_satang, actual_amount_satang, reference_no, reference_no_source,
    slip_photo_id, slip_status, deposited_at, submitted_by, submitted_signature
  ) VALUES (
    p_job_id, 'recorded', p_bank_id, p_bank_branch_id, p_bank_branch_name,
    v_expected_total, p_actual_amount_satang, p_reference_no, p_reference_no_source,
    p_slip_photo_id,
    CASE WHEN p_slip_photo_id IS NULL THEN 'pending' ELSE 'attached' END,
    v_deposited_at, p_actor_id, p_submitted_signature
  )
  RETURNING * INTO v_deposit;

  UPDATE public.cash_pickups
  SET deposit_id = v_deposit.id
  WHERE job_id = p_job_id
    AND deposit_id IS NULL;
  GET DIAGNOSTICS v_linked_count = ROW_COUNT;
  IF v_linked_count <> v_pickup_count THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'cash_pickups_already_linked';
  END IF;

  UPDATE public.messenger_jobs
  SET status = 'deposited', deposited_at = v_deposited_at
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  -- สถานะสุดท้ายของใบฝากและงานต้องอยู่ใน transaction เดียวกับการรับเงินจริง
  -- ไม่เช่นนั้นคำสั่ง UPDATE ที่สองล้มจะทำให้เงินถูกผูกแล้ว แต่งานค้างกลางทาง
  IF v_deposit.variance_satang = 0 THEN
    IF v_deposit.slip_photo_id IS NOT NULL THEN
      UPDATE public.bank_deposits
      SET status = 'matched'
      WHERE id = v_deposit.id
      RETURNING * INTO v_deposit;
    END IF;

    UPDATE public.messenger_jobs
    SET status = 'completed', completed_at = v_completed_at
    WHERE id = p_job_id
    RETURNING * INTO v_job;
  ELSE
    UPDATE public.bank_deposits
    SET status = 'variance_pending'
    WHERE id = v_deposit.id
    RETURNING * INTO v_deposit;

    UPDATE public.messenger_jobs
    SET status = 'pending_review'
    WHERE id = p_job_id
    RETURNING * INTO v_job;
  END IF;

  RETURN jsonb_build_object(
    'deposit', to_jsonb(v_deposit),
    'pickup_count', v_pickup_count,
    'expected_total_satang', v_expected_total,
    'job', to_jsonb(v_job)
  );
END;
$$;

-- แนบสลิปและปิดใบฝากยอดตรงพร้อมกัน เพราะหลังแนบรูปแล้วรูปเป็น write-once
-- ถ้าการเปลี่ยน recorded -> matched ล้ม ผู้ใช้ต้องยังแก้ไข/ลองใหม่ได้
CREATE OR REPLACE FUNCTION public.attach_bank_deposit_slip(
  p_deposit_id UUID,
  p_actor_id UUID,
  p_slip_photo_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_deposit public.bank_deposits;
BEGIN
  SELECT * INTO v_deposit
  FROM public.bank_deposits
  WHERE id = p_deposit_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'bank_deposit_not_found';
  END IF;
  IF v_deposit.submitted_by IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'deposit_not_submitted_by_actor';
  END IF;
  IF v_deposit.slip_photo_id IS NOT NULL
     OR v_deposit.status NOT IN ('recorded', 'variance_pending') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'deposit_slip_not_allowed';
  END IF;

  UPDATE public.bank_deposits
  SET slip_photo_id = p_slip_photo_id,
      slip_status = 'attached'
  WHERE id = p_deposit_id
  RETURNING * INTO v_deposit;

  IF v_deposit.variance_satang = 0 AND v_deposit.status = 'recorded' THEN
    UPDATE public.bank_deposits
    SET status = 'matched'
    WHERE id = p_deposit_id
    RETURNING * INTO v_deposit;
  END IF;

  RETURN jsonb_build_object('deposit', to_jsonb(v_deposit));
END;
$$;

-- การตัดสินผลต่างมี 4 แถวที่ต้องไปด้วยกัน: review, report, deposit และ job
-- trigger ของ review ยังเป็นแหล่งตรวจสิทธิ์/segregation of duties เดิม แต่การ
-- ทำให้ทุกแถว commit หรือ rollback พร้อมกันต้องอยู่ใน transaction เดียวนี้
CREATE OR REPLACE FUNCTION public.review_cash_variance(
  p_report_id UUID,
  p_decision TEXT,
  p_reason TEXT,
  p_actor_id UUID,
  p_reviewer_signature TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_report public.cash_variance_reports;
  v_deposit public.bank_deposits;
  v_review public.cash_variance_reviews;
  v_job public.messenger_jobs;
  v_reviewer_role TEXT;
  v_reviewer_dept_code TEXT;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected', 'returned') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'variance_decision_invalid';
  END IF;

  SELECT * INTO v_report
  FROM public.cash_variance_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'cash_variance_report_not_found';
  END IF;
  IF v_report.status <> 'pending_review' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'variance_report_not_pending';
  END IF;

  SELECT * INTO v_deposit
  FROM public.bank_deposits
  WHERE id = v_report.deposit_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'bank_deposit_not_found';
  END IF;

  SELECT p.role, d.code
  INTO v_reviewer_role, v_reviewer_dept_code
  FROM public.profiles p
  LEFT JOIN public.departments d ON d.id = p.department_id
  WHERE p.id = p_actor_id
    AND p.is_active IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'variance_reviewer_not_active';
  END IF;

  -- assert_variance_approver ตรวจ role/dept, ผู้เกี่ยวข้องกับเงินก้อนนี้,
  -- snapshot และเปลี่ยนสถานะ report ใต้ lock ซ้ำอีกชั้นก่อน insert สำเร็จ
  INSERT INTO public.cash_variance_reviews (
    report_id, decision, variance_satang_at_decision, actual_amount_satang_at_decision,
    reason, slip_checked, reviewed_by, reviewer_signature, reviewer_role, reviewer_dept_code
  ) VALUES (
    p_report_id, p_decision, v_deposit.variance_satang, v_deposit.actual_amount_satang,
    p_reason, TRUE, p_actor_id, p_reviewer_signature, v_reviewer_role, v_reviewer_dept_code
  )
  RETURNING * INTO v_review;

  IF p_decision = 'approved' THEN
    UPDATE public.bank_deposits
    SET status = 'variance_resolved', resolved_review_id = v_review.id
    WHERE id = v_deposit.id
      AND status = 'variance_pending'
    RETURNING * INTO v_deposit;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'variance_deposit_not_pending';
    END IF;
  END IF;

  IF p_decision IN ('approved', 'rejected') THEN
    UPDATE public.messenger_jobs
    SET status = 'closed',
        closed_at = now(),
        closed_by = p_actor_id,
        closer_signature = p_reviewer_signature
    WHERE id = v_deposit.job_id
      AND status = 'pending_review'
    RETURNING * INTO v_job;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'variance_job_not_pending';
    END IF;
  ELSE
    SELECT * INTO v_job
    FROM public.messenger_jobs
    WHERE id = v_deposit.job_id;
  END IF;

  RETURN jsonb_build_object(
    'review', to_jsonb(v_review),
    'deposit', to_jsonb(v_deposit),
    'job', to_jsonb(v_job)
  );
END;
$$;

-- API เช็กก่อนเพื่อให้ข้อความที่เป็นมิตร แต่ trigger นี้เป็นด่านสุดท้ายที่ serialize
-- การลดสิทธิ์/ปิดใช้/ลบ super_admin จากคำขอพร้อมกัน รวมถึงการลบผ่าน Auth cascade
CREATE OR REPLACE FUNCTION public.require_active_super_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_remaining BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT (
      OLD.role = 'super_admin'
      AND OLD.is_active IS TRUE
      AND (NEW.role IS DISTINCT FROM 'super_admin' OR NEW.is_active IS NOT TRUE)
    ) THEN
      RETURN NEW;
    END IF;
  ELSIF NOT (OLD.role = 'super_admin' AND OLD.is_active IS TRUE) THEN
    RETURN OLD;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(726381011::BIGINT);
  SELECT COUNT(*) INTO v_remaining
  FROM public.profiles
  WHERE id <> OLD.id
    AND role = 'super_admin'
    AND is_active IS TRUE;
  IF v_remaining = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'last_active_super_admin';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_require_active_super_admin ON public.profiles;
CREATE TRIGGER profiles_require_active_super_admin
  BEFORE UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.require_active_super_admin();

REVOKE ALL ON FUNCTION public.record_cash_pickup(UUID, UUID, UUID, UUID, UUID, TEXT, INTEGER, BIGINT, UUID, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_bank_deposit(UUID, UUID, UUID, UUID, TEXT, BIGINT, TEXT, TEXT, UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_bank_deposit_slip(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_cash_variance(UUID, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.require_active_super_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_cash_pickup(UUID, UUID, UUID, UUID, UUID, TEXT, INTEGER, BIGINT, UUID, TIMESTAMPTZ, NUMERIC, NUMERIC, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_bank_deposit(UUID, UUID, UUID, UUID, TEXT, BIGINT, TEXT, TEXT, UUID, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_bank_deposit_slip(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_cash_variance(UUID, TEXT, TEXT, UUID, TEXT) TO service_role;

COMMIT;
