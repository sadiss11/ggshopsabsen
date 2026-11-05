/**
 * Pengajuan izin, sakit, cuti, dan dinas luar.
 */

function leaveView_(l, emp) {
  return Object.assign(strip_(l), {
    nama: emp ? emp.nama : l.employeeId,
    departemen: emp ? emp.departemen : '',
    hari: Math.round((Date.parse(l.tanggalSelesai) - Date.parse(l.tanggalMulai)) / 86400e3) + 1,
  });
}

function leaveList_(ctx, p) {
  const scope = p.scope === 'approvals' ? 'approvals' : 'mine';
  const empMap = {};
  rows_('Employees').forEach(e => { empMap[e.employeeId] = e; });
  let list;
  if (scope === 'approvals') {
    requireRole_(ctx, APPROVER_ROLES_);
    list = rows_('LeaveRequests').filter(l => l.employeeId !== ctx.user.employeeId && canManageEmployee_(ctx, empMap[l.employeeId]));
  } else {
    if (!ctx.employee) return { requests: [], scope: scope };
    list = rows_('LeaveRequests').filter(l => l.employeeId === ctx.employee.employeeId);
  }
  const status = cleanText_(p.status, 20);
  if (status) list = list.filter(l => l.status === status);
  list.sort((a, b) => (a.diajukanAt < b.diajukanAt ? 1 : -1));
  return { requests: list.slice(0, 300).map(l => leaveView_(l, empMap[l.employeeId])), scope: scope };
}

function leaveSubmit_(ctx, p) {
  const emp = requireEmployee_(ctx);
  const jenis = oneOf_(p.jenis, LEAVE_TYPES_, 'Jenis pengajuan');
  const mulai = requireDate_(p.tanggalMulai, 'Tanggal mulai');
  const selesai = requireDate_(p.tanggalSelesai, 'Tanggal selesai');
  const alasan = requireText_(p.alasan, 'Alasan', 300);
  if (selesai < mulai) throw appError_('Tanggal selesai tidak boleh sebelum tanggal mulai.', 'VALIDATION');
  const days = Math.round((Date.parse(selesai) - Date.parse(mulai)) / 86400e3) + 1;
  if (days > 30) throw appError_('Satu pengajuan maksimal 30 hari.', 'VALIDATION');
  const today = todayLocal_(ctx.now.getTime());
  if (mulai < addDays_(today, -7)) throw appError_('Pengajuan untuk tanggal lampau maksimal 7 hari ke belakang.', 'VALIDATION');
  rateLimit_('lv_' + ctx.user.userId, 10, 3600, 'Terlalu banyak pengajuan dalam satu jam.');

  const leave = withLock_(() => {
    invalidate_('LeaveRequests');
    const overlap = rows_('LeaveRequests').some(l => l.employeeId === emp.employeeId &&
      (l.status === 'Menunggu' || l.status === 'Disetujui') && l.tanggalMulai <= selesai && mulai <= l.tanggalSelesai);
    if (overlap) throw appError_('Sudah ada pengajuan lain pada rentang tanggal tersebut.', 'VALIDATION');
    const rec = {
      leaveId: shortId_('LV'), employeeId: emp.employeeId, jenis: jenis, tanggalMulai: mulai, tanggalSelesai: selesai,
      alasan: alasan, status: 'Menunggu', diajukanAt: ctx.now.toISOString(), diprosesOleh: '', diprosesAt: '', catatan: '',
    };
    insert_('LeaveRequests', rec);
    return rec;
  });
  audit_(ctx, 'LEAVE_SUBMIT', 'LeaveRequest', leave.leaveId, 'SUCCESS', { jenis: jenis, days: days });
  return { leaveId: leave.leaveId };
}

function leaveDecide_(ctx, p) {
  const id = cleanText_(p.leaveId, 30);
  const decision = oneOf_(p.decision, ['Disetujui', 'Ditolak'], 'Keputusan');
  const catatan = cleanText_(p.catatan, 300);
  withLock_(() => {
    const l = freshById_('LeaveRequests', 'leaveId', id);
    if (!l) throw appError_('Pengajuan tidak ditemukan.', 'NOT_FOUND');
    if (l.status !== 'Menunggu') throw appError_('Pengajuan ini sudah diproses sebelumnya.', 'VALIDATION');
    if (l.employeeId === ctx.user.employeeId) throw appError_('Anda tidak dapat memproses pengajuan Anda sendiri.', 'FORBIDDEN');
    const emp = findBy_('Employees', 'employeeId', l.employeeId);
    if (!canManageEmployee_(ctx, emp)) throw appError_('Anda tidak berwenang memproses pengajuan ini.', 'FORBIDDEN');
    update_('LeaveRequests', l._row, { status: decision, diprosesOleh: ctx.user.username, diprosesAt: new Date().toISOString(), catatan: catatan });
  });
  audit_(ctx, 'LEAVE_DECIDE', 'LeaveRequest', id, 'SUCCESS', { decision: decision });
  return true;
}

function leaveCancel_(ctx, p) {
  const id = cleanText_(p.leaveId, 30);
  withLock_(() => {
    const l = freshById_('LeaveRequests', 'leaveId', id);
    if (!l || !ctx.employee || l.employeeId !== ctx.employee.employeeId) throw appError_('Pengajuan tidak ditemukan.', 'NOT_FOUND');
    if (l.status !== 'Menunggu') throw appError_('Hanya pengajuan berstatus Menunggu yang dapat dibatalkan.', 'VALIDATION');
    update_('LeaveRequests', l._row, { status: 'Dibatalkan', diprosesAt: new Date().toISOString() });
  });
  audit_(ctx, 'LEAVE_CANCEL', 'LeaveRequest', id, 'SUCCESS');
  return true;
}
