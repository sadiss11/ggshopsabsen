'use strict';
/**
 * Mock runtime Google Apps Script untuk pengujian lokal.
 *
 * Mensimulasikan perilaku penting layanan Google:
 *  - SpreadsheetApp: teks tanpa apostrof di-parse seperti Sheets (tanggal/jam/angka),
 *    penulisan formula ("=...") dianggap kesalahan.
 *  - CacheService (TTL), PropertiesService, LockService (dengan hook untuk simulasi
 *    transaksi bersamaan), DriveApp (folder/file privat), Utilities, Session, ScriptApp,
 *    HtmlService (template <?!= ... ?>).
 *  - Jam server dikendalikan lewat env.setNow()/env.advance(); new Date() di dalam
 *    kode GAS memakai jam ini.
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// GAS_SRC_DIR=build menguji hasil build (kode yang benar-benar di-push).
const SRC_DIR = process.env.GAS_SRC_DIR ? path.resolve(process.env.GAS_SRC_DIR) : path.join(__dirname, '..', 'src');

const toSigned = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));
const toBuf = data => (typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(Array.from(data, b => b & 255)));

function isDate(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function formatDate(date, tz, pattern) {
  const d = new Date(date.getTime());
  const parts = {};
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).forEach(p => { parts[p.type] = p.value; });
  const map = { yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss|'[^']*'/g, t => (t[0] === "'" ? t.slice(1, -1) : map[t]));
}

/** Meniru cara Sheets menafsirkan nilai yang ditulis lewat setValues/appendRow. */
function parseLikeSheets(v, keepApostrophe) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    if (v === '') return '';
    if (v[0] === "'") return keepApostrophe ? v : v.slice(1);
    if (v[0] === '=') throw new Error('MOCK: penulisan formula terdeteksi: ' + v.slice(0, 40));
    if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?)?$/.test(v)) return new Date(v.length === 10 ? v + 'T00:00:00+07:00' : v);
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(v)) {
      const [h, m, s] = v.split(':').map(Number);
      return new Date(Date.UTC(1970, 0, 1, h, m, s || 0) - 7 * 3600e3);
    }
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (/^(true|false)$/i.test(v)) return v.toUpperCase() === 'TRUE';
    return v;
  }
  if (isDate(v)) return new Date(v.getTime());
  return v;
}

function createGas(opts = {}) {
  const clock = { ms: opts.now !== undefined ? opts.now : Date.UTC(2026, 9, 26, 1, 0, 0) };
  // Mode uji: Sheets menyimpan apostrof penanda teks apa adanya (GAS_MOCK_KEEP_APOSTROPHE=1).
  const keepApostrophe = opts.keepApostrophe !== undefined ? !!opts.keepApostrophe : process.env.GAS_MOCK_KEEP_APOSTROPHE === '1';
  const state = {
    props: new Map(),
    cache: new Map(),
    spreadsheets: new Map(),
    folders: new Map(),
    files: new Map(),
    triggers: [],
    logs: [],
    flushes: 0,
    opens: 0,
    lock: { held: false, onAcquire: null, acquisitions: 0, failNext: false },
    activeEmail: opts.activeEmail !== undefined ? opts.activeEmail : 'owner@example.com',
    ownerEmail: 'owner@example.com',
  };
  let seq = 0;
  const newId = p => p + '_' + (++seq).toString(36) + crypto.randomBytes(6).toString('hex');

  /* ---------- Spreadsheet ---------- */
  class Range {
    constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = this.sheet.data[this.r - 1 + i] || [];
        const vals = [];
        for (let j = 0; j < this.nc; j++) {
          const v = row[this.c - 1 + j];
          vals.push(v === undefined ? '' : isDate(v) ? new Date(v.getTime()) : v);
        }
        out.push(vals);
      }
      return out;
    }
    getValue() { return this.getValues()[0][0]; }
    setValues(values) {
      if (values.length !== this.nr || values.some(r => r.length !== this.nc)) throw new Error('MOCK: dimensi setValues tidak cocok');
      for (let i = 0; i < this.nr; i++) {
        const idx = this.r - 1 + i;
        while (this.sheet.data.length <= idx) this.sheet.data.push([]);
        for (let j = 0; j < this.nc; j++) this.sheet.data[idx][this.c - 1 + j] = parseLikeSheets(values[i][j], keepApostrophe);
      }
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
  }
  ['setFontWeight', 'setBackground', 'setFontColor', 'setNumberFormat', 'setHorizontalAlignment', 'setWrap']
    .forEach(m => { Range.prototype[m] = function () { return this; }; });

  class Sheet {
    constructor(ss, name) { this.ss = ss; this.name = name; this.data = []; }
    getName() { return this.name; }
    getLastRow() {
      for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some(v => v !== '' && v !== undefined)) return i + 1;
      return 0;
    }
    getLastColumn() {
      let max = 0;
      this.data.forEach(r => { for (let j = r.length - 1; j >= 0; j--) if (r[j] !== '' && r[j] !== undefined) { max = Math.max(max, j + 1); break; } });
      return max;
    }
    getRange(r, c, nr = 1, nc = 1) {
      if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error('MOCK: koordinat range tidak valid');
      return new Range(this, r, c, nr, nc);
    }
    appendRow(values) {
      const r = this.getLastRow() + 1;
      new Range(this, r, 1, 1, values.length).setValues([values]);
      return this;
    }
    deleteRow(r) { this.data.splice(r - 1, 1); }
    deleteRows(r, n) { this.data.splice(r - 1, n); }
    setFrozenRows() { return this; }
    getMaxRows() { return Math.max(1000, this.data.length); }
  }

  class Spreadsheet {
    constructor(name) { this.id = newId('ss'); this.name = name; this.tz = 'Asia/Jakarta'; this.sheets = [new Sheet(this, 'Sheet1')]; }
    getId() { return this.id; }
    getName() { return this.name; }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
    getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
    getSheets() { return this.sheets.slice(); }
    insertSheet(n) { if (this.getSheetByName(n)) throw new Error('MOCK: sheet sudah ada'); const s = new Sheet(this, n); this.sheets.push(s); return s; }
    deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
    setSpreadsheetTimeZone(tz) { this.tz = tz; }
    getSpreadsheetTimeZone() { return this.tz; }
  }

  const SpreadsheetApp = {
    create(name) { const ss = new Spreadsheet(name); state.spreadsheets.set(ss.id, ss); return ss; },
    openById(id) { state.opens++; const ss = state.spreadsheets.get(id); if (!ss) throw new Error('MOCK: spreadsheet tidak ditemukan'); return ss; },
    getActiveSpreadsheet() { return null; },
    flush() { state.flushes++; },
  };

  /* ---------- Drive ---------- */
  class Blob {
    constructor(bytes, type, name) { this.bytes = toBuf(bytes); this.type = type || 'application/octet-stream'; this.name = name || ''; }
    getBytes() { return toSigned(this.bytes); }
    getContentType() { return this.type; }
    getName() { return this.name; }
    setName(n) { this.name = n; return this; }
    getDataAsString() { return this.bytes.toString('utf8'); }
  }
  const iter = list => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
  class DriveFile {
    constructor(blob, parent) {
      this.id = newId('file'); this.blob = new Blob(blob.bytes, blob.type, blob.name); this.parent = parent;
      this.description = ''; this.trashed = false;
    }
    getId() { return this.id; }
    getName() { return this.blob.name; }
    getBlob() { if (this.trashed) throw new Error('MOCK: file di sampah'); return new Blob(this.blob.bytes, this.blob.type, this.blob.name); }
    getMimeType() { return this.blob.type; }
    getSize() { return this.blob.bytes.length; }
    setDescription(d) { this.description = d; return this; }
    getDescription() { return this.description; }
    setTrashed(t) { this.trashed = !!t; return this; }
    isTrashed() { return this.trashed; }
    getSharingAccess() { return this.parent ? this.parent.effectiveAccess() : 'PRIVATE'; }
  }
  class Folder {
    constructor(name, parent) { this.id = newId('folder'); this.name = name; this.parent = parent || null; this.access = null; this.trashed = false; }
    isTrashed() { return this.trashed; }
    setTrashed(t) { this.trashed = !!t; return this; }
    getId() { return this.id; }
    getName() { return this.name; }
    getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; }
    createFolder(name) { const f = new Folder(name, this); state.folders.set(f.id, f); return f; }
    getFoldersByName(name) { return iter([...state.folders.values()].filter(f => f.parent === this && f.name === name)); }
    createFile(blob) { const f = new DriveFile(blob, this); state.files.set(f.id, f); return f; }
    getFiles() { return iter([...state.files.values()].filter(f => f.parent === this && !f.trashed)); }
    setSharing(access, perm) { this.access = access; this.permission = perm; return this; }
    effectiveAccess() { return this.access || (this.parent ? this.parent.effectiveAccess() : 'PRIVATE'); }
  }
  const DriveApp = {
    Access: { PRIVATE: 'PRIVATE', ANYONE: 'ANYONE', ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', DOMAIN: 'DOMAIN', DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK' },
    Permission: { NONE: 'NONE', VIEW: 'VIEW', EDIT: 'EDIT', COMMENT: 'COMMENT' },
    createFolder(name) { const f = new Folder(name, null); state.folders.set(f.id, f); return f; },
    getFolderById(id) { const f = state.folders.get(id); if (!f) throw new Error('MOCK: folder tidak ditemukan'); return f; },
    getFileById(id) { const f = state.files.get(id); if (!f) throw new Error('MOCK: file tidak ditemukan'); return f; },
  };

  /* ---------- Utilities ---------- */
  const algos = { SHA_256: 'sha256', SHA_1: 'sha1', MD5: 'md5', SHA_512: 'sha512' };
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256', SHA_1: 'SHA_1', MD5: 'MD5', SHA_512: 'SHA_512' },
    Charset: { UTF_8: 'UTF_8', US_ASCII: 'US_ASCII' },
    formatDate,
    computeDigest(alg, value) { return toSigned(crypto.createHash(algos[alg]).update(toBuf(value)).digest()); },
    computeHmacSha256Signature(value, key) { return toSigned(crypto.createHmac('sha256', toBuf(key)).update(toBuf(value)).digest()); },
    base64Encode(data) { return toBuf(data).toString('base64'); },
    base64Decode(s) { return toSigned(Buffer.from(String(s), 'base64')); },
    newBlob(data, type, name) { return new Blob(data, type, name); },
    getUuid() { return crypto.randomUUID(); },
    sleep() {},
  };

  /* ---------- Properties / Cache / Lock ---------- */
  const scriptProps = {
    getProperty: k => (state.props.has(k) ? state.props.get(k) : null),
    setProperty: (k, v) => { state.props.set(k, String(v)); return scriptProps; },
    setProperties: (obj, deleteOthers) => {
      if (deleteOthers) state.props.clear();
      Object.keys(obj).forEach(k => state.props.set(k, String(obj[k])));
      return scriptProps;
    },
    getProperties: () => Object.fromEntries(state.props),
    deleteProperty: k => { state.props.delete(k); return scriptProps; },
  };
  const PropertiesService = { getScriptProperties: () => scriptProps };

  const scriptCache = {
    get(k) {
      const e = state.cache.get(k);
      if (!e) return null;
      if (e.exp <= clock.ms) { state.cache.delete(k); return null; }
      return e.v;
    },
    put(k, v, ttl = 600) {
      if (String(k).length > 250) throw new Error('MOCK: key cache terlalu panjang');
      if (String(v).length > 100 * 1024) throw new Error('MOCK: nilai cache > 100KB');
      state.cache.set(k, { v: String(v), exp: clock.ms + Math.min(ttl, 21600) * 1000 });
    },
    remove(k) { state.cache.delete(k); },
    getAll(keys) { const out = {}; keys.forEach(k => { const v = scriptCache.get(k); if (v !== null) out[k] = v; }); return out; },
    putAll(obj, ttl) { Object.keys(obj).forEach(k => scriptCache.put(k, obj[k], ttl)); },
    removeAll(keys) { keys.forEach(k => state.cache.delete(k)); },
  };
  const CacheService = { getScriptCache: () => scriptCache };

  const LockService = {
    getScriptLock() {
      let has = false;
      return {
        tryLock() {
          const hook = state.lock.onAcquire;
          if (hook) { state.lock.onAcquire = null; hook(); }
          if (state.lock.failNext) { state.lock.failNext = false; return false; }
          if (state.lock.held) return false;
          state.lock.held = true; has = true; state.lock.acquisitions++;
          return true;
        },
        waitLock(ms) { if (!this.tryLock(ms)) throw new Error('MOCK: lock timeout'); },
        hasLock: () => has,
        releaseLock() { if (has) { has = false; state.lock.held = false; } },
      };
    },
  };

  /* ---------- Session / ScriptApp / Logger ---------- */
  const Session = {
    getActiveUser: () => ({ getEmail: () => state.activeEmail }),
    getEffectiveUser: () => ({ getEmail: () => state.ownerEmail }),
  };
  const ScriptApp = {
    getProjectTriggers: () => state.triggers.slice(),
    deleteTrigger: t => { state.triggers = state.triggers.filter(x => x !== t); },
    newTrigger(fn) {
      const uid = String(1000 + state.triggers.length);
      const t = { fn, getHandlerFunction: () => fn, getUniqueId: () => uid };
      const b = { timeBased: () => b, everyDays: () => b, atHour: () => b, create: () => { state.triggers.push(t); return t; } };
      return b;
    },
  };
  const Logger = { log: m => { state.logs.push(String(m)); } };

  /* ---------- HtmlService ---------- */
  let context;
  const readSrc = name => fs.readFileSync(path.join(SRC_DIR, name.endsWith('.html') ? name : name + '.html'), 'utf8');
  function htmlOutput(content) {
    const o = { content, title: '', metas: {} };
    o.getContent = () => o.content;
    o.setTitle = t => { o.title = t; return o; };
    o.addMetaTag = (n, c) => { o.metas[n] = c; return o; };
    o.setXFrameOptionsMode = () => o;
    o.setFaviconUrl = () => o;
    return o;
  }
  const HtmlService = {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
    createHtmlOutputFromFile: name => htmlOutput(readSrc(name)),
    createTemplateFromFile(name) {
      const tpl = {};
      tpl.evaluate = () => {
        const vars = Object.keys(tpl).filter(k => k !== 'evaluate');
        const src = readSrc(name).replace(/<\?!=\s*([\s\S]*?)\s*;?\s*\?>/g, (m, expr) => {
          const fn = vm.runInContext('(function(' + vars.join(',') + '){ return (' + expr + '); })', context);
          return String(fn.apply(null, vars.map(v => tpl[v])));
        });
        return htmlOutput(src);
      };
      return tpl;
    },
  };

  const ContentService = {
    MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
    createTextOutput(text) {
      const o = { content: String(text), mime: 'text/plain' };
      o.getContent = () => o.content;
      o.setMimeType = m => { o.mime = m; return o; };
      return o;
    },
  };

  const quiet = opts.quiet !== false;
  const sandbox = {
    SpreadsheetApp, DriveApp, Utilities, PropertiesService, CacheService, LockService, Session, ScriptApp,
    Logger, HtmlService, ContentService,
    console: quiet ? { log() {}, info() {}, warn() {}, error: (...a) => state.logs.push('[error] ' + a.join(' ')) } : console,
    __clock: { now: () => clock.ms },
  };
  const builtinKeys = new Set(Object.keys(sandbox).concat(['Date']));
  context = vm.createContext(sandbox);
  vm.runInContext(`(function(){
    const RealDate = Date;
    class FakeDate extends RealDate {
      constructor(...a) { if (a.length === 0) super(__clock.now()); else super(...a); }
      static now() { return __clock.now(); }
    }
    globalThis.Date = FakeDate;
  })();`, context);

  const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.js')).sort();
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'), context, { filename: f }));

  /** Mengatur ulang memo per-eksekusi (setiap pemanggilan GAS adalah eksekusi baru). */
  const resetExecution = () => vm.runInContext(
    'DB_.ss = null; DB_.sheets = {}; DB_.headers = {}; DB_.rows = {}; DB_.tz = null; DB_.versions = {}; DB_.touched = {}; CONFIG_MEMO_ = null; LOCK_DEPTH_ = 0;', context);

  const env = {
    state, context, files,
    now: () => clock.ms,
    setNow: ms => { clock.ms = typeof ms === 'string' ? Date.parse(ms) : ms; },
    advance: ms => { clock.ms += ms; },
    /** Memanggil fungsi global seperti google.script.run (hasil diserialisasi JSON). */
    run(fn, ...args) {
      resetExecution();
      const f = context[fn];
      if (typeof f !== 'function') throw new Error('Fungsi tidak ada: ' + fn);
      const res = f(...JSON.parse(JSON.stringify(args)));
      return res === undefined ? undefined : JSON.parse(JSON.stringify(res));
    },
    api(action, payload, token) { return env.run('api', action, payload || {}, token || null); },
    evaluate(expr) { return vm.runInContext(expr, context); },
    sheet(name) {
      const id = state.props.get('SPREADSHEET_ID');
      return state.spreadsheets.get(id).getSheetByName(name);
    },
    /** Isi sheet sebagai array objek (header baris 1). */
    table(name) {
      const sh = env.sheet(name);
      const [head, ...rows] = sh.data;
      const unq = v => (typeof v === 'string' && v[0] === "'" ? v.slice(1) : v);
      return rows.filter(r => r.some(v => v !== '' && v !== undefined)).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : unq(r[i])])));
    },
    /** Daftar fungsi global yang bisa dipanggil dari browser (tanpa akhiran _). */
    publicFunctions() {
      return Object.keys(context).filter(k => typeof context[k] === 'function' && !k.endsWith('_') && !builtinKeys.has(k));
    },
  };
  return env;
}

module.exports = { createGas, formatDate };
