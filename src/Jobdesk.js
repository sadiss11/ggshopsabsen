/**
 * Jobdesk: pembagian tugas karyawan.
 */

function jobsList_(ctx, p) {
  const empMap = {};
  rows_('Employees').forEach(e => { empMap[e.employeeId] = e; });
  const status = cleanText_(p.status, 20);
  const list = rows_('Jobdesk')
    .filter(j => empMap[j.employeeId] && canSeeEmployee_(ctx, empMap[j.employeeId]))
    .filter(j => !status || j.status === status)
    .map(j => {
      const e = empMap[j.employeeId];
      return Object.assign(strip_(j), {
        nama: e.nama, jabatan: e.jabatan, departemen: e.departemen,
        canManage: canManageEmployee_(ctx, e),
        canUpdate: j.employeeId === ctx.user.employeeId || canManageEmployee_(ctx, e),
      });
    });
  const order = { 'In Progress': 0, 'Pending': 1, 'Selesai': 2 };
  list.sort((a, b) => (order[a.status] - order[b.status]) || String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')));
  return { jobs: list, canCreate: APPROVER_ROLES_.indexOf(ctx.user.role) >= 0 };
}

function jobsSave_(ctx, p) {
  const employeeId = cleanText_(p.employeeId, 20);
  const emp = findBy_('Employees', 'employeeId', employeeId);
  if (!emp) throw appError_('Pilih karyawan yang valid.', 'VALIDATION');
  if (!canManageEmployee_(ctx, emp)) throw appError_('Anda tidak berwenang menugaskan karyawan ini.', 'FORBIDDEN');
  const data = {
    employeeId: employeeId,
    judul: requireText_(p.judul, 'Judul jobdesk', 120),
    deskripsi: cleanText_(p.deskripsi, 1000),
    deadline: optDate_(p.deadline, 'Deadline'),
    prioritas: oneOf_(p.prioritas || 'Sedang', JOB_PRIORITY_, 'Prioritas'),
    status: oneOf_(p.status || 'Pending', JOB_STATUS_, 'Status'),
  };
  const now = new Date().toISOString();
  const id = withLock_(() => {
    const jobId = cleanText_(p.jobId, 30);
    if (jobId) {
      const cur = freshById_('Jobdesk', 'jobId', jobId);
      if (!cur) throw appError_('Jobdesk tidak ditemukan.', 'NOT_FOUND');
      if (!canManageEmployee_(ctx, findBy_('Employees', 'employeeId', cur.employeeId))) throw appError_('Anda tidak berwenang mengubah jobdesk ini.', 'FORBIDDEN');
      update_('Jobdesk', cur._row, Object.assign({}, data, { updatedAt: now }));
      return jobId;
    }
    const nid = shortId_('JOB');
    insert_('Jobdesk', Object.assign({ jobId: nid }, data, { dibuatOleh: ctx.user.username, createdAt: now, updatedAt: now }));
    return nid;
  });
  audit_(ctx, p.jobId ? 'JOB_UPDATE' : 'JOB_CREATE', 'Jobdesk', id, 'SUCCESS', { employeeId: employeeId });
  return { jobId: id };
}

function jobsUpdateStatus_(ctx, p) {
  const jobId = cleanText_(p.jobId, 30);
  const status = oneOf_(p.status, JOB_STATUS_, 'Status');
  withLock_(() => {
    const cur = freshById_('Jobdesk', 'jobId', jobId);
    if (!cur) throw appError_('Jobdesk tidak ditemukan.', 'NOT_FOUND');
    const emp = findBy_('Employees', 'employeeId', cur.employeeId);
    if (cur.employeeId !== ctx.user.employeeId && !canManageEmployee_(ctx, emp)) throw appError_('Anda tidak berwenang mengubah jobdesk ini.', 'FORBIDDEN');
    update_('Jobdesk', cur._row, { status: status, updatedAt: new Date().toISOString() });
  });
  audit_(ctx, 'JOB_STATUS', 'Jobdesk', jobId, 'SUCCESS', { status: status });
  return true;
}

function jobsRemove_(ctx, p) {
  const jobId = cleanText_(p.jobId, 30);
  withLock_(() => {
    const cur = freshById_('Jobdesk', 'jobId', jobId);
    if (!cur) throw appError_('Jobdesk tidak ditemukan.', 'NOT_FOUND');
    if (!canManageEmployee_(ctx, findBy_('Employees', 'employeeId', cur.employeeId))) throw appError_('Anda tidak berwenang menghapus jobdesk ini.', 'FORBIDDEN');
    deleteRow_('Jobdesk', cur._row);
  });
  audit_(ctx, 'JOB_REMOVE', 'Jobdesk', jobId, 'SUCCESS');
  return true;
}
