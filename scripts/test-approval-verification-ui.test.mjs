import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { loadModule } from './test-support/load-module.mjs';

const text = (node) => JSON.stringify(node.toJSON());
for (const mode of ['direct', 'popup']) {
  for (const stage of ['inspector', 'purchasing']) {
    for (const accepted of [false, true]) {
      test(`${mode} ${stage} validates rejection reason and submits ${accepted}`, async () => {
        const doc = { id: 'one', subject: 'ใบรับสินค้า', status: `awaiting_${stage}` };
        const profile = { full_name: 'ผู้ลงชื่อ', department_code: stage === 'inspector' ? '0-ADM04' : '0-BSN10' };
        const requests = [];
        const read = async (url, options) => {
          if (options) { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ success: true, data: { ...doc, status: 'rejected', rejection_stage: stage, rejection_note: 'ผิดจำนวน' } }) }; }
          return { json: async () => ({ success: true, data: url.startsWith('/api/departments') || url.startsWith('/api/deliveries') ? [] : mode === 'direct' ? doc : [doc] }) };
        };
        const Page = loadModule(mode === 'direct' ? 'src/app/recipient/[docId]/page.tsx' : 'src/app/recipient/page.tsx', {
          '@/components/auth/AuthProvider': { useAuth: () => ({ profile }) },
          'next/navigation': { useParams: () => ({ docId: 'one' }) },
        }, { window: { fetch: read }, fetch: read }).default;
        let renderer;
        await act(async () => { renderer = create(React.createElement(Page)); });
        try {
          if (mode === 'popup') await act(async () => { renderer.root.findByProps({ className: 'table-action-button' }).props.onClick(); });
          const submit = () => mode === 'popup' ? renderer.root.findAllByType('form')[0].props.onSubmit({ preventDefault() {} }) : renderer.root.findAllByType('button').find((b) => typeof b.props.disabled === 'boolean' && b.props.className === 'secondary-button').props.onClick();
          if (!accepted) {
            const reject = renderer.root.findAllByType('button').find((b) => b.children.includes('❌ ไม่ถูกต้อง'));
            assert.ok(reject, 'approval stage offers rejection');
            await act(async () => { reject.props.onClick(); });
            await act(async () => { await submit(); });
            assert.equal(requests.length, 0, 'blank rejection reason sends no request');
            await act(async () => { renderer.root.findByType('textarea').props.onChange({ target: { value: '  ผิดจำนวน  ' } }); });
          }
          await act(async () => { await submit(); });
          assert.deepEqual(requests[0], { [`${stage}_signature`]: 'ผู้ลงชื่อ', is_verified: accepted, verification_note: accepted ? null : 'ผิดจำนวน' });
          if (!accepted && mode === 'direct') assert.match(text(renderer), new RegExp(stage === 'inspector' ? 'ผู้ตรวจสอบ' : 'จัดซื้อ'));
        } finally { renderer.unmount(); }
      });
    }
  }
}
for (const mode of ['direct', 'popup']) {
  for (const stage of ['inspector', 'purchasing']) {
    test(`${mode} ${stage} name edit keeps accepted result`, async () => {
      const doc = { id: 'one', subject: 'ใบรับสินค้า', status: stage === 'inspector' ? 'awaiting_purchasing' : 'awaiting_recipient', [`${stage}_signature`]: 'ชื่อเดิม' };
      const profile = { full_name: 'ผู้ลงชื่อ', department_code: stage === 'inspector' ? '0-ADM04' : '0-BSN10' };
      const requests = [];
      const read = async (url, options) => {
        if (options) { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ success: true, data: doc }) }; }
        return { json: async () => ({ success: true, data: url.startsWith('/api/departments') || url.startsWith('/api/deliveries') ? [] : mode === 'direct' ? doc : [doc] }) };
      };
      const Page = loadModule(mode === 'direct' ? 'src/app/recipient/[docId]/page.tsx' : 'src/app/recipient/page.tsx', {
        '@/components/auth/AuthProvider': { useAuth: () => ({ profile }) }, 'next/navigation': { useParams: () => ({ docId: 'one' }) },
      }, { window: { fetch: read }, fetch: read }).default;
      let renderer;
      await act(async () => { renderer = create(React.createElement(Page)); });
      try {
        if (mode === 'popup') await act(async () => { renderer.root.findByProps({ className: 'table-action-button' }).props.onClick(); });
        assert.equal(renderer.root.findAllByType('button').filter((b) => b.children.includes('❌ ไม่ถูกต้อง')).length, 0);
        if (mode === 'direct') await act(async () => { renderer.root.findAllByType('button').find((b) => b.children.includes('✏️ แก้ไข')).props.onClick(); });
        await act(async () => { renderer.root.findByProps({ id: mode === 'direct' ? 'recipient-signature' : 'single-sign-signature' }).props.onChange({ target: { value: 'ชื่อใหม่' } }); });
        await act(async () => {
          if (mode === 'popup') renderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
          else await renderer.root.findAllByType('button').find((b) => typeof b.props.disabled === 'boolean' && b.props.className === 'secondary-button').props.onClick();
        });
        assert.deepEqual(requests[0], { [`${stage}_signature`]: 'ชื่อใหม่', is_verified: true, verification_note: null });
      } finally { renderer.unmount(); }
    });
    if (mode === 'popup') test(`bulk ${stage} submits accepted only`, async () => {
      const requests = [];
      const doc = { id: 'one', subject: 'ใบรับสินค้า', status: `awaiting_${stage}` };
      const Page = loadModule('src/app/recipient/page.tsx', {
        '@/components/auth/AuthProvider': { useAuth: () => ({ profile: { full_name: 'ผู้ลงชื่อ', department_code: stage === 'inspector' ? '0-ADM04' : '0-BSN10' } }) },
      }, { window: { fetch: async (url, options) => {
        if (options) { requests.push(JSON.parse(options.body)); return { json: async () => ({ success: true }) }; }
        return { json: async () => ({ success: true, data: url.startsWith('/api/departments') ? [] : [doc] }) };
      } } }).default;
      let renderer;
      await act(async () => { renderer = create(React.createElement(Page)); });
      try {
        await act(async () => { renderer.root.findAllByType('input').find((b) => b.props.type === 'checkbox').props.onChange(); });
        const bulk = renderer.root.findAllByType('button').find((b) => b.children.some((c) => typeof c === 'string' && c.includes('ลงนาม')) && b.props.onClick);
        assert.ok(bulk);
        await act(async () => { bulk.props.onClick(); });
        assert.equal(renderer.root.findAllByType('textarea').length, 0);
        await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
        assert.deepEqual(requests[0], { [`${stage}_signature`]: 'ผู้ลงชื่อ', is_verified: true, verification_note: null });
      } finally { renderer.unmount(); }
    });
  }
}
for (const stage of ['inspector', 'purchasing', 'recipient']) {
  test(`direct rejected ${stage} shows current reason rather than old delivery`, async () => {
    const doc = { id: 'one', subject: 'ใบรับสินค้า', status: 'rejected', rejection_stage: stage, rejection_note: stage === 'recipient' ? null : 'เหตุผลรอบปัจจุบัน' };
    const Page = loadModule('src/app/recipient/[docId]/page.tsx', {
      '@/components/auth/AuthProvider': { useAuth: () => ({ profile: {} }) }, 'next/navigation': { useParams: () => ({ docId: 'one' }) },
    }, { window: { fetch: async (url) => ({ json: async () => ({ success: true, data: url.startsWith('/api/deliveries') ? [{ recipient_signature: 'ผู้รับเก่า', recipient_signed_at: '2026-01-01', verification_note: 'เหตุผลผู้รับ' }] : doc }) }) } }).default;
    let renderer;
    await act(async () => { renderer = create(React.createElement(Page)); });
    try {
      assert.match(text(renderer), new RegExp(stage === 'inspector' ? 'ผู้ตรวจสอบ' : stage === 'purchasing' ? 'จัดซื้อ' : 'ผู้รับเอกสาร'));
      assert.match(text(renderer), new RegExp(stage === 'recipient' ? 'เหตุผลผู้รับ' : 'เหตุผลรอบปัจจุบัน'));
      if (stage !== 'recipient') assert.doesNotMatch(text(renderer), /ลงชื่อรับเมื่อ|เหตุผลผู้รับ|ผู้รับเก่า/);
    } finally { renderer.unmount(); }
  });
}
for (const stage of ['inspector', 'purchasing']) {
  test(`tracking ${stage} rejection displays current origin and hides stale recipient`, async () => {
    const doc = { id: 'one', subject: 'ใบรับสินค้า', status: 'rejected', rejection_stage: stage, rejection_note: 'เหตุผลรอบปัจจุบัน', recipient_signature: 'ลายเซ็นผู้รับเก่า', recipient_verification_note: 'เหตุผลผู้รับเก่า' };
    const Page = loadModule('src/app/tracking/page.tsx', {
      '@/components/auth/AuthProvider': { useAuth: () => ({ profile: { role: 'user' }, user: {} }) },
    }, { window: { addEventListener() {}, removeEventListener() {}, fetch: async (url) => ({ json: async () => ({ success: true, data: url.startsWith('/api/departments') ? [] : [doc] }) }) } }).default;
    let renderer;
    await act(async () => { renderer = create(React.createElement(Page)); });
    try {
      await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes('เดือนนี้')).props.onClick(); });
      await act(async () => { renderer.root.findAllByType('tr').find((row) => row.props.role === 'button').props.onClick(); });
      assert.match(text(renderer), new RegExp(stage === 'inspector' ? 'ผู้ตรวจสอบ' : 'จัดซื้อ'));
      assert.match(text(renderer), /เหตุผลรอบปัจจุบัน/);
      assert.doesNotMatch(text(renderer), /ลายเซ็นผู้รับเก่า|เหตุผลผู้รับเก่า/);
    } finally { renderer.unmount(); }
  });
}
for (const mode of ['direct', 'tracking']) {
  for (const stage of ['inspector', 'purchasing']) {
    for (const ownNote of [null, 'เหตุผลของด่านปัจจุบัน']) {
      test(`${mode} ${stage} missing derived note never uses stale recipient note (${ownNote !== null})`, async () => {
        const doc = { id: 'one', subject: 'ใบรับสินค้า', status: 'rejected', rejection_stage: stage, rejection_note: null, [`${stage}_verification_note`]: ownNote, recipient_verification_note: 'เหตุผลผู้รับรอบเก่า' };
        const Page = loadModule(mode === 'direct' ? 'src/app/recipient/[docId]/page.tsx' : 'src/app/tracking/page.tsx', {
          '@/components/auth/AuthProvider': { useAuth: () => ({ profile: { role: 'user' }, user: {} }) },
          'next/navigation': { useParams: () => ({ docId: 'one' }) },
        }, { window: { addEventListener() {}, removeEventListener() {}, fetch: async (url) => ({ json: async () => ({ success: true, data: url.startsWith('/api/departments') ? [] : url.startsWith('/api/deliveries') ? [{ verification_note: 'เหตุผลจาก delivery เก่า' }] : mode === 'direct' ? doc : [doc] }) }) } }).default;
        let renderer;
        await act(async () => { renderer = create(React.createElement(Page)); });
        try {
          if (mode === 'tracking') await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes('เดือนนี้')).props.onClick(); });
          if (mode === 'tracking') await act(async () => { renderer.root.findAllByType('tr').find((row) => row.props.role === 'button').props.onClick(); });
          assert.match(text(renderer), new RegExp(ownNote || 'ไม่ได้ระบุเหตุผล'));
          assert.doesNotMatch(text(renderer), /เหตุผลผู้รับรอบเก่า|เหตุผลจาก delivery เก่า/);
        } finally { renderer.unmount(); }
      });
    }
  }
}
test('tracking redelivery reloads reset row before reopening details', async () => {
  const old = { id: 'one', subject: 'ใบรับสินค้า', status: 'rejected', rejection_stage: 'purchasing', rejection_note: 'เหตุผลรอบเก่า', inspector_signature: 'ผู้ตรวจสอบรอบเก่า', purchasing_signature: 'จัดซื้อรอบเก่า', purchasing_verified: false, recipient_signature: 'ผู้รับรอบเก่า', recipient_signed_at: '2026-01-01', recipient_verification_note: 'เหตุผลผู้รับรอบเก่า', delivery_log_id: 'old-log' };
  const reset = { id: 'one', subject: 'ใบรับสินค้า', status: 'awaiting_inspector', rejection_stage: null, rejection_note: null, inspector_signature: null, purchasing_signature: null, purchasing_verified: null, recipient_signature: null, recipient_signed_at: null, recipient_verification_note: null, delivery_log_id: null };
  let redelivered = false;
  const Page = loadModule('src/app/tracking/page.tsx', {
    '@/components/auth/AuthProvider': { useAuth: () => ({ profile: { role: 'admin' }, user: {} }) },
  }, { window: { confirm: () => true, alert: (message) => { throw new Error(message); }, addEventListener() {}, removeEventListener() {}, fetch: async (url, options) => {
    if (options) { assert.match(url, /one\/redeliver$/); redelivered = true; return { json: async () => ({ success: true, data: reset }) }; }
    return { json: async () => ({ success: true, data: url.startsWith('/api/departments') || url.includes('status=signed') ? [] : [redelivered ? reset : old] }) };
  } } }).default;
  let renderer;
  await act(async () => { renderer = create(React.createElement(Page)); });
  const open = async () => { await act(async () => { renderer.root.findAllByType('tr').find((row) => row.props.role === 'button').props.onClick(); }); };
  try {
    await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes('เดือนนี้')).props.onClick(); });
    await open();
    assert.match(text(renderer), /เหตุผลรอบเก่า/);
    await act(async () => { await renderer.root.findAllByType('button').find((button) => button.children.includes('📮 ส่งเซ็นใหม่')).props.onClick(); });
    await open();
    assert.match(text(renderer), /รอผู้ตรวจสอบ/);
    assert.doesNotMatch(text(renderer), /ผู้ตรวจสอบรอบเก่า|จัดซื้อรอบเก่า|ผู้รับรอบเก่า|เหตุผลรอบเก่า|เหตุผลผู้รับรอบเก่า/);
    assert.equal(renderer.root.findAllByType('button').filter((button) => button.children.includes('📮 ส่งเซ็นใหม่')).length, 0);
  } finally { renderer.unmount(); }
});
