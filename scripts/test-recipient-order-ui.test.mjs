import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { loadModule } from './test-support/load-module.mjs';

const stamp = '2026-11-10T05:30:00+00:00';
const makeDoc = (id, no, dept, extra = {}) => ({
  id, display_no: `2026-11/${no}`, subject: `เรื่อง ${no}`, sender: 'ผู้ส่ง', status: 'delivered',
  recipient_dept_id: dept, recipient_updated_at: stamp, admin_signed_at: '2026-11-09T01:00:00Z', ...extra,
});
// r2 เป็นของหน่วยงานอื่น (ดูอย่างเดียว) แทรกอยู่กลางลำดับ
const baseDocs = () => [makeDoc('r1', '001', 'acc'), makeDoc('r2', '002', 'other'), makeDoc('r3', '003', 'acc'), makeDoc('r4', '004', 'acc')];

async function setup({ docs = baseDocs(), queue = { batches: [] }, put = async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }) } = {}) {
  const calls = [];
  const puts = [];
  const posts = [];
  let renderer;
  const listeners = new Set();
  const document = { visibilityState: 'visible', addEventListener: (_t, fn) => listeners.add(fn), removeEventListener: (_t, fn) => listeners.delete(fn) };
  const fetch = async (url, options) => {
    if (options?.method === 'PUT' && url === '/api/documents/order') {
      puts.push(JSON.parse(options.body));
      return put(puts.length);
    }
    if (options?.method === 'POST') {
      posts.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 202, json: async () => ({ success: true, data: { id: 'batch-id', created_at: stamp, items: JSON.parse(options.body).items.map((i) => ({ ...i, status: 'queued', error: null })) } }) };
    }
    calls.push(url);
    if (url === '/api/deliveries/queue') return { ok: true, json: async () => ({ success: true, data: queue.batches }) };
    if (url.startsWith('/api/documents')) return { ok: true, json: async () => ({ success: true, data: docs }) };
    return { ok: true, json: async () => ({ success: true, data: [] }) };
  };
  const Page = loadModule('src/app/recipient/page.tsx', {
    '@/components/auth/AuthProvider': { useAuth: () => ({ user: { id: 'actor' }, profile: { full_name: 'ผู้รับ', department_id: 'acc' } }) },
  }, { window: { fetch, crypto: { randomUUID: () => 'batch-id' } }, fetch, document, AbortController }).default;
  const rowIds = () => renderer.root.findAll((n) => typeof n.type === 'string' && n.props['data-row-id']).map((n) => n.props['data-row-id']);
  const createNodeMock = (element) => ({
    focus() {},
    getBoundingClientRect() {
      const i = rowIds().indexOf(element.props['data-row-id']);
      return { top: i * 40, bottom: i * 40 + 40 };
    },
  });
  await act(async () => { renderer = create(React.createElement(Page), { createNodeMock }); });
  return { renderer, calls, puts, posts, rowIds, listeners };
}

const handles = (r) => r.root.findAll((n) => typeof n.type === 'string' && n.type === 'button' && String(n.props.className).includes('drag-handle'));
const orderNumbers = (r) => r.root.findAll((n) => n.type === 'span' && n.props.className === 'queue-order-no').map((n) => n.children.join(''));
const handleOf = (r, id) => {
  const row = r.root.find((n) => typeof n.type === 'string' && n.props['data-row-id'] === id);
  return row.findAll((n) => n.type === 'button' && String(n.props.className).includes('drag-handle'))[0];
};
const sleepTick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const text = (r) => JSON.stringify(r.toJSON());

test('queue fetch asks the server for queue order and only own-stage rows get a handle and number', async () => {
  const { renderer, calls, rowIds } = await setup();
  try {
    assert.ok(calls.some((url) => url.startsWith('/api/documents?') && url.includes('order=queue') && !url.includes('limit=')));
    assert.deepEqual(rowIds(), ['r1', 'r2', 'r3', 'r4']);
    assert.equal(handles(renderer).length, 3);
    assert.deepEqual(orderNumbers(renderer), ['1', '2', '3']);
    assert.equal(handleOf(renderer, 'r2'), undefined);
    assert.equal(handleOf(renderer, 'r1').props['aria-label'], 'จัดลำดับเอกสาร 2026-11/001 อยู่ลำดับที่ 1 ลากหรือกดลูกศรขึ้นลงเพื่อย้ายตำแหน่ง');
    assert.equal(handleOf(renderer, 'r3').props['aria-label'], 'จัดลำดับเอกสาร 2026-11/003 อยู่ลำดับที่ 2 ลากหรือกดลูกศรขึ้นลงเพื่อย้ายตำแหน่ง');
    const viewOnlyRow = renderer.root.find((n) => n.props['data-row-id'] === 'r2' && typeof n.type === 'string');
    assert.equal(viewOnlyRow.findAllByType('td')[0].children.join(''), '-');
  } finally { await act(async () => renderer.unmount()); }
});

test('ArrowDown saves only the changed span of orderable ids and shows a success toast', async () => {
  const { renderer, puts, rowIds } = await setup();
  try {
    await act(async () => handleOf(renderer, 'r1').props.onKeyDown({ key: 'ArrowDown', preventDefault() {} }));
    await sleepTick();
    assert.deepEqual(puts, [{ scope: 'stage', ids: ['r3', 'r1'] }]);
    // แถวดูอย่างเดียวอยู่ตำแหน่งเดิม
    assert.deepEqual(rowIds(), ['r3', 'r2', 'r1', 'r4']);
    assert.deepEqual(orderNumbers(renderer), ['1', '2', '3']);
    assert.match(text(renderer), /บันทึกลำดับแล้ว/);
  } finally { await act(async () => renderer.unmount()); }
});

test('pointer drag produces the same order as the keyboard', async () => {
  const { renderer, puts, rowIds } = await setup();
  try {
    const handle = handleOf(renderer, 'r1');
    const target = { setPointerCapture() {} };
    await act(async () => handle.props.onPointerDown({ button: 0, pointerId: 1, clientY: 20, currentTarget: target }));
    await act(async () => handleOf(renderer, 'r1').props.onPointerMove({ clientY: 150 }));
    await act(async () => handleOf(renderer, 'r1').props.onPointerUp({ clientY: 150 }));
    await sleepTick();
    assert.deepEqual(puts, [{ scope: 'stage', ids: ['r3', 'r4', 'r1'] }]);
    assert.deepEqual(rowIds(), ['r3', 'r2', 'r4', 'r1']);
  } finally { await act(async () => renderer.unmount()); }
});

test('a failed save restores the previous order and shows an error toast', async () => {
  const { renderer, rowIds } = await setup({ put: async () => ({ ok: false, status: 500, json: async () => ({ success: false, error: 'boom' }) }) });
  try {
    await act(async () => handleOf(renderer, 'r1').props.onKeyDown({ key: 'ArrowDown', preventDefault() {} }));
    await sleepTick();
    assert.deepEqual(rowIds(), ['r1', 'r2', 'r3', 'r4']);
    assert.deepEqual(orderNumbers(renderer), ['1', '2', '3']);
    assert.match(text(renderer), /บันทึกลำดับไม่สำเร็จ/);
    assert.ok(renderer.root.findAll((n) => typeof n.type === 'string' && String(n.props.className).includes('toast error')).length > 0);
  } finally { await act(async () => renderer.unmount()); }
});

test('a 409 conflict reloads the queue', async () => {
  const { renderer, calls } = await setup({ put: async () => ({ ok: false, status: 409, json: async () => ({ success: false }) }) });
  try {
    const before = calls.filter((url) => url.startsWith('/api/documents?')).length;
    await act(async () => handleOf(renderer, 'r1').props.onKeyDown({ key: 'ArrowDown', preventDefault() {} }));
    await sleepTick();
    assert.equal(calls.filter((url) => url.startsWith('/api/documents?')).length, before + 1);
    assert.match(text(renderer), /โหลดรายการล่าสุด/);
  } finally { await act(async () => renderer.unmount()); }
});

test('any filter disables the handles and keeps the order numbers stable', async () => {
  const { renderer, puts } = await setup();
  try {
    const search = renderer.root.findAllByType('input').find((n) => String(n.props.placeholder).startsWith('ค้นหา'));
    await act(async () => search.props.onChange({ target: { value: '004' } }));
    assert.deepEqual(handles(renderer).map((h) => h.props.disabled), [true]);
    assert.equal(handles(renderer)[0].props.title, 'ล้างตัวกรองก่อนจึงจะจัดลำดับได้');
    assert.deepEqual(orderNumbers(renderer), ['3']);
    await act(async () => handles(renderer)[0].props.onKeyDown({ key: 'ArrowUp', preventDefault() {} }));
    await act(async () => search.props.onChange({ target: { value: '' } }));

    const stage = renderer.root.findByType('select');
    await act(async () => stage.props.onChange({ target: { value: 'delivered' } }));
    assert.ok(handles(renderer).every((h) => h.props.disabled));
    await act(async () => stage.props.onChange({ target: { value: '' } }));

    const date = renderer.root.findAllByType('input').find((n) => n.props.type === 'date');
    await act(async () => date.props.onChange({ target: { value: '2026-11-09' } }));
    assert.ok(handles(renderer).every((h) => h.props.disabled));
    await act(async () => date.props.onChange({ target: { value: '' } }));
    assert.ok(handles(renderer).every((h) => !h.props.disabled));
    assert.deepEqual(puts, []);
  } finally { await act(async () => renderer.unmount()); }
});

test('select-all and bulk sign keep the original payload after reordering', async () => {
  const docs = [makeDoc('r1', '001', 'acc'), makeDoc('r3', '003', 'acc')];
  const { renderer, posts, rowIds } = await setup({ docs });
  try {
    await act(async () => handleOf(renderer, 'r1').props.onKeyDown({ key: 'ArrowDown', preventDefault() {} }));
    await sleepTick();
    assert.deepEqual(rowIds(), ['r3', 'r1']);
    await act(async () => renderer.root.findByProps({ 'aria-label': 'เลือกทุกรายการที่เป็นงานของคุณ' }).props.onChange());
    const button = renderer.root.findAllByType('button').find((node) => node.children.some((t) => typeof t === 'string' && t.includes('ลงนาม')));
    await act(async () => button.props.onClick());
    assert.match(text(renderer), /ลงนาม 2 รายการ/);
    assert.equal(renderer.root.findAllByProps({ 'aria-label': 'เลือกเอกสารเลขที่ 2026-11/001' })[0].props.checked, true);
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.deepEqual(posts.map((p) => p.url), ['/api/deliveries/queue']);
    assert.deepEqual(posts[0].body.items, [
      { recipient_id: 'r3', expected_updated_at: stamp },
      { recipient_id: 'r1', expected_updated_at: stamp },
    ]);
  } finally { await act(async () => renderer.unmount()); }
});

test('closed tab table has no drag handle', async () => {
  const { renderer } = await setup();
  try {
    const closedTab = renderer.root.findAllByType('button').find((n) => n.children.includes('ปิดงานแล้ว'));
    await act(async () => closedTab.props.onClick());
    assert.equal(handles(renderer).length, 0);
    assert.doesNotMatch(text(renderer), /⠿/);
  } finally { await act(async () => renderer.unmount()); }
});

// ---- บันทึกซ้อนกับการโหลดคิวใหม่ ----

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
const arrow = (r, id) => act(async () => handleOf(r, id).props.onKeyDown({ key: 'ArrowDown', preventDefault() {} }));
const acc3 = () => [makeDoc('r1', '001', 'acc'), makeDoc('r3', '003', 'acc'), makeDoc('r4', '004', 'acc')];
// rq ไม่อยู่ในรายการ ใช้แค่ให้คิวมีงาน queued อยู่ (ใบที่อยู่ในคิวจะจัดลำดับไม่ได้ จึงไม่ใช้ใบจริง)
const queuedBatch = (status, recipients = ['rq']) => [{ id: 'b', created_at: stamp, items: recipients.map((recipient_id) => ({ recipient_id, expected_updated_at: stamp, status, document_no: null, error: null })) }];
const pendingLoads = (calls) => calls.filter((url) => url.startsWith('/api/documents?')).length;
const serverRows = (docs, ids) => docs.splice(0, docs.length, ...ids.map((id) => makeDoc(id, id.slice(1).padStart(3, '0'), 'acc')));
// คิวหลายใบเปลี่ยนจาก queued เป็นเสร็จ ซึ่งหน้าตอบสนองด้วยการโหลดคิวเอกสารใหม่
const finishQueue = async (t, queue, status, recipients) => {
  queue.batches = queuedBatch(status, recipients);
  await act(async () => { for (const listener of [...t.listeners]) listener(); });
  await tick();
};

test('round 1 saves then round 2 gets 409: the latest server queue replaces the list', async () => {
  const docs = acc3();
  const gates = [deferred(), deferred()];
  const t = await setup({ docs, put: async (n) => {
    await gates[n - 1].promise;
    if (n === 2) { serverRows(docs, ['r4', 'r1', 'r3']); return { ok: false, status: 409, json: async () => ({ success: false }) }; }
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  } });
  try {
    await arrow(t.renderer, 'r1');
    await arrow(t.renderer, 'r1');
    gates[0].resolve(); await tick();
    gates[1].resolve(); await tick(); await tick();
    assert.deepEqual(t.rowIds(), ['r4', 'r1', 'r3']);
    assert.match(text(t.renderer), /โหลดรายการล่าสุด/);
  } finally { await act(async () => t.renderer.unmount()); }
});

test('round 1 saves then round 2 fails with 500: falls back to round 1 and runs the reload skipped meanwhile', async () => {
  const docs = acc3();
  const queue = { batches: queuedBatch('queued') };
  const gates = [deferred(), deferred()];
  const t = await setup({ docs, queue, put: async (n) => {
    await gates[n - 1].promise;
    return n === 2 ? { ok: false, status: 500, json: async () => ({ success: false, error: 'x' }) } : { ok: true, status: 200, json: async () => ({ success: true }) };
  } });
  try {
    await tick();
    await arrow(t.renderer, 'r1');
    await arrow(t.renderer, 'r1');
    await finishQueue(t, queue, 'failed');
    const loadsBefore = pendingLoads(t.calls);
    gates[0].resolve(); await tick();
    serverRows(docs, ['r3', 'r1', 'r4']);
    gates[1].resolve(); await tick(); await tick();
    assert.deepEqual(t.rowIds(), ['r3', 'r1', 'r4']);
    assert.equal(pendingLoads(t.calls), loadsBefore + 1);
    assert.match(text(t.renderer), /บันทึกลำดับไม่สำเร็จ/);
  } finally { await act(async () => t.renderer.unmount()); }
});

test('a reload that lands during a pending save does not overwrite the dragged order and runs after the save', async () => {
  const docs = acc3();
  const queue = { batches: queuedBatch('queued') };
  const gate = deferred();
  const t = await setup({ docs, queue, put: async () => { await gate.promise; return { ok: true, status: 200, json: async () => ({ success: true }) }; } });
  try {
    await tick();
    await arrow(t.renderer, 'r1');
    const loadsBefore = pendingLoads(t.calls);
    await finishQueue(t, queue, 'failed');
    assert.equal(pendingLoads(t.calls), loadsBefore + 1);
    assert.deepEqual(t.rowIds(), ['r3', 'r1', 'r4']);
    assert.equal(t.puts.length, 1);
    serverRows(docs, ['r3', 'r1', 'r4']);
    gate.resolve(); await tick(); await tick();
    assert.equal(t.puts.length, 1);
    assert.equal(pendingLoads(t.calls), loadsBefore + 2);
    assert.deepEqual(t.rowIds(), ['r3', 'r1', 'r4']);
    assert.match(text(t.renderer), /บันทึกลำดับแล้ว/);
  } finally { await act(async () => t.renderer.unmount()); }
});

test('the success toast still shows when a row stops being orderable while the save is in flight', async () => {
  const docs = acc3();
  const queue = { batches: queuedBatch('queued') };
  const gate = deferred();
  const t = await setup({ docs, queue, put: async () => { await gate.promise; return { ok: true, status: 200, json: async () => ({ success: true }) }; } });
  try {
    await tick();
    await arrow(t.renderer, 'r1');
    // r4 ถูกรับสำเร็จจากคิวหลายใบ จึงหลุดจากชุดที่จัดได้ระหว่างที่ PUT ค้าง
    await finishQueue(t, queue, 'succeeded', ['rq', 'r4']);
    gate.resolve(); await tick(); await tick();
    assert.match(text(t.renderer), /บันทึกลำดับแล้ว/);
    assert.equal(t.puts.length, 1);
  } finally { await act(async () => t.renderer.unmount()); }
});
