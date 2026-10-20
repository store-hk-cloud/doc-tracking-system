import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

test('importing notification helpers does not access Cloudflare bindings during build', async () => {
  const notifications = loadModule('src/lib/upstash.ts', {
    '@opennextjs/cloudflare': { getCloudflareContext: () => { throw new Error('outside request'); } },
  });
  await notifications.getNotifications('test');
  await notifications.getNotifications('test');
  assert.equal(JSON.stringify(await notifications.getNotifications('test')), '[]');
});

test('notifications round-trip through the Cloudflare KV JSON list', async () => {
  const message = { title: 'เอกสารใหม่', body: 'รอรับเอกสาร', docId: 'document', runningNo: 6 };
  const values = new Map([['notify:dept:department', JSON.stringify([message])]]);
  const kv = {
    async get(key) { return values.get(key) || null; },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
    async list({ prefix }) { return { keys: [...values.keys()].filter((key) => key.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }; },
  };
  const notifications = loadModule('src/lib/upstash.ts', {
    '@opennextjs/cloudflare': { getCloudflareContext: () => ({ env: { NOTIFICATIONS_KV: kv } }) },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await notifications.getNotifications('department'))), [message]);
});

test('concurrent notifications use independent keys and clearing preserves other departments', async () => {
  const values = new Map();
  const writes = new Set();
  const kv = {
    async get(key) { return values.get(key) || null; },
    async put(key, value) {
      assert.equal(writes.has(key), false, 'KV rejects a second write to the same key in one second');
      writes.add(key);
      values.set(key, value);
    },
    async delete(key) { values.delete(key); },
    async list({ prefix }) { return { keys: [...values.keys()].filter((key) => key.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }; },
  };
  const notifications = loadModule('src/lib/upstash.ts', {
    '@opennextjs/cloudflare': { getCloudflareContext: () => ({ env: { NOTIFICATIONS_KV: kv } }) },
  });
  const messages = Array.from({ length: 12 }, (_, i) => ({ title: 'เอกสารใหม่', body: 'รอรับ', docId: `doc-${i}`, runningNo: i }));
  await Promise.all(messages.map((message) => notifications.notifyDepartment('department', message)));
  await notifications.notifyDepartment('another', messages[0]);
  assert.equal((await notifications.getNotifications('department')).length, 12);
  await notifications.clearNotifications('department');
  assert.equal((await notifications.getNotifications('department')).length, 0);
  assert.equal((await notifications.getNotifications('another')).length, 1);
});
