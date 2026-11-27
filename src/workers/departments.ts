import { getWorkerUser } from './auth';
import type { NotificationsEnvironment } from './env';

const ALLOWED_ROLES = ['super_admin', 'admin', 'user'];

// ตอบ GET /api/departments แทน route ของ Next (ยังเก็บไว้รับ POST/DELETE) เพราะหลายหน้าเรียกตอนเปิด
// และการเริ่ม Next แค่เพื่ออ่านรายชื่อหน่วยงานกิน CPU เกินเพดาน 10ms ของแผนฟรี
export async function handleDepartments(request: Request, env: NotificationsEnvironment): Promise<Response> {
  const headers = new Headers({ 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'Content-Type': 'application/json' });
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  try {
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !publicKey || !secretKey) return reply({ success: false, error: 'Service not configured' }, 503);
    const base = url.replace(/\/$/, '');
    const user = await getWorkerUser(request, new URL(`${base}/`), publicKey, headers);
    if (!user) return reply({ success: false, error: 'Not authenticated' }, 401);

    const serverHeaders = { apikey: secretKey, Authorization: `Bearer ${secretKey}` };
    const profileResponse = await fetch(`${base}/rest/v1/profiles?select=id,role,is_active&id=eq.${encodeURIComponent(user.id)}`, { headers: serverHeaders });
    const profiles = profileResponse.ok ? await profileResponse.json() as { role: string; is_active: boolean }[] : [];
    const profile = profiles.length === 1 ? profiles[0] : null;
    if (!profile || profile.is_active === false) return reply({ success: false, error: 'Not authenticated' }, 401);
    if (!ALLOWED_ROLES.includes(profile.role)) return reply({ success: false, error: 'Forbidden' }, 403);

    const departments = await fetch(`${base}/rest/v1/departments?select=*&order=name`, { headers: serverHeaders });
    if (!departments.ok) return reply({ success: false, error: 'Unable to load departments' }, 500);
    return reply({ success: true, data: await departments.json() });
  } catch {
    return reply({ success: false, error: 'Unable to load departments' }, 500);
  }
}
