'use strict';
/**
 * Versi Vercel: halaman statis tunggal (public/index.html) yang memanggil server
 * Apps Script lewat fetch ke URL /exec (doPost), bukan google.script.run.
 * Karena halaman tidak berada di dalam iframe Google, kamera langsung bisa dipakai.
 *
 *   node dev/build-vercel.js            → memakai build/ (kode yang di-push ke Apps Script)
 *
 * URL web app diambil dari GAS_EXEC_URL atau konstanta di bawah.
 */
const fs = require('fs');
const path = require('path');

const EXEC_URL = process.env.GAS_EXEC_URL ||
  'https://script.google.com/macros/s/AKfycby2Verd7ODJY4QT7_LYLRqxkFFK5WVgvtDDyUTSaE_dmgcyBKGNgdHUq1MGe_aJtLqK/exec';

/** Pengganti google.script.run: setiap pemanggilan api(...) dikirim sebagai POST text/plain. */
function shim(url) {
  return '<script>(function () {' +
    'var URL_ = ' + JSON.stringify(url) + ';' +
    'function Runner(ok, fail) { this._ok = ok; this._fail = fail; }' +
    'Runner.prototype.withSuccessHandler = function (fn) { return new Runner(fn, this._fail); };' +
    'Runner.prototype.withFailureHandler = function (fn) { return new Runner(this._ok, fn); };' +
    'Runner.prototype.api = function (action, payload, token) {' +
      'var ok = this._ok, fail = this._fail;' +
      'fetch(URL_, { method: "POST", redirect: "follow", body: JSON.stringify({ action: action, payload: payload, token: token }) })' +
        '.then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })' +
        '.then(function (res) { if (ok) ok(res); }, function (err) { if (fail) fail(err); });' +
    '};' +
    'window.google = { script: { run: new Runner(null, null) } };' +
  '})();</script>';
}

/**
 * Service worker: menyimpan halaman aplikasi di HP agar terbuka seketika (juga saat sinyal
 * lemah). Halaman dari cache langsung dipakai, versi terbaru diunduh di belakang; bila
 * berbeda, aplikasi diberi tahu ("Versi baru · muat ulang"). Hanya halaman ini yang
 * disimpan; data dan panggilan ke server Google tidak pernah disentuh.
 */
const SW_JS = `'use strict';
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
`;

/** HTML halaman Vercel dari doGet() (dirender lewat mock runtime yang sama dengan uji). */
function vercelHtml(env, url, swUrl) {
  const out = env.run('doGet');
  const origin = /^https?:/.test(url) ? ['https://script.google.com', 'https://script.googleusercontent.com'] : [];
  return out.content.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    // Koneksi TLS ke server Google disiapkan sejak awal, agar panggilan pertama tidak menunggu.
    origin.map(o => '<link rel="preconnect" href="' + o + '" crossorigin>').join('') +
    '<title>' + (out.title || 'GGSHOPS.ID · SDM & Absensi') + '</title>' + shim(url) +
    '<script>if ("serviceWorker" in navigator) { window.addEventListener("load", function () { navigator.serviceWorker.register(' + JSON.stringify(swUrl || '/sw.js') + ').catch(function () {}); }); ' +
    'navigator.serviceWorker.addEventListener("message", function (e) { if (e.data && e.data.type === "sw:update") document.dispatchEvent(new CustomEvent("app:update")); }); }</script>');
}

if (require.main === module) {
  process.env.GAS_SRC_DIR = process.env.GAS_SRC_DIR || path.join(__dirname, '..', 'build');
  const { createGas } = require('./gas-mock');
  const env = createGas();
  const outDir = path.join(__dirname, '..', 'public');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), vercelHtml(env, EXEC_URL));
  fs.writeFileSync(path.join(outDir, 'sw.js'), SW_JS);
  console.log('public/index.html siap (' + Math.round(fs.statSync(path.join(outDir, 'index.html')).size / 1024) + ' KB) → ' + EXEC_URL);
}

module.exports = { vercelHtml, EXEC_URL, SW_JS };
