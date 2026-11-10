import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

const recipientId = 'a0000000-0000-4000-8000-000000000001';
const actorId = 'a0000000-0000-4000-8000-000000000002';
const validBody = { document_recipient_id: recipientId, recipient_signature: '  ผู้รับจริง  ', is_verified: true };
const delivery = { id: 'delivery-id', document_recipient_id: recipientId, recipient_id: actorId };
const env = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public',
  SUPABASE_SECRET_KEY: 'server',
};

function fixture({ rpcError, expired = false, rejectAuth = false } = {}) {
  const calls = [];
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = `${encode({ alg: 'HS256' })}.${encode({ sub: actorId, exp: expires })}.signature`;
  const cookie = `sb-example-auth-token=base64-${encode({
    access_token: token, refresh_token: 'refresh', expires_at: expired ? expires - 7200 : expires,
    user: { id: 'unverified-cookie-user', email: 'fake@example.com' },
  })}`;
  const fetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const headers = new Headers(options?.headers);
    calls.push({ path: url.pathname, body: options?.body && JSON.parse(options.body) });
    if (url.pathname === '/auth/v1/token') {
      return Response.json({ access_token: token, refresh_token: 'renewed', expires_in: 3600, token_type: 'bearer', user: { id: actorId } });
    }
    if (url.pathname === '/auth/v1/user') {
      assert.equal(headers.get('authorization'), `Bearer ${token}`);
      return rejectAuth ? Response.json({ message: 'Invalid token' }, { status: 401 }) : Response.json({ id: actorId, email: 'verified@example.com' });
    }
    assert.equal(url.pathname, '/rest/v1/rpc/receive_document_worker');
    assert.equal(headers.get('apikey'), 'server');
    return rpcError ? Response.json({ message: rpcError }, { status: 400 }) : Response.json({ recipient: { id: recipientId }, delivery });
  };
  const { handleDocumentReceipt } = loadModule('src/workers/document-receipt.ts', {}, { fetch, Headers });
  const send = (body = validBody, authenticated = true) => handleDocumentReceipt(new Request('https://doc.invalid/api/deliveries', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { cookie } : {}), 'x-user-id': 'forged' },
    body: JSON.stringify(body),
  }), env);
  return { calls, send };
}

test('a receipt uses verified actor and email, and calls only Auth and the atomic RPC', async () => {
  const f = fixture();
  const response = await f.send({ ...validBody, actor_id: 'forged', department_id: 'other' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { success: true, data: delivery });
  assert.deepEqual(f.calls.map(call => call.path), ['/auth/v1/user', '/rest/v1/rpc/receive_document_worker']);
  assert.deepEqual(f.calls[1].body, {
    p_recipient_id: recipientId, p_actor_id: actorId, p_actor_email: 'verified@example.com',
    p_signature: 'ผู้รับจริง', p_is_verified: true, p_note: null,
  });
});

test('receipt denies forged headers or a revoked session before the RPC', async () => {
  const anonymous = fixture();
  assert.equal((await anonymous.send(validBody, false)).status, 401);
  assert.deepEqual(anonymous.calls, []);
  const rejected = fixture({ rejectAuth: true });
  assert.equal((await rejected.send()).status, 401);
  assert.ok(rejected.calls.every(call => call.path === '/auth/v1/user'));
});

test('receipt sends a rejection note and lets the database choose the account name for a blank signature', async () => {
  const f = fixture();
  assert.equal((await f.send({ ...validBody, recipient_signature: ' ', is_verified: false, verification_note: 'ผิดจำนวน' })).status, 200);
  assert.equal(f.calls[1].body.p_signature, null);
  assert.equal(f.calls[1].body.p_is_verified, false);
  assert.equal(f.calls[1].body.p_note, 'ผิดจำนวน');
});

test('receipt refreshes expired cookies and passes the new session cookie back', async () => {
  const f = fixture({ expired: true });
  const response = await f.send();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie') || '', /sb-example-auth-token=/);
  assert.deepEqual(f.calls.map(call => call.path), ['/auth/v1/token', '/auth/v1/user', '/rest/v1/rpc/receive_document_worker']);
});

for (const [message, status] of [
  ['receipt_actor_not_authenticated', 401], ['receipt_forbidden', 403],
  ['document_recipient_not_found', 404], ['recipient_already_processed', 409], ['private diagnostic', 503],
]) test(`receipt maps database outcome to ${status}`, async () => {
  const f = fixture({ rpcError: message });
  const response = await f.send();
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.notEqual(body.error, 'private diagnostic');
  assert.equal(f.calls.filter(call => call.path.startsWith('/rest/')).length, 1);
});

test('invalid receipt payload never calls the write RPC', async () => {
  const f = fixture();
  assert.equal((await f.send({ ...validBody, document_recipient_id: 'not-a-uuid' })).status, 404);
  assert.equal((await f.send({ document_recipient_id: recipientId, is_verified: 'true' })).status, 400);
  assert.ok(f.calls.every(call => call.path === '/auth/v1/user'));
});

test('only POST deliveries in the active mode bypasses OpenNext', async () => {
  let nextLoads = 0;
  const mocks = {
    './src/workers/notifications': { handleNotifications: async () => new Response('notifications') },
    './src/workers/document-receipt': { handleDocumentReceipt: async () => new Response('receipt') },
  };
  Object.defineProperty(mocks, './.open-next/worker.js', { get() {
    nextLoads++;
    return { __esModule: true, default: { fetch: async () => new Response('next') } };
  } });
  const { default: worker } = loadModule('worker.ts', mocks);
  const mode = { DOCUMENT_RECEIPT_FAST_PATH: 'true', GOOGLE_SHEETS_SYNC_MODE: 'apps_script' };
  const url = 'https://doc.invalid/api/deliveries';
  assert.equal(await (await worker.fetch(new Request(url, { method: 'POST' }), mode, {})).text(), 'receipt');
  assert.equal(nextLoads, 0);
  assert.equal(await (await worker.fetch(new Request(url), mode, {})).text(), 'next');
  assert.equal(await (await worker.fetch(new Request(url, { method: 'POST' }), {}, {})).text(), 'next');
});
