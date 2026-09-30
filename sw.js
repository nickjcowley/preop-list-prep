// Pre-op List Prep service worker.
// Keeps an offline copy of the app (always tries the network first, so updates arrive straight away),
// and receives Word files shared to the installed app on Android.
const CACHE = 'preop-app-v3';
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
      let got = 'none'; const seen = []; let probeBytes = null;
      try {
        // record what actually arrived, for troubleshooting
        const probe = await e.request.clone().arrayBuffer().catch(() => null); probeBytes = probe;
        seen.push(`app ${CACHE}; content ${e.request.headers.get('content-type') || 'none'}; ${probe ? probe.byteLength : '?'} bytes`);
        const form = await e.request.formData();
        // take the first file in the share, whatever field or type Android gave it
        let file = null;
        for (const [k, v] of form.entries()){
          if (v && typeof v === 'object' && 'size' in v){ seen.push(`${v.name || '?'} (${v.type || 'no type'}, ${v.size} bytes)`); if (!file && v.size) file = v; }
          else if (v) seen.push(`${k}: ${String(v).slice(0, 80)}`);
        }
        const c = await caches.open('preop-shared');
        await c.put('shared-info', new Response(JSON.stringify(seen)));
        if (file){
          await c.put('shared-file', new Response(file, {headers: {'X-Name': encodeURIComponent(file.name || 'shared file')}}));
          got = 'file';
        } else got = 'nofile';
      } catch (err) {
        // the browser could not read the share: pull the file out of the raw upload ourselves
        got = 'error'; seen.push('standard reader failed: ' + (err && err.message));
        try {
          const f = probeBytes && parseMultipart(new Uint8Array(probeBytes), e.request.headers.get('content-type') || '');
          const c = await caches.open('preop-shared');
          if (f){
            seen.push(`${f.name} (${f.type || 'no type'}, ${f.data.length} bytes, read directly)`);
            await c.put('shared-file', new Response(f.data, {headers: {'X-Name': encodeURIComponent(f.name || 'shared file')}}));
            got = 'file';
          }
          await c.put('shared-info', new Response(JSON.stringify(seen)));
        } catch (e2) {}
      }
      return Response.redirect('./preop-list-prep.html?shared=' + got, 303);
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

// Minimal multipart/form-data reader: returns the first part that carries a file.
function parseMultipart(u8, contentType){
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType); if (!m) return null;
  const enc = new TextEncoder(), dec = new TextDecoder('latin1');
  const bnd = enc.encode('--' + (m[1] || m[2]).trim());
  const find = (pat, from) => { outer: for (let i = from; i <= u8.length - pat.length; i++){ for (let j = 0; j < pat.length; j++) if (u8[i + j] !== pat[j]) continue outer; return i; } return -1; };
  let pos = find(bnd, 0);
  while (pos >= 0){
    const start = pos + bnd.length + 2; // skip boundary + CRLF
    const next = find(bnd, start); if (next < 0) break;
    const headEnd = find(enc.encode('\r\n\r\n'), start);
    if (headEnd > 0 && headEnd < next){
      const head = dec.decode(u8.subarray(start, headEnd));
      const fn = /filename\*?=(?:UTF-8'')?"?([^";\r\n]*)"?/i.exec(head);
      if (fn){
        const type = (/content-type:\s*([^\r\n]+)/i.exec(head) || [])[1] || '';
        const data = u8.slice(headEnd + 4, next - 2); // drop trailing CRLF
        if (data.length){ let name = fn[1]; try { name = decodeURIComponent(name); } catch (e) {} return {name, type, data}; }
      }
    }
    pos = next;
  }
  return null;
}
