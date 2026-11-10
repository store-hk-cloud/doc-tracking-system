import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const moduleUrl = (file) => new URL('../desktop/full-ui/' + file, import.meta.url);
const supabaseOrigin = 'https://example.supabase.co';
const publicKey = 'sb_publishable_example';
const location = 'app://desktop/messenger/run/pickup';

test('desktop build bundles all shared pages and local fonts and icons', async () => {
  const { buildFullUi } = await import(moduleUrl('build.mjs'));
  const outdir = await mkdtemp(join(tmpdir(), 'doc-tracking-full-'));
  try {
    const { routes } = await buildFullUi({ outdir, supabaseOrigin, publicKey, webOrigin: 'https://documents.example' });
    assert.equal(routes.length, 23);
    assert.ok(!routes.includes('/desktop/connect'));
    const script = await readFile(join(outdir, 'app.js'), 'utf8');
    assert.ok(script.includes('https://documents.example'));
    assert.ok(script.includes('/functions/v1/desktop-device-auth'));
    assert.ok(routes.includes('/messenger/[jobId]/pickup'));
    assert.ok(routes.includes('/finance/variances/[reportId]'));
    const html = await readFile(join(outdir, 'index.html'), 'utf8');
    assert.match(html, /src="\/app\.js"/);
    assert.match(html, /href="\/app\.css"/);
    assert.doesNotMatch(html, /(?:src|href)="https?:/);
    const css = await readFile(join(outdir, 'app.css'), 'utf8');
    assert.match(css, /\.sidebar-item/);
    assert.match(css, /\.desktop-download\s*\{\s*display:\s*none/);
    assert.match(css, /@font-face/);
    assert.ok((await readdir(join(outdir, 'fonts'))).some((file) => file.endsWith('.woff2')));
    assert.ok((await readdir(join(outdir, 'icons'))).includes('hillkoff-emblem.png'));
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
});

test('static pages win over dynamic segments and deep links decode parameters', async () => {
  const { matchRoute } = await import(moduleUrl('routes.mjs'));
  const routes = ['/messenger/[jobId]', '/messenger/new', '/messenger/[jobId]/pickup'];
  assert.deepEqual(matchRoute(routes, '/messenger/new'), { route: '/messenger/new', params: {} });
  assert.deepEqual(matchRoute(routes, '/messenger/test%20id/pickup/'), {
    route: '/messenger/[jobId]/pickup', params: { jobId: 'test id' },
  });
  assert.equal(matchRoute(routes, '/messenger/%zz'), null);
  assert.equal(matchRoute(routes, '/unknown'), null);
});

test('same-origin API requests preserve upload bodies, search, cache and signal and reject redirects', async () => {
  const { createApiFetch } = await import(moduleUrl('api-fetch.mjs'));
  const controller = new AbortController();
  const form = new FormData();
  form.append('photo', new Blob(['receipt'], { type: 'image/png' }), 'receipt.png');
  const apiFetch = createApiFetch({
    location, supabaseOrigin, publicKey, getAccessToken: async () => 'user-token',
    fetch: async (request) => {
      assert.equal(request.url, supabaseOrigin + '/functions/v1/desktop-api/api/upload-to-drive?photo=1');
      assert.equal(request.method, 'POST');
      assert.equal(request.cache, 'no-store');
      assert.equal(request.redirect, 'error');
      assert.equal(request.credentials, 'omit');
      assert.equal(request.headers.get('authorization'), 'Bearer user-token');
      assert.equal(request.headers.get('apikey'), publicKey);
      assert.equal((await (await request.formData()).get('photo').text()), 'receipt');
      controller.abort();
      assert.equal(request.signal.aborted, true);
      return new Response('ok');
    },
  });
  assert.equal(await (await apiFetch('/api/upload-to-drive?photo=1', {
    method: 'POST', body: form, signal: controller.signal, cache: 'no-store',
  })).text(), 'ok');
});

test('external URLs pass through and username login omits session credentials', async () => {
  const { createApiFetch } = await import(moduleUrl('api-fetch.mjs'));
  const external = 'https://external.example/api/profile';
  const fetchCalls = [];
  const apiFetch = createApiFetch({
    location, supabaseOrigin, publicKey, getAccessToken: () => assert.fail('session read'),
    fetch: async (...args) => { fetchCalls.push(args); return new Response('ok'); },
  });
  const options = { cache: 'no-store' };
  await apiFetch(external, options);
  await apiFetch(new Request('app://desktop/api/auth/resolve-username', {
    method: 'POST', body: '{"username":"example"}', headers: { authorization: 'caller-token' },
  }));
  assert.deepEqual(fetchCalls[0], [external, options]);
  const [request] = fetchCalls[1];
  assert.equal(request.headers.get('authorization'), null);
  assert.equal(request.headers.get('apikey'), publicKey);
  assert.equal(await request.text(), '{"username":"example"}');
});

test('desktop Sheets links open only trusted spreadsheet URLs and surface backfill result', async () => {
  const { runSheetsAction } = await import(moduleUrl('sheets.mjs'));
  const spreadsheetUrl = 'https://docs.google.com/spreadsheets/d/sheet_1/edit';
  const opened = [];
  const setup = (url) => runSheetsAction('/api/setup-sheets', {
    fetch: async () => Response.json({ success: true, spreadsheetUrl: url }),
    open: (target) => opened.push(target),
  });
  await setup(spreadsheetUrl);
  assert.deepEqual(opened, [spreadsheetUrl]);
  await assert.rejects(setup('https://docs.google.com.evil.test/spreadsheets/d/sheet_1/edit'));
  const result = await runSheetsAction('/api/admin/backfill-sheets', {
    fetch: async (path, options) => {
      assert.equal(path, '/api/admin/backfill-sheets');
      assert.equal(options.method, 'POST');
      return Response.json({ success: true, queued: 7 }, { status: 202 });
    },
  });
  assert.match(result, /7/);
});

test('desktop auth storage uses the protected bridge and falls back to memory', async () => {
  const { createSessionStorage } = await import(moduleUrl('session-storage.mjs'));
  const bridge = { getItem() {}, setItem() {}, removeItem() {} };
  assert.equal(createSessionStorage(bridge), bridge);
  const storage = createSessionStorage();
  await storage.setItem('key', 'session');
  assert.equal(await storage.getItem('key'), 'session');
  assert.equal(await createSessionStorage().getItem('key'), null);
  await storage.removeItem('key');
  assert.equal(await storage.getItem('key'), null);
});

test('desktop SSO sets the shared session only after browser approval and ignores cancelled attempts', async () => {
  const { completeDeviceLogin } = await import(moduleUrl('device-login.mjs'));
  const origin = 'https://documents.example';
  const approvalUrl = origin + '/desktop/connect?challenge=' + 'a'.repeat(64);
  const tokens = { access_token: 'access', refresh_token: 'refresh' };
  const events = [];
  const options = {
    origin, supabaseUrl: supabaseOrigin, publicKey,
    openBrowser: (url) => events.push(['open', url]),
    onCode: (code) => events.push(['code', code]),
    signal: new AbortController().signal,
    startDeviceLogin: async ({ openBrowser, onCode }) => {
      onCode('0123-ABCD');
      openBrowser(approvalUrl);
      return tokens;
    },
    setSession: async (session) => { events.push(['session', session]); return { error: null }; },
  };
  await completeDeviceLogin(options);
  assert.deepEqual(events, [['code', '0123-ABCD'], ['open', approvalUrl], ['session', tokens]]);
  await assert.rejects(completeDeviceLogin({
    ...options,
    startDeviceLogin: async ({ openBrowser }) => openBrowser('https://external.example/desktop/connect'),
  }));
  const aborter = new AbortController();
  await assert.rejects(completeDeviceLogin({
    ...options,
    signal: aborter.signal,
    startDeviceLogin: async () => { aborter.abort(); return tokens; },
    setSession: () => assert.fail('cancelled attempts must not set the session'),
  }), { name: 'AbortError' });
});

test('desktop logout clears the stored session when Supabase returns a 5xx error', async () => {
  const { createSessionStorage, signOutDesktop } = await import(moduleUrl('session-storage.mjs'));
  const storage = createSessionStorage();
  const storageKey = 'sb-example-auth-token';
  const keys = [storageKey, storageKey + '-code-verifier', storageKey + '-user'];
  for (const key of keys) await storage.setItem(key, 'test-only');
  const error = Object.assign(new Error('Service unavailable'), { status: 503 });
  const result = await signOutDesktop({
    storage, storageKey,
    signOut: async (options) => {
      assert.deepEqual(options, { scope: 'local' });
      return { error };
    },
  });
  assert.equal(result.error, error);
  assert.deepEqual(await Promise.all(keys.map((key) => storage.getItem(key))), [null, null, null]);
});
