import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceAuthHandler } from '../desktop/device-auth/handler.mjs';

const web = 'https://tracking.example';
const app = 'app://desktop';
const verifier = 'a'.repeat(64);
const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('hex');

function setup() {
  let actor = null;
  let pending = false;
  let active = true;
  let expired = false;
  const handle = createDeviceAuthHandler({
    webOrigin: web,
    identify: async (token) => token === 'browser' ? 'actor' : null,
    isActive: async () => active,
    register: async () => { pending = true; return true; },
    approve: async (_, id) => { if (!pending || expired || actor) return false; actor = id; return true; },
    claim: async (hash) => { if (!pending || expired || !actor || hash !== challenge) return null; pending = false; return actor; },
    issue: async () => ({ access_token: 'access', refresh_token: 'refresh' }),
  });
  const post = (origin, body, token = '') => handle(new Request('https://api.example', {
    method: 'POST', headers: { origin, authorization: token ? 'Bearer ' + token : '' }, body: JSON.stringify(body),
  }));
  return { post, disable: () => { active = false; }, expire: () => { expired = true; } };
}

test('browser approves and only the desktop verifier gets a session once', async () => {
  const { post } = setup();
  assert.equal((await post(app, { action: 'register', challenge })).status, 201);
  const approved = await post(web, { action: 'approve', challenge }, 'browser');
  assert.equal(approved.status, 204);
  assert.equal(await approved.text(), '');
  assert.equal((await post(web, { action: 'claim', verifier })).status, 403);
  assert.equal((await post(app, { action: 'claim', verifier: challenge })).status, 202);
  assert.deepEqual(await (await post(app, { action: 'claim', verifier })).json(), { access_token: 'access', refresh_token: 'refresh' });
  assert.equal((await post(app, { action: 'claim', verifier })).status, 202);
});

test('rejects unknown origins, disabled actors, and expired challenges', async () => {
  const { post, disable, expire } = setup();
  assert.equal((await post('https://other.example', { action: 'approve', challenge }, 'browser')).status, 403);
  await post(app, { action: 'register', challenge });
  assert.equal((await post(web, { action: 'approve', challenge })).status, 401);
  await post(web, { action: 'approve', challenge }, 'browser');
  disable();
  assert.equal((await post(app, { action: 'claim', verifier })).status, 403);
  await post(app, { action: 'register', challenge });
  expire();
  assert.equal((await post(app, { action: 'claim', verifier })).status, 202);
});
test('desktop registers before opening the website and keeps the verifier out of the browser URL', async (t) => {
  const { startDeviceLogin } = await import('../desktop/device-auth/client.mjs');
  const actions = [];
  let connect;
  let code;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://api.example/functions/v1/desktop-device-auth');
    assert.equal(options.credentials, 'omit');
    const body = JSON.parse(options.body);
    actions.push(body);
    if (body.action === 'register') return new Response(null, { status: 201 });
    return Response.json({ access_token: 'access', refresh_token: 'refresh' });
  });
  const result = await startDeviceLogin({
    origin: web,
    supabaseUrl: 'https://api.example',
    publicKey: 'publishable',
    openBrowser: async (url) => {
      assert.equal(actions.length, 1);
      connect = new URL(url);
    },
    onCode: (value) => { code = value; },
  });
  assert.equal(connect.origin, web);
  assert.equal(connect.pathname, '/desktop/connect');
  assert.equal(connect.searchParams.get('challenge'), actions[0].challenge);
  assert.match(code, /^[A-F0-9]{4}-[A-F0-9]{4}$/);
  assert.equal(actions[1].action, 'claim');
  assert.match(actions[1].verifier, /^[a-f0-9]{64}$/);
  assert.equal(connect.href.includes(actions[1].verifier), false);
  assert.deepEqual(result, { access_token: 'access', refresh_token: 'refresh' });
});
test('database isolates pairing rows and atomically consumes a live approval', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { readFile } = await import('node:fs/promises');
  const db = new PGlite();
  try {
    const actor = '11111111-1111-1111-1111-111111111111';
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users (id uuid primary key);
      insert into auth.users values ('${actor}');`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261110123400_desktop_device_auth.sql', import.meta.url), 'utf8'));

    await db.exec('set role authenticated');
    await assert.rejects(db.query('select public.desktop_device_register($1)', [challenge]), /permission denied/);
    await assert.rejects(db.query('select * from private.desktop_device_auth'), /permission denied/);
    await db.exec('set role service_role');

    const one = async (sql, params = [challenge]) => (await db.query(sql, params)).rows[0].value;
    assert.equal(await one('select public.desktop_device_register($1) as value'), true);
    assert.equal(await one('select public.desktop_device_claim($1) as value'), null);
    assert.equal(await one('select public.desktop_device_approve($1, $2) as value', [challenge, actor]), true);
    assert.equal(await one('select public.desktop_device_approve($1, $2) as value', [challenge, actor]), false);
    assert.equal(await one('select public.desktop_device_claim($1) as value'), actor);
    assert.equal(await one('select public.desktop_device_claim($1) as value'), null);

    await db.exec('reset role');
    await db.query('insert into private.desktop_device_auth (challenge, actor_id, expires_at) values ($1, $2, now())', [challenge, actor]);
    assert.equal(await one('select public.desktop_device_claim($1) as value'), null);
  } finally {
    await db.close();
  }
});
