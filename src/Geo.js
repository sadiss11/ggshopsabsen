/**
 * Validasi lokasi absensi. Jarak SELALU dihitung ulang di server terhadap titik
 * kantor yang tersimpan di sheet WorkLocations. Status apa pun dari browser
 * (mis. isInsideOffice, koordinat kantor, radius) diabaikan.
 *
 * Keterbatasan: Geolocation API browser tidak dapat membuktikan bahwa koordinat
 * tidak dipalsukan (aplikasi fake GPS / perangkat yang dimodifikasi). Karena itu
 * server menambahkan penanda kewajaran (flags) untuk ditinjau HR, bukan klaim
 * anti-spoofing.
 */

function haversineMeters_(lat1, lon1, lat2, lon2) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Membaca koordinat dari payload. Hanya lat, lng, accuracy yang dipakai. */
function parseReading_(p) {
  const has = v => v !== null && v !== undefined && v !== '';
  if (!has(p.lat) || !has(p.lng)) return { error: 'LOCATION_REQUIRED' };
  const lat = Number(p.lat), lng = Number(p.lng), acc = Number(p.accuracy);
  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) {
    return { error: 'LOCATION_INVALID' };
  }
  if (!isFinite(acc) || acc <= 0) return { error: 'ACCURACY_MISSING' };
  return { lat: lat, lng: lng, accuracy: acc, raw: { lat: String(p.lat), lng: String(p.lng) } };
}

function fmtDistance_(m) {
  return m >= 1000 ? round_(m / 1000, 2).toString().replace('.', ',') + ' km' : Math.round(m) + ' m';
}

function activeLocations_() {
  return rows_('WorkLocations').filter(l =>
    l.status !== 'Nonaktif' && isFinite(l.latitude) && isFinite(l.longitude) && l.latitude !== null && l.longitude !== null && Number(l.radius) > 0);
}

function locationsForEmployee_(emp) {
  const all = activeLocations_();
  const ids = String(emp.locationIds || '').split(',').map(s => s.trim()).filter(Boolean);
  return ids.length ? all.filter(l => ids.indexOf(l.locationId) >= 0) : all;
}

/**
 * @return {{ok:boolean, code:string, message:string, distance?:number, radius?:number,
 *   location?:Object, accuracy?:number, maxAccuracy:number, flags:string[]}}
 */
function validateLocation_(emp, reading) {
  const cfg = getConfig_();
  const base = { maxAccuracy: cfg.gpsMaxAccuracy, flags: [] };
  if (reading.error === 'LOCATION_REQUIRED') {
    return Object.assign(base, { ok: false, code: 'LOCATION_REQUIRED', message: 'Izin lokasi diperlukan untuk melakukan absensi.' });
  }
  if (reading.error === 'ACCURACY_MISSING') {
    return Object.assign(base, { ok: false, code: 'ACCURACY_LOW', message: 'Akurasi GPS tidak terbaca. Silakan perbarui lokasi.' });
  }
  if (reading.error) {
    return Object.assign(base, { ok: false, code: 'LOCATION_INVALID', message: 'Data lokasi tidak valid. Silakan perbarui lokasi.' });
  }

  const locs = locationsForEmployee_(emp);
  if (!locs.length) {
    return Object.assign(base, { ok: false, code: 'NO_OFFICE', message: 'Lokasi kantor belum dikonfigurasi untuk akun Anda. Hubungi Admin.' });
  }

  let best = null;
  locs.forEach(l => {
    const d = haversineMeters_(reading.lat, reading.lng, Number(l.latitude), Number(l.longitude));
    if (!best || d - Number(l.radius) < best.d - Number(best.l.radius)) best = { l: l, d: d };
  });
  const distance = round_(best.d, 1);
  const radius = Number(best.l.radius);
  const accuracy = round_(reading.accuracy, 1);
  const out = Object.assign(base, {
    distance: distance, radius: radius, accuracy: accuracy,
    location: { locationId: best.l.locationId, nama: best.l.nama },
  });

  // Penanda kewajaran (tidak menolak, dicatat untuk peninjauan).
  if (reading.accuracy < 1) out.flags.push('ACC_SUSPICIOUS');
  if (best.d < 0.5) out.flags.push('EXACT_OFFICE_COORD');
  if (decimals_(reading.raw.lat) <= 3 || decimals_(reading.raw.lng) <= 3) out.flags.push('LOW_PRECISION');

  if (reading.accuracy > cfg.gpsMaxAccuracy) {
    return Object.assign(out, {
      ok: false, code: 'ACCURACY_LOW',
      message: 'Akurasi GPS belum mencukupi (±' + Math.round(reading.accuracy) + ' m, maksimal ' + cfg.gpsMaxAccuracy + ' m). Silakan coba kembali di area terbuka.',
    });
  }
  if (best.d > radius) {
    return Object.assign(out, {
      ok: false, code: 'OUTSIDE_RADIUS',
      message: 'Anda berada di luar area kantor (' + fmtDistance_(best.d) + ' dari ' + best.l.nama + ', radius ' + radius + ' m).',
    });
  }
  return Object.assign(out, { ok: true, code: 'OK', message: 'Lokasi berhasil diverifikasi.' });
}

function decimals_(s) {
  const str = String(s);
  const i = str.indexOf('.');
  return i < 0 ? 0 : str.length - i - 1;
}

/** Penanda perpindahan tidak wajar antara dua transaksi berurutan. */
function travelFlag_(prev, cur) {
  if (!prev || prev.lat === null || prev.lng === null || !prev.atMs) return null;
  const dist = haversineMeters_(prev.lat, prev.lng, cur.lat, cur.lng);
  const hours = Math.max((cur.atMs - prev.atMs) / 3600e3, 1 / 60);
  if (dist > 2000 && dist / 1000 / hours > LIMITS_.MAX_TRAVEL_KMH) return 'IMPOSSIBLE_TRAVEL';
  return null;
}
