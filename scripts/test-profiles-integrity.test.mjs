import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

function fixture({ profileError = null, department = { id: 'dept-1' }, authError = null } = {}) {
  const calls = { created: 0, deleted: [], inserted: 0 };
  const supabase = {
    auth: { admin: {
      createUser: async () => {
        calls.created++;
        return authError
          ? { data: { user: null }, error: authError }
          : { data: { user: { id: 'new-auth-user' } }, error: null };
      },
      deleteUser: async (id) => {
        calls.deleted.push(id);
        return { error: null };
      },
    } },
    from(table) {
      let operation = 'select';
      const query = {
        select() { return query; },
        eq() { return query; },
        ilike() { return query; },
        limit() { return query; },
        insert() { operation = 'insert'; calls.inserted++; return query; },
        async maybeSingle() {
          if (table === 'departments') return { data: department, error: null };
          return { data: null, error: null };
        },
        async single() {
          if (table === 'profiles' && operation === 'insert') {
            return profileError
              ? { data: null, error: profileError }
              : { data: { id: 'new-auth-user', full_name: 'ผู้ใช้ใหม่', department_id: null }, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve, reject) { return query.single().then(resolve, reject); },
      };
      return query;
    },
  };
  const route = loadModule('src/app/api/profiles/route.ts', {
    '@/lib/supabase/admin': { getServiceSupabase: () => supabase, escapeLikePattern: (value) => value },
    '@/lib/supabase/auth-helpers': {
      requireRoles: async () => ({ context: { profile: { role: 'super_admin' } }, response: null }),
    },
  });
  return { route, calls };
}

test('failed profile insert removes the newly-created Auth user', async () => {
  const { route, calls } = fixture({ profileError: { message: 'profile insert failed' } });
  const response = await route.POST({ json: async () => ({
    email: 'new@example.invalid', password: 'secret', full_name: 'ผู้ใช้ใหม่',
  }) });
  assert.equal(response.status, 500);
  assert.equal(calls.created, 1);
  assert.deepEqual(calls.deleted, ['new-auth-user']);
});

test('unknown department is rejected before an Auth user is created', async () => {
  const { route, calls } = fixture({ department: null });
  const response = await route.POST({ json: async () => ({
    email: 'new@example.invalid', password: 'secret', full_name: 'ผู้ใช้ใหม่', department_id: 'missing',
  }) });
  assert.equal(response.status, 400);
  assert.equal(calls.created, 0);
  assert.equal(calls.inserted, 0);
  assert.deepEqual(calls.deleted, []);
});

test('successful user creation never runs Auth cleanup', async () => {
  const { route, calls } = fixture();
  const response = await route.POST({ json: async () => ({
    email: 'new@example.invalid', password: 'secret', full_name: 'ผู้ใช้ใหม่',
  }) });
  assert.equal(response.status, 200);
  assert.equal(calls.created, 1);
  assert.deepEqual(calls.deleted, []);
});

test('failed Auth creation does not attempt profile insertion or cleanup', async () => {
  const { route, calls } = fixture({ authError: { message: 'already registered' } });
  const response = await route.POST({ json: async () => ({
    email: 'taken@example.invalid', password: 'secret', full_name: 'ผู้ใช้ใหม่',
  }) });
  assert.equal(response.status, 500);
  assert.equal(calls.inserted, 0);
  assert.deepEqual(calls.deleted, []);
});
