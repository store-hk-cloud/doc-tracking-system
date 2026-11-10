import assert from 'node:assert/strict';
import test from 'node:test';
import { createReceiptApi } from '../desktop/api-client.mjs';

test('desktop queue preserves document revisions and derives identity from the session', async () => {
  const calls = [];
  const api = createReceiptApi({
    rpc: async (name, args) => { calls.push([name, args]); return { data: { id: 'saved' } }; },
  });
  assert.deepEqual(await api.submitReceipts({
    batchId: 'batch', signatureName: ' ผู้รับ ', actorId: 'ignored',
    items: [{ recipientId: 'recipient', expectedUpdatedAt: '2026-11-10T05:30:00.123456+00:00' }],
  }), { id: 'saved' });
  assert.deepEqual(calls, [['enqueue_desktop_receipts', {
    p_batch_id: 'batch', p_signature_name: 'ผู้รับ',
    p_items: [{ recipientId: 'recipient', expectedUpdatedAt: '2026-11-10T05:30:00.123456+00:00' }],
  }]]);
});

test('desktop shows a safe error and distinguishes a rejected action from an ambiguous request', async () => {
  const api = createReceiptApi({
    rpc: async () => ({ error: { code: '42501', message: 'internal database detail' }, status: 403 }),
  });
  await assert.rejects(api.listBatches(), error => {
    assert.match(error.message, /สิทธิ์/);
    assert.doesNotMatch(error.message, /internal/);
    assert.equal(error.retryable, false);
    return true;
  });
  const offline = createReceiptApi({ rpc: async () => { throw new Error('internal network detail'); } });
  await assert.rejects(offline.listPending(''), error => error.retryable === true && !error.message.includes('internal'));
});

test('desktop login passes the existing email and logout clears the local session scope', async () => {
  const calls = [];
  const session = { user: { email: 'acc@example.test' } };
  const api = createReceiptApi({
    auth: {
      signInWithPassword: async args => { calls.push(args); return { data: { session } }; },
      getSession: async () => ({ data: { session } }),
      signOut: async args => { calls.push(args); return {}; },
    },
  });
  assert.deepEqual(await api.login(' acc@example.test ', 'password'), session);
  assert.deepEqual(await api.getSession(), session);
  await api.logout();
  assert.deepEqual(calls, [{ email: 'acc@example.test', password: 'password' }, { scope: 'local' }]);
});

test('desktop preserves queue feedback and reports a failed remote sign-out', async () => {
  const api = createReceiptApi({
    rpc: async () => ({ error: { message: 'receipt_queue_busy' }, status: 400 }),
    auth: { signOut: async () => ({ error: { message: 'internal detail' } }) },
  });
  await assert.rejects(api.listBatches(), /ยังมีคิวค้างหลายชุด/);
  await assert.rejects(api.logout(), /ติดต่อระบบเพื่อออกจากบัญชีไม่สำเร็จ/);
});
