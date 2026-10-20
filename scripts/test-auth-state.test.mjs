import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { loadModule } from './test-support/load-module.mjs';

async function mount(getSession, fetchProfile) {
  let listener; let state;
  const auth = { getSession, onAuthStateChange: (fn) => {
    listener = fn;
    return { data: { subscription: { unsubscribe() {} } } };
  } };
  const authModule = loadModule('src/components/auth/AuthProvider.tsx', {
    '@/lib/supabase/client': { createClient: () => ({ auth }) },
  }, { fetch: fetchProfile });
  function Reader() { state = authModule.useAuth(); return null; }
  let renderer;
  await act(async () => { renderer = create(React.createElement(authModule.AuthProvider, null, React.createElement(Reader))); });
  return { renderer, state: () => state, signOut: () => listener('SIGNED_OUT') };
}

test('late profile response cannot restore profile after sign-out', async () => {
  let finish;
  const app = await mount(async () => ({ data: { session: { user: { id: 'user-1', email: 'test@example.invalid' } } } }),
    () => new Promise((resolve) => { finish = resolve; }));
  try {
    await act(async () => { app.signOut(); finish({ ok: true, json: async () => ({ success: true, data: { id: 'user-1' } }) }); });
    assert.equal(app.state().profile, null);
    assert.equal(app.state().user, null);
    assert.equal(app.state().loading, false);
  } finally { app.renderer.unmount(); }
});

test('session failure ends loading instead of leaving the app stuck', async () => {
  const app = await mount(async () => { throw new Error('session unavailable'); }, () => assert.fail('Unexpected profile fetch'));
  try { assert.equal(app.state().loading, false); assert.equal(app.state().user, null); }
  finally { app.renderer.unmount(); }
});

test('late initial session cannot restore a user after sign-out', async () => {
  let finish;
  const app = await mount(() => new Promise((resolve) => { finish = resolve; }), () => assert.fail('Unexpected profile fetch'));
  try {
    await act(async () => { app.signOut(); finish({ data: { session: { user: { id: 'old-user' } } } }); });
    assert.equal(app.state().user, null);
    assert.equal(app.state().loading, false);
  } finally { app.renderer.unmount(); }
});

test('username login sends both credentials to the opaque endpoint and stores only the returned session', async () => {
  let state;
  let setSessionInput;
  const requests = [];
  const location = { href: '' };
  const auth = {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    setSession: async (session) => {
      setSessionInput = session;
      return { error: null };
    },
  };
  const authModule = loadModule('src/components/auth/AuthProvider.tsx', {
    '@/lib/supabase/client': { createClient: () => ({ auth }) },
  }, {
    fetch: async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: { access_token: 'access-token', refresh_token: 'refresh-token' },
        }),
      };
    },
    window: { location },
  });
  function Reader() { state = authModule.useAuth(); return null; }
  let renderer;
  try {
    await act(async () => { renderer = create(React.createElement(authModule.AuthProvider, null, React.createElement(Reader))); });
    let error;
    await act(async () => { error = await state.signInWithUsername('messenger_01', 'correct-password'); });

    assert.equal(error, null);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/auth/resolve-username');
    assert.deepEqual(JSON.parse(requests[0].init.body), { username: 'messenger_01', password: 'correct-password' });
    assert.equal(setSessionInput.access_token, 'access-token');
    assert.equal(setSessionInput.refresh_token, 'refresh-token');
    assert.equal(location.href, '/dashboard');
  } finally { renderer?.unmount(); }
});
