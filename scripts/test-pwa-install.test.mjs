import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { loadModule } from './test-support/load-module.mjs';

const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.children?.map(text).join('') ?? '';

async function fixture() {
  const listeners = new Map();
  const removed = [];
  const { PwaInstall, PwaInstallPage } = loadModule('desktop/pwa/install.jsx', {}, {
    __PWA_BASE__: '/doc-tracking-system/',
    __PWA__: true,
    navigator: { onLine: true, serviceWorker: { register: async () => {} } },
    window: {
      matchMedia: () => ({ matches: false }),
      addEventListener: (event, callback) => listeners.set(event, callback),
      removeEventListener: (event, callback) => { removed.push(event); assert.equal(listeners.get(event), callback); },
    },
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(PwaInstall)); });
  const ready = async prompt => act(async () => {
    listeners.get('beforeinstallprompt')({ preventDefault() {}, ...prompt });
  });
  const button = () => renderer.root.findAllByType('button').find(node => text(node).includes('ติดตั้งแอป'));
  return { renderer, ready, button, listeners, removed, PwaInstallPage };
}

test('installation landing page exposes installation before any sign-in form', async () => {
  const f = await fixture();
  assert.equal(typeof f.PwaInstallPage, 'function');
  await act(async () => { f.renderer.unmount(); });
  let landing;
  await act(async () => { landing = create(React.createElement(f.PwaInstallPage)); });
  assert.match(text(landing.toJSON()), /ติดตั้งแอป Hillkoff/);
  assert.equal(landing.root.findAllByType('input').length, 0);
  assert.equal(landing.root.findByType('a').props.href, '/doc-tracking-system/#/');
  await act(async () => { landing.unmount(); });
});

test('one click prompts once and only an installed event shows completion', async () => {
  const f = await fixture();
  let complete;
  let prompted = 0;
  await f.ready({ prompt: () => { prompted++; return Promise.resolve(); }, userChoice: new Promise(resolve => { complete = resolve; }) });
  const click = f.button().props.onClick;
  let pending;
  await act(async () => { pending = click(); void click(); });
  assert.equal(prompted, 1);
  assert.doesNotMatch(text(f.renderer.toJSON()), /ติดตั้งเรียบร้อย/);
  await act(async () => { complete({ outcome: 'accepted' }); await pending; });
  assert.doesNotMatch(text(f.renderer.toJSON()), /ติดตั้งเรียบร้อย/);
  await act(async () => { f.listeners.get('appinstalled')(); });
  assert.match(text(f.renderer.toJSON()), /ติดตั้งเรียบร้อย/);
  await act(async () => { f.renderer.unmount(); });
});

test('a failed prompt is handled and gives an actionable installation fallback', async () => {
  const f = await fixture();
  await f.ready({ prompt: async () => { throw new Error('NotAllowedError'); } });
  await act(async () => { await f.button().props.onClick(); });
  assert.match(text(f.renderer.toJSON()), /เมนู/);
  assert.doesNotMatch(text(f.renderer.toJSON()), /ติดตั้งเรียบร้อย/);
  await act(async () => { f.renderer.unmount(); });
});

test('dismissal stays available for a new browser prompt and removes event handlers', async () => {
  const f = await fixture();
  await f.ready({ prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
  await act(async () => { await f.button().props.onClick(); });
  assert.doesNotMatch(text(f.renderer.toJSON()), /ติดตั้งเรียบร้อย/);
  await f.ready({ prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
  assert.ok(f.button());
  await act(async () => { f.renderer.unmount(); });
  assert.deepEqual(f.removed.sort(), ['appinstalled', 'beforeinstallprompt', 'offline', 'online']);
});
