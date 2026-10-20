import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

const GENERIC_ERROR = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';

function loadUsernameLoginRoute({ profile, signInResult }) {
  const signInAttempts = [];
  const profilesQuery = {
    from: () => profilesQuery,
    select: () => profilesQuery,
    ilike: () => profilesQuery,
    maybeSingle: async () => ({ data: profile, error: null }),
  };
  const route = loadModule('src/app/api/auth/resolve-username/route.ts', {
    '@/lib/supabase/admin': {
      escapeLikePattern: (value) => value,
      getServiceSupabase: () => profilesQuery,
    },
    '@/lib/supabase/server': {
      createServerSupabase: async () => ({ auth: {
        signInWithPassword: async (credentials) => {
          signInAttempts.push(credentials);
          return signInResult;
        },
      } }),
    },
  }, {
    setTimeout(callback) { callback(); return 0; },
  });
  return { route, signInAttempts };
}

test('username login verifies the password before returning a session and never serializes the resolved email', async () => {
  const { route, signInAttempts } = loadUsernameLoginRoute({
    profile: { email: 'messenger-secret@example.invalid', is_active: true },
    signInResult: {
      data: { session: { access_token: 'access-token', refresh_token: 'refresh-token' } },
      error: null,
    },
  });

  const response = await route.POST(new Request('https://example.invalid/api/auth/resolve-username', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'messenger_01', password: 'correct-password' }),
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    success: true,
    data: { access_token: 'access-token', refresh_token: 'refresh-token' },
  });
  assert.equal(JSON.stringify(body).includes('messenger-secret@example.invalid'), false);
  assert.equal(signInAttempts.length, 1);
  assert.equal(signInAttempts[0].email, 'messenger-secret@example.invalid');
  assert.equal(signInAttempts[0].password, 'correct-password');
});

test('username login returns one generic response for an unknown username and a wrong password', async () => {
  const unknown = loadUsernameLoginRoute({
    profile: null,
    signInResult: { data: { session: null }, error: new Error('Invalid login credentials') },
  });
  const wrongPassword = loadUsernameLoginRoute({
    profile: { email: 'messenger-secret@example.invalid', is_active: true },
    signInResult: { data: { session: null }, error: new Error('Invalid login credentials') },
  });

  const request = () => new Request('https://example.invalid/api/auth/resolve-username', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'messenger_01', password: 'wrong-password' }),
  });
  const [unknownResponse, wrongPasswordResponse] = await Promise.all([
    unknown.route.POST(request()),
    wrongPassword.route.POST(request()),
  ]);

  assert.equal(unknownResponse.status, 401);
  assert.equal(wrongPasswordResponse.status, 401);
  assert.deepEqual(await unknownResponse.json(), { success: false, error: GENERIC_ERROR });
  assert.deepEqual(await wrongPasswordResponse.json(), { success: false, error: GENERIC_ERROR });
  assert.equal(unknown.signInAttempts.length, 1);
  assert.equal(wrongPassword.signInAttempts.length, 1);
});
