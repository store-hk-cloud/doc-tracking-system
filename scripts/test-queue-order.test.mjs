import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { loadModule } from './test-support/load-module.mjs';

// ผลจาก vm context คนละ realm — เทียบผ่าน JSON เพื่อไม่ให้ deepStrictEqual ติด prototype
const plain = (v) => JSON.parse(JSON.stringify(v));
const lib = (fetch) => loadModule('src/lib/queue-order.ts', {}, { fetch });
const noFetch = async () => { throw new Error('ไม่ควรเรียก'); };

const row = (id, orderable = true) => ({ id, orderable });
const ids = (list) => list.map((r) => r.id);
const move = (list, from, to) => lib(noFetch).moveOrderable(list, (r) => r.id, (r) => r.orderable, from, to);

test('moveOrderable moves within the orderable sub-sequence and keeps read-only rows in place', () => {
  const list = [row('a'), row('x', false), row('b'), row('c'), row('y', false), row('d')];
  assert.deepEqual(ids(move(list, 'a', 2)), ['b', 'x', 'c', 'a', 'y', 'd']);
  assert.deepEqual(ids(move(list, 'd', 0)), ['d', 'x', 'a', 'b', 'y', 'c']);
  assert.deepEqual(ids(list), ['a', 'x', 'b', 'c', 'y', 'd']);
});

test('moveOrderable returns the same array for no-op moves, clamps ends and ignores unknown or read-only ids', () => {
  const list = [row('a'), row('x', false), row('b')];
  assert.equal(move(list, 'a', 0), list);
  assert.equal(move(list, 'zzz', 0), list);
  assert.equal(move(list, 'x', 1), list);
  assert.deepEqual(ids(move(list, 'a', 99)), ['b', 'x', 'a']);
  assert.deepEqual(ids(move(list, 'b', -5)), ['b', 'x', 'a']);
});

test('dropIndexFromY maps a pointer Y to a row index and clamps outside the rows', () => {
  const rects = [{ top: 0, bottom: 40 }, { top: 40, bottom: 80 }, { top: 80, bottom: 120 }];
  const { dropIndexFromY } = lib(noFetch);
  assert.equal(dropIndexFromY(rects, -10), 0);
  assert.equal(dropIndexFromY(rects, 39), 0);
  assert.equal(dropIndexFromY(rects, 40), 1);
  assert.equal(dropIndexFromY(rects, 119), 2);
  assert.equal(dropIndexFromY(rects, 500), 2);
  assert.equal(dropIndexFromY([], 10), -1);
});

test('saveQueueOrder sends PUT with scope and ids and maps results', async () => {
  const calls = [];
  const reply = (res) => async (url, options) => { calls.push({ url, options }); return res; };
  const ok = await lib(reply({ ok: true, status: 200, json: async () => ({ success: true, data: { count: 2 } }) })).saveQueueOrder('delivery', ['a', 'b']);
  assert.deepEqual(plain(ok), { ok: true, status: 200 });
  assert.equal(calls[0].url, '/api/documents/order');
  assert.equal(calls[0].options.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[0].options.body), { scope: 'delivery', ids: ['a', 'b'] });

  const conflict = await lib(reply({ ok: false, status: 409, json: async () => ({ success: false, error: 'ลำดับเปลี่ยนแล้ว' }) })).saveQueueOrder('stage', ['a']);
  assert.deepEqual(plain(conflict), { ok: false, status: 409, error: 'ลำดับเปลี่ยนแล้ว' });

  const broken = await lib(reply({ ok: false, status: 500, json: async () => { throw new Error('not json'); } })).saveQueueOrder('stage', ['a']);
  assert.deepEqual(plain(broken), { ok: false, status: 500 });

  const network = await lib(async () => { throw new Error('offline'); }).saveQueueOrder('stage', ['a']);
  assert.deepEqual(plain(network), { ok: false, status: 0, error: 'offline' });
});

test('changedSpan returns only the range between the first and last changed position', () => {
  const { changedSpan } = lib(noFetch);
  assert.deepEqual(plain(changedSpan(['a', 'b', 'c', 'd', 'e'], ['a', 'c', 'b', 'd', 'e'])), ['c', 'b']);
  assert.deepEqual(plain(changedSpan(['a', 'b', 'c', 'd'], ['b', 'c', 'd', 'a'])), ['b', 'c', 'd', 'a']);
  assert.deepEqual(plain(changedSpan(['a', 'b'], ['a', 'b'])), []);
  // id ที่มีไม่ครบทั้งสองฝั่งไม่นับ (เช่นแถวที่เพิ่งถูกรับไประหว่างบันทึก)
  assert.deepEqual(plain(changedSpan(['a', 'b', 'c'], ['c', 'a'])), ['c', 'a']);
  assert.deepEqual(plain(changedSpan(['a', 'b', 'c'], ['a', 'c'])), []);
});

// ---- hook ----

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const ok = { ok: true, status: 200, body: { success: true } };

// responses: { ok, status, body, gate? } — gate คือ promise ที่ต้อง resolve ก่อนจึงตอบ
function setup({ enabled = true, scope = 'delivery', responses = [], list } = {}) {
  const saves = [];
  const toasts = [];
  const settled = [];
  const fetch = async (_url, options) => {
    saves.push(JSON.parse(options.body));
    const next = responses.shift() ?? ok;
    if (next.gate) await next.gate;
    return { ok: next.ok, status: next.status, json: async () => next.body };
  };
  const { useQueueReorder } = loadModule('src/lib/use-queue-reorder.ts', {}, { fetch });
  const initial = list ?? [row('a'), row('x', false), row('b'), row('c')];
  const state = { items: initial, api: null, setItems: null, freeze: null, savingAtSettle: null };
  function Probe() {
    const [items, setItems] = React.useState(initial);
    const [frozen, setFrozen] = React.useState(() => new Set());
    state.items = items;
    state.setItems = setItems;
    state.freeze = (id) => setFrozen((prev) => new Set(prev).add(id));
    state.api = useQueueReorder({
      items, setItems, getId: (r) => r.id, isOrderable: (r) => r.orderable && !frozen.has(r.id), scope, enabled,
      onSaved: (m) => toasts.push(['ok', m]),
      onError: (m) => toasts.push(['err', m]),
      onSettled: (stale) => { state.savingAtSettle = state.api.isSaving(); settled.push(stale); },
    });
    return React.createElement('div');
  }
  return { Probe, state, saves, toasts, settled, initial };
}

const key = (k) => ({ key: k, preventDefault() { this.prevented = true; } });
const rects = { a: [0, 40], x: [40, 80], b: [80, 120], c: [120, 160] };
const props = (t, id) => t.state.api.handleProps(id, id, 1);
const attachRows = (t, focused = []) => {
  for (const [id, [top, bottom]] of Object.entries(rects)) {
    t.state.api.rowProps(id).ref({ getBoundingClientRect: () => ({ top, bottom }) });
    props(t, id).ref({ focus: () => focused.push(id) });
  }
};
const mount = async (t) => {
  let r;
  await act(async () => { r = create(React.createElement(t.Probe)); });
  return r;
};
const press = (t, id, k) => act(async () => props(t, id).onKeyDown(key(k)));
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });

test('hook: ArrowDown saves the new order of all orderable rows and confirms with a toast', async () => {
  const t = setup();
  const r = await mount(t);
  const e = key('ArrowDown');
  await act(async () => props(t, 'a').onKeyDown(e));
  assert.equal(e.prevented, true);
  assert.deepEqual(ids(t.state.items), ['b', 'x', 'a', 'c']);
  assert.deepEqual(t.saves, [{ scope: 'delivery', ids: ['b', 'a', 'c'] }]);
  assert.deepEqual(t.toasts, [['ok', 'บันทึกลำดับแล้ว']]);
  assert.deepEqual(t.settled, [false]);
  assert.equal(t.state.savingAtSettle, false);
  await act(async () => r.unmount());
});

test('hook: handle label names the document and its position', async () => {
  const t = setup();
  const r = await mount(t);
  assert.equal(t.state.api.handleProps('a', '2026-11/001', 3)['aria-label'],
    'จัดลำดับเอกสาร 2026-11/001 อยู่ลำดับที่ 3 ลากหรือกดลูกศรขึ้นลงเพื่อย้ายตำแหน่ง');
  await act(async () => r.unmount());
});

test('hook: stage scope sends only the changed span, delivery scope sends every orderable row', async () => {
  const list = ['a', 'b', 'c', 'd', 'e'].map((id) => row(id));
  const stage = setup({ scope: 'stage', list });
  const r1 = await mount(stage);
  await press(stage, 'b', 'ArrowDown');
  assert.deepEqual(stage.saves, [{ scope: 'stage', ids: ['c', 'b'] }]);
  assert.deepEqual(stage.toasts, [['ok', 'บันทึกลำดับแล้ว']]);
  await act(async () => r1.unmount());

  const delivery = setup({ scope: 'delivery', list });
  const r2 = await mount(delivery);
  await press(delivery, 'b', 'ArrowDown');
  assert.deepEqual(delivery.saves, [{ scope: 'delivery', ids: ['a', 'c', 'b', 'd', 'e'] }]);
  await act(async () => r2.unmount());
});

test('hook: does not save when the order does not change', async () => {
  const t = setup();
  const r = await mount(t);
  await press(t, 'a', 'ArrowUp');
  assert.deepEqual(t.saves, []);
  assert.deepEqual(t.settled, []);
  await act(async () => r.unmount());
});

test('hook: a no-op arrow press does not leave focus pending for a later reload', async () => {
  const t = setup();
  const r = await mount(t);
  const focused = [];
  attachRows(t, focused);
  await press(t, 'a', 'ArrowUp');
  // รายการโหลดใหม่ภายหลัง (เช่นคิวรับหลายใบเสร็จ) ต้องไม่ดึงโฟกัสกลับมาที่ปุ่ม
  await act(async () => t.state.setItems((prev) => prev.slice()));
  assert.deepEqual(focused, []);
  await press(t, 'a', 'ArrowDown');
  assert.deepEqual(focused, ['a']);
  await act(async () => r.unmount());
});

test('hook: a failed save restores the confirmed order and reports the cause', async () => {
  const t = setup({ responses: [{ ok: false, status: 500, body: { success: false, error: 'db down' } }] });
  const r = await mount(t);
  await press(t, 'c', 'ArrowUp');
  assert.deepEqual(ids(t.state.items), ['a', 'x', 'b', 'c']);
  assert.deepEqual(t.toasts, [['err', 'บันทึกลำดับไม่สำเร็จ คืนลำดับเดิมแล้ว (db down)']]);
  assert.deepEqual(t.settled, [false]);
  await act(async () => r.unmount());
});

test('hook: 409 restores, asks the user to recheck and settles as stale after saving is over', async () => {
  const t = setup({ responses: [{ ok: false, status: 409, body: { success: false, error: 'stale' } }] });
  const r = await mount(t);
  await press(t, 'a', 'ArrowDown');
  assert.deepEqual(t.settled, [true]);
  assert.equal(t.state.savingAtSettle, false);
  assert.deepEqual(ids(t.state.items), ['a', 'x', 'b', 'c']);
  assert.equal(t.toasts[0][0], 'err');
  assert.match(t.toasts[0][1], /ตรวจสอบ/);
  await act(async () => r.unmount());
});

test('hook: round 1 succeeds then round 2 fails with 500 falls back to the round 1 order', async () => {
  const gate = deferred();
  const t = setup({ responses: [{ ...ok, gate: gate.promise }, { ok: false, status: 500, body: { success: false, error: 'x' } }] });
  const r = await mount(t);
  await press(t, 'a', 'ArrowDown');
  await press(t, 'b', 'ArrowDown');
  assert.equal(t.state.api.isSaving(), true);
  gate.resolve();
  await tick();
  assert.deepEqual(ids(t.state.items), ['b', 'x', 'a', 'c']);
  assert.equal(t.state.api.isSaving(), false);
  assert.deepEqual(t.toasts.map(([kind]) => kind), ['err']);
  assert.deepEqual(t.settled, [false]);
  await act(async () => r.unmount());
});

test('hook: round 1 succeeds then round 2 gets 409 settles as stale', async () => {
  const gate = deferred();
  const t = setup({ responses: [{ ...ok, gate: gate.promise }, { ok: false, status: 409, body: { success: false } }] });
  const r = await mount(t);
  await press(t, 'a', 'ArrowDown');
  await press(t, 'a', 'ArrowDown');
  gate.resolve();
  await tick();
  assert.deepEqual(t.settled, [true]);
  assert.equal(t.state.savingAtSettle, false);
  await act(async () => r.unmount());
});

test('hook: still reports success when the orderable set changes while a save is in flight', async () => {
  const gate = deferred();
  const t = setup({ responses: [{ ...ok, gate: gate.promise }] });
  const r = await mount(t);
  await press(t, 'a', 'ArrowDown');
  // แถว b ถูกรับไประหว่างที่ PUT ค้าง: ชุดที่จัดได้เปลี่ยนจาก [b,a,c] เป็น [a,c]
  await act(async () => t.state.freeze('b'));
  gate.resolve();
  await tick();
  assert.deepEqual(t.toasts, [['ok', 'บันทึกลำดับแล้ว']]);
  assert.deepEqual(t.settled, [false]);
  assert.equal(t.state.api.isSaving(), false);
  await act(async () => r.unmount());
});

test('hook: disabled ignores keys and pointer drags', async () => {
  const t = setup({ enabled: false });
  const r = await mount(t);
  const p = props(t, 'a');
  assert.equal(p.disabled, true);
  await act(async () => p.onKeyDown(key('ArrowDown')));
  await act(async () => p.onPointerDown({ button: 0, pointerId: 1, currentTarget: { setPointerCapture() {} } }));
  assert.equal(t.state.api.rowProps('a').className, undefined);
  assert.deepEqual(t.saves, []);
  await act(async () => r.unmount());
});

test('hook: pointer drag shows the drop indicator and commits the same order on release', async () => {
  const t = setup();
  const r = await mount(t);
  attachRows(t);
  const captured = [];
  const target = { setPointerCapture: (id) => captured.push(id) };
  await act(async () => props(t, 'a').onPointerDown({ button: 0, pointerId: 7, currentTarget: target }));
  assert.deepEqual(captured, [7]);
  assert.equal(t.state.api.rowProps('a').className, 'row-dragging');
  await act(async () => props(t, 'a').onPointerMove({ clientY: 150 }));
  assert.equal(t.state.api.rowProps('c').className, 'row-drop-below');
  await act(async () => props(t, 'a').onPointerUp({ clientY: 150 }));
  assert.deepEqual(ids(t.state.items), ['b', 'x', 'c', 'a']);
  assert.deepEqual(t.saves, [{ scope: 'delivery', ids: ['b', 'c', 'a'] }]);
  assert.equal(t.state.api.rowProps('a').className, undefined);
  await act(async () => r.unmount());
});

for (const event of ['onPointerCancel', 'onLostPointerCapture']) {
  test(`hook: ${event} drops the drag without saving and later pointer events do nothing`, async () => {
    const t = setup();
    const r = await mount(t);
    attachRows(t);
    await act(async () => props(t, 'b').onPointerDown({ button: 0, pointerId: 1, currentTarget: { setPointerCapture() {} } }));
    assert.equal(t.state.api.rowProps('b').className, 'row-dragging');
    // ถือ handler ชุดเดิมไว้เหมือนเบราว์เซอร์ที่ยังส่ง event ตามมาหลังยกเลิก
    const stale = props(t, 'b');
    await act(async () => stale[event]());
    assert.equal(t.state.api.rowProps('b').className, undefined);
    await act(async () => stale.onPointerMove({ clientY: 10 }));
    await act(async () => stale.onPointerUp({ clientY: 10 }));
    assert.equal(t.state.api.rowProps('a').className, undefined);
    assert.deepEqual(t.saves, []);
    await act(async () => r.unmount());
  });
}
