'use strict';
/**
 * Uji backend: percepatan tahap 2 (V..). Cache data absensi, laporan jobdesk, bonus,
 * dan pengambilan beberapa halaman sekaligus (app.prefetch). Data baru harus langsung
 * terlihat setelah ditulis, walaupun dibaca lewat cache.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { offset, makeJpeg, wib, must, bootstrap, attend, relogin } = require('./helpers');

const DAY = '2026-10-26';
const INSIDE = Object.assign(offset(20, 15), { accuracy: 12 });

/** Jumlah pembukaan spreadsheet selama fn berjalan. */
function opensDuring(t, fn) {
  const before = t.env.state.opens;
  fn();
  return t.env.state.opens - before;
}

test('V01 boot, dashboard, dan status absensi berulang tidak membuka spreadsheet', () => {
  const t = bootstrap({ now: wib(DAY, '07:40') });
  must(attend(t.env, t.tokens.siti, 'checkin', INSIDE));
  const calls = () => {
    must(t.env.api('app.boot', { page: 'dashboard' }, t.tokens.budi));
    must(t.env.api('attendance.state', {}, t.tokens.budi));
    must(t.env.api('notif.summary', {}, t.tokens.budi));
    must(t.env.api('app.boot', { page: 'dashboard' }, t.tokens.rina));
  };
  calls(); // mengisi cache
  assert.equal(opensDuring(t, calls), 0, 'karyawan & HR dilayani dari cache');
});

test('V02 check-in & check-out langsung terlihat walau data absensi di-cache', () => {
  const t = bootstrap({ now: wib(DAY, '07:40') });
  const before = must(t.env.api('attendance.state', {}, t.tokens.budi));
  assert.equal(before.mode, 'checkin');
  must(t.env.api('dashboard.summary', {}, t.tokens.rina));
  must(attend(t.env, t.tokens.budi, 'checkin', INSIDE));
  const after = must(t.env.api('attendance.state', {}, t.tokens.budi));
  assert.equal(after.mode, 'checkout', 'status langsung berubah setelah check-in');
  assert.ok(after.record.checkIn);
  assert.equal(must(t.env.api('dashboard.summary', {}, t.tokens.rina)).team.hadir, 1, 'dashboard HR langsung menghitung');
  t.env.advance(60e3);
  assert.equal(attend(t.env, t.tokens.budi, 'checkin', INSIDE).code, 'DUPLICATE_CHECKIN', 'cache tidak membuka celah absen ganda');
  t.env.setNow(wib(DAY, '17:05'));
  const tok = relogin(t.env, 'budi');
  must(attend(t.env, tok, 'checkout', INSIDE));
  assert.equal(must(t.env.api('attendance.state', {}, tok)).mode, 'done');
});

test('V03 laporan jobdesk & bonus di-cache, tetapi verifikasi dan laporan baru langsung terlihat', () => {
  const t = bootstrap({ now: wib(DAY, '07:50') });
  must(attend(t.env, t.tokens.budi, 'checkin', INSIDE));
  t.env.setNow(wib(DAY, '17:05'));
  ['budi', 'rina'].forEach(w => { t.tokens[w] = relogin(t.env, w); });
  const q = { from: DAY, to: DAY };
  assert.equal(must(t.env.api('work.list', q, t.tokens.rina)).reports.length, 0);
  must(attend(t.env, t.tokens.budi, 'checkout', INSIDE));
  const list = must(t.env.api('work.list', q, t.tokens.rina));
  assert.equal(list.reports.length, 1, 'laporan baru langsung muncul');
  assert.equal(opensDuring(t, () => must(t.env.api('work.list', q, t.tokens.rina))), 0, 'pembacaan ulang dari cache');
  must(t.env.api('work.verify', { reportIds: [list.reports[0].reportId], decision: 'Disetujui' }, t.tokens.rina));
  assert.equal(must(t.env.api('work.list', q, t.tokens.rina)).reports[0].status, 'Disetujui');
  assert.equal(must(t.env.api('payroll.summary', q, t.tokens.rina)).totalJobdesk, 0, 'tanpa tarif: Rp 0, tetapi terhitung');
  // Bonus
  const s = must(t.env.api('bonus.saveScheme', { nama: 'Paket Reguler', tarif: 500, target: 40, peserta: [t.ids.budi] }, t.tokens.rina));
  must(t.env.api('bonus.list', q, t.tokens.rina));
  must(t.env.api('bonus.submit', { workDate: DAY, items: [{ schemeId: s.schemeId, jumlah: 100 }], photo: makeJpeg() }, t.tokens.budi));
  const b = must(t.env.api('bonus.list', q, t.tokens.rina));
  assert.equal(b.reports.length, 1);
  must(t.env.api('bonus.verify', { bonusIds: [b.reports[0].bonusId], decision: 'Disetujui' }, t.tokens.rina));
  assert.equal(must(t.env.api('payroll.summary', q, t.tokens.rina)).totalBonus, 30000);
  assert.equal(must(t.env.api('notif.summary', {}, t.tokens.rina)).items.some(i => i.route === 'gaji/bonus'), false, 'notifikasi ikut diperbarui');
});

test('V04 app.prefetch: beberapa halaman dalam satu panggilan, tetap patuh role & cakupan', () => {
  const t = bootstrap({ now: wib(DAY, '07:50') });
  must(attend(t.env, t.tokens.budi, 'checkin', INSIDE));
  must(attend(t.env, t.tokens.siti, 'checkin', INSIDE));
  const items = [
    { key: 'a', action: 'jobs.list', payload: {} },
    { key: 'b', action: 'leave.list', payload: { scope: 'mine' } },
    { key: 'c', action: 'work.list', payload: { from: DAY, to: DAY, mine: true } },
    { key: 'd', action: 'payroll.summary', payload: { from: DAY, to: DAY } },
    { key: 'e', action: 'employees.list', payload: {} },
    { key: 'f', action: 'attendance.history', payload: { employeeId: t.ids.siti, days: 31 } },
    { key: 'g', action: 'attendance.submit', payload: { action: 'checkout' } },
    { key: 'h', action: 'users.list', payload: {} },
    { key: 'i', action: 'attendance.history', payload: { days: 31 } },
  ];
  const mine = must(t.env.api('app.prefetch', { items }, t.tokens.budi)).results;
  assert.deepEqual(Object.keys(mine).sort(), ['a', 'b', 'c', 'f', 'i']);
  assert.ok(mine.a.ok && mine.b.ok && mine.c.ok && mine.i.ok);
  assert.deepEqual(mine.a.data, must(t.env.api('jobs.list', {}, t.tokens.budi)), 'sama dengan panggilan langsung');
  assert.equal(mine.f.ok, false, 'riwayat karyawan lain ditolak');
  assert.equal(mine.f.code, 'FORBIDDEN');
  assert.equal(mine.i.data.records.length, 1);
  assert.equal(t.env.table('Attendance').find(r => r.employeeId === t.ids.budi).checkOutAt, '', 'aksi tulis tidak bisa lewat prefetch');
  const hr = must(t.env.api('app.prefetch', { items }, t.tokens.rina)).results;
  assert.ok(hr.d.ok && hr.e.ok && hr.f.ok, 'HR boleh rekap, daftar karyawan, riwayat karyawan lain');
  assert.equal(hr.h, undefined, 'users.list khusus Super Admin dan tidak bisa di-prefetch');
  assert.equal(hr.f.data.records.length, 1);
  assert.equal(t.env.api('app.prefetch', { items: [] }, null).code, 'AUTH_REQUIRED');
});

test('V05 edit manual sheet Attendance terlihat setelah masa cache (5 menit)', () => {
  const t = bootstrap({ now: wib(DAY, '07:50') });
  must(attend(t.env, t.tokens.budi, 'checkin', INSIDE));
  assert.equal(must(t.env.api('attendance.state', {}, t.tokens.budi)).record.status, 'Hadir');
  const sh = t.env.sheet('Attendance');
  sh.data[1][sh.data[0].indexOf('status')] = 'Dinas Luar';
  t.env.advance(6 * 60e3);
  assert.equal(must(t.env.api('attendance.state', {}, t.tokens.budi)).record.status, 'Dinas Luar');
});

test('V06 rekap bulan tetap lengkap walau bagian akhir sheet tidak mencakup awal bulan', () => {
  const t = bootstrap({ now: wib('2026-10-02', '07:00') });
  t.env.setNow(wib('2026-10-02', '07:50'));
  must(attend(t.env, t.tokens.budi, 'checkin', INSIDE)); // satu-satunya kehadiran Budi bulan ini
  // 400 baris lain (mis. impor manual) setelahnya, semuanya bertanggal lebih baru.
  const sh = t.env.sheet('Attendance');
  const head = sh.data[0];
  for (let i = 0; i < 400; i++) {
    const row = head.map(() => '');
    row[head.indexOf('key')] = 'K999|2026-10-1' + (i % 10);
    row[head.indexOf('employeeId')] = 'K999';
    row[head.indexOf('workDate')] = '2026-10-1' + (i % 10);
    row[head.indexOf('checkInAt')] = '2026-10-10T00:50:00.000Z';
    row[head.indexOf('status')] = 'Hadir';
    sh.data.push(row);
  }
  t.env.setNow(wib(DAY, '07:00'));
  const recap = must(t.env.api('dashboard.summary', {}, relogin(t.env, 'budi'))).personal.recap;
  assert.equal(recap.hadir, 1, 'kehadiran 2 Oktober tetap terhitung');
  const list = must(t.env.api('attendance.list', { from: '2026-10-01', to: DAY }, relogin(t.env, 'rina'))).records;
  assert.equal(list.filter(r => r.employeeId === t.ids.budi).length, 1);
});

test('V07 status absensi ikut diambil sekaligus, tanpa pernah membuat sesi kamera', () => {
  const t = bootstrap({ now: wib(DAY, '07:50') });
  const res = must(t.env.api('app.prefetch', { items: [{ key: 's', action: 'attendance.state', payload: { withHistory: true, withSession: true } }] }, t.tokens.budi)).results;
  assert.ok(res.s.ok);
  assert.equal(res.s.data.mode, 'checkin');
  assert.equal(res.s.data.session, undefined, 'nonce hanya dibuat saat halaman absen benar-benar dibuka');
  assert.ok(Array.isArray(res.s.data.history));
});
