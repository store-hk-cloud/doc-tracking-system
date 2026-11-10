import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { loadModule } from './test-support/load-module.mjs';

test('bulk receipts submit one durable batch and show completion only after the queue confirms it', async () => {
  const stamp = '2026-11-10T05:30:00.123456+00:00';
  const docs = [1, 2].map(i => ({ id: `recipient-${i}`, display_no: `2026-11/00${i}`, subject: 'จดหมาย', status: 'delivered', recipient_dept_id: 'acc', recipient_updated_at: stamp }));
  const batch = { id: 'batch-id', created_at: stamp, items: docs.map(doc => ({ recipient_id: doc.id, expected_updated_at: stamp, document_no: doc.display_no, status: 'queued', error: null })) };
  let history = [];
  const writes = [];
  const listeners = new Set();
  const document = { visibilityState: 'visible', addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); } };
  const fetch = async (url, options) => {
    if (options?.method === 'POST') {
      writes.push({ url, body: JSON.parse(options.body) });
      history = [batch];
      return { ok: true, status: 202, json: async () => ({ success: true, data: batch }) };
    }
    return { ok: true, json: async () => ({ success: true, data: url === '/api/deliveries/queue' ? history : url.startsWith('/api/documents') ? docs : [] }) };
  };
  const Page = loadModule('src/app/recipient/page.tsx', {
    '@/components/auth/AuthProvider': { useAuth: () => ({ user: { id: 'actor' }, profile: { full_name: 'ผู้รับ', department_id: 'acc' } }) },
  }, { window: { fetch, crypto: { randomUUID: () => 'batch-id' } }, fetch, document, AbortController }).default;

  let renderer;
  await act(async () => { renderer = create(React.createElement(Page)); });
  try {
    await act(async () => renderer.root.findByProps({ 'aria-label': 'เลือกทุกรายการที่เป็นงานของคุณ' }).props.onChange());
    const button = renderer.root.findAllByType('button').find(node => node.children.some(text => typeof text === 'string' && text.includes('ลงนาม')));
    await act(async () => button.props.onClick());
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.deepEqual(writes, [{ url: '/api/deliveries/queue', body: { batch_id: 'batch-id', signature: 'ผู้รับ', items: docs.map(doc => ({ recipient_id: doc.id, expected_updated_at: stamp })) } }]);
    assert.match(JSON.stringify(renderer.toJSON()), /รอบันทึก|เข้าคิว/);
    assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /รับสำเร็จ 2 ใบ/);
    history = [{ ...batch, items: [{ ...batch.items[0], status: 'succeeded' }, batch.items[1]] }];
    await act(async () => { for (const listener of [...listeners]) listener(); });
    assert.match(JSON.stringify(renderer.toJSON()), /รอบันทึก 1 ใบ · รับสำเร็จ 1 ใบ/);
    assert.equal(renderer.root.findAllByProps({ 'aria-label': 'เลือกเอกสารเลขที่ 2026-11/001' }).length, 0);
    history = [{ ...batch, items: batch.items.map(item => ({ ...item, status: 'succeeded' })) }];
    await act(async () => { for (const listener of [...listeners]) listener(); });
    assert.match(JSON.stringify(renderer.toJSON()), /รับสำเร็จ 2 ใบ/);
    await act(async () => renderer.unmount());
    await act(async () => { renderer = create(React.createElement(Page)); });
    assert.match(JSON.stringify(renderer.toJSON()), /รับสำเร็จ 2 ใบ/);
  } finally { await act(async () => renderer.unmount()); }
});
