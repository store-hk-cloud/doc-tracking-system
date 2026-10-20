BEGIN;

CREATE OR REPLACE FUNCTION public.void_cash_run(
  p_job_id UUID, p_actor_id UUID, p_reason TEXT,
  p_request_ip TEXT DEFAULT NULL, p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_job public.messenger_jobs;
  v_deposit public.bank_deposits;
  v_actor public.profiles;
  v_dept_code TEXT;
  v_from_status TEXT;
  v_signature TEXT;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.role <> 'super_admin' OR v_actor.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'void_forbidden';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'void_reason_required';
  END IF;
  SELECT code INTO v_dept_code FROM public.departments WHERE id = v_actor.department_id;
  v_signature := coalesce(nullif(v_actor.full_name, ''), v_actor.email, 'ผู้ใช้ระบบ');

  -- ล็อกทริปก่อนใบฝากเช่นเดียวกับ record_bank_deposit ป้องกันการฝากชนกับยกเลิก
  SELECT * INTO v_job FROM public.messenger_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cash_job_not_found'; END IF;
  IF v_job.status NOT IN ('open', 'picked_up', 'deposited', 'completed', 'pending_review') THEN
    RAISE EXCEPTION 'cash_job_already_processed';
  END IF;
  v_from_status := v_job.status;

  SELECT * INTO v_deposit FROM public.bank_deposits
  WHERE job_id = p_job_id AND status <> 'voided' FOR UPDATE;
  IF FOUND THEN
    UPDATE public.bank_deposits SET status = 'voided', void_reason = btrim(p_reason)
    WHERE id = v_deposit.id RETURNING * INTO v_deposit;
  END IF;

  IF v_from_status IN ('open', 'picked_up') THEN
    UPDATE public.messenger_jobs SET status = 'cancelled', cancelled_at = now(),
      cancelled_by = p_actor_id, cancel_reason = btrim(p_reason)
    WHERE id = p_job_id RETURNING * INTO v_job;
  ELSE
    -- ทริปรุ่นเก่าอาจค้างที่ deposited; ผ่าน transition ที่ guard รองรับใน transaction เดียว
    IF v_from_status = 'deposited' THEN
      UPDATE public.messenger_jobs SET status = 'completed' WHERE id = p_job_id;
    END IF;
    UPDATE public.messenger_jobs SET status = 'closed', closed_at = now(),
      closed_by = p_actor_id, closer_signature = v_signature
    WHERE id = p_job_id RETURNING * INTO v_job;
  END IF;

  INSERT INTO public.messenger_job_audit (
    job_id, entity, entity_id, action, from_status, to_status,
    amount_satang, variance_satang, reason, actor_id, actor_signature,
    actor_role, actor_dept_code, request_ip, user_agent
  ) VALUES (
    p_job_id, CASE WHEN v_deposit.id IS NULL THEN 'job' ELSE 'deposit' END,
    coalesce(v_deposit.id, p_job_id)::TEXT, 'void_run', v_from_status, v_job.status,
    v_deposit.actual_amount_satang, v_deposit.variance_satang, btrim(p_reason),
    p_actor_id, v_signature, v_actor.role, v_dept_code, left(p_request_ip, 64), left(p_user_agent, 500)
  );

  RETURN jsonb_build_object('job_id', p_job_id, 'voided_deposit_id', v_deposit.id);
END;
$$;

REVOKE ALL ON FUNCTION public.void_cash_run(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_cash_run(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
