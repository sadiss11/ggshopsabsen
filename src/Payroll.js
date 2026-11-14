/**
 * Jobdesk berbayar & gaji.
 *
 * Aturan pemilik (24 Okt 2026):
 *  - Setiap jobdesk punya tarif tetap per laporan; satu jobdesk dibayar sekali per hari kerja.
 *  - Tidak ada gaji pokok: gaji = jumlah tarif laporan yang Disetujui.
 *  - Laporan dibuat saat check-out (wajib foto hasil kerja + keterangan) dan harus
 *    diverifikasi HR/Super Admin sebelum dihitung.
 *  - Rekap gaji memakai rentang tanggal bebas.
 *  - Gaji = jobdesk disetujui + bonus penjualan disetujui (lihat Bonus.js).
 */

function ratesForEmployee_(emp) {
  return rows_('JobRates')
    .filter(r => r.status !== 'Nonaktif' && (!r.departemen || r.departemen === emp.departemen))
    .sort((a, b) => String(a.nama).localeCompare(String(b.nama)));
}

function publicRate_(r) {
  return { rateId: r.rateId, nama: r.nama, deskripsi: r.deskripsi, tarif: r.tarif || 0, departemen: r.departemen };
}

/* ---------- Daftar jobdesk & tarif ---------- */

function ratesList_(ctx) {
  return {
    rates: rows_('JobRates').map(r => strip_(r)).sort((a, b) => String(a.nama).localeCompare(String(b.nama))),
    canEdit: ctx.user.role === 'admin' || ctx.user.role === 'hr',
  };
}

function ratesSave_(ctx, p) {
  const tarif = Number(p.tarif);
  if (!isFinite(tarif) || tarif < 0 || tarif > 100000000 || Math.floor(tarif) !== tarif) {
    throw appError_('Tarif harus angka bulat Rp 0 sampai Rp 100.000.000.', 'VALIDATION');
  }
  const data = {
    nama: requireText_(p.nama, 'Nama jobdesk', 80),
    deskripsi: cleanText_(p.deskripsi, 300),
    tarif: tarif,
    departemen: cleanText_(p.departemen, 60),
    status: p.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
  };
  const now = new Date().toISOString();
  let before = null;
  const id = withLock_(() => {
    const rid = cleanText_(p.rateId, 30);
    const dup = rows_('JobRates').some(r => r.rateId !== rid && r.status !== 'Nonaktif' && data.status === 'Aktif' &&
      String(r.nama).toLowerCase() === data.nama.toLowerCase() && (r.departemen || '') === data.departemen);
    if (dup) throw appError_('Jobdesk "' + data.nama + '" sudah ada untuk departemen ini.', 'VALIDATION');
    if (rid) {
      const cur = freshById_('JobRates', 'rateId', rid);
      if (!cur) throw appError_('Jobdesk tidak ditemukan.', 'NOT_FOUND');
      before = { nama: cur.nama, tarif: cur.tarif, status: cur.status };
      update_('JobRates', cur._row, Object.assign({}, data, { updatedAt: now }));
      return rid;
    }
    const nid = shortId_('TRF');
    insert_('JobRates', Object.assign({ rateId: nid }, data, { createdAt: now, updatedAt: now }));
    return nid;
  });
  audit_(ctx, before ? 'RATE_UPDATE' : 'RATE_CREATE', 'JobRate', id, 'SUCCESS', { from: before, to: { nama: data.nama, tarif: data.tarif, status: data.status } });
  return { rateId: id };
}

function ratesRemove_(ctx, p) {
  const id = cleanText_(p.rateId, 30);
  const outcome = withLock_(() => {
    const cur = freshById_('JobRates', 'rateId', id);
    if (!cur) throw appError_('Jobdesk tidak ditemukan.', 'NOT_FOUND');
    if (columnValues_('WorkReports', 'rateId').indexOf(id) >= 0) {
      update_('JobRates', cur._row, { status: 'Nonaktif', updatedAt: new Date().toISOString() });
      return 'deactivated';
    }
    deleteRow_('JobRates', cur._row);
    return 'deleted';
  });
  audit_(ctx, 'RATE_REMOVE', 'JobRate', id, 'SUCCESS', { outcome: outcome });
  return {
    outcome: outcome,
    message: outcome === 'deleted' ? 'Jobdesk dihapus.' : 'Jobdesk sudah dipakai di laporan, sehingga dinonaktifkan agar riwayat gaji tetap utuh.',
  };
}

/* ---------- Laporan kerja saat check-out ---------- */

/** Validasi isian laporan dari browser (di luar lock, tanpa akses sheet). */
function parseWorkInput_(p) {
  let photo;
  try {
    photo = decodePhoto_(p.workPhoto);
  } catch (e) {
    if (e && e.isAppError) throw appError_('Foto hasil kerja: ' + e.message.charAt(0).toLowerCase() + e.message.slice(1), 'WORK_PHOTO_INVALID');
    throw e;
  }
  const note = cleanText_(p.workNote, 500);
  if (note.length < LIMITS_.WORK_NOTE_MIN) {
    throw appError_('Tuliskan pekerjaan yang Anda kerjakan hari ini (minimal ' + LIMITS_.WORK_NOTE_MIN + ' karakter).', 'WORK_NOTE_REQUIRED');
  }
  const meta = photoMeta_(p.workPhotoSource, p.workPhotoOrigHash, p.workPhotoAgeSec);
  assertPhotoSourceAllowed_(meta);
  const raw = Array.isArray(p.workRateIds) ? p.workRateIds : [];
  const ids = raw.map(x => cleanText_(x, 30)).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  if (ids.length > LIMITS_.WORK_ITEMS_MAX) throw appError_('Maksimal ' + LIMITS_.WORK_ITEMS_MAX + ' jobdesk per hari.', 'VALIDATION');
  return { photo: photo, note: note, ids: ids, meta: meta, hash: storedPhotoHash_(photo, meta) };
}

/** Dipanggil di dalam lock check-out. Mengembalikan baris laporan yang akan disimpan. */
function buildWorkReports_(emp, work, ctx, meta) {
  const available = ratesForEmployee_(emp);
  if (available.length && !work.ids.length) {
    throw appError_('Pilih minimal satu jobdesk yang Anda kerjakan hari ini.', 'WORK_ITEMS_REQUIRED');
  }
  const byId = {};
  available.forEach(r => { byId[r.rateId] = r; });
  work.ids.forEach(id => { if (!byId[id]) throw appError_('Jobdesk yang dipilih tidak tersedia. Muat ulang halaman.', 'WORK_ITEM_INVALID'); });
  const usedWork = columnValues_('WorkReports', 'photoHash');
  const same = work.hash === meta.selfieHash || work.photo.hash === meta.selfieBytesHash;
  if (same || photoHashUsed_(work.photo.hash) || photoHashUsed_(work.hash) || usedWork.indexOf(work.photo.hash) >= 0 || usedWork.indexOf(work.hash) >= 0) {
    throw appError_('Foto hasil kerja ini sudah pernah digunakan. Ambil foto baru.', 'DUPLICATE_PHOTO');
  }
  const items = work.ids.length ? work.ids.map(id => byId[id]) : [{ rateId: '', nama: 'Tanpa jobdesk bertarif', tarif: 0 }];
  return items.map(r => ({
    reportId: shortId_('LPK'),
    attendanceId: meta.attendanceId,
    employeeId: emp.employeeId,
    workDate: meta.workDate,
    rateId: r.rateId,
    namaJobdesk: r.nama,
    tarif: Number(r.tarif) || 0,
    keterangan: work.note,
    photoId: '',
    photoHash: work.hash,
    status: 'Menunggu',
    diverifikasiOleh: '',
    diverifikasiAt: '',
    catatanVerifikasi: '',
    createdAt: meta.serverIso,
    updatedAt: meta.serverIso,
    flags: photoFlags_(work.meta).join(','),
  }));
}

/* ---------- Daftar, verifikasi, foto ---------- */

function reportView_(r, emp, ctx) {
  return Object.assign(strip_(r, ['photoHash']), {
    flags: r.flags ? String(r.flags).split(',').filter(Boolean) : [],
    nama: emp ? emp.nama : r.employeeId,
    departemen: emp ? emp.departemen : '',
    hasPhoto: !!r.photoId && r.photoId.indexOf('DIHAPUS') !== 0,
    canVerify: canVerifyReport_(ctx, r, emp),
  });
}

function canVerifyReport_(ctx, r, emp) {
  if (!emp || r.employeeId === ctx.user.employeeId) return false;
  return canManageEmployee_(ctx, emp);
}

function sumReports_(list) {
  const t = { Disetujui: { count: 0, total: 0 }, Menunggu: { count: 0, total: 0 }, Ditolak: { count: 0, total: 0 } };
  list.forEach(r => {
    const b = t[r.status] || t.Menunggu;
    b.count++;
    b.total += Number(r.tarif) || 0;
  });
  return t;
}

/**
 * Rentang daftar laporan. Tanpa tanggal: status "Menunggu" berarti semua tanggal (agar
 * semua yang perlu diverifikasi langsung tampil), status lain berarti 31 hari terakhir.
 */
function listRange_(p, status, ctx) {
  if (!p.from && !p.to) {
    if (status === 'Menunggu') return { from: '0000-00-00', to: '9999-99-99' };
    const today = todayLocal_(ctx.now.getTime());
    return { from: addDays_(today, -30), to: today };
  }
  return rangeFromPayload_(p);
}

function rangeFromPayload_(p) {
  let from = requireDate_(p.from, 'Tanggal awal');
  let to = requireDate_(p.to, 'Tanggal akhir');
  if (from > to) { const x = from; from = to; to = x; }
  if ((Date.parse(to) - Date.parse(from)) / 86400e3 + 1 > LIMITS_.PAYROLL_MAX_DAYS) {
    throw appError_('Rentang tanggal maksimal ' + LIMITS_.PAYROLL_MAX_DAYS + ' hari.', 'VALIDATION');
  }
  return { from: from, to: to };
}

function workList_(ctx, p) {
  const empMap = {};
  rows_('Employees').forEach(e => { empMap[e.employeeId] = e; });
  let list;
  const attendanceId = cleanText_(p.attendanceId, 40);
  if (attendanceId) {
    list = rows_('WorkReports').filter(r => r.attendanceId === attendanceId);
  } else {
    const status = cleanText_(p.status, 20);
    const range = listRange_(p, status, ctx);
    const dept = cleanText_(p.departemen, 60);
    const own = ctx.user.role === 'karyawan' || p.mine === true;
    const empId = own ? ctx.user.employeeId : cleanText_(p.employeeId, 20);
    list = rows_('WorkReports').filter(r => r.workDate >= range.from && r.workDate <= range.to &&
      (!status || r.status === status) && (!empId || r.employeeId === empId) &&
      (!dept || (empMap[r.employeeId] && empMap[r.employeeId].departemen === dept)));
  }
  list = list.filter(r => canSeeEmployee_(ctx, empMap[r.employeeId]));
  list.sort((a, b) => (a.workDate === b.workDate ? String(a.employeeId).localeCompare(String(b.employeeId)) : (a.workDate < b.workDate ? 1 : -1)));
  return {
    reports: list.slice(0, 1000).map(r => reportView_(r, empMap[r.employeeId], ctx)),
    totals: sumReports_(list),
    truncated: list.length > 1000,
  };
}

function workVerify_(ctx, p) {
  return verifyReports_(ctx, p.reportIds, p, { sheet: 'WorkReports', idField: 'reportId', action: 'REPORT_VERIFY', entity: 'WorkReport' });
}

/** Verifikasi laporan berbayar (jobdesk atau bonus): hanya HR/Super Admin, bukan laporan sendiri. */
function verifyReports_(ctx, rawIds, p, opt) {
  const ids = (Array.isArray(rawIds) ? rawIds : []).map(x => cleanText_(x, 30)).filter(Boolean);
  if (!ids.length) throw appError_('Pilih laporan yang akan diverifikasi.', 'VALIDATION');
  if (ids.length > 200) throw appError_('Maksimal 200 laporan sekali proses.', 'VALIDATION');
  const decision = oneOf_(p.decision, ['Disetujui', 'Ditolak', 'Menunggu'], 'Keputusan');
  const catatan = cleanText_(p.catatan, 300);
  if (decision === 'Ditolak' && !catatan) throw appError_('Tuliskan alasan penolakan agar karyawan mengetahuinya.', 'VALIDATION');
  const now = new Date().toISOString();
  let changed = 0;
  withLock_(() => {
    const empMap = {};
    rows_('Employees').forEach(e => { empMap[e.employeeId] = e; });
    const byId = {};
    rows_(opt.sheet).forEach(r => { byId[r[opt.idField]] = r; });
    const targets = ids.map(id => {
      const r = byId[id];
      if (!r) throw appError_('Laporan tidak ditemukan. Muat ulang halaman.', 'NOT_FOUND');
      if (!canVerifyReport_(ctx, r, empMap[r.employeeId])) throw appError_('Anda tidak berwenang memverifikasi laporan milik ' + (empMap[r.employeeId] ? empMap[r.employeeId].nama : r.employeeId) + '.', 'FORBIDDEN');
      if (r.paymentId) throw appError_('Laporan tanggal ' + longDate_(r.workDate) + ' sudah dibayar. Batalkan pembayarannya dulu di menu Pembayaran bila perlu dikoreksi.', 'ALREADY_PAID');
      return r;
    });
    // Baris tidak bergeser selama lock (tidak ada penghapusan), jadi _row aman dipakai berurutan.
    targets.forEach(r => {
      if (r.status === decision && r.catatanVerifikasi === catatan) return;
      update_(opt.sheet, r._row, {
        status: decision,
        diverifikasiOleh: decision === 'Menunggu' ? '' : ctx.user.username,
        diverifikasiAt: decision === 'Menunggu' ? '' : now,
        catatanVerifikasi: catatan,
        updatedAt: now,
      });
      changed++;
    });
  });
  audit_(ctx, opt.action, opt.entity, ids.length === 1 ? ids[0] : ids.length + ' laporan', 'SUCCESS', { decision: decision, changed: changed });
  return { changed: changed };
}

function workPhoto_(ctx, p) {
  return reportPhoto_(ctx, cleanText_(p.reportId, 30), { sheet: 'WorkReports', idField: 'reportId', entity: 'WorkReport', type: 'work' });
}

/** Foto bukti laporan (hasil kerja atau screenshot bonus) setelah cek hak akses. */
function reportPhoto_(ctx, id, opt) {
  const r = findBy_(opt.sheet, opt.idField, id);
  if (!r) throw appError_('Laporan tidak ditemukan.', 'NOT_FOUND');
  const emp = findBy_('Employees', 'employeeId', r.employeeId);
  if (!emp || !canSeePhoto_(ctx, emp)) {
    audit_(ctx, 'PHOTO_VIEW', opt.entity, id, 'DENIED');
    throw appError_('Anda tidak memiliki akses ke foto ini.', 'FORBIDDEN');
  }
  if (!r.photoId) throw appError_('Foto tidak tersedia.', 'NOT_FOUND');
  if (r.photoId.indexOf('DIHAPUS') === 0) throw appError_('Foto telah dihapus sesuai kebijakan retensi.', 'NOT_FOUND');
  let blob;
  try { blob = DriveApp.getFileById(r.photoId).getBlob(); } catch (e) { throw appError_('Foto tidak dapat dibuka dari Google Drive.', 'NOT_FOUND'); }
  audit_(ctx, 'PHOTO_VIEW', opt.entity, id, 'SUCCESS', { type: opt.type });
  return { dataUrl: 'data:image/jpeg;base64,' + Utilities.base64Encode(blob.getBytes()) };
}

/* ---------- Rekap gaji ---------- */

function payrollSummary_(ctx, p) {
  const range = rangeFromPayload_(p);
  const dept = cleanText_(p.departemen, 60);
  const emps = employeesInScope_(ctx).filter(e => !dept || e.departemen === dept);
  const byEmp = {};
  const bonusByEmp = {};
  emps.forEach(e => { byEmp[e.employeeId] = []; bonusByEmp[e.employeeId] = []; });
  const inRange = r => r.workDate >= range.from && r.workDate <= range.to;
  rows_('WorkReports').forEach(r => { if (byEmp[r.employeeId] && inRange(r)) byEmp[r.employeeId].push(r); });
  rows_('BonusReports').forEach(r => { if (bonusByEmp[r.employeeId] && inRange(r)) bonusByEmp[r.employeeId].push(r); });
  const rows = emps
    .filter(e => e.status === 'Aktif' || byEmp[e.employeeId].length || bonusByEmp[e.employeeId].length)
    .map(e => {
      const t = sumReports_(byEmp[e.employeeId]);
      const b = sumBonus_(bonusByEmp[e.employeeId]);
      const days = {};
      byEmp[e.employeeId].concat(bonusByEmp[e.employeeId]).forEach(r => { if (r.status === 'Disetujui') days[r.workDate] = true; });
      return {
        employeeId: e.employeeId, nama: e.nama, jabatan: e.jabatan, departemen: e.departemen, status: e.status,
        hariDibayar: Object.keys(days).length,
        disetujui: t.Disetujui,
        bonusDisetujui: b.Disetujui,
        menunggu: { count: t.Menunggu.count + b.Menunggu.count, total: t.Menunggu.total + b.Menunggu.total },
        ditolak: { count: t.Ditolak.count + b.Ditolak.count, total: t.Ditolak.total + b.Ditolak.total },
        jobdesk: t.Disetujui.total,
        bonus: b.Disetujui.total,
        gaji: t.Disetujui.total + b.Disetujui.total,
        dibayar: paidTotal_(byEmp[e.employeeId], 'tarif') + paidTotal_(bonusByEmp[e.employeeId], 'nominal'),
      };
    })
    .sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId)));
  const sum = f => rows.reduce((s, r) => s + f(r), 0);
  return {
    from: range.from, to: range.to, rows: rows,
    totalGaji: sum(r => r.gaji), totalJobdesk: sum(r => r.jobdesk), totalBonus: sum(r => r.bonus), totalMenunggu: sum(r => r.menunggu.total),
    totalDibayar: sum(r => r.dibayar), totalBelumDibayar: sum(r => r.gaji - r.dibayar),
    generatedAt: fmtLocal_(ctx.now.getTime(), 'dd/MM/yyyy HH:mm'),
  };
}

/** Jumlah laporan (WorkReports / BonusReports) menunggu verifikasi yang boleh diproses pengguna ini. */
function pendingReportCount_(ctx, sheet) {
  if (APPROVER_ROLES_.indexOf(ctx.user.role) < 0) return 0;
  const list = rows_(sheet || 'WorkReports');
  if (!list.length) return 0;
  const empMap = {};
  rows_('Employees').forEach(e => { empMap[e.employeeId] = e; });
  let n = 0;
  list.forEach(r => {
    if (r.status !== 'Menunggu') return;
    const emp = empMap[r.employeeId];
    if (emp && r.employeeId !== ctx.user.employeeId && canManageEmployee_(ctx, emp)) n++;
  });
  return n;
}

/* ---------- Pembayaran gaji: sudah & belum dibayar ---------- */

function paidTotal_(list, field) {
  return list.reduce((s, r) => s + (r.status === 'Disetujui' && r.paymentId ? Number(r[field]) || 0 : 0), 0);
}

/** Laporan jobdesk & bonus yang sudah disetujui tetapi belum dibayar (semua tanggal). */
function unpaidRows_(employeeId, sampai) {
  const pick = (sheet, field, jenis) => rows_(sheet)
    .filter(r => r.status === 'Disetujui' && !r.paymentId && (!employeeId || r.employeeId === employeeId) && (!sampai || r.workDate <= sampai))
    .map(r => ({ row: r, sheet: sheet, jenis: jenis, nominal: Number(r[field]) || 0 }));
  return pick('WorkReports', 'tarif', 'jobdesk').concat(pick('BonusReports', 'nominal', 'bonus'));
}

function payUnpaid_() {
  const empMap = {};
  rows_('Employees').forEach(e => { empMap[e.employeeId] = e; });
  const by = {};
  unpaidRows_().forEach(x => {
    const id = x.row.employeeId;
    const e = empMap[id];
    const o = by[id] || (by[id] = { employeeId: id, nama: e ? e.nama : id + ' (sudah dihapus)', jabatan: e ? e.jabatan : '', departemen: e ? e.departemen : '',
      jobdesk: 0, bonus: 0, total: 0, jumlahLaporan: 0, dari: x.row.workDate, sampai: x.row.workDate });
    o[x.jenis] += x.nominal;
    o.total += x.nominal;
    o.jumlahLaporan++;
    if (x.row.workDate < o.dari) o.dari = x.row.workDate;
    if (x.row.workDate > o.sampai) o.sampai = x.row.workDate;
  });
  const rows = Object.keys(by).map(k => by[k]).sort((a, b) => b.total - a.total || String(a.nama).localeCompare(String(b.nama)));
  return { rows: rows, total: rows.reduce((s, r) => s + r.total, 0) };
}

/**
 * Menandai gaji satu karyawan sudah dibayar: semua laporan Disetujui yang belum dibayar sampai
 * tanggal tertentu. Total yang dilihat HR dikirim ulang dan dicocokkan di dalam lock, sehingga
 * laporan yang baru disetujui di antara melihat dan menekan "Sudah dibayar" tidak ikut tanpa disadari.
 */
function payMark_(ctx, p) {
  const employeeId = requireText_(p.employeeId, 'Karyawan', 20);
  const sampai = requireDate_(p.sampai, 'Dibayar sampai tanggal');
  const expected = Number(p.expectedTotal);
  const catatan = cleanText_(p.catatan, 200);
  const nowIso = ctx.now.toISOString();
  const result = withLock_(() => {
    invalidate_('WorkReports');
    invalidate_('BonusReports');
    const items = unpaidRows_(employeeId, sampai);
    if (!items.length) throw appError_('Tidak ada laporan disetujui yang belum dibayar untuk karyawan ini.', 'VALIDATION');
    const total = items.reduce((s, x) => s + x.nominal, 0);
    if (isFinite(expected) && expected !== total) {
      throw appError_('Jumlah yang belum dibayar berubah (sekarang ' + total + '). Muat ulang halaman lalu periksa lagi.', 'PAY_CHANGED');
    }
    const emp = findBy_('Employees', 'employeeId', employeeId);
    const paymentId = shortId_('BYR');
    items.forEach(x => update_(x.sheet, x.row._row, { paymentId: paymentId, paidAt: nowIso }));
    const dates = items.map(x => x.row.workDate).sort();
    const rec = {
      paymentId: paymentId, employeeId: employeeId, nama: emp ? emp.nama : employeeId,
      dari: dates[0], sampai: dates[dates.length - 1], jumlahLaporan: items.length,
      jobdesk: items.filter(x => x.jenis === 'jobdesk').reduce((s, x) => s + x.nominal, 0),
      bonus: items.filter(x => x.jenis === 'bonus').reduce((s, x) => s + x.nominal, 0),
      total: total, catatan: catatan, status: 'Dibayar', dibayarOleh: ctx.user.username, dibayarAt: nowIso,
      dibatalkanOleh: '', dibatalkanAt: '',
    };
    insert_('Payments', rec);
    return rec;
  });
  audit_(ctx, 'PAY_MARK', 'Payment', result.paymentId, 'SUCCESS', { employeeId: employeeId, total: result.total, laporan: result.jumlahLaporan });
  return strip_(result);
}

function payHistory_(ctx, p) {
  const empId = cleanText_(p.employeeId, 20);
  const list = rows_('Payments').filter(r => !empId || r.employeeId === empId)
    .sort((a, b) => (a.dibayarAt < b.dibayarAt ? 1 : -1));
  return { payments: list.slice(0, 500).map(r => strip_(r)), total: list.filter(r => r.status === 'Dibayar').reduce((s, r) => s + (Number(r.total) || 0), 0) };
}

/** Membatalkan pembayaran yang salah: laporannya kembali menjadi "belum dibayar". */
function payCancel_(ctx, p) {
  const id = cleanText_(p.paymentId, 30);
  const nowIso = ctx.now.toISOString();
  const rec = withLock_(() => {
    const cur = freshById_('Payments', 'paymentId', id);
    if (!cur) throw appError_('Pembayaran tidak ditemukan.', 'NOT_FOUND');
    if (cur.status !== 'Dibayar') throw appError_('Pembayaran ini sudah dibatalkan.', 'VALIDATION');
    ['WorkReports', 'BonusReports'].forEach(sheet => {
      invalidate_(sheet);
      rows_(sheet).filter(r => r.paymentId === id).forEach(r => update_(sheet, r._row, { paymentId: '', paidAt: '' }));
    });
    update_('Payments', cur._row, { status: 'Dibatalkan', dibatalkanOleh: ctx.user.username, dibatalkanAt: nowIso });
    return cur;
  });
  audit_(ctx, 'PAY_CANCEL', 'Payment', id, 'SUCCESS', { employeeId: rec.employeeId, total: rec.total });
  return { ok: true };
}

/** Gaji saya: pembayaran yang sudah diterima dan jumlah yang belum dibayar. */
function payMine_(ctx) {
  const emp = ctx.employee;
  if (!emp) return { payments: [], belumDibayar: 0, sudahDibayar: 0 };
  const payments = rows_('Payments').filter(r => r.employeeId === emp.employeeId && r.status === 'Dibayar')
    .sort((a, b) => (a.dibayarAt < b.dibayarAt ? 1 : -1)).map(r => strip_(r));
  const unpaid = unpaidRows_(emp.employeeId);
  return {
    payments: payments.slice(0, 100),
    sudahDibayar: payments.reduce((s, r) => s + (Number(r.total) || 0), 0),
    belumDibayar: unpaid.reduce((s, x) => s + x.nominal, 0),
    belumDibayarLaporan: unpaid.length,
  };
}
