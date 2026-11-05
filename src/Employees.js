/**
 * Data karyawan & akun pengguna yang terhubung.
 */

function optEmail_(v) {
  const s = cleanText_(v, 100).toLowerCase();
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw appError_('Format email tidak valid.', 'VALIDATION');
  return s;
}

function optPhone_(v) {
  const s = cleanText_(v, 20);
  if (s && !/^[0-9+\-\s]{6,20}$/.test(s)) throw appError_('Nomor HP hanya boleh berisi angka, spasi, + atau -.', 'VALIDATION');
  return s;
}

function validateUsername_(v) {
  const s = normUsername_(v);
  if (!/^[a-z0-9._-]{3,30}$/.test(s)) throw appError_('Username 3–30 karakter: huruf kecil, angka, titik, garis bawah, atau strip.', 'VALIDATION');
  return s;
}

/**
 * Nomor karyawan berikutnya. Tidak pernah memakai ulang nomor karyawan yang sudah dihapus,
 * agar riwayat absensi/laporan lama tidak tertaut ke karyawan baru. Dipanggil di dalam lock.
 */
function nextEmployeeId_() {
  const props = PropertiesService.getScriptProperties();
  let max = Number(props.getProperty('EMP_SEQ') || 0);
  const scan = v => { const m = /^K(\d+)$/.exec(String(v)); if (m) max = Math.max(max, Number(m[1])); };
  ['Employees', 'Users', 'Attendance', 'LeaveRequests', 'Jobdesk', 'WorkReports', 'BonusReports'].forEach(s => columnValues_(s, 'employeeId').forEach(scan));
  const n = max + 1;
  props.setProperty('EMP_SEQ', String(n));
  return 'K' + (n < 1000 ? ('00' + n).slice(-3) : String(n));
}

/** Membuat akun login. Harus dipanggil di dalam withLock_. Mengembalikan password sementara. */
function createUser_(data) {
  const username = validateUsername_(data.username);
  if (rows_('Users').some(u => u.username === username)) throw appError_('Username "' + username + '" sudah digunakan.', 'VALIDATION');
  if (data.employeeId && rows_('Users').some(u => u.employeeId === data.employeeId)) {
    throw appError_('Karyawan ini sudah memiliki akun login.', 'VALIDATION');
  }
  const tempPassword = randomPassword_();
  const now = new Date().toISOString();
  const user = {
    userId: shortId_('USR'),
    username: username,
    passwordHash: hashPassword_(tempPassword),
    role: oneOf_(data.role, ROLES_, 'Role'),
    employeeId: data.employeeId || '',
    nama: cleanText_(data.nama, 80),
    email: data.email || '',
    status: 'Aktif',
    mustChangePassword: true,
    lastLoginAt: '',
    createdAt: now,
    updatedAt: now,
  };
  insert_('Users', user);
  return { user: user, tempPassword: tempPassword };
}

function employeeRefs_() {
  const scheds = {};
  rows_('WorkSchedules').forEach(s => { scheds[s.scheduleId] = s.nama; });
  const locs = {};
  rows_('WorkLocations').forEach(l => { locs[l.locationId] = l.nama; });
  const users = {};
  rows_('Users').forEach(u => { if (u.employeeId) users[u.employeeId] = u; });
  return { scheds: scheds, locs: locs, users: users };
}

function employeesList_(ctx) {
  const refs = employeeRefs_();
  const list = employeesInScope_(ctx).map(e => {
    const u = refs.users[e.employeeId];
    const locNames = String(e.locationIds || '').split(',').filter(Boolean).map(id => refs.locs[id] || id);
    return Object.assign(strip_(e), {
      scheduleNama: refs.scheds[e.scheduleId] || '',
      lokasiNama: locNames.length ? locNames.join(', ') : 'Semua lokasi aktif',
      username: u ? u.username : '',
      accountStatus: u ? u.status : '',
    });
  });
  list.sort((a, b) => (a.employeeId < b.employeeId ? -1 : 1));
  const thisMonth = todayLocal_(ctx.now.getTime()).slice(0, 7);
  return {
    employees: list,
    canEdit: ctx.user.role === 'admin' || ctx.user.role === 'hr',
    newThisMonth: list.filter(e => String(e.tanggalBergabung).slice(0, 7) === thisMonth).length,
  };
}

function employeesGet_(ctx, p) {
  const id = cleanText_(p.employeeId, 20) || ctx.user.employeeId;
  const emp = id ? findBy_('Employees', 'employeeId', id) : null;
  if (!emp) throw appError_('Data karyawan tidak ditemukan.', 'NOT_FOUND');
  if (!canSeeEmployee_(ctx, emp)) throw appError_('Anda tidak memiliki akses ke data ini.', 'FORBIDDEN');
  const user = rows_('Users').filter(u => u.employeeId === emp.employeeId)[0];
  const jobs = rows_('Jobdesk').filter(j => j.employeeId === emp.employeeId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 50).map(j => strip_(j));
  const refs = employeeRefs_();
  const locIds = String(emp.locationIds || '').split(',').filter(Boolean);
  return {
    employee: Object.assign(strip_(emp), { scheduleNama: refs.scheds[emp.scheduleId] || '' }),
    schedule: publicSchedule_(scheduleFor_(emp)),
    locations: locIds.length ? locIds.map(i => refs.locs[i] || i) : locationsForEmployee_(emp).map(l => l.nama),
    jobs: jobs,
    account: user ? { username: user.username, role: effectiveRole_(user.role), roleLabel: ROLE_LABELS_[effectiveRole_(user.role)], status: user.status, lastLoginAt: user.lastLoginAt } : null,
    canEdit: ctx.user.role === 'admin' || ctx.user.role === 'hr',
    isSelf: emp.employeeId === ctx.user.employeeId,
  };
}

function employeesSave_(ctx, p) {
  const isAdmin = ctx.user.role === 'admin';
  const scheduleId = cleanText_(p.scheduleId, 40);
  if (scheduleId && !findBy_('WorkSchedules', 'scheduleId', scheduleId)) throw appError_('Jadwal kerja tidak ditemukan.', 'VALIDATION');
  const locIds = (Array.isArray(p.locationIds) ? p.locationIds : String(p.locationIds || '').split(','))
    .map(s => cleanText_(s, 40)).filter(Boolean);
  locIds.forEach(id => { if (!findBy_('WorkLocations', 'locationId', id)) throw appError_('Lokasi kerja tidak ditemukan.', 'VALIDATION'); });
  const data = {
    nama: requireText_(p.nama, 'Nama', 80),
    email: optEmail_(p.email),
    noHp: optPhone_(p.noHp),
    jabatan: cleanText_(p.jabatan, 60),
    departemen: cleanText_(p.departemen, 60),
    alamat: cleanText_(p.alamat, 200),
    tanggalBergabung: optDate_(p.tanggalBergabung, 'Tanggal bergabung'),
    scheduleId: scheduleId,
    locationIds: locIds.filter((v, i, a) => a.indexOf(v) === i).join(','),
    status: p.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
  };
  const wantAccount = !!p.createAccount;
  const accountRole = isAdmin && ROLES_.indexOf(p.accountRole) >= 0 ? p.accountRole : 'karyawan';
  const now = new Date().toISOString();

  const result = withLock_(() => {
    let id = cleanText_(p.employeeId, 20);
    let created = false;
    // Validasi akun sebelum menulis apa pun agar tidak ada data setengah jadi.
    if (wantAccount) {
      const uname = validateUsername_(p.username);
      if (rows_('Users').some(u => u.username === uname)) throw appError_('Username "' + uname + '" sudah digunakan.', 'VALIDATION');
      if (id && rows_('Users').some(u => u.employeeId === id)) throw appError_('Karyawan ini sudah memiliki akun login.', 'VALIDATION');
    }
    if (id) {
      const cur = freshById_('Employees', 'employeeId', id);
      if (!cur) throw appError_('Data karyawan tidak ditemukan.', 'NOT_FOUND');
      if (cur.employeeId === ctx.user.employeeId && data.status === 'Nonaktif') {
        throw appError_('Anda tidak dapat menonaktifkan data karyawan Anda sendiri.', 'VALIDATION');
      }
      update_('Employees', cur._row, Object.assign({}, data, { updatedAt: now }));
      const u = rows_('Users').filter(x => x.employeeId === id)[0];
      if (u && cur.status !== data.status && (u.role !== 'admin' || isAdmin)) {
        update_('Users', u._row, { status: data.status, updatedAt: now });
      }
    } else {
      id = nextEmployeeId_();
      created = true;
      insert_('Employees', Object.assign({ employeeId: id }, data, { createdAt: now, updatedAt: now }));
    }
    let account = null;
    if (wantAccount) {
      const r = createUser_({ username: p.username, role: accountRole, employeeId: id, nama: data.nama, email: data.email });
      account = { username: r.user.username, tempPassword: r.tempPassword, role: r.user.role };
    }
    return { employeeId: id, created: created, account: account };
  });
  audit_(ctx, result.created ? 'EMPLOYEE_CREATE' : 'EMPLOYEE_UPDATE', 'Employee', result.employeeId, 'SUCCESS',
    { account: result.account ? result.account.username : '' });
  return result;
}

function employeesRemove_(ctx, p) {
  const id = cleanText_(p.employeeId, 20);
  const outcome = withLock_(() => {
    const cur = freshById_('Employees', 'employeeId', id);
    if (!cur) throw appError_('Data karyawan tidak ditemukan.', 'NOT_FOUND');
    if (cur.employeeId === ctx.user.employeeId) throw appError_('Anda tidak dapat menghapus data karyawan Anda sendiri.', 'VALIDATION');
    const u = rows_('Users').filter(x => x.employeeId === id)[0];
    if (u && u.role === 'admin') {
      if (ctx.user.role !== 'admin') throw appError_('Karyawan ini terhubung dengan akun Admin. Hanya Admin yang dapat mengubahnya.', 'FORBIDDEN');
      if (u.status === 'Aktif' && activeAdminCount_(u.userId) === 0) throw appError_('Harus ada minimal satu Admin aktif.', 'VALIDATION');
    }
    // Aturan pemilik (5 Nov 2026): karyawan yang berhenti dihapus langsung dari daftar, beserta akun loginnya.
    // Riwayat absensi, laporan, bonus, dan foto tetap tersimpan di sheet/Drive sebagai arsip; nomor karyawan tidak dipakai ulang.
    const history = ['Attendance', 'WorkReports', 'BonusReports'].some(s => columnValues_(s, 'employeeId').indexOf(id) >= 0);
    deleteRow_('Employees', cur._row);
    if (u) {
      const fu = freshById_('Users', 'userId', u.userId);
      if (fu) deleteRow_('Users', fu._row);
    }
    return { history: history, user: u ? u.username : '' };
  });
  audit_(ctx, 'EMPLOYEE_REMOVE', 'Employee', id, 'SUCCESS', { outcome: 'deleted', nama: '', history: outcome.history, user: outcome.user });
  return {
    outcome: 'deleted',
    message: 'Karyawan dihapus' + (outcome.user ? ' beserta akun loginnya' : '') + '.' + (outcome.history ? ' Riwayat absensi & laporannya tetap tersimpan di spreadsheet sebagai arsip.' : ''),
  };
}

/** Karyawan memperbarui kontak pribadinya sendiri. */
function employeesUpdateSelf_(ctx, p) {
  const emp = ctx.employee;
  if (!emp) throw appError_('Akun Anda belum terhubung dengan data karyawan.', 'NO_EMPLOYEE');
  const patch = { noHp: optPhone_(p.noHp), alamat: cleanText_(p.alamat, 200), updatedAt: new Date().toISOString() };
  withLock_(() => {
    const cur = freshById_('Employees', 'employeeId', emp.employeeId);
    update_('Employees', cur._row, patch);
  });
  audit_(ctx, 'EMPLOYEE_SELF_UPDATE', 'Employee', emp.employeeId, 'SUCCESS');
  return true;
}
