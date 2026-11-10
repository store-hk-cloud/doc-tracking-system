import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { loadModule } from './test-support/load-module.mjs';

function target() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    emit(name) { for (const callback of listeners.get(name) || []) callback(); },
  };
}
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
async function fixture({ hidden = false, fetch, replayEffect = false } = {}) {
  let now = 10000;
  const document = { ...target(), visibilityState: hidden ? 'hidden' : 'visible' };
  const window = { ...target(), fetch: fetch || (async () => Response.json({ success: true, data: [] })) };
  const calls = [];
  const realFetch = window.fetch;
  window.fetch = (...args) => { calls.push(args[1]?.method || 'GET'); return realFetch(...args); };
  const timers = new Map(); let next = 0;
  const Topbar = loadModule('src/components/layouts/Topbar.tsx', {
    react: replayEffect ? { ...React, useEffect(effect, dependencies) {
      // จำลอง StrictMode replay โดยคง dependencies ของ component ที่กำลังทดสอบ
      // eslint-disable-next-line react-hooks/exhaustive-deps
      React.useEffect(() => { const cleanup = effect(); cleanup?.(); return effect(); }, dependencies);
    } } : React,
    '@/components/auth/AuthProvider': { useAuth: () => ({ profile: {}, signOut() {} }) },
    'next/link': (props) => React.createElement('a', props),
  }, { window, document, Date: class extends Date { static now() { return now; } },
    setInterval(callback, delay) { const id = ++next; timers.set(id, { callback, delay }); return id; },
    clearInterval(id) { timers.delete(id); },
  }).Topbar;
  let renderer;
  await act(async () => { renderer = create(React.createElement(Topbar)); });
  return { renderer, calls, timers, window, document,
    advance(ms) { now += ms; },
    async tick() { await act(async () => { for (const { callback } of [...timers.values()]) callback(); }); },
    async visible(value) { document.visibilityState = value ? 'visible' : 'hidden'; await act(async () => { document.emit('visibilitychange'); }); },
    async focus() { await act(async () => { window.emit('focus'); }); },
    async close() { await act(async () => renderer.unmount()); },
  };
}
test('visible mount polls once, every 60 seconds and cleans up listeners and timers', async () => {
  const f = await fixture();
  assert.deepEqual(f.calls, ['GET']);
  assert.deepEqual([...f.timers.values()].map((t) => t.delay), [60000]);
  f.advance(60000); await f.tick(); assert.equal(f.calls.length, 2);
  await f.close();
  assert.equal(f.timers.size, 0);
  assert.equal([...f.document.listeners.values(), ...f.window.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
});
test('effect cleanup and replay retain the initial in-flight result', async () => {
  const pending = deferred();
  const f = await fixture({ fetch: () => pending.promise, replayEffect: true });
  await act(async () => pending.resolve(Response.json({ success: true, data: [{ title: 'current', body: 'body' }] })));
  await act(async () => f.renderer.root.findAllByType('button')[0].props.onClick());
  assert.match(JSON.stringify(f.renderer.toJSON()), /current/);
  assert.deepEqual(f.calls, ['GET']);
  assert.equal(f.timers.size, 1);
  await f.close();
});
test('hidden mount pauses reads, visible return refreshes once despite rapid focus', async () => {
  const f = await fixture({ hidden: true });
  assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
  await f.focus(); assert.equal(f.calls.length, 0);
  await f.visible(true); await f.focus();
  assert.deepEqual(f.calls, ['GET']); assert.equal(f.timers.size, 1);
  await f.visible(false); assert.equal(f.timers.size, 0);
  f.advance(60000); await f.focus(); await f.tick(); assert.equal(f.calls.length, 1);
  await f.visible(true); assert.equal(f.calls.length, 2);
  f.advance(2000); await f.focus(); assert.equal(f.calls.length, 3);
  await f.close();
});
test('in-flight notification reads cannot overlap interval or focus refreshes', async () => {
  const pending = deferred();
  let reads = 0;
  const f = await fixture({ fetch: () => ++reads === 1 ? pending.promise : Promise.resolve(Response.json({ success: true, data: [] })) });
  f.advance(60000); await f.tick(); await f.focus();
  assert.deepEqual(f.calls, ['GET']);
  await act(async () => pending.resolve(Response.json({ success: true, data: [] })));
  f.advance(60000); await f.tick(); assert.equal(f.calls.length, 2);
  await f.close();
});
test('DELETE alone blocks fresh reads until it completes', async () => {
  const pendingDelete = deferred();
  const f = await fixture({ fetch: (_, options) => options?.method === 'DELETE' ? pendingDelete.promise
    : Promise.resolve(Response.json({ success: true, data: [{ title: 'original', body: 'body' }] })) });
  await act(async () => f.renderer.root.findAllByType('button')[0].props.onClick());
  let clearing;
  await act(async () => { clearing = f.renderer.root.findAllByType('button').find((b) => b.children.includes('ล้างทั้งหมด')).props.onClick(); });
  f.advance(60000); await f.tick(); await f.focus();
  assert.deepEqual(f.calls, ['GET', 'DELETE']);
  await act(async () => { pendingDelete.resolve(Response.json({ success: true })); await clearing; });
  f.advance(60000); await f.tick();
  assert.deepEqual(f.calls, ['GET', 'DELETE', 'GET']);
  await f.close();
});
test('clear blocks reads while DELETE is pending and discards a stale GET', async () => {
  const pendingGet = deferred(); const pendingDelete = deferred(); let reads = 0;
  const f = await fixture({ fetch: (_, options) => options?.method === 'DELETE' ? pendingDelete.promise
    : ++reads === 1 ? Promise.resolve(Response.json({ success: true, data: [{ title: 'original', body: 'body' }] })) : pendingGet.promise });
  await act(async () => f.renderer.root.findAllByType('button')[0].props.onClick());
  f.advance(60000); await f.tick();
  let clearing;
  await act(async () => { clearing = f.renderer.root.findAllByType('button').find((b) => b.children.includes('ล้างทั้งหมด')).props.onClick(); });
  f.advance(60000); await f.tick(); await f.focus();
  assert.deepEqual(f.calls, ['GET', 'GET', 'DELETE']);
  await act(async () => { pendingDelete.resolve(Response.json({ success: true })); await clearing; });
  await act(async () => pendingGet.resolve(Response.json({ success: true, data: [{ title: 'stale', body: 'stale' }] })));
  await act(async () => f.renderer.root.findAllByType('button')[0].props.onClick());
  assert.doesNotMatch(JSON.stringify(f.renderer.toJSON()), /stale/);
  assert.match(JSON.stringify(f.renderer.toJSON()), /ไม่มีการแจ้งเตือน/);
  await f.close();
});
