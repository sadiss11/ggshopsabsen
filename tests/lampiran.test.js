'use strict';
/**
 * Uji backend: foto dari kamera HP ("lampiran") saat kamera langsung diblokir
 * oleh iframe Google Apps Script (L..).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { offset, makeJpeg, wib, must, bootstrap, attend, relogin } = require('./helpers');

const DAY = '2026-10-26';
const INSIDE = Object.assign(offset(20, 15), { accuracy: 12 });
const hex = () => crypto.randomBytes(32).toString('hex');

function lampiran(origHash, ageSec) {
  return { photoSource: 'lampiran', photoOrigHash: origHash || hex(), photoAgeSec: ageSec === undefined ? 20 : ageSec };
}
function workLampiran(origHash, ageSec) {
  return { workPhotoSource: 'lampiran', workPhotoOrigHash: origHash || hex(), workPhotoAgeSec: ageSec === undefined ? 20 : ageSec };
}

test('L01 lampiran diterima: ditandai LAMPIRAN, hash file asli disimpan, status absensi normal', () => {
  const t = bootstrap({ now: wib(DAY, '07:50') });
  const orig = hex();
  const res = must(attend(t.env, t.tokens.budi, 'checkin', INSIDE, lampiran(orig)));
  assert.equal(res.status, 'Hadir');
  const rec = t.env.table('Attendance')[0];
  assert.equal(rec.checkInPhotoHash, orig);
  assert.ok(rec.flags.split(',').includes('IN:LAMPIRAN'), 'flags: ' + rec.flags);
  assert.ok(!rec.flags.includes('FOTO_LAMA'));
  assert.ok(rec.checkInPhotoId, 'foto tetap tersimpan di Drive');

  t.env.setNow(wib(DAY, '17:05'));
  must(attend(t.env, t.tokens.budi, 'checkout', INSIDE, Object.assign(lampiran(), workLampiran())));
  const rep = t.env.table('WorkReports')[0];
  assert.equal(rep.flags, 'LAMPIRAN');
  const view = must(t.env.api('work.list', { from: DAY, to: DAY }, t.tokens.rina)).reports[0];
  assert.deepEqual(view.flags, ['LAMPIRAN']);
  assert.ok(t.env.table('Attendance')[0].flags.split(',').includes('OUT:LAMPIRAN'));
});

test('L02 Admin menonaktifkan lampiran: selfie & foto hasil kerja dari kamera HP ditolak', () => {
  const t = bootstrap({ now: wib(DAY, '07:50') });
  const cfg = must(t.env.api('settings.get', {}, t.tokens.admin)).config;
  assert.equal(cfg.allowPhotoUpload, true, 'default: diizinkan');
  must(t.env.api('settings.save', Object.assign({}, cfg, { allowPhotoUpload: false }), t.tokens.admin));
  const state = must(t.env.api('attendance.state', {}, t.tokens.budi));
  assert.equal(state.rules.allowPhotoUpload, false);
  assert.equal(attend(t.env, t.tokens.budi, 'checkin', INSIDE, lampiran()).code, 'PHOTO_UPLOAD_DISABLED');
  assert.equal(t.env.table('Attendance').length, 0);
  t.env.advance(5000);
  must(attend(t.env, t.tokens.budi, 'checkin', INSIDE));
  t.env.setNow(wib(DAY, '17:05'));
  assert.equal(attend(t.env, t.tokens.budi, 'checkout', INSIDE, workLampiran()).code, 'PHOTO_UPLOAD_DISABLED');
  assert.equal(t.env.table('WorkReports').length, 0);
  assert.equal(t.env.table('Attendance')[0].checkOutAt, '', 'check-out tidak tersimpan sebagian');
});

test('L03 file foto yang sama tidak bisa dipakai ulang walau cap waktunya berbeda', () => {
  const t = bootstrap({ now: wib(DAY, '07:50') });
  const orig = hex();
  must(attend(t.env, t.tokens.budi, 'checkin', INSIDE, lampiran(orig)));
  // Karyawan lain mengirim file asli yang sama (hasil cap berbeda → byte JPEG berbeda).
  assert.equal(attend(t.env, t.tokens.siti, 'checkin', INSIDE, lampiran(orig)).code, 'DUPLICATE_PHOTO');
  t.env.setNow(wib(DAY, '17:05'));
  assert.equal(attend(t.env, t.tokens.budi, 'checkout', INSIDE, Object.assign(lampiran(), workLampiran(orig))).code, 'DUPLICATE_PHOTO', 'selfie pagi dipakai sebagai foto kerja');
  t.env.advance(5000);
  const selfie = hex();
  assert.equal(attend(t.env, t.tokens.budi, 'checkout', INSIDE, Object.assign(lampiran(selfie), workLampiran(selfie))).code, 'DUPLICATE_PHOTO', 'selfie = foto kerja');
  t.env.advance(5000);
  const work = hex();
  must(attend(t.env, t.tokens.budi, 'checkout', INSIDE, Object.assign(lampiran(), workLampiran(work))));
  // Foto hasil kerja kemarin dipakai sebagai selfie besok.
  t.env.setNow(wib('2026-10-27', '07:50'));
  assert.equal(attend(t.env, relogin(t.env, 'budi'), 'checkin', INSIDE, lampiran(work)).code, 'DUPLICATE_PHOTO');
});

test('L04 umur file > 15 menit ditandai FOTO_LAMA; data meta tidak valid diabaikan dengan aman', () => {
  const t = bootstrap({ now: wib(DAY, '07:50') });
  must(attend(t.env, t.tokens.budi, 'checkin', INSIDE, lampiran(hex(), 3600)));
  const flags = t.env.table('Attendance')[0].flags.split(',');
  assert.ok(flags.includes('IN:LAMPIRAN') && flags.includes('IN:FOTO_LAMA'), flags.join(','));

  // Hash asli tidak valid → memakai hash byte JPEG; umur tidak valid → tanpa penanda umur.
  must(attend(t.env, t.tokens.siti, 'checkin', INSIDE, { photoSource: 'lampiran', photoOrigHash: '<script>', photoAgeSec: 'x' }));
  const siti = t.env.table('Attendance').find(r => r.employeeId === t.ids.siti);
  assert.match(siti.checkInPhotoHash, /^[a-f0-9]{64}$/);
  assert.equal(siti.flags.split(',').filter(f => f.endsWith('FOTO_LAMA')).length, 0);

  // Sumber lain dari klien diperlakukan sebagai kamera langsung (tanpa penanda lampiran).
  must(attend(t.env, t.tokens.andi, 'checkin', INSIDE, { photoSource: 'galeri' }));
  const andi = t.env.table('Attendance').find(r => r.employeeId === t.ids.andi);
  assert.ok(!andi.flags.includes('LAMPIRAN'));
});

test('L05 lampiran tetap wajib lolos validasi lokasi, jam server, dan JPEG', () => {
  const t = bootstrap({ now: wib(DAY, '07:50') });
  assert.equal(attend(t.env, t.tokens.budi, 'checkin', Object.assign(offset(400, 0), { accuracy: 10 }), lampiran()).code, 'OUTSIDE_RADIUS');
  t.env.advance(5000);
  assert.equal(attend(t.env, t.tokens.budi, 'checkin', INSIDE, Object.assign(lampiran(), { photo: 'data:image/png;base64,' + 'A'.repeat(400) })).code, 'PHOTO_INVALID');
  t.env.advance(5000);
  const res = must(attend(t.env, t.tokens.budi, 'checkin', INSIDE, Object.assign(lampiran(), { clientTime: '2026-10-26T06:00:00+07:00', timestamp: 1 })));
  assert.equal(res.serverTime.local.slice(0, 5), '07:50');
  assert.equal(makeJpeg().slice(0, 23), 'data:image/jpeg;base64,');
});
