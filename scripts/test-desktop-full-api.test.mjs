import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';

let handle;
let directory;
const originalFetch = globalThis.fetch;
let respond;
const origin = 'https://fixture.supabase.co';
const desktop = 'app://desktop';
const actorId = '51ace195-5d61-4d48-9645-90de9890a232';
const batchId = 'a1ace195-5d61-4d48-9645-90de9890a233';
const updated = '2026-11-10T12:32:00Z';

before(async () => {
  const { buildDesktopApi } = await import('../desktop/full-api/build.mjs');
  directory = await mkdtemp(join(tmpdir(), 'desktop-api-test-'));
  const outfile = join(directory, 'index.mjs');
  await buildDesktopApi(outfile);
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = origin;
  process.env.SUPABASE_PUBLISHABLE_KEYS = '{"default":"sb_publishable_fixture"}';
  process.env.SUPABASE_SECRET_KEYS = '{"default":"sb_secret_fixture"}';
  process.env.GOOGLE_SHEETS_SYNC_MODE = 'apps_script';
  globalThis.fetch = async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    const headers = new Headers(init?.headers);
    const token = headers.get('Authorization');
    if (pathname === '/auth/v1/user') {
      assert.equal(headers.get('apikey'), 'sb_publishable_fixture');
      const id = token?.startsWith('Bearer user-') ? token.slice(12) : '';
      return id ? Response.json({ id }) : Response.json({ message: 'invalid JWT' }, { status: 401 });
    }
    return respond({ pathname, searchParams, headers, token, init });
  };
  ({ handleRequest: handle } = await import(pathToFileURL(outfile).href));
});

after(async () => {
  globalThis.fetch = originalFetch;
  if (directory) await rm(directory, { recursive: true, force: true });
});

function request(path, { token, site = desktop, method = 'GET', body } = {}) {
  const headers = new Headers(site ? { Origin: site } : undefined);
  if (token) headers.set('Authorization', 'Bearer ' + token);
  if (body) headers.set('Content-Type', 'application/json');
  return new Request(origin + '/functions/v1/desktop-api/api/' + path, {
    method, headers, body: body && JSON.stringify(body),
  });
}

function mockSupabase(handler) {
  respond = handler;
}

test('desktop CORS only permits the app origin and hides maintenance endpoints', async () => {
  mockSupabase(() => assert.fail('no API access'));
  const allowed = await handle(request('documents', { method: 'OPTIONS' }));
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), desktop);
  assert.match(allowed.headers.get('access-control-allow-headers'), /authorization/i);
  const blocked = await handle(request('documents', { site: 'https://example.com', method: 'OPTIONS' }));
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  for (const path of ['setup', 'setup-admin', 'cron/overdue-documents', 'profiles/id%2Fpassword', 'documents/constructor/unknown']) {
    assert.equal((await handle(request(path, { token: 'user-' + actorId }))).status, 404);
  }
});

test('bearer verification is required before handlers and username POST is public', async () => {
  mockSupabase(() => assert.fail('no API access'));
  assert.equal((await handle(request('profile'))).status, 401);
  assert.equal((await handle(request('profile', { token: 'forged' }))).status, 401);
  assert.equal((await handle(request('auth/resolve-username'))).status, 405);
  const malformed = await handle(request('auth/resolve-username', { method: 'POST', body: { username: '?' } }));
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).success, false);
});

test('receipt queue preserves the batch id and uses caller authorization for authenticated RPCs', async () => {
  mockSupabase(({ pathname, token, init }) => {
    assert.equal(token, 'Bearer user-' + actorId);
    if (pathname === '/rest/v1/rpc/list_desktop_receipt_batches') return Response.json([]);
    assert.equal(pathname, '/rest/v1/rpc/enqueue_desktop_receipts');
    assert.deepEqual(JSON.parse(init.body), {
      p_batch_id: batchId, p_signature_name: 'พนักงาน',
      p_items: [{ recipientId: actorId, expectedUpdatedAt: updated }],
    });
    return Response.json({ id: batchId });
  });
  const token = 'user-' + actorId;
  const list = await handle(request('deliveries/queue', { token }));
  assert.equal(list.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await list.json(), { success: true, data: [] });
  const payload = { batch_id: batchId, signature: ' พนักงาน ', items: [{ recipient_id: actorId, expected_updated_at: updated }] };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await handle(request('deliveries/queue', { token, method: 'POST', body: payload }));
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { success: true, data: { id: batchId } });
  }
  const invalid = await handle(request('deliveries/queue', { token, method: 'POST', body: { ...payload, items: [] } }));
  assert.equal(invalid.status, 400);
});

test('spreadsheet routes retain their super_admin authorization and Apps Script workflow', async () => {
  mockSupabase(({ pathname, searchParams, headers }) => {
    assert.equal(headers.get('apikey'), 'sb_secret_fixture');
    if (pathname === '/rest/v1/profiles') {
      const id = searchParams.get('id').slice(3);
      return Response.json({ id, role: id === actorId ? 'super_admin' : 'admin', is_active: true });
    }
    assert.equal(pathname, '/rest/v1/rpc/enqueue_all_apps_script_sheet_jobs');
    return Response.json(4);
  });
  const token = 'user-' + actorId;
  const [denied, allowed] = await Promise.all([
    handle(request('setup-sheets', { token: 'user-other' })),
    handle(request('setup-sheets', { token })),
  ]);
  assert.equal(denied.status, 403);
  assert.equal(allowed.status, 200);
  assert.match((await allowed.json()).spreadsheetUrl, /^https:\/\/docs\.google\.com\/spreadsheets\//);
  const backfill = await handle(request('admin/backfill-sheets', { token, method: 'POST' }));
  assert.equal(backfill.status, 202);
  assert.deepEqual(await backfill.json(), { success: true, queued: 4 });
});

test('dynamic verify route forwards the decoded id and retains the original RPC error', async () => {
  mockSupabase(({ pathname, init }) => {
    if (pathname === '/rest/v1/profiles') {
      return Response.json({ id: actorId, role: 'admin', is_active: true });
    }
    assert.equal(pathname, '/rest/v1/rpc/verify_document_delivery');
    assert.equal(JSON.parse(init.body).p_delivery_id, actorId);
    return Response.json({ message: 'delivery_already_verified', code: 'P0001' }, { status: 400 });
  });
  const escapedId = '%35' + actorId.slice(1);
  const response = await handle(request('deliveries/' + escapedId + '/verify', {
    token: 'user-' + actorId, method: 'PUT',
  }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { success: false, error: 'Delivery is already verified' });
});
