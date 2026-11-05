/**
 * Instalasi & pemeliharaan. Jalankan setup() SEKALI dari editor Apps Script.
 * Aman dijalankan ulang: sheet/kolom yang sudah ada tidak diduplikasi.
 */

/** Password awal admin (diminta pemilik). Wajib diganti saat login pertama (mustChangePassword). */
const INITIAL_ADMIN_PASSWORD_ = '12345678';

function setup() {
  guardEditor_();
  const props = PropertiesService.getScriptProperties();
  const log = [];

  // 1) Spreadsheet database
  let ss = null;
  const ssId = props.getProperty('SPREADSHEET_ID');
  if (ssId) {
    ss = SpreadsheetApp.openById(ssId);
    log.push('Memakai spreadsheet yang sudah ada: ' + ss.getUrl());
  } else {
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
    if (ss) log.push('Memakai spreadsheet tempat skrip ini terpasang: ' + ss.getUrl());
    else {
      ss = SpreadsheetApp.create(getConfig_().companyName + ' · Database SDM & Absensi');
      log.push('Spreadsheet baru dibuat: ' + ss.getUrl());
    }
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  DB_.ss = ss;
  ss.setSpreadsheetTimeZone(getConfig_().timezone);

  // 2) Sheet & header
  Object.keys(SCHEMA_).forEach(name => {
    let sh = ss.getSheetByName(name);
    const wanted = SCHEMA_[name].map(c => c[0]);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, wanted.length).setValues([wanted]);
      log.push('Sheet dibuat: ' + name);
    } else {
      const lastCol = sh.getLastColumn();
      const existing = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim()) : [];
      const missing = wanted.filter(h => existing.indexOf(h) < 0);
      if (missing.length) {
        sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
        log.push('Kolom ditambahkan ke ' + name + ': ' + missing.join(', '));
      }
    }
    const width = sh.getLastColumn();
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#0b1a33').setFontColor('#ffffff');
  });
  ['Sheet1', 'Lembar1', 'Sheet 1'].forEach(n => {
    const sh = ss.getSheetByName(n);
    if (sh && ss.getSheets().length > 1 && sh.getLastRow() === 0) ss.deleteSheet(sh);
  });

  // 3) Folder foto privat
  let folder = null;
  const folderId = props.getProperty('PHOTO_FOLDER_ID');
  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); if (folder.isTrashed()) folder = null; } catch (e) { folder = null; }
  }
  if (!folder) {
    folder = DriveApp.createFolder(getConfig_().companyName + ' · Foto Absensi (PRIVAT)');
    props.setProperty('PHOTO_FOLDER_ID', folder.getId());
    log.push('Folder foto dibuat: ' + folder.getUrl());
  }
  try { folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (e) {
    log.push('Catatan: pengaturan berbagi folder tidak dapat diubah otomatis (' + e.message + '). Pastikan folder tidak dibagikan.');
  }

  // 4) Konfigurasi default
  const cfgProps = {};
  Object.keys(CONFIG_DEFAULTS_).forEach(k => {
    if (props.getProperty('CFG_' + k) === null) cfgProps['CFG_' + k] = CONFIG_DEFAULTS_[k];
  });
  if (Object.keys(cfgProps).length) props.setProperties(cfgProps, false);
  CONFIG_MEMO_ = null;

  // 5) Jadwal default
  const now = new Date().toISOString();
  if (!rows_('WorkSchedules').length) {
    const id = shortId_('JDW');
    insert_('WorkSchedules', {
      scheduleId: id, nama: 'Reguler (Senin–Jumat)', jamMasuk: '08:00', jamPulang: '17:00', toleransiMenit: 15,
      istirahatMulai: '12:00', istirahatSelesai: '13:00', bukaCheckInMenit: 120, batasCheckOutMenit: 360,
      hariKerja: '1,2,3,4,5', status: 'Aktif', createdAt: now, updatedAt: now,
    });
    setConfigValues_({ DEFAULT_SCHEDULE_ID: id });
    log.push('Jadwal default dibuat: Reguler 08:00–17:00, toleransi 15 menit.');
  }

  // 6) Admin pertama
  if (!rows_('Users').length) {
    const temp = INITIAL_ADMIN_PASSWORD_;
    insert_('Users', {
      userId: shortId_('USR'), username: 'admin', passwordHash: hashPassword_(temp), role: 'admin', employeeId: '',
      nama: 'Administrator', email: '', status: 'Aktif', mustChangePassword: true, lastLoginAt: '', createdAt: now, updatedAt: now,
    });
    log.push('AKUN ADMIN DIBUAT → username: admin | password sementara: ' + temp + ' (wajib diganti saat login pertama)');
  }

  // 7) Trigger retensi harian
  const hasTrigger = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'runRetentionCleanup');
  if (!hasTrigger) {
    ScriptApp.newTrigger('runRetentionCleanup').timeBased().everyDays(1).atHour(2).create();
    log.push('Trigger retensi harian dipasang (pukul 02.00).');
  }

  if (!rows_('WorkLocations').length) log.push('LANGKAH BERIKUTNYA: login sebagai admin → Pengaturan → Lokasi Kerja, lalu tambahkan titik kantor & radius.');
  audit_({ username: Session.getEffectiveUser().getEmail() }, 'SETUP', 'System', '', 'SUCCESS', { steps: log.length });
  SpreadsheetApp.flush();
  log.forEach(l => Logger.log(l));
  return log.join('\n');
}

/** Mengembalikan password admin ke password awal (jika lupa password); wajib diganti saat login. */
function resetAdminPassword() {
  guardEditor_();
  const admin = rows_('Users').filter(u => u.role === 'admin').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
  if (!admin) throw new Error('Tidak ada akun admin. Jalankan setup().');
  const temp = INITIAL_ADMIN_PASSWORD_;
  withLock_(() => update_('Users', admin._row, {
    passwordHash: hashPassword_(temp), mustChangePassword: true, status: 'Aktif', updatedAt: new Date().toISOString(),
  }));
  CacheService.getScriptCache().remove('lf_' + sha256Hex_(admin.username).slice(0, 32));
  audit_({ username: Session.getEffectiveUser().getEmail() }, 'ADMIN_PASSWORD_RESET', 'User', admin.userId, 'SUCCESS', { via: 'editor' });
  // Verifikasi ulang dari sheet agar hasil reset dapat dipastikan dari log.
  const saved = freshById_('Users', 'userId', admin.userId);
  const ok = !!saved && verifyPassword_(temp, saved.passwordHash);
  const rawUser = saved ? sheet_('Users').getRange(saved._row, colIndex_('Users', 'username') + 1).getValue() : '';
  const msg = 'Password sementara untuk "' + admin.username + '": ' + temp +
    ' | verifikasi: ' + (ok ? 'OK' : 'GAGAL') + ' | status akun: ' + (saved ? saved.status : '-') +
    ' | jumlah akun di sheet Users: ' + rows_('Users').length + ' | nilai mentah username: ' + JSON.stringify(rawUser);
  Logger.log(msg);
  return msg;
}
