import { getWorkerUser } from './auth';
import { readNotifications, removeNotifications } from '../lib/notification-store';
import type { NotificationsEnvironment } from './env';

export async function handleNotifications(request: Request, env: NotificationsEnvironment): Promise<Response> {
  const headers = new Headers({ 'Cache-Control': 'private, no-store', Vary: 'Cookie' });
  const reply = (body: unknown, status = 200) => new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {
    status, headers: new Headers([...headers, ['Content-Type', 'application/json']]),
  });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { Allow: 'GET, HEAD, DELETE, OPTIONS' } });
  if (!['GET', 'HEAD', 'DELETE'].includes(request.method)) {
    headers.set('Allow', 'GET, HEAD, DELETE, OPTIONS');
    return reply({ success: false, error: 'Method not allowed' }, 405);
  }
  try {
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !publicKey || !secretKey) return reply({ success: false, error: 'Service not configured' }, 503);
    const user = await getWorkerUser(request, new URL(url.endsWith('/') ? url : `${url}/`), publicKey, headers);
    if (!user) return reply({ success: false, error: 'Not authenticated' }, 401);

    if (env.SHARED_NOTIFICATIONS_DB === 'true') {
      const clear = request.method === 'DELETE';
      const inbox = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/access_owned_notifications`, {
        method: 'POST',
        headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_actor_id: user.id, p_clear: clear }),
      });
      if (!inbox.ok) return reply({ success: false, error: 'Unable to load notifications' }, 503);
      const messages = await inbox.json();
      if (!Array.isArray(messages)) return reply({ success: false, error: 'Not authenticated' }, 401);
      return reply(clear ? { success: true } : { success: true, data: messages });
    }

    // หน่วยงานต้องอ่านจาก profile สดบน server เช่นเดียวกับ API เดิม ไม่เชื่อ cookie หรือ headers ที่ผู้ใช้ส่งมา
    const profileResponse = await fetch(`${url.replace(/\/$/, '')}/rest/v1/profiles?select=id,department_id,is_active&id=eq.${encodeURIComponent(user.id)}`, {
      headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
    });
    const profiles = profileResponse.ok ? await profileResponse.json() as { id: string; department_id: string | null; is_active: boolean }[] : [];
    const profile = profiles.length === 1 ? profiles[0] : null;
    if (!profile || profile.is_active === false) return reply({ success: false, error: 'Not authenticated' }, 401);

    if (request.method === 'DELETE') {
      if (profile.department_id) await removeNotifications(env.NOTIFICATIONS_KV, profile.department_id);
      return reply({ success: true });
    }
    const data = profile.department_id ? await readNotifications(env.NOTIFICATIONS_KV, profile.department_id) : [];
    return reply({ success: true, data });
  } catch {
    return reply({ success: false, error: 'Unable to load notifications' }, 500);
  }
}
