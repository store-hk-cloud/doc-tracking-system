-- ============================================================
-- ทำให้การเขียนสองจุดที่ต้องไปด้วยกัน อยู่ใน transaction เดียว
--
-- supabase-js ไม่มี transaction ข้าม HTTP ได้ ทุกคำสั่งจึง commit แยกกัน
-- API route ที่ต้องเขียนหลายตารางจึงค้างครึ่งทางได้เมื่อคำสั่งหลังล้มเหลว
-- ทางเดียวที่ได้ transaction จริงคือย้ายลำดับการเขียนมาอยู่ในฟังก์ชันฝั่ง DB
-- (ฟังก์ชัน plpgsql ทั้งก้อนรันใน transaction เดียว ล้มที่ไหนก็ย้อนหมด)
--
-- ฟังก์ชันในไฟล์นี้เป็น "กลไกการเขียน" ไม่ใช่ "การตัดสินสิทธิ์" — การตรวจสิทธิ์
-- ยังอยู่ที่ API route เหมือนเดิม จึงต้องเรียกได้เฉพาะ service-role
-- ============================================================

-- ── 1) เซ็นอนุมัติรายด่านของใบรับสินค้า: อัปเดตสถานะ + บันทึก audit พร้อมกัน ──
--
-- เดิม route อัปเดตสถานะก่อน แล้วค่อย insert document_approval_audit
-- ถ้า audit ล้มเหลว route ตอบ 500 ทั้งที่เอกสารเดินไปขั้นถัดไปแล้ว หลักฐาน
-- การเซ็นครั้งนั้นหายไป และการลองใหม่จะถูกบันทึกเป็น 'updated' แทน 'signed'
-- เพราะลายเซ็นเดิมถูกเขียนลงไปแล้วในรอบที่ล้ม
CREATE OR REPLACE FUNCTION sign_goods_receipt_stage(
  p_recipient_id   UUID,
  p_stage          TEXT,
  p_signature      TEXT,
  p_actor_id       UUID,
  p_actor_name     TEXT,
  p_allowed_status TEXT[]
)
RETURNS JSONB AS $$
DECLARE
  v_row      document_recipients;
  v_previous TEXT;
  v_action   TEXT;
BEGIN
  IF p_stage NOT IN ('inspector', 'purchasing') THEN
    RAISE EXCEPTION 'invalid stage %', p_stage;
  END IF;

  -- ล็อกแถวไว้ก่อน เพื่อให้สองคำขอที่เซ็นด่านเดียวกันพร้อมกันเข้าคิว
  SELECT * INTO v_row FROM document_recipients WHERE id = p_recipient_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'document_recipient_not_found';
  END IF;
  IF NOT (v_row.status = ANY(p_allowed_status)) THEN
    RAISE EXCEPTION 'stage_changed';
  END IF;

  IF p_stage = 'inspector' THEN
    v_previous := v_row.inspector_signature;
    UPDATE document_recipients
       SET inspector_signature  = p_signature,
           inspector_signed_by  = p_actor_id,
           inspector_signed_at  = now(),
           status               = 'awaiting_purchasing'
     WHERE id = p_recipient_id
     RETURNING * INTO v_row;
  ELSE
    v_previous := v_row.purchasing_signature;
    UPDATE document_recipients
       SET purchasing_signature = p_signature,
           purchasing_signed_by = p_actor_id,
           purchasing_signed_at = now(),
           status               = 'awaiting_recipient'
     WHERE id = p_recipient_id
     RETURNING * INTO v_row;
  END IF;

  v_action := CASE WHEN v_previous IS NOT NULL AND v_previous <> '' THEN 'updated' ELSE 'signed' END;

  INSERT INTO document_approval_audit (
    document_recipient_id, stage, action, signature, previous_signature, actor_id, actor_name
  ) VALUES (
    p_recipient_id, p_stage, v_action, p_signature, NULLIF(v_previous, ''), p_actor_id, p_actor_name
  );

  RETURN to_jsonb(v_row);
END;
$$ LANGUAGE plpgsql;

-- ── 2) ลงทะเบียนเอกสาร: จองเลขที่ + สร้างเอกสาร + ปลายทาง + tag พร้อมกัน ──
--
-- เดิม route insert สามก้อนแยกกัน ถ้าก้อนหลังล้ม (เช่น department_id ที่ client
-- ส่งมาไม่มีอยู่จริง -> FK พัง) แถว documents ที่สร้างไปแล้วยังอยู่ ผู้ใช้กด
-- บันทึกซ้ำก็ได้เอกสารอีกใบ และเลขที่เดือนก็ถูกจองทิ้งไปแล้วหนึ่งเลข
--
-- ที่นี่รวมการจองเลขไว้ในทรานแซกชันเดียวกันด้วย ถ้าล้มเลขจะถูกคืนให้อัตโนมัติ
-- (ตัวนับ document_no_counters เป็นแถวในตาราง จึง rollback ตามได้
--  ต่างจาก documents.running_no ที่เป็น sequence ซึ่ง rollback ไม่ได้ตามปกติ)
CREATE OR REPLACE FUNCTION register_document(
  p_received_date     DATE,
  p_doc_number        TEXT,
  p_tax_invoice_no    TEXT,
  p_sender            TEXT,
  p_subject           TEXT,
  p_note              TEXT,
  p_is_damaged        BOOLEAN,
  p_damage_image_url  TEXT,
  p_recorded_by       UUID,
  p_workflow_dept_ids UUID[],
  p_tag_dept_ids      UUID[]
)
RETURNS JSONB AS $$
DECLARE
  v_display_no TEXT;
  v_doc        documents;
  v_missing    UUID;
  v_recipients JSONB;
BEGIN
  IF p_workflow_dept_ids IS NULL OR array_length(p_workflow_dept_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no_recipient_department';
  END IF;

  -- ตรวจว่าหน่วยงานทุกตัวมีอยู่จริงก่อน ให้ได้ข้อความที่อ่านรู้เรื่อง
  -- ไม่ใช่ปล่อยไปตกที่ FK แล้วได้ error ดิบ ๆ ของ Postgres
  SELECT d INTO v_missing
  FROM unnest(p_workflow_dept_ids || COALESCE(p_tag_dept_ids, ARRAY[]::UUID[])) AS d
  WHERE NOT EXISTS (SELECT 1 FROM departments dep WHERE dep.id = d)
  LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'unknown_department:%', v_missing;
  END IF;

  v_display_no := next_document_display_no(p_received_date);

  INSERT INTO documents (
    display_no, received_date, doc_number, tax_invoice_no, sender, subject,
    note, is_damaged, damage_image_url, recorded_by, recipient_dept_id
  ) VALUES (
    v_display_no, p_received_date, p_doc_number, p_tax_invoice_no, p_sender, p_subject,
    p_note, COALESCE(p_is_damaged, false), p_damage_image_url, p_recorded_by, p_workflow_dept_ids[1]
  )
  RETURNING * INTO v_doc;

  INSERT INTO document_recipients (document_id, department_id, status)
  SELECT v_doc.id, dept, 'registered'
  FROM unnest(p_workflow_dept_ids) AS dept;

  IF p_tag_dept_ids IS NOT NULL AND array_length(p_tag_dept_ids, 1) IS NOT NULL THEN
    INSERT INTO document_department_tags (document_id, department_id)
    SELECT DISTINCT v_doc.id, dept
    FROM unnest(p_tag_dept_ids) AS dept
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at, r.id) INTO v_recipients
  FROM document_recipients r WHERE r.document_id = v_doc.id;

  RETURN jsonb_build_object('document', to_jsonb(v_doc), 'recipients', COALESCE(v_recipients, '[]'::jsonb));
END;
$$ LANGUAGE plpgsql;

-- ── สิทธิ์: เรียกได้เฉพาะ service-role ──
-- ฟังก์ชันเหล่านี้ข้ามการตรวจสิทธิ์ที่อยู่ใน API route ถ้าเปิดให้ browser
-- เรียกได้ ใครที่ล็อกอินอยู่ก็ลงทะเบียนเอกสารหรือเซ็นอนุมัติเองได้ทันที
REVOKE ALL ON FUNCTION sign_goods_receipt_stage(UUID, TEXT, TEXT, UUID, TEXT, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION register_document(DATE, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, UUID, UUID[], UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sign_goods_receipt_stage(UUID, TEXT, TEXT, UUID, TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION register_document(DATE, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, UUID, UUID[], UUID[]) TO service_role;
