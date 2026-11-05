'use strict';
/**
 * Uji end-to-end di Google Chrome (headless) melalui puppeteer-core.
 * Backend = mock GAS (dev/gas-mock.js) lewat server pratinjau (dev/server.js).
 * Kamera = kamera palsu Chrome (--use-fake-device-for-media-stream).
 * GPS = emulasi geolokasi Chrome (setGeolocation / CDP).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { startServer } = require('../dev/server');
const { bootstrap, wib, offset } = require('./helpers');

let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (e) { /* belum di-install */ }
const CHROME = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean).find(p => fs.existsSync(p));
const SKIP = !puppeteer || !CHROME ? 'puppeteer-core atau Chrome tidak tersedia' : false;
const SHOTS = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const DAY = '2026-10-26';
const MOBILE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { width: 1440, height: 900 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function setup(o = {}) {
  const base = o.base || wib(DAY, '07:50');
  const real0 = Date.now();
  let skew = 0;
  const ctx = bootstrap({ now: base });
  const srv = await startServer({ env: ctx.env, now: () => base + skew + (Date.now() - real0), latencyMs: o.latencyMs || 40 });
  const url = 'http://127.0.0.1:' + srv.port + '/';
  const args = ['--use-fake-device-for-media-stream', '--no-first-run', '--no-default-browser-check'];
  if (o.fakeUi !== false) args.push('--use-fake-ui-for-media-stream');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args });
  await browser.defaultBrowserContext().overridePermissions(url.slice(0, -1), o.perms || ['geolocation', 'camera']);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport(o.viewport || MOBILE);
  // Mencatat semua stream kamera agar bisa dicek sudah dihentikan.
  await page.evaluateOnNewDocument(() => {
    window.__streams = [];
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = c => orig(c).then(s => { window.__streams.push(s); return s; });
    }
  });
  if (o.deviceClockShiftMs) {
    await page.evaluateOnNewDocument(shift => {
      const RD = Date;
      class ShiftedDate extends RD {
        constructor(...a) { if (a.length) super(...a); else super(RD.now() + shift); }
        static now() { return RD.now() + shift; }
      }
      window.Date = ShiftedDate;
    }, o.deviceClockShiftMs);
  }
  const geo = o.geo === undefined ? Object.assign(offset(20, 15), { accuracy: 12 }) : o.geo;
  if (geo) await page.setGeolocation({ latitude: geo.lat, longitude: geo.lng, accuracy: geo.accuracy });
  return Object.assign(ctx, {
    srv, url, browser, page, errors,
    setSkew: ms => { skew = ms; },
    close: async () => { await browser.close(); srv.server.close(); },
  });
}

async function login(t, username, password) {
  await t.page.goto(t.url, { waitUntil: 'domcontentloaded' });
  await t.page.waitForSelector('#login-form');
  await t.page.waitForFunction(() => document.activeElement && document.activeElement.name === 'username');
  await t.page.type('[name=username]', username);
  await t.page.type('[name=password]', password);
  await t.page.click('#login-form button[type=submit]');
  await t.page.waitForSelector('.shell', { timeout: 15000 });
}

async function openAbsensi(t) {
  await t.page.goto(t.url + '#/absensi', { waitUntil: 'domcontentloaded' });
  await t.page.waitForSelector('#att-reqs .req', { timeout: 15000 });
}

async function waitReq(page, key, state, timeout) {
  try {
    await page.waitForFunction((k, s) => {
      const el = document.querySelector('[data-req="' + k + '"]');
      return el && el.classList.contains('is-' + s);
    }, { timeout: timeout || 20000 }, key, state);
  } catch (e) {
    const now = await page.$$eval('#att-reqs .req', els => els.map(x => x.dataset.req + '=' + x.className.split(' ')[1] + ' (' + x.innerText.replace(/\s+/g, ' ') + ')').join('; ')).catch(() => '-');
    const work = await page.evaluate(() => JSON.stringify(typeof Att !== 'undefined' ? { work: Att.work, cam: Att.cam && Att.cam.status, mode: Att.mode, ok: Att.state && Att.state.ok, code: Att.state && Att.state.code, photos: Object.keys(Att.photos || {}).filter(k => Att.photos[k]), target: Att.target, err: Att.cam && Att.cam.error } : null)).catch(() => '-');
    throw new Error('syarat "' + key + '" tidak menjadi ' + state + '. Kondisi: ' + now + ' | Att.work=' + work);
  }
}

const reqText = (page, key) => page.$eval('[data-req="' + key + '"] .req-text', el => el.textContent);

async function takePhoto(page) {
  await waitReq(page, 'camera', 'ok');
  await page.waitForFunction(() => { const v = document.getElementById('att-video'); return v && v.videoWidth > 0; }, { timeout: 15000 });
  await sleep(300);
  await page.$eval('[data-cam="shoot"]', el => el.scrollIntoView({ block: 'center' }));
  await page.click('[data-cam="shoot"]');
  await waitReq(page, 'photo', 'ok');
}

/** Check-out: setelah selfie, aplikasi pindah otomatis ke foto hasil kerja. */
async function takeWorkPhoto(page) {
  await page.waitForFunction(() => {
    const tab = document.querySelector('[data-shot="work"]');
    const v = document.getElementById('att-video');
    return tab && tab.classList.contains('is-active') && v && v.videoWidth > 0 && !v.classList.contains('hidden');
  }, { timeout: 15000 });
  await sleep(300);
  await page.$eval('[data-cam="shoot"]', el => el.scrollIntoView({ block: 'center' }));
  await page.click('[data-cam="shoot"]');
  await waitReq(page, 'workPhoto', 'ok');
}

async function fillWorkReport(page, note, pickFirst) {
  if (pickFirst) { await page.$eval('.rate-option input', el => el.scrollIntoView({ block: 'center' })); await page.click('.rate-option input'); }
  await page.type('#att-work-note', note);
  await waitReq(page, 'workReport', 'ok');
}

async function submitAttendance(page, expectText) {
  await page.waitForFunction(() => !document.getElementById('att-submit').disabled, { timeout: 15000 });
  await page.click('#att-submit');
  await page.waitForSelector('[data-confirm]', { timeout: 15000 });
  await page.click('[data-confirm]');
  try {
    await page.waitForFunction(t => document.body.innerText.indexOf(t) >= 0, { timeout: 20000 }, expectText);
  } catch (e) {
    const err = await page.$eval('.overlay [data-err]', el => el.innerText).catch(() => '(tidak ada dialog)');
    throw new Error('teks "' + expectText + '" tidak muncul. Pesan dialog: ' + err);
  }
}

/** Foto uji yang berbeda-beda (seolah hasil kamera HP), ditulis ke folder sementara. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'absen-foto-'));
async function makePhotoFile(page, name, seed) {
  const b64 = await page.evaluate(s => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 1600;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 1200, 1600);
    g.addColorStop(0, 'hsl(' + (s * 47 % 360) + ',55%,60%)');
    g.addColorStop(1, 'hsl(' + (s * 97 % 360) + ',45%,35%)');
    x.fillStyle = g; x.fillRect(0, 0, 1200, 1600);
    for (let i = 0; i < 40; i++) {
      x.fillStyle = 'hsla(' + ((s * 31 + i * 23) % 360) + ',70%,' + (30 + i % 5 * 10) + '%,0.7)';
      x.beginPath(); x.arc((i * 137 + s * 53) % 1200, (i * 211 + s * 71) % 1600, 40 + (i * 13) % 120, 0, 7); x.fill();
    }
    x.fillStyle = '#fff'; x.font = '700 90px sans-serif'; x.fillText('FOTO ' + s, 120, 800);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, seed);
  const file = path.join(TMP, name + '.jpg');
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  return { file, hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
}

/** Mode kamera HP: klik "Buka kamera" → pemilih file → pilih foto. */
async function shootWithPhoneCamera(page, scope, photo, reqKey) {
  await scope.waitForSelector('[data-cam="file"]', { visible: true, timeout: 15000 });
  // Tombol bisa tertutup bilah kirim yang sticky di layar ponsel.
  await scope.$eval('[data-cam="file"]', el => el.scrollIntoView({ block: 'center' }));
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10000 }), scope.click('[data-cam="file"]')]);
  await chooser.accept([photo.file]);
  await waitReq(scope, reqKey, 'ok');
}

function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

test('E01 (S01, S13, S16) check-in di ponsel: kamera langsung, GPS valid, bukti tampil, foto JPEG asli tersimpan', { skip: SKIP }, async () => {
  const t = await setup();
  try {
    await login(t, 'budi', 'Rahasiabudi2026');
    await openAbsensi(t);
    await waitReq(t.page, 'location', 'ok');
    await waitReq(t.page, 'clock', 'ok');
    assert.match(await reqText(t.page, 'location'), /25 m dari Kantor Pusat/);
    assert.equal(await t.page.$eval('#att-submit', b => b.disabled), true, 'tombol nonaktif sebelum foto');
    assert.equal(await t.page.$('[data-cam="file"]'), null, 'kamera langsung tersedia: tidak ada tombol kamera HP');
    await t.page.screenshot({ path: path.join(SHOTS, 'mobile-absensi-kamera.png') });
    await takePhoto(t.page);
    const box = await t.page.$eval('#att-submit', b => { const r = b.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
    assert.ok(box.bottom <= MOBILE.height && box.top >= 0, 'tombol absensi terlihat di layar ponsel (sticky)');
    const tracks = await t.page.evaluate(() => window.__streams.map(s => s.getTracks().map(tr => tr.readyState)).flat());
    assert.ok(tracks.length && tracks.every(s => s === 'ended'), 'kamera dihentikan setelah foto diambil');
    await t.page.screenshot({ path: path.join(SHOTS, 'mobile-absensi-siap.png'), fullPage: true });
    await submitAttendance(t.page, 'Check-in berhasil');
    await t.page.screenshot({ path: path.join(SHOTS, 'mobile-bukti-checkin.png') });
    const rows = t.env.table('Attendance');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'Hadir');
    const file = t.env.state.files.get(rows[0].checkInPhotoId);
    assert.ok(file, 'foto ada di Drive');
    assert.equal(file.getSharingAccess(), 'PRIVATE');
    assert.deepEqual(jpegSize(file.blob.bytes), { width: 720, height: 960 }, 'JPEG 720×960 hasil kanvas kamera');
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('E02 (S17, S02) reload tidak menghilangkan data, lalu check-out berhasil', { skip: SKIP }, async () => {
  const t = await setup();
  try {
    await login(t, 'budi', 'Rahasiabudi2026');
    await openAbsensi(t);
    await waitReq(t.page, 'location', 'ok');
    await takePhoto(t.page);
    await submitAttendance(t.page, 'Check-in berhasil');
    await t.page.reload({ waitUntil: 'domcontentloaded' });
    await t.page.waitForSelector('#att-reqs .req', { timeout: 15000 });
    await t.page.waitForFunction(() => /07:5\d/.test(document.getElementById('att-in').textContent), { timeout: 10000 });
    assert.match(await t.page.$eval('#att-submit', b => b.textContent), /Check-out/);
    t.setSkew(wib(DAY, '17:05') - wib(DAY, '07:50'));
    await t.page.reload({ waitUntil: 'domcontentloaded' });
    await t.page.waitForSelector('#att-reqs .req', { timeout: 15000 });
    await waitReq(t.page, 'rules', 'ok');
    await waitReq(t.page, 'location', 'ok');
    await takePhoto(t.page);
    assert.equal(await t.page.$eval('#att-submit', b => b.disabled), true, 'check-out terkunci sebelum laporan jobdesk');
    await takeWorkPhoto(t.page);
    await fillWorkReport(t.page, 'Merapikan stok dan packing 20 pesanan');
    await submitAttendance(t.page, 'Check-out berhasil');
    const row = t.env.table('Attendance')[0];
    assert.ok(row.checkOutAt.startsWith('2026-10-26T10:05'), 'check-out pukul 17:05 WIB, tercatat ' + row.checkOutAt);
    assert.equal(row.checkOutStatus, 'Normal');
    const rep = t.env.table('WorkReports')[0];
    assert.equal(rep.keterangan, 'Merapikan stok dan packing 20 pesanan');
    assert.deepEqual(jpegSize(t.env.state.files.get(rep.photoId).blob.bytes), { width: 720, height: 960 }, 'foto hasil kerja asli dari kamera');
    await t.page.waitForFunction(() => /selesai/i.test(document.getElementById('att-rule').textContent), { timeout: 10000 });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('E03 (S03) di luar radius: lokasi ditolak & tombol tetap nonaktif', { skip: SKIP }, async () => {
  const t = await setup({ geo: Object.assign(offset(0, 350), { accuracy: 10 }) });
  try {
    await login(t, 'budi', 'Rahasiabudi2026');
    await openAbsensi(t);
    await waitReq(t.page, 'location', 'fail');
    assert.match(await reqText(t.page, 'location'), /luar area kantor/);
    await takePhoto(t.page);
    assert.equal(await t.page.$eval('#att-submit', b => b.disabled), true);
    await t.page.screenshot({ path: path.join(SHOTS, 'mobile-luar-radius.png'), fullPage: true });
    assert.equal(t.env.table('Attendance').length, 0);
  } finally { await t.close(); }
});

test('E04 (S04) izin kamera ditolak & lampiran dinonaktifkan Admin: pesan jelas, tidak ada unggah file, tombol nonaktif', { skip: SKIP }, async () => {
  const t = await setup({ fakeUi: false, perms: ['geolocation'] });
  t.env.state.props.set('CFG_ALLOW_PHOTO_UPLOAD', 'false');
  try {
    await login(t, 'budi', 'Rahasiabudi2026');
    await openAbsensi(t);
    await waitReq(t.page, 'camera', 'fail');
    const txt = await t.page.$eval('#att-camstate', el => el.innerText);
    assert.match(txt, /Izin kamera ditolak/);
    assert.equal(await t.page.$('[data-cam="file"]'), null);
    assert.equal(await t.page.$eval('#att-submit', b => b.disabled), true);
    await t.page.screenshot({ path: path.join(SHOTS, 'mobile-kamera-ditolak.png') });
  } finally { await t.close(); }
});

test('E05 (S05) izin lokasi ditolak: pesan "Izin lokasi diperlukan"', { skip: SKIP }, async () => {
  const t = await setup({ perms: ['camera'], geo: null });
  try {
    await login(t, 'budi', 'Rahasiabudi2026');
    await openAbsensi(t);
    await waitReq(t.page, 'location', 'fail');
    assert.match(await reqText(t.page, 'location'), /Izin lokasi diperlukan untuk melakukan absensi/);
    assert.equal(await t.page.$eval('#att-submit', b => b.disabled), true);
  } finally { await t.close(); }
});

test('E06 (S06) GPS tidak tersedia: pesan "Lokasi tidak tersedia"', { skip: SKIP }, async () => {
  const t = await setup({ geo: null });
  try {
    const cdp = await t.page.createCDPSession();
    await cdp.send('Emulation.setGeolocationOverride', {}); // emulasi posisi tidak tersedia
    await login(t, 'budi', 'Rahasiabudi2026');
    await openAbsensi(t);
    await waitReq(t.page, 'location', 'fail');
    assert.match(await reqText(t.page, 'location'), /Lokasi tidak tersedia/);
  } finally { await t.close(); }
});

test('E07 (S07) akurasi GPS tidak mencukupi: dicoba ulang lalu ditolak server', { skip: SKIP }, async () => {
  const t = await setup({ geo: Object.assign(offset(10, 10), { accuracy: 150 }) });
  try {
    await login(t, 'budi', 'Rahasiabudi2026');
    await openAbsensi(t);
    await waitReq(t.page, 'location', 'fail', 30000);
    assert.match(await reqText(t.page, 'location'), /Akurasi GPS belum mencukupi.*area terbuka/);
    assert.equal(await t.page.$eval('#att-submit', b => b.disabled), true);
  } finally { await t.close(); }
});

test('E08 (S08) jam perangkat dimajukan 5 jam: layar & data tetap memakai jam server', { skip: SKIP }, async () => {
  const t = await setup({ deviceClockShiftMs: 5 * 3600e3 });
  try {
    await login(t, 'budi', 'Rahasiabudi2026');
    const deviceNow = await t.page.evaluate(() => new Date().getTime()); // diukur di halaman aplikasi
    await openAbsensi(t);
    await waitReq(t.page, 'clock', 'ok');
    await t.page.waitForFunction(() => /^07:5\d:\d\d/.test(document.getElementById('att-time').textContent), { timeout: 10000 });
    assert.ok(deviceNow - Date.now() > 4.9 * 3600e3, 'jam perangkat memang dimajukan ±5 jam dari jam asli');
    await waitReq(t.page, 'location', 'ok');
    await takePhoto(t.page);
    await submitAttendance(t.page, 'Check-in berhasil');
    const row = t.env.table('Attendance')[0];
    assert.match(row.checkInLocal, /^2026-10-26 07:5\d/);
    assert.equal(row.status, 'Hadir');
  } finally { await t.close(); }
});

test('E09 kamera dihentikan saat pengguna meninggalkan halaman absensi', { skip: SKIP }, async () => {
  const t = await setup();
  try {
    await login(t, 'budi', 'Rahasiabudi2026');
    await openAbsensi(t);
    await waitReq(t.page, 'camera', 'ok');
    const live = await t.page.evaluate(() => window.__streams.some(s => s.getTracks().some(tr => tr.readyState === 'live')));
    assert.equal(live, true);
    await t.page.click('.bottom-nav [data-nav="dashboard"]');
    await t.page.waitForFunction(() => location.hash === '#/dashboard');
    await sleep(300);
    const states = await t.page.evaluate(() => window.__streams.map(s => s.getTracks().map(tr => tr.readyState)).flat());
    assert.ok(states.every(s => s === 'ended'), 'semua track kamera berhenti: ' + states.join(','));
  } finally { await t.close(); }
});

test('E10 seluruh halaman Admin dapat dibuka tanpa error JavaScript (desktop)', { skip: SKIP }, async () => {
  const t = await setup({ viewport: DESKTOP });
  try {
    // data contoh agar halaman tidak kosong
    const { attend } = require('./helpers');
    attend(t.env, t.tokens.budi, 'checkin', Object.assign(offset(15, 10), { accuracy: 9 }));
    t.env.api('jobs.save', { employeeId: t.ids.budi, judul: 'Maintenance server dan network', deadline: '2026-10-28', prioritas: 'Tinggi', status: 'In Progress' }, t.tokens.admin);
    t.env.api('leave.submit', { jenis: 'Cuti', tanggalMulai: '2026-10-29', tanggalSelesai: '2026-10-30', alasan: 'Acara keluarga' }, t.tokens.siti);
    await login(t, 'admin', 'AdminBaru2026');
    const routes = ['dashboard', 'karyawan', 'absensi/tim', 'jobdesk', 'izin', 'laporan', 'laporan/riwayat', 'profil/K001',
      'pengaturan', 'pengaturan/lokasi', 'pengaturan/jadwal', 'pengaturan/pengguna', 'pengaturan/audit'];
    for (const r of routes) {
      await t.page.goto(t.url + '#/' + r, { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => !document.querySelector('#view [data-loading]') && document.querySelector('#view').children.length > 0, { timeout: 15000 });
      await sleep(400);
      const err = await t.page.$('#view .callout-danger');
      assert.equal(err, null, 'halaman ' + r + ' menampilkan error');
      if (['dashboard', 'karyawan', 'laporan', 'pengaturan/lokasi', 'jobdesk', 'izin', 'absensi/tim'].indexOf(r) >= 0) {
        await t.page.screenshot({ path: path.join(SHOTS, 'desktop-' + r.replace('/', '-') + '.png'), fullPage: true });
      }
    }
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('E11 klik menu di dalam iframe (seperti web app Apps Script) tidak membuka halaman kosong', { skip: SKIP }, async () => {
  const t = await setup({ viewport: DESKTOP });
  try {
    await t.page.goto(t.url + '__frame', { waitUntil: 'domcontentloaded' });
    const frame = await (await t.page.waitForSelector('iframe')).contentFrame();
    await frame.waitForSelector('#login-form');
    await frame.waitForFunction(() => document.activeElement && document.activeElement.name === 'username');
    await frame.type('[name=username]', 'admin');
    await frame.type('[name=password]', 'AdminBaru2026');
    await frame.click('#login-form button[type=submit]');
    await frame.waitForSelector('.shell', { timeout: 15000 });
    for (const id of ['izin', 'karyawan', 'laporan', 'pengaturan', 'dashboard']) {
      await frame.click('.sidebar [data-nav="' + id + '"]');
      await sleep(700);
      assert.ok(t.page.url().endsWith('/__frame'), 'halaman utama tidak boleh berpindah (sekarang: ' + t.page.url() + ')');
      assert.equal(await frame.evaluate(() => location.hash), '#/' + id);
      await frame.waitForFunction(() => !document.querySelector('#view [data-loading]') && document.querySelector('.page-title'), { timeout: 10000 });
    }
    await frame.click('[data-action="account"]');
    await frame.click('.dropdown [data-go="profil"]');
    await frame.waitForFunction(() => location.hash === '#/profil');
    assert.ok(t.page.url().endsWith('/__frame'));
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('E12 alur gaji: check-out dengan jobdesk & foto hasil kerja → HR setujui → rekap gaji', { skip: SKIP }, async () => {
  const t = await setup();
  try {
    const { attend } = require('./helpers');
    const rate = t.env.api('rates.save', { nama: 'Packing pesanan', deskripsi: 'Kemas & beri label pesanan hari itu', tarif: 50000 }, t.tokens.rina).data;
    t.env.api('rates.save', { nama: 'Live jualan', tarif: 75000 }, t.tokens.rina);
    attend(t.env, t.tokens.budi, 'checkin', Object.assign(offset(15, 10), { accuracy: 9 }));
    t.setSkew(wib(DAY, '17:05') - wib(DAY, '07:50'));
    await login(t, 'budi', 'Rahasiabudi2026');
    await openAbsensi(t);
    await waitReq(t.page, 'location', 'ok');
    assert.equal(await t.page.$$eval('.rate-option', r => r.length), 2, 'dua jobdesk bertarif ditawarkan');
    await takePhoto(t.page);
    await takeWorkPhoto(t.page);
    await t.page.$eval('.rate-option input[value="' + rate.rateId + '"]', el => el.scrollIntoView({ block: 'center' }));
    await t.page.click('.rate-option input[value="' + rate.rateId + '"]');
    await fillWorkReport(t.page, 'Packing 40 pesanan Shopee');
    const total = await t.page.$eval('#att-work-total', e => e.innerText);
    assert.match(total, /Rp\s?50\.000/);
    await t.page.screenshot({ path: path.join(SHOTS, 'mobile-checkout-jobdesk.png'), fullPage: true });
    await submitAttendance(t.page, 'Check-out berhasil');
    await t.page.screenshot({ path: path.join(SHOTS, 'mobile-bukti-checkout.png') });
    const rep = t.env.table('WorkReports');
    assert.equal(rep.length, 1);
    assert.equal(Number(rep[0].tarif), 50000);

    const hr = await t.browser.newPage();
    hr.on('pageerror', e => t.errors.push(e.message));
    await hr.setViewport(DESKTOP);
    const t2 = Object.assign({}, t, { page: hr });
    await login(t2, 'rina', 'Rahasiarina2026');
    await hr.goto(t.url + '#/gaji/verifikasi', { waitUntil: 'domcontentloaded' });
    await hr.waitForSelector('[data-ok]', { timeout: 15000 });
    await hr.screenshot({ path: path.join(SHOTS, 'desktop-gaji-verifikasi.png'), fullPage: true });
    await hr.click('[data-ok]');
    await hr.waitForFunction(() => /disetujui/i.test(document.body.innerText), { timeout: 10000 });
    await sleep(600);
    assert.equal(t.env.table('WorkReports')[0].status, 'Disetujui');
    await hr.goto(t.url + '#/gaji/rekap', { waitUntil: 'domcontentloaded' });
    await hr.waitForFunction(() => /Rp\s?50\.000/.test(document.querySelector('#pay-body') ? document.querySelector('#pay-body').innerText : ''), { timeout: 15000 });
    await hr.screenshot({ path: path.join(SHOTS, 'desktop-gaji-rekap.png'), fullPage: true });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});


test('E13 izin kamera ditolak tapi lampiran diizinkan: beralih ke kamera HP, absen tetap terkunci GPS & jam server', { skip: SKIP }, async () => {
  const t = await setup({ fakeUi: false, perms: ['geolocation'] });
  try {
    await login(t, 'budi', 'Rahasiabudi2026');
    await openAbsensi(t);
    await waitReq(t.page, 'location', 'ok');
    await waitReq(t.page, 'camera', 'ok');
    assert.match(await reqText(t.page, 'camera'), /kamera HP/);
    assert.match(await t.page.$eval('#att-lock', el => el.innerText), /Lokasi terkunci: Kantor Pusat/);
    assert.equal(await t.page.$eval('#att-submit', b => b.disabled), true, 'tombol nonaktif sebelum foto');
    const photo = await makePhotoFile(t.page, 'e13-selfie', 13);
    await shootWithPhoneCamera(t.page, t.page, photo, 'photo');
    await submitAttendance(t.page, 'Check-in berhasil');
    const row = t.env.table('Attendance')[0];
    assert.equal(row.status, 'Hadir');
    assert.equal(row.checkInPhotoHash, photo.hash, 'hash file asli disimpan untuk cegah pakai ulang');
    assert.ok(row.flags.split(',').includes('IN:LAMPIRAN'), row.flags);
    assert.deepEqual(jpegSize(t.env.state.files.get(row.checkInPhotoId).blob.bytes), { width: 720, height: 960 });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('E14 di iframe seperti Google Apps Script (tanpa izin kamera): check-in & check-out dengan foto kamera HP + jobdesk', { skip: SKIP }, async () => {
  const t = await setup();
  try {
    const rate = t.env.api('rates.save', { nama: 'Packing pesanan', tarif: 50000 }, t.tokens.rina).data;
    await t.page.goto(t.url + '__frame', { waitUntil: 'domcontentloaded' });
    const frame = await (await t.page.waitForSelector('iframe')).contentFrame();
    await frame.waitForSelector('#login-form');
    await frame.waitForFunction(() => document.activeElement && document.activeElement.name === 'username');
    await frame.type('[name=username]', 'budi');
    await frame.type('[name=password]', 'Rahasiabudi2026');
    await frame.click('#login-form button[type=submit]');
    await frame.waitForSelector('.shell', { timeout: 15000 });
    assert.equal(await frame.evaluate(() => document.featurePolicy ? document.featurePolicy.allowsFeature('camera') : null), false, 'izin kamera diblokir seperti di Google');
    await frame.evaluate(() => { location.hash = '#/absensi'; });
    await frame.waitForSelector('#att-reqs .req', { timeout: 15000 });
    await waitReq(frame, 'location', 'ok');
    await waitReq(frame, 'camera', 'ok');
    assert.equal(await frame.evaluate(() => window.__streams.length), 0, 'tidak mencoba kamera langsung');
    await t.page.screenshot({ path: path.join(SHOTS, 'mobile-gas-kamera-hp.png') });
    const selfieIn = await makePhotoFile(frame, 'e14-in', 21);
    await shootWithPhoneCamera(t.page, frame, selfieIn, 'photo');
    await t.page.screenshot({ path: path.join(SHOTS, 'mobile-gas-foto-siap.png') });
    await submitAttendance(frame, 'Check-in berhasil');
    await t.page.screenshot({ path: path.join(SHOTS, 'mobile-gas-bukti-checkin.png') });

    t.setSkew(wib(DAY, '17:05') - wib(DAY, '07:50'));
    await frame.evaluate(() => location.reload());
    await frame.waitForSelector('.shell', { timeout: 15000 });
    await frame.evaluate(() => { location.hash = '#/absensi'; });
    await frame.waitForSelector('#att-reqs .req', { timeout: 15000 });
    await waitReq(frame, 'rules', 'ok');
    await waitReq(frame, 'location', 'ok');
    const selfieOut = await makePhotoFile(frame, 'e14-out', 34);
    const workPhoto = await makePhotoFile(frame, 'e14-kerja', 55);
    // Foto check-in pagi tidak bisa dipakai lagi.
    await shootWithPhoneCamera(t.page, frame, selfieOut, 'photo');
    await frame.waitForFunction(() => document.querySelector('[data-shot="work"]').classList.contains('is-active'), { timeout: 10000 });
    assert.equal(await frame.$eval('#att-submit', b => b.disabled), true, 'check-out terkunci tanpa foto hasil kerja');
    await shootWithPhoneCamera(t.page, frame, workPhoto, 'workPhoto');
    assert.equal(await frame.$eval('#att-submit', b => b.disabled), true, 'check-out terkunci tanpa jobdesk');
    await frame.$eval('.rate-option input[value="' + rate.rateId + '"]', el => el.scrollIntoView({ block: 'center' }));
    await frame.click('.rate-option input[value="' + rate.rateId + '"]');
    await frame.type('#att-work-note', 'Packing 30 pesanan marketplace');
    await waitReq(frame, 'workReport', 'ok');
    await t.page.screenshot({ path: path.join(SHOTS, 'mobile-gas-checkout-jobdesk.png'), fullPage: true });
    await submitAttendance(frame, 'Check-out berhasil');
    await t.page.screenshot({ path: path.join(SHOTS, 'mobile-gas-bukti-checkout.png') });

    const row = t.env.table('Attendance')[0];
    assert.equal(row.checkInPhotoHash, selfieIn.hash);
    assert.equal(row.checkOutPhotoHash, selfieOut.hash);
    assert.ok(row.flags.split(',').includes('IN:LAMPIRAN') && row.flags.split(',').includes('OUT:LAMPIRAN'), row.flags);
    const rep = t.env.table('WorkReports');
    assert.equal(rep.length, 1);
    assert.equal(Number(rep[0].tarif), 50000);
    assert.equal(rep[0].photoHash, workPhoto.hash);
    assert.equal(rep[0].flags, 'LAMPIRAN');
    const stored = Buffer.from(t.env.state.files.get(rep[0].photoId).blob.bytes);
    assert.deepEqual(jpegSize(stored), { width: 720, height: 960 });
    fs.writeFileSync(path.join(SHOTS, 'foto-kerja-tercap.jpg'), stored);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('E15 bonus host: tulis 100 paket (target 40) + screenshot di ponsel → HR setujui → bonus masuk rekap gaji', { skip: SKIP }, async () => {
  const t = await setup({ base: wib(DAY, '21:00') });
  try {
    const reg = t.env.api('bonus.saveScheme', { nama: 'Paket Reguler', tarif: 500, target: 40, peserta: [t.ids.budi] }, t.tokens.rina).data;
    t.env.api('bonus.saveScheme', { nama: 'Paket Premium', tarif: 1000, target: 40, peserta: [t.ids.budi] }, t.tokens.rina);
    await login(t, 'budi', 'Rahasiabudi2026');
    await t.page.goto(t.url + '#/gaji', { waitUntil: 'domcontentloaded' });
    await t.page.waitForSelector('[data-bonus-form] .bonus-item', { timeout: 15000 });
    assert.equal(await t.page.$eval('.tabs a.is-active', a => a.getAttribute('href')), '#/gaji/bonus', 'host langsung ke tab Bonus');
    assert.equal(await t.page.$$eval('.bonus-item', x => x.length), 2);
    const item = '.bonus-item[data-scheme="' + reg.schemeId + '"]';
    await t.page.type(item + ' [data-qty]', '100');
    assert.match(await t.page.$eval(item + ' [data-calc]', el => el.innerText), /\(100 − 40\) × Rp\s?500 = Rp\s?30\.000/);
    assert.match(await t.page.$eval('[data-total]', el => el.innerText), /Rp\s?30\.000/);
    // Tanpa screenshot ditolak di browser.
    await t.page.click('[data-send]');
    await t.page.waitForFunction(() => /screenshot penjualan/.test(document.querySelector('[data-bonus-form] [data-err]').innerText));
    const shot = await makePhotoFile(t.page, 'e15-screenshot', 77);
    await t.page.$eval('[data-pick-shot]', el => el.scrollIntoView({ block: 'center' }));
    const [chooser] = await Promise.all([t.page.waitForFileChooser({ timeout: 10000 }), t.page.click('[data-pick-shot]')]);
    await chooser.accept([shot.file]);
    await t.page.waitForSelector('.shot-thumb', { timeout: 10000 });
    await t.page.type('[name=keterangan]', 'Live TikTok 19.00–23.00');
    await t.page.screenshot({ path: path.join(SHOTS, 'mobile-bonus-lapor.png'), fullPage: true });
    await t.page.click('[data-send]');
    await t.page.waitForFunction(() => /Sudah dilaporkan/.test(document.querySelector('[data-bonus-form]').innerText), { timeout: 15000 });
    const rows = t.env.table('BonusReports');
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].jumlah), 100);
    assert.equal(Number(rows[0].paketBonus), 60);
    assert.equal(Number(rows[0].nominal), 30000);
    assert.equal(rows[0].photoHash, shot.hash, 'hash file asli screenshot');
    assert.equal(rows[0].keterangan, 'Live TikTok 19.00–23.00');
    await t.page.waitForFunction(() => /Paket Reguler/.test(document.querySelector('[data-history]').innerText));
    await t.page.screenshot({ path: path.join(SHOTS, 'mobile-bonus-terkirim.png'), fullPage: true });

    const hr = await t.browser.newPage();
    hr.on('pageerror', e => t.errors.push(e.message));
    await hr.setViewport(DESKTOP);
    await login(Object.assign({}, t, { page: hr }), 'rina', 'Rahasiarina2026');
    await hr.goto(t.url + '#/gaji/bonus', { waitUntil: 'domcontentloaded' });
    await hr.waitForSelector('[data-verify] [data-ok]', { timeout: 15000 });
    await hr.waitForSelector('[data-schemes] [data-edit-scheme]', { timeout: 15000 });
    await hr.click('[data-verify] [data-photo]');
    await hr.waitForSelector('.overlay .shot-slot img', { timeout: 10000 });
    await hr.screenshot({ path: path.join(SHOTS, 'desktop-bonus-screenshot.png') });
    await hr.click('.overlay [data-close]');
    await hr.screenshot({ path: path.join(SHOTS, 'desktop-bonus-verifikasi.png'), fullPage: true });
    await hr.click('[data-verify] [data-ok]');
    await hr.waitForFunction(() => /disetujui/i.test(document.body.innerText), { timeout: 10000 });
    await sleep(600);
    assert.equal(t.env.table('BonusReports')[0].status, 'Disetujui');
    assert.equal(t.env.table('BonusReports')[0].diverifikasiOleh, 'rina');
    await hr.goto(t.url + '#/gaji/rekap', { waitUntil: 'domcontentloaded' });
    await hr.waitForFunction(() => { const b = document.querySelector('#pay-body'); return b && /Bonus penjualan\s*Rp\s?30\.000/.test(b.innerText); }, { timeout: 15000 });
    await hr.screenshot({ path: path.join(SHOTS, 'desktop-gaji-rekap-bonus.png'), fullPage: true });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('E16 kecepatan: halaman tampil dari cache saat server lambat, diperbarui di belakang, dan cache dibuang saat keluar', { skip: SKIP }, async () => {
  const t = await setup({ latencyMs: 1200, viewport: DESKTOP });
  try {
    const calls = [];
    t.page.on('request', r => { if (r.url().endsWith('/__api')) { try { calls.push(JSON.parse(r.postData()).args[0]); } catch (e) { /* abaikan */ } } });
    t.env.api('jobs.save', { employeeId: t.ids.budi, judul: 'Rapikan gudang', prioritas: 'Sedang', status: 'Pending' }, t.tokens.rina);
    await login(t, 'budi', 'Rahasiabudi2026');
    await t.page.waitForFunction(() => /Rapikan|Dashboard|Beranda/.test(document.body.innerText));
    // Data halaman lain diambil sekaligus di belakang (satu panggilan).
    await t.page.waitForFunction(() => { try { return Object.keys(Cache.e).some(k => k.indexOf('jobs.list|') === 0); } catch (e) { return false; } }, { timeout: 15000 });
    assert.equal(calls.filter(c => c === 'app.prefetch').length, 1, 'satu panggilan prefetch: ' + calls.join(','));

    const timed = async (hash, ready) => {
      const before = calls.length;
      const t0 = Date.now();
      await t.page.evaluate(h => { location.hash = h; }, hash);
      await t.page.waitForFunction(ready, { timeout: 15000 });
      return { ms: Date.now() - t0, calls: calls.slice(before) };
    };
    const job = await timed('#/jobdesk', () => /Rapikan gudang/.test(document.querySelector('#view').innerText));
    assert.ok(job.ms < 600, 'Jobdesk tampil ' + job.ms + ' ms padahal server 1.200 ms');
    const izin = await timed('#/izin', () => !document.querySelector('#view [data-loading]') && /Pengajuan|izin/i.test(document.querySelector('#view').innerText));
    assert.ok(izin.ms < 600, 'Izin tampil ' + izin.ms + ' ms');
    const gaji = await timed('#/gaji', () => !document.querySelector('#pay-body [data-loading]') && document.querySelector('#pay-body .summary-line'));
    assert.ok(gaji.ms < 600, 'Gaji saya tampil ' + gaji.ms + ' ms');

    // Data berubah di server → halaman lama tampil dulu, lalu diperbarui sendiri tanpa memuat ulang.
    t.env.api('jobs.save', { employeeId: t.ids.budi, judul: 'Stok opname bulanan', prioritas: 'Tinggi', status: 'Pending' }, t.tokens.rina);
    await t.page.evaluate(() => { Cache.FRESH_MS = 0; });
    const upd = await timed('#/jobdesk', () => /Rapikan gudang/.test(document.querySelector('#view').innerText));
    assert.ok(upd.ms < 600, 'cache tampil dulu: ' + upd.ms + ' ms');
    await t.page.waitForSelector('#sync-ind[data-state="busy"]', { timeout: 3000 });
    await t.page.waitForFunction(() => /Stok opname bulanan/.test(document.querySelector('#view').innerText), { timeout: 8000 });
    await t.page.waitForFunction(() => document.querySelector('#sync-ind').classList.contains('hidden'), { timeout: 5000 });
    await t.page.screenshot({ path: path.join(SHOTS, 'desktop-cache-jobdesk.png') });

    // Setelah mengubah data sendiri, halaman tidak memakai data lama.
    const n0 = t.env.table('LeaveRequests').length;
    t.env.api('leave.submit', { jenis: 'Izin', tanggalMulai: '2026-10-29', tanggalSelesai: '2026-10-29', alasan: 'Urusan bank' }, t.tokens.budi);
    assert.equal(t.env.table('LeaveRequests').length, n0 + 1);
    await t.page.evaluate(() => api('leave.cancel', { leaveId: 'x' }).catch(() => null)); // aksi tulis (gagal pun) tidak memakai cache
    await t.page.evaluate(() => { Cache.FRESH_MS = 30000; });
    await t.page.evaluate(() => api('leave.submit', { jenis: 'Sakit', tanggalMulai: '2026-10-30', tanggalSelesai: '2026-10-30', alasan: 'Demam tinggi' }));
    const leave = await timed('#/izin', () => /Demam tinggi/.test(document.querySelector('#view').innerText));
    assert.ok(leave.calls.indexOf('leave.list') >= 0, 'daftar izin diambil ulang setelah pengajuan baru');

    // Buka ulang aplikasi: tampilan muncul dari cache sebelum server menjawab.
    const t0 = Date.now();
    await t.page.reload({ waitUntil: 'domcontentloaded' });
    await t.page.waitForSelector('.shell', { timeout: 15000 });
    const shellMs = Date.now() - t0;
    await t.page.waitForFunction(() => /Demam tinggi/.test(document.querySelector('#view').innerText), { timeout: 15000 });
    assert.ok(shellMs < 1100, 'aplikasi terbuka ' + shellMs + ' ms dari cache (boot server 1.200 ms)');
    console.log('E16 waktu (server tiruan 1.200 ms/panggilan): jobdesk ' + job.ms + ' ms, izin ' + izin.ms + ' ms, gaji ' + gaji.ms + ' ms, buka ulang aplikasi ' + shellMs + ' ms');

    // Keluar: cache dihapus dari browser.
    await t.page.click('[data-action="logout"]');
    await t.page.waitForSelector('.overlay [data-ok]');
    await t.page.click('.overlay [data-ok]');
    await t.page.waitForSelector('#login-form', { timeout: 15000 });
    const left = await t.page.evaluate(() => [localStorage.getItem('sdm_cache'), sessionStorage.getItem('sdm_cache'), Object.keys(Cache.e).length]);
    assert.deepEqual(left, [null, null, 0]);
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('E17 jam bebas & hapus karyawan: check-in pukul 13.00 diterima, karyawan yang berhenti hilang dari daftar', { skip: SKIP }, async () => {
  const t = await setup({ base: wib(DAY, '13:00') });
  try {
    await login(t, 'budi', 'Rahasiabudi2026');
    await openAbsensi(t);
    assert.match(await t.page.$eval('#att-sched', el => el.innerText), /Jam bebas/);
    await waitReq(t.page, 'rules', 'ok');
    await waitReq(t.page, 'location', 'ok');
    await takePhoto(t.page);
    await submitAttendance(t.page, 'Check-in berhasil');
    assert.equal(t.env.table('Attendance')[0].status, 'Hadir');

    const hr = await t.browser.newPage();
    hr.on('pageerror', e => t.errors.push(e.message));
    await hr.setViewport(DESKTOP);
    await login(Object.assign({}, t, { page: hr }), 'rina', 'Rahasiarina2026');
    await hr.goto(t.url + '#/pengaturan', { waitUntil: 'domcontentloaded' }).catch(() => null);
    await hr.goto(t.url + '#/karyawan', { waitUntil: 'domcontentloaded' });
    await hr.waitForSelector('[data-del="' + t.ids.siti + '"]', { timeout: 15000 });
    assert.equal(await hr.$$eval('#view th', ths => ths.some(th => /Jadwal/.test(th.innerText))), false, 'kolom Jadwal sudah tidak ada');
    await hr.click('[data-del="' + t.ids.siti + '"]');
    await hr.waitForSelector('.overlay [data-ok]');
    assert.match(await hr.$eval('.overlay', el => el.innerText), /akun login|arsip/);
    await hr.click('.overlay [data-ok]');
    await hr.waitForFunction(id => !document.querySelector('[data-del="' + id + '"]'), { timeout: 15000 }, t.ids.siti);
    assert.equal(t.env.table('Employees').some(e => e.employeeId === t.ids.siti), false);
    assert.equal(t.env.table('Users').some(u => u.username === 'siti'), false);
    await hr.screenshot({ path: path.join(SHOTS, 'desktop-karyawan-hapus.png'), fullPage: true });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});

test('E18 versi Vercel: halaman statis memanggil server lewat doPost, kamera langsung aktif, check-in tersimpan', { skip: SKIP }, async () => {
  const t = await setup({ base: wib(DAY, '08:10') });
  try {
    const calls = [];
    t.page.on('request', r => { if (r.url().endsWith('/__exec')) calls.push(r.headers()['content-type'] || '(tanpa)'); });
    await t.page.goto(t.url + '__vercel', { waitUntil: 'domcontentloaded' });
    await t.page.waitForSelector('#login-form');
    await t.page.waitForFunction(() => document.activeElement && document.activeElement.name === 'username');
    await t.page.type('[name=username]', 'budi');
    await t.page.type('[name=password]', 'Rahasiabudi2026');
    await t.page.click('#login-form button[type=submit]');
    await t.page.waitForSelector('.shell', { timeout: 15000 });
    await t.page.evaluate(() => { location.hash = '#/absensi'; });
    await t.page.waitForSelector('#att-reqs .req', { timeout: 15000 });
    assert.equal(await t.page.evaluate(() => liveCameraAllowed()), true, 'di luar iframe Google kamera langsung diizinkan');
    await waitReq(t.page, 'location', 'ok');
    await takePhoto(t.page);
    await submitAttendance(t.page, 'Check-in berhasil');
    const row = t.env.table('Attendance')[0];
    assert.equal(row.status, 'Hadir');
    assert.ok(!row.flags.includes('LAMPIRAN'), 'foto dari kamera langsung, bukan lampiran');
    assert.ok(calls.length >= 3, 'semua panggilan lewat /exec (doPost)');
    assert.ok(calls.every(c => /^text\/plain/.test(c)), 'permintaan "simple" tanpa preflight CORS: ' + calls[0]);
    await t.page.screenshot({ path: path.join(SHOTS, 'mobile-vercel-absen.png') });
    assert.deepEqual(t.errors, []);
  } finally { await t.close(); }
});
