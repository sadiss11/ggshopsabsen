/**
 * Titik masuk web app & dispatcher API.
 *
 * Browser hanya memanggil satu fungsi: api(action, payload, token).
 * Setiap aksi didaftarkan di routes_() beserta kebutuhan login dan role.
 */

function doGet() {
  const cfg = getConfig_();
  const t = HtmlService.createTemplateFromFile('Index');
  t.boot = safeJson_({ companyName: cfg.companyName, appName: APP_.NAME, version: APP_.VERSION });
  return t.evaluate()
    .setTitle(cfg.companyName + ' · ' + APP_.NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/**
 * API yang sama dengan api(), untuk tampilan yang di-hosting di luar Google (Vercel).
 * Browser mengirim POST text/plain berisi {action, payload, token} (permintaan
 * "simple" tanpa preflight CORS); respons berupa JSON. Semua pemeriksaan sesi,
 * role, dan cakupan data sama persis dengan api().
 */
function doPost(e) {
  let msg = {};
  try { msg = JSON.parse((e && e.postData && e.postData.contents) || '{}') || {}; } catch (err) { msg = {}; }
  const res = api(msg.action, msg.payload, typeof msg.token === 'string' ? msg.token : null);
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** JSON yang aman disisipkan di dalam tag <script>. */
function safeJson_(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function routes_() {
  const STAFF = APPROVER_ROLES_;
  const HR = ['admin', 'hr'];
  const ADMIN = ['admin'];
  return {
    'auth.login': { fn: authLogin_, auth: false },
    'auth.logout': { fn: authLogout_, pwChange: true },
    'auth.me': { fn: authMe_, pwChange: true },
    'auth.changePassword': { fn: authChangePassword_, pwChange: true },
    'app.boot': { fn: appBoot_ },
    'app.prefetch': { fn: appPrefetch_ },
    'time.now': { fn: timeNow_, auth: false },

    'dashboard.summary': { fn: dashboardSummary_ },
    'notif.summary': { fn: notifSummary_ },

    'attendance.state': { fn: attendanceState_ },
    'attendance.begin': { fn: attendanceBegin_ },
    'attendance.checkLocation': { fn: attendanceCheckLocation_ },
    'attendance.submit': { fn: attendanceSubmit_ },
    'attendance.history': { fn: attendanceHistory_ },
    'attendance.photo': { fn: attendancePhoto_ },
    'attendance.list': { fn: attendanceList_, roles: STAFF },
    'attendance.update': { fn: attendanceUpdate_, roles: HR },

    'employees.list': { fn: employeesList_, roles: STAFF },
    'employees.get': { fn: employeesGet_ },
    'employees.save': { fn: employeesSave_, roles: HR },
    'employees.remove': { fn: employeesRemove_, roles: HR },
    'employees.updateSelf': { fn: employeesUpdateSelf_ },

    'jobs.list': { fn: jobsList_ },
    'jobs.save': { fn: jobsSave_, roles: STAFF },
    'jobs.updateStatus': { fn: jobsUpdateStatus_ },
    'jobs.remove': { fn: jobsRemove_, roles: STAFF },

    'leave.list': { fn: leaveList_ },
    'leave.submit': { fn: leaveSubmit_ },
    'leave.decide': { fn: leaveDecide_, roles: STAFF },
    'leave.cancel': { fn: leaveCancel_ },

    'report.monthly': { fn: reportMonthly_, roles: STAFF },
    'meta.options': { fn: metaOptions_, roles: STAFF },

    'settings.get': { fn: settingsGet_, roles: ADMIN },
    'settings.save': { fn: settingsSave_, roles: ADMIN },
    'locations.list': { fn: locationsList_, roles: ADMIN },
    'locations.save': { fn: locationsSave_, roles: ADMIN },
    'locations.remove': { fn: locationsRemove_, roles: ADMIN },
    'schedules.list': { fn: schedulesList_, roles: HR },
    'schedules.save': { fn: schedulesSave_, roles: ADMIN },
    'schedules.remove': { fn: schedulesRemove_, roles: ADMIN },
    'users.list': { fn: usersList_, roles: ADMIN },
    'users.save': { fn: usersSave_, roles: ADMIN },
    'users.resetPassword': { fn: usersResetPassword_, roles: ADMIN },
    'users.remove': { fn: usersRemove_, roles: ADMIN },
    'audit.list': { fn: auditList_, roles: ADMIN },

    'rates.list': { fn: ratesList_, roles: STAFF },
    'rates.save': { fn: ratesSave_, roles: HR },
    'rates.remove': { fn: ratesRemove_, roles: HR },
    'work.list': { fn: workList_ },
    'work.verify': { fn: workVerify_, roles: STAFF },
    'work.photo': { fn: workPhoto_ },
    'payroll.summary': { fn: payrollSummary_, roles: HR },

    'bonus.schemes': { fn: bonusSchemes_, roles: HR },
    'bonus.saveScheme': { fn: bonusSaveScheme_, roles: HR },
    'bonus.removeScheme': { fn: bonusRemoveScheme_, roles: HR },
    'bonus.form': { fn: bonusForm_ },
    'bonus.submit': { fn: bonusSubmit_ },
    'bonus.list': { fn: bonusList_ },
    'bonus.verify': { fn: bonusVerify_, roles: HR },
    'bonus.photo': { fn: bonusPhoto_ },
  };
}

/**
 * Satu-satunya fungsi API untuk browser.
 * @param {string} action nama aksi, mis. 'attendance.submit'
 * @param {Object} payload data permintaan
 * @param {string} token token sesi
 */
function api(action, payload, token) {
  const now = new Date(); // waktu penerimaan permintaan = waktu resmi transaksi
  const ctx = { now: now, user: null, employee: null, sessKey: null };
  try {
    const routes = routes_();
    if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(routes, action)) {
      throw appError_('Aksi tidak dikenal.', 'BAD_REQUEST');
    }
    const route = routes[action];
    const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    if (route.auth !== false) {
      const s = sessionUser_(token);
      if (!s) throw appError_('Sesi Anda telah berakhir. Silakan masuk kembali.', 'AUTH_REQUIRED');
      ctx.user = s.user;
      ctx.sessKey = s.key;
      if (ctx.user.mustChangePassword && !route.pwChange) {
        throw appError_('Anda wajib mengganti password sementara terlebih dahulu.', 'PASSWORD_CHANGE_REQUIRED');
      }
      if (route.roles && route.roles.indexOf(ctx.user.role) < 0) {
        audit_(ctx, 'ACCESS_DENIED', 'Route', action, 'DENIED');
        throw appError_('Anda tidak memiliki akses untuk fitur ini.', 'FORBIDDEN');
      }
      ctx.employee = ctx.user.employeeId ? findBy_('Employees', 'employeeId', ctx.user.employeeId) : null;
    }
    const data = route.fn(ctx, p);
    return { ok: true, data: data === undefined ? null : JSON.parse(JSON.stringify(data)), serverTime: now.getTime() };
  } catch (err) {
    if (err && err.isAppError) return { ok: false, error: err.message, code: err.code, serverTime: now.getTime() };
    console.error('API ' + action + ' gagal: ' + (err && err.stack ? err.stack : err));
    try { audit_(ctx, 'SERVER_ERROR', 'Route', String(action).slice(0, 40), 'FAIL', { message: String(err && err.message || err).slice(0, 200) }); } catch (e) { /* abaikan */ }
    return { ok: false, error: 'Terjadi kesalahan pada server. Silakan coba lagi.', code: 'SERVER_ERROR', serverTime: now.getTime() };
  }
}
