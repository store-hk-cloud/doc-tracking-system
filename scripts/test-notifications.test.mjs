import assert from 'node:assert/strict';
import test from 'node:test';
import { Redis } from '@upstash/redis';
import { loadModule } from './test-support/load-module.mjs';

test('importing notification helpers does not construct an external client during build', async () => {
  let constructions = 0;
  const notifications = loadModule('src/lib/upstash.ts', {
    '@upstash/redis': { Redis: class {
      constructor() { constructions++; }
      async lrange() { return []; }
    } },
  });
  assert.equal(constructions, 0);
  await notifications.getNotifications('test');
  await notifications.getNotifications('test');
  assert.equal(constructions, 1);
});

test('notifications survive the Redis SDK automatic JSON deserialization', async () => {
  const message = { title: 'เอกสารใหม่', body: 'รอรับเอกสาร', docId: 'document', runningNo: 6 };
  const redis = new Redis({ request: async () => ({ result: [JSON.stringify(message)] }) });
  assert.deepEqual(await redis.lrange('notify:dept:department', 0, 49), [message]);
  const notifications = loadModule('src/lib/upstash.ts', {
    '@upstash/redis': { Redis: class { constructor() { return redis; } } },
  });
  assert.deepEqual(await notifications.getNotifications('department'), [message]);
});
