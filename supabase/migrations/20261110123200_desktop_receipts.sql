BEGIN;

CREATE FUNCTION public.list_desktop_pending_receipts(p_search text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET timezone = 'UTC'
AS $$
DECLARE
  v_actor public.profiles;
  v_search text := lower(left(btrim(coalesce(p_search, '')), 120));
  v_result jsonb;
BEGIN
  v_actor := document_receipt_private.get_actor(auth.uid());

  SELECT coalesce(jsonb_agg(to_jsonb(pending) ORDER BY pending.delivery_date DESC NULLS LAST,
    pending.updated_at DESC, pending.recipient_id), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT recipient.id AS recipient_id, recipient.updated_at,
      coalesce(nullif(document.display_no, ''), document.running_no::text) AS document_no,
      document.sender, document.subject, recipient.admin_signed_at AS delivery_date,
      department.name AS department, recipient.status AS stage
    FROM public.document_recipients recipient
    JOIN public.documents document ON document.id = recipient.document_id
    JOIN public.departments department ON department.id = recipient.department_id
    WHERE recipient.department_id = v_actor.department_id
      AND isfinite(recipient.updated_at)
      AND (
        (document.subject <> 'ใบรับสินค้า' AND recipient.status = 'delivered')
        OR (document.subject = 'ใบรับสินค้า' AND recipient.status = 'awaiting_recipient' AND department.code = '0-ADM03')
      )
      AND (v_search = ''
        OR strpos(lower(coalesce(nullif(document.display_no, ''), document.running_no::text, '')), v_search) > 0
        OR strpos(lower(coalesce(document.sender, '')), v_search) > 0
        OR strpos(lower(document.subject), v_search) > 0)
      AND NOT EXISTS (
        SELECT 1 FROM document_receipt_private.jobs job
        WHERE job.recipient_id = recipient.id AND job.expected_updated_at = recipient.updated_at
          AND job.status IN ('queued', 'succeeded')
      )
    ORDER BY delivery_date DESC NULLS LAST, recipient.updated_at DESC, recipient_id
    LIMIT 100
  ) pending;

  RETURN v_result;
END;
$$;

CREATE FUNCTION public.enqueue_desktop_receipts(p_batch_id uuid, p_signature_name text, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_signature text := nullif(btrim(p_signature_name), '');
  v_items jsonb;
BEGIN
  PERFORM document_receipt_private.get_actor(v_actor_id);
  IF v_signature IS NULL OR length(v_signature) > 255 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'receipt_invalid_signature';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'receipt_invalid_batch';
  END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'receipt_invalid_batch';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'recipient_id', item.value->'recipientId',
    'expected_updated_at', item.value->'expectedUpdatedAt'
  ) ORDER BY item.ordinality) INTO v_items
  FROM jsonb_array_elements(p_items) WITH ORDINALITY AS item(value, ordinality);

  RETURN public.enqueue_document_receipts(v_actor_id, p_batch_id, v_signature, v_items, auth.jwt()->>'email');
END;
$$;

CREATE FUNCTION public.list_desktop_receipt_batches()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.list_document_receipt_batches(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.list_desktop_pending_receipts(text),
  public.enqueue_desktop_receipts(uuid, text, jsonb), public.list_desktop_receipt_batches()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_desktop_pending_receipts(text),
  public.enqueue_desktop_receipts(uuid, text, jsonb), public.list_desktop_receipt_batches() TO authenticated;

COMMIT;
