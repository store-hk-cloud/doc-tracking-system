import { createClient } from '@supabase/supabase-js';
import { createReceiptApi } from './api-client.mjs';

const client = createClient(__SUPABASE_ORIGIN__, __SUPABASE_PUBLISHABLE_KEY__, {
  auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
});

export const { login, logout, getSession, listPending, submitReceipts, listBatches } = createReceiptApi(client);
