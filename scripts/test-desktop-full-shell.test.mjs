import assert from 'node:assert/strict';
import test from 'node:test';
import { allowExternal, assetFor, sessionKey } from '../desktop/full-policy.cjs';

const config = { webOrigin: 'https://web.example', supabaseOrigin: 'https://project.supabase.co' };

test('desktop local routing never serves traversal or API paths as application assets', () => {
  assert.equal(assetFor('app://desktop/recipient/123'), 'index.html');
  assert.equal(assetFor('app://desktop/app.js'), 'app.js');
  assert.equal(assetFor('app://desktop/fonts/kanit.woff2'), 'fonts/kanit.woff2');
  assert.equal(assetFor('app://desktop/api/profile'), null);
  assert.equal(assetFor('app://desktop/icons/a%2Fb.png'), null);
  assert.equal(assetFor('app://wrong/app.js'), null);
});

test('desktop only opens browser pairing and known attachment URLs', () => {
  assert.equal(allowExternal('https://web.example/desktop/connect?challenge=' + 'a'.repeat(43), config), true);
  assert.equal(allowExternal('https://web.example/recipient', config), false);
  assert.equal(allowExternal('https://web.example.evil/desktop/connect', config), false);
  assert.equal(allowExternal('https://docs.google.com/spreadsheets/d/test/edit', config), true);
  assert.equal(allowExternal('https://project.supabase.co/auth/v1/user', config), false);
  assert.equal(allowExternal('https://project.supabase.co/storage/v1/object/sign/doc-attachments/image.jpg?token=test', config), true);
  assert.equal(allowExternal('https://example.com/@docs.google.com/spreadsheets/d/test', config), false);
});

test('desktop keychain IPC is scoped to the Supabase Auth storage keys', () => {
  assert.equal(sessionKey('sb-project-auth-token', config), true);
  assert.equal(sessionKey('sb-project-auth-token-code-verifier', config), true);
  assert.equal(sessionKey('sb-other-auth-token', config), false);
  assert.equal(sessionKey('../sb-project-auth-token', config), false);
});
