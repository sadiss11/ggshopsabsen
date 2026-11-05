'use strict';
/**
 * Uji backend: privasi antar-karyawan (R..). Hanya Super Admin & HRD yang boleh
 * melihat absen, laporan jobdesk, gaji, foto, izin, dan profil karyawan lain.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { offset, wib, must, bootstrap, attend, relogin, setUserRole } = require('./helpers');

const DAY = '2026-10-26';
const INSIDE = Object.assign(offset(20, 15), { accuracy: 12 });

/** Budi & Andi (IT) dan Siti (Marketing) absen penuh dengan laporan jobdesk; Siti mengajukan cuti. */
function busyDay() {
  const t = bootstrap({ now: wib(DAY, '07:00') });
  const rate = must(t.env.api('rates.save', { nama: 'Packing pesanan', tarif: 50000 }, t.tokens.rina));
  must(t.env.api('jobs.save', { employeeId: t.ids.budi, judul: 'Stok gudang', prioritas: 'Sedang', status: 'Pending' }, t.tokens.rina));
  must(t.env.api('jobs.save', { employeeId: t.ids.siti, judul: 'Konten promo', prioritas: 'Tinggi', status: 'Pending' }, t.tokens.rina));
  must(t.env.api('leave.submit', { jenis: 'Cuti', tanggalMulai: '2026-10-29', tanggalSelesai: '2026-10-29', alasan: 'Acara keluarga' }, t.tokens.siti));
  t.env.setNow(wib(DAY, '07:50'));
  ['budi', 'siti', 'andi'].forEach(w => must(attend(t.env, t.tokens[w], 'checkin', INSIDE), 'check-in ' + w));
  t.env.setNow(wib(DAY, '17:05'));
  ['budi', 'siti', 'andi'].forEach(w => must(attend(t.env, t.tokens[w], 'checkout', INSIDE, { workRateIds: [rate.rateId] }), 'check-out ' + w));
  ['admin', 'rina', 'budi', 'siti', 'andi'].forEach(w => { t.tokens[w] = relogin(t.env, w); });
  return t;
}

const others = (list, me) => list.filter(x => x.employeeId && x.employeeId !== me);

test('R01 karyawan hanya melihat absen, laporan, gaji, foto, izin, jobdesk, dan profilnya sendiri', () => {
  const t = busyDay();
  for (const who of ['budi', 'siti', 'andi']) {
    const me = t.ids[who];
    const tok = t.tokens[who];
    // Ditolak sepenuhnya
    for (const [action, payload] of [
      ['attendance.list', { from: DAY, to: DAY }],
      ['employees.list', {}],
      ['report.monthly', { month: '2026-10' }],
      ['payroll.summary', { from: DAY, to: DAY }],
      ['meta.options', {}],
      ['rates.list', {}],
      ['leave.list', { scope: 'approvals' }],
      ['audit.list', {}],
      ['users.list', {}],
    ]) assert.equal(t.env.api(action, payload, tok).code, 'FORBIDDEN', who + ' ' + action);

    // Data orang lain ditolak
    for (const other of ['budi', 'siti', 'andi'].filter(x => x !== who)) {
      const oid = t.ids[other];
      assert.equal(t.env.api('employees.get', { employeeId: oid }, tok).code, 'FORBIDDEN', who + ' profil ' + other);
      assert.equal(t.env.api('attendance.history', { employeeId: oid }, tok).code, 'FORBIDDEN', who + ' riwayat ' + other);
      const att = t.env.table('Attendance').find(r => r.employeeId === oid);
      assert.equal(t.env.api('attendance.photo', { attendanceId: att.attendanceId, type: 'in' }, tok).code, 'FORBIDDEN', who + ' foto ' + other);
      const rep = t.env.table('WorkReports').find(r => r.employeeId === oid);
      assert.equal(t.env.api('work.photo', { reportId: rep.reportId }, tok).code, 'FORBIDDEN', who + ' foto kerja ' + other);
      assert.equal(t.env.api('work.verify', { reportIds: [rep.reportId], decision: 'Disetujui' }, tok).code, 'FORBIDDEN', who + ' verifikasi ' + other);
    }

    // Daftar yang terbuka hanya berisi data sendiri
    const work = must(t.env.api('work.list', { from: DAY, to: DAY }, tok));
    assert.equal(work.reports.length, 1, who + ' melihat 1 laporan');
    assert.deepEqual(others(work.reports, me), [], who + ' tidak melihat laporan orang lain');
    assert.deepEqual(others(must(t.env.api('jobs.list', {}, tok)).jobs, me), [], who + ' jobdesk');
    assert.deepEqual(others(must(t.env.api('leave.list', {}, tok)).requests, me), [], who + ' izin');
    assert.equal(must(t.env.api('attendance.history', {}, tok)).records.length, 1, who + ' riwayat hanya miliknya (1 hari)');
    assert.equal(must(t.env.api('employees.get', { employeeId: me }, tok)).employee.employeeId, me, who + ' profil sendiri');

    const dash = must(t.env.api('dashboard.summary', {}, tok));
    assert.equal(dash.team, undefined, who + ' dashboard tanpa data tim');
    const boot = must(t.env.api('app.boot', {}, tok));
    assert.equal(boot.user.role, 'karyawan');
    assert.equal(JSON.stringify(boot).indexOf(t.ids[who === 'budi' ? 'siti' : 'budi']), -1, who + ' boot tidak memuat ID karyawan lain');
  }
});

test('R02 HRD dan Super Admin tetap melihat semua karyawan', () => {
  const t = busyDay();
  for (const who of ['rina', 'admin']) {
    const tok = t.tokens[who];
    assert.equal(must(t.env.api('attendance.list', { from: DAY, to: DAY }, tok)).records.length, 3, who + ' absen semua');
    assert.equal(must(t.env.api('work.list', { from: DAY, to: DAY }, tok)).reports.length, 3, who + ' laporan semua');
    const pay = must(t.env.api('payroll.summary', { from: DAY, to: DAY }, tok));
    assert.ok(JSON.stringify(pay).includes(t.ids.siti), who + ' rekap gaji memuat semua');
    assert.ok(must(t.env.api('employees.list', {}, tok)).employees.length >= 4, who + ' daftar karyawan');
    assert.equal(must(t.env.api('leave.list', { scope: 'approvals' }, tok)).requests.length, 1, who + ' izin untuk disetujui');
    const att = t.env.table('Attendance').find(r => r.employeeId === t.ids.siti);
    must(t.env.api('attendance.photo', { attendanceId: att.attendanceId, type: 'in' }, tok), who + ' foto');
  }
});

test('R03 role lama "manager" di sheet: tampil & berlaku sebagai Karyawan, dan tidak bisa dipilih lagi', () => {
  const t = busyDay();
  const me = must(t.env.api('auth.me', {}, t.tokens.andi)).user;
  assert.equal(me.role, 'karyawan');
  assert.equal(me.roleLabel, 'Karyawan');
  const users = must(t.env.api('users.list', {}, t.tokens.admin));
  assert.equal(users.users.find(u => u.username === 'andi').role, 'karyawan');
  assert.deepEqual(users.roles.map(r => r.value), ['admin', 'hr', 'karyawan']);
  assert.deepEqual(users.roles.map(r => r.label), ['Super Admin', 'HRD', 'Karyawan']);
  const uid = users.users.find(u => u.username === 'budi').userId;
  assert.equal(t.env.api('users.save', { userId: uid, role: 'manager', status: 'Aktif', employeeId: t.ids.budi }, t.tokens.admin).code, 'VALIDATION');
  // Role tak dikenal (mis. salah ketik saat edit manual) juga hanya mendapat akses karyawan.
  setUserRole(t.env, 'budi', 'Admin ');
  assert.equal(must(t.env.api('auth.me', {}, t.tokens.budi)).user.role, 'karyawan');
  assert.equal(t.env.api('attendance.list', { from: DAY, to: DAY }, t.tokens.budi).code, 'FORBIDDEN');
});
