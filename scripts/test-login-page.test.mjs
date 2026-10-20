import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { loadModule } from './test-support/load-module.mjs';

function button(renderer, label) {
  return renderer.root.findAllByType('button').find((item) => item.children.includes(label));
}

test('username mode delegates both credentials to the opaque username-login flow', async () => {
  const attempts = [];
  const Page = loadModule('src/app/page.tsx', {
    'next/image': () => null,
    '@/components/auth/AuthProvider': {
      useAuth: () => ({
        signIn: () => assert.fail('username mode must not call email login directly'),
        signInWithUsername: async (username, password) => {
          attempts.push({ username, password });
          return null;
        },
      }),
    },
  }, {
    fetch: () => assert.fail('username mode must not resolve an email in the browser'),
  }).default;
  let renderer;
  try {
    await act(async () => { renderer = create(React.createElement(Page)); });
    await act(async () => { button(renderer, 'ชื่อผู้ใช้').props.onClick(); });

    const username = renderer.root.findByProps({ id: 'login-username' });
    const password = renderer.root.findByProps({ id: 'login-password' });
    await act(async () => { username.props.onChange({ target: { value: 'messenger_01' } }); });
    await act(async () => { password.props.onChange({ target: { value: 'correct-password' } }); });
    await act(async () => {
      await renderer.root.findByType('form').props.onSubmit({ preventDefault() {} });
    });

    assert.deepEqual(attempts, [{ username: 'messenger_01', password: 'correct-password' }]);
  } finally { renderer?.unmount(); }
});
