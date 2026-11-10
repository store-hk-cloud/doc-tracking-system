import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createSessionStorage, signOutDesktop } from './session-storage.mjs';

let client;
export function createClient() {
  if (!client) {
    const storage = createSessionStorage(window.desktopSession);
    const project = new URL(__SUPABASE_ORIGIN__).hostname.split('.')[0];
    const storageKey = `sb-${project}-auth-token`;
    client = createSupabaseClient(__SUPABASE_ORIGIN__, __SUPABASE_PUBLISHABLE_KEY__, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage, storageKey },
    });
    const signOut = client.auth.signOut.bind(client.auth);
    client.auth.signOut = async () => {
      await client.auth.stopAutoRefresh();
      return signOutDesktop({ signOut, storage, storageKey });
    };
  }
  return client;
}
