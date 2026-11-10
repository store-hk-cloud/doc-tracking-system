import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { loadModule } from './test-support/load-module.mjs';

for (const action of ['recipient', 'inspector', 'purchasing']) {
  for (const failure of ['network', 'invalid-json']) {
    test(`${action} submission recovers from ${failure} and allows retry`, async () => {
      const profile = { full_name: 'ผู้ลงชื่อ', department_code: action === 'inspector' ? '0-ADM04' : action === 'purchasing' ? '0-BSN10' : '0-ADM03' };
      const doc = { subject: 'ใบรับสินค้า', status: action === 'recipient' ? 'awaiting_recipient' : `awaiting_${action}` };
      const Page = loadModule('src/app/recipient/[docId]/page.tsx', {
        '@/components/auth/AuthProvider': { useAuth: () => ({ profile }) },
        'next/navigation': { useParams: () => ({ docId: 'recipient-1' }) },
      }, {
        window: { fetch: async (url) => ({ json: async () => ({ success: true, data: url.startsWith('/api/deliveries') ? [] : doc }) }) },
        fetch: async () => {
          if (failure === 'network') throw new Error('network disconnected');
          return { ok: false, status: 502, json: async () => { throw new SyntaxError('invalid JSON'); } };
        },
      }).default;
      let renderer;
      await act(async () => { renderer = create(React.createElement(Page)); });
      try {
        const submit = () => renderer.root.findAllByType('button').find((node) => typeof node.props.disabled === 'boolean' && node.props.className === 'secondary-button');
        await act(async () => { await submit().props.onClick(); });
        assert.equal(submit().props.disabled, false);
        assert.equal(renderer.root.findAll((node) => node.props.className === 'toast error').length, 1);
      } finally { renderer.unmount(); }
    });
  }
}

for (const mode of ['direct', 'popup', 'bulk']) {
  test(`${mode} receipt recovers a committed 503 using the server recipient version`, async () => {
    const baseline = '2026-11-10T02:40:00Z';
    const doc = { id: 'recipient-1', subject: 'ใบรับสินค้า', status: 'awaiting_recipient', updated_at: mode === 'direct' ? baseline : '2026-11-11T00:00:00Z', recipient_updated_at: baseline };
    const calls = [];
    let committed = false;
    const read = async (url, options) => {
      if (options?.method === 'POST') {
        calls.push('POST'); committed = true;
        assert.equal(JSON.parse(options.body).recipient_signature, 'ผู้ลงชื่อ');
        return Response.json({ error: 'upstream' }, { status: 503 });
      }
      if (url === '/api/deliveries/queue') return Response.json({ success: true, data: [] });
      if (url.startsWith('/api/deliveries')) {
        if (options?.method === 'GET') calls.push('GET');
        return Response.json({ success: true, data: committed ? [{ document_recipient_id: 'recipient-1', recipient_id: 'actor', recipient_signature: 'ผู้ลงชื่อ', is_verified: true, verification_note: null, recipient_signed_at: '2026-11-10T02:49:55Z', document_recipients: { id: 'recipient-1', status: 'closed' } }] : [] });
      }
      return Response.json({ success: true, data: url.startsWith('/api/departments') ? [] : mode === 'direct' ? doc : committed ? [] : [doc] });
    };
    const Page = loadModule(mode === 'direct' ? 'src/app/recipient/[docId]/page.tsx' : 'src/app/recipient/page.tsx', {
      '@/components/auth/AuthProvider': { useAuth: () => ({ user: { id: 'actor' }, profile: { full_name: 'ผู้ลงชื่อ', department_code: '0-ADM03' } }) },
      'next/navigation': { useParams: () => ({ docId: 'recipient-1' }) },
    }, { window: { fetch: read }, fetch: read, AbortController, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } }).default;
    let renderer;
    await act(async () => { renderer = create(React.createElement(Page)); });
    try {
      if (mode === 'popup') await act(async () => { renderer.root.findByProps({ className: 'table-action-button' }).props.onClick(); });
      if (mode === 'bulk') {
        await act(async () => { renderer.root.findAllByType('input').find((b) => b.props.type === 'checkbox').props.onChange(); });
        await act(async () => { renderer.root.findAllByType('button').find((b) => b.children.some((c) => typeof c === 'string' && c.includes('ลงนาม')) && b.props.onClick).props.onClick(); });
      }
      await act(async () => {
        if (mode === 'direct') await renderer.root.findAllByType('button').find((b) => typeof b.props.disabled === 'boolean' && b.props.className === 'secondary-button').props.onClick();
        else await renderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
      });
      assert.deepEqual(calls, ['POST', 'GET']);
      assert.match(JSON.stringify(renderer.toJSON()), mode === 'direct' ? /รับเอกสารเรียบร้อย/ : mode === 'bulk' ? /ลงนามสำเร็จ 1 รายการ/ : /ลงชื่อรับเลขที่/);
      assert.equal(renderer.root.findAll((node) => node.props.className === 'toast error').length, 0);
    } finally { renderer.unmount(); }
  });
}
