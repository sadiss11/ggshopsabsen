'use strict';
/**
 * Uji backend: jobdesk berbayar & gaji (P..), serta percepatan (cache, boot) (Q..).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { offset, makeJpeg, wib, must, bootstrap, attend, relogin } = require('./helpers');

const DAY = '2026-10-26';
const INSIDE = Object.assign(offset(20, 15), { accuracy: 12 });

function withRates(t) {
  const a = must(t.env.api('rates.save', { nama: 'Packing pesanan', tarif: 50000 }, t.tokens.rina));
  const b = must(t.env.api('rates.save', { nama: 'Live jualan', tarif: 75000 }, t.tokens.rina));
  const c = must(t.env.api('rates.save', { nama: 'Konten Instagram', tarif: 40000, departemen: 'Marketing' }, t.tokens.rina));
  return { packing: a.rateId, live: b.rateId, konten: c.rateId };
}

/** Check-in 07:50, lalu check-out 17:05 dengan laporan jobdesk. */
function workDay(t, who, rateIds, extra) {
  t.env.setNow(wib(DAY, '07:50'));
  must(attend(t.env, t.tokens[who], 'checkin', INSIDE), 'check-in ' + who);
  t.env.setNow(wib(DAY, '17:05'));
  return attend(t.env, t.tokens[who], 'checkout', INSIDE, Object.assign({ workRateIds: rateIds }, extra || {}));
}

test('P01 tarif jobdesk: HR mengelola, karyawan tidak bisa, validasi tarif & duplikat', () => {
  const t = bootstrap({ now: wib(DAY, '07:00') });
  const r = withRates(t);
  assert.ok(r.packing);
  assert.equal(t.env.api('rates.save', { nama: 'X', tarif: 1000 }, t.tokens.budi).code, 'FORBIDDEN');
  assert.equal(t.env.api('rates.save', { nama: 'Y', tarif: 1000 }, t.tokens.andi).code, 'FORBIDDEN', 'role lama manager');
  assert.equal(t.env.api('rates.save', { nama: 'Z', tarif: -5 }, t.tokens.rina).code, 'VALIDATION');
  assert.equal(t.env.api('rates.save', { nama: 'Z', tarif: 1.5 }, t.tokens.rina).code, 'VALIDATION');
  assert.equal(t.env.api('rates.save', { nama: 'packing pesanan', tarif: 1 }, t.tokens.rina).code, 'VALIDATION', 'nama ganda ditolak');
  assert.equal(t.env.api('rates.list', {}, t.tokens.andi).code, 'FORBIDDEN');
  const list = must(t.env.api('rates.list', {}, t.tokens.rina)).rates;
  assert.equal(list.length, 3);
});

test('P02 check-out wajib foto hasil kerja, keterangan, dan pilihan jobdesk', () => {
  const t = bootstrap({ now: wib(DAY, '07:00') });
  const r = withRates(t);
  t.env.setNow(wib(DAY, '07:50'));
  must(attend(t.env, t.tokens.budi, 'checkin', INSIDE));
  t.env.setNow(wib(DAY, '17:05'));
  const st = must(t.env.api('attendance.state', {}, t.tokens.budi));
  assert.equal(st.work.required, true);
  assert.deepEqual(st.work.rates.map(x => x.nama).sort(), ['Live jualan', 'Packing pesanan'], 'jobdesk Marketing tidak ditawarkan ke IT');
  const tries = [
    [{ workPhoto: '' }, 'WORK_PHOTO_INVALID'],
    [{ workNote: 'ok' }, 'WORK_NOTE_REQUIRED'],
    [{ workRateIds: [] }, 'WORK_ITEMS_REQUIRED'],
    [{ workRateIds: [r.konten] }, 'WORK_ITEM_INVALID'],
    [{ workRateIds: ['TRF-PALSU'] }, 'WORK_ITEM_INVALID'],
  ];
  for (const [extra, code] of tries) {
    const res = attend(t.env, t.tokens.budi, 'checkout', INSIDE, Object.assign({ workRateIds: [r.packing] }, extra));
    assert.equal(res.code, code, JSON.stringify(extra));
    t.env.advance(5000);
  }
  assert.equal(t.env.table('WorkReports').length, 0, 'tidak ada laporan setengah jadi');
  assert.equal(t.env.table('Attendance')[0].checkOutAt, '', 'check-out belum tercatat');
  const ok = must(attend(t.env, t.tokens.budi, 'checkout', INSIDE, { workRateIds: [r.packing, r.live], workNote: 'Packing 40 pesanan & live 2 jam' }));
  assert.equal(ok.work.total, 125000);
  assert.equal(ok.work.status, 'Menunggu');
  const rows = t.env.table('WorkReports');
  assert.equal(rows.length, 2);
  rows.forEach(x => {
    assert.equal(x.status, 'Menunggu');
    assert.equal(x.attendanceId, ok.attendanceId);
    assert.equal(x.keterangan, 'Packing 40 pesanan & live 2 jam');
    assert.ok(t.env.state.files.get(x.photoId).getName().includes('_jobdesk_'), 'foto hasil kerja tersimpan di Drive');
  });
  assert.deepEqual(rows.map(x => Number(x.tarif)).sort(), [50000, 75000]);
});

test('P03 foto hasil kerja tidak boleh sama dengan selfie atau foto lama', () => {
  const t = bootstrap({ now: wib(DAY, '07:00') });
  const r = withRates(t);
  t.env.setNow(wib(DAY, '07:50'));
  must(attend(t.env, t.tokens.budi, 'checkin', INSIDE));
  t.env.setNow(wib(DAY, '17:05'));
  const same = makeJpeg();
  const res = attend(t.env, t.tokens.budi, 'checkout', INSIDE, { photo: same, workPhoto: same, workRateIds: [r.packing] });
  assert.equal(res.code, 'DUPLICATE_PHOTO');
});

test('P04 tanpa tarif terdaftar: check-out tetap bisa dengan foto & keterangan (tarif 0)', () => {
  const t = bootstrap({ now: wib(DAY, '07:00') });
  const ok = must(workDay(t, 'budi', []));
  assert.equal(ok.work.total, 0);
  assert.equal(t.env.table('WorkReports')[0].namaJobdesk, 'Tanpa jobdesk bertarif');
});

test('P05 verifikasi: hanya HRD & Super Admin; karyawan (termasuk role lama manager) dan laporan sendiri ditolak', () => {
  const t = bootstrap({ now: wib(DAY, '07:00') });
  const r = withRates(t);
  must(workDay(t, 'budi', [r.packing]));
  must(workDay(t, 'siti', [r.konten]));
  must(workDay(t, 'rina', [r.packing]));
  t.tokens.rina = relogin(t.env, 'rina'); t.tokens.andi = relogin(t.env, 'andi'); t.tokens.budi = relogin(t.env, 'budi');
  const all = t.env.table('WorkReports');
  const idOf = name => all.find(x => x.employeeId === t.ids[name]).reportId;
  assert.equal(t.env.api('work.verify', { reportIds: [idOf('budi')], decision: 'Disetujui' }, t.tokens.budi).code, 'FORBIDDEN');
  assert.equal(t.env.api('work.verify', { reportIds: [idOf('budi')], decision: 'Disetujui' }, t.tokens.andi).code, 'FORBIDDEN', 'rekan satu departemen');
  assert.equal(t.env.api('work.verify', { reportIds: [idOf('rina')], decision: 'Disetujui' }, t.tokens.rina).code, 'FORBIDDEN', 'laporan sendiri');
  must(t.env.api('work.verify', { reportIds: [idOf('budi')], decision: 'Disetujui' }, t.tokens.rina));
  must(t.env.api('work.verify', { reportIds: [idOf('rina')], decision: 'Disetujui' }, t.tokens.admin));
  assert.equal(t.env.api('work.verify', { reportIds: [idOf('siti')], decision: 'Ditolak' }, t.tokens.rina).code, 'VALIDATION', 'tolak wajib alasan');
  must(t.env.api('work.verify', { reportIds: [idOf('siti')], decision: 'Ditolak', catatan: 'Foto tidak menunjukkan konten' }, t.tokens.rina));
  const after = t.env.table('WorkReports');
  assert.equal(after.find(x => x.employeeId === t.ids.budi).status, 'Disetujui');
  assert.equal(after.find(x => x.employeeId === t.ids.budi).diverifikasiOleh, 'rina');
  assert.equal(after.find(x => x.employeeId === t.ids.rina).diverifikasiOleh, 'admin');
  assert.equal(after.find(x => x.employeeId === t.ids.siti).status, 'Ditolak');
  assert.ok(t.env.table('AuditLogs').some(l => l.action === 'REPORT_VERIFY'));
});

test('P06 rekap gaji: hanya laporan Disetujui; tarif lama tetap; rentang tanggal; akses HR saja', () => {
  const t = bootstrap({ now: wib(DAY, '07:00') });
  const r = withRates(t);
  must(workDay(t, 'budi', [r.packing, r.live]));
  t.tokens.rina = relogin(t.env, 'rina');
  const ids = t.env.table('WorkReports').map(x => x.reportId);
  must(t.env.api('work.verify', { reportIds: [ids[0]], decision: 'Disetujui' }, t.tokens.rina));
  must(t.env.api('rates.save', { rateId: r.packing, nama: 'Packing pesanan', tarif: 999999 }, t.tokens.rina));
  const sum = must(t.env.api('payroll.summary', { from: '2026-10-01', to: '2026-10-31' }, t.tokens.rina));
  const budi = sum.rows.find(x => x.employeeId === t.ids.budi);
  const approved = t.env.table('WorkReports').find(x => x.reportId === ids[0]);
  assert.equal(budi.gaji, Number(approved.tarif), 'gaji = tarif laporan yang disetujui (tarif saat itu)');
  assert.ok(budi.gaji === 50000 || budi.gaji === 75000);
  assert.equal(budi.menunggu.count, 1);
  assert.equal(budi.hariDibayar, 1);
  const outside = must(t.env.api('payroll.summary', { from: '2026-11-01', to: '2026-11-30' }, t.tokens.rina));
  assert.equal(outside.totalGaji, 0);
  t.tokens.budi = relogin(t.env, 'budi'); t.tokens.andi = relogin(t.env, 'andi');
  assert.equal(t.env.api('payroll.summary', { from: DAY, to: DAY }, t.tokens.budi).code, 'FORBIDDEN');
  assert.equal(t.env.api('payroll.summary', { from: DAY, to: DAY }, t.tokens.andi).code, 'FORBIDDEN');
  assert.equal(t.env.api('payroll.summary', { from: '2026-01-01', to: '2026-12-31' }, t.tokens.rina).code, 'VALIDATION', 'rentang > 93 hari');
  const mine = must(t.env.api('work.list', { from: DAY, to: DAY }, t.tokens.budi));
  assert.equal(mine.reports.length, 2);
  assert.equal(mine.totals.Disetujui.total, budi.gaji);
  assert.equal(mine.reports.some(x => x.photoHash !== undefined), false, 'hash foto tidak dikirim ke browser');
});

test('P07 foto hasil kerja hanya untuk role berwenang', () => {
  const t = bootstrap({ now: wib(DAY, '07:00') });
  const r = withRates(t);
  must(workDay(t, 'budi', [r.packing]));
  const id = t.env.table('WorkReports')[0].reportId;
  t.tokens.budi = relogin(t.env, 'budi'); t.tokens.siti = relogin(t.env, 'siti'); t.tokens.rina = relogin(t.env, 'rina');
  must(t.env.api('work.photo', { reportId: id }, t.tokens.budi));
  must(t.env.api('work.photo', { reportId: id }, t.tokens.rina));
  assert.equal(t.env.api('work.photo', { reportId: id }, t.tokens.siti).code, 'FORBIDDEN');
});

test('P08 jobdesk yang sudah dipakai di laporan dinonaktifkan, bukan dihapus', () => {
  const t = bootstrap({ now: wib(DAY, '07:00') });
  const r = withRates(t);
  must(workDay(t, 'budi', [r.packing]));
  t.tokens.rina = relogin(t.env, 'rina');
  assert.equal(must(t.env.api('rates.remove', { rateId: r.packing }, t.tokens.rina)).outcome, 'deactivated');
  assert.equal(must(t.env.api('rates.remove', { rateId: r.konten }, t.tokens.rina)).outcome, 'deleted');
});

test('Q01 cache: panggilan rutin tidak membuka spreadsheet; perubahan role langsung berlaku', () => {
  const t = bootstrap({ now: wib(DAY, '07:00') });
  must(t.env.api('auth.me', {}, t.tokens.budi)); // isi cache
  const before = t.env.state.opens;
  must(t.env.api('auth.me', {}, t.tokens.budi));
  must(t.env.api('time.now'));
  assert.equal(t.env.state.opens, before, 'Users & Employees dibaca dari cache');
  const uid = t.env.table('Users').find(u => u.username === 'budi').userId;
  must(t.env.api('users.save', { userId: uid, role: 'hr', status: 'Aktif', employeeId: t.ids.budi }, t.tokens.admin));
  assert.equal(must(t.env.api('auth.me', {}, t.tokens.budi)).user.role, 'hr', 'cache lama tidak dipakai setelah perubahan');
  must(t.env.api('users.save', { userId: uid, role: 'karyawan', status: 'Nonaktif', employeeId: t.ids.budi }, t.tokens.admin));
  assert.equal(t.env.api('auth.me', {}, t.tokens.budi).code, 'AUTH_REQUIRED', 'akun nonaktif langsung tidak bisa dipakai');
});

test('Q02 cache: edit manual di spreadsheet terlihat setelah masa cache (5 menit)', () => {
  const t = bootstrap({ now: wib(DAY, '07:00') });
  must(t.env.api('employees.get', { employeeId: t.ids.budi }, t.tokens.budi));
  const sh = t.env.sheet('Employees');
  const col = sh.data[0].indexOf('noHp');
  const row = sh.data.findIndex(r => r[0] === t.ids.budi);
  sh.data[row][col] = '081299990000';
  t.env.advance(6 * 60e3);
  assert.equal(must(t.env.api('employees.get', { employeeId: t.ids.budi }, t.tokens.budi)).employee.noHp, '081299990000');
});

test('Q03 satu panggilan boot memuat pengguna, jam, notifikasi, dan dashboard', () => {
  const t = bootstrap({ now: wib(DAY, '07:00') });
  const b = must(t.env.api('app.boot', { page: 'dashboard' }, t.tokens.rina));
  assert.equal(b.user.username, 'rina');
  assert.ok(b.time.epochMs);
  assert.ok(Array.isArray(b.notif.items));
  assert.ok(b.prefetch['dashboard.summary'].team);
  const login = must(t.env.api('auth.login', { username: 'budi', password: 'Rahasiabudi2026', page: 'dashboard' }));
  assert.ok(login.token && login.user && login.time && login.prefetch['dashboard.summary'].personal);
});

test('Q04 status absensi sekaligus membawa sesi kamera & riwayat', () => {
  const t = bootstrap({ now: wib(DAY, '07:50') });
  const st = must(t.env.api('attendance.state', { withSession: true, withHistory: true }, t.tokens.budi));
  assert.match(st.session.nonce, /^[a-f0-9]{32}$/);
  assert.deepEqual(st.history, []);
  must(t.env.api('attendance.submit', Object.assign({ action: 'checkin', nonce: st.session.nonce, photo: makeJpeg() }, INSIDE), t.tokens.budi));
});

test('Q05 sheet baru dibuat otomatis tanpa menjalankan setup() ulang', () => {
  const t = bootstrap({ now: wib(DAY, '07:00') });
  const ss = t.env.state.spreadsheets.get(t.env.state.props.get('SPREADSHEET_ID'));
  ['JobRates', 'WorkReports'].forEach(n => { const sh = ss.getSheetByName(n); if (sh) ss.deleteSheet(sh); });
  must(t.env.api('rates.save', { nama: 'Packing', tarif: 1000 }, t.tokens.rina));
  assert.ok(ss.getSheetByName('JobRates'));
  assert.deepEqual(ss.getSheetByName('JobRates').data[0].slice(0, 4), ['rateId', 'nama', 'deskripsi', 'tarif']);
});
