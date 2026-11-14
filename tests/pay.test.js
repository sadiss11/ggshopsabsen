'use strict';
/**
 * Uji backend: verifikasi semua tanggal sekaligus & pembayaran gaji (sudah/belum dibayar) (G..).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { offset, makeJpeg, wib, must, bootstrap, attend, relogin } = require('./helpers');

const INSIDE = Object.assign(offset(20, 15), { accuracy: 12 });

/** Budi check-in & check-out pada tanggal tertentu dengan jobdesk Rp 50.000. */
function workOn(t, date, rateId) {
  t.env.setNow(wib(date, '08:00'));
  must(attend(t.env, relogin(t.env, 'budi'), 'checkin', INSIDE), 'check-in ' + date);
  t.env.setNow(wib(date, '17:00'));
  must(attend(t.env, relogin(t.env, 'budi'), 'checkout', INSIDE, { workRateIds: [rateId] }), 'check-out ' + date);
}

function setupPaid() {
  const t = bootstrap({ now: wib('2026-10-01', '07:00') });
  const rate = must(t.env.api('rates.save', { nama: 'Packing', tarif: 50000 }, t.tokens.rina)).rateId;
  ['2026-10-01', '2026-10-15', '2026-11-03'].forEach(d => workOn(t, d, rate));
  t.env.setNow(wib('2026-11-05', '09:00'));
  ['rina', 'budi', 'admin', 'siti'].forEach(w => { t.tokens[w] = relogin(t.env, w); });
  return { t, rate };
}

test('G01 verifikasi: tanpa memilih tanggal, semua laporan yang menunggu dari tanggal mana pun langsung tampil', () => {
  const { t } = setupPaid();
  const all = must(t.env.api('work.list', { status: 'Menunggu', from: '', to: '', departemen: '' }, t.tokens.rina));
  assert.deepEqual(all.reports.map(r => r.workDate).sort(), ['2026-10-01', '2026-10-15', '2026-11-03']);
  assert.equal(all.totals.Menunggu.count, 3);
  const week = must(t.env.api('work.list', { status: 'Menunggu', from: '2026-10-30', to: '2026-11-05' }, t.tokens.rina));
  assert.equal(week.reports.length, 1, 'filter tanggal tetap bisa dipakai');
  const noDateAll = must(t.env.api('work.list', { status: '' }, t.tokens.rina));
  assert.deepEqual(noDateAll.reports.map(r => r.workDate).sort(), ['2026-10-15', '2026-11-03'], 'status lain tanpa tanggal = 31 hari terakhir');
  // Bonus juga.
  const s = must(t.env.api('bonus.saveScheme', { nama: 'Reguler', tarif: 500, target: 40, peserta: [t.ids.budi] }, t.tokens.rina));
  must(t.env.api('bonus.submit', { workDate: '2026-10-30', items: [{ schemeId: s.schemeId, jumlah: 100 }], photo: makeJpeg() }, t.tokens.budi));
  assert.equal(must(t.env.api('bonus.list', { status: 'Menunggu' }, t.tokens.rina)).reports.length, 1);
});

test('G02 belum dibayar → tandai sudah dibayar → muncul di riwayat, gaji saya, dan rekap', () => {
  const { t } = setupPaid();
  const ids = t.env.table('WorkReports').map(r => r.reportId);
  must(t.env.api('work.verify', { reportIds: ids.slice(0, 2), decision: 'Disetujui' }, t.tokens.rina));
  let unpaid = must(t.env.api('pay.unpaid', {}, t.tokens.rina));
  assert.equal(unpaid.rows.length, 1);
  assert.equal(unpaid.rows[0].total, 100000, 'hanya yang disetujui');
  assert.equal(unpaid.rows[0].dari, '2026-10-01');
  assert.equal(unpaid.rows[0].sampai, '2026-10-15');
  assert.equal(t.env.api('pay.mark', { employeeId: t.ids.budi, sampai: '2026-11-05', expectedTotal: 999 }, t.tokens.rina).code, 'PAY_CHANGED', 'total tidak cocok ditolak');
  const pay = must(t.env.api('pay.mark', { employeeId: t.ids.budi, sampai: '2026-11-05', expectedTotal: 100000, catatan: 'Transfer BCA' }, t.tokens.rina));
  assert.equal(pay.total, 100000);
  assert.equal(pay.jumlahLaporan, 2);
  assert.equal(must(t.env.api('pay.unpaid', {}, t.tokens.rina)).rows.length, 0);
  const hist = must(t.env.api('pay.history', {}, t.tokens.rina));
  assert.equal(hist.payments.length, 1);
  assert.equal(hist.payments[0].dibayarOleh, 'rina');
  const mine = must(t.env.api('pay.mine', {}, t.tokens.budi));
  assert.equal(mine.sudahDibayar, 100000);
  assert.equal(mine.belumDibayar, 0);
  const sum = must(t.env.api('payroll.summary', { from: '2026-10-01', to: '2026-10-31' }, t.tokens.rina));
  const b = sum.rows.find(r => r.employeeId === t.ids.budi);
  assert.equal(b.dibayar, 100000);
  assert.equal(sum.totalBelumDibayar, 0);
  // Laporan yang sudah dibayar tidak bisa diubah statusnya.
  assert.equal(t.env.api('work.verify', { reportIds: [ids[0]], decision: 'Ditolak', catatan: 'salah' }, t.tokens.rina).code, 'ALREADY_PAID');
  // Laporan ketiga disetujui belakangan → belum dibayar lagi.
  must(t.env.api('work.verify', { reportIds: [ids[2]], decision: 'Disetujui' }, t.tokens.rina));
  unpaid = must(t.env.api('pay.unpaid', {}, t.tokens.rina));
  assert.equal(unpaid.rows[0].total, 50000);
  assert.equal(must(t.env.api('pay.mine', {}, t.tokens.budi)).belumDibayar, 50000);
});

test('G03 batalkan pembayaran yang salah: laporannya kembali belum dibayar; hanya HR/Super Admin', () => {
  const { t } = setupPaid();
  must(t.env.api('work.verify', { reportIds: t.env.table('WorkReports').map(r => r.reportId), decision: 'Disetujui' }, t.tokens.rina));
  for (const who of ['budi', 'siti', 'andi']) {
    assert.equal(t.env.api('pay.unpaid', {}, relogin(t.env, who)).code, 'FORBIDDEN', who);
    assert.equal(t.env.api('pay.mark', { employeeId: t.ids.budi, sampai: '2026-11-05' }, relogin(t.env, who)).code, 'FORBIDDEN', who);
  }
  const pay = must(t.env.api('pay.mark', { employeeId: t.ids.budi, sampai: '2026-10-31', expectedTotal: 100000 }, t.tokens.admin));
  assert.equal(pay.sampai, '2026-10-15', 'hanya sampai tanggal yang dipilih');
  assert.equal(must(t.env.api('pay.unpaid', {}, t.tokens.rina)).rows[0].total, 50000, 'November belum dibayar');
  must(t.env.api('pay.cancel', { paymentId: pay.paymentId }, t.tokens.rina));
  assert.equal(must(t.env.api('pay.unpaid', {}, t.tokens.rina)).rows[0].total, 150000);
  assert.equal(must(t.env.api('pay.history', {}, t.tokens.rina)).payments[0].status, 'Dibatalkan');
  assert.equal(t.env.api('pay.cancel', { paymentId: pay.paymentId }, t.tokens.rina).code, 'VALIDATION');
  assert.ok(t.env.table('AuditLogs').some(l => l.action === 'PAY_MARK'));
  assert.ok(t.env.table('AuditLogs').some(l => l.action === 'PAY_CANCEL'));
});
