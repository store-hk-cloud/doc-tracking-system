import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { loadModule } from './test-support/load-module.mjs';

for (const action of ['recipient', 'inspector']) {
  for (const failure of ['network', 'invalid-json']) {
    test(`${action} submission recovers from ${failure} and allows retry`, async () => {
      const profile = { full_name: 'ผู้ลงชื่อ', department_code: action === 'inspector' ? '0-ADM04' : '0-ADM03' };
      const doc = { subject: 'ใบรับสินค้า', status: action === 'inspector' ? 'awaiting_inspector' : 'awaiting_recipient' };
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
