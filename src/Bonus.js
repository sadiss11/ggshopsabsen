/**
 * Bonus penjualan paket, khusus karyawan yang dipilih HR (mis. host live).
 *
 * Aturan pemilik (24 Okt 2026):
 *  - Setiap jenis paket punya tarif per paket dan target minimal per hari sendiri.
 *  - Bonus per hari = (paket terjual − target) × tarif. Di bawah target = Rp 0.
 *  - Host menulis jumlah paket dan wajib melampirkan screenshot penjualan.
 *  - Hanya laporan yang Disetujui HR/Super Admin yang dihitung ke gaji.
 */

function bonusParticipants_(s) {
  return String(s.peserta || '').split(',').map(x => x.trim()).filter(Boolean);
}

function schemesForEmployee_(emp) {
  if (!emp || emp.status !== 'Aktif') return [];
  return rows_('BonusSchemes')
    .filter(s => s.status !== 'Nonaktif' && bonusParticipants_(s).indexOf(emp.employeeId) >= 0)
    .sort((a, b) => String(a.nama).localeCompare(String(b.nama)));
}

function publicScheme_(s) {
  return { schemeId: s.schemeId, nama: s.nama, deskripsi: s.deskripsi, tarif: Number(s.tarif) || 0, target: Number(s.target) || 0 };
}

function bonusAmount_(jumlah, target, tarif) {
  const paket = Math.max(0, jumlah - target);
  return { paketBonus: paket, nominal: paket * tarif };
}

/* ---------- Jenis paket & peserta (HR) ---------- */

function bonusSchemes_() {
  const empMap = {};
  rows_('Employees').forEach(e => { empMap[e.employeeId] = e; });
  return {
    schemes: rows_('BonusSchemes').map(s => Object.assign(strip_(s), {
      tarif: Number(s.tarif) || 0,
      target: Number(s.target) || 0,
      peserta: bonusParticipants_(s),
      pesertaNama: bonusParticipants_(s).map(id => (empMap[id] ? empMap[id].nama : id)),
    })).sort((a, b) => String(a.nama).localeCompare(String(b.nama))),
  };
}

function bonusSaveScheme_(ctx, p) {
  const tarif = Number(p.tarif);
  if (!isFinite(tarif) || tarif < 0 || tarif > 100000000 || Math.floor(tarif) !== tarif) {
    throw appError_('Bonus per paket harus angka bulat Rp 0 sampai Rp 100.000.000.', 'VALIDATION');
  }
  const ids = (Array.isArray(p.peserta) ? p.peserta : []).map(x => cleanText_(x, 20)).filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
  if (ids.length > 500) throw appError_('Peserta maksimal 500 karyawan.', 'VALIDATION');
  const known = {};
  rows_('Employees').forEach(e => { known[e.employeeId] = true; });
  ids.forEach(id => { if (!known[id]) throw appError_('Karyawan ' + id + ' tidak ditemukan. Muat ulang halaman.', 'VALIDATION'); });
  const data = {
    nama: requireText_(p.nama, 'Nama jenis paket', 80),
    deskripsi: cleanText_(p.deskripsi, 300),
    tarif: tarif,
    target: intIn_(p.target, 0, LIMITS_.BONUS_MAX_PAKET, 'Target minimal per hari'),
    peserta: ids.join(','),
    status: p.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
  };
  const now = new Date().toISOString();
  let before = null;
  const id = withLock_(() => {
    const sid = cleanText_(p.schemeId, 30);
    const dup = rows_('BonusSchemes').some(s => s.schemeId !== sid && s.status !== 'Nonaktif' && data.status === 'Aktif' &&
      String(s.nama).toLowerCase() === data.nama.toLowerCase());
    if (dup) throw appError_('Jenis paket "' + data.nama + '" sudah ada.', 'VALIDATION');
    if (sid) {
      const cur = freshById_('BonusSchemes', 'schemeId', sid);
      if (!cur) throw appError_('Jenis paket tidak ditemukan.', 'NOT_FOUND');
      before = { nama: cur.nama, tarif: cur.tarif, target: cur.target, peserta: cur.peserta, status: cur.status };
      update_('BonusSchemes', cur._row, Object.assign({}, data, { updatedAt: now }));
      return sid;
    }
    const nid = shortId_('PKT');
    insert_('BonusSchemes', Object.assign({ schemeId: nid }, data, { createdAt: now, updatedAt: now }));
    return nid;
  });
  audit_(ctx, before ? 'BONUS_SCHEME_UPDATE' : 'BONUS_SCHEME_CREATE', 'BonusScheme', id, 'SUCCESS',
    { from: before, to: { nama: data.nama, tarif: data.tarif, target: data.target, peserta: ids.length, status: data.status } });
  return { schemeId: id };
}

function bonusRemoveScheme_(ctx, p) {
  const id = cleanText_(p.schemeId, 30);
  const outcome = withLock_(() => {
    const cur = freshById_('BonusSchemes', 'schemeId', id);
    if (!cur) throw appError_('Jenis paket tidak ditemukan.', 'NOT_FOUND');
    if (columnValues_('BonusReports', 'schemeId').indexOf(id) >= 0) {
      update_('BonusSchemes', cur._row, { status: 'Nonaktif', updatedAt: new Date().toISOString() });
      return 'deactivated';
    }
    deleteRow_('BonusSchemes', cur._row);
    return 'deleted';
  });
  audit_(ctx, 'BONUS_SCHEME_REMOVE', 'BonusScheme', id, 'SUCCESS', { outcome: outcome });
  return {
    outcome: outcome,
    message: outcome === 'deleted' ? 'Jenis paket dihapus.' : 'Jenis paket sudah dipakai di laporan, sehingga dinonaktifkan agar riwayat bonus tetap utuh.',
  };
}

/* ---------- Laporan penjualan (peserta) ---------- */

function bonusView_(r, emp, ctx) {
  return Object.assign(strip_(r, ['photoHash']), {
    flags: r.flags ? String(r.flags).split(',').filter(Boolean) : [],
    nama: emp ? emp.nama : r.employeeId,
    departemen: emp ? emp.departemen : '',
    hasPhoto: !!r.photoId && r.photoId.indexOf('DIHAPUS') !== 0,
    canVerify: canVerifyReport_(ctx, r, emp),
  });
}

/** Formulir host: jenis paket miliknya dan laporannya beberapa hari terakhir. */
function bonusForm_(ctx) {
  const today = todayLocal_(ctx.now.getTime());
  const minDate = addDays_(today, -LIMITS_.BONUS_BACKDATE_DAYS);
  const emp = ctx.employee;
  const schemes = schemesForEmployee_(emp);
  if (!schemes.length) return { today: today, minDate: minDate, schemes: [], reports: [] };
  return {
    today: today,
    minDate: minDate,
    schemes: schemes.map(publicScheme_),
    reports: rows_('BonusReports').filter(r => r.employeeId === emp.employeeId && r.workDate >= minDate)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(r => bonusView_(r, emp, ctx)),
  };
}

function bonusSubmit_(ctx, p) {
  const emp = requireEmployee_(ctx);
  rateLimit_('bn_' + ctx.user.userId, 20, 600, 'Terlalu sering mengirim laporan bonus. Tunggu beberapa menit.');
  const today = todayLocal_(ctx.now.getTime());
  const workDate = requireDate_(p.workDate, 'Tanggal penjualan');
  if (workDate > today) throw appError_('Tanggal penjualan tidak boleh melewati hari ini.', 'VALIDATION');
  if (workDate < addDays_(today, -LIMITS_.BONUS_BACKDATE_DAYS)) {
    throw appError_('Laporan bonus maksimal ' + LIMITS_.BONUS_BACKDATE_DAYS + ' hari ke belakang.', 'VALIDATION');
  }
  const raw = Array.isArray(p.items) ? p.items : [];
  if (!raw.length) throw appError_('Isi jumlah paket terjual minimal untuk satu jenis paket.', 'VALIDATION');
  if (raw.length > LIMITS_.WORK_ITEMS_MAX) throw appError_('Terlalu banyak jenis paket dalam satu laporan.', 'VALIDATION');
  const seen = {};
  const items = raw.map(it => {
    const id = cleanText_(it && it.schemeId, 30);
    if (!id || seen[id]) throw appError_('Data jenis paket tidak valid. Muat ulang halaman.', 'VALIDATION');
    seen[id] = true;
    return { schemeId: id, jumlah: intIn_(it.jumlah, 0, LIMITS_.BONUS_MAX_PAKET, 'Jumlah paket terjual') };
  });
  const keterangan = cleanText_(p.keterangan, 300);
  let photo;
  try {
    photo = decodePhoto_(p.photo);
  } catch (e) {
    if (e && e.isAppError) throw appError_('Screenshot penjualan wajib dilampirkan dan harus berupa gambar yang jelas.', 'BONUS_PHOTO_INVALID');
    throw e;
  }
  // Hash file asli dari browser (gambar dikompres ulang sebelum dikirim); dipakai untuk mencegah screenshot dipakai ulang.
  const origHash = /^[a-f0-9]{64}$/.test(String(p.photoOrigHash || '')) ? String(p.photoOrigHash) : '';
  const hash = origHash || photo.hash;
  const serverIso = ctx.now.toISOString();
  const batchId = shortId_('BNS');
  let savedId = null;
  let saved;
  try {
    saved = withLock_(() => {
      const byId = {};
      schemesForEmployee_(emp).forEach(s => { byId[s.schemeId] = s; });
      items.forEach(it => {
        if (!byId[it.schemeId]) throw appError_('Jenis paket ini tidak tersedia untuk Anda. Muat ulang halaman.', 'BONUS_SCHEME_INVALID');
      });
      const all = rows_('BonusReports');
      items.forEach(it => {
        const ex = all.filter(r => r.employeeId === emp.employeeId && r.workDate === workDate && r.schemeId === it.schemeId && r.status !== 'Ditolak')[0];
        if (ex) throw appError_('Penjualan ' + byId[it.schemeId].nama + ' tanggal ' + longDate_(workDate) + ' sudah dilaporkan (status ' + ex.status + ').', 'BONUS_DUPLICATE');
      });
      // Screenshot yang sama boleh dipakai lagi hanya oleh orang yang sama untuk tanggal yang sama
      // (mis. melapor jenis paket lain atau mengirim ulang setelah ditolak).
      const reused = photoHashUsed_(hash) || photoHashUsed_(photo.hash) || all.some(r =>
        (r.photoHash === hash || r.photoHash === photo.hash) && (r.employeeId !== emp.employeeId || r.workDate !== workDate));
      if (reused) throw appError_('Screenshot ini sudah pernah dipakai untuk laporan lain. Lampirkan screenshot penjualan tanggal ini.', 'DUPLICATE_PHOTO');
      const attended = rowsTail_('Attendance', tailSize_(LIMITS_.BONUS_BACKDATE_DAYS + 1))
        .some(r => r.employeeId === emp.employeeId && r.workDate === workDate && r.checkInAt);
      savedId = savePhoto_(photo, { workDate: workDate, employeeId: emp.employeeId, action: 'bonus', attendanceId: batchId, serverIso: serverIso });
      const out = items.map(it => {
        const s = byId[it.schemeId];
        const tarif = Number(s.tarif) || 0;
        const target = Number(s.target) || 0;
        const a = bonusAmount_(it.jumlah, target, tarif);
        return {
          bonusId: shortId_('BON'), batchId: batchId, employeeId: emp.employeeId, workDate: workDate,
          schemeId: s.schemeId, namaSkema: s.nama, tarif: tarif, target: target, jumlah: it.jumlah,
          paketBonus: a.paketBonus, nominal: a.nominal, keterangan: keterangan,
          photoId: savedId, photoHash: hash, status: 'Menunggu',
          diverifikasiOleh: '', diverifikasiAt: '', catatanVerifikasi: '',
          createdAt: serverIso, updatedAt: serverIso, flags: attended ? '' : 'TANPA_ABSEN',
        };
      });
      out.forEach(r => insert_('BonusReports', r));
      return out;
    });
  } catch (e) {
    if (savedId) trashQuietly_(savedId);
    throw e;
  }
  const total = saved.reduce((s, r) => s + r.nominal, 0);
  audit_(ctx, 'BONUS_SUBMIT', 'BonusReport', batchId, 'SUCCESS', { workDate: workDate, items: saved.length, total: total });
  return { items: saved.map(r => bonusView_(r, emp, ctx)), total: total };
}

/* ---------- Daftar, verifikasi, screenshot ---------- */

function sumBonus_(list) {
  const t = { Disetujui: { count: 0, total: 0 }, Menunggu: { count: 0, total: 0 }, Ditolak: { count: 0, total: 0 } };
  list.forEach(r => {
    const b = t[r.status] || t.Menunggu;
    b.count++;
    b.total += Number(r.nominal) || 0;
  });
  return t;
}

function bonusList_(ctx, p) {
  const empMap = {};
  rows_('Employees').forEach(e => { empMap[e.employeeId] = e; });
  const range = rangeFromPayload_(p);
  const status = cleanText_(p.status, 20);
  const dept = cleanText_(p.departemen, 60);
  const own = APPROVER_ROLES_.indexOf(ctx.user.role) < 0 || p.mine === true;
  const empId = own ? ctx.user.employeeId : cleanText_(p.employeeId, 20);
  let list = rows_('BonusReports').filter(r => r.workDate >= range.from && r.workDate <= range.to &&
    (!status || r.status === status) && (!empId || r.employeeId === empId) &&
    (!dept || (empMap[r.employeeId] && empMap[r.employeeId].departemen === dept)));
  list = list.filter(r => canSeeEmployee_(ctx, empMap[r.employeeId]));
  list.sort((a, b) => (a.workDate === b.workDate ? String(a.employeeId).localeCompare(String(b.employeeId)) : (a.workDate < b.workDate ? 1 : -1)));
  return {
    reports: list.slice(0, 1000).map(r => bonusView_(r, empMap[r.employeeId], ctx)),
    totals: sumBonus_(list),
    truncated: list.length > 1000,
  };
}

function bonusVerify_(ctx, p) {
  return verifyReports_(ctx, p.bonusIds, p, { sheet: 'BonusReports', idField: 'bonusId', action: 'BONUS_VERIFY', entity: 'BonusReport' });
}

function bonusPhoto_(ctx, p) {
  return reportPhoto_(ctx, cleanText_(p.bonusId, 30), { sheet: 'BonusReports', idField: 'bonusId', entity: 'BonusReport', type: 'bonus' });
}
