'use strict';
const crypto = require('crypto');
const { createGas } = require('../dev/gas-mock');

/** Titik kantor uji (Monas, Jakarta). */
const OFFICE = { lat: -6.175392, lng: 106.827153 };

/** Koordinat yang bergeser dx (timur) & dy (utara) meter dari titik kantor. */
function offset(dxMeters, dyMeters, base = OFFICE) {
  const lat = base.lat + dyMeters / 111320;
  const lng = base.lng + dxMeters / (111320 * Math.cos(base.lat * Math.PI / 180));
  return { lat: Number(lat.toFixed(7)), lng: Number(lng.toFixed(7)) };
}

/**
 * JPEG sintetis yang strukturnya valid (SOI, APP0, COM acak, SOF0, SOS, EOI).
 * Backend tidak men-decode piksel, jadi ini cukup untuk uji validasi server.
 * Uji E2E memakai JPEG asli dari kamera (Chrome fake camera).
 */
function makeJpeg({ width = 720, height = 960, size = 20000 } = {}) {
  const parts = [Buffer.from([0xFF, 0xD8]),
    Buffer.from([0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])];
  let remaining = size;
  while (remaining > 0) {
    const n = Math.min(60000, remaining);
    const seg = Buffer.alloc(4 + n);
    seg[0] = 0xFF; seg[1] = 0xFE; seg.writeUInt16BE(n + 2, 2);
    crypto.randomFillSync(seg, 4);
    parts.push(seg);
    remaining -= n;
  }
  parts.push(Buffer.from([0xFF, 0xC0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]));
  parts.push(Buffer.from([0xFF, 0xDA, 0x00, 0x0C, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3F, 0x00]));
  parts.push(crypto.randomBytes(200).map(b => (b === 0xFF ? 0x00 : b)));
  parts.push(Buffer.from([0xFF, 0xD9]));
  return 'data:image/jpeg;base64,' + Buffer.concat(parts).toString('base64');
}

/** WIB (UTC+7) → epoch ms. */
function wib(dateStr, time) {
  return Date.parse(dateStr + 'T' + time + ':00+07:00');
}

function must(res, label) {
  if (!res || !res.ok) throw new Error((label || 'API') + ' gagal: ' + JSON.stringify(res));
  return res.data;
}

function loginAndChange(env, username, tempPassword, newPassword) {
  const t = must(env.api('auth.login', { username, password: tempPassword }), 'login ' + username).token;
  return must(env.api('auth.changePassword', { oldPassword: tempPassword, newPassword }, t), 'ganti password ' + username).token;
}

/**
 * Lingkungan siap pakai: admin, lokasi kantor radius 100 m, jadwal default
 * 08:00–17:00 (toleransi 15), dan karyawan:
 *  K001 Budi (IT, karyawan), K002 Siti (Marketing, karyawan),
 *  K003 Andi (IT, akun ber-role lama "manager" di sheet), K004 Rina (HRD, hr).
 */
function bootstrap(opts = {}) {
  const env = createGas({ now: opts.now || wib('2026-10-26', '07:30') }); // Senin
  env.run('setup');
  const temp = /password sementara: (\S+)/.exec(env.state.logs.join('\n'))[1];
  const admin = loginAndChange(env, 'admin', temp, 'AdminBaru2026');
  const loc = must(env.api('locations.save', { nama: 'Kantor Pusat', alamat: 'Jakarta', latitude: OFFICE.lat, longitude: OFFICE.lng, radius: 100 }, admin));

  const people = [
    { key: 'budi', nama: 'Budi Santoso', jabatan: 'Staff IT', departemen: 'IT', role: 'karyawan' },
    { key: 'siti', nama: 'Siti Rahayu', jabatan: 'Staff Marketing', departemen: 'Marketing', role: 'karyawan' },
    { key: 'andi', nama: 'Andi Pratama', jabatan: 'Manager IT', departemen: 'IT', role: 'manager' },
    { key: 'rina', nama: 'Rina Marlina', jabatan: 'HRD', departemen: 'HRD', role: 'hr' },
  ];
  const tokens = { admin };
  const ids = {};
  people.forEach(p => {
    const r = must(env.api('employees.save', {
      nama: p.nama, jabatan: p.jabatan, departemen: p.departemen, tanggalBergabung: '2025-01-06',
      createAccount: true, username: p.key, accountRole: p.role,
    }, admin), 'buat karyawan ' + p.key);
    ids[p.key] = r.employeeId;
    tokens[p.key] = loginAndChange(env, p.key, r.account.tempPassword, 'Rahasia' + p.key + '2026');
  });
  // Role "manager" sudah dihapus; akun lama yang masih bertuliskan "manager" di sheet
  // harus diperlakukan sebagai karyawan biasa.
  setUserRole(env, 'andi', 'manager');
  return { env, tokens, ids, locationId: loc.locationId };
}

/** Mengubah role langsung di sheet Users (seperti edit manual), lalu membuang cache tabel. */
function setUserRole(env, username, role) {
  const sh = env.sheet('Users');
  const head = sh.data[0];
  const row = sh.data.find(r => String(r[head.indexOf('username')]).replace(/^'/, '') === username);
  row[head.indexOf('role')] = role;
  env.evaluate("PropertiesService.getScriptProperties().setProperty('TBLV_Users', String(Date.now() + Math.random()))");
}

/** Login ulang (sesi gugur setelah 12 jam tidak aktif). */
function relogin(env, key) {
  const password = key === 'admin' ? 'AdminBaru2026' : 'Rahasia' + key + '2026';
  return must(env.api('auth.login', { username: key, password }), 'login ulang ' + key).token;
}

let photoCounter = 0;
/** Alur lengkap seperti browser: buka sesi kamera (nonce) → kirim absensi. */
function attend(env, token, action, coords, extra = {}) {
  const begin = env.api('attendance.begin', { action }, token);
  if (!begin.ok) return begin;
  photoCounter++;
  const payload = Object.assign({
    action,
    nonce: begin.data.nonce,
    photo: makeJpeg(),
    lat: coords.lat,
    lng: coords.lng,
    accuracy: coords.accuracy === undefined ? 12 : coords.accuracy,
    faceCheck: 'off',
  }, action === 'checkout' ? { workPhoto: makeJpeg(), workNote: 'Merapikan stok dan packing pesanan', workRateIds: [] } : {}, extra);
  return env.api('attendance.submit', payload, token);
}

module.exports = { OFFICE, offset, makeJpeg, wib, must, bootstrap, attend, loginAndChange, relogin, setUserRole };
