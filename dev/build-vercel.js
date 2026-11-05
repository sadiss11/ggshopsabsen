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

/** HTML halaman Vercel dari doGet() (dirender lewat mock runtime yang sama dengan uji). */
function vercelHtml(env, url) {
  const out = env.run('doGet');
  return out.content.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    '<title>' + (out.title || 'GGSHOPS.ID · SDM & Absensi') + '</title>' + shim(url));
}

if (require.main === module) {
  process.env.GAS_SRC_DIR = process.env.GAS_SRC_DIR || path.join(__dirname, '..', 'build');
  const { createGas } = require('./gas-mock');
  const env = createGas();
  const outDir = path.join(__dirname, '..', 'public');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), vercelHtml(env, EXEC_URL));
  console.log('public/index.html siap (' + Math.round(fs.statSync(path.join(outDir, 'index.html')).size / 1024) + ' KB) → ' + EXEC_URL);
}

module.exports = { vercelHtml, EXEC_URL };
