# SDM & Absensi GGSHOPS.ID

Aplikasi web manajemen SDM dan absensi karyawan berbasis **Google Apps Script**, dengan **Google Sheets** sebagai database dan **Google Drive** sebagai penyimpanan foto.

## Fitur

- **Absensi dengan foto selfie.** Memakai `getUserMedia` dan elemen `<video>` bila browser mengizinkan, dengan pilihan ganti kamera; kamera otomatis dimatikan setelah foto diambil atau saat pengguna meninggalkan halaman. Web app Apps Script ditampilkan Google di iframe yang memblokir kamera langsung, sehingga di sana aplikasi membuka kamera bawaan HP (`<input type="file" capture>`) lalu mencap nama, jam server, dan lokasi GPS terverifikasi pada foto. Foto seperti ini ditandai `LAMPIRAN` untuk HR (lihat [docs/KEAMANAN.md](docs/KEAMANAN.md), 5.6 dan 9.2).
- **Validasi GPS di server.** Jarak ke titik kantor dihitung dengan rumus Haversine. Radius dan ambang akurasi dapat diatur Admin. Transaksi yang tidak wajar diberi penanda untuk ditinjau HR.
- **Jam server terkunci.** Waktu resmi transaksi berasal dari server Apps Script. Jam di layar tidak terpengaruh perubahan jam perangkat.
- **Jam kerja bebas.** Tidak ada jadwal atau shift: karyawan check-in dan check-out kapan saja (sekali per tanggal, check-out paling lambat 04.00 keesokan hari). Check-in/check-out ganda tetap dicegah, dan izin/cuti yang disetujui tetap memblokir check-in.
- **Hapus karyawan yang berhenti.** Data karyawan dan akunnya langsung terhapus dari daftar; riwayat tetap tersimpan sebagai arsip dan nomor karyawan tidak dipakai ulang.
- **Gaji berbasis jobdesk:** saat pulang karyawan wajib memotret hasil kerja, memilih jobdesk yang dikerjakan, dan menulis keterangan. HR memverifikasi laporan; gaji = jumlah tarif laporan yang disetujui pada rentang tanggal bebas (ekspor CSV).
- **Bonus penjualan paket (host):** HR membuat jenis paket dengan bonus per paket dan target harian, lalu memilih pesertanya. Host menulis paket terjual dan melampirkan screenshot; bonus = (paket − target) × bonus per paket, dihitung server, dan masuk gaji setelah disetujui HR.
- **Modul lain:** dashboard (kehadiran hari ini, siapa yang belum hadir, statistik 7 hari, aktivitas terbaru), data karyawan, profil, jobdesk, izin/sakit/cuti/dinas luar dengan persetujuan, laporan rekap bulanan dan riwayat (ekspor CSV), serta pengaturan (perusahaan, lokasi dengan peta, jadwal, pengguna, audit log).
- **Peran pengguna:** Super Admin, HRD, dan Karyawan. Hanya Super Admin dan HRD yang dapat melihat absen, laporan jobdesk, gaji, foto, dan profil karyawan lain; Karyawan hanya melihat datanya sendiri.

## Struktur proyek

```
src/                 ← kode yang di-push ke Apps Script (rootDir clasp)
  appsscript.json    manifest (V8, web app, scope OAuth)
  Code.js            doGet, dispatcher api(), daftar route & role
  Config.js          konstanta, skema sheet, konfigurasi
  Auth.js            login, sesi, hash password, otorisasi
  Attendance.js      status, nonce kamera, check-in/check-out, riwayat
  Geo.js             Haversine, validasi lokasi, penanda kewajaran
  Schedule.js        arsip jadwal kerja lama (tidak dipakai sejak versi 11)
  Photo.js           validasi JPEG, Drive privat, akses foto, retensi
  Time.js            waktu server & zona waktu
  Db.js              akses Google Sheets (berbasis nama header)
  Employees.js · Leave.js · Jobdesk.js · Settings.js · Report.js · Audit.js · Setup.js · Util.js
  Index.html         kerangka halaman
  Styles.html        CSS
  JsCore.html        API, jam server, komponen UI, router, login
  JsAttendance.html  halaman absensi (kamera, GPS, checklist)
  JsPages.html       dashboard, karyawan, profil, jobdesk, izin, laporan
  JsSettings.html    pengaturan
dev/                 mock Google Apps Script & server pratinjau lokal (tidak di-push)
tests/               uji backend & uji E2E Chrome (tidak di-push)
docs/                dokumentasi & laporan pengujian
```

## Mulai cepat

**Pratinjau lokal** (tanpa akun Google; data demo di memori):

```bash
npm install
npm run dev          # buka http://localhost:5173, akun demo tercetak di terminal
```

**Deploy ke Google:** ikuti [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Ringkasnya:

1. `npm install`, lalu `npm run push` (membangun `build/` lalu `clasp push`).
2. Jalankan `setup()` sekali dari editor Apps Script.
3. Buat deployment *Web app*.
4. Login sebagai `admin`, lalu tambahkan Lokasi Kerja.

## Dokumentasi

| Dokumen | Isi |
|---|---|
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Instalasi, `setup()`, deploy web app, konfigurasi awal, troubleshooting |
| [docs/KEAMANAN.md](docs/KEAMANAN.md) | Model keamanan, hak akses, audit, retensi, **keterbatasan** |
| [docs/DATABASE.md](docs/DATABASE.md) | Struktur Google Sheets, Script Properties, folder Drive |
| [DESIGN.md](DESIGN.md) | Arahan desain pemilik, palet, tipografi, alasan keputusan, kontras |
| [docs/LAPORAN-PENGUJIAN.md](docs/LAPORAN-PENGUJIAN.md) | Hasil uji PASS/FAIL/BLOCKED/NOT TESTED & checklist uji manual |

## Pengujian

```bash
npm test           # 90 uji backend pada mock Apps Script (termasuk gaji, bonus, privasi, cache)
npm run test:e2e   # 19 uji E2E di Google Chrome (kamera palsu & emulasi GPS)
npm run test:build # uji E2E & klik terhadap hasil build (kode yang di-push)
npm run test:klik  # klik satu per satu setiap elemen (antislop R-35)
npm run assets     # sematkan ulang gambar dari assets/ (latar & logo)
```

## Versi Vercel (tampilan di luar Google)

Aplikasi yang sama juga dapat dibuka dari Vercel (mis. `https://ggshopsabsen.vercel.app`). Datanya tetap di Google Sheets & Drive yang sama.

- `public/index.html` adalah halaman statis hasil `npm run vercel`. Halaman ini memanggil server Apps Script lewat `fetch` ke URL `/exec` (fungsi `doPost`, POST `text/plain` tanpa preflight CORS), bukan `google.script.run`.
- Karena tidak berada di dalam iframe Google, **kamera langsung berfungsi** di versi Vercel. Di URL Apps Script, aplikasi tetap memakai kamera HP (lampiran).
- `vercel.json` menyajikan folder `public/` apa adanya (tanpa instalasi & build di Vercel) dan menambahkan header keamanan (`X-Frame-Options: DENY`, `Permissions-Policy` kamera & lokasi hanya untuk situs ini).
- Setiap kali kode berubah: `npm run push` (Apps Script) → deploy versi baru → `npm run vercel` → commit & push ke GitHub; Vercel memperbarui otomatis dari GitHub.
- URL server diambil dari `GAS_EXEC_URL` atau konstanta di `dev/build-vercel.js`.
- **Service worker** (`public/sw.js`) menyimpan halaman aplikasi di HP: situs terbuka seketika, juga saat sinyal lemah (uji E19: 59 ms tanpa jaringan). Versi terbaru diunduh di belakang; bila berbeda, muncul tombol "Versi baru · muat ulang". Hanya halaman aplikasi yang disimpan; data dan panggilan ke server Google tidak disentuh.
- Halaman menyiapkan koneksi ke `script.google.com` & `script.googleusercontent.com` sejak dibuka (`preconnect`). Satu panggilan ke server tetap sekitar 1 detik karena waktu eksekusi Apps Script; karena itu data halaman ditampilkan dari cache dan diperbarui di belakang.
