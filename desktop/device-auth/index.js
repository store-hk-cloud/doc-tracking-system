import { createClient } from 'npm:@supabase/supabase-js@2.84.0';
import { createDeviceAuthHandler } from './handler.mjs';

const url = Deno.env.get('SUPABASE_URL');
const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const webOrigin = Deno.env.get('DESKTOP_WEB_ORIGIN') || 'https://doc-tracking-system.store-hk.workers.dev';
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, serviceKey, options);
const publicClient = createClient(url, publicKey, options);

async function rpc(name, params) {
  const { data, error } = await admin.rpc(name, params);
  if (error) throw error;
  return data;
}

Deno.serve(createDeviceAuthHandler({
  webOrigin,
  clientOrigins: ['app://desktop', 'https://store-hk-cloud.github.io'],
  async identify(token) {
    const { data, error } = await publicClient.auth.getUser(token);
    return error ? null : data.user?.id;
  },
  async isActive(id) {
    const { data, error } = await admin.from('profiles').select('is_active').eq('id', id).maybeSingle();
    if (error) throw error;
    return data?.is_active === true;
  },
  register: (challenge) => rpc('desktop_device_register', { p_challenge: challenge }),
  approve: (challenge, id) => rpc('desktop_device_approve', { p_challenge: challenge, p_actor_id: id }),
  claim: (challenge) => rpc('desktop_device_claim', { p_challenge: challenge }),
  async issue(id) {
    const { data, error } = await admin.auth.admin.getUserById(id);
    const user = data?.user;
    if (error || !user?.email_confirmed_at || !user.email || Date.parse(user.banned_until ?? '') > Date.now()) return null;

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email,
    });
    if (linkError || link.user?.id !== id || !link.properties?.hashed_token) return null;

    const exchangeClient = createClient(url, publicKey, options);
    const { data: verified, error: verifyError } = await exchangeClient.auth.verifyOtp({
      type: 'email',
      token_hash: link.properties.hashed_token,
    });
    return verifyError || verified.user?.id !== id ? null : verified.session;
  },
}));
