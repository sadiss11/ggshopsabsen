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
 * Service worker untuk halaman aplikasi (tidak menyentuh data maupun panggilan ke server Google).
 * Selalu mengambil versi terbaru dari internet lebih dulu; salinan di HP dipakai hanya bila
 * jaringan putus atau lebih lambat dari 3 detik, sehingga aplikasi tetap terbuka saat sinyal buruk.
 * Saat versi service worker ini terpasang menggantikan versi lama, halaman yang masih terbuka
 * dimuat ulang otomatis agar langsung memakai tampilan terbaru.
 */
const SW_JS = `'use strict';
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
