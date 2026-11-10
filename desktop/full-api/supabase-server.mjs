import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from '@supabase/supabase-js';

const requestClient = new AsyncLocalStorage();

export async function createServerSupabase() {
  const client = requestClient.getStore();
  if (!client) throw new Error('Desktop API request context is missing');
  return client;
}

export async function withRequestClient(token, run) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publicKey) {
    return Response.json({ success: false, error: 'Service not configured' }, { status: 503 });
  }
  const client = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: token ? { headers: { Authorization: 'Bearer ' + token } } : undefined,
  });

  if (token) {
    const verified = await client.auth.getUser(token);
    if (verified.error || !verified.data.user) {
      return Response.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    // ให้ auth-helpers ใช้ผลตรวจ bearer ของคำขอเดียวกัน โดยไม่เรียก Auth ซ้ำ
    client.auth.getUser = async () => verified;
  }
  return requestClient.run(client, run);
}
