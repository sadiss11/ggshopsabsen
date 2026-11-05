/**
 * Absensi: status hari ini, sesi kamera (nonce), pra-cek lokasi, check-in,
 * check-out, riwayat, dan koreksi oleh HR.
 *
 * Alur keamanan check-in/check-out (attendanceSubmit_):
 *  1. Waktu resmi = waktu penerimaan permintaan di server (ctx.now).
 *  2. Payload di-whitelist: action, nonce, photo, lat, lng, accuracy, faceCheck, note.
 *     Timestamp, koordinat kantor, radius, status, employeeId dari browser diabaikan.
 *  3. Di dalam Script Lock: nonce diverifikasi, aturan absensi & duplikasi dievaluasi
 *     ulang dari sheet, lokasi divalidasi ulang, hash foto dicek, foto disimpan,
 *     lalu baris ditulis. Nonce dihapus setelah transaksi berhasil.
 */

function fmtMin_(m) {
  m = Math.max(0, Math.round(m));
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return r + ' menit';
  return h + ' jam' + (r ? ' ' + r + ' menit' : '');
}

function localTimeOf_(iso, pattern) {
  return iso ? fmtLocal_(Date.parse(iso), pattern || 'HH:mm') : '';
}

/**
 * Catatan absensi karyawan untuk tanggal-tanggal tertentu. Di dalam lock (transaksi)
 * kolom kunci dibaca langsung dari sheet; untuk tampilan status cukup bagian akhir
 * sheet yang di-cache (catatan hari ini & kemarin selalu ada di sana).
 */
function recordsFor_(employeeId, dates) {
  const keys = dates.map(d => employeeId + '|' + d);
  const out = {};
  if (LOCK_DEPTH_ === 0) {
    const tail = rowsTail_('Attendance', tailSize_(7));
    for (let i = tail.length - 1; i >= 0; i--) {
      const idx = keys.indexOf(String(tail[i].key));
      if (idx >= 0 && !out[dates[idx]]) out[dates[idx]] = tail[i];
    }
    return out;
  }
  const vals = columnValues_('Attendance', 'key');
  for (let i = vals.length - 1; i >= 0; i--) {
    const idx = keys.indexOf(String(vals[i]));
    if (idx >= 0 && !out[dates[idx]]) out[dates[idx]] = readRow_('Attendance', i + 2);
  }
  return out;
}

function approvedLeaveOn_(employeeId, date) {
  return rows_('LeaveRequests').filter(l => l.employeeId === employeeId && l.status === 'Disetujui' &&
    l.tanggalMulai <= date && date <= l.tanggalSelesai)[0] || null;
}

/** Batas check-out untuk catatan yang belum check-out: pukul 04.00 sehari setelah tanggal kerja. */
function checkoutDeadline_(workDate) {
  return localToEpoch_(addDays_(workDate, 1), LIMITS_.CHECKOUT_UNTIL_MIN, getConfig_().timezone);
}

/**
 * Mengevaluasi aturan absensi untuk saat ini. Dipakai oleh tampilan status
 * maupun oleh transaksi (sumber aturan tunggal).
 *
 * Aturan pemilik (5 Nov 2026): tidak ada jadwal/shift. Karyawan bebas check-in
 * kapan saja (sekali per tanggal) dan check-out kapan saja setelahnya, paling
 * lambat pukul 04.00 keesokan hari. Status selalu Hadir; tidak ada terlambat,
 * pulang cepat, atau alpha otomatis.
 */
function attendanceEval_(emp, nowMs) {
  const today = todayLocal_(nowMs);
  const yest = addDays_(today, -1);
  const recs = recordsFor_(emp.employeeId, [today, yest]);
  const base = { today: today, schedule: null, records: recs };

  // 1) Transaksi terbuka: sudah check-in, belum check-out, masih dalam batas check-out.
  const dates = [today, yest];
  for (let i = 0; i < dates.length; i++) {
    const r = recs[dates[i]];
    if (r && r.checkInAt && !r.checkOutAt && nowMs <= checkoutDeadline_(dates[i])) {
      return Object.assign(base, { mode: 'checkout', workDate: dates[i], record: r }, evalCheckOut_(r, nowMs));
    }
  }

  // 2) Sudah check-in hari ini.
  const r = recs[today];
  if (r && r.checkInAt) {
    return Object.assign(base, {
      mode: 'done', workDate: today, record: r, ok: false,
      code: r.checkOutAt ? 'DONE' : 'CHECKOUT_CLOSED',
      message: r.checkOutAt
        ? 'Absensi hari ini sudah lengkap (masuk ' + localTimeOf_(r.checkInAt) + ', pulang ' + localTimeOf_(r.checkOutAt) + ').'
        : 'Batas waktu check-out telah lewat, sehingga absensi tercatat tanpa jam pulang. Sampaikan keterangan kepada HR bila diperlukan.',
    });
  }
  const leave = approvedLeaveOn_(emp.employeeId, today);
  if (leave) {
    return Object.assign(base, { mode: 'checkin', workDate: today, ok: false, code: 'ON_LEAVE', message: 'Anda tercatat ' + leave.jenis + ' (disetujui) pada tanggal ini. Hubungi HR bila perlu pembatalan.' });
  }
  return Object.assign(base, {
    mode: 'checkin', workDate: today, ok: true, code: 'OK', status: 'Hadir', lateMinutes: 0,
    message: 'Anda dapat check-in kapan saja. Jam masuk tercatat sesuai jam server.',
  });
}

function evalCheckOut_(r, nowMs) {
  const inMs = Date.parse(r.checkInAt);
  if (nowMs - inMs < LIMITS_.MIN_CHECKOUT_GAP_MIN * 60000) {
    return { ok: false, code: 'TOO_SOON', message: 'Check-out dapat dilakukan minimal ' + LIMITS_.MIN_CHECKOUT_GAP_MIN + ' menit setelah check-in.' };
  }
  return { ok: true, code: 'OK', checkOutStatus: 'Normal', earlyMinutes: 0, message: 'Anda dapat check-out kapan saja. Jam pulang tercatat sesuai jam server.' };
}

function locationName_(id) {
  if (!id) return '';
  const l = findBy_('WorkLocations', 'locationId', id);
  return l ? l.nama : '';
}

/** Ringkasan catatan untuk browser. Koordinat & flags hanya untuk role berwenang. */
function summarizeRecord_(r, opts) {
  if (!r) return null;
  opts = opts || {};
  const alive = id => !!id && id.indexOf('DIHAPUS') !== 0;
  const o = {
    attendanceId: r.attendanceId,
    employeeId: r.employeeId,
    workDate: r.workDate,
    workDateLabel: r.workDate ? longDate_(r.workDate) : '',
    checkIn: localTimeOf_(r.checkInAt, 'HH:mm:ss'),
    checkOut: localTimeOf_(r.checkOutAt, 'HH:mm:ss'),
    status: r.status,
    lateMinutes: r.lateMinutes || 0,
    checkOutStatus: r.checkOutStatus || '',
    earlyMinutes: r.earlyMinutes || 0,
    workMinutes: r.workMinutes || 0,
    checkInDistance: r.checkInDistance,
    checkOutDistance: r.checkOutDistance,
    checkInAccuracy: r.checkInAccuracy,
    checkOutAccuracy: r.checkOutAccuracy,
    locationName: locationName_(r.checkInLocationId),
    checkOutLocationName: locationName_(r.checkOutLocationId),
    hasPhotoIn: alive(r.checkInPhotoId),
    hasPhotoOut: alive(r.checkOutPhotoId),
    note: r.note || '',
  };
  if (opts.audit) o.flags = r.flags ? r.flags.split(',').filter(Boolean) : [];
  if (opts.coords) {
    o.checkInLat = r.checkInLat; o.checkInLng = r.checkInLng;
    o.checkOutLat = r.checkOutLat; o.checkOutLng = r.checkOutLng;
    o.checkInAt = r.checkInAt; o.checkOutAt = r.checkOutAt;
  }
  return o;
}

function attendanceState_(ctx, p) {
  p = p || {};
  const cfg = getConfig_();
  const time = timeNow_(ctx);
  if (!ctx.employee) {
    return { noEmployee: true, serverTime: time, message: 'Akun Anda belum terhubung dengan data karyawan, sehingga tidak dapat melakukan absensi. Hubungi Admin.' };
  }
  if (ctx.employee.status !== 'Aktif') {
    return { noEmployee: true, serverTime: time, message: 'Data karyawan Anda berstatus tidak aktif. Hubungi HR.' };
  }
  const emp = ctx.employee;
  const ev = attendanceEval_(emp, ctx.now.getTime());
  const rec = ev.record || ev.records[ev.workDate] || null;
  const out = {
    employee: { employeeId: emp.employeeId, nama: emp.nama, jabatan: emp.jabatan, departemen: emp.departemen },
    serverTime: time,
    mode: ev.mode,
    ok: ev.ok,
    code: ev.code,
    message: ev.message,
    workDate: ev.workDate,
    workDateLabel: longDate_(ev.workDate),
    preview: {
      status: ev.status || '', lateMinutes: ev.lateMinutes || 0,
      checkOutStatus: ev.checkOutStatus || '', earlyMinutes: ev.earlyMinutes || 0,
    },
    schedule: null,
    record: summarizeRecord_(rec),
    rules: {
      gpsMaxAccuracy: cfg.gpsMaxAccuracy,
      faceCheck: cfg.faceCheck,
      nonceTtlSec: LIMITS_.NONCE_TTL_SEC,
      allowPhotoUpload: cfg.allowPhotoUpload,
    },
    locations: locationsForEmployee_(emp).map(l => ({ nama: l.nama, radius: l.radius })),
    work: ev.mode === 'checkout' ? { required: true, rates: ratesForEmployee_(emp).map(publicRate_) } : null,
  };
  if (p.withSession && ev.ok && (ev.mode === 'checkin' || ev.mode === 'checkout')) out.session = attendanceBegin_(ctx, { action: ev.mode });
  if (p.withHistory) out.history = attendanceHistory_(ctx, { days: 31 }).records;
  return out;
}

/** Membuka sesi kamera: nonce sekali pakai yang mengikat foto ke pengguna & waktu server. */
function attendanceBegin_(ctx, p) {
  requireEmployee_(ctx);
  const action = p.action === 'checkout' ? 'checkout' : 'checkin';
  rateLimit_('nb_' + ctx.user.userId, 30, 600, 'Terlalu sering membuka sesi kamera. Tunggu beberapa menit.');
  const nonce = uid_();
  CacheService.getScriptCache().put('nonce_' + nonce,
    JSON.stringify({ u: ctx.user.userId, a: action, t: ctx.now.getTime() }), LIMITS_.NONCE_TTL_SEC);
  return { nonce: nonce, ttlSec: LIMITS_.NONCE_TTL_SEC };
}

function attendanceCheckLocation_(ctx, p) {
  const emp = requireEmployee_(ctx);
  rateLimit_('cl_' + ctx.user.userId, 60, 600, 'Terlalu sering memeriksa lokasi. Tunggu sebentar.');
  const v = validateLocation_(emp, parseReading_(p));
  return {
    ok: v.ok, code: v.code, message: v.message,
    distance: v.distance === undefined ? null : v.distance,
    radius: v.radius === undefined ? null : v.radius,
    accuracy: v.accuracy === undefined ? null : v.accuracy,
    maxAccuracy: v.maxAccuracy,
    locationName: v.location ? v.location.nama : '',
  };
}

function checkNonce_(nonce, userId, action, nowMs) {
  const key = 'nonce_' + nonce;
  const raw = CacheService.getScriptCache().get(key);
  let n = null;
  try { n = raw ? JSON.parse(raw) : null; } catch (e) { n = null; }
  if (!n || n.u !== userId || n.a !== action || nowMs - Number(n.t) > LIMITS_.NONCE_TTL_SEC * 1000 || nowMs < Number(n.t)) {
    throw appError_('Sesi foto tidak valid atau sudah kedaluwarsa. Silakan ambil ulang foto.', 'NONCE_INVALID');
  }
  return key;
}

function assertAction_(ev, action) {
  if (action === 'checkin') {
    if (ev.mode === 'checkout' || (ev.mode === 'done' && ev.record)) {
      throw appError_('Anda sudah check-in pada ' + longDate_(ev.workDate) + ' pukul ' + localTimeOf_(ev.record.checkInAt) + '.', 'DUPLICATE_CHECKIN');
    }
  } else {
    if (ev.mode === 'done' && ev.record && ev.record.checkOutAt) {
      throw appError_('Anda sudah check-out pada ' + longDate_(ev.workDate) + ' pukul ' + localTimeOf_(ev.record.checkOutAt) + '.', 'DUPLICATE_CHECKOUT');
    }
    if (ev.mode === 'checkin') throw appError_('Anda belum melakukan check-in hari ini.', 'NO_CHECKIN');
  }
  if (!ev.ok) throw appError_(ev.message, ev.code);
}

function attendanceSubmit_(ctx, p) {
  const emp = requireEmployee_(ctx);
  const action = p.action === 'checkin' || p.action === 'checkout' ? p.action : null;
  if (!action) throw appError_('Jenis absensi tidak valid.', 'BAD_REQUEST');
  const nonce = String(p.nonce || '');
  if (!/^[a-f0-9]{32}$/.test(nonce)) throw appError_('Sesi foto tidak valid. Silakan ambil ulang foto.', 'NONCE_INVALID');
  const reading = parseReading_(p);
  const faceCheck = ['detected', 'not_detected', 'unsupported', 'off'].indexOf(p.faceCheck) >= 0 ? p.faceCheck : 'off';
  const selfieMeta = photoMeta_(p.photoSource, p.photoOrigHash, p.photoAgeSec);
  const note = cleanText_(p.note, 200);
  const nowMs = ctx.now.getTime();
  const serverIso = ctx.now.toISOString();
  const tag = action === 'checkin' ? 'CHECKIN' : 'CHECKOUT';

  const cache = CacheService.getScriptCache();
  const cdKey = 'cd_' + ctx.user.userId;
  if (cache.get(cdKey)) {
    audit_(ctx, tag, 'Attendance', emp.employeeId, 'DENIED', { code: 'RATE_LIMIT' });
    throw appError_('Permintaan sebelumnya masih diproses. Tunggu beberapa detik lalu coba lagi.', 'RATE_LIMIT');
  }
  cache.put(cdKey, '1', LIMITS_.SUBMIT_COOLDOWN_SEC);

  let savedFileId = null;
  let savedWorkId = null;
  let written = false;
  let auditInfo = {};
  try {
    assertPhotoSourceAllowed_(selfieMeta);
    const photo = decodePhoto_(p.photo);
    const selfieHash = storedPhotoHash_(photo, selfieMeta);
    const work = action === 'checkout' ? parseWorkInput_(p) : null;
    const receipt = withLock_(() => {
      const nonceKey = checkNonce_(nonce, ctx.user.userId, action, nowMs);
      const ev = attendanceEval_(emp, nowMs);
      auditInfo = { mode: ev.mode, workDate: ev.workDate };
      assertAction_(ev, action);

      const loc = validateLocation_(emp, reading);
      auditInfo.distance = loc.distance; auditInfo.accuracy = loc.accuracy;
      if (!loc.ok) throw appError_(loc.message, loc.code);

      if (photoHashUsed_(photo.hash) || (selfieHash !== photo.hash && photoHashUsed_(selfieHash))) {
        throw appError_('Foto ini sudah pernah digunakan. Ambil foto baru melalui kamera.', 'DUPLICATE_PHOTO');
      }

      const prefix = action === 'checkin' ? 'IN:' : 'OUT:';
      const flags = loc.flags.slice();
      if (faceCheck === 'not_detected' && getConfig_().faceCheck === 'advisory') flags.push('FACE_NOT_DETECTED');
      photoFlags_(selfieMeta).forEach(f => flags.push(f));
      const prev = action === 'checkout'
        ? { lat: ev.record.checkInLat, lng: ev.record.checkInLng, atMs: Date.parse(ev.record.checkInAt) }
        : prevCheckout_(ev);
      const tf = travelFlag_(prev, { lat: reading.lat, lng: reading.lng, atMs: nowMs });
      if (tf) flags.push(tf);

      const localStr = fmtLocal_(nowMs, 'yyyy-MM-dd HH:mm:ss');
      const accuracy = round_(reading.accuracy, 1);
      let attendanceId, rec, reports = null;

      if (action === 'checkin') {
        attendanceId = 'ABS-' + ev.workDate.replace(/-/g, '') + '-' + uid_().slice(0, 8).toUpperCase();
        savedFileId = savePhoto_(photo, { workDate: ev.workDate, employeeId: emp.employeeId, action: 'masuk', attendanceId: attendanceId, serverIso: serverIso });
        rec = {
          attendanceId: attendanceId,
          key: emp.employeeId + '|' + ev.workDate,
          employeeId: emp.employeeId,
          workDate: ev.workDate,
          scheduleId: '',
          status: ev.status,
          lateMinutes: ev.lateMinutes,
          checkInAt: serverIso,
          checkInLocal: localStr,
          checkInPhotoId: savedFileId,
          checkInPhotoHash: selfieHash,
          checkInLat: reading.lat,
          checkInLng: reading.lng,
          checkInAccuracy: accuracy,
          checkInDistance: loc.distance,
          checkInLocationId: loc.location.locationId,
          flags: flags.map(f => prefix + f).join(','),
          note: note,
          createdAt: serverIso,
          updatedAt: serverIso,
          updatedBy: ctx.user.userId,
        };
        insert_('Attendance', rec);
        written = true;
      } else {
        rec = ev.record;
        attendanceId = rec.attendanceId;
        reports = buildWorkReports_(emp, work, ctx, { attendanceId: attendanceId, workDate: ev.workDate, serverIso: serverIso, selfieHash: selfieHash, selfieBytesHash: photo.hash });
        savedFileId = savePhoto_(photo, { workDate: ev.workDate, employeeId: emp.employeeId, action: 'pulang', attendanceId: attendanceId, serverIso: serverIso });
        savedWorkId = savePhoto_(work.photo, { workDate: ev.workDate, employeeId: emp.employeeId, action: 'jobdesk', attendanceId: attendanceId, serverIso: serverIso });
        reports.forEach(r => { r.photoId = savedWorkId; });
        const workMin = Math.max(0, Math.round((nowMs - Date.parse(rec.checkInAt)) / 60000));
        const allFlags = (rec.flags ? rec.flags.split(',') : []).concat(flags.map(f => prefix + f)).filter(Boolean);
        const patch = {
          checkOutAt: serverIso,
          checkOutLocal: localStr,
          checkOutPhotoId: savedFileId,
          checkOutPhotoHash: selfieHash,
          checkOutLat: reading.lat,
          checkOutLng: reading.lng,
          checkOutAccuracy: accuracy,
          checkOutDistance: loc.distance,
          checkOutLocationId: loc.location.locationId,
          checkOutStatus: ev.checkOutStatus,
          earlyMinutes: ev.earlyMinutes,
          workMinutes: workMin,
          flags: allFlags.join(','),
          note: note ? (rec.note ? rec.note + ' | ' : '') + note : rec.note,
          updatedAt: serverIso,
          updatedBy: ctx.user.userId,
        };
        update_('Attendance', rec._row, patch);
        written = true;
        reports.forEach(r => insert_('WorkReports', r));
        rec = Object.assign({}, rec, patch);
      }
      cache.remove(nonceKey);
      auditInfo.flags = flags;
      if (reports) auditInfo.workItems = reports.length;
      return {
        attendanceId: attendanceId,
        action: action,
        workDate: ev.workDate,
        workDateLabel: longDate_(ev.workDate),
        serverTime: { epochMs: nowMs, iso: serverIso, local: fmtLocal_(nowMs, 'HH:mm:ss'), timezone: getConfig_().timezone },
        status: rec.status,
        lateMinutes: rec.lateMinutes || 0,
        checkOutStatus: rec.checkOutStatus || '',
        earlyMinutes: rec.earlyMinutes || 0,
        workMinutes: rec.workMinutes || 0,
        location: { nama: loc.location.nama, distance: loc.distance, accuracy: accuracy, radius: loc.radius },
        work: reports ? {
          items: reports.map(r => ({ nama: r.namaJobdesk, tarif: r.tarif })),
          total: reports.reduce((s, r) => s + r.tarif, 0),
          status: 'Menunggu',
        } : null,
      };
    });
    audit_(ctx, tag, 'Attendance', receipt.attendanceId, 'SUCCESS', auditInfo);
    return receipt;
  } catch (e) {
    if (!written) {
      if (savedFileId) trashQuietly_(savedFileId);
      if (savedWorkId) trashQuietly_(savedWorkId);
    }
    if (e && e.isAppError) {
      auditInfo.code = e.code;
      audit_(ctx, tag, 'Attendance', emp.employeeId, 'FAIL', auditInfo);
    }
    throw e;
  }
}

function prevCheckout_(ev) {
  const keys = Object.keys(ev.records).sort().reverse();
  for (let i = 0; i < keys.length; i++) {
    const r = ev.records[keys[i]];
    if (r && r.checkOutAt && r.checkOutLat !== null) return { lat: r.checkOutLat, lng: r.checkOutLng, atMs: Date.parse(r.checkOutAt) };
  }
  return null;
}

/** Perkiraan jumlah baris terakhir Attendance yang mencakup N hari terakhir untuk semua karyawan aktif. */
/**
 * Baris absensi sejak tanggal tertentu. Cukup bagian akhir sheet (di-cache) bila bagian itu
 * terbukti sudah mencakup tanggal awal; selain itu seluruh sheet dibaca.
 */
function attendanceSince_(fromDate, nowMs) {
  const days = Math.round((Date.parse(todayLocal_(nowMs)) - Date.parse(fromDate)) / 86400e3) + 1;
  if (days > 0 && days <= 62) {
    const active = rows_('Employees').filter(e => e.status === 'Aktif').length || 1;
    const n = active * (days + 3) + 50;
    if (n <= LIMITS_.HISTORY_TAIL_ROWS) {
      const tail = rowsTail_('Attendance', n);
      // Baris ditambahkan berurutan waktu: bila baris pertama bagian akhir lebih tua dari tanggal awal
      // (atau sheet memang sependek itu), seluruh periode sudah termuat.
      if (tail.length < n || (tail[0] && tail[0].workDate < fromDate)) return tail;
    }
  }
  return rows_('Attendance');
}

function tailSize_(days) {
  const active = rows_('Employees').filter(e => e.status === 'Aktif').length || 1;
  return Math.min(LIMITS_.HISTORY_TAIL_ROWS, Math.max(200, active * (days + 3) + 50));
}

/** Riwayat absensi milik sendiri, atau milik karyawan lain bila berwenang. */
function attendanceHistory_(ctx, p) {
  let emp = ctx.employee;
  const reqId = cleanText_(p.employeeId, 20);
  if (reqId && (!emp || reqId !== emp.employeeId)) {
    emp = findBy_('Employees', 'employeeId', reqId);
    if (!emp || !canSeeEmployee_(ctx, emp)) throw appError_('Anda tidak memiliki akses ke data ini.', 'FORBIDDEN');
  }
  if (!emp) return { records: [] };
  const days = p.days ? intIn_(p.days, 1, 93, 'Rentang hari') : 31;
  const from = addDays_(todayLocal_(ctx.now.getTime()), -(days - 1));
  const audit = APPROVER_ROLES_.indexOf(ctx.user.role) >= 0 && emp.employeeId !== ctx.user.employeeId;
  const list = rowsTail_('Attendance', tailSize_(days))
    .filter(r => r.employeeId === emp.employeeId && r.workDate >= from)
    .sort((a, b) => (a.workDate < b.workDate ? 1 : -1))
    .map(r => summarizeRecord_(r, { audit: audit }));
  return { records: list };
}

/** Daftar absensi seluruh karyawan, khusus Super Admin & HRD. */
function attendanceList_(ctx, p) {
  let from = requireDate_(p.from, 'Tanggal awal');
  let to = requireDate_(p.to, 'Tanggal akhir');
  if (from > to) { const t = from; from = to; to = t; }
  if ((Date.parse(to) - Date.parse(from)) / 86400e3 > LIMITS_.REPORT_MAX_DAYS) {
    throw appError_('Rentang tanggal maksimal ' + LIMITS_.REPORT_MAX_DAYS + ' hari.', 'VALIDATION');
  }
  const empMap = {};
  employeesInScope_(ctx).forEach(e => { empMap[e.employeeId] = e; });
  const dept = cleanText_(p.departemen, 60);
  const empId = cleanText_(p.employeeId, 20);
  const coords = ctx.user.role === 'admin' || ctx.user.role === 'hr';
  const records = attendanceSince_(from, ctx.now.getTime())
    .filter(r => r.workDate >= from && r.workDate <= to && empMap[r.employeeId] &&
      (!empId || r.employeeId === empId) && (!dept || empMap[r.employeeId].departemen === dept))
    .map(r => {
      const e = empMap[r.employeeId];
      return Object.assign(summarizeRecord_(r, { audit: true, coords: coords }), { nama: e.nama, departemen: e.departemen, jabatan: e.jabatan });
    })
    .sort((a, b) => (a.workDate === b.workDate ? (a.checkIn < b.checkIn ? 1 : -1) : (a.workDate < b.workDate ? 1 : -1)));
  return {
    records: records,
    canEdit: ctx.user.role === 'admin' || ctx.user.role === 'hr',
    showCoords: coords,
  };
}

/** Koreksi status/catatan oleh Admin/HR. Waktu & foto tidak dapat diubah. */
function attendanceUpdate_(ctx, p) {
  const id = cleanText_(p.attendanceId, 40);
  const status = oneOf_(p.status, STATUS_ATTENDANCE_, 'Status');
  const note = cleanText_(p.note, 300);
  let before;
  withLock_(() => {
    const rec = freshById_('Attendance', 'attendanceId', id);
    if (!rec) throw appError_('Data absensi tidak ditemukan.', 'NOT_FOUND');
    before = { status: rec.status, note: rec.note };
    update_('Attendance', rec._row, { status: status, note: note, updatedAt: new Date().toISOString(), updatedBy: ctx.user.userId });
  });
  audit_(ctx, 'ATTENDANCE_EDIT', 'Attendance', id, 'SUCCESS', { from: before, to: { status: status, note: note } });
  return true;
}
