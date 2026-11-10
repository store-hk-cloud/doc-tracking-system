BEGIN;

CREATE SCHEMA document_receipt_private;
REVOKE ALL ON SCHEMA document_receipt_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE document_receipt_private.batches (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  signature text,
  actor_email text,
  items jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON document_receipt_private.batches (actor_id, created_at DESC, id DESC);

CREATE TABLE document_receipt_private.jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES document_receipt_private.batches(id),
  recipient_id uuid NOT NULL,
  expected_updated_at timestamptz NOT NULL,
  document_no text,
  status text NOT NULL CHECK (status IN ('queued', 'succeeded', 'failed')),
  error text,
  finished_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX ON document_receipt_private.jobs (batch_id, id);
CREATE INDEX ON document_receipt_private.jobs (id) WHERE status = 'queued';
CREATE UNIQUE INDEX ON document_receipt_private.jobs (recipient_id, expected_updated_at)
  WHERE status IN ('queued', 'succeeded');
REVOKE ALL ON ALL TABLES IN SCHEMA document_receipt_private FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION document_receipt_private.get_actor(p_actor_id uuid)
RETURNS public.profiles
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = p_actor_id FOR SHARE;
  IF NOT FOUND OR v_actor.is_active IS FALSE THEN
    RAISE EXCEPTION 'receipt_actor_not_authenticated';
  END IF;
  IF v_actor.role NOT IN ('super_admin', 'admin', 'user') THEN
    RAISE EXCEPTION 'receipt_forbidden';
  END IF;
  RETURN v_actor;
END;
$$;

CREATE FUNCTION document_receipt_private.check_recipient(
  p_recipient_id uuid,
  p_expected_updated_at timestamptz,
  p_department_id uuid,
  p_lock boolean
)
RETURNS TABLE (document_no text, error text)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_recipient public.document_recipients;
  v_document public.documents;
  v_expected_status text := 'delivered';
  v_department_code text;
BEGIN
  IF p_lock THEN
    SELECT * INTO v_recipient FROM public.document_recipients WHERE id = p_recipient_id FOR UPDATE;
  ELSE
    SELECT * INTO v_recipient FROM public.document_recipients WHERE id = p_recipient_id;
  END IF;

  IF v_recipient.id IS NULL THEN
    error := 'document_recipient_not_found';
  ELSIF p_department_id IS DISTINCT FROM v_recipient.department_id THEN
    error := 'receipt_forbidden';
  ELSE
    IF p_lock THEN
      SELECT * INTO v_document FROM public.documents WHERE id = v_recipient.document_id FOR SHARE;
    ELSE
      SELECT * INTO v_document FROM public.documents WHERE id = v_recipient.document_id;
    END IF;
    IF v_document.subject = 'ใบรับสินค้า' THEN
      IF p_lock THEN
        SELECT code INTO v_department_code FROM public.departments WHERE id = p_department_id FOR SHARE;
      ELSE
        SELECT code INTO v_department_code FROM public.departments WHERE id = p_department_id;
      END IF;
      IF v_department_code IS DISTINCT FROM '0-ADM03' THEN
        error := 'receipt_forbidden';
      END IF;
      v_expected_status := 'awaiting_recipient';
    END IF;
    IF error IS NULL THEN
      document_no := COALESCE(NULLIF(v_document.display_no, ''), v_document.running_no::text);
      IF v_recipient.status IS DISTINCT FROM v_expected_status THEN
        error := 'recipient_already_processed';
      ELSIF v_recipient.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        error := 'receipt_stale';
      END IF;
    END IF;
  END IF;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION document_receipt_private.batch_status(p_batch_id uuid)
RETURNS jsonb
LANGUAGE sql
SET search_path = ''
SET timezone = 'UTC'
AS $$
  SELECT jsonb_build_object(
    'id', batch.id,
    'created_at', batch.created_at,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'recipient_id', job.recipient_id,
        'expected_updated_at', job.expected_updated_at,
        'document_no', job.document_no,
        'status', job.status,
        'error', job.error
      ) ORDER BY job.id)
      FROM document_receipt_private.jobs job WHERE job.batch_id = batch.id
    ), '[]'::jsonb)
  )
  FROM document_receipt_private.batches batch WHERE batch.id = p_batch_id;
$$;

CREATE FUNCTION public.enqueue_document_receipts(
  p_actor_id uuid,
  p_batch_id uuid,
  p_signature text,
  p_items jsonb,
  p_actor_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET timezone = 'UTC'
AS $$
DECLARE
  v_actor public.profiles;
  v_batch document_receipt_private.batches;
  v_items jsonb;
  v_item record;
  v_result record;
BEGIN
  v_actor := document_receipt_private.get_actor(p_actor_id);
  IF p_batch_id IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'receipt_invalid_batch';
  END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'receipt_invalid_batch';
  END IF;
  BEGIN
    SELECT jsonb_agg(jsonb_build_object(
      'recipient_id', (item.value ->> 'recipient_id')::uuid,
      'expected_updated_at', (item.value ->> 'expected_updated_at')::timestamptz
    ) ORDER BY item.ordinality) INTO v_items
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS item(value, ordinality);
  EXCEPTION WHEN data_exception THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'receipt_invalid_batch';
  END;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_items) AS item(recipient_id uuid, expected_updated_at timestamptz)
    WHERE recipient_id IS NULL OR expected_updated_at IS NULL OR NOT isfinite(expected_updated_at)
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_items) AS item(recipient_id uuid)
    GROUP BY recipient_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'receipt_invalid_batch';
  END IF;

  -- ล็อกการเข้าคิวแยกจาก worker เพื่อกันสอง batch จองเอกสารชุดเดียวกันคนละลำดับ
  PERFORM pg_advisory_xact_lock(20261110, 123001);
  INSERT INTO document_receipt_private.batches (id, actor_id, signature, actor_email, items)
  VALUES (p_batch_id, p_actor_id, p_signature, p_actor_email, v_items)
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO v_batch FROM document_receipt_private.batches WHERE id = p_batch_id;
    -- การส่งซ้ำต้องใช้ลำดับรายการเดิมหลังแปลง UUID และเวลารับเป็นชนิดมาตรฐาน
    IF v_batch.actor_id IS DISTINCT FROM p_actor_id OR v_batch.items IS DISTINCT FROM v_items
      OR v_batch.signature IS DISTINCT FROM p_signature OR v_batch.actor_email IS DISTINCT FROM p_actor_email THEN
      RAISE EXCEPTION 'receipt_batch_conflict';
    END IF;
    RETURN document_receipt_private.batch_status(p_batch_id);
  END IF;

  -- กันคิวที่ยังทำงานมากเกินกว่าหน้ารายการจะแสดงและตรวจสถานะได้ครบ
  IF (
    SELECT count(*) FROM document_receipt_private.batches batch WHERE batch.actor_id = p_actor_id
      AND EXISTS (SELECT 1 FROM document_receipt_private.jobs job WHERE job.batch_id = batch.id AND job.status = 'queued')
  ) >= 5 THEN
    RAISE EXCEPTION 'receipt_queue_busy';
  END IF;

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(v_items) AS item(recipient_id uuid, expected_updated_at timestamptz)
  LOOP
    SELECT * INTO v_result FROM document_receipt_private.check_recipient(
      v_item.recipient_id, v_item.expected_updated_at, v_actor.department_id, false
    );
    INSERT INTO document_receipt_private.jobs (batch_id, recipient_id, expected_updated_at, document_no, status, error)
    VALUES (p_batch_id, v_item.recipient_id, v_item.expected_updated_at, v_result.document_no,
      CASE WHEN v_result.error IS NULL THEN 'queued' ELSE 'failed' END, v_result.error)
    ON CONFLICT (recipient_id, expected_updated_at) WHERE status IN ('queued', 'succeeded') DO NOTHING;
    IF NOT FOUND THEN
      INSERT INTO document_receipt_private.jobs (batch_id, recipient_id, expected_updated_at, document_no, status, error)
      VALUES (p_batch_id, v_item.recipient_id, v_item.expected_updated_at, v_result.document_no, 'failed', 'receipt_duplicate');
    END IF;
  END LOOP;

  RETURN document_receipt_private.batch_status(p_batch_id);
END;
$$;

CREATE FUNCTION public.list_document_receipt_batches(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM document_receipt_private.get_actor(p_actor_id);
  SELECT COALESCE(jsonb_agg(document_receipt_private.batch_status(recent.id)
    ORDER BY recent.active DESC, recent.activity_at DESC, recent.id DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT batch.id, COALESCE((SELECT max(job.finished_at) FROM document_receipt_private.jobs job
      WHERE job.batch_id = batch.id), batch.created_at) AS activity_at, EXISTS (
      SELECT 1 FROM document_receipt_private.jobs job WHERE job.batch_id = batch.id AND job.status = 'queued'
    ) AS active
    FROM document_receipt_private.batches batch
    WHERE batch.actor_id = p_actor_id
    ORDER BY active DESC, activity_at DESC, batch.id DESC
    LIMIT 10
  ) recent;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.process_document_receipt_queue()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_job document_receipt_private.jobs;
  v_batch document_receipt_private.batches;
  v_actor public.profiles;
  v_result record;
  v_error text;
  v_status text := 'failed';
BEGIN
  IF NOT pg_try_advisory_xact_lock(20261110, 123000) THEN
    RETURN jsonb_build_object('status', 'busy');
  END IF;
  SELECT * INTO v_job FROM document_receipt_private.jobs
  WHERE status = 'queued' ORDER BY id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'idle');
  END IF;
  SELECT * INTO v_batch FROM document_receipt_private.batches WHERE id = v_job.batch_id;

  BEGIN
    v_actor := document_receipt_private.get_actor(v_batch.actor_id);
    SELECT * INTO v_result FROM document_receipt_private.check_recipient(
      v_job.recipient_id, v_job.expected_updated_at, v_actor.department_id, true
    );
    v_error := v_result.error;
    IF v_error IS NULL THEN
      PERFORM public.receive_document_worker(
        v_job.recipient_id, v_batch.actor_id, v_batch.signature, true, NULL, v_batch.actor_email
      );
      v_status := 'succeeded';
    END IF;
  EXCEPTION
    WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN
      IF v_job.attempts < 2 THEN
        v_status := 'queued';
      ELSE
        v_error := 'receipt_processing_failed';
      END IF;
    WHEN OTHERS THEN
      v_error := CASE WHEN SQLERRM IN (
        'receipt_actor_not_authenticated', 'receipt_forbidden', 'document_recipient_not_found', 'recipient_already_processed'
      ) THEN SQLERRM ELSE 'receipt_processing_failed' END;
  END;

  UPDATE document_receipt_private.jobs
  SET status = v_status, error = v_error, attempts = attempts + 1,
    finished_at = CASE WHEN v_status <> 'queued' THEN clock_timestamp() END,
    document_no = CASE WHEN v_error IN ('receipt_actor_not_authenticated', 'receipt_forbidden', 'document_recipient_not_found')
      THEN NULL ELSE document_no END
  WHERE id = v_job.id;
  RETURN jsonb_build_object('status', v_status);
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA document_receipt_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enqueue_document_receipts(uuid, uuid, text, jsonb, text),
  public.list_document_receipt_batches(uuid), public.process_document_receipt_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_document_receipts(uuid, uuid, text, jsonb, text),
  public.list_document_receipt_batches(uuid), public.process_document_receipt_queue() TO service_role;

COMMIT;
