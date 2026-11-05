/**
 * Autentikasi & otorisasi.
 *
 * - Password disimpan sebagai PBKDF2-HMAC-SHA256 dengan salt acak (bukan teks biasa).
 * - Token sesi acak disimpan di Script Properties dalam bentuk hash SHA-256
 *   (CacheService tidak dipakai karena TTL maksimalnya 6 jam, lebih pendek dari
 *   jarak check-in pagi ke check-out sore).
 * - Setiap permintaan membaca ulang data pengguna dari sheet, sehingga role/status
 *   tidak pernah diambil dari browser. Sesi otomatis gugur bila password diganti
 *   atau akun dinonaktifkan.
 */

function randomBytes_(n) {
  const out = [];
  while (out.length < n) {
    const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid());
    for (let i = 0; i < b.length && out.length < n; i++) out.push(b[i]);
  }
  return out;
}

function pbkdf2_(passwordBytes, salt, iterations) {
  let u = Utilities.computeHmacSha256Signature(salt.concat([0, 0, 0, 1]), passwordBytes);
  const t = u.slice();
  for (let i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, passwordBytes);
    for (let j = 0; j < t.length; j++) t[j] = t[j] ^ u[j];
  }
  return t;
}

function hashPassword_(password) {
  const salt = randomBytes_(16);
  const iter = LIMITS_.HASH_ITERATIONS;
  const dk = pbkdf2_(Utilities.newBlob(String(password)).getBytes(), salt, iter);
  return 'pbkdf2$' + iter + '$' + Utilities.base64Encode(salt) + '$' + Utilities.base64Encode(dk);
}

function verifyPassword_(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = Number(parts[1]);
  if (!isFinite(iter) || iter < 1 || iter > 100000) return false;
  const salt = Utilities.base64Decode(parts[2]);
  const dk = Utilities.base64Encode(pbkdf2_(Utilities.newBlob(String(password)).getBytes(), salt, iter));
  return safeEqual_(dk, parts[3]);
}

function safeEqual_(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function validatePassword_(pw) {
  pw = String(pw || '');
  if (pw.length < LIMITS_.PASSWORD_MIN) throw appError_('Password minimal ' + LIMITS_.PASSWORD_MIN + ' karakter.', 'VALIDATION');
  if (pw.length > 128) throw appError_('Password terlalu panjang.', 'VALIDATION');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw appError_('Password harus mengandung huruf dan angka.', 'VALIDATION');
  return pw;
}

function normUsername_(v) {
  return cleanText_(v, 40).toLowerCase();
}

function pwFingerprint_(hash) {
  return sha256Hex_(String(hash)).slice(0, 16);
}

function sessionExpired_(s, nowMs) {
  return !s || nowMs - Number(s.c) > LIMITS_.SESSION_MAX_AGE_MS || nowMs - Number(s.s) > LIMITS_.SESSION_IDLE_MS;
}

function createSession_(user) {
  const token = uid_() + uid_();
  const now = Date.now();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('sess_' + sha256Hex_(token), JSON.stringify({ u: user.userId, c: now, s: now, h: pwFingerprint_(user.passwordHash) }));
  purgeSessions_(now);
  return token;
}

/** Menghapus sesi kedaluwarsa agar Script Properties tidak penuh (batas 500 KB). */
function purgeSessions_(nowMs) {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(k => {
    if (k.indexOf('sess_') !== 0) return;
    let s = null;
    try { s = JSON.parse(all[k]); } catch (e) { s = null; }
    if (sessionExpired_(s, nowMs)) props.deleteProperty(k);
  });
}

/** Mengembalikan pengguna aktif untuk token, atau null bila sesi tidak sah. */
function sessionUser_(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const props = PropertiesService.getScriptProperties();
  const key = 'sess_' + sha256Hex_(token);
  const raw = props.getProperty(key);
  if (!raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch (e) { s = null; }
  const now = Date.now();
  if (sessionExpired_(s, now)) { props.deleteProperty(key); return null; }
  const user = findBy_('Users', 'userId', s.u);
  if (!user || user.status !== 'Aktif' || s.h !== pwFingerprint_(user.passwordHash)) { props.deleteProperty(key); return null; }
  if (now - Number(s.s) > 10 * 60e3) { s.s = now; props.setProperty(key, JSON.stringify(s)); }
  return { user: withEffectiveRole_(user), key: key };
}

/**
 * Role yang berlaku. Nilai lama "manager" (role yang sudah dihapus) dan nilai tak
 * dikenal di sheet diperlakukan sebagai karyawan: hanya melihat data sendiri.
 */
function effectiveRole_(role) {
  return ROLES_.indexOf(role) >= 0 ? role : 'karyawan';
}

function withEffectiveRole_(user) {
  return Object.assign({}, user, { role: effectiveRole_(user.role) });
}

function publicUser_(user) {
  const emp = user.employeeId ? findBy_('Employees', 'employeeId', user.employeeId) : null;
  return {
    userId: user.userId,
    username: user.username,
    nama: (emp && emp.nama) || user.nama || user.username,
    role: effectiveRole_(user.role),
    roleLabel: ROLE_LABELS_[effectiveRole_(user.role)],
    employeeId: emp ? emp.employeeId : '',
    jabatan: emp ? emp.jabatan : '',
    departemen: emp ? emp.departemen : '',
    mustChangePassword: !!user.mustChangePassword,
    hasBonus: schemesForEmployee_(emp).length > 0,
  };
}

function authLogin_(ctx, p) {
  const username = normUsername_(p.username);
  const password = String(p.password || '');
  ctx.username = username;
  if (!username || !password) throw appError_('Username dan password wajib diisi.', 'VALIDATION');
  if (password.length > 128) throw appError_('Username atau password salah.', 'AUTH_FAILED');

  const cache = CacheService.getScriptCache();
  const failKey = 'lf_' + sha256Hex_(username).slice(0, 32);
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= LIMITS_.LOGIN_MAX_FAIL) {
    audit_(ctx, 'LOGIN', 'User', username, 'DENIED', { reason: 'LOCKED' });
    throw appError_('Terlalu banyak percobaan masuk. Silakan coba lagi dalam 15 menit.', 'RATE_LIMIT');
  }

  const user = rows_('Users').filter(u => u.username === username)[0] || null;
  let ok;
  if (user) ok = verifyPassword_(password, user.passwordHash);
  else { hashPassword_(password); ok = false; } // menyamakan waktu respons

  if (!ok) {
    cache.put(failKey, String(fails + 1), LIMITS_.LOGIN_LOCK_SEC);
    audit_(ctx, 'LOGIN', 'User', username, 'FAIL', { reason: 'BAD_CREDENTIALS', attempt: fails + 1 });
    throw appError_('Username atau password salah.', 'AUTH_FAILED');
  }
  if (user.status !== 'Aktif') {
    audit_(ctx, 'LOGIN', 'User', username, 'DENIED', { reason: 'INACTIVE' });
    throw appError_('Akun Anda tidak aktif. Hubungi Admin atau HR.', 'ACCOUNT_INACTIVE');
  }
  cache.remove(failKey);
  const nowIso = new Date().toISOString();
  if (!user.lastLoginAt || Date.parse(nowIso) - Date.parse(user.lastLoginAt) > 3600e3) {
    withLock_(() => {
      const fresh = freshById_('Users', 'userId', user.userId);
      if (fresh) update_('Users', fresh._row, { lastLoginAt: nowIso });
    });
  }
  ctx.user = withEffectiveRole_(user);
  ctx.employee = user.employeeId ? findBy_('Employees', 'employeeId', user.employeeId) : null;
  audit_(ctx, 'LOGIN', 'User', user.userId, 'SUCCESS');
  const token = createSession_(user);
  return Object.assign({ token: token }, user.mustChangePassword ? { user: publicUser_(user) } : bootBundle_(ctx, p.page));
}

function authLogout_(ctx) {
  PropertiesService.getScriptProperties().deleteProperty(ctx.sessKey);
  audit_(ctx, 'LOGOUT', 'User', ctx.user.userId, 'SUCCESS');
  return true;
}

function authMe_(ctx) {
  return { user: publicUser_(ctx.user), company: publicCompany_() };
}

/**
 * Semua data awal aplikasi dalam satu panggilan: pengguna, perusahaan, jam server,
 * notifikasi, dan data halaman pertama (bila diminta). Menghemat 2–3 bolak-balik
 * ke server saat aplikasi dibuka.
 */
function bootBundle_(ctx, page) {
  const out = { user: publicUser_(ctx.user), company: publicCompany_(), time: timeNow_(ctx), notif: notifSummary_(ctx), prefetch: {} };
  if (page === 'dashboard' || !page) out.prefetch['dashboard.summary'] = dashboardSummary_(ctx);
  return out;
}

function appBoot_(ctx, p) {
  return bootBundle_(ctx, cleanText_(p.page, 20));
}

/** Aksi baca yang boleh diambil sekaligus lewat app.prefetch. */
const PREFETCHABLE_ = ['dashboard.summary', 'attendance.state', 'jobs.list', 'leave.list', 'employees.list', 'employees.get', 'attendance.history',
  'meta.options', 'work.list', 'bonus.list', 'bonus.form', 'bonus.schemes', 'rates.list', 'payroll.summary'];

/**
 * Mengambil data beberapa halaman dalam satu eksekusi (satu kali jeda server, bukan satu per halaman).
 * Setiap item tetap diperiksa role-nya seperti lewat api(); cakupan data dijaga fungsi aksinya.
 */
function appPrefetch_(ctx, p) {
  const routes = routes_();
  const out = {};
  (Array.isArray(p.items) ? p.items : []).slice(0, 16).forEach(it => {
    const key = cleanText_(it && it.key, 300);
    const action = String((it && it.action) || '');
    const route = routes[action];
    if (!key || !route || PREFETCHABLE_.indexOf(action) < 0) return;
    if (route.roles && route.roles.indexOf(ctx.user.role) < 0) return;
    const payload = it.payload && typeof it.payload === 'object' && !Array.isArray(it.payload) ? Object.assign({}, it.payload) : {};
    delete payload.withSession; // sesi kamera tidak pernah dibuat lewat prefetch
    try {
      const data = route.fn(ctx, payload);
      out[key] = { ok: true, data: data === undefined ? null : data };
    } catch (e) {
      out[key] = { ok: false, code: e && e.isAppError ? e.code : 'SERVER_ERROR' };
    }
  });
  return { results: out };
}

function authChangePassword_(ctx, p) {
  const oldPw = String(p.oldPassword || '');
  const newPw = validatePassword_(p.newPassword);
  if (!verifyPassword_(oldPw, ctx.user.passwordHash)) {
    audit_(ctx, 'CHANGE_PASSWORD', 'User', ctx.user.userId, 'FAIL', { reason: 'BAD_OLD_PASSWORD' });
    throw appError_('Password lama tidak sesuai.', 'VALIDATION');
  }
  if (oldPw === newPw) throw appError_('Password baru harus berbeda dari password lama.', 'VALIDATION');
  const hash = hashPassword_(newPw);
  withLock_(() => {
    const fresh = freshById_('Users', 'userId', ctx.user.userId);
    update_('Users', fresh._row, { passwordHash: hash, mustChangePassword: false, updatedAt: new Date().toISOString() });
  });
  PropertiesService.getScriptProperties().deleteProperty(ctx.sessKey);
  const updated = freshById_('Users', 'userId', ctx.user.userId);
  audit_(ctx, 'CHANGE_PASSWORD', 'User', ctx.user.userId, 'SUCCESS');
  return { token: createSession_(updated), user: publicUser_(updated) };
}

/* ---------- Otorisasi ---------- */

function requireRole_(ctx, roles) {
  if (roles.indexOf(ctx.user.role) < 0) throw appError_('Anda tidak memiliki akses untuk tindakan ini.', 'FORBIDDEN');
}

function requireEmployee_(ctx) {
  if (!ctx.employee) throw appError_('Akun Anda belum terhubung dengan data karyawan. Hubungi Admin.', 'NO_EMPLOYEE');
  if (ctx.employee.status !== 'Aktif') throw appError_('Data karyawan Anda tidak aktif. Hubungi HR.', 'EMPLOYEE_INACTIVE');
  return ctx.employee;
}

/** Apakah pengguna boleh melihat data karyawan tertentu: Super Admin & HRD semua, lainnya hanya diri sendiri. */
function canSeeEmployee_(ctx, emp) {
  if (!emp) return false;
  if (APPROVER_ROLES_.indexOf(ctx.user.role) >= 0) return true;
  return emp.employeeId === ctx.user.employeeId;
}

/** Apakah pengguna boleh mengelola (menyetujui/menugaskan) karyawan tertentu. */
function canManageEmployee_(ctx, emp) {
  return !!emp && APPROVER_ROLES_.indexOf(ctx.user.role) >= 0;
}

function employeesInScope_(ctx) {
  return rows_('Employees').filter(e => canSeeEmployee_(ctx, e));
}
