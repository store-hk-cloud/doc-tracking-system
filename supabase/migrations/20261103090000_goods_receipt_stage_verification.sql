BEGIN;
ALTER TABLE document_recipients
  ADD COLUMN IF NOT EXISTS inspector_verified boolean,
  ADD COLUMN IF NOT EXISTS inspector_verification_note text,
  ADD COLUMN IF NOT EXISTS purchasing_verified boolean,
  ADD COLUMN IF NOT EXISTS purchasing_verification_note text;
ALTER TABLE document_approval_audit
  ADD COLUMN IF NOT EXISTS is_verified boolean,
  ADD COLUMN IF NOT EXISTS verification_note text;
ALTER TABLE document_approval_audit DROP CONSTRAINT IF EXISTS document_approval_audit_action_check;
ALTER TABLE document_approval_audit ADD CONSTRAINT document_approval_audit_action_check
  CHECK (action IN ('signed', 'updated', 'reset', 'rejected'));

-- ลบ signature เดิมเพื่อไม่ให้ PostgREST เลือก overload ที่ข้ามผลตรวจได้
DROP FUNCTION IF EXISTS sign_goods_receipt_stage(uuid, text, text, uuid, text, text[]);
CREATE OR REPLACE FUNCTION sign_goods_receipt_stage(
  p_recipient_id uuid, p_stage text, p_signature text, p_actor_id uuid,
  p_actor_name text, p_allowed_status text[], p_is_verified boolean DEFAULT true,
  p_verification_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_row document_recipients;
  v_previous text;
  v_previous_verified boolean;
  v_previous_note text;
  v_current text;
  v_next text;
  v_edit boolean;
  v_note text := NULLIF(btrim(p_verification_note), '');
BEGIN
  IF p_stage NOT IN ('inspector', 'purchasing') OR p_stage IS NULL THEN
    RAISE EXCEPTION 'invalid_stage';
  END IF;
  IF p_is_verified IS NULL OR NULLIF(btrim(p_signature), '') IS NULL
    OR (NOT p_is_verified AND v_note IS NULL) THEN
    RAISE EXCEPTION 'invalid_verification';
  END IF;
  SELECT * INTO v_row FROM document_recipients WHERE id = p_recipient_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'document_recipient_not_found'; END IF;
  v_current := 'awaiting_' || p_stage;
  v_next := CASE p_stage WHEN 'inspector' THEN 'awaiting_purchasing' ELSE 'awaiting_recipient' END;
  IF v_row.status NOT IN (v_current, v_next) OR NOT (v_row.status = ANY(p_allowed_status)) THEN
    RAISE EXCEPTION 'stage_changed';
  END IF;
  v_edit := v_row.status = v_next;
  IF p_stage = 'inspector' THEN
    v_previous := v_row.inspector_signature;
    v_previous_verified := v_row.inspector_verified;
    v_previous_note := v_row.inspector_verification_note;
  ELSE
    v_previous := v_row.purchasing_signature;
    v_previous_verified := v_row.purchasing_verified;
    v_previous_note := v_row.purchasing_verification_note;
  END IF;
  -- ขั้นถัดไปให้แก้เฉพาะชื่อ โดยคงผลเดิมรวมถึง null ของข้อมูลก่อน migration
  IF v_edit AND (NOT p_is_verified OR v_previous_verified = false OR NULLIF(v_previous, '') IS NULL) THEN
    RAISE EXCEPTION 'stage_changed';
  END IF;
  IF p_stage = 'inspector' THEN
    UPDATE document_recipients SET inspector_signature = p_signature,
      inspector_signed_by = p_actor_id, inspector_signed_at = now(),
      inspector_verified = CASE WHEN v_edit THEN v_previous_verified ELSE p_is_verified END,
      inspector_verification_note = CASE WHEN v_edit THEN v_previous_note ELSE v_note END,
      status = CASE WHEN v_edit THEN status WHEN p_is_verified THEN v_next ELSE 'rejected' END
    WHERE id = p_recipient_id RETURNING * INTO v_row;
  ELSE
    UPDATE document_recipients SET purchasing_signature = p_signature,
      purchasing_signed_by = p_actor_id, purchasing_signed_at = now(),
      purchasing_verified = CASE WHEN v_edit THEN v_previous_verified ELSE p_is_verified END,
      purchasing_verification_note = CASE WHEN v_edit THEN v_previous_note ELSE v_note END,
      status = CASE WHEN v_edit THEN status WHEN p_is_verified THEN v_next ELSE 'rejected' END
    WHERE id = p_recipient_id RETURNING * INTO v_row;
  END IF;
  INSERT INTO document_approval_audit(document_recipient_id,stage,action,signature,previous_signature,actor_id,actor_name,is_verified,verification_note)
  VALUES(p_recipient_id,p_stage,CASE WHEN v_edit THEN 'updated' WHEN p_is_verified THEN 'signed' ELSE 'rejected' END,
    p_signature,NULLIF(v_previous,''),p_actor_id,p_actor_name,
    CASE WHEN v_edit THEN v_previous_verified ELSE p_is_verified END,
    CASE WHEN v_edit THEN v_previous_note ELSE v_note END);
  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION reset_goods_receipt_stages(p_recipient_id uuid, p_actor_id uuid, p_actor_name text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_row document_recipients;
BEGIN
  SELECT * INTO v_row FROM document_recipients WHERE id = p_recipient_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.status <> 'rejected' THEN RAISE EXCEPTION 'stage_changed'; END IF;
  INSERT INTO document_approval_audit(document_recipient_id,stage,action,signature,previous_signature,actor_id,actor_name,is_verified,verification_note)
  SELECT p_recipient_id, stage, 'reset', NULL, signature, p_actor_id, p_actor_name, verified, note
  FROM (VALUES ('inspector',v_row.inspector_signature,v_row.inspector_verified,v_row.inspector_verification_note),
    ('purchasing',v_row.purchasing_signature,v_row.purchasing_verified,v_row.purchasing_verification_note)) AS stages(stage,signature,verified,note)
  WHERE signature IS NOT NULL OR verified IS NOT NULL;
  UPDATE document_recipients SET status = 'awaiting_inspector',
    inspector_signature = NULL, inspector_signed_by = NULL, inspector_signed_at = NULL,
    purchasing_signature = NULL, purchasing_signed_by = NULL, purchasing_signed_at = NULL,
    inspector_verified = NULL, inspector_verification_note = NULL,
    purchasing_verified = NULL, purchasing_verification_note = NULL
  WHERE id = p_recipient_id RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION sign_goods_receipt_stage(uuid,text,text,uuid,text,text[],boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sign_goods_receipt_stage(uuid,text,text,uuid,text,text[],boolean,text) TO service_role;
REVOKE ALL ON FUNCTION reset_goods_receipt_stages(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reset_goods_receipt_stages(uuid,uuid,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
