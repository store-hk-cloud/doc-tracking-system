import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server.js';
import { loadModule } from './test-support/load-module.mjs';

const env = {
  getSupabaseUrl: () => 'https://example.supabase.co',
  getSupabasePublicKey: () => 'test-public-key',
};

function loadMiddleware({ user = null, refresh = false } = {}) {
  const calls = { clients: 0, getUser: 0 };
  const { middleware } = loadModule('src/middleware.ts', {
    '@/lib/supabase/env': env,
    '@supabase/ssr': { createServerClient: (_url, _key, { cookies }) => {
      calls.clients++;
      return { auth: { getUser: async () => {
        calls.getUser++;
        if (refresh) cookies.setAll([{ name: 'session', value: 'refreshed', options: { httpOnly: true, path: '/' } }]);
        return { data: { user }, error: null };
      } } };
    } },
  });
  return { middleware, calls };
}

test('API requests reach their handlers without a middleware authentication round trip', async () => {
  for (const path of ['/api/documents', '/api/departments', '/api/cron/overdue-documents', '/api/auth/resolve-username']) {
    const { middleware, calls } = loadMiddleware();
    const response = await middleware(new NextRequest(`https://example.invalid${path}`));
    assert.equal(response.headers.get('x-middleware-next'), '1', path);
    assert.equal(calls.clients, 0, path);
    assert.equal(calls.getUser, 0, path);
  }
});

test('page authentication and login redirects keep their existing behavior', async () => {
  for (const [path, user, redirect] of [
    ['/', null, null],
    ['/', { id: 'test-user' }, 'https://example.invalid/dashboard'],
    ['/dashboard', null, 'https://example.invalid/'],
    ['/dashboard', { id: 'test-user' }, null],
  ]) {
    const { middleware, calls } = loadMiddleware({ user });
    const response = await middleware(new NextRequest(`https://example.invalid${path}`));
    assert.equal(response.headers.get('location'), redirect);
    if (!redirect) assert.equal(response.headers.get('x-middleware-next'), '1');
    assert.equal(calls.getUser, 1);
  }
});

test('page session refresh updates both downstream request cookies and response cookies', async () => {
  const { middleware } = loadMiddleware({ user: { id: 'test-user' }, refresh: true });
  const request = new NextRequest('https://example.invalid/dashboard', { headers: { cookie: 'session=expired' } });
  const response = await middleware(request);
  assert.equal(request.cookies.get('session').value, 'refreshed');
  assert.equal(response.cookies.get('session').value, 'refreshed');
  assert.equal(response.headers.get('x-middleware-request-cookie'), 'session=refreshed');
});

test('API handlers verify expired sessions despite forged identity headers and retain refreshed cookies', async () => {
  const { middleware, calls } = loadMiddleware();
  const request = new NextRequest('https://example.invalid/api/departments', {
    headers: { cookie: 'session=expired', 'x-user-id': 'forged-user', 'x-user-role': 'super_admin' },
  });
  const response = await middleware(request);
  assert.equal(response.headers.get('x-middleware-next'), '1');

  const writtenCookies = [];
  let handlerAuthCalls = 0;
  const route = loadModule('src/app/api/departments/route.ts', {
    '@/lib/supabase/env': env,
    'next/headers': { cookies: async () => ({
      getAll: () => request.cookies.getAll(),
      set: (...args) => writtenCookies.push(args),
    }) },
    '@supabase/ssr': { createServerClient: (_url, _key, { cookies }) => ({ auth: {
      getUser: async () => {
        handlerAuthCalls++;
        assert.equal(cookies.getAll()[0].value, 'expired');
        cookies.setAll([{ name: 'session', value: '', options: { maxAge: 0, path: '/' } }]);
        return { data: { user: null }, error: { message: 'Session expired' } };
      },
    } }) },
    '@/lib/supabase/admin': { getServiceSupabase: () => assert.fail('Database accessed before authentication') },
  });
  assert.equal((await route.GET(request)).status, 401);
  assert.equal(calls.getUser + handlerAuthCalls, 1);
  assert.equal(writtenCookies.length, 1);
  assert.equal(writtenCookies[0][0], 'session');
  assert.equal(writtenCookies[0][1], '');
  assert.equal(writtenCookies[0][2].maxAge, 0);
});
