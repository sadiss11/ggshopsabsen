/**
 * Konfigurasi, konstanta, dan skema database.
 *
 * Konvensi: semua fungsi internal diakhiri garis bawah (_) sehingga TIDAK dapat
 * dipanggil dari browser melalui google.script.run. Fungsi publik hanya:
 * doGet, api, setup, resetAdminPassword, runRetentionCleanup.
 */

const APP_ = {
  NAME: 'SDM & Absensi',
  VERSION: '1.0.0',
};

const ROLES_ = ['admin', 'hr', 'karyawan'];
const ROLE_LABELS_ = { admin: 'Super Admin', hr: 'HRD', karyawan: 'Karyawan' };
/** Hanya Super Admin & HRD yang boleh melihat dan mengelola data karyawan lain. Role lain hanya data dirinya sendiri. */
const APPROVER_ROLES_ = ['admin', 'hr'];

/** Role yang boleh melihat foto absensi orang lain. */
const PHOTO_ACCESS_ = { admin: 'all', hr: 'all', karyawan: 'own' };

const LIMITS_ = {
  SESSION_IDLE_MS: 12 * 3600e3,    // sesi gugur bila tidak dipakai 12 jam
  SESSION_MAX_AGE_MS: 16 * 3600e3, // umur absolut sesi (cukup untuk satu hari kerja + lembur)
  LOGIN_MAX_FAIL: 5,
  LOGIN_LOCK_SEC: 900,
  NONCE_TTL_SEC: 600,              // foto harus dikirim maks. 10 menit setelah sesi kamera dibuka (check-out: 2 foto + laporan)
  SUBMIT_COOLDOWN_SEC: 4,
  LOCK_WAIT_MS: 20000,
  PHOTO_MIN_BYTES: 4000,
  PHOTO_MAX_BYTES: 1500000,
  PHOTO_MIN_DIM: 240,
  PHOTO_MAX_DIM: 2000,
  MIN_CHECKOUT_GAP_MIN: 2,
  CHECKOUT_UNTIL_MIN: 4 * 60,      // tanpa jadwal: check-out paling lambat pukul 04.00 keesokan hari
  PHOTO_MAX_AGE_SEC: 900,          // lampiran lebih tua dari 15 menit diberi penanda FOTO_LAMA
  PASSWORD_MIN: 8,
  HASH_ITERATIONS: 1000,
  MAX_TRAVEL_KMH: 250,
  REPORT_MAX_DAYS: 62,
  PAYROLL_MAX_DAYS: 93,
  WORK_NOTE_MIN: 5,
  WORK_ITEMS_MAX: 20,
  BONUS_BACKDATE_DAYS: 7,          // laporan bonus boleh untuk hari ini s/d 7 hari ke belakang
  BONUS_MAX_PAKET: 100000,
  HISTORY_TAIL_ROWS: 6000,
};

const STATUS_ATTENDANCE_ = ['Hadir', 'Terlambat', 'Izin', 'Sakit', 'Cuti', 'Dinas Luar', 'Alpha'];
const LEAVE_TYPES_ = ['Izin', 'Sakit', 'Cuti', 'Dinas Luar'];
const JOB_STATUS_ = ['Pending', 'In Progress', 'Selesai'];
const JOB_PRIORITY_ = ['Rendah', 'Sedang', 'Tinggi'];
const REPORT_STATUS_ = ['Menunggu', 'Disetujui', 'Ditolak'];

/** Zona waktu yang dapat dipilih Admin. */
const TIMEZONES_ = [
  'Asia/Jakarta', 'Asia/Pontianak', 'Asia/Makassar', 'Asia/Jayapura',
  'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Bangkok', 'Asia/Ho_Chi_Minh', 'Asia/Manila',
  'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Riyadh',
  'Australia/Perth', 'Australia/Sydney', 'Europe/London', 'Europe/Amsterdam', 'UTC',
];

/** Nilai default konfigurasi (disimpan di Script Properties dengan prefix CFG_). */
const CONFIG_DEFAULTS_ = {
  COMPANY_NAME: 'GGSHOPS.ID',
  COMPANY_ADDRESS: '',
  COMPANY_PHONE: '',
  COMPANY_EMAIL: '',
  TIMEZONE: 'Asia/Jakarta',
  GPS_MAX_ACCURACY_M: '50',
  DEFAULT_RADIUS_M: '100',
  DEFAULT_SCHEDULE_ID: '',
  ALLOW_NON_WORKDAY: 'false',
  ALLOW_EARLY_CHECKOUT: 'true',
  FACE_CHECK: 'off',              // off | advisory
  ALLOW_PHOTO_UPLOAD: 'true',     // foto dari kamera HP (lampiran) bila kamera langsung diblokir browser
  PHOTO_RETENTION_DAYS: '365',
  AUDIT_RETENTION_DAYS: '730',
};

/**
 * Skema sheet. Tipe kolom: s=teks, n=angka, b=boolean, d=tanggal yyyy-MM-dd,
 * t=jam HH:mm, dt=timestamp ISO-8601 UTC. Pembacaan memetakan kolom berdasarkan
 * nama header, sehingga urutan kolom & kolom tambahan buatan Admin tetap aman.
 */
const SCHEMA_ = {
  Users: [
    ['userId', 's'], ['username', 's'], ['passwordHash', 's'], ['role', 's'], ['employeeId', 's'],
    ['nama', 's'], ['email', 's'], ['status', 's'], ['mustChangePassword', 'b'],
    ['lastLoginAt', 'dt'], ['createdAt', 'dt'], ['updatedAt', 'dt'],
  ],
  Employees: [
    ['employeeId', 's'], ['nama', 's'], ['email', 's'], ['noHp', 's'], ['jabatan', 's'],
    ['departemen', 's'], ['alamat', 's'], ['tanggalBergabung', 'd'], ['scheduleId', 's'],
    ['locationIds', 's'], ['status', 's'], ['createdAt', 'dt'], ['updatedAt', 'dt'],
  ],
  Attendance: [
    ['attendanceId', 's'], ['key', 's'], ['employeeId', 's'], ['workDate', 'd'], ['scheduleId', 's'],
    ['status', 's'], ['lateMinutes', 'n'],
    ['checkInAt', 'dt'], ['checkInLocal', 's'], ['checkInPhotoId', 's'], ['checkInPhotoHash', 's'],
    ['checkInLat', 'n'], ['checkInLng', 'n'], ['checkInAccuracy', 'n'], ['checkInDistance', 'n'],
    ['checkInLocationId', 's'],
    ['checkOutAt', 'dt'], ['checkOutLocal', 's'], ['checkOutPhotoId', 's'], ['checkOutPhotoHash', 's'],
    ['checkOutLat', 'n'], ['checkOutLng', 'n'], ['checkOutAccuracy', 'n'], ['checkOutDistance', 'n'],
    ['checkOutLocationId', 's'], ['checkOutStatus', 's'], ['earlyMinutes', 'n'], ['workMinutes', 'n'],
    ['flags', 's'], ['note', 's'], ['createdAt', 'dt'], ['updatedAt', 'dt'], ['updatedBy', 's'],
  ],
  WorkLocations: [
    ['locationId', 's'], ['nama', 's'], ['alamat', 's'], ['latitude', 'n'], ['longitude', 'n'],
    ['radius', 'n'], ['status', 's'], ['createdAt', 'dt'], ['updatedAt', 'dt'],
  ],
  WorkSchedules: [
    ['scheduleId', 's'], ['nama', 's'], ['jamMasuk', 't'], ['jamPulang', 't'], ['toleransiMenit', 'n'],
    ['istirahatMulai', 't'], ['istirahatSelesai', 't'], ['bukaCheckInMenit', 'n'],
    ['batasCheckOutMenit', 'n'], ['hariKerja', 's'], ['status', 's'], ['createdAt', 'dt'], ['updatedAt', 'dt'],
  ],
  LeaveRequests: [
    ['leaveId', 's'], ['employeeId', 's'], ['jenis', 's'], ['tanggalMulai', 'd'], ['tanggalSelesai', 'd'],
    ['alasan', 's'], ['status', 's'], ['diajukanAt', 'dt'], ['diprosesOleh', 's'], ['diprosesAt', 'dt'],
    ['catatan', 's'],
  ],
  Jobdesk: [
    ['jobId', 's'], ['employeeId', 's'], ['judul', 's'], ['deskripsi', 's'], ['deadline', 'd'],
    ['prioritas', 's'], ['status', 's'], ['dibuatOleh', 's'], ['createdAt', 'dt'], ['updatedAt', 'dt'],
  ],
  /** Daftar jobdesk berbayar: tarif tetap per laporan (satu kali per hari kerja). */
  JobRates: [
    ['rateId', 's'], ['nama', 's'], ['deskripsi', 's'], ['tarif', 'n'], ['departemen', 's'],
    ['status', 's'], ['createdAt', 'dt'], ['updatedAt', 'dt'],
  ],
  /** Laporan jobdesk saat check-out; tarif & nama disalin agar perubahan tarif tidak mengubah gaji lama. */
  WorkReports: [
    ['reportId', 's'], ['attendanceId', 's'], ['employeeId', 's'], ['workDate', 'd'], ['rateId', 's'],
    ['namaJobdesk', 's'], ['tarif', 'n'], ['keterangan', 's'], ['photoId', 's'], ['photoHash', 's'],
    ['status', 's'], ['diverifikasiOleh', 's'], ['diverifikasiAt', 'dt'], ['catatanVerifikasi', 's'],
    ['createdAt', 'dt'], ['updatedAt', 'dt'], ['flags', 's'],
  ],
  /** Jenis paket bonus: tarif per paket di atas target harian, untuk peserta yang dipilih HR. */
  BonusSchemes: [
    ['schemeId', 's'], ['nama', 's'], ['deskripsi', 's'], ['tarif', 'n'], ['target', 'n'], ['peserta', 's'],
    ['status', 's'], ['createdAt', 'dt'], ['updatedAt', 'dt'],
  ],
  /** Laporan penjualan per jenis paket per hari; tarif & target disalin saat dilaporkan. */
  BonusReports: [
    ['bonusId', 's'], ['batchId', 's'], ['employeeId', 's'], ['workDate', 'd'], ['schemeId', 's'], ['namaSkema', 's'],
    ['tarif', 'n'], ['target', 'n'], ['jumlah', 'n'], ['paketBonus', 'n'], ['nominal', 'n'], ['keterangan', 's'],
    ['photoId', 's'], ['photoHash', 's'], ['status', 's'], ['diverifikasiOleh', 's'], ['diverifikasiAt', 'dt'],
    ['catatanVerifikasi', 's'], ['createdAt', 'dt'], ['updatedAt', 'dt'], ['flags', 's'],
  ],
  AuditLogs: [
    ['logId', 's'], ['timestamp', 'dt'], ['waktuLokal', 's'], ['userId', 's'], ['username', 's'],
    ['role', 's'], ['action', 's'], ['entity', 's'], ['entityId', 's'], ['result', 's'], ['detail', 's'],
  ],
};

let CONFIG_MEMO_ = null;

/** Konfigurasi aplikasi (tanpa rahasia) dalam bentuk bertipe. */
function getConfig_() {
  if (CONFIG_MEMO_) return CONFIG_MEMO_;
  const props = PropertiesService.getScriptProperties().getProperties();
  const raw = {};
  Object.keys(CONFIG_DEFAULTS_).forEach(k => {
    const v = props['CFG_' + k];
    raw[k] = (v === undefined || v === null || v === '') ? CONFIG_DEFAULTS_[k] : v;
  });
  CONFIG_MEMO_ = {
    companyName: raw.COMPANY_NAME,
    companyAddress: raw.COMPANY_ADDRESS,
    companyPhone: raw.COMPANY_PHONE,
    companyEmail: raw.COMPANY_EMAIL,
    timezone: TIMEZONES_.indexOf(raw.TIMEZONE) >= 0 ? raw.TIMEZONE : 'Asia/Jakarta',
    gpsMaxAccuracy: clampNum_(raw.GPS_MAX_ACCURACY_M, 5, 1000, 50),
    defaultRadius: clampNum_(raw.DEFAULT_RADIUS_M, 10, 5000, 100),
    defaultScheduleId: raw.DEFAULT_SCHEDULE_ID,
    allowNonWorkday: raw.ALLOW_NON_WORKDAY === 'true',
    allowEarlyCheckout: raw.ALLOW_EARLY_CHECKOUT !== 'false',
    faceCheck: raw.FACE_CHECK === 'advisory' ? 'advisory' : 'off',
    allowPhotoUpload: raw.ALLOW_PHOTO_UPLOAD !== 'false',
    photoRetentionDays: clampNum_(raw.PHOTO_RETENTION_DAYS, 0, 3650, 365),
    auditRetentionDays: clampNum_(raw.AUDIT_RETENTION_DAYS, 0, 3650, 730),
  };
  return CONFIG_MEMO_;
}

function setConfigValues_(map) {
  const out = {};
  Object.keys(map).forEach(k => {
    if (!Object.prototype.hasOwnProperty.call(CONFIG_DEFAULTS_, k)) throw new Error('Konfigurasi tidak dikenal: ' + k);
    out['CFG_' + k] = String(map[k]);
  });
  PropertiesService.getScriptProperties().setProperties(out, false);
  CONFIG_MEMO_ = null;
}

/** Nilai rahasia server (ID spreadsheet/folder). Tidak pernah dikirim ke browser. */
function getSecret_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function clampNum_(v, min, max, def) {
  const n = Number(v);
  if (!isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
