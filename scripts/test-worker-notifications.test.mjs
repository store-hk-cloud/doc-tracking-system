import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { loadModule } from './test-support/load-module.mjs';

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = id => `${encode({ alg: 'HS256' })}.${encode({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
function fixture({ inactive = false, missing = false, rejectUser = false, expired = false, chunked = false } = {}) {
  const calls = [], writes = [], values = new Map([
    ['notify:dept:dept-a:001', JSON.stringify({ title: 'new' })],
    ['notify:dept:dept-a', JSON.stringify([{ title: 'legacy' }])],
    ['notify:dept:dept-b:001', JSON.stringify({ title: 'other' })],
  ]);
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public', SUPABASE_SECRET_KEY: 'private', NOTIFICATIONS_KV: {
    async list({ prefix }) { calls.push('kv-list'); return { keys: [...values.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; },
    async get(key) { calls.push('kv-get'); return values.get(key) || null; },
    async delete(key) { writes.push(key); values.delete(key); },
  } };
  const fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/token') return Response.json({ access_token: jwt('user-a'), refresh_token: 'new-refresh', expires_in: 3600, token_type: 'bearer', user: { id: 'user-a' } });
    if (url.pathname === '/auth/v1/user') return rejectUser ? Response.json({ message: 'invalid', code: 'bad_jwt' }, { status: 401 }) : Response.json({ id: 'user-a' });
    assert.equal(url.pathname, '/rest/v1/profiles');
    assert.equal(url.searchParams.get('id'), 'eq.user-a');
    assert.equal(new Headers(init.headers).get('apikey'), 'private');
    return Response.json(missing ? [] : [{ id: 'user-a', department_id: 'dept-a', is_active: !inactive }]);
  };
  const session = { access_token: jwt('user-a'), refresh_token: 'refresh', expires_at: Math.floor(Date.now() / 1000) + (expired ? -100 : 3600), user: { id: 'user-a' } };
  const encoded = `base64-${encode(session)}`;
  const cookie = chunked ? `sb-example-auth-token.0=${encoded.slice(0, 80)}; sb-example-auth-token.1=${encoded.slice(80)}` : `sb-example-auth-token=${encoded}`;
  assert.ok(existsSync('src/workers/notifications.ts'), 'notification Worker handler must exist');
  const { handleNotifications } = loadModule('src/workers/notifications.ts', {}, { fetch, Headers });
  const request = (method = 'GET', authenticated = true) => new Request('https://app.invalid/api/notifications?dept_id=dept-b', {
    method, headers: { ...(authenticated ? { cookie } : {}), 'x-user-id': 'forged', 'x-user-role': 'super_admin' },
  });
  return { env, calls, writes, values, request, handle: request => handleNotifications(request, env) };
}

test('notification fast path rejects forged identity before KV access', async () => {
  const f = fixture(); const response = await f.handle(f.request('GET', false));
  assert.equal(response.status, 401); assert.deepEqual(f.calls, []); assert.deepEqual(f.writes, []);
});
for (const flag of ['inactive', 'missing', 'rejectUser']) test(`notification fast path rejects ${flag} before KV access`, async () => {
  const f = fixture({ [flag]: true }); const response = await f.handle(f.request());
  assert.equal(response.status, 401); assert.ok(!f.calls.some(call => call.startsWith('kv-'))); assert.deepEqual(f.writes, []);
});
test('verified profile controls notification department and private response headers', async () => {
  const f = fixture(); const response = await f.handle(f.request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: [{ title: 'new' }, { title: 'legacy' }] });
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  assert.match(response.headers.get('vary'), /Cookie/i);
  assert.equal(f.calls.filter(call => call === '/auth/v1/user').length, 1);
});
test('notification delete clears only the verified department', async () => {
  const f = fixture(); assert.equal((await f.handle(f.request('DELETE'))).status, 200);
  assert.ok(f.writes.every(key => key.startsWith('notify:dept:dept-a')));
  assert.equal(f.values.has('notify:dept:dept-b:001'), true);
});
test('expired cookie refresh uses server SDK and returns renewed cookies', async () => {
  const f = fixture({ expired: true }); const response = await f.handle(f.request());
  assert.equal(response.status, 200); assert.ok(f.calls.includes('/auth/v1/token'));
  assert.match(response.headers.get('set-cookie') || '', /sb-example-auth-token/);
  assert.match(response.headers.get('set-cookie') || '', /Path=\//);
});
test('refresh preserves separate Set-Cookie headers when replacing chunked cookies', async () => {
  const f = fixture({ expired: true, chunked: true }); const response = await f.handle(f.request());
  assert.equal(response.status, 200);
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.some(cookie => cookie.startsWith('sb-example-auth-token.0=') && /Max-Age=0/.test(cookie)));
  assert.ok(cookies.some(cookie => cookie.startsWith('sb-example-auth-token.1=') && /Max-Age=0/.test(cookie)));
  assert.ok(cookies.some(cookie => cookie.startsWith('sb-example-auth-token=base64-')));
});
test('HEAD has no body and unsupported methods cannot write notifications', async () => {
  const f = fixture(); const head = await f.handle(f.request('HEAD'));
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal((await f.handle(f.request('POST'))).status, 405); assert.deepEqual(f.writes, []);
});
test('Worker routes notifications without loading OpenNext and falls back for other routes', async () => {
  assert.ok(existsSync('worker.ts'), 'custom entry must exist');
  let nextLoads = 0, fastCalls = 0;
  const mocks = { './src/workers/notifications': { handleNotifications: async () => { fastCalls++; return new Response('fast'); } } };
  Object.defineProperty(mocks, './.open-next/worker.js', { get() { nextLoads++; return { __esModule: true, default: { fetch: async () => new Response('next') } }; } });
  const worker = loadModule('worker.ts', mocks).default;
  assert.equal(await (await worker.fetch(new Request('https://app.invalid/api/notifications'), {}, {})).text(), 'fast');
  assert.equal(nextLoads, 0); assert.equal(fastCalls, 1);
  assert.equal(await (await worker.fetch(new Request('https://app.invalid/dashboard'), {}, {})).text(), 'next');
  assert.equal(nextLoads, 1);
});
