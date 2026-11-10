import { combineChunks, createServerClient, parseCookieHeader, serializeCookieHeader, stringFromBase64URL, type SetAllCookies } from '@supabase/ssr';
import { readNotifications, removeNotifications } from '../lib/notification-store';
import type { NotificationsEnvironment } from './env';

async function getNotificationUser(request: Request, url: URL, publicKey: string, headers: Headers) {
  const cookies = parseCookieHeader(request.headers.get('cookie') || '').map(({ name, value }) => ({ name, value: value || '' }));
  const storageKey = `sb-${url.hostname.split('.')[0]}-auth-token`;
  const encoded = await combineChunks(storageKey, (name) => cookies.find((cookie) => cookie.name === name)?.value);
  if (!encoded) return null;

  let session: { access_token?: unknown; refresh_token?: unknown; expires_at?: unknown } | null = null;
  try {
    session = JSON.parse(encoded.startsWith('base64-') ? stringFromBase64URL(encoded.slice(7)) : encoded);
  } catch {
    // ให้ SDK จัดการ cookie เดิมหรือ cookie ที่อ่านไม่ได้ตามพฤติกรรมเดิม
  }

  // อายุใน cookie ใช้เลือกวิธีเรียก Auth เท่านั้น ยืนยันตัวตนกับ Supabase ทุกครั้ง
  if (typeof session?.access_token === 'string' && session.access_token &&
    typeof session.refresh_token === 'string' && typeof session.expires_at === 'number' &&
    session.expires_at * 1000 - Date.now() > 90_000) {
    const response = await fetch(new URL('auth/v1/user', url), {
      headers: { apikey: publicKey, Authorization: `Bearer ${session.access_token}`, 'X-Supabase-Api-Version': '2024-01-01' },
    }).catch(() => null);
    if (!response) return null;
    if (response.ok) {
      const data = await response.json().catch(() => null) as { id?: string; user?: { id?: string } } | null;
      return (data?.user ?? data)?.id ?? null;
    }
    await response.body?.cancel();
  }

  const auth = createServerClient(url.href, publicKey, {
    global: { fetch },
    cookies: {
      getAll: () => cookies,
      setAll: (updated: Parameters<SetAllCookies>[0]) => {
        for (const { name, value, options } of updated) headers.append('Set-Cookie', serializeCookieHeader(name, value, options));
      },
    },
  });
  const { data: { user }, error } = await auth.auth.getUser();
  return error ? null : user?.id ?? null;
}

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
    const userId = await getNotificationUser(request, new URL(url.endsWith('/') ? url : `${url}/`), publicKey, headers);
    if (!userId) return reply({ success: false, error: 'Not authenticated' }, 401);

    // หน่วยงานต้องอ่านจาก profile สดบน server เช่นเดียวกับ API เดิม ไม่เชื่อ cookie หรือ headers ที่ผู้ใช้ส่งมา
    const profileResponse = await fetch(`${url.replace(/\/$/, '')}/rest/v1/profiles?select=id,department_id,is_active&id=eq.${encodeURIComponent(userId)}`, {
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
