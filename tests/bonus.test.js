'use strict';
/**
 * Uji backend: bonus penjualan paket untuk host (B..).
 * Contoh pemilik: target 40 paket/hari, jual 100 → 60 paket × Rp 500 atau Rp 1.000.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { offset, makeJpeg, wib, must, bootstrap, attend, relogin } = require('./helpers');

const DAY = '2026-10-26';
const INSIDE = Object.assign(offset(20, 15), { accuracy: 12 });
const hex = () => crypto.randomBytes(32).toString('hex');

/** Dua jenis paket: Reguler Rp 500 & Premium Rp 1.000, target 40/hari. Peserta: Budi & Siti. */
function withSchemes(t, peserta) {
  const ids = (peserta || ['budi', 'siti']).map(k => t.ids[k]);
  const reg = must(t.env.api('bonus.saveScheme', { nama: 'Paket Reguler', tarif: 500, target: 40, peserta: ids }, t.tokens.rina)).schemeId;
  const pre = must(t.env.api('bonus.saveScheme', { nama: 'Paket Premium', tarif: 1000, target: 40, peserta: ids }, t.tokens.rina)).schemeId;
  return { reg, pre };
}

function submit(t, who, items, extra) {
  return t.env.api('bonus.submit', Object.assign({ workDate: DAY, items, photo: makeJpeg(), photoOrigHash: hex(), keterangan: 'Live TikTok 19.00–23.00' }, extra || {}), t.tokens[who]);
}

test('B01 jenis paket: HR mengelola tarif, target, dan peserta; karyawan tidak bisa', () => {
  const t = bootstrap({ now: wib(DAY, '09:00') });
  const s = withSchemes(t);
  const list = must(t.env.api('bonus.schemes', {}, t.tokens.rina)).schemes;
  assert.equal(list.length, 2);
  const reg = list.find(x => x.schemeId === s.reg);
  assert.equal(reg.tarif, 500);
  assert.equal(reg.target, 40);
  assert.deepEqual(reg.pesertaNama.sort(), ['Budi Santoso', 'Siti Rahayu']);
  for (const who of ['budi', 'andi']) {
    assert.equal(t.env.api('bonus.schemes', {}, t.tokens[who]).code, 'FORBIDDEN');
    assert.equal(t.env.api('bonus.saveScheme', { nama: 'X', tarif: 1, target: 1 }, t.tokens[who]).code, 'FORBIDDEN');
  }
  assert.equal(t.env.api('bonus.saveScheme', { nama: 'Y', tarif: 1.5, target: 40 }, t.tokens.rina).code, 'VALIDATION');
  assert.equal(t.env.api('bonus.saveScheme', { nama: 'Y', tarif: 500, target: -1 }, t.tokens.rina).code, 'VALIDATION');
  assert.equal(t.env.api('bonus.saveScheme', { nama: 'paket reguler', tarif: 700, target: 10 }, t.tokens.rina).code, 'VALIDATION', 'nama ganda');
  assert.equal(t.env.api('bonus.saveScheme', { nama: 'Z', tarif: 500, target: 40, peserta: ['K999'] }, t.tokens.rina).code, 'VALIDATION', 'peserta tidak dikenal');
  // Hanya peserta yang melihat menu Bonus.
  assert.equal(must(t.env.api('auth.me', {}, t.tokens.budi)).user.hasBonus, true);
  assert.equal(must(t.env.api('auth.me', {}, t.tokens.andi)).user.hasBonus, false);
  const form = must(t.env.api('bonus.form', {}, t.tokens.budi));
  assert.equal(form.schemes.length, 2);
  assert.equal(JSON.stringify(form).indexOf(t.ids.siti), -1, 'host tidak melihat daftar peserta lain');
  assert.equal(must(t.env.api('bonus.form', {}, t.tokens.andi)).schemes.length, 0);
});

test('B02 hitungan: 100 paket − target 40 = 60 × tarif; di bawah target Rp 0; tarif & target disalin', () => {
  const t = bootstrap({ now: wib(DAY, '21:00') });
  const s = withSchemes(t);
  const res = must(submit(t, 'budi', [{ schemeId: s.reg, jumlah: 100 }, { schemeId: s.pre, jumlah: 100 }]));
  const reg = res.items.find(x => x.schemeId === s.reg);
  const pre = res.items.find(x => x.schemeId === s.pre);
  assert.equal(reg.paketBonus, 60);
  assert.equal(reg.nominal, 30000, '60 × Rp 500');
  assert.equal(pre.nominal, 60000, '60 × Rp 1.000');
  assert.equal(res.total, 90000);
  assert.equal(reg.status, 'Menunggu');
  const low = must(submit(t, 'siti', [{ schemeId: s.reg, jumlah: 30 }]));
  assert.equal(low.items[0].paketBonus, 0);
  assert.equal(low.items[0].nominal, 0, 'belum mencapai target');
  const exact = must(submit(t, 'siti', [{ schemeId: s.pre, jumlah: 40 }]));
  assert.equal(exact.items[0].nominal, 0, 'tepat di target: belum ada kelebihan');
  // Tarif diubah: laporan lama tetap.
  must(t.env.api('bonus.saveScheme', { schemeId: s.reg, nama: 'Paket Reguler', tarif: 700, target: 50, peserta: [t.ids.budi, t.ids.siti] }, t.tokens.rina));
  const row = t.env.table('BonusReports').find(x => x.employeeId === t.ids.budi && x.schemeId === s.reg);
  assert.equal(Number(row.tarif), 500);
  assert.equal(Number(row.target), 40);
  assert.equal(Number(row.nominal), 30000);
  assert.ok(t.env.state.files.get(row.photoId), 'screenshot tersimpan di Drive');
});

test('B03 aturan kirim: wajib screenshot, peserta saja, tanggal ≤ 7 hari, sekali per jenis paket per hari', () => {
  const t = bootstrap({ now: wib(DAY, '21:00') });
  const s = withSchemes(t, ['budi']);
  const one = [{ schemeId: s.reg, jumlah: 80 }];
  assert.equal(submit(t, 'budi', one, { photo: '' }).code, 'BONUS_PHOTO_INVALID');
  assert.equal(submit(t, 'siti', one).code, 'BONUS_SCHEME_INVALID', 'bukan peserta');
  assert.equal(submit(t, 'budi', one, { workDate: '2026-10-27' }).code, 'VALIDATION', 'masa depan');
  assert.equal(submit(t, 'budi', one, { workDate: '2026-10-18' }).code, 'VALIDATION', 'lebih dari 7 hari');
  assert.equal(submit(t, 'budi', [{ schemeId: s.reg, jumlah: 1.5 }]).code, 'VALIDATION');
  assert.equal(submit(t, 'budi', [{ schemeId: s.reg, jumlah: 5 }, { schemeId: s.reg, jumlah: 6 }]).code, 'VALIDATION', 'jenis ganda');
  assert.equal(submit(t, 'budi', []).code, 'VALIDATION');
  must(submit(t, 'budi', one, { workDate: '2026-10-19' }), '7 hari ke belakang masih boleh');
  must(submit(t, 'budi', one));
  assert.equal(submit(t, 'budi', one).code, 'BONUS_DUPLICATE');
  must(submit(t, 'budi', [{ schemeId: s.pre, jumlah: 50 }]), 'jenis paket lain di hari yang sama boleh');
  // Ditolak → boleh kirim ulang.
  const id = t.env.table('BonusReports').find(x => x.workDate === DAY && x.schemeId === s.reg).bonusId;
  t.tokens.rina = relogin(t.env, 'rina');
  must(t.env.api('bonus.verify', { bonusIds: [id], decision: 'Ditolak', catatan: 'Angka tidak sesuai screenshot' }, t.tokens.rina));
  must(submit(t, 'budi', [{ schemeId: s.reg, jumlah: 75 }]));
  // Jenis paket nonaktif tidak bisa dilaporkan.
  must(t.env.api('bonus.saveScheme', { schemeId: s.pre, nama: 'Paket Premium', tarif: 1000, target: 40, peserta: [t.ids.budi], status: 'Nonaktif' }, t.tokens.rina));
  assert.equal(submit(t, 'budi', [{ schemeId: s.pre, jumlah: 90 }], { workDate: '2026-10-25' }).code, 'BONUS_SCHEME_INVALID');
});

test('B04 screenshot tidak bisa dipakai ulang oleh orang lain atau untuk tanggal lain', () => {
  const t = bootstrap({ now: wib(DAY, '21:00') });
  const s = withSchemes(t);
  const shot = hex();
  must(submit(t, 'budi', [{ schemeId: s.reg, jumlah: 90 }], { photoOrigHash: shot }));
  must(submit(t, 'budi', [{ schemeId: s.pre, jumlah: 45 }], { photoOrigHash: shot }), 'orang & tanggal sama: boleh');
  assert.equal(submit(t, 'siti', [{ schemeId: s.reg, jumlah: 90 }], { photoOrigHash: shot }).code, 'DUPLICATE_PHOTO');
  assert.equal(submit(t, 'budi', [{ schemeId: s.reg, jumlah: 90 }], { photoOrigHash: shot, workDate: '2026-10-25' }).code, 'DUPLICATE_PHOTO');
  // Foto absensi tidak bisa dipakai sebagai screenshot bonus.
  const sel = hex();
  t.env.setNow(wib('2026-10-27', '07:50'));
  must(attend(t.env, relogin(t.env, 'siti'), 'checkin', INSIDE, { photoSource: 'lampiran', photoOrigHash: sel, photoAgeSec: 10 }));
  assert.equal(t.env.api('bonus.submit', { workDate: '2026-10-27', items: [{ schemeId: s.reg, jumlah: 60 }], photo: makeJpeg(), photoOrigHash: sel }, relogin(t.env, 'siti')).code, 'DUPLICATE_PHOTO');
});

test('B05 verifikasi hanya HR/Super Admin; gaji = jobdesk + bonus yang disetujui', () => {
  const t = bootstrap({ now: wib(DAY, '07:50') });
  const s = withSchemes(t);
  const rate = must(t.env.api('rates.save', { nama: 'Live jualan', tarif: 75000 }, t.tokens.rina));
  must(attend(t.env, t.tokens.budi, 'checkin', INSIDE));
  t.env.setNow(wib(DAY, '17:05'));
  must(attend(t.env, t.tokens.budi, 'checkout', INSIDE, { workRateIds: [rate.rateId] }));
  t.env.setNow(wib(DAY, '21:00'));
  ['rina', 'budi', 'siti', 'andi', 'admin'].forEach(w => { t.tokens[w] = relogin(t.env, w); });
  must(submit(t, 'budi', [{ schemeId: s.reg, jumlah: 100 }, { schemeId: s.pre, jumlah: 60 }]));
  must(submit(t, 'siti', [{ schemeId: s.reg, jumlah: 140 }]));
  const rows = t.env.table('BonusReports');
  const regBudi = rows.find(x => x.employeeId === t.ids.budi && x.schemeId === s.reg).bonusId;
  const preBudi = rows.find(x => x.employeeId === t.ids.budi && x.schemeId === s.pre).bonusId;
  const siti = rows.find(x => x.employeeId === t.ids.siti).bonusId;
  for (const who of ['budi', 'siti', 'andi']) {
    assert.equal(t.env.api('bonus.verify', { bonusIds: [siti], decision: 'Disetujui' }, t.tokens[who]).code, 'FORBIDDEN', who);
  }
  assert.equal(t.env.api('bonus.verify', { bonusIds: [preBudi], decision: 'Ditolak' }, t.tokens.rina).code, 'VALIDATION', 'tolak wajib alasan');
  must(t.env.api('bonus.verify', { bonusIds: [regBudi, siti], decision: 'Disetujui' }, t.tokens.rina));
  must(t.env.api('bonus.verify', { bonusIds: [preBudi], decision: 'Ditolak', catatan: 'Screenshot tidak menunjukkan paket premium' }, t.tokens.admin));
  must(t.env.api('work.verify', { reportIds: [t.env.table('WorkReports')[0].reportId], decision: 'Disetujui' }, t.tokens.rina));

  const sum = must(t.env.api('payroll.summary', { from: DAY, to: DAY }, t.tokens.rina));
  const budi = sum.rows.find(x => x.employeeId === t.ids.budi);
  assert.equal(budi.jobdesk, 75000);
  assert.equal(budi.bonus, 30000, 'hanya Paket Reguler (disetujui); Premium ditolak');
  assert.equal(budi.gaji, 105000);
  assert.equal(budi.ditolak.count, 1);
  const sitiRow = sum.rows.find(x => x.employeeId === t.ids.siti);
  assert.equal(sitiRow.bonus, 50000, '(140 − 40) × Rp 500');
  assert.equal(sum.totalBonus, 80000);
  assert.equal(sum.totalGaji, 155000);
  assert.ok(t.env.table('AuditLogs').some(l => l.action === 'BONUS_VERIFY'));
  // Notifikasi & dashboard HR menghitung laporan bonus yang menunggu.
  must(submit(t, 'siti', [{ schemeId: s.pre, jumlah: 70 }]));
  const notif = must(t.env.api('notif.summary', {}, t.tokens.rina));
  assert.ok(notif.items.some(i => i.route === 'gaji/bonus' && /^1 laporan bonus/.test(i.text)), JSON.stringify(notif.items));
});

test('B06 privasi: host hanya melihat bonus & screenshot miliknya', () => {
  const t = bootstrap({ now: wib(DAY, '21:00') });
  const s = withSchemes(t);
  must(submit(t, 'budi', [{ schemeId: s.reg, jumlah: 100 }]));
  must(submit(t, 'siti', [{ schemeId: s.reg, jumlah: 120 }]));
  const sitiId = t.env.table('BonusReports').find(x => x.employeeId === t.ids.siti).bonusId;
  const mine = must(t.env.api('bonus.list', { from: DAY, to: DAY }, t.tokens.budi));
  assert.equal(mine.reports.length, 1);
  assert.equal(mine.reports[0].employeeId, t.ids.budi);
  assert.equal(mine.reports.some(r => r.photoHash !== undefined), false, 'hash tidak dikirim');
  const tried = must(t.env.api('bonus.list', { from: DAY, to: DAY, employeeId: t.ids.siti }, t.tokens.budi)).reports;
  assert.deepEqual(tried.map(r => r.employeeId), [t.ids.budi], 'filter employeeId orang lain diabaikan: tetap hanya data sendiri');
  assert.equal(t.env.api('bonus.photo', { bonusId: sitiId }, t.tokens.budi).code, 'FORBIDDEN');
  assert.equal(t.env.api('bonus.photo', { bonusId: sitiId }, t.tokens.andi).code, 'FORBIDDEN');
  must(t.env.api('bonus.photo', { bonusId: sitiId }, t.tokens.siti));
  must(t.env.api('bonus.photo', { bonusId: sitiId }, t.tokens.rina));
  assert.equal(must(t.env.api('bonus.list', { from: DAY, to: DAY }, t.tokens.rina)).reports.length, 2);
});

test('B07 penanda TANPA_ABSEN bila tidak ada check-in di tanggal itu; jenis paket terpakai hanya dinonaktifkan', () => {
  const t = bootstrap({ now: wib(DAY, '07:50') });
  const s = withSchemes(t);
  must(attend(t.env, t.tokens.budi, 'checkin', INSIDE));
  t.env.setNow(wib(DAY, '21:00'));
  ['rina', 'budi', 'siti'].forEach(w => { t.tokens[w] = relogin(t.env, w); });
  must(submit(t, 'budi', [{ schemeId: s.reg, jumlah: 60 }]));
  must(submit(t, 'siti', [{ schemeId: s.reg, jumlah: 60 }]));
  const rows = t.env.table('BonusReports');
  assert.equal(rows.find(x => x.employeeId === t.ids.budi).flags, '');
  assert.equal(rows.find(x => x.employeeId === t.ids.siti).flags, 'TANPA_ABSEN');
  assert.equal(must(t.env.api('bonus.removeScheme', { schemeId: s.reg }, t.tokens.rina)).outcome, 'deactivated');
  assert.equal(must(t.env.api('bonus.removeScheme', { schemeId: s.pre }, t.tokens.rina)).outcome, 'deleted');
  assert.equal(t.env.table('BonusSchemes').length, 1);
});
