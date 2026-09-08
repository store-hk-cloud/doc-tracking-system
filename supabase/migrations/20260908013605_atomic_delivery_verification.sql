BEGIN;

CREATE OR REPLACE FUNCTION public.verify_document_delivery(p_delivery_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_delivery public.delivery_logs;
  v_recipient public.document_recipients;
BEGIN
  -- ตรวจเงื่อนไขใต้ล็อกเดียวกับการเขียน ป้องกันคำขอพร้อมกันปิดงานซ้ำ
  SELECT * INTO v_delivery FROM public.delivery_logs WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'delivery_not_found';
  END IF;
  IF v_delivery.verified_by_admin IS TRUE THEN
    RAISE EXCEPTION 'delivery_already_verified';
  END IF;
  IF v_delivery.is_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'delivery_rejected';
  END IF;

  UPDATE public.delivery_logs
  SET verified_by_admin = true, verified_by_admin_at = now()
  WHERE id = p_delivery_id RETURNING * INTO v_delivery;

  UPDATE public.document_recipients SET status = 'closed'
  WHERE id = v_delivery.document_recipient_id RETURNING * INTO v_recipient;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery_recipient_not_found';
  END IF;

  RETURN jsonb_build_object('delivery', to_jsonb(v_delivery), 'recipient', to_jsonb(v_recipient));
END;
$$;

REVOKE ALL ON FUNCTION public.verify_document_delivery(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_document_delivery(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.receive_document(
  p_recipient_id UUID,
  p_expected_status TEXT,
  p_actor_id UUID,
  p_signature TEXT,
  p_is_verified BOOLEAN,
  p_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_recipient public.document_recipients;
  v_delivery public.delivery_logs;
BEGIN
  SELECT * INTO v_recipient FROM public.document_recipients
  WHERE id = p_recipient_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_recipient_not_found';
  END IF;
  IF v_recipient.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'recipient_already_processed';
  END IF;

  UPDATE public.document_recipients
  SET status = CASE WHEN p_is_verified THEN 'closed' ELSE 'rejected' END
  WHERE id = p_recipient_id RETURNING * INTO v_recipient;

  INSERT INTO public.delivery_logs (
    document_recipient_id, document_id, recipient_id,
    recipient_signature, is_verified, verification_note
  ) VALUES (
    p_recipient_id, v_recipient.document_id, p_actor_id,
    p_signature, p_is_verified, p_note
  ) RETURNING * INTO v_delivery;

  RETURN jsonb_build_object('recipient', to_jsonb(v_recipient), 'delivery', to_jsonb(v_delivery));
END;
$$;

REVOKE ALL ON FUNCTION public.receive_document(UUID, TEXT, UUID, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_document(UUID, TEXT, UUID, TEXT, BOOLEAN, TEXT) TO service_role;

COMMIT;
