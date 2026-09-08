import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync } from 'node:fs';
import { loadModule } from './test-support/load-module.mjs';

function routes(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? routes(`${dir}/${entry.name}`) : entry.name === 'route.ts' ? [`${dir}/${entry.name}`] : []);
}

test('cron rejects missing configuration and invalid authorization before database access', async () => {
  for (const [secret, expected] of [['', 503], ['test-only-secret', 401]]) {
    const route = loadModule('src/app/api/cron/overdue-documents/route.ts', {
      '@/lib/supabase/admin': { getServiceSupabase: () => assert.fail('Database accessed before cron authorization') },
    }, { process: { env: { CRON_SECRET: secret } }, console: { ...console, error() {} } });
    assert.equal((await route.GET(new Request('https://example.invalid/api/cron/overdue-documents'))).status, expected);
  }
});

test('username resolution rejects invalid input before database access', async () => {
  const route = loadModule('src/app/api/auth/resolve-username/route.ts', {
    '@/lib/supabase/admin': { getServiceSupabase: () => assert.fail('Database accessed for invalid username') },
  });
  const request = new Request('https://example.invalid/api/auth/resolve-username', {
    method: 'POST', body: JSON.stringify({ username: '%*' }), headers: { 'Content-Type': 'application/json' },
  });
  assert.equal((await route.POST(request)).status, 400);
});

test('authentication helpers reject inactive users and enforce roles and departments', async () => {
  const fixtures = [
    { role: 'user', is_active: false, department: 'FIN', status: 401 },
    { role: 'user', is_active: true, department: 'FIN', status: 403 },
    { role: 'admin', is_active: true, department: 'HR', status: 403 },
    { role: 'admin', is_active: true, department: 'FIN', status: null },
    { role: 'super_admin', is_active: true, department: 'HR', status: null },
  ];
  for (const fixture of fixtures) {
    const helper = loadModule('src/lib/supabase/auth-helpers.ts', {
      '@/lib/supabase/server': { createServerSupabase: async () => ({ auth: {
        getUser: async () => ({ data: { user: { id: 'test-user' } }, error: null }),
      } }) },
      '@/lib/supabase/admin': { getServiceSupabase: () => {
        const query = { from: () => query, select: () => query, eq: () => query, single: async () => ({
          data: { id: 'test-user', role: fixture.role, is_active: fixture.is_active, departments: { code: fixture.department } }, error: null,
        }) };
        return query;
      } },
    });
    const result = await helper.requireCapability({ roles: ['admin', 'super_admin'], deptCodes: ['FIN'] });
    assert.equal(result.response?.status ?? null, fixture.status);
  }
});

for (const path of routes('src/app/api')) {
  if (path.includes('/cron/') || path.includes('/auth/resolve-username/')) continue;
  test(`unauthenticated requests cannot cross the server boundary: ${path}`, async () => {
    const route = loadModule(path, {
      '@/lib/supabase/server': { createServerSupabase: async () => ({ auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
      } }) },
      '@/lib/supabase/admin': { getServiceSupabase: () => assert.fail('Database accessed before authentication') },
    }, { fetch: () => assert.fail('Unexpected network request'), Buffer });
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      if (!route[method]) continue;
      const response = await route[method](new Request('https://example.invalid/api/test', { method }), {
        params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }),
      });
      assert.ok([401, 410].includes(response.status), `${method} returned ${response.status}`);
    }
  });
}
