import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

const actor = 'a0000000-0000-4000-8000-000000000001';
const batch = 'a0000000-0000-4000-8000-000000000002';
const recipient = 'a0000000-0000-4000-8000-000000000003';
const stamp = '2026-11-10T05:30:00.123456+00:00';
const payload = { batch_id: batch, signature: '  ผู้รับ  ', items: [{ recipient_id: recipient, expected_updated_at: stamp }] };
const saved = { id: batch, created_at: stamp, items: [{ recipient_id: recipient, expected_updated_at: stamp, status: 'queued' }] };

function fixture({ unauthorized = false, rpcError } = {}) {
  const calls = [];
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public', SUPABASE_SECRET_KEY: 'private' };
  const { handleReceiptQueue } = loadModule('src/workers/receipt-queue.ts', {
    './auth': { getWorkerUser: async () => unauthorized ? null : { id: actor, email: 'verified@example.com' } },
  }, { Headers, fetch: async (url, options) => {
    assert.equal(new Headers(options.headers).get('apikey'), 'private');
    calls.push({ path: url.pathname, body: JSON.parse(options.body) });
    if (rpcError) return Response.json({ message: rpcError }, { status: 400 });
    return Response.json(url.pathname.endsWith('/list_document_receipt_batches') ? [saved] : saved);
  } });
  const send = (method, body) => handleReceiptQueue(new Request('https://doc.invalid/api/deliveries/queue', {
    method, headers: { 'content-type': 'application/json', 'x-user-id': 'forged' }, body: body ? JSON.stringify(body) : undefined,
  }), env);
  return { calls, send };
}

test('bulk receipt returns 202 and uses the verified actor, preserving the exact receipt revision', async () => {
  const f = fixture();
  const r = await f.send('POST', { ...payload, actor_id: 'forged' });
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { success: true, data: saved });
  assert.deepEqual(f.calls, [{ path: '/rest/v1/rpc/enqueue_document_receipts', body: {
    p_actor_id: actor, p_actor_email: 'verified@example.com', p_batch_id: batch, p_signature: 'ผู้รับ', p_items: payload.items,
  } }]);
});

test('queue history is private and scoped to the authenticated owner', async () => {
  const f = fixture();
  const r = await f.send('GET');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await r.json(), { success: true, data: [saved] });
  assert.deepEqual(f.calls[0].body, { p_actor_id: actor });
  const anonymous = fixture({ unauthorized: true });
  assert.equal((await anonymous.send('GET')).status, 401);
  assert.equal((await anonymous.send('POST', payload)).status, 401);
  assert.deepEqual(anonymous.calls, []);
});

test('duplicate or invalid items cannot enter the queue', async () => {
  const f = fixture();
  for (const items of [[...payload.items, ...payload.items], [{ recipient_id: recipient, expected_updated_at: null }], []]) {
    assert.equal((await f.send('POST', { ...payload, items })).status, 400);
  }
  assert.deepEqual(f.calls, []);
});

test('idempotency conflict is returned without leaking database diagnostics', async () => {
  const f = fixture({ rpcError: 'receipt_batch_conflict' });
  const response = await f.send('POST', payload);
  assert.equal(response.status, 409);
  assert.notEqual((await response.json()).error, 'receipt_batch_conflict');
});
