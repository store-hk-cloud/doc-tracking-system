import { createClient } from '@supabase/supabase-js';

// Service role client — bypasses RLS, for server-side API routes only
let _admin: ReturnType<typeof createClient> | null = null;

export function getServiceSupabase() {
  if (_admin) return _admin;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return _admin;
}