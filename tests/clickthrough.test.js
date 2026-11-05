'use strict';
/**
 * Klik satu per satu setiap elemen interaktif (antislop R-35) di Chrome headless,
 * desktop (Admin) dan ponsel (karyawan). Bukti per elemen ditulis ke
 * docs/hasil-klik.txt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer } = require('../dev/server');
const { bootstrap, wib, offset, attend } = require('./helpers');

let puppeteer = null;
try { puppeteer = require('puppeteer-core'); } catch (e) { /* belum di-install */ }
const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(p => fs.existsSync(p));
const SKIP = !puppeteer || !CHROME ? 'puppeteer-core atau Chrome tidak tersedia' : false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const evidence = [];

async function check(page, label, action, verify) {
  try {
    await action();
    await sleep(350);
    const detail = await verify();
    evidence.push('PASS  ' + label + ' -> ' + detail);
  } catch (e) {
    evidence.push('FAIL  ' + label + ' -> ' + e.message);
    throw new Error(label + ': ' + e.message);
  }
}

const visible = (page, sel) => page.$eval(sel, el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)).catch(() => false);
const dialogOpen = page => page.$('.overlay').then(Boolean);
const noOverflow = async (page, width) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  if (w > width + 1) throw new Error('overflow horizontal ' + w + 'px > ' + width + 'px');
  return w;
};

async function setup(viewport) {
  const base = wib('2026-10-26', '08:05');
  const real0 = Date.now();
  const t = bootstrap({ now: base });
  attend(t.env, t.tokens.budi, 'checkin', Object.assign(offset(15, 10), { accuracy: 9 }));
  t.env.api('jobs.save', { employeeId: t.ids.siti, judul: 'Rekap konten promosi', deadline: '2026-10-28', prioritas: 'Sedang', status: 'Pending' }, t.tokens.admin);
  t.env.api('leave.submit', { jenis: 'Cuti', tanggalMulai: '2026-10-29', tanggalSelesai: '2026-10-30', alasan: 'Acara keluarga' }, t.tokens.siti);
  const srv = await startServer({ env: t.env, now: () => base + (Date.now() - real0) });
  const url = 'http://127.0.0.1:' + srv.port + '/';
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  await browser.defaultBrowserContext().overridePermissions(url.slice(0, -1), ['geolocation', 'camera']);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument(() => {
    window.__downloads = 0;
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (b) { window.__downloads++; return orig.call(URL, b); };
  });
  const pos = offset(20, 15);
  await page.setGeolocation({ latitude: pos.lat, longitude: pos.lng, accuracy: 12 });
  return Object.assign(t, { url, browser, page, errors, close: async () => { await browser.close(); srv.server.close(); } });
}

async function login(t, u, pw) {
  await t.page.goto(t.url, { waitUntil: 'domcontentloaded' });
  await t.page.waitForSelector('#login-form');
  await (t.page || p).waitForFunction(() => document.activeElement && document.activeElement.name === 'username');
  await t.page.type('[name=username]', u);
  await t.page.type('[name=password]', pw);
  await t.page.click('#login-form button[type=submit]');
  await t.page.waitForSelector('.shell', { timeout: 15000 });
}

const ready = page => page.waitForFunction(() => !document.querySelector('#view [data-loading]') && document.querySelector('#view').children.length > 0, { timeout: 15000 });

test('C01 desktop Admin: setiap menu, dialog, filter, dan tombol bekerja', { skip: SKIP }, async () => {
  const t = await setup({ width: 1440, height: 900 });
  const p = t.page;
  try {
    await p.goto(t.url, { waitUntil: 'domcontentloaded' });
    await check(p, 'Login: tombol mata password', () => p.click('[data-toggle-pw]'),
      async () => { const type = await p.$eval('[name=password]', i => i.type); if (type !== 'text') throw new Error('tetap tersembunyi'); return 'password terlihat (type=text)'; });
    await check(p, 'Login: kirim form kosong', async () => { await p.$eval('[name=password]', i => { i.value = ''; }); await p.click('#login-form button[type=submit]'); },
      async () => { const m = await p.$eval('#login-error', e => e.textContent); if (!/wajib diisi/.test(m)) throw new Error(m); return 'validasi: "' + m + '"'; });
    await login(t, 'admin', 'AdminBaru2026');
    await check(p, 'Keyboard: Tab ke elemen pertama', () => p.keyboard.press('Tab'),
      async () => { const o = await p.evaluate(() => { const a = document.activeElement; const s = getComputedStyle(a); return a.tagName + ' outline ' + s.outlineStyle + ' ' + s.outlineWidth; }); if (/none/.test(o)) throw new Error(o); return 'fokus terlihat: ' + o; });

    for (const id of ['dashboard', 'karyawan', 'absensi', 'jobdesk', 'izin', 'gaji', 'laporan', 'profil', 'pengaturan']) {
      await check(p, 'Sidebar: ' + id, async () => { await p.click('.sidebar [data-nav="' + id + '"]'); await ready(p); },
        async () => { const h = await p.evaluate(() => location.hash + ' · ' + document.querySelector('.page-title').textContent); return h; });
    }
    await check(p, 'Topbar: lonceng notifikasi', () => p.click('[data-action="notif"]'),
      async () => { if (!await visible(p, '.dropdown')) throw new Error('dropdown tidak muncul'); return 'dropdown notifikasi terbuka: ' + (await p.$eval('.dropdown', d => d.innerText.split('\n').slice(0, 2).join(' / '))); });
    await check(p, 'Topbar: klik di luar dropdown', () => p.mouse.click(700, 500), async () => { if (await p.$('.dropdown')) throw new Error('masih terbuka'); return 'dropdown tertutup'; });
    await check(p, 'Topbar: menu akun → Ubah password', async () => { await p.click('[data-action="account"]'); await p.click('.dropdown [data-do="password"]'); },
      async () => { if (!await dialogOpen(p)) throw new Error('dialog tidak terbuka'); return 'dialog "' + (await p.$eval('.dialog-title', e => e.textContent)) + '" terbuka'; });
    await check(p, 'Dialog: tombol Escape', () => p.keyboard.press('Escape'), async () => { if (await dialogOpen(p)) throw new Error('dialog tidak tertutup'); return 'dialog tertutup'; });

    await p.goto(t.url + '#/karyawan'); await ready(p);
    await check(p, 'Karyawan: pencarian "siti"', async () => { await p.type('[data-q]', 'siti'); await sleep(300); },
      async () => { const n = await p.$$eval('#emp-card tbody tr', r => r.length); if (n !== 1) throw new Error(n + ' baris'); return '1 baris tersisa'; });
    await check(p, 'Karyawan: filter departemen IT', async () => { await p.$eval('[data-q]', i => { i.value = ''; i.dispatchEvent(new Event('input')); }); await sleep(250); await p.select('[data-f=departemen]', 'IT'); },
      async () => { const n = await p.$$eval('#emp-card tbody tr', r => r.length); if (n !== 2) throw new Error(n + ' baris'); return '2 karyawan IT'; });
    await check(p, 'Karyawan: Tambah karyawan (setelah halaman dibuka 2x)', () => p.click('[data-add]'), async () => { const n = await p.evaluate(() => document.querySelectorAll('.overlay').length); if (n !== 1) throw new Error(n + ' dialog terbuka'); return 'tepat 1 dialog terbuka'; });
    await check(p, 'Form: simpan tanpa nama', () => p.click('[data-save]'), async () => { const m = await p.$eval('.overlay [data-err]', e => e.textContent); if (!/wajib/.test(m)) throw new Error(m); return 'validasi: "' + m + '"'; });
    await check(p, 'Form: tombol Batal', () => p.click('.dialog-foot [data-close]'), async () => { if (await dialogOpen(p)) throw new Error('masih terbuka'); return 'dialog tertutup'; });
    await check(p, 'Karyawan: ikon edit', () => p.click('[data-edit]'), async () => { const v = await p.$eval('.overlay [name=nama]', i => i.value); await p.keyboard.press('Escape'); return 'form edit terisi "' + v + '"'; });
    await check(p, 'Karyawan: ikon hapus → Batal', async () => { await p.click('[data-del]'); await sleep(250); await p.click('.dialog-foot [data-close]'); },
      async () => { if (await dialogOpen(p)) throw new Error('konfirmasi masih terbuka'); return 'konfirmasi muncul lalu dibatalkan, data tetap ' + t.env.table('Employees').length + ' karyawan'; });
    await check(p, 'Karyawan: tautan nama → profil', async () => { await p.click('#emp-card tbody tr a'); await ready(p); },
      async () => p.evaluate(() => location.hash + ' · ' + document.querySelector('.page-title').textContent));
    await check(p, 'Profil: tab Jobdesk & Riwayat', async () => { await p.click('[data-tab="jobs"]'); await p.click('[data-tab="hist"]'); },
      async () => { if (!await visible(p, '[data-panel="hist"]')) throw new Error('panel riwayat tidak tampil'); return 'panel riwayat tampil'; });

    await p.goto(t.url + '#/jobdesk'); await ready(p);
    await check(p, 'Jobdesk: filter Pending', () => p.click('[data-st="Pending"]'), async () => { const n = await p.$$eval('#job-card tbody tr', r => r.length); return n + ' tugas Pending'; });
    await check(p, 'Jobdesk: ubah status', async () => { await p.select('[data-status]', 'In Progress'); await sleep(500); },
      async () => { const s = t.env.table('Jobdesk')[0].status; if (s !== 'In Progress') throw new Error(s); return 'tersimpan di sheet: ' + s; });
    await check(p, 'Jobdesk: Tambah jobdesk', () => p.click('[data-add]'), async () => { const ok = await dialogOpen(p); await p.keyboard.press('Escape'); if (!ok) throw new Error('tidak terbuka'); return 'form terbuka & ditutup'; });

    await p.goto(t.url + '#/izin'); await ready(p);
    await check(p, 'Izin: Proses pengajuan → Setujui', async () => { await p.click('[data-decide]'); await sleep(300); await p.click('[data-d="Disetujui"]'); await sleep(600); },
      async () => { const s = t.env.table('LeaveRequests')[0].status; if (s !== 'Disetujui') throw new Error(s); return 'status di sheet: ' + s; });
    await check(p, 'Izin: filter Disetujui', () => p.click('[data-st="Disetujui"]'), async () => { await sleep(500); const n = await p.$$eval('#leave-card tbody tr', r => r.length); return n + ' baris'; });

    await p.goto(t.url + '#/gaji'); await ready(p);
    for (const tab of ['verifikasi', 'bonus', 'rekap', 'tarif']) {
      await check(p, 'Gaji: tab ' + tab, async () => { await p.click('.tabs a[href="#/gaji/' + tab + '"]'); await ready(p); await p.waitForFunction(() => !document.querySelector('#pay-body [data-loading]'), { timeout: 10000 }); },
        async () => p.evaluate(() => location.hash + ' · ' + document.querySelector('#pay-body').innerText.split(/\n/).slice(0, 2).join(' / ')));
    }
    await check(p, 'Gaji tarif: Tambah jobdesk → simpan kosong', async () => { await p.click('#pay-body [data-add]'); await sleep(300); await p.click('.overlay [data-save]'); },
      async () => { const m = await p.$eval('.overlay [data-err]', e => e.textContent); await p.keyboard.press('Escape'); if (!/wajib|Tarif/.test(m)) throw new Error(m); return 'validasi: "' + m + '", dialog ditutup dengan Escape'; });
    await check(p, 'Gaji rekap: unduh CSV', async () => { await p.click('.tabs a[href="#/gaji/rekap"]'); await ready(p); await p.waitForSelector('#pay-body [data-csv]'); await sleep(600); await p.click('#pay-body [data-csv]'); },
      async () => { const n = await p.evaluate(() => window.__downloads); if (n < 1) throw new Error('tidak ada unduhan'); return 'CSV rekap gaji dibuat'; });
    await check(p, 'Gaji bonus: Tambah jenis paket → simpan kosong', async () => { await p.click('.tabs a[href="#/gaji/bonus"]'); await ready(p); await p.waitForSelector('#pay-body [data-add-scheme]'); await p.click('#pay-body [data-add-scheme]'); await sleep(300); await p.click('.overlay [data-save]'); },
      async () => { const m = await p.$eval('.overlay [data-err]', e => e.textContent); if (!/wajib/.test(m)) throw new Error(m); return 'validasi: "' + m + '"'; });
    await check(p, 'Gaji bonus: isi jenis paket + pilih peserta → simpan', async () => { await p.type('.overlay [name=nama]', 'Paket Uji Klik'); await p.type('.overlay [name=tarif]', '500'); await p.type('.overlay [name=target]', '40'); await p.click('.overlay .pick-list .rate-option input'); await p.click('.overlay [data-save]'); await p.waitForFunction(() => !document.querySelector('.overlay'), { timeout: 10000 }); },
      async () => { const r = t.env.table('BonusSchemes').find(x => x.nama === 'Paket Uji Klik'); if (!r || Number(r.tarif) !== 500 || Number(r.target) !== 40 || !r.peserta) throw new Error(JSON.stringify(r)); return 'tersimpan: Rp 500/paket, target 40, peserta ' + r.peserta; });
    await p.goto(t.url + '#/laporan'); await ready(p);
    await check(p, 'Laporan: Tampilkan rekap', async () => { await p.click('[data-load]'); await sleep(800); }, async () => { const n = await p.$$eval('#rep-body tbody tr', r => r.length); return n + ' baris rekap'; });
    await check(p, 'Laporan: unduh CSV rekap', () => p.click('[data-csv]'), async () => { const n = await p.evaluate(() => window.__downloads); if (n < 1) throw new Error('tidak ada unduhan'); return 'file CSV dibuat'; });
    await p.goto(t.url + '#/laporan/riwayat'); await ready(p); await sleep(600);
    await check(p, 'Riwayat: Detail → foto dimuat', async () => { await p.click('[data-detail]'); await p.waitForSelector('[data-photo="in"] img', { timeout: 8000 }); },
      async () => { await p.keyboard.press('Escape'); return 'dialog detail menampilkan foto check-in'; });

    await p.goto(t.url + '#/pengaturan'); await ready(p);
    for (const tab of ['umum', 'lokasi', 'pengguna', 'audit']) {
      await check(p, 'Pengaturan: tab ' + tab, async () => { await p.click('.tabs a[href="#/pengaturan/' + tab + '"]'); await ready(p); await sleep(300); },
        async () => p.evaluate(() => location.hash + ' · ' + (document.querySelector('#set-body .card-title, #set-body .form-section') || {}).textContent));
      const add = await p.$('#set-body [data-add]');
      if (add) {
        await check(p, 'Pengaturan ' + tab + ': tombol tambah', () => add.click(), async () => { const ok = await dialogOpen(p); await p.keyboard.press('Escape'); if (!ok) throw new Error('tidak terbuka'); return 'dialog terbuka & ditutup dengan Escape'; });
      }
    }
    await check(p, 'Sidebar: Keluar → Batal', async () => { await p.click('.sidebar [data-action="logout"]'); await sleep(250); await p.click('.dialog-foot [data-close]'); },
      async () => { if (!await p.$('.shell')) throw new Error('keluar tanpa konfirmasi'); return 'konfirmasi keluar dibatalkan, tetap masuk'; });
    assert.deepEqual(t.errors, []);
    evidence.push('PASS  Konsol desktop -> 0 error JavaScript');
  } finally { await t.close(); }
});

test('C02 ponsel karyawan: navigasi bawah, menu, kamera, absen, tanpa overflow', { skip: SKIP }, async () => {
  const W = 390;
  const t = await setup({ width: W, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = t.page;
  try {
    await p.goto(t.url, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#login-form');
  await (t.page || p).waitForFunction(() => document.activeElement && document.activeElement.name === 'username');
    await check(p, 'Ponsel login: lebar halaman', async () => {}, async () => (await noOverflow(p, W)) + 'px, tanpa overflow');
    await p.type('[name=username]', 'siti');
    await p.type('[name=password]', 'Rahasiasiti2026');
    await p.click('#login-form button[type=submit]');
    await p.waitForSelector('.shell', { timeout: 15000 });
    for (const id of ['dashboard', 'jobdesk', 'izin', 'absensi']) {
      await check(p, 'Navigasi bawah: ' + id, async () => { await p.click('.bottom-nav [data-nav="' + id + '"]'); await ready(p); await sleep(300); },
        async () => (await p.evaluate(() => location.hash)) + ' · lebar ' + (await noOverflow(p, W)) + 'px');
    }
    await check(p, 'Navigasi bawah: Menu', () => p.click('.bottom-nav [data-action="menu"]'),
      async () => { const open = await p.$eval('#sidebar', s => s.classList.contains('is-open')); if (!open) throw new Error('tidak terbuka'); return 'laci menu terbuka'; });
    await check(p, 'Laci menu: Profil Saya', async () => { await p.click('.sidebar [data-nav="profil"]'); await ready(p); },
      async () => { const open = await p.$eval('#sidebar', s => s.classList.contains('is-open')); if (open) throw new Error('laci tidak menutup'); return (await p.evaluate(() => location.hash)) + ' · laci tertutup · lebar ' + (await noOverflow(p, W)) + 'px'; });
    await check(p, 'Ukuran target sentuh tombol bawah', async () => {}, async () => {
      const sizes = await p.$$eval('.bottom-nav .bn-item', els => els.map(e => Math.round(e.getBoundingClientRect().height)));
      if (sizes.some(h => h < 44)) throw new Error(sizes.join(','));
      return 'tinggi ' + sizes.join('/') + ' px (≥ 44)';
    });
    await p.click('.bottom-nav [data-nav="absensi"]'); await ready(p);
    await p.waitForFunction(() => { const v = document.getElementById('att-video'); return v && v.videoWidth > 0; }, { timeout: 15000 });
    await check(p, 'Absensi: tombol Matikan kamera', () => p.click('[data-cam="stop"]'),
      async () => { const s = await p.$eval('#att-camstate', e => e.innerText.split('\n')[0]); if (!/belum aktif/i.test(s)) throw new Error(s); return 'kamera mati, tampil "' + s + '"'; });
    await check(p, 'Absensi: tombol Aktifkan kamera', async () => { await p.click('[data-cam="start"]'); await p.waitForFunction(() => document.getElementById('att-video').videoWidth > 0, { timeout: 10000 }); },
      async () => 'kamera menyala kembali');
    await check(p, 'Absensi: tombol shutter', async () => { await sleep(300); await p.click('[data-cam="shoot"]'); },
      async () => { if (!await visible(p, '#att-photo')) throw new Error('pratinjau tidak tampil'); return 'pratinjau foto tampil, kamera berhenti'; });
    await check(p, 'Absensi: Ulangi foto', async () => { await p.click('[data-cam="retake"]'); await p.waitForFunction(() => document.getElementById('att-video').videoWidth > 0, { timeout: 10000 }); },
      async () => 'kamera menyala untuk foto ulang');
    await sleep(300); await p.click('[data-cam="shoot"]');
    await p.waitForFunction(() => !document.getElementById('att-submit').disabled, { timeout: 15000 });
    await check(p, 'Absensi: Check-in → Batal', async () => { await p.click('#att-submit'); await p.waitForSelector('[data-confirm]'); await p.click('.dialog-foot [data-close]'); },
      async () => { if (await dialogOpen(p)) throw new Error('masih terbuka'); return 'konfirmasi dibatalkan, belum ada data baru (' + t.env.table('Attendance').length + ' baris)'; });
    await check(p, 'Absensi: Check-in → Konfirmasi', async () => { await p.click('#att-submit'); await p.waitForSelector('[data-confirm]'); await p.click('[data-confirm]'); await p.waitForFunction(() => /Check-in berhasil/.test(document.body.innerText), { timeout: 15000 }); },
      async () => 'bukti tampil, sheet berisi ' + t.env.table('Attendance').length + ' baris');
    await check(p, 'Bukti: tombol Selesai', () => p.click('.dialog-foot [data-close]'), async () => { if (await dialogOpen(p)) throw new Error('masih terbuka'); return 'dialog bukti tertutup · lebar ' + (await noOverflow(p, W)) + 'px'; });
    await check(p, 'Izin: Ajukan izin → Kirim', async () => {
      await p.click('.bottom-nav [data-nav="izin"]');
      await p.waitForFunction(() => location.hash === '#/izin' && document.querySelector('#view [data-add]'), { timeout: 10000 });
      await p.click('[data-add]'); await sleep(300);
      await p.type('.overlay [name=alasan]', 'Kontrol kesehatan');
      await p.click('.overlay [data-save]'); await sleep(700);
    }, async () => { const n = t.env.table('LeaveRequests').length; if (n !== 2) throw new Error(n + ' pengajuan'); return 'pengajuan tersimpan (total ' + n + ')'; });
    assert.deepEqual(t.errors, []);
    evidence.push('PASS  Konsol ponsel -> 0 error JavaScript');
  } finally { await t.close(); }
});

test.after(() => {
  const file = path.join(__dirname, '..', 'docs', 'hasil-klik.txt');
  fs.writeFileSync(file, 'Klik satu per satu (antislop R-35), Chrome headless, ' + new Date().toISOString() + '\n\n' + evidence.join('\n') + '\n');
});
