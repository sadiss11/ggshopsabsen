/**
 * Dashboard, notifikasi, dan rekap bulanan.
 */

function lastDayOfMonth_(month) {
  const p = month.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1], 0)).toISOString().slice(0, 10);
}

function monthLabel_(month) {
  const p = month.split('-').map(Number);
  return BULAN_[p[1] - 1] + ' ' + p[0];
}

function eventTime_(ms) {
  return fmtLocal_(ms, 'dd/MM/yyyy HH:mm');
}

function dashboardSummary_(ctx) {
  const nowMs = ctx.now.getTime();
  const today = todayLocal_(nowMs);
  const out = { today: today, todayLabel: longDate_(today) };
  if (ctx.employee && ctx.employee.status === 'Aktif') out.personal = personalSummary_(ctx, today, nowMs);
  if (APPROVER_ROLES_.indexOf(ctx.user.role) >= 0) out.team = teamSummary_(ctx, today, nowMs);
  return out;
}

function teamSummary_(ctx, today, nowMs) {
  const emps = employeesInScope_(ctx).filter(e => e.status === 'Aktif');
  const ids = {};
  emps.forEach(e => { ids[e.employeeId] = e; });
  const from = addDays_(today, -6);
  const att = rowsTail_('Attendance', tailSize_(8)).filter(r => ids[r.employeeId] && r.workDate >= from && r.checkInAt);
  const present = {};
  att.forEach(r => { if (r.workDate === today) present[r.employeeId] = r; });
  const onLeave = {};
  rows_('LeaveRequests').forEach(l => {
    if (l.status === 'Disetujui' && ids[l.employeeId] && l.tanggalMulai <= today && today <= l.tanggalSelesai) onLeave[l.employeeId] = l;
  });

  // Tanpa jadwal: semua karyawan aktif yang belum check-in & tidak izin hari ini.
  const notPresent = [];
  emps.forEach(e => {
    if (present[e.employeeId] || onLeave[e.employeeId]) return;
    notPresent.push({ employeeId: e.employeeId, nama: e.nama, departemen: e.departemen, status: 'Belum absen' });
  });
  notPresent.sort((a, b) => String(a.nama).localeCompare(String(b.nama)));

  const chart = [];
  for (let d = from; d <= today; d = addDays_(d, 1)) {
    const day = att.filter(r => r.workDate === d);
    chart.push({ date: d, hadir: day.length, terlambat: day.filter(r => r.status === 'Terlambat').length });
  }

  const events = [];
  att.forEach(r => {
    const e = ids[r.employeeId];
    events.push({ ms: Date.parse(r.checkInAt), nama: e.nama, text: 'melakukan check-in', type: 'in' });
    if (r.checkOutAt) events.push({ ms: Date.parse(r.checkOutAt), nama: e.nama, text: 'melakukan check-out', type: 'out' });
  });
  const weekAgo = new Date(nowMs - 7 * 86400e3).toISOString();
  rows_('LeaveRequests').forEach(l => {
    if (ids[l.employeeId] && l.diajukanAt >= weekAgo) events.push({ ms: Date.parse(l.diajukanAt), nama: ids[l.employeeId].nama, text: 'mengajukan ' + l.jenis.toLowerCase(), type: 'leave' });
  });
  rows_('Jobdesk').forEach(j => {
    if (ids[j.employeeId] && j.status === 'Selesai' && j.updatedAt >= weekAgo) events.push({ ms: Date.parse(j.updatedAt), nama: ids[j.employeeId].nama, text: 'menyelesaikan tugas', type: 'job' });
  });
  events.sort((a, b) => b.ms - a.ms);

  const presentList = Object.keys(present).map(k => present[k]);
  return {
    totalKaryawan: emps.length,
    newThisMonth: emps.filter(e => String(e.tanggalBergabung).slice(0, 7) === today.slice(0, 7)).length,
    hadir: presentList.length,
    terlambat: presentList.filter(r => r.status === 'Terlambat').length,
    izin: Object.keys(onLeave).length,
    alpha: 0,
    belumAbsen: notPresent.length,
    notPresent: notPresent.slice(0, 8),
    notPresentTotal: notPresent.length,
    chart: chart,
    activity: events.slice(0, 8).map(ev => ({ nama: ev.nama, text: ev.text, type: ev.type, time: eventTime_(ev.ms) })),
    pendingLeaves: rows_('LeaveRequests').filter(l => l.status === 'Menunggu' && l.employeeId !== ctx.user.employeeId && canManageEmployee_(ctx, ids[l.employeeId])).length,
    pendingReports: pendingReportCount_(ctx),
    pendingBonus: pendingReportCount_(ctx, 'BonusReports'),
  };
}

function personalSummary_(ctx, today, nowMs) {
  const emp = ctx.employee;
  const ev = attendanceEval_(emp, nowMs);
  const rec = ev.record || ev.records[ev.workDate] || null;
  const recap = recapFor_([emp], today.slice(0, 7), nowMs)[0];
  const jobs = rows_('Jobdesk').filter(j => j.employeeId === emp.employeeId && j.status !== 'Selesai')
    .sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')));
  return {
    mode: ev.mode, ok: ev.ok, message: ev.message,
    schedule: publicSchedule_(ev.recSchedule || ev.schedule),
    record: summarizeRecord_(rec),
    recap: recap,
    jobs: jobs.slice(0, 5).map(j => strip_(j)),
    activeJobs: jobs.length,
    pendingLeaves: rows_('LeaveRequests').filter(l => l.employeeId === emp.employeeId && l.status === 'Menunggu').length,
  };
}

function notifSummary_(ctx) {
  const items = [];
  if (APPROVER_ROLES_.indexOf(ctx.user.role) >= 0) {
    const empMap = {};
    rows_('Employees').forEach(e => { empMap[e.employeeId] = e; });
    const n = rows_('LeaveRequests').filter(l => l.status === 'Menunggu' && l.employeeId !== ctx.user.employeeId && canManageEmployee_(ctx, empMap[l.employeeId])).length;
    if (n) items.push({ text: n + ' pengajuan izin/cuti menunggu persetujuan', route: 'izin', tone: 'warning' });
    const r = pendingReportCount_(ctx);
    if (r) items.push({ text: r + ' laporan jobdesk menunggu verifikasi', route: 'gaji', tone: 'warning' });
    const b = pendingReportCount_(ctx, 'BonusReports');
    if (b) items.push({ text: b + ' laporan bonus menunggu verifikasi', route: 'gaji/bonus', tone: 'warning' });
  }
  if (ctx.employee && ctx.employee.status === 'Aktif') {
    const today = todayLocal_(ctx.now.getTime());
    const soon = addDays_(today, 1);
    const due = rows_('Jobdesk').filter(j => j.employeeId === ctx.employee.employeeId && j.status !== 'Selesai' && j.deadline && j.deadline <= soon).length;
    if (due) items.push({ text: due + ' jobdesk mendekati atau melewati deadline', route: 'jobdesk', tone: 'danger' });
    const ev = attendanceEval_(ctx.employee, ctx.now.getTime());
    if (ev.mode === 'checkin' && ev.ok) items.push({ text: 'Anda belum check-in hari ini', route: 'absensi', tone: 'info' });
  }
  return { items: items, count: items.length };
}

/** Rekap kehadiran per karyawan untuk satu bulan (hingga hari ini). */
function recapFor_(emps, month, nowMs) {
  const today = todayLocal_(nowMs);
  const first = month + '-01';
  const last = lastDayOfMonth_(month);
  const end = last < today ? last : today;
  const ids = {};
  emps.forEach(e => { ids[e.employeeId] = true; });
  const att = {};
  attendanceSince_(first, nowMs).forEach(r => {
    if (ids[r.employeeId] && r.workDate >= first && r.workDate <= last && r.checkInAt) att[r.employeeId + '|' + r.workDate] = r;
  });
  const leaves = rows_('LeaveRequests').filter(l => ids[l.employeeId] && l.status === 'Disetujui' && l.tanggalMulai <= last && l.tanggalSelesai >= first);

  // Tanpa jadwal: hari dihitung dari absensi & izin yang ada; tidak ada alpha/terlambat otomatis.
  return emps.map(e => {
    const c = { hariKerja: 0, hadir: 0, terlambat: 0, menitTerlambat: 0, pulangCepat: 0, tidakCheckout: 0, izin: 0, sakit: 0, cuti: 0, dinasLuar: 0, alpha: 0, menitKerja: 0 };
    if (first <= end) {
      for (let d = first; d <= end; d = addDays_(d, 1)) {
        if (e.tanggalBergabung && d < e.tanggalBergabung) continue;
        const r = att[e.employeeId + '|' + d];
        if (r) {
          if (r.status === 'Izin') c.izin++;
          else if (r.status === 'Sakit') c.sakit++;
          else if (r.status === 'Cuti') c.cuti++;
          else if (r.status === 'Dinas Luar') c.dinasLuar++;
          else if (r.status === 'Alpha') c.alpha++;
          else {
            c.hadir++;
            if (r.status === 'Terlambat') { c.terlambat++; c.menitTerlambat += r.lateMinutes || 0; }
          }
          if (r.checkOutStatus === 'Pulang Cepat') c.pulangCepat++;
          if (!r.checkOutAt && nowMs > checkoutDeadline_(d)) c.tidakCheckout++;
          c.menitKerja += r.workMinutes || 0;
          continue;
        }
        const lv = leaves.filter(l => l.employeeId === e.employeeId && l.tanggalMulai <= d && d <= l.tanggalSelesai)[0];
        if (lv) {
          if (lv.jenis === 'Izin') c.izin++;
          else if (lv.jenis === 'Sakit') c.sakit++;
          else if (lv.jenis === 'Cuti') c.cuti++;
          else c.dinasLuar++;
        }
      }
    }
    const present = c.hadir + c.dinasLuar;
    c.hariKerja = present;
    return Object.assign({
      employeeId: e.employeeId, nama: e.nama, jabatan: e.jabatan, departemen: e.departemen, status: e.status,
      persenHadir: c.hariKerja ? Math.round(present / c.hariKerja * 100) : 0,
    }, c);
  });
}

function reportMonthly_(ctx, p) {
  const today = todayLocal_(ctx.now.getTime());
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p.month || '')) ? p.month : today.slice(0, 7);
  const dept = cleanText_(p.departemen, 60);
  const first = month + '-01', last = lastDayOfMonth_(month);
  const withRecords = {};
  attendanceSince_(first, ctx.now.getTime()).forEach(r => {
    if (r.workDate >= first && r.workDate <= last) withRecords[r.employeeId] = true;
  });
  const emps = employeesInScope_(ctx)
    .filter(e => (e.status === 'Aktif' || withRecords[e.employeeId]) && (!dept || e.departemen === dept))
    .sort((a, b) => (a.employeeId < b.employeeId ? -1 : 1));
  const rows = recapFor_(emps, month, ctx.now.getTime());
  const totals = rows.reduce((t, r) => {
    ['hariKerja', 'hadir', 'terlambat', 'menitTerlambat', 'pulangCepat', 'tidakCheckout', 'izin', 'sakit', 'cuti', 'dinasLuar', 'alpha', 'menitKerja']
      .forEach(k => { t[k] = (t[k] || 0) + r[k]; });
    return t;
  }, {});
  return { month: month, monthLabel: monthLabel_(month), rows: rows, totals: totals, generatedAt: fmtLocal_(ctx.now.getTime(), 'dd/MM/yyyy HH:mm') };
}
