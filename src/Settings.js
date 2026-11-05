/**
 * Pengaturan (khusus Admin): perusahaan & aturan, lokasi kerja, jadwal kerja,
 * pengguna. ID spreadsheet/folder tidak pernah dikirim ke browser.
 */

function publicCompany_() {
  const c = getConfig_();
  return { companyName: c.companyName, companyAddress: c.companyAddress, companyPhone: c.companyPhone, companyEmail: c.companyEmail, timezone: c.timezone };
}

function settingsGet_() {
  const c = getConfig_();
  return {
    config: c,
    timezones: TIMEZONES_,
    configured: { spreadsheet: !!getSecret_('SPREADSHEET_ID'), photoFolder: !!getSecret_('PHOTO_FOLDER_ID') },
    limits: { nonceTtlSec: LIMITS_.NONCE_TTL_SEC, sessionHours: LIMITS_.SESSION_MAX_AGE_MS / 3600e3, minCheckoutGapMin: LIMITS_.MIN_CHECKOUT_GAP_MIN },
  };
}

function settingsSave_(ctx, p) {
  const tz = oneOf_(p.timezone, TIMEZONES_, 'Zona waktu');
  const acc = intIn_(p.gpsMaxAccuracy, 5, 1000, 'Ambang akurasi GPS (meter)');
  const radius = intIn_(p.defaultRadius, 10, 5000, 'Radius default (meter)');
  const photoDays = intIn_(p.photoRetentionDays, 0, 3650, 'Retensi foto (hari)');
  const auditDays = intIn_(p.auditRetentionDays, 0, 3650, 'Retensi audit log (hari)');
  const defSched = cleanText_(p.defaultScheduleId, 40);
  if (defSched && !findBy_('WorkSchedules', 'scheduleId', defSched)) throw appError_('Jadwal default tidak ditemukan.', 'VALIDATION');
  const values = {
    COMPANY_NAME: requireText_(p.companyName, 'Nama perusahaan', 80),
    COMPANY_ADDRESS: cleanText_(p.companyAddress, 200),
    COMPANY_PHONE: optPhone_(p.companyPhone),
    COMPANY_EMAIL: optEmail_(p.companyEmail),
    TIMEZONE: tz,
    GPS_MAX_ACCURACY_M: acc,
    DEFAULT_RADIUS_M: radius,
    DEFAULT_SCHEDULE_ID: defSched,
    ALLOW_NON_WORKDAY: p.allowNonWorkday ? 'true' : 'false',
    ALLOW_EARLY_CHECKOUT: p.allowEarlyCheckout ? 'true' : 'false',
    FACE_CHECK: p.faceCheck === 'advisory' ? 'advisory' : 'off',
    ALLOW_PHOTO_UPLOAD: p.allowPhotoUpload === false ? 'false' : 'true',
    PHOTO_RETENTION_DAYS: photoDays,
    AUDIT_RETENTION_DAYS: auditDays,
  };
  const before = getConfig_();
  try { if (tz !== before.timezone) ss_().setSpreadsheetTimeZone(tz); } catch (e) { /* tidak kritis */ }
  const props = PropertiesService.getScriptProperties();
  const changed = {};
  Object.keys(values).forEach(k => {
    const cur = props.getProperty('CFG_' + k);
    if (String(values[k]) !== String(cur === null ? CONFIG_DEFAULTS_[k] : cur)) changed[k] = values[k];
  });
  setConfigValues_(values);
  audit_(ctx, 'SETTINGS_UPDATE', 'Config', '', 'SUCCESS', { changed: changed });
  return getConfig_();
}

/* ---------- Lokasi kerja ---------- */

function locationsList_() {
  const usage = {};
  rows_('Employees').forEach(e => String(e.locationIds || '').split(',').filter(Boolean).forEach(id => { usage[id] = (usage[id] || 0) + 1; }));
  return {
    locations: rows_('WorkLocations').map(l => Object.assign(strip_(l), { dipakai: usage[l.locationId] || 0 })),
    defaultRadius: getConfig_().defaultRadius,
  };
}

function locationsSave_(ctx, p) {
  const lat = Number(p.latitude), lng = Number(p.longitude);
  if (!isFinite(lat) || lat < -90 || lat > 90 || String(p.latitude).trim() === '') throw appError_('Latitude harus angka antara -90 dan 90.', 'VALIDATION');
  if (!isFinite(lng) || lng < -180 || lng > 180 || String(p.longitude).trim() === '') throw appError_('Longitude harus angka antara -180 dan 180.', 'VALIDATION');
  if (lat === 0 && lng === 0) throw appError_('Koordinat 0,0 tidak valid.', 'VALIDATION');
  const data = {
    nama: requireText_(p.nama, 'Nama lokasi', 80),
    alamat: cleanText_(p.alamat, 200),
    latitude: round_(lat, 7),
    longitude: round_(lng, 7),
    radius: intIn_(p.radius, 10, 5000, 'Radius (meter)'),
    status: p.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
  };
  const now = new Date().toISOString();
  const id = withLock_(() => {
    const lid = cleanText_(p.locationId, 30);
    if (lid) {
      const cur = freshById_('WorkLocations', 'locationId', lid);
      if (!cur) throw appError_('Lokasi tidak ditemukan.', 'NOT_FOUND');
      update_('WorkLocations', cur._row, Object.assign({}, data, { updatedAt: now }));
      return lid;
    }
    const nid = shortId_('LOC');
    insert_('WorkLocations', Object.assign({ locationId: nid }, data, { createdAt: now, updatedAt: now }));
    return nid;
  });
  audit_(ctx, p.locationId ? 'LOCATION_UPDATE' : 'LOCATION_CREATE', 'WorkLocation', id, 'SUCCESS',
    { nama: data.nama, radius: data.radius, status: data.status });
  return { locationId: id };
}

function locationsRemove_(ctx, p) {
  const id = cleanText_(p.locationId, 30);
  withLock_(() => {
    const cur = freshById_('WorkLocations', 'locationId', id);
    if (!cur) throw appError_('Lokasi tidak ditemukan.', 'NOT_FOUND');
    const used = rows_('Employees').some(e => String(e.locationIds || '').split(',').map(s => s.trim()).indexOf(id) >= 0);
    if (used) throw appError_('Lokasi masih ditetapkan pada karyawan. Ubah data karyawan atau nonaktifkan lokasi ini.', 'VALIDATION');
    deleteRow_('WorkLocations', cur._row);
  });
  audit_(ctx, 'LOCATION_REMOVE', 'WorkLocation', id, 'SUCCESS');
  return true;
}

/* ---------- Jadwal kerja ---------- */

function schedulesList_() {
  const usage = {};
  rows_('Employees').forEach(e => { if (e.scheduleId) usage[e.scheduleId] = (usage[e.scheduleId] || 0) + 1; });
  const def = getConfig_().defaultScheduleId;
  return {
    schedules: rows_('WorkSchedules').map(s => Object.assign(strip_(s), { dipakai: usage[s.scheduleId] || 0, isDefault: s.scheduleId === def })),
  };
}

function schedulesSave_(ctx, p) {
  const data = validateScheduleInput_(p);
  const now = new Date().toISOString();
  const id = withLock_(() => {
    const sid = cleanText_(p.scheduleId, 30);
    if (sid) {
      const cur = freshById_('WorkSchedules', 'scheduleId', sid);
      if (!cur) throw appError_('Jadwal tidak ditemukan.', 'NOT_FOUND');
      update_('WorkSchedules', cur._row, Object.assign({}, data, { updatedAt: now }));
      return sid;
    }
    const nid = shortId_('JDW');
    insert_('WorkSchedules', Object.assign({ scheduleId: nid }, data, { createdAt: now, updatedAt: now }));
    return nid;
  });
  if (p.isDefault || !getConfig_().defaultScheduleId) setConfigValues_({ DEFAULT_SCHEDULE_ID: id });
  audit_(ctx, p.scheduleId ? 'SCHEDULE_UPDATE' : 'SCHEDULE_CREATE', 'WorkSchedule', id, 'SUCCESS', data);
  return { scheduleId: id };
}

function schedulesRemove_(ctx, p) {
  const id = cleanText_(p.scheduleId, 30);
  if (id === getConfig_().defaultScheduleId) throw appError_('Jadwal default tidak dapat dihapus. Tetapkan jadwal default lain terlebih dahulu.', 'VALIDATION');
  withLock_(() => {
    const cur = freshById_('WorkSchedules', 'scheduleId', id);
    if (!cur) throw appError_('Jadwal tidak ditemukan.', 'NOT_FOUND');
    if (rows_('Employees').some(e => e.scheduleId === id)) throw appError_('Jadwal masih dipakai karyawan. Pindahkan karyawan ke jadwal lain atau nonaktifkan jadwal ini.', 'VALIDATION');
    deleteRow_('WorkSchedules', cur._row);
  });
  audit_(ctx, 'SCHEDULE_REMOVE', 'WorkSchedule', id, 'SUCCESS');
  return true;
}

/* ---------- Pengguna ---------- */

function usersList_() {
  const emps = {};
  rows_('Employees').forEach(e => { emps[e.employeeId] = e; });
  return {
    users: rows_('Users').map(u => Object.assign(strip_(u, ['passwordHash']), {
      role: effectiveRole_(u.role),
      roleLabel: ROLE_LABELS_[effectiveRole_(u.role)],
      employeeNama: emps[u.employeeId] ? emps[u.employeeId].nama : '',
    })),
    roles: ROLES_.map(r => ({ value: r, label: ROLE_LABELS_[r] })),
  };
}

function activeAdminCount_(excludeUserId) {
  return rows_('Users').filter(u => u.role === 'admin' && u.status === 'Aktif' && u.userId !== excludeUserId).length;
}

function usersSave_(ctx, p) {
  const role = oneOf_(p.role, ROLES_, 'Role');
  const status = p.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif';
  const employeeId = cleanText_(p.employeeId, 20);
  if (employeeId && !findBy_('Employees', 'employeeId', employeeId)) throw appError_('Karyawan tidak ditemukan.', 'VALIDATION');
  const email = optEmail_(p.email);
  const nama = cleanText_(p.nama, 80);
  const now = new Date().toISOString();
  const out = withLock_(() => {
    invalidate_('Users');
    if (employeeId && rows_('Users').some(u => u.employeeId === employeeId && u.userId !== cleanText_(p.userId, 30))) {
      throw appError_('Karyawan tersebut sudah terhubung dengan akun lain.', 'VALIDATION');
    }
    const uid = cleanText_(p.userId, 30);
    if (uid) {
      const cur = freshById_('Users', 'userId', uid);
      if (!cur) throw appError_('Pengguna tidak ditemukan.', 'NOT_FOUND');
      const losingAdmin = cur.role === 'admin' && (role !== 'admin' || status !== 'Aktif');
      if (losingAdmin && activeAdminCount_(uid) === 0) throw appError_('Harus ada minimal satu Admin aktif.', 'VALIDATION');
      if (uid === ctx.user.userId && (role !== cur.role || status !== 'Aktif')) throw appError_('Anda tidak dapat mengubah role atau menonaktifkan akun Anda sendiri.', 'VALIDATION');
      update_('Users', cur._row, { role: role, status: status, employeeId: employeeId, email: email, nama: nama, updatedAt: now });
      return { userId: uid, created: false };
    }
    const r = createUser_({ username: p.username, role: role, employeeId: employeeId, nama: nama, email: email });
    return { userId: r.user.userId, created: true, username: r.user.username, tempPassword: r.tempPassword };
  });
  audit_(ctx, out.created ? 'USER_CREATE' : 'USER_UPDATE', 'User', out.userId, 'SUCCESS', { role: role, status: status });
  return out;
}

function usersResetPassword_(ctx, p) {
  const uid = cleanText_(p.userId, 30);
  const temp = randomPassword_();
  const hash = hashPassword_(temp);
  let username;
  withLock_(() => {
    const cur = freshById_('Users', 'userId', uid);
    if (!cur) throw appError_('Pengguna tidak ditemukan.', 'NOT_FOUND');
    username = cur.username;
    update_('Users', cur._row, { passwordHash: hash, mustChangePassword: true, updatedAt: new Date().toISOString() });
  });
  CacheService.getScriptCache().remove('lf_' + sha256Hex_(username).slice(0, 32));
  audit_(ctx, 'USER_RESET_PASSWORD', 'User', uid, 'SUCCESS');
  return { username: username, tempPassword: temp };
}

function usersRemove_(ctx, p) {
  const uid = cleanText_(p.userId, 30);
  if (uid === ctx.user.userId) throw appError_('Anda tidak dapat menghapus akun Anda sendiri.', 'VALIDATION');
  withLock_(() => {
    const cur = freshById_('Users', 'userId', uid);
    if (!cur) throw appError_('Pengguna tidak ditemukan.', 'NOT_FOUND');
    if (cur.role === 'admin' && activeAdminCount_(uid) === 0) throw appError_('Harus ada minimal satu Admin aktif.', 'VALIDATION');
    deleteRow_('Users', cur._row);
  });
  audit_(ctx, 'USER_REMOVE', 'User', uid, 'SUCCESS');
  return true;
}

/** Pilihan dropdown untuk formulir. */
function metaOptions_(ctx) {
  const emps = employeesInScope_(ctx).filter(e => e.status === 'Aktif');
  const depts = {};
  rows_('Employees').forEach(e => { if (e.departemen) depts[e.departemen] = true; });
  return {
    employees: emps.map(e => ({ employeeId: e.employeeId, nama: e.nama, departemen: e.departemen, jabatan: e.jabatan })),
    departments: Object.keys(depts).sort(),
    schedules: rows_('WorkSchedules').filter(s => s.status !== 'Nonaktif').map(s => ({ scheduleId: s.scheduleId, nama: s.nama, jamMasuk: s.jamMasuk, jamPulang: s.jamPulang })),
    locations: rows_('WorkLocations').filter(l => l.status !== 'Nonaktif').map(l => ({ locationId: l.locationId, nama: l.nama })),
    roles: ROLES_.map(r => ({ value: r, label: ROLE_LABELS_[r] })),
    defaultScheduleId: getConfig_().defaultScheduleId,
  };
}
