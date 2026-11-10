export function serviceWorker({ basePath, version, assets }) {
  return `const CACHE = ${JSON.stringify('doc-tracking-pwa-' + version)};
const ASSETS = ${JSON.stringify(assets.map(asset => basePath + asset))};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('doc-tracking-pwa-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const assetPath = url.pathname === ${JSON.stringify(basePath)} ? ${JSON.stringify(basePath + 'index.html')} : url.pathname;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search || !ASSETS.includes(assetPath)) return;
  event.respondWith(caches.match(new URL(assetPath, self.location.origin).href, {cacheName: CACHE}).then(cached => cached || fetch(event.request)));
});`;
}
