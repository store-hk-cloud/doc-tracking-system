import { combineChunks, createServerClient, parseCookieHeader, serializeCookieHeader, stringFromBase64URL, type SetAllCookies } from '@supabase/ssr';

type WorkerUser = { id?: string; email?: string };

export async function getWorkerUser(request: Request, url: URL, publicKey: string, headers: Headers): Promise<{ id: string; email?: string } | null> {
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
      const data = await response.json().catch(() => null) as (WorkerUser & { user?: WorkerUser }) | null;
      const user = data?.user ?? data;
      return typeof user?.id === 'string' && user.id ? { id: user.id, email: user.email } : null;
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
  return error || !user?.id ? null : { id: user.id, email: user.email };
}
