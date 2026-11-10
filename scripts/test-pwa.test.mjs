import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { pwaHref, pwaPath, browserStorage, followFragment } from '../desktop/pwa/runtime.mjs';
import { serviceWorker } from '../desktop/pwa/worker.mjs';

test('PWA hash routes keep project scope and query strings', () => {
 assert.equal(pwaHref('/messenger/a%20b?x=1', '/doc-tracking-system/'), '/doc-tracking-system/#/messenger/a%20b?x=1');
 assert.equal(pwaPath('#/messenger/a%20b?x=1'), '/messenger/a%20b');
 assert.equal(pwaPath(''), '/');
 assert.equal(pwaHref('https://example.com', '/app/'), 'https://example.com');
 assert.equal(pwaHref('/api/setup-sheets', '/app/'), '/api/setup-sheets');
});
test('PWA storage persists across instances using standard browser storage', async () => {
 const values = new Map();
 const local = {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 await browserStorage(local).setItem('session','token');
 assert.equal(await browserStorage(local).getItem('session'),'token');
 await browserStorage(local).removeItem('session');
 assert.equal(await browserStorage(local).getItem('session'),null);
});
test('service worker only serves exact bundled assets and deletes older app versions', async () => {
 const handlers = {}; const removed=[]; let response;
 const source=serviceWorker({basePath:'/app/',version:'new',assets:['index.html','app-hash.js']});
 vm.runInNewContext(source,{self:{location:{origin:'https://host.test'},addEventListener:(k,v)=>handlers[k]=v,skipWaiting:async()=>{},clients:{claim:async()=>{}}},URL,Request,Response,caches:{keys:async()=>['doc-tracking-pwa-old','unrelated'],delete:async k=>removed.push(k),match:async()=>new Response('cached')},fetch:()=>assert.fail('network not needed')});
 await handlers.activate({waitUntil:p=>response=p}); await response;
 assert.deepEqual(removed,['doc-tracking-pwa-old']);
 for(const url of ['https://host.test/api/profile','https://host.test/app/api/profile','https://remote.test/app/app-hash.js','https://host.test/app/app-hash.js?token=secret']) handlers.fetch({request:new Request(url),respondWith:()=>assert.fail('private or unknown request intercepted')});
 handlers.fetch({request:new Request('https://host.test/app/app-hash.js'),respondWith:p=>response=p});
 assert.equal(await (await response).text(),'cached');
 response = null;
 handlers.fetch({request:new Request('https://host.test/app/'),respondWith:p=>response=p});
 assert.ok(response, 'root app shell should be available from index cache');
 assert.equal(await (await response).text(),'cached');
});

test('browser build scopes links, auth reloads and hashed entry assets to project base', async () => {
 const { buildPwa } = await import('../desktop/build-pwa.mjs');
 const { mkdtemp, readFile, readdir, rm } = await import('node:fs/promises');
 const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
 const outdir = await mkdtemp(join(tmpdir(),'pwa-test-'));
 try {
 const result=await buildPwa({outdir,supabaseOrigin:'https://example.supabase.co',publicKey:'sb_publishable_example',webOrigin:'https://documents.example',basePath:'/doc-tracking-system/'});
 assert.equal(result.routes.length,23);
 const html=await readFile(join(outdir,'index.html'),'utf8');
 assert.match(html,/src="\/doc-tracking-system\/app-[a-f0-9]+\.js"/);
 assert.match(html,/manifest.webmanifest/);
 assert.match(html,/Content-Security-Policy/);
 const cssFile=(await readdir(outdir)).find(f=>/^app-.*\.css$/.test(f));
 assert.doesNotMatch(await readFile(join(outdir,cssFile),'utf8'),/url\(\/fonts\//);

 const files=await readdir(outdir); const script=await readFile(join(outdir,files.find(f=>/^app-.*\.js$/.test(f))),'utf8');
 assert.doesNotMatch(script,/location.href="\/dashboard"/);
 assert.match(script,/pwa-sb-/);
 const manifest=JSON.parse(await readFile(join(outdir,'manifest.webmanifest'),'utf8'));
 assert.equal(manifest.start_url,'/doc-tracking-system/#/dashboard');
 assert.equal(manifest.scope,'/doc-tracking-system/');
 const sw=await readFile(join(outdir,'sw.js'),'utf8');
 assert.match(sw,new RegExp(files.find(f=>/^app-.*\.js$/.test(f)).replaceAll('.','\\.')));
 } finally {await rm(outdir,{recursive:true,force:true});}
});

test('same-page skip links preserve the current hash route', () => {
 let focused=false; let scrolled=false; const location={hash:'#/register'};
 const target={focus:()=>{focused=true;},scrollIntoView:()=>{scrolled=true;}};
 assert.equal(followFragment('#main',{getElementById:id=>id==='main'?target:null}),true);
 assert.equal(location.hash,'#/register'); assert.equal(focused,true); assert.equal(scrolled,true);
 assert.equal(followFragment('#/dashboard',{getElementById:()=>assert.fail()}),false);
});
