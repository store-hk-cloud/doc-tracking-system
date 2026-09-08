import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { loadModule } from './test-support/load-module.mjs';

const profile = { role: 'user', department_id: 'accounting', department_code: '0-ADM03', full_name: 'ผู้รับทดสอบ' };
const docs = Array.from({ length: 6 }, (_, i) => ({
  id: `recipient-${i}`, document_id: `document-${i}`, sender: 'ผู้ส่งเดียวกัน', subject: 'ใบรับสินค้า',
  recipient_dept_id: 'accounting', recipient_dept_name: 'บัญชี', status: 'closed',
  received_date: '2026-09-08', display_no: `2026-09/00${i + 1}`,
  recipient_signed_at: '2026-09-08T01:00:00Z',
}));
const response = (data, success = true) => ({ json: async () => ({ success, data, error: success ? undefined : 'โหลดไม่สำเร็จ' }) });
const text = (node) => typeof node === 'string' ? node : Array.isArray(node)
  ? node.map(text).join('') : node?.children ? node.children.map(text).join('') : '';
const button = (renderer, label) => renderer.root.findAllByType('button').find((b) => text(b).includes(label));

async function mount(fetchClosed) {
  const Page = loadModule('src/app/recipient/page.tsx', {
    '@/components/auth/AuthProvider': { useAuth: () => ({ profile }) },
  }, { window: { fetch: async (url) => url.includes('status=closed')
    ? fetchClosed(url) : response([]) } }).default;
  let renderer;
  await act(async () => { renderer = create(React.createElement(Page)); });
  await act(async () => { button(renderer, 'ปิดงานแล้ว').props.onClick(); });
  return renderer;
}

test('six signed documents from one sender render as six individual rows and a count of six', async () => {
  const renderer = await mount(() => response(docs));
  try {
    assert.match(text(renderer.toJSON()), /ปิดงานล่าสุดอยู่บนสุด · 6 รายการ/);
    assert.equal(renderer.root.findAllByType('tbody')[0].findAllByType('tr').length, 6);
  } finally { renderer.unmount(); }
});

test('late one-document response cannot overwrite the latest six-document result', async () => {
  let finishOld; let calls = 0;
  const renderer = await mount(() => ++calls === 1
    ? new Promise((resolve) => { finishOld = resolve; }) : response(docs));
  try {
    await act(async () => { button(renderer, 'ทั้งหมด').props.onClick(); });
    await act(async () => { finishOld(response([docs[0]])); });
    assert.match(text(renderer.toJSON()), /ปิดงานล่าสุดอยู่บนสุด · 6 รายการ/);
  } finally { renderer.unmount(); }
});

test('failed search clears previous results and shows an error instead of a stale count', async () => {
  let calls = 0;
  const renderer = await mount(() => response(docs, ++calls === 1));
  try {
    await act(async () => { button(renderer, 'ทั้งหมด').props.onClick(); });
    assert.doesNotMatch(text(renderer.toJSON()), /ปิดงานล่าสุดอยู่บนสุด · 6 รายการ/);
    assert.match(text(renderer.toJSON()), /โหลดไม่สำเร็จ/);
  } finally { renderer.unmount(); }
});
