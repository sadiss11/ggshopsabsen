'use strict';
const CACHE = 'ggshops-shell-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  const old = (await caches.keys()).filter(k => k !== CACHE);
  await Promise.all(old.map(k => caches.delete(k)));
  await self.clients.claim();
  if (old.length) {
    const list = await self.clients.matchAll({ type: 'window' });
    list.forEach(c => { try { c.navigate(c.url); } catch (err) { /* abaikan */ } });
  }
})()));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = new URL(req.url).pathname;
    try {
      const res = await Promise.race([
        fetch(req, { cache: 'no-cache' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('lambat')), 3000)),
      ]);
      if (res.ok) await cache.put(key, res.clone());
      return res;
    } catch (err) {
      return (await cache.match(key)) || Response.error();
    }
  })());
});
