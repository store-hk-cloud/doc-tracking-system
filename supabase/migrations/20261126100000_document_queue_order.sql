BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE SEQUENCE IF NOT EXISTS public.document_recipients_queue_rank_seq;
ALTER TABLE public.document_recipients ADD COLUMN IF NOT EXISTS queue_rank bigint;

-- รันครั้งแรก ADD COLUMN ถือ ACCESS EXCLUSIVE ถึง COMMIT อยู่แล้ว (อ่านก็ไม่ได้ระหว่างนั้น)
-- แต่รันซ้ำ IF NOT EXISTS ไม่ล็อกอะไร จึงคงล็อกนี้ไว้กัน INSERT จาก Worker รุ่นเก่าแทรกระหว่าง backfill
LOCK TABLE public.document_recipients IN SHARE ROW EXCLUSIVE MODE;

-- updated_at ถูกใช้เป็น expected_updated_at ของคิวรับหลายใบและ desktop (receipt_stale)
-- การลากเปลี่ยนแค่ queue_rank จึงต้องไม่ขยับ updated_at ไม่เช่นนั้นใบอื่นในคิวจะ stale
CREATE OR REPLACE FUNCTION public.document_recipients_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF to_jsonb(NEW) - 'queue_rank' IS DISTINCT FROM to_jsonb(OLD) - 'queue_rank' THEN
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_recipients_updated_at ON public.document_recipients;
CREATE TRIGGER document_recipients_updated_at
  BEFORE UPDATE ON public.document_recipients
  FOR EACH ROW EXECUTE FUNCTION public.document_recipients_touch_updated_at();

-- เปลี่ยนแค่ queue_rank ไม่ต้องสร้างงาน Sheets: ข้อมูลที่ sync ไม่มีลำดับคิว
-- (trigger มีอยู่เฉพาะ env ที่ติดตั้ง migration Sheets แล้ว)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.document_recipients'::regclass AND NOT tgisinternal
      AND tgname IN ('apps_script_sheet_recipient_changed', 'apps_script_sheet_recipient_inserted',
                     'apps_script_sheet_recipient_updated')
  ) THEN
    DROP TRIGGER IF EXISTS apps_script_sheet_recipient_changed ON public.document_recipients;
    DROP TRIGGER IF EXISTS apps_script_sheet_recipient_inserted ON public.document_recipients;
    DROP TRIGGER IF EXISTS apps_script_sheet_recipient_updated ON public.document_recipients;
    CREATE TRIGGER apps_script_sheet_recipient_inserted
      AFTER INSERT ON public.document_recipients
      FOR EACH ROW EXECUTE FUNCTION apps_script_sheet_private.enqueue_changed_rows();
    CREATE TRIGGER apps_script_sheet_recipient_updated
      AFTER UPDATE ON public.document_recipients
      FOR EACH ROW
      WHEN ((to_jsonb(OLD) - 'queue_rank') IS DISTINCT FROM (to_jsonb(NEW) - 'queue_rank'))
      EXECUTE FUNCTION apps_script_sheet_private.enqueue_changed_rows();
  END IF;
END;
$$;

-- ลำดับเดิมคือ running_no DESC: rank สูงอยู่บน จึงให้เลขเก่าสุดได้ rank ต่ำสุด
DO $$
DECLARE
  v_backfilled integer;
BEGIN
  UPDATE public.document_recipients recipient
  SET queue_rank = ranked.rank
  FROM (
    SELECT r.id, row_number() OVER (ORDER BY d.running_no ASC, r.id DESC) AS rank
    FROM public.document_recipients r
    JOIN public.documents d ON d.id = r.document_id
    WHERE r.queue_rank IS NULL
  ) ranked
  WHERE recipient.id = ranked.id;
  GET DIAGNOSTICS v_backfilled = ROW_COUNT;
  IF v_backfilled > 0 THEN
    PERFORM setval('public.document_recipients_queue_rank_seq',
      (SELECT max(queue_rank) FROM public.document_recipients));
  END IF;
END;
$$;

ALTER SEQUENCE public.document_recipients_queue_rank_seq OWNED BY public.document_recipients.queue_rank;

ALTER TABLE public.document_recipients
  ALTER COLUMN queue_rank SET DEFAULT nextval('public.document_recipients_queue_rank_seq'),
  ALTER COLUMN queue_rank SET NOT NULL;

CREATE OR REPLACE FUNCTION public.reorder_document_recipients(
  p_actor_id uuid,
  p_scope text,
  p_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '3s'
AS $$
DECLARE
  v_actor public.profiles;
  v_code text;
  v_count integer;
  v_found integer;
  v_owned integer;
  v_ok integer;
BEGIN
  v_actor := document_receipt_private.get_actor(p_actor_id);
  v_count := cardinality(p_ids);
  IF p_scope IS NULL OR p_scope NOT IN ('delivery', 'stage') OR v_count IS NULL OR v_count NOT BETWEEN 1 AND 500
    OR EXISTS (SELECT 1 FROM unnest(p_ids) AS item(id) WHERE item.id IS NULL)
    OR (SELECT count(DISTINCT item.id) FROM unnest(p_ids) AS item(id)) <> v_count THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'order_invalid';
  END IF;

  SELECT department.code INTO v_code FROM public.departments department WHERE department.id = v_actor.department_id;

  -- ล็อกตามลำดับ id กัน deadlock เมื่อสองคนจัดลำดับชุดที่ทับกัน
  PERFORM 1 FROM public.document_recipients WHERE id = ANY(p_ids) ORDER BY id FOR UPDATE;

  SELECT count(*),
    count(*) FILTER (WHERE CASE WHEN p_scope = 'delivery' THEN
        v_actor.role IN ('admin', 'super_admin') OR d.recorded_by = p_actor_id
      WHEN d.subject = 'ใบรับสินค้า' THEN v_code IN ('0-ADM04', '0-PDT01', '0-BSN10', '0-ADM03')
      ELSE r.department_id = v_actor.department_id END),
    count(*) FILTER (WHERE r.status = CASE WHEN p_scope = 'delivery' THEN 'registered'
      WHEN d.subject <> 'ใบรับสินค้า' THEN 'delivered'
      WHEN v_code IN ('0-ADM04', '0-PDT01') THEN 'awaiting_inspector'
      WHEN v_code = '0-BSN10' THEN 'awaiting_purchasing'
      ELSE 'awaiting_recipient' END)
  INTO v_found, v_owned, v_ok
  FROM public.document_recipients r
  JOIN public.documents d ON d.id = r.document_id
  WHERE r.id = ANY(p_ids);

  IF v_found <> v_count THEN
    RAISE EXCEPTION 'order_stale';
  ELSIF v_owned <> v_count THEN
    RAISE EXCEPTION 'order_forbidden';
  ELSIF v_ok <> v_count THEN
    RAISE EXCEPTION 'order_stale';
  END IF;

  IF p_scope = 'delivery' THEN
    -- ตัวแรกในลิสต์ได้ rank สูงสุด: ชุดที่จัดแล้วกองติดกันบนสุด
    FOR i IN REVERSE v_count..1 LOOP
      UPDATE public.document_recipients
      SET queue_rank = nextval('public.document_recipients_queue_rank_seq')
      WHERE id = p_ids[i];
    END LOOP;
  ELSE
    -- สลับเฉพาะช่องที่ถูกส่งมา แถวอื่นในคิวของด่านนี้ต้องอยู่ที่เดิม
    UPDATE public.document_recipients r
    SET queue_rank = slot.rank
    FROM (
      SELECT wanted.id, slots.rank
      FROM unnest(p_ids) WITH ORDINALITY AS wanted(id, pos)
      JOIN (
        SELECT rank, row_number() OVER (ORDER BY rank DESC) AS pos
        FROM (SELECT queue_rank AS rank FROM public.document_recipients WHERE id = ANY(p_ids)) ranks
      ) slots ON slots.pos = wanted.pos
    ) slot
    WHERE r.id = slot.id AND r.queue_rank <> slot.rank;
  END IF;

  RETURN jsonb_build_object('count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.document_recipients_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reorder_document_recipients(uuid, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_document_recipients(uuid, text, uuid[]) TO service_role;
REVOKE ALL ON SEQUENCE public.document_recipients_queue_rank_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.document_recipients_queue_rank_seq TO service_role;

COMMIT;
