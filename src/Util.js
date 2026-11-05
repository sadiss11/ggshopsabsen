/**
 * Utilitas umum: error terkontrol, ID, validasi input, lock, rate limit.
 */

/** Error yang pesannya aman ditampilkan ke pengguna. */
function appError_(message, code, auditDetail) {
  const e = new Error(message);
  e.isAppError = true;
  e.code = code || 'ERROR';
  e.auditDetail = auditDetail || null;
  return e;
}

function uid_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function shortId_(prefix) {
  return prefix + '-' + uid_().slice(0, 10).toUpperCase();
}

function bytesToHex_(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] & 255;
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return s;
}

function sha256Hex_(value) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8));
}

/** Teks bebas: dipangkas, karakter kontrol dibuang, panjang dibatasi. */
function cleanText_(v, maxLen) {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function requireText_(v, label, maxLen) {
  const s = cleanText_(v, maxLen);
  if (!s) throw appError_(label + ' wajib diisi.', 'VALIDATION');
  return s;
}

function oneOf_(v, list, label) {
  if (list.indexOf(v) < 0) throw appError_(label + ' tidak valid.', 'VALIDATION');
  return v;
}

function isDateStr_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const p = s.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

function optDate_(v, label) {
  const s = cleanText_(v, 10);
  if (!s) return '';
  if (!isDateStr_(s)) throw appError_(label + ' harus berformat tanggal yang valid.', 'VALIDATION');
  return s;
}

function requireDate_(v, label) {
  const s = optDate_(v, label);
  if (!s) throw appError_(label + ' wajib diisi.', 'VALIDATION');
  return s;
}

function normTime_(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '').trim());
  if (!m) return '';
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return '';
  return (h < 10 ? '0' : '') + h + ':' + m[2];
}

function timeToMin_(s) {
  const t = normTime_(s);
  if (!t) return null;
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

function intIn_(v, min, max, label) {
  const n = Number(v);
  if (!isFinite(n) || Math.floor(n) !== n || n < min || n > max) {
    throw appError_(label + ' harus bilangan bulat ' + min + '–' + max + '.', 'VALIDATION');
  }
  return n;
}

function round_(n, digits) {
  const f = Math.pow(10, digits || 0);
  return Math.round(n * f) / f;
}

/**
 * Menjalankan fn di bawah Script Lock agar transaksi bersamaan tidak saling
 * menimpa. Aman dipanggil bertingkat dalam satu eksekusi.
 */
let LOCK_DEPTH_ = 0;
function withLock_(fn) {
  if (LOCK_DEPTH_ > 0) return fn();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LIMITS_.LOCK_WAIT_MS)) {
    throw appError_('Server sedang sibuk memproses transaksi lain. Silakan coba lagi beberapa detik lagi.', 'BUSY');
  }
  LOCK_DEPTH_++;
  DB_.rows = {}; // data yang dibaca sebelum lock (bisa dari cache) dibaca ulang dari sheet
  try {
    const result = fn();
    SpreadsheetApp.flush();
    bumpTouchedTables_();
    return result;
  } finally {
    LOCK_DEPTH_--;
    lock.releaseLock();
  }
}

/** Pembatas laju sederhana berbasis CacheService. */
function rateLimit_(key, max, windowSec, message) {
  const cache = CacheService.getScriptCache();
  const k = 'rl_' + key;
  const n = Number(cache.get(k) || 0);
  if (n >= max) throw appError_(message || 'Terlalu banyak permintaan. Silakan tunggu sebentar.', 'RATE_LIMIT');
  cache.put(k, String(n + 1), windowSec);
}

function randomPassword_() {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid());
  let out = '';
  for (let i = 0; i < 8; i++) out += alpha[(bytes[i] & 255) % alpha.length];
  for (let i = 8; i < 11; i++) out += digits[(bytes[i] & 255) % digits.length];
  return out;
}

/** Mencegah pemanggilan fungsi khusus editor dari web app oleh pengunjung. */
function guardEditor_() {
  let active = '';
  let effective = '';
  try {
    active = Session.getActiveUser().getEmail();
    effective = Session.getEffectiveUser().getEmail();
  } catch (e) { /* abaikan */ }
  if (!active || active !== effective) {
    throw new Error('Fungsi ini hanya dapat dijalankan oleh pemilik/editor skrip melalui editor Apps Script.');
  }
}
