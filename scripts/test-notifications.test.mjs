import assert from 'node:assert/strict';
import test from 'node:test';
import { Redis } from '@upstash/redis';
import { loadModule } from './test-support/load-module.mjs';

test('notifications survive the Redis SDK automatic JSON deserialization', async () => {
  const message = { title: 'เอกสารใหม่', body: 'รอรับเอกสาร', docId: 'document', runningNo: 6 };
  const redis = new Redis({ request: async () => ({ result: [JSON.stringify(message)] }) });
  assert.deepEqual(await redis.lrange('notify:dept:department', 0, 49), [message]);
  const notifications = loadModule('src/lib/upstash.ts', {
    '@upstash/redis': { Redis: class { constructor() { return redis; } } },
  });
  assert.deepEqual(await notifications.getNotifications('department'), [message]);
});
