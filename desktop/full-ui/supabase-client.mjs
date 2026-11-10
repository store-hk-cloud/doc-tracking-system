import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createSessionStorage, signOutDesktop } from './session-storage.mjs';

import { browserStorage } from '../pwa/runtime.mjs';

let client;
export function createClient() {
  if (!client) {
    const storage = __PWA__ ? browserStorage(window.localStorage) : createSessionStorage(window.desktopSession);
    const project = new URL(__SUPABASE_ORIGIN__).hostname.split('.')[0];
    const storageKey = `${__PWA__ ? 'pwa-' : ''}sb-${project}-auth-token`;
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
