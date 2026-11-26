import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { loadModule } from './test-support/load-module.mjs';

const makeDocs = () => [1, 2, 3].map(i => ({ id: `r${i}`, display_no: `2026-11/00${i}`, subject: `เรื่อง ${i}`, sender: 'ผู้ส่ง', status: 'registered', received_date: '2026-11-20', recipient_dept_name: 'บัญชี' }));

async function mount({ putResponses = [] } = {}) {
  let docs = makeDocs();
  const calls = [];
  const fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url, method, body: options.body ? JSON.parse(options.body) : undefined });
    if (url === '/api/documents/order') {
      const next = putResponses.shift() ?? { ok: true, status: 200, body: { success: true } };
      if (next.gate) await next.gate;
      return { ok: next.ok, status: next.status, json: async () => next.body };
    }
    if (method === 'PUT') return { ok: true, status: 200, json: async () => ({ success: true }) };
    return { ok: true, status: 200, json: async () => ({ success: true, data: docs }) };
  };
  const rects = { r1: [0, 40], r2: [40, 80], r3: [80, 120] };
  const createNodeMock = (element) => {
    const id = element.props?.['data-row-id'];
    return id ? { getBoundingClientRect: () => ({ top: rects[id][0], bottom: rects[id][1] }) } : { focus() {} };
  };
  const Page = loadModule('src/app/delivery/page.tsx', {}, { fetch, window: { confirm: () => true } }).default;
  let renderer;
  await act(async () => { renderer = create(React.createElement(Page), { createNodeMock }); });
  const handles = () => renderer.root.findAll(n => n.type === 'button' && n.props.className === 'drag-handle');
  const numbers = () => renderer.root.findAllByProps({ className: 'queue-order-no' }).map(n => n.children.join(''));
  const docNos = () => renderer.root.findAll(n => n.type === 'td' && n.props.className === 'code-cell').map(n => n.children.join(''));
  const toast = () => renderer.root.findAll(n => n.type === 'div' && /^toast /.test(n.props.className || '')).map(n => `${n.props.className}|${n.children.join('')}`);
  const puts = () => calls.filter(c => c.url === '/api/documents/order');
  const setServerOrder = (order) => { docs = order.map((id) => makeDocs().find((d) => d.id === id)); };
  return { renderer, calls, handles, numbers, docNos, toast, puts, setServerOrder };
}

const arrow = (key) => ({ key, preventDefault() {} });

test('delivery page loads in saved queue order and shows a handle and position number per row', async () => {
  const t = await mount();
  try {
    assert.equal(t.calls[0].url, '/api/documents?status=registered&scope=mine&order=queue');
    assert.deepEqual(t.numbers(), ['1', '2', '3']);
    assert.equal(t.handles().length, 3);
    assert.match(t.handles()[0].props['aria-label'], /จัดลำดับเอกสาร 2026-11\/001 อยู่ลำดับที่ 1/);
    assert.equal(t.handles()[0].props.disabled, false);
  } finally { await act(async () => t.renderer.unmount()); }
});

test('ArrowDown saves the new delivery order, shows a success toast and renumbers rows', async () => {
  const t = await mount();
  try {
    await act(async () => t.handles()[0].props.onKeyDown(arrow('ArrowDown')));
    assert.deepEqual(t.puts().map(c => [c.method, c.body]), [['PUT', { scope: 'delivery', ids: ['r2', 'r1', 'r3'] }]]);
    assert.deepEqual(t.docNos(), ['2026-11/002', '2026-11/001', '2026-11/003']);
    assert.deepEqual(t.numbers(), ['1', '2', '3']);
    assert.deepEqual(t.toast(), ['toast success|บันทึกลำดับแล้ว']);
  } finally { await act(async () => t.renderer.unmount()); }
});

test('pointer drag saves the same order as the keyboard move', async () => {
  const t = await mount();
  try {
    const h = () => t.handles()[0].props;
    await act(async () => h().onPointerDown({ button: 0, pointerId: 1, currentTarget: { setPointerCapture() {} } }));
    await act(async () => t.handles()[0].props.onPointerMove({ clientY: 110 }));
    await act(async () => t.handles()[0].props.onPointerUp({ clientY: 110 }));
    assert.deepEqual(t.puts().map(c => c.body), [{ scope: 'delivery', ids: ['r2', 'r3', 'r1'] }]);
    assert.deepEqual(t.docNos(), ['2026-11/002', '2026-11/003', '2026-11/001']);
  } finally { await act(async () => t.renderer.unmount()); }
});

test('a failed save restores the previous order and shows an error toast', async () => {
  const t = await mount({ putResponses: [{ ok: false, status: 500, body: { success: false, error: 'db down' } }] });
  try {
    await act(async () => t.handles()[0].props.onKeyDown(arrow('ArrowDown')));
    assert.deepEqual(t.docNos(), ['2026-11/001', '2026-11/002', '2026-11/003']);
    assert.deepEqual(t.toast(), ['toast error|บันทึกลำดับไม่สำเร็จ คืนลำดับเดิมแล้ว (db down)']);
  } finally { await act(async () => t.renderer.unmount()); }
});

test('a 409 conflict reloads the list from the server', async () => {
  const t = await mount({ putResponses: [{ ok: false, status: 409, body: { success: false, error: 'stale' } }] });
  try {
    const before = t.calls.filter(c => c.url.startsWith('/api/documents?')).length;
    await act(async () => t.handles()[0].props.onKeyDown(arrow('ArrowDown')));
    assert.equal(t.calls.filter(c => c.url.startsWith('/api/documents?')).length, before + 1);
    assert.match(t.toast()[0], /^toast error\|.*ตรวจสอบ/);
  } finally { await act(async () => t.renderer.unmount()); }
});

test('selected rows stay selected by id after reordering and bulk sign sends the same ids', async () => {
  const t = await mount();
  try {
    const checkbox = (id) => t.renderer.root.findAll(n => n.type === 'input' && n.props.type === 'checkbox')
      .filter(n => n.props.onChange && n.props.checked !== undefined)[id];
    // index 0 คือ checkbox เลือกทั้งหมด
    await act(async () => checkbox(1).props.onChange());
    await act(async () => checkbox(3).props.onChange());
    await act(async () => t.handles()[0].props.onKeyDown(arrow('ArrowDown')));
    assert.deepEqual(t.docNos(), ['2026-11/002', '2026-11/001', '2026-11/003']);
    // r1 และ r3 ยังถูกเลือกแม้ r1 ย้ายแถว
    assert.deepEqual([1, 2, 3].map(i => checkbox(i).props.checked), [false, true, true]);

    const clickText = (text) => t.renderer.root.findAllByType('button').find(b => b.children.some(c => typeof c === 'string' && c.includes(text)));
    await act(async () => clickText('ส่งมอบทั้งหมด').props.onClick());
    await act(async () => t.renderer.root.findAll(n => n.type === 'input' && n.props.placeholder === 'พิมพ์ชื่อผู้ส่งมอบ')[0].props.onChange({ target: { value: 'แอดมิน' } }));
    await act(async () => clickText('ยืนยัน').props.onClick());
    const signed = t.calls.filter(c => c.method === 'PUT' && c.url.endsWith('/sign')).map(c => c.url).sort();
    assert.deepEqual(signed, ['/api/documents/r1/sign', '/api/documents/r3/sign']);
  } finally { await act(async () => t.renderer.unmount()); }
});

test('a reload that lands while the order is being saved is deferred, then runs once the save is over', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const t = await mount({ putResponses: [{ ok: true, status: 200, body: { success: true }, gate }] });
  const loads = () => t.calls.filter(c => c.url.startsWith('/api/documents?')).length;
  const click = (text) => t.renderer.root.findAllByType('button').find(b => b.children.some(c => typeof c === 'string' && c.includes(text)));
  try {
    await act(async () => t.handles()[0].props.onKeyDown(arrow('ArrowDown')));
    assert.deepEqual(t.docNos(), ['2026-11/002', '2026-11/001', '2026-11/003']);
    // ส่งมอบใบ r3 ระหว่างที่ PUT ลำดับค้าง ซึ่งโหลดรายการใหม่ทันทีและได้ลำดับเก่ากลับมา
    t.setServerOrder(['r1', 'r2']);
    const before = loads();
    await act(async () => t.renderer.root.findAllByProps({ className: 'table-action-button' })[2].props.onClick());
    await act(async () => t.renderer.root.findAll(n => n.type === 'input' && n.props.placeholder === 'พิมพ์ชื่อผู้ส่งมอบ')[0].props.onChange({ target: { value: 'แอดมิน' } }));
    await act(async () => click('ยืนยันส่งมอบ').props.onClick());
    assert.equal(loads(), before + 1);
    assert.deepEqual(t.docNos(), ['2026-11/002', '2026-11/001', '2026-11/003']);
    assert.equal(t.puts().length, 1);

    t.setServerOrder(['r2', 'r1']);
    release();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    assert.equal(loads(), before + 2);
    assert.equal(t.puts().length, 1);
    assert.deepEqual(t.docNos(), ['2026-11/002', '2026-11/001']);
  } finally { await act(async () => t.renderer.unmount()); }
});
