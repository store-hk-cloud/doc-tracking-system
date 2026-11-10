import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { loadModule } from './test-support/load-module.mjs';

const input = { document_recipient_id: 'r1', is_verified: true, recipient_signature: '  ผู้รับ  ', verification_note: null };
const baseline = '2026-11-10T02:40:00Z';
const evidence = { document_recipient_id: 'r1', recipient_id: 'u1', recipient_signature: 'ผู้รับ', is_verified: true, verification_note: null, recipient_signed_at: '2026-11-10T02:49:55Z', document_recipients: { id: 'r1', status: 'closed' } };
function helper(fetch, globals = {}) {
  assert.ok(existsSync('src/lib/receipt-submit.ts'), 'receipt submission must verify ambiguous outcomes');
  return loadModule('src/lib/receipt-submit.ts', {}, { fetch, AbortController, ...globals }).submitReceipt;
}
for (const failure of ['network', 502, 503, 504, 'invalid-json']) {
  test(`recovers ${failure} only after matching committed evidence`, async () => {
    const calls = [];
    const submit = helper(async (url, options) => {
      calls.push([url, options]);
      if (options.method === 'POST') {
        if (failure === 'network') throw new TypeError('offline');
        return failure === 'invalid-json' ? new Response('html') : Response.json({ error: 'upstream' }, { status: failure });
      }
      return Response.json({ success: true, data: [evidence] });
    });
    const response = await submit(input, 'u1', baseline);
    assert.equal(response.ok, true);
    assert.equal((await response.json()).success, true);
    assert.deepEqual(calls.map(([, options]) => options.method), ['POST', 'GET']);
    assert.equal(calls[1][0], '/api/deliveries?document_recipient_id=r1');
    assert.ok(calls[1][1].signal);
  });
}
for (const [name, patch] of [
  ['actor', { recipient_id: 'someone' }], ['signature', { recipient_signature: 'อื่น' }],
  ['result', { is_verified: false }], ['note', { verification_note: 'อื่น' }],
  ['old cycle', { recipient_signed_at: baseline }], ['invalid date', { recipient_signed_at: null }],
  ['status', { document_recipients: { id: 'r1', status: 'awaiting_recipient' } }],
  ['recipient', { document_recipients: { id: 'other', status: 'closed' } }],
]) {
  test(`does not claim success for mismatched ${name}`, async () => {
    const submit = helper(async (_, options) => options.method === 'POST'
      ? Response.json({ error: 'upstream' }, { status: 503 })
      : Response.json({ success: true, data: [{ ...evidence, ...patch }] }));
    const response = await submit(input, 'u1', baseline);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /โหลดข้อมูลล่าสุด/);
  });
}
for (const mode of ['empty', 'read-fails', 'network-before-commit', 'missing-user', 'missing-baseline']) {
  test(`keeps ambiguous failure when ${mode}`, async () => {
    const submit = helper(async (_, options) => {
      if (options.method === 'POST') {
        if (mode === 'network-before-commit') throw new TypeError('offline');
        return Response.json({ error: 'upstream' }, { status: 503 });
      }
      if (mode === 'read-fails') throw new TypeError('offline');
      return Response.json({ success: true, data: mode.startsWith('missing') ? [evidence] : [] });
    });
    const response = await submit(input, mode === 'missing-user' ? undefined : 'u1', mode === 'missing-baseline' ? undefined : baseline);
    assert.equal(response.ok, false);
    assert.match((await response.json()).error, /โหลดข้อมูลล่าสุด/);
  });
}
for (const status of [200, 403, 409]) {
  test(`normal HTTP ${status} makes no readback`, async () => {
    let calls = 0;
    const submit = helper(async () => { calls++; return Response.json({ success: status === 200 }, { status }); });
    assert.equal((await submit(input, 'u1', baseline)).status, status);
    assert.equal(calls, 1);
  });
}

for (const status of [400, 401, 403, 409, 500]) {
  test(`invalid JSON HTTP ${status} never recovers a definitive failure`, async () => {
    let calls = 0;
    const submit = helper(async () => { calls++; return new Response('html', { status }); });
    assert.equal((await submit(input, 'u1', baseline)).status, status);
    assert.equal(calls, 1);
  });
}

test('an older matching delivery cannot override the latest mismatching evidence', async () => {
  const submit = helper(async (_, options) => options.method === 'POST'
    ? Response.json({ error: 'upstream' }, { status: 503 })
    : Response.json({ success: true, data: [{ ...evidence, recipient_id: 'other' }, evidence] }));
  assert.equal((await submit(input, 'u1', baseline)).status, 503);
});

test('recovers a rejection only with matching result and reason', async () => {
  const submit = helper(async (_, options) => options.method === 'POST'
    ? new Response('upstream html', { status: 503 })
    : Response.json({ success: true, data: [{ ...evidence, is_verified: false, verification_note: 'จำนวนผิด', document_recipients: { id: 'r1', status: 'rejected' } }] }));
  const response = await submit({ ...input, is_verified: false, verification_note: 'จำนวนผิด' }, 'u1', baseline);
  assert.equal(response.ok, true);
});

test('HTML 503 with failed readback preserves the original failure', async () => {
  const submit = helper(async (_, options) => options.method === 'POST'
    ? new Response('upstream html', { status: 503 })
    : Response.json({ success: true, data: [evidence] }, { status: 503 }));
  const response = await submit(input, 'u1', baseline);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /โหลดข้อมูลล่าสุด/);
});

test('readback aborts after the bounded deadline without repeating POST', async () => {
  let calls = 0;
  let fireTimeout;
  let timerCleared = false;
  const submit = helper(async (_, options) => {
    calls++;
    if (options.method === 'POST') return new Response('html', { status: 503 });
    return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      fireTimeout();
    });
  }, {
    setTimeout(callback, delay) { assert.equal(delay, 5000); fireTimeout = callback; return 1; },
    clearTimeout(id) { assert.equal(id, 1); timerCleared = true; },
  });
  const response = await submit(input, 'u1', baseline);
  assert.equal(response.status, 503);
  assert.equal(calls, 2);
  assert.equal(timerCleared, true);
  assert.match((await response.json()).error, /โหลดข้อมูลล่าสุด/);
});
