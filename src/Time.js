/**
 * Waktu server. Seluruh waktu resmi transaksi berasal dari waktu eksekusi
 * Google Apps Script (new Date() di server), bukan dari perangkat karyawan.
 */

const HARI_ = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN_ = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function tzParts_(date, tz) {
  const s = Utilities.formatDate(date, tz, 'yyyy-MM-dd HH:mm:ss');
  return {
    str: s,
    date: s.slice(0, 10),
    time: s.slice(11, 19),
    y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)),
    H: Number(s.slice(11, 13)), M: Number(s.slice(14, 16)), S: Number(s.slice(17, 19)),
  };
}

/** Selisih zona waktu terhadap UTC dalam menit pada instan tertentu. */
function tzOffsetMin_(date, tz) {
  const p = tzParts_(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Epoch ms untuk tanggal lokal (yyyy-MM-dd) + menit sejak tengah malam di zona waktu tz. */
function localToEpoch_(dateStr, minutes, tz) {
  const p = dateStr.split('-').map(Number);
  const guess = Date.UTC(p[0], p[1] - 1, p[2]) + minutes * 60000;
  const off = tzOffsetMin_(new Date(guess), tz);
  let t = guess - off * 60000;
  const off2 = tzOffsetMin_(new Date(t), tz);
  if (off2 !== off) t = guess - off2 * 60000;
  return t;
}

function addDays_(dateStr, n) {
  const p = dateStr.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}

/** Hari ISO: 1 = Senin ... 7 = Minggu. */
function isoWeekday_(dateStr) {
  const p = dateStr.split('-').map(Number);
  const day = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  return day === 0 ? 7 : day;
}

function fmtLocal_(ms, pattern) {
  return Utilities.formatDate(new Date(ms), getConfig_().timezone, pattern);
}

function hhmm_(ms) {
  return fmtLocal_(ms, 'HH:mm');
}

function todayLocal_(nowMs) {
  return tzParts_(new Date(nowMs), getConfig_().timezone).date;
}

function longDate_(dateStr) {
  const p = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  return HARI_[dow] + ', ' + p[2] + ' ' + BULAN_[p[1] - 1] + ' ' + p[0];
}

function tzAbbr_(tz, offsetMin) {
  if (tz === 'Asia/Jakarta' || tz === 'Asia/Pontianak') return 'WIB';
  if (tz === 'Asia/Makassar') return 'WITA';
  if (tz === 'Asia/Jayapura') return 'WIT';
  const sign = offsetMin >= 0 ? '+' : '-';
  const a = Math.abs(offsetMin);
  return 'UTC' + sign + Math.floor(a / 60) + (a % 60 ? ':' + String(a % 60).padStart(2, '0') : '');
}

/** Endpoint publik untuk sinkronisasi jam di layar. */
function timeNow_(ctx) {
  const tz = getConfig_().timezone;
  const now = ctx.now;
  const p = tzParts_(now, tz);
  const off = tzOffsetMin_(now, tz);
  return {
    epochMs: now.getTime(),
    iso: now.toISOString(),
    timezone: tz,
    offsetMin: off,
    tzAbbr: tzAbbr_(tz, off),
    date: p.date,
    time: p.time,
    dateLabel: longDate_(p.date),
  };
}
