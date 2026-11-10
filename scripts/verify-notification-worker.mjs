import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const requireWrangler = createRequire(createRequire(import.meta.url).resolve('wrangler/package.json'));
const { Miniflare, Response, convertV4MiniflareOptions } = requireWrangler('miniflare');
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const expires = Math.floor(Date.now() / 1000) + 3600;
const token = `${encode({ alg: 'HS256' })}.${encode({ sub: 'user-a', exp: expires })}.sig`;
const session = { access_token: token, refresh_token: 'fake', expires_at: expires, user: { id: 'user-a' } };
let outbound = 0;

// ไม่ให้ binding ของ Next เพื่อยืนยันว่า API นี้ทำงานได้โดยไม่เริ่ม framework
const runtime = new Miniflare(convertV4MiniflareOptions({
  modules: true,
  scriptPath: path.resolve('.wrangler/notification-runtime/worker.js'),
  compatibilityDate: '2026-09-22',
  compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
  kvNamespaces: ['NOTIFICATIONS_KV'],
  bindings: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public',
    SUPABASE_SECRET_KEY: 'private',
  },
  outboundService: async (request) => {
    outbound++;
    const url = new URL(request.url);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'user-a' });
    if (url.pathname === '/rest/v1/profiles') return Response.json([{ id: 'user-a', department_id: 'dept-a', is_active: true }]);
    throw new Error('Unexpected outbound request');
  },
}));

try {
  const kv = await runtime.getKVNamespace('NOTIFICATIONS_KV');
  await kv.put('notify:dept:dept-a:001', JSON.stringify({ title: 'runtime' }));
  const anonymous = await runtime.dispatchFetch('https://app.invalid/api/notifications');
  assert.equal(anonymous.status, 401);
  assert.equal(outbound, 0);

  const response = await runtime.dispatchFetch('https://app.invalid/api/notifications', {
    headers: { cookie: `sb-example-auth-token=base64-${encode(session)}` },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: true, data: [{ title: 'runtime' }] });
  assert.equal(outbound, 2);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  console.log(JSON.stringify({ status: response.status, body, outbound }));
} finally {
  await runtime.dispose();
}
