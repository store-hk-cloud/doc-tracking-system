BEGIN;

CREATE SCHEMA app_notification_private;
REVOKE ALL ON SCHEMA app_notification_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE app_notification_private.department_inbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  message jsonb NOT NULL CHECK (jsonb_typeof(message) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app_notification_private.department_inbox (department_id, created_at DESC, id DESC);
CREATE INDEX ON app_notification_private.department_inbox (created_at);
REVOKE ALL ON ALL TABLES IN SCHEMA app_notification_private FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.write_department_notification(p_department_id uuid, p_message jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO app_notification_private.department_inbox (department_id, message)
  VALUES (p_department_id, p_message);
$$;

CREATE FUNCTION public.access_department_notifications(p_department_id uuid, p_clear boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_clear THEN
    DELETE FROM app_notification_private.department_inbox WHERE department_id = p_department_id;
    RETURN '[]'::jsonb;
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(recent.message ORDER BY recent.created_at DESC, recent.id DESC)
    FROM (
      SELECT id, created_at, message FROM app_notification_private.department_inbox
      WHERE department_id = p_department_id AND created_at > now() - interval '24 hours'
      ORDER BY created_at DESC, id DESC LIMIT 50
    ) recent
  ), '[]'::jsonb);
END;
$$;

CREATE FUNCTION public.access_owned_notifications(p_actor_id uuid, p_clear boolean)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.access_department_notifications(profile.department_id, p_clear)
  FROM public.profiles profile
  WHERE profile.id = p_actor_id AND profile.is_active IS DISTINCT FROM false;
$$;

REVOKE ALL ON FUNCTION public.write_department_notification(uuid,jsonb),
  public.access_department_notifications(uuid,boolean), public.access_owned_notifications(uuid,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.write_department_notification(uuid,jsonb),
  public.access_department_notifications(uuid,boolean), public.access_owned_notifications(uuid,boolean) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('doc-tracking-notifications-retention', '23 18 * * *',
      $job$DELETE FROM app_notification_private.department_inbox WHERE created_at <= now() - interval '24 hours'$job$);
  END IF;
END;
$$;

COMMIT;
