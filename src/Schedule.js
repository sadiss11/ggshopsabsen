/**
 * Jadwal kerja & aturan absensi (jam masuk/pulang, toleransi terlambat,
 * istirahat, jendela check-in/check-out, shift lintas tengah malam).
 */

function normalizeSchedule_(s) {
  if (!s) return null;
  const masuk = timeToMin_(s.jamMasuk);
  const pulang = timeToMin_(s.jamPulang);
  if (masuk === null || pulang === null) return null;
  const hari = String(s.hariKerja || '').split(',').map(x => Number(String(x).trim())).filter(n => n >= 1 && n <= 7);
  return {
    scheduleId: s.scheduleId,
    nama: s.nama,
    jamMasuk: normTime_(s.jamMasuk),
    jamPulang: normTime_(s.jamPulang),
    masuk: masuk,
    pulang: pulang,
    overnight: pulang <= masuk,
    toleransi: Number(s.toleransiMenit) || 0,
    istMulai: timeToMin_(s.istirahatMulai),
    istSelesai: timeToMin_(s.istirahatSelesai),
    istirahatMulai: normTime_(s.istirahatMulai),
    istirahatSelesai: normTime_(s.istirahatSelesai),
    buka: s.bukaCheckInMenit === null || s.bukaCheckInMenit === undefined ? 120 : Number(s.bukaCheckInMenit),
    batas: s.batasCheckOutMenit === null || s.batasCheckOutMenit === undefined ? 360 : Number(s.batasCheckOutMenit),
    hari: hari.length ? hari : [1, 2, 3, 4, 5],
    status: s.status,
  };
}

function scheduleById_(id) {
  return id ? normalizeSchedule_(findBy_('WorkSchedules', 'scheduleId', id)) : null;
}

/** Jadwal karyawan: jadwal yang ditetapkan → jadwal default → jadwal aktif pertama. */
function scheduleFor_(emp) {
  const all = rows_('WorkSchedules').filter(s => s.status !== 'Nonaktif');
  let s = emp && emp.scheduleId ? all.filter(x => x.scheduleId === emp.scheduleId)[0] : null;
  if (!s) {
    const def = getConfig_().defaultScheduleId;
    s = def ? all.filter(x => x.scheduleId === def)[0] : null;
  }
  if (!s) s = all[0];
  return normalizeSchedule_(s);
}

function isWorkday_(sch, dateStr) {
  return sch.hari.indexOf(isoWeekday_(dateStr)) >= 0;
}

/** Batas-batas waktu (epoch ms) untuk satu tanggal kerja. */
function shiftWindow_(sch, workDate) {
  const tz = getConfig_().timezone;
  const start = localToEpoch_(workDate, sch.masuk, tz);
  const end = localToEpoch_(sch.overnight ? addDays_(workDate, 1) : workDate, sch.pulang, tz);
  let brk = null;
  if (sch.istMulai !== null && sch.istSelesai !== null && sch.istMulai !== sch.istSelesai) {
    const bd = sch.overnight && sch.istMulai < sch.masuk ? addDays_(workDate, 1) : workDate;
    const bs = localToEpoch_(bd, sch.istMulai, tz);
    let be = localToEpoch_(bd, sch.istSelesai, tz);
    if (be <= bs) be = localToEpoch_(addDays_(bd, 1), sch.istSelesai, tz);
    brk = { start: bs, end: be };
  }
  return {
    start: start,
    end: end,
    lateAt: start + sch.toleransi * 60000,
    open: start - sch.buka * 60000,
    close: end + sch.batas * 60000,
    brk: brk,
  };
}

/** Durasi kerja bersih (menit) setelah dikurangi jam istirahat yang beririsan. */
function workMinutes_(inMs, outMs, win) {
  let ms = Math.max(0, outMs - inMs);
  if (win && win.brk) {
    const overlap = Math.max(0, Math.min(outMs, win.brk.end) - Math.max(inMs, win.brk.start));
    ms -= overlap;
  }
  return Math.max(0, Math.round(ms / 60000));
}

function publicSchedule_(sch) {
  if (!sch) return null;
  const namaHari = ['', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
  return {
    scheduleId: sch.scheduleId,
    nama: sch.nama,
    jamMasuk: sch.jamMasuk,
    jamPulang: sch.jamPulang,
    toleransi: sch.toleransi,
    istirahat: sch.istirahatMulai && sch.istirahatSelesai ? sch.istirahatMulai + '–' + sch.istirahatSelesai : '',
    hariKerja: sch.hari.slice().sort().map(n => namaHari[n]).join(', '),
    overnight: sch.overnight,
  };
}

/** Validasi jadwal yang disimpan Admin. */
function validateScheduleInput_(p) {
  const nama = requireText_(p.nama, 'Nama jadwal', 60);
  const jamMasuk = normTime_(p.jamMasuk);
  const jamPulang = normTime_(p.jamPulang);
  if (!jamMasuk) throw appError_('Jam masuk tidak valid (format HH:mm).', 'VALIDATION');
  if (!jamPulang) throw appError_('Jam pulang tidak valid (format HH:mm).', 'VALIDATION');
  if (jamMasuk === jamPulang) throw appError_('Jam masuk dan jam pulang tidak boleh sama.', 'VALIDATION');
  const toleransi = intIn_(p.toleransiMenit, 0, 240, 'Toleransi terlambat');
  const buka = intIn_(p.bukaCheckInMenit, 0, 720, 'Check-in dibuka sebelum jam masuk');
  const batas = intIn_(p.batasCheckOutMenit, 0, 1080, 'Batas check-out setelah jam pulang');
  const istMulai = normTime_(p.istirahatMulai);
  const istSelesai = normTime_(p.istirahatSelesai);
  if ((istMulai && !istSelesai) || (!istMulai && istSelesai)) throw appError_('Jam istirahat mulai dan selesai harus diisi keduanya atau dikosongkan.', 'VALIDATION');
  const hari = String(p.hariKerja || '').split(',').map(x => Number(String(x).trim())).filter(n => n >= 1 && n <= 7);
  if (!hari.length) throw appError_('Pilih minimal satu hari kerja.', 'VALIDATION');

  const m = timeToMin_(jamMasuk), pl = timeToMin_(jamPulang);
  const durasi = pl > m ? pl - m : pl + 1440 - m;
  if (buka + durasi + batas >= 1440) {
    throw appError_('Rentang check-in dibuka hingga batas check-out melebihi 24 jam. Kurangi nilai "dibuka sebelum" atau "batas check-out".', 'VALIDATION');
  }
  return {
    nama: nama, jamMasuk: jamMasuk, jamPulang: jamPulang, toleransiMenit: toleransi,
    istirahatMulai: istMulai, istirahatSelesai: istSelesai, bukaCheckInMenit: buka,
    batasCheckOutMenit: batas, hariKerja: hari.filter((v, i, a) => a.indexOf(v) === i).sort().join(','),
    status: p.status === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
  };
}
