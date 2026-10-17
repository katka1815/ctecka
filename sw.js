// Offline: stránku čtečky a slovníky drží v paměti zařízení, takže po prvním načtení funguje bez internetu.
// Nikam nic neposílá; obsluhuje jen soubory čtečky samotné.
const SHELL = 'ctecka-shell-v4';
const DICT = 'ctecka-dict-v1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'lang.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js',
  'formats.js', 'more.js', 'pair.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== DICT).map(k => caches.delete(k))))   // staré verze pryč
  .then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/dict/')) {
    // slovníky: velké soubory, beru z paměti; nová verze (?v=) nahradí starou
    e.respondWith(caches.open(DICT).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) {
        for (const k of await c.keys()) if (new URL(k.url).pathname === url.pathname) await c.delete(k);
        await c.put(e.request, res.clone());
      }
      return res;
    }));
    return;
  }
  // ostatní: nejdřív síť (ať se projeví úpravy, proto bez HTTP cache prohlížeče), bez připojení z paměti
  e.respondWith(fetch(e.request.url, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
