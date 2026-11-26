import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './test-support/load-module.mjs';

const ids = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);

function setup({ role = 'user', denied, rpcResult = { data: { count: 3 }, error: null } } = {}) {
  const rpcCalls = [];
  const route = loadModule('src/app/api/documents/order/route.ts', {
    '@/lib/supabase/admin': { getServiceSupabase: () => ({ rpc: async (name, args) => { rpcCalls.push({ name, args }); return rpcResult; } }) },
    '@/lib/supabase/auth-helpers': { requireRoles: async (roles) => denied
      ? { response: Response.json({ success: false }, { status: denied }) }
      : { context: { user: { id: 'session-user' }, profile: { role } }, roles } },
  });
  const put = async (body) => {
    const response = await route.PUT({ json: async () => body });
    return { status: response.status, ...await response.json() };
  };
  return { rpcCalls, put };
}

test('rejected roles are answered before any database call', async () => {
  const f = setup({ denied: 403 });
  assert.equal((await f.put({ scope: 'delivery', ids })).status, 403);
  assert.equal(f.rpcCalls.length, 0);
});

for (const [label, body] of [
  ['unknown scope', { scope: 'all', ids }],
  ['missing scope', { ids }],
  ['ids not an array', { scope: 'stage', ids: ids[0] }],
  ['non-uuid id', { scope: 'stage', ids: [ids[0], 'not-a-uuid'] }],
  ['non-string id', { scope: 'stage', ids: [1] }],
  ['empty ids', { scope: 'stage', ids: [] }],
  ['more than 500 ids', { scope: 'stage', ids: Array.from({ length: 501 }, () => ids[0]) }],
]) test(`invalid body is rejected without calling rpc: ${label}`, async () => {
  const f = setup();
  assert.equal((await f.put(body)).status, 400);
  assert.equal(f.rpcCalls.length, 0);
});

test('actor id comes from the session even if the body supplies one', async () => {
  const f = setup();
  const result = await f.put({ scope: 'delivery', ids, p_actor_id: 'forged', actor_id: 'forged' });
  assert.deepEqual(JSON.parse(JSON.stringify(f.rpcCalls)), [{ name: 'reorder_document_recipients', args: { p_actor_id: 'session-user', p_scope: 'delivery', p_ids: ids } }]);
  assert.equal(result.status, 200);
  assert.deepEqual({ success: result.success, data: result.data }, { success: true, data: { count: 3 } });
});

test('exactly 500 ids are accepted', async () => {
  const f = setup();
  assert.equal((await f.put({ scope: 'stage', ids: Array.from({ length: 500 }, () => ids[0]) })).status, 200);
});

for (const [message, status] of [
  ['order_forbidden', 403], ['receipt_forbidden', 403], ['order_stale', 409],
  ['order_invalid', 400], ['receipt_actor_not_authenticated', 401], ['boom', 500],
]) test(`rpc error ${message} maps to ${status}`, async () => {
  const f = setup({ rpcResult: { data: null, error: { message: `ERROR: ${message}` } } });
  const result = await f.put({ scope: 'stage', ids });
  assert.equal(result.status, status);
  assert.equal(result.success, false);
  assert.equal(typeof result.error, 'string');
});

test('a body that is not JSON is a 400, not a 500', async () => {
  const f = setup();
  const response = await loadModule('src/app/api/documents/order/route.ts', {
    '@/lib/supabase/admin': { getServiceSupabase: () => ({ rpc: async () => { f.rpcCalls.push(1); return {}; } }) },
    '@/lib/supabase/auth-helpers': { requireRoles: async () => ({ context: { user: { id: 'session-user' } } }) },
  }).PUT({ json: async () => { throw new SyntaxError('Unexpected token'); } });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).success, false);
  assert.equal(f.rpcCalls.length, 0);
});

for (const [label, error] of [
  ['SQLSTATE 55P03', { code: '55P03', message: 'could not obtain lock on row' }],
  ['lock timeout message', { message: 'canceling statement due to lock timeout' }],
]) test(`lock timeout (${label}) is a retryable 409 with a Thai message`, async () => {
  const f = setup({ rpcResult: { data: null, error } });
  const result = await f.put({ scope: 'stage', ids });
  assert.equal(result.status, 409);
  assert.equal(result.error, 'มีผู้อื่นกำลังแก้ไขรายการนี้ กรุณาลองใหม่');
});
