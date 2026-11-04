import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { loadModule } from './test-support/load-module.mjs';

const text = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.children ? node.children.map(text).join('') : '';
const button = (renderer, label) => renderer.root.findAllByType('button').find(b => text(b).includes(label));
const response = data => ({ json: async () => ({ success: true, data }) });
async function mount(kind, fetchHistory = () => response([])) {
  const requests = [];
  const Page = loadModule(`src/app/${kind}/page.tsx`, {
    '@/components/auth/AuthProvider': { useAuth: () => ({ profile: { role: 'admin' }, user: { id: 'me' } }) },
  }, { window: { addEventListener() {}, removeEventListener() {}, fetch: async url => {
    requests.push(url);
    return url.startsWith('/api/departments') || url === '/api/documents?status=signed' || url.includes('status=delivered') ? response([]) : fetchHistory(url);
  } } }).default;
  let renderer;
  await act(async () => { renderer = create(React.createElement(Page)); });
  if (kind === 'recipient') await act(async () => { button(renderer, 'ปิดงานแล้ว').props.onClick(); });
  const history = () => requests.filter(url => url.startsWith('/api/documents') && url !== '/api/documents?status=signed' && !url.includes('status=delivered'));
  const change = async (label, value) => { await act(async () => { renderer.root.findAllByType('input').find(input => input.props['aria-label'] === label || input.props.placeholder?.includes(label)).props.onChange({ target: { value } }); }); };
  const search = async () => { await act(async () => { button(renderer, 'ค้นหา').props.onClick(); }); };
  return { renderer, history, change, search, requests };
}

for (const kind of ['tracking', 'recipient']) {
  test(`${kind}: opening history and empty searches never fetch all history`, async () => {
    const f = await mount(kind);
    try {
      assert.equal(f.history().length, 0);
      assert.match(text(f.renderer.toJSON()), /เลือกช่วงวันที่หรือระบุคำค้น/);
      await f.search();
      assert.equal(f.history().length, 0);
      await f.change('ผู้ส่ง', '  ');
      await f.search();
      assert.equal(f.history().length, 0);
    } finally { f.renderer.unmount(); }
  });
  test(`${kind}: old date ranges and department are submitted only on Search`, async () => {
    const f = await mount(kind);
    try {
      await f.change('ตั้งแต่วันที่', '2020-01-01');
      await f.change('ถึงวันที่', '2020-02-29');
      await act(async () => { f.renderer.root.findAllByType('select').find(s => s.findAllByType('option').some(o => o.props.value === '' && text(o) === 'ทุกหน่วยงาน')).props.onChange({ target: { value: 'dept' } }); });
      assert.equal(f.history().length, 0);
      await f.search();
      const query = new URL(f.history()[0], 'http://local').searchParams;
      assert.equal(query.get('date_from'), '2020-01-01');
      assert.equal(query.get('date_to'), '2020-02-29');
      assert.equal(query.get('dept_id'), 'dept');
      await f.change('ตั้งแต่วันที่', ''); await f.change('ถึงวันที่', '');
      await f.search();
      assert.equal(f.history().length, 1);
      await f.change('ผู้ส่ง', ' บริษัท ก '); await f.search();
      assert.equal(new URL(f.history()[1], 'http://local').searchParams.get('keyword'), 'บริษัท ก');
    } finally { f.renderer.unmount(); }
  });
  test(`${kind}: partial and reversed ranges show validation without network requests`, async () => {
    const f = await mount(kind);
    try {
      await f.change('ตั้งแต่วันที่', '2026-02-01'); await f.search();
      assert.equal(f.history().length, 0);
      assert.match(text(f.renderer.toJSON()), /กรุณาระบุวันที่เริ่มต้นและสิ้นสุด/);
      await f.change('ถึงวันที่', '2026-01-01'); await f.search();
      assert.equal(f.history().length, 0);
      assert.match(text(f.renderer.toJSON()), /วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด/);
    } finally { f.renderer.unmount(); }
  });
  test(`${kind}: quick ranges always send both dates`, async () => {
    const f = await mount(kind);
    try {
      for (const label of ['วันนี้', '7 วัน', 'เดือนนี้']) {
        await act(async () => { button(f.renderer, label).props.onClick(); });
        const query = new URL(f.history().at(-1), 'http://local').searchParams;
        assert.match(query.get('date_from'), /^\d{4}-\d{2}-\d{2}$/);
        assert.match(query.get('date_to'), /^\d{4}-\d{2}-\d{2}$/);
      }
    } finally { f.renderer.unmount(); }
  });
}

test('tracking status and delivery-date field are sent with bounded history search', async () => {
  const f = await mount('tracking');
  try {
    await act(async () => { button(f.renderer, 'ปิดงานแล้ว').props.onClick(); });
    assert.equal(f.history().length, 0);
    await f.search();
    assert.equal(f.history().length, 0);
    await f.change('ตั้งแต่วันที่', '2020-01-01'); await f.change('ถึงวันที่', '2020-02-29');
    await act(async () => { f.renderer.root.findByProps({ 'aria-label': 'เลือกวันที่ที่จะใช้กรอง' }).props.onChange({ target: { value: 'delivered' } }); });
    await f.search();
    const query = new URL(f.history()[0], 'http://local').searchParams;
    assert.equal(query.get('status'), 'closed');
    assert.equal(query.get('date_field'), 'delivered');
  } finally { f.renderer.unmount(); }
});

test('tracking ignores stale failures and retries the last applied search rather than an edited draft', async () => {
  let rejectOld; let calls = 0;
  const doc = { id: 'one', subject: 'จดหมาย', sender: 'บริษัท', status: 'closed', received_date: '2020-01-01' };
  const f = await mount('tracking', () => {
    calls++;
    if (calls === 1) return new Promise((resolve, reject) => { rejectOld = reject; });
    if (calls === 3) return Promise.reject(new Error('offline'));
    return response([doc]);
  });
  try {
    await f.change('ผู้ส่ง', 'old'); await f.search();
    await f.change('ผู้ส่ง', 'latest'); await f.search();
    await act(async () => { rejectOld(new Error('stale failure')); });
    assert.equal(f.renderer.root.findAllByType('tbody')[0].findAllByType('tr').length, 1);
    await f.search();
    assert.equal(f.renderer.root.findAllByType('tbody').length, 0);
    assert.match(text(f.renderer.toJSON()), /เชื่อมต่อเซิร์ฟเวอร์ไม่ได้/);
    await f.change('ผู้ส่ง', 'unsubmitted');
    await act(async () => { button(f.renderer, 'ลองใหม่').props.onClick(); });
    assert.equal(new URL(f.history().at(-1), 'http://local').searchParams.get('keyword'), 'latest');
    assert.equal(f.renderer.root.findAllByType('tbody')[0].findAllByType('tr').length, 1);
  } finally { f.renderer.unmount(); }
});

test('recipient entry still loads all pending statuses without imposing a date range', async () => {
  const f = await mount('recipient');
  try {
    const pending = f.requests.find(url => url.includes('status=delivered'));
    assert.ok(pending);
    const query = new URL(pending, 'http://local').searchParams;
    assert.deepEqual(query.getAll('status'), ['delivered', 'awaiting_inspector', 'awaiting_purchasing', 'awaiting_recipient']);
    assert.equal(query.has('date_from'), false);
    assert.equal(query.has('date_to'), false);
  } finally { f.renderer.unmount(); }
});

test('tracking global close-all stays available before history search and never opens unfiltered history', async () => {
  const requests = [];
  const doc = { id: 'one', delivery_log_id: 'log-one', status: 'signed' };
  let closed = false;
  const Page = loadModule('src/app/tracking/page.tsx', {
    '@/components/auth/AuthProvider': { useAuth: () => ({ profile: { role: 'admin' }, user: { id: 'me' } }) },
  }, { window: { confirm: () => true, fetch: async (url, options) => {
    requests.push([url, options?.method || 'GET']);
    if (url === '/api/departments') return response([]);
    if (url === '/api/documents?status=signed') return response(closed ? [] : [doc]);
    if (url === '/api/deliveries/log-one/verify' && options.method === 'PUT') { closed = true; return response(null); }
    throw new Error(`unexpected request: ${url}`);
  } } }).default;
  let renderer;
  await act(async () => { renderer = create(React.createElement(Page)); });
  try {
    assert.match(text(renderer.toJSON()), /เลือกช่วงวันที่หรือระบุคำค้น/);
    await act(async () => { await button(renderer, 'ปิดงานทั้งหมด (1)').props.onClick(); });
    assert.equal(closed, true);
    assert.deepEqual(requests.filter(([url]) => url.startsWith('/api/documents')).map(([url]) => url), [
      '/api/documents?status=signed', '/api/documents?status=signed', '/api/documents?status=signed',
    ]);
    assert.match(text(renderer.toJSON()), /ปิดงานสำเร็จ 1 รายการ/);
    assert.match(text(renderer.toJSON()), /ยังไม่ได้ค้นหาประวัติ/);
  } finally { renderer.unmount(); }
});

test('tracking status and department changes refetch only after a search has been applied', async () => {
  const f = await mount('tracking');
  const pickDept = async () => { await act(async () => { f.renderer.root.findAllByType('select').find(s => s.findAllByType('option').some(o => text(o) === 'ทุกหน่วยงาน')).props.onChange({ target: { value: 'dept' } }); }); };
  try {
    await act(async () => { button(f.renderer, 'ปิดงานแล้ว').props.onClick(); });
    await pickDept();
    assert.equal(f.history().length, 0);
    await act(async () => { button(f.renderer, 'เดือนนี้').props.onClick(); });
    await act(async () => { button(f.renderer, 'ลงนามแล้ว').props.onClick(); });
    const query = new URL(f.history().at(-1), 'http://local').searchParams;
    assert.equal(f.history().length, 2);
    assert.equal(query.get('status'), 'signed');
    assert.equal(query.get('dept_id'), 'dept');
  } finally { f.renderer.unmount(); }
});

for (const kind of ['tracking', 'recipient']) {
  test(`${kind}: short keywords need a date range so they cannot pull all history`, async () => {
    const f = await mount(kind);
    try {
      await f.change('ผู้ส่ง', ' 12 '); await f.search();
      assert.equal(f.history().length, 0);
      assert.match(text(f.renderer.toJSON()), /พิมพ์คำค้นอย่างน้อย 3 ตัวอักษร/);
      await f.change('ตั้งแต่วันที่', '2026-01-01'); await f.change('ถึงวันที่', '2026-01-31'); await f.search();
      assert.equal(new URL(f.history()[0], 'http://local').searchParams.get('keyword'), '12');
    } finally { f.renderer.unmount(); }
  });
}
