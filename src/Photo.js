/**
 * Foto absensi: validasi, penyimpanan privat di Google Drive, akses terbatas,
 * dan retensi. Spreadsheet hanya menyimpan ID file & hash SHA-256 foto.
 */

const JPEG_PREFIX_ = 'data:image/jpeg;base64,';

function decodePhoto_(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length < 100) {
    throw appError_('Foto wajib diambil langsung melalui kamera.', 'PHOTO_REQUIRED');
  }
  if (dataUrl.indexOf(JPEG_PREFIX_) !== 0) {
    throw appError_('Format foto tidak valid. Ambil ulang foto melalui kamera.', 'PHOTO_INVALID');
  }
  const b64 = dataUrl.slice(JPEG_PREFIX_.length);
  if (b64.length > Math.ceil(LIMITS_.PHOTO_MAX_BYTES * 4 / 3) + 4) {
    throw appError_('Ukuran foto terlalu besar.', 'PHOTO_INVALID');
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw appError_('Data foto rusak. Ambil ulang foto.', 'PHOTO_INVALID');
  let bytes;
  try { bytes = Utilities.base64Decode(b64); } catch (e) { throw appError_('Data foto rusak. Ambil ulang foto.', 'PHOTO_INVALID'); }
  const n = bytes.length;
  if (n < LIMITS_.PHOTO_MIN_BYTES) {
    throw appError_('Foto tampak kosong atau terlalu gelap. Ambil ulang dengan pencahayaan yang cukup.', 'PHOTO_INVALID');
  }
  if ((bytes[0] & 255) !== 0xFF || (bytes[1] & 255) !== 0xD8 || (bytes[n - 2] & 255) !== 0xFF || (bytes[n - 1] & 255) !== 0xD9) {
    throw appError_('Format foto tidak valid. Ambil ulang foto melalui kamera.', 'PHOTO_INVALID');
  }
  const dim = jpegSize_(bytes);
  if (!dim || dim.width < LIMITS_.PHOTO_MIN_DIM || dim.height < LIMITS_.PHOTO_MIN_DIM ||
      dim.width > LIMITS_.PHOTO_MAX_DIM || dim.height > LIMITS_.PHOTO_MAX_DIM) {
    throw appError_('Resolusi foto tidak sesuai. Ambil ulang foto melalui kamera.', 'PHOTO_INVALID');
  }
  return {
    bytes: bytes,
    size: n,
    width: dim.width,
    height: dim.height,
    hash: bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)),
  };
}

/** Membaca dimensi dari marker SOF JPEG. */
function jpegSize_(b) {
  let i = 2;
  const n = b.length;
  while (i + 9 < n) {
    if ((b[i] & 255) !== 0xFF) return null;
    const marker = b[i + 1] & 255;
    if (marker === 0xFF) { i++; continue; }
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) { i += 2; continue; }
    const len = ((b[i + 2] & 255) << 8) | (b[i + 3] & 255);
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return {
        height: ((b[i + 5] & 255) << 8) | (b[i + 6] & 255),
        width: ((b[i + 7] & 255) << 8) | (b[i + 8] & 255),
      };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/**
 * Asal foto. Web app Apps Script berjalan di iframe Google yang tidak memberi izin
 * kamera (getUserMedia selalu ditolak), sehingga foto biasanya diambil lewat
 * kamera HP melalui input file ("lampiran"). Untuk lampiran, browser juga
 * mengirim hash file asli dan umur file; keduanya data dari perangkat, dipakai
 * sebagai penanda dan pencegah pemakaian ulang, bukan bukti.
 */
function photoMeta_(source, origHash, ageSec) {
  const age = Number(ageSec);
  return {
    source: source === 'lampiran' ? 'lampiran' : 'kamera',
    origHash: /^[a-f0-9]{64}$/.test(String(origHash || '')) ? String(origHash) : '',
    ageSec: ageSec !== undefined && ageSec !== null && ageSec !== '' && isFinite(age) && age >= 0 ? Math.round(age) : null,
  };
}

function assertPhotoSourceAllowed_(meta) {
  if (meta.source === 'lampiran' && !getConfig_().allowPhotoUpload) {
    throw appError_('Admin mewajibkan foto langsung dari kamera aplikasi, sehingga lampiran foto tidak diterima.', 'PHOTO_UPLOAD_DISABLED');
  }
}

function photoFlags_(meta) {
  const flags = [];
  if (meta.source === 'lampiran') flags.push('LAMPIRAN');
  if (meta.ageSec !== null && meta.ageSec > LIMITS_.PHOTO_MAX_AGE_SEC) flags.push('FOTO_LAMA');
  return flags;
}

/** Hash yang disimpan & dicek duplikatnya: hash file asli untuk lampiran (cap waktu membuat file terkirim selalu berbeda). */
function storedPhotoHash_(photo, meta) {
  return meta.origHash || photo.hash;
}

/** Hash foto yang sudah pernah dipakai sebagai selfie atau foto hasil kerja (screenshot bonus dicek di Bonus.js). */
function photoHashUsed_(hash) {
  return columnValues_('Attendance', 'checkInPhotoHash').indexOf(hash) >= 0 ||
    columnValues_('Attendance', 'checkOutPhotoHash').indexOf(hash) >= 0 ||
    columnValues_('WorkReports', 'photoHash').indexOf(hash) >= 0;
}

function photoRoot_() {
  const id = getSecret_('PHOTO_FOLDER_ID');
  if (!id) throw appError_('Folder foto belum dikonfigurasi. Admin perlu menjalankan setup().', 'NOT_CONFIGURED');
  return DriveApp.getFolderById(id);
}

function monthFolder_(monthKey) {
  const root = photoRoot_();
  const it = root.getFoldersByName(monthKey);
  return it.hasNext() ? it.next() : root.createFolder(monthKey);
}

function savePhoto_(photo, meta) {
  const folder = monthFolder_(meta.workDate.slice(0, 7));
  const name = meta.workDate + '_' + meta.employeeId + '_' + meta.action + '_' + meta.attendanceId + '.jpg';
  const file = folder.createFile(Utilities.newBlob(photo.bytes, 'image/jpeg', name));
  file.setDescription('Foto absensi ' + meta.action + ' · ' + meta.employeeId + ' · diterima server ' + meta.serverIso + ' · sha256 ' + photo.hash);
  return file.getId();
}

function trashQuietly_(fileId) {
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { console.warn('Gagal menghapus foto ' + fileId + ': ' + e); }
}

function canSeePhoto_(ctx, emp) {
  const rule = PHOTO_ACCESS_[ctx.user.role];
  if (rule === 'all') return true;
  return emp.employeeId === ctx.user.employeeId;
}

/** Mengambil foto sebagai data URL setelah pemeriksaan hak akses. Tidak ada tautan publik. */
function attendancePhoto_(ctx, p) {
  const id = cleanText_(p.attendanceId, 40);
  const type = p.type === 'out' ? 'out' : 'in';
  const rec = findBy_('Attendance', 'attendanceId', id);
  if (!rec) throw appError_('Data absensi tidak ditemukan.', 'NOT_FOUND');
  const emp = findBy_('Employees', 'employeeId', rec.employeeId);
  if (!emp || !canSeePhoto_(ctx, emp)) {
    audit_(ctx, 'PHOTO_VIEW', 'Attendance', id, 'DENIED');
    throw appError_('Anda tidak memiliki akses ke foto ini.', 'FORBIDDEN');
  }
  const fileId = type === 'out' ? rec.checkOutPhotoId : rec.checkInPhotoId;
  if (!fileId) throw appError_('Foto tidak tersedia.', 'NOT_FOUND');
  if (fileId.indexOf('DIHAPUS') === 0) throw appError_('Foto telah dihapus sesuai kebijakan retensi.', 'NOT_FOUND');
  let blob;
  try { blob = DriveApp.getFileById(fileId).getBlob(); } catch (e) { throw appError_('Foto tidak dapat dibuka dari Google Drive.', 'NOT_FOUND'); }
  audit_(ctx, 'PHOTO_VIEW', 'Attendance', id, 'SUCCESS', { type: type });
  return { dataUrl: 'data:image/jpeg;base64,' + Utilities.base64Encode(blob.getBytes()) };
}

/**
 * Pembersihan retensi: foto lebih tua dari PHOTO_RETENTION_DAYS dipindah ke
 * sampah Drive, audit log lebih tua dari AUDIT_RETENTION_DAYS dihapus.
 * Dijalankan oleh trigger harian (dibuat oleh setup()). Data absensi tidak dihapus.
 */
function runRetentionCleanup(e) {
  // Hanya boleh dari trigger proyek ini (triggerUid tidak diketahui pengunjung) atau dari editor.
  const fromTrigger = !!(e && e.triggerUid) &&
    ScriptApp.getProjectTriggers().some(t => String(t.getUniqueId()) === String(e.triggerUid));
  if (!fromTrigger) guardEditor_();
  const cache = CacheService.getScriptCache();
  if (cache.get('retention_ran')) return 'Retensi sudah dijalankan dalam 6 jam terakhir.';
  cache.put('retention_ran', '1', 21600);
  const cfg = getConfig_();
  const nowMs = Date.now();
  let photos = 0, logs = 0;

  if (cfg.photoRetentionDays > 0) {
    const cutoff = addDays_(todayLocal_(nowMs), -cfg.photoRetentionDays);
    withLock_(() => {
      const list = rows_('Attendance').filter(r => r.workDate && r.workDate < cutoff &&
        ((r.checkInPhotoId && r.checkInPhotoId.indexOf('DIHAPUS') !== 0) || (r.checkOutPhotoId && r.checkOutPhotoId.indexOf('DIHAPUS') !== 0)));
      list.slice(0, 300).forEach(r => {
        const patch = {};
        ['checkInPhotoId', 'checkOutPhotoId'].forEach(f => {
          if (r[f] && r[f].indexOf('DIHAPUS') !== 0) { trashQuietly_(r[f]); patch[f] = 'DIHAPUS:RETENSI'; photos++; }
        });
        update_('Attendance', r._row, patch);
      });
    });
  }

  if (cfg.auditRetentionDays > 0) {
    const cutoffIso = new Date(nowMs - cfg.auditRetentionDays * 86400e3).toISOString();
    withLock_(() => {
      const ts = columnValues_('AuditLogs', 'timestamp').map(v => fromCell_(v, 'dt'));
      let n = 0;
      while (n < ts.length && ts[n] && ts[n] < cutoffIso) n++;
      if (n > 0) { sheet_('AuditLogs').deleteRows(2, n); logs = n; invalidate_('AuditLogs'); }
    });
  }
  audit_(null, 'RETENTION', 'System', '', 'SUCCESS', { photos: photos, auditRows: logs });
  return 'Foto dihapus: ' + photos + ', baris audit dihapus: ' + logs;
}
