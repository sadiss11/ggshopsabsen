'use strict';
const CACHE = 'ggshops-shell-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const key = new URL(req.url).pathname;
    const cached = await cache.match(key);
    const net = fetch(req, { cache: 'no-cache' }).then(async res => {
      if (!res.ok) return res;
      const body = await res.clone().text();
      const old = cached ? await cached.clone().text() : null;
      await cache.put(key, new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
      if (old !== null && old !== body) {
        const list = await self.clients.matchAll({ type: 'window' });
        list.forEach(c => c.postMessage({ type: 'sw:update' }));
      }
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(net); return cached; }
    return (await net) || Response.error();
  }));
});
