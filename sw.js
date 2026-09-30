// Pre-op List Prep service worker.
// Keeps an offline copy of the app (always tries the network first, so updates arrive straight away),
// and receives Word files shared to the installed app on Android.
const CACHE = 'preop-app-v1';
const SHELL = ['./', './index.html', './preop-list-prep.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('preop-app-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // a file shared into the app: park it, then open the app, which picks it up
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')){
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const file = form.get('list');
        if (file && file.size){
          const c = await caches.open('preop-shared');
          await c.put('shared-file', new Response(file, {headers: {'X-Name': encodeURIComponent(file.name || 'shared file')}}));
        }
      } catch (err) {}
      return Response.redirect('./preop-list-prep.html?shared=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // network first, fall back to the offline copy
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('./preop-list-prep.html'))));
});
