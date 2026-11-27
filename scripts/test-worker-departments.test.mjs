import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { loadModule } from './test-support/load-module.mjs';

const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = id => `${encode({ alg: 'HS256' })}.${encode({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
const DEPARTMENTS = [{ id: 'dept-a', name: 'จัดซื้อ', code: 'PUR' }, { id: 'dept-b', name: 'บัญชี', code: 'ACC' }];

function fixture({ role = 'user', inactive = false, missing = false, rejectUser = false, departmentsFail = false, expired = false } = {}) {
  const calls = [];
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public', SUPABASE_SECRET_KEY: 'private' };
  const fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push(url.pathname);
    if (url.pathname === '/auth/v1/token') return Response.json({ access_token: jwt('user-a'), refresh_token: 'new-refresh', expires_in: 3600, token_type: 'bearer', user: { id: 'user-a' } });
    if (url.pathname === '/auth/v1/user') {
      return rejectUser ? Response.json({ message: 'invalid', code: 'bad_jwt' }, { status: 401 }) : Response.json({ id: 'user-a' });
    }
    assert.equal(new Headers(init.headers).get('apikey'), 'private');
    if (url.pathname === '/rest/v1/profiles') {
      assert.equal(url.searchParams.get('id'), 'eq.user-a');
      return Response.json(missing ? [] : [{ id: 'user-a', role, is_active: !inactive }]);
    }
    assert.equal(url.pathname, '/rest/v1/departments');
    assert.equal(url.searchParams.get('select'), '*');
    assert.equal(url.searchParams.get('order'), 'name');
    return departmentsFail ? Response.json({ message: 'boom' }, { status: 500 }) : Response.json(DEPARTMENTS);
  };
  const session = { access_token: jwt('user-a'), refresh_token: 'refresh', expires_at: Math.floor(Date.now() / 1000) + (expired ? -100 : 3600) };
  const cookie = `sb-example-auth-token=base64-${encode(session)}`;
  assert.ok(existsSync('src/workers/departments.ts'), 'departments Worker handler must exist');
  const { handleDepartments } = loadModule('src/workers/departments.ts', {}, { fetch, Headers });
  const request = (method = 'GET', authenticated = true) => new Request('https://app.invalid/api/departments', {
    method, headers: { ...(authenticated ? { cookie } : {}), 'x-user-role': 'super_admin' },
  });
  return { calls, request, handle: request => handleDepartments(request, env) };
}

test('departments fast path rejects anonymous requests without touching the database', async () => {
  const f = fixture(); const response = await f.handle(f.request('GET', false));
  assert.equal(response.status, 401); assert.deepEqual(f.calls, []);
});
for (const flag of ['inactive', 'missing', 'rejectUser']) test(`departments fast path rejects ${flag} before reading departments`, async () => {
  const f = fixture({ [flag]: true }); const response = await f.handle(f.request());
  assert.equal(response.status, 401); assert.ok(!f.calls.includes('/rest/v1/departments'));
});
test('departments fast path forbids roles outside the original allow list', async () => {
  const f = fixture({ role: 'guest' }); const response = await f.handle(f.request());
  assert.equal(response.status, 403); assert.ok(!f.calls.includes('/rest/v1/departments'));
});
for (const role of ['super_admin', 'admin', 'user']) test(`departments fast path returns the same shape as the Next route for ${role}`, async () => {
  const f = fixture({ role }); const response = await f.handle(f.request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: DEPARTMENTS });
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  assert.match(response.headers.get('vary'), /Cookie/i);
  assert.deepEqual(f.calls, ['/auth/v1/user', '/rest/v1/profiles', '/rest/v1/departments']);
});
test('departments fast path reports a database failure as 500', async () => {
  const f = fixture({ departmentsFail: true }); const response = await f.handle(f.request());
  assert.equal(response.status, 500);
  assert.equal((await response.json()).success, false);
});
test('departments fast path forwards renewed session cookies', async () => {
  const f = fixture({ expired: true }); const response = await f.handle(f.request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie') || '', /sb-example-auth-token/);
});
test('Worker answers GET departments without OpenNext and leaves writes to Next', async () => {
  let nextLoads = 0, fastCalls = 0;
  const mocks = { './src/workers/departments': { handleDepartments: async () => { fastCalls++; return new Response('fast'); } } };
  Object.defineProperty(mocks, './.open-next/worker.js', { get() { nextLoads++; return { __esModule: true, default: { fetch: async () => new Response('next') } }; } });
  const worker = loadModule('worker.ts', mocks).default;
  const url = 'https://app.invalid/api/departments';
  assert.equal(await (await worker.fetch(new Request(url), {}, {})).text(), 'fast');
  assert.equal(nextLoads, 0); assert.equal(fastCalls, 1);
  for (const method of ['POST', 'DELETE']) {
    assert.equal(await (await worker.fetch(new Request(url, { method }), {}, {})).text(), 'next');
  }
  assert.equal(fastCalls, 1);
});
