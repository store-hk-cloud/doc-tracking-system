-- lease นี้อยู่ในฐานข้อมูลเพื่อให้คำขอจากคนละ Vercel instance เห็นสถานะเดียวกัน
-- แทน Map ในหน่วยความจำซึ่งกันได้เฉพาะคำขอใน instance เดียว.
CREATE TABLE IF NOT EXISTS public.maintenance_locks (
  name TEXT PRIMARY KEY,
  token UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.maintenance_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.maintenance_locks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.maintenance_locks TO service_role;

CREATE OR REPLACE FUNCTION public.try_acquire_sheet_backfill_lock(p_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  acquired BOOLEAN;
BEGIN
  INSERT INTO public.maintenance_locks AS locks (name, token, expires_at)
  VALUES ('sheet_backfill', p_token, statement_timestamp() + INTERVAL '20 minutes')
  ON CONFLICT (name) DO UPDATE
    SET token = EXCLUDED.token,
        expires_at = EXCLUDED.expires_at,
        updated_at = statement_timestamp()
    WHERE locks.expires_at <= statement_timestamp()
  RETURNING TRUE INTO acquired;

  RETURN COALESCE(acquired, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_sheet_backfill_lock(p_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  released BOOLEAN;
BEGIN
  DELETE FROM public.maintenance_locks
  WHERE name = 'sheet_backfill' AND token = p_token
  RETURNING TRUE INTO released;

  RETURN COALESCE(released, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.try_acquire_sheet_backfill_lock(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_sheet_backfill_lock(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.try_acquire_sheet_backfill_lock(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_sheet_backfill_lock(UUID) TO service_role;
