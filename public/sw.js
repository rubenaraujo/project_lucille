const V = 'lucille-v12';
const PRECACHE = ['/', '/favs', '/data', '/s.css', '/app.js', '/chords.js', '/staff.js', '/icon.svg', '/logo.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/manifest.webmanifest',
  '/fonts/geist-latin-wght-normal.woff2', '/fonts/geist-latin-ext-wght-normal.woff2', '/fonts/geist-mono-latin-wght-normal.woff2', '/fonts/instrument-serif-latin-400-normal.woff2', '/fonts/instrument-serif-latin-400-italic.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// network first (the local server is fast and always fresh), cache as offline fallback
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname === '/sw.js') return;
  e.respondWith((async () => {
    const cache = await caches.open(V);
    try {
      const res = await fetch(r);
      if (res.ok && !u.pathname.startsWith('/api/')) cache.put(r, res.clone());
      return res;
    } catch {
      const hit = await cache.match(r, { ignoreSearch: false });
      if (hit) return hit;
      if (r.mode === 'navigate') return new Response('<meta name="viewport" content="width=device-width"><body style="background:#0b0b0c;color:#d9d9d6;font:16px system-ui;padding:2rem">Offline. This page was not saved. <a style="color:#e5495b" href="/favs">Favorites</a></body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return new Response('{"artists":[],"songs":[]}', { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
  })());
});
