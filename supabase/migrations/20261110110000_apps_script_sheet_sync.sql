BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE SCHEMA apps_script_sheet_private;
REVOKE ALL ON SCHEMA apps_script_sheet_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE apps_script_sheet_private.settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  token_digest bytea,
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO apps_script_sheet_private.settings DEFAULT VALUES;

CREATE SEQUENCE apps_script_sheet_private.job_revision;
CREATE TABLE apps_script_sheet_private.jobs (
  recipient_id uuid PRIMARY KEY REFERENCES public.document_recipients(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT nextval('apps_script_sheet_private.job_revision'),
  queued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX apps_script_sheet_jobs_available ON apps_script_sheet_private.jobs (available_at, queued_at, recipient_id);
CREATE INDEX IF NOT EXISTS delivery_logs_sheet_latest_idx
  ON public.delivery_logs (document_recipient_id, created_at DESC, id);

CREATE FUNCTION public.configure_apps_script_sheet_sync(p_token text, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  IF p_token IS NOT NULL AND p_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Expected a 32-byte token encoded as lowercase hex' USING ERRCODE = '22023';
  END IF;
  UPDATE apps_script_sheet_private.settings
  SET token_digest = coalesce(sha256(convert_to(p_token, 'UTF8')), token_digest),
      enabled = p_enabled
  WHERE singleton AND (NOT p_enabled OR p_token IS NOT NULL OR token_digest IS NOT NULL);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configure a Sheets token before enabling the cutover' USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE FUNCTION public.is_apps_script_sheet_sync_enabled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT enabled FROM apps_script_sheet_private.settings WHERE singleton;
$$;

CREATE FUNCTION apps_script_sheet_private.check_token(p_token text)
RETURNS void
LANGUAGE plpgsql STABLE SET search_path = pg_catalog
AS $$
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' OR NOT EXISTS (
    SELECT FROM apps_script_sheet_private.settings
    WHERE singleton AND token_digest = sha256(convert_to(p_token, 'UTF8'))
  ) THEN
    RAISE EXCEPTION 'Invalid Sheets sync credentials' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION public.enqueue_apps_script_sheet_jobs(p_recipient_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  queued integer;
BEGIN
  INSERT INTO apps_script_sheet_private.jobs (recipient_id)
  SELECT id FROM public.document_recipients
  WHERE id = ANY(p_recipient_ids)
  ORDER BY id
  ON CONFLICT (recipient_id) DO UPDATE
  SET revision = excluded.revision,
      queued_at = excluded.queued_at,
      available_at = excluded.available_at,
      attempts = 0;
  GET DIAGNOSTICS queued = ROW_COUNT;
  RETURN queued;
END;
$$;

CREATE FUNCTION apps_script_sheet_private.enqueue_changed_rows()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_TABLE_NAME = 'document_recipients' THEN
    PERFORM public.enqueue_apps_script_sheet_jobs(ARRAY[NEW.id]);
  ELSIF TG_TABLE_NAME = 'documents' THEN
    PERFORM public.enqueue_apps_script_sheet_jobs(ARRAY(
      SELECT id FROM public.document_recipients WHERE document_id = NEW.id
    ));
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM public.enqueue_apps_script_sheet_jobs(ARRAY[NEW.document_recipient_id]);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.enqueue_apps_script_sheet_jobs(ARRAY[OLD.document_recipient_id]);
  ELSE
    PERFORM public.enqueue_apps_script_sheet_jobs(ARRAY[OLD.document_recipient_id, NEW.document_recipient_id]);
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.enqueue_all_apps_script_sheet_jobs()
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT public.enqueue_apps_script_sheet_jobs(ARRAY(SELECT id FROM public.document_recipients));
$$;

CREATE TRIGGER apps_script_sheet_recipient_changed
  AFTER INSERT OR UPDATE ON public.document_recipients
  FOR EACH ROW EXECUTE FUNCTION apps_script_sheet_private.enqueue_changed_rows();
CREATE TRIGGER apps_script_sheet_document_changed
  AFTER UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION apps_script_sheet_private.enqueue_changed_rows();
CREATE TRIGGER apps_script_sheet_delivery_changed
  AFTER INSERT OR UPDATE OR DELETE ON public.delivery_logs
  FOR EACH ROW EXECUTE FUNCTION apps_script_sheet_private.enqueue_changed_rows();

CREATE FUNCTION public.pull_apps_script_sheet_jobs(p_token text, p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog SET timezone = 'UTC'
AS $$
BEGIN
  PERFORM apps_script_sheet_private.check_token(p_token);
  IF p_limit = 0 OR NOT public.is_apps_script_sheet_sync_enabled() THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN (
    WITH pending AS (
      SELECT recipient_id, revision, queued_at, available_at
      FROM apps_script_sheet_private.jobs
      WHERE available_at <= statement_timestamp()
      ORDER BY available_at, queued_at, recipient_id
      LIMIT greatest(1, least(100, coalesce(p_limit, 25)))
    )
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', recipient.id,
        'revision', pending.revision::text,
        'sheet_name', to_char(document.received_date, 'YYYY-MM-DD'),
        'single_recipient', NOT EXISTS (
          SELECT FROM public.document_recipients sibling
          WHERE sibling.document_id = document.id AND sibling.id <> recipient.id
        ),
        'values', jsonb_build_array(
          coalesce(nullif(document.display_no, ''), document.running_no::text, '-'),
          to_char(document.received_date, 'YYYY-MM-DD'),
          coalesce(document.doc_number, ''), document.sender, document.subject,
          coalesce(department.name, ''), recipient.status, coalesce(recipient.admin_signature, ''),
          coalesce(to_jsonb(recipient.admin_signed_at) #>> '{}', ''),
          coalesce(receiver.full_name, ''), coalesce(delivery.recipient_signature, ''),
          coalesce(to_jsonb(delivery.recipient_signed_at) #>> '{}', ''),
          CASE WHEN rejection.note IS NOT NULL THEN 'ไม่ถูกต้อง'
               WHEN delivery.id IS NULL THEN ''
               WHEN delivery.is_verified THEN 'ถูกต้อง' ELSE 'ไม่ถูกต้อง' END,
          coalesce(rejection.note, delivery.verification_note, ''),
          CASE WHEN document.is_damaged THEN 'ใช่' ELSE 'ไม่' END,
          coalesce(document.damage_image_url, ''), coalesce(document.note, ''),
          coalesce(recorder.full_name, ''), coalesce(to_jsonb(recipient.updated_at) #>> '{}', ''),
          coalesce(document.tax_invoice_no, ''), recipient.id
        )
      ) ORDER BY pending.available_at, pending.queued_at, pending.recipient_id
    ), '[]'::jsonb)
    FROM pending
    JOIN public.document_recipients recipient ON recipient.id = pending.recipient_id
    JOIN public.documents document ON document.id = recipient.document_id
    LEFT JOIN public.departments department ON department.id = recipient.department_id
    LEFT JOIN public.profiles recorder ON recorder.id = document.recorded_by
    CROSS JOIN LATERAL (
      SELECT CASE WHEN recipient.status = 'rejected' AND recipient.inspector_verified IS FALSE
                  THEN 'ผู้ตรวจสอบ: ' || coalesce(recipient.inspector_verification_note, '')
                  WHEN recipient.status = 'rejected' AND recipient.purchasing_verified IS FALSE
                  THEN 'จัดซื้อ: ' || coalesce(recipient.purchasing_verification_note, '') END AS note
    ) rejection
    LEFT JOIN LATERAL (
      SELECT id, recipient_id, recipient_signature, recipient_signed_at, is_verified, verification_note
      FROM public.delivery_logs
      WHERE document_recipient_id = recipient.id
        AND rejection.note IS NULL
        AND recipient.status NOT IN (
          'registered', 'delivered', 'awaiting_inspector', 'awaiting_purchasing', 'awaiting_recipient'
        )
      ORDER BY created_at DESC, id
      LIMIT 1
    ) delivery ON true
    LEFT JOIN public.profiles receiver ON receiver.id = delivery.recipient_id
  );
END;
$$;

CREATE FUNCTION public.finish_apps_script_sheet_job(
  p_token text, p_id uuid, p_revision bigint, p_success boolean
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM apps_script_sheet_private.check_token(p_token);
  IF p_success THEN
    DELETE FROM apps_script_sheet_private.jobs WHERE recipient_id = p_id AND revision = p_revision;
  ELSE
    UPDATE apps_script_sheet_private.jobs
    SET attempts = attempts + 1,
        available_at = clock_timestamp() + make_interval(secs => 30 * (1 << least(attempts, 7)))
    WHERE recipient_id = p_id AND revision = p_revision AND available_at <= clock_timestamp();
  END IF;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION apps_script_sheet_private.check_token(text),
  apps_script_sheet_private.enqueue_changed_rows() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.configure_apps_script_sheet_sync(text, boolean),
  public.is_apps_script_sheet_sync_enabled(), public.enqueue_apps_script_sheet_jobs(uuid[]),
  public.enqueue_all_apps_script_sheet_jobs(),
  public.pull_apps_script_sheet_jobs(text, integer),
  public.finish_apps_script_sheet_job(text, uuid, bigint, boolean) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.configure_apps_script_sheet_sync(text, boolean),
  public.is_apps_script_sheet_sync_enabled(), public.enqueue_apps_script_sheet_jobs(uuid[]),
  public.enqueue_all_apps_script_sheet_jobs() TO service_role;
GRANT EXECUTE ON FUNCTION public.pull_apps_script_sheet_jobs(text, integer),
  public.finish_apps_script_sheet_job(text, uuid, bigint, boolean) TO anon;

COMMIT;
