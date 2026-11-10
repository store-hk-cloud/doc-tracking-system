BEGIN;

CREATE OR REPLACE FUNCTION public.receive_document_worker(
  p_recipient_id UUID,
  p_actor_id UUID,
  p_signature TEXT,
  p_is_verified BOOLEAN,
  p_note TEXT,
  p_actor_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_recipient public.document_recipients;
  v_actor RECORD;
  v_subject TEXT;
  v_expected_status TEXT;
BEGIN
  -- ล็อกผู้รับก่อนอ่านสิทธิ์และสถานะ เพื่อใช้ข้อมูลล่าสุดหลังรอรายการที่กำลังเขียน
  SELECT * INTO v_recipient FROM public.document_recipients
  WHERE id = p_recipient_id FOR UPDATE;

  SELECT p.role, p.department_id, p.full_name, p.is_active, d.code
  INTO v_actor
  FROM public.profiles p
  LEFT JOIN public.departments d ON d.id = p.department_id
  WHERE p.id = p_actor_id;

  IF NOT FOUND OR v_actor.is_active IS FALSE THEN
    RAISE EXCEPTION 'receipt_actor_not_authenticated';
  END IF;
  IF v_actor.role NOT IN ('super_admin', 'admin', 'user') THEN
    RAISE EXCEPTION 'receipt_forbidden';
  END IF;
  IF p_is_verified IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'receipt_invalid_verification';
  END IF;
  IF v_recipient.id IS NULL THEN
    RAISE EXCEPTION 'document_recipient_not_found';
  END IF;
  IF v_actor.department_id IS DISTINCT FROM v_recipient.department_id THEN
    RAISE EXCEPTION 'receipt_forbidden';
  END IF;

  SELECT subject INTO v_subject FROM public.documents WHERE id = v_recipient.document_id;
  IF v_subject = 'ใบรับสินค้า' THEN
    IF v_actor.code IS DISTINCT FROM '0-ADM03' THEN
      RAISE EXCEPTION 'receipt_forbidden';
    END IF;
    v_expected_status := 'awaiting_recipient';
  ELSE
    v_expected_status := 'delivered';
  END IF;

  RETURN public.receive_document(
    p_recipient_id,
    v_expected_status,
    p_actor_id,
    COALESCE(NULLIF(p_signature, ''), NULLIF(v_actor.full_name, ''), p_actor_email, ''),
    p_is_verified,
    p_note
  );
END;
$$;

REVOKE ALL ON FUNCTION public.receive_document_worker(UUID, UUID, TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_document_worker(UUID, UUID, TEXT, BOOLEAN, TEXT, TEXT) TO service_role;

COMMIT;
