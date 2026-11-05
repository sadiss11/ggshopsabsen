/**
 * Lapisan akses Google Sheets.
 *
 * - Kolom dipetakan berdasarkan nama header (baris 1).
 * - Teks ditulis dengan awalan apostrof agar Sheets tidak mengubahnya menjadi
 *   tanggal/angka dan tidak dieksekusi sebagai formula (anti formula-injection).
 * - Nilai yang terlanjur diubah Sheets (misalnya diedit manual) dinormalisasi
 *   kembali sesuai tipe kolom saat dibaca.
 * - Sheet referensi kecil di-cache di CacheService dengan penanda versi (lihat
 *   rows_). Pembacaan di dalam lock selalu langsung dari sheet.
 * - Sheet/kolom baru dari SCHEMA_ dibuat otomatis saat pertama dipakai.
 */

const DB_ = { ss: null, sheets: {}, headers: {}, rows: {}, tz: null, versions: {}, touched: {} };

/** Sheet yang dibaca utuh dan di-cache (referensi kecil + laporan gaji yang dibaca halaman Gaji). */
const CACHED_TABLES_ = ['Users', 'Employees', 'WorkSchedules', 'WorkLocations', 'LeaveRequests', 'Jobdesk', 'JobRates', 'BonusSchemes', 'WorkReports', 'BonusReports'];
/** Sheet besar yang hanya dibaca bagian akhirnya (rowsTail_); bagian akhir itu di-cache per versi. */
const TAIL_CACHED_TABLES_ = ['Attendance'];
const TABLE_TTL_SEC_ = 300;
const CACHE_CHUNK_ = 45000;

function ss_() {
  if (!DB_.ss) {
    const id = getSecret_('SPREADSHEET_ID');
    if (!id) throw appError_('Database belum dikonfigurasi. Admin perlu menjalankan fungsi setup() di editor Apps Script.', 'NOT_CONFIGURED');
    DB_.ss = SpreadsheetApp.openById(id);
  }
  return DB_.ss;
}

function ssTz_() {
  if (!DB_.tz) DB_.tz = ss_().getSpreadsheetTimeZone() || getConfig_().timezone;
  return DB_.tz;
}

function sheet_(name) {
  if (!DB_.sheets[name]) {
    let sh = ss_().getSheetByName(name);
    if (!sh && SCHEMA_[name]) sh = createSheet_(name);
    if (!sh) throw appError_('Sheet "' + name + '" tidak ditemukan. Admin perlu menjalankan setup().', 'NOT_CONFIGURED');
    DB_.sheets[name] = sh;
  }
  return DB_.sheets[name];
}

/** Membuat sheet baru dari SCHEMA_ (versi aplikasi yang lebih baru menambah sheet). */
function createSheet_(name) {
  return withLock_(() => {
    let sh = ss_().getSheetByName(name);
    if (sh) return sh;
    const wanted = SCHEMA_[name].map(c => c[0]);
    sh = ss_().insertSheet(name);
    sh.getRange(1, 1, 1, wanted.length).setValues([wanted]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, wanted.length).setFontWeight('bold').setBackground('#13203b').setFontColor('#ffffff');
    return sh;
  });
}

function readHeaders_(sh) {
  const lastCol = sh.getLastColumn();
  return lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim()) : [];
}

function headers_(name) {
  if (!DB_.headers[name]) {
    const sh = sheet_(name);
    let headers = readHeaders_(sh);
    const missing = (SCHEMA_[name] || []).map(c => c[0]).filter(h => headers.indexOf(h) < 0);
    if (missing.length) {
      // Kolom baru dari versi aplikasi yang lebih baru ditambahkan di ujung kanan.
      headers = withLock_(() => {
        const cur = readHeaders_(sh);
        const add = missing.filter(h => cur.indexOf(h) < 0);
        if (add.length) sh.getRange(1, cur.length + 1, 1, add.length).setValues([add]);
        return cur.concat(add);
      });
    }
    DB_.headers[name] = headers;
  }
  return DB_.headers[name];
}

function colTypes_(name) {
  const out = {};
  (SCHEMA_[name] || []).forEach(c => { out[c[0]] = c[1]; });
  return out;
}

function colIndex_(name, field) {
  const i = headers_(name).indexOf(field);
  if (i < 0) throw appError_('Kolom "' + field + '" tidak ada di sheet ' + name + '. Jalankan setup() untuk memperbarui struktur.', 'NOT_CONFIGURED');
  return i;
}

function fromCell_(v, type) {
  if (v === null || v === undefined) v = '';
  const isDate = Object.prototype.toString.call(v) === '[object Date]';
  // Apostrof penanda teks bisa ikut tersimpan (perilaku Sheets berbeda antar-jalur penulisan),
  // jadi selalu dibuang saat membaca.
  const s = isDate ? '' : unquote_(v);
  switch (type) {
    case 'n': {
      if (v === '' || s === '') return null;
      const n = typeof v === 'number' ? v : Number(s);
      return isFinite(n) ? n : null;
    }
    case 'b':
      return v === true || s.trim().toUpperCase() === 'TRUE';
    case 'd':
      return isDate ? Utilities.formatDate(v, ssTz_(), 'yyyy-MM-dd') : s.trim();
    case 't':
      return isDate ? Utilities.formatDate(v, ssTz_(), 'HH:mm') : normTime_(s);
    case 'dt':
      return isDate ? v.toISOString() : s.trim();
    default:
      return isDate ? Utilities.formatDate(v, ssTz_(), 'yyyy-MM-dd HH:mm:ss') : s;
  }
}

function unquote_(v) {
  const s = String(v);
  return s.charAt(0) === "'" ? s.slice(1) : s;
}

function toCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v;
  if (Object.prototype.toString.call(v) === '[object Date]') return "'" + v.toISOString();
  const s = String(v);
  return s === '' ? '' : "'" + s;
}

function rowToObj_(name, headers, values, rowNum) {
  const types = colTypes_(name);
  const o = { _row: rowNum };
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (h) o[h] = fromCell_(values[i], types[h] || 's');
  }
  return o;
}

function readRange_(name, startRow, numRows) {
  if (numRows <= 0) return [];
  const headers = headers_(name);
  if (!headers.length) return [];
  const values = sheet_(name).getRange(startRow, 1, numRows, headers.length).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i].every(c => c === '' || c === null)) continue;
    out.push(rowToObj_(name, headers, values[i], startRow + i));
  }
  return out;
}

/* ---------- Cache tabel ----------
 * Setiap tabel yang di-cache punya penanda versi di Script Properties. Penanda
 * dibaca SEBELUM sheet dibaca dan diganti SETELAH penulisan di-flush, sehingga
 * entri cache yang dibuat dari data lama tidak pernah cocok dengan versi terbaru.
 * Perubahan manual langsung di spreadsheet terlihat paling lambat TABLE_TTL_SEC_. */

function isCached_(name) {
  return CACHED_TABLES_.indexOf(name) >= 0;
}

/** Tabel yang punya penanda versi (diganti setiap kali ditulis). */
function isVersioned_(name) {
  return isCached_(name) || TAIL_CACHED_TABLES_.indexOf(name) >= 0;
}

function tableVersion_(name) {
  if (!DB_.versions[name]) DB_.versions[name] = PropertiesService.getScriptProperties().getProperty('TBLV_' + name) || '0';
  return DB_.versions[name];
}

/** Dipanggil setelah flush untuk setiap tabel yang ditulis. */
function bumpTouchedTables_() {
  const names = Object.keys(DB_.touched);
  if (!names.length) return;
  const props = {};
  names.forEach(n => {
    const v = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    props['TBLV_' + n] = v;
    DB_.versions[n] = v;
  });
  PropertiesService.getScriptProperties().setProperties(props, false);
  DB_.touched = {};
}

function tableCacheGet_(name) {
  return chunkGet_('tbl_' + name, tableVersion_(name));
}

function tableCachePut_(name, version, list) {
  chunkPut_('tbl_' + name, version, list);
}

/** Daftar baris yang disimpan di CacheService dalam beberapa potongan (batas 100 KB per nilai). */
function chunkGet_(base, version) {
  try {
    const cache = CacheService.getScriptCache();
    const meta = cache.get(base);
    if (!meta) return null;
    const m = JSON.parse(meta);
    if (m.v !== version) return null;
    const keys = [];
    for (let i = 0; i < m.n; i++) keys.push(base + '_' + m.v + '_' + i);
    const parts = cache.getAll(keys);
    let json = '';
    for (let i = 0; i < keys.length; i++) {
      if (typeof parts[keys[i]] !== 'string') return null;
      json += parts[keys[i]];
    }
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function chunkPut_(base, version, list) {
  try {
    const json = JSON.stringify(list);
    if (json.length > CACHE_CHUNK_ * 40) return;
    const data = {};
    let n = 0;
    for (let i = 0; i < json.length; i += CACHE_CHUNK_) data[base + '_' + version + '_' + (n++)] = json.slice(i, i + CACHE_CHUNK_);
    if (!n) data[base + '_' + version + '_' + (n++)] = '[]';
    const cache = CacheService.getScriptCache();
    cache.putAll(data, TABLE_TTL_SEC_);
    cache.put(base, JSON.stringify({ v: version, n: n }), TABLE_TTL_SEC_);
  } catch (e) { /* cache hanya percepatan, boleh gagal */ }
}

/** Semua baris data sebuah sheet (di-memo per eksekusi; tabel kecil lewat cache). */
function rows_(name) {
  if (DB_.rows[name]) return DB_.rows[name];
  const cacheable = isCached_(name) && LOCK_DEPTH_ === 0;
  if (cacheable) {
    const hit = tableCacheGet_(name);
    if (hit) return (DB_.rows[name] = hit);
  }
  const version = cacheable ? tableVersion_(name) : null;
  const last = sheet_(name).getLastRow();
  const list = last < 2 ? [] : readRange_(name, 2, last - 1);
  DB_.rows[name] = list;
  if (cacheable) tableCachePut_(name, version, list);
  return list;
}

/** N baris terakhir (data absensi ditambahkan berurutan waktu). Di luar lock memakai cache per versi. */
function rowsTail_(name, n) {
  if (DB_.rows[name]) return DB_.rows[name];
  const cacheable = TAIL_CACHED_TABLES_.indexOf(name) >= 0 && LOCK_DEPTH_ === 0;
  const base = 'tail_' + name + '_' + n;
  // Versi dibaca sebelum sheet, sama seperti rows_, agar data lama tidak tersimpan dengan versi baru.
  const version = cacheable ? tableVersion_(name) : null;
  if (cacheable) {
    const hit = chunkGet_(base, version);
    if (hit) return hit;
  }
  const last = sheet_(name).getLastRow();
  if (last < 2) return [];
  const start = Math.max(2, last - n + 1);
  const list = readRange_(name, start, last - start + 1);
  if (cacheable) chunkPut_(base, version, list);
  return list;
}

function readRow_(name, rowNum) {
  return readRange_(name, rowNum, 1)[0] || null;
}

function findBy_(name, field, value) {
  if (value === null || value === undefined || value === '') return null;
  const list = rows_(name);
  for (let i = 0; i < list.length; i++) if (list[i][field] === value) return list[i];
  return null;
}

/** Nilai satu kolom (cepat untuk pencarian kunci di sheet besar). */
function columnValues_(name, field) {
  const last = sheet_(name).getLastRow();
  if (last < 2) return [];
  const col = colIndex_(name, field) + 1;
  const type = colTypes_(name)[field] || 's';
  return sheet_(name).getRange(2, col, last - 1, 1).getValues().map(r => fromCell_(r[0], type));
}

function invalidate_(name) {
  delete DB_.rows[name];
}

/** Menandai tabel yang ditulis; versi cache diganti setelah data di-flush. */
function touch_(name) {
  invalidate_(name);
  if (!isVersioned_(name)) return;
  DB_.touched[name] = true;
  if (LOCK_DEPTH_ === 0) {
    SpreadsheetApp.flush();
    bumpTouchedTables_();
  }
}

function insert_(name, obj) {
  const headers = headers_(name);
  sheet_(name).appendRow(headers.map(h => toCell_(obj[h])));
  touch_(name);
  return obj;
}

/** Menulis hanya kolom yang diubah (dikelompokkan per rentang berurutan) agar kolom lain, termasuk rumus buatan Admin, tidak tersentuh. */
function update_(name, rowNum, patch) {
  const headers = headers_(name);
  const sh = sheet_(name);
  const cols = [];
  headers.forEach((h, i) => { if (h && Object.prototype.hasOwnProperty.call(patch, h)) cols.push(i); });
  let start = 0;
  while (start < cols.length) {
    let end = start;
    while (end + 1 < cols.length && cols[end + 1] === cols[end] + 1) end++;
    const values = cols.slice(start, end + 1).map(i => toCell_(patch[headers[i]]));
    sh.getRange(rowNum, cols[start] + 1, 1, values.length).setValues([values]);
    start = end + 1;
  }
  touch_(name);
}

function deleteRow_(name, rowNum) {
  sheet_(name).deleteRow(rowNum);
  touch_(name);
}

/** Membaca ulang baris berdasarkan ID di dalam lock (baris bisa bergeser karena penghapusan). */
function freshById_(name, field, id) {
  invalidate_(name);
  return findBy_(name, field, id);
}

/** Menghapus properti internal sebelum dikirim ke browser. */
function strip_(o, omit) {
  const out = {};
  Object.keys(o).forEach(k => {
    if (k === '_row') return;
    if (omit && omit.indexOf(k) >= 0) return;
    out[k] = o[k];
  });
  return out;
}
