# Laporan Pengujian: SDM & Absensi GGSHOPS.ID

Tanggal uji: 24 Oktober 2026 · Versi aplikasi: 1.0.0

## Ringkasan

| Lingkungan | Cakupan | Hasil |
|---|---|---|
| **A. Uji otomatis backend**: mock runtime Google Apps Script (`dev/gas-mock.js`) di Node.js 24 | 90 uji: 17 skenario wajib + jadwal, keamanan, rekap, retensi, regresi tinjauan kode (53 uji di `backend.test.js`), gaji & percepatan (13 uji di `payroll.test.js`), foto dari kamera HP (5 uji di `lampiran.test.js`), privasi antar-karyawan (3 uji di `privasi.test.js`), bonus penjualan paket (7 uji di `bonus.test.js`), serta percepatan tahap 2 (7 uji di `speed.test.js`). Juga lulus pada mode "Sheets menyimpan apostrof" (`GAS_MOCK_KEEP_APOSTROPHE=1`) | **90 PASS**, 0 FAIL |
| **B. Uji otomatis E2E**: Google Chrome headless, kamera palsu Chrome, emulasi GPS, backend mock | 15 uji alur browser (kamera, GPS, jam, reload, mobile, navigasi di dalam iframe seperti web app Apps Script, alur gaji, absen dengan kamera HP di iframe tanpa izin kamera, bonus host, kecepatan cache, jam bebas & hapus karyawan, versi Vercel) | **19 PASS**, 0 FAIL, juga pada hasil build (`GAS_SRC_DIR=build`) |
| **B2. Klik satu per satu** (antislop R-35): desktop Admin & ponsel karyawan | 66 langkah: semua menu (termasuk Gaji dan Bonus; tab Jadwal sudah dihapus), dialog, filter, tombol, kamera, absen, keyboard, lebar 390 px tanpa overflow | **66 PASS**, 0 FAIL, juga pada hasil build ([`hasil-klik.txt`](hasil-klik.txt)) |
| **C. Google Apps Script/Sheets/Drive asli** | Versi 13 di-deploy ke 4 deployment (juga dibuka dari Vercel) (24 Okt 2026). Halaman login web app asli dibuka di Chrome desktop & 390 px. Pemilik mencoba absen di iPhone. | **PASS** untuk tampilan login: font, logo, dan latar tampil, 0 error JS. Login, setup, dan reset password admin sudah dicoba pemilik. **Kamera langsung FAIL di web app asli** (diblokir Google, lihat Temuan); sejak versi 7 aplikasi memakai kamera HP sebagai gantinya dan belum dicoba di perangkat asli. Gunakan checklist manual M1–M12. |
| **D. Smartphone fisik** (Android Chrome, iPhone Safari) | Kamera depan asli, GPS asli, layout | **NOT TESTED**: perlu perangkat fisik setelah deploy |

Bukti keluaran lengkap: [`hasil-uji-otomatis.txt`](hasil-uji-otomatis.txt). Screenshot hasil E2E ada di [`screenshots/`](screenshots/).

Jalankan ulang:

```bash
npm install          # sekali, memasang puppeteer-core (memakai Chrome yang sudah terpasang)
npm test             # uji backend (A)
npm run test:e2e     # uji E2E di Chrome (B)
npm run test:klik    # klik satu per satu (B2)
npm run test:all     # semuanya
```

Arti status:
- **PASS**: lulus pada lingkungan tersebut.
- **FAIL**: gagal.
- **BLOCKED**: tidak dapat diuji karena prasyarat di luar kendali pengujian (deploy, akun Google).
- **NOT TESTED**: belum diuji.

## Hasil 17 skenario wajib

Kolom A/B = lingkungan simulasi di atas. Kolom C/D = Google asli dan perangkat fisik.

| # | Skenario | Uji otomatis | A/B | C (GAS asli) | D (HP fisik) |
|---|---|---|---|---|---|
| 1 | Check-in dengan foto langsung & GPS valid berhasil | S01, S01b, E01 | **PASS** | BLOCKED | NOT TESTED |
| 2 | Check-out dengan foto langsung & GPS valid berhasil | S02, S02b, E02 | **PASS** | BLOCKED | NOT TESTED |
| 3 | Pengguna di luar radius kantor ditolak | S03, E03 | **PASS** | BLOCKED | NOT TESTED |
| 4 | Izin kamera ditolak | E04, E13, L02 | **PASS** | BLOCKED | NOT TESTED |
| 5 | Izin lokasi ditolak | S05, E05 | **PASS** | BLOCKED | NOT TESTED |
| 6 | GPS tidak tersedia | S06, E06 | **PASS** | BLOCKED | NOT TESTED |
| 7 | Akurasi GPS tidak mencukupi | S07, S07b, E07 | **PASS** | BLOCKED | NOT TESTED |
| 8 | Jam perangkat dimajukan/dimundurkan → tetap jam server | S08, E08 | **PASS** | BLOCKED | NOT TESTED |
| 9 | Timestamp buatan dari frontend diabaikan | S09 | **PASS** | BLOCKED | n/a |
| 10 | Koordinat kantor dikirim dari frontend → tetap divalidasi backend | S10, S10b | **PASS** (lihat catatan) | BLOCKED | n/a |
| 11 | Check-in ganda ditolak | S11 | **PASS** | BLOCKED | NOT TESTED |
| 12 | Check-out ganda ditolak | S12 | **PASS** | BLOCKED | NOT TESTED |
| 13 | Foto tersimpan & hanya dapat diakses role berwenang | S13, S13b, E01 | **PASS** | BLOCKED | n/a |
| 14 | Data absensi tersimpan di Google Sheets | S14 | **PASS** | BLOCKED | n/a |
| 15 | Dua transaksi bersamaan tidak menyebabkan duplikasi | S15a–S15d | **PASS** (simulasi) | BLOCKED | n/a |
| 16 | Kamera & tombol absensi berfungsi di smartphone | E01, E14 (viewport 390×844, touch; E14 di iframe tanpa izin kamera seperti Google) | **PASS** (emulasi) | BLOCKED | NOT TESTED |
| 17 | Reload halaman tidak menghilangkan transaksi | S17, E02 | **PASS** | BLOCKED | NOT TESTED |

### Rincian yang diverifikasi

1. **Check-in (S01, E01).** Alur lengkap di Chrome: login → izin kamera & lokasi → stream kamera aktif → foto diambil dari `<video>` ke kanvas (720×960 JPEG, diberi watermark nama, jam server, dan ID sesi) → kamera dimatikan otomatis → checklist 6 syarat terpenuhi → tombol aktif → konfirmasi → bukti tampil. Di server: baris Attendance terisi, waktu = jam server, status `Hadir`, file foto ada di subfolder Drive `2026-10` dengan akses `PRIVATE`. Halaman tidak memiliki elemen `input[type=file]`. Check-in setelah toleransi tercatat `Terlambat` beserta menitnya (S01b).
2. **Check-out (S02, E02).** Status `Normal` setelah jam pulang, durasi kerja dikurangi jam istirahat. Sebelum jam pulang tercatat `Pulang Cepat` (S02b), atau ditolak jika Admin menonaktifkan opsi tersebut (X04).
3. **Di luar radius (S03, E03).** Titik 350 m dari kantor ditolak dengan pesan *"Anda berada di luar area kantor (350 m dari Kantor Pusat, radius 100 m)."* Tombol tetap nonaktif walau foto sudah diambil. Foto transaksi gagal tidak tersimpan, dan audit log mencatat kegagalan tanpa koordinat lengkap.
4. **Kamera ditolak (E04).** Pesan *"Izin kamera ditolak"* beserta petunjuk, tombol *Coba lagi*, tidak ada alternatif unggah file, dan tombol absensi nonaktif.
5. **Lokasi ditolak (S05, E05).** Pesan *"Izin lokasi diperlukan untuk melakukan absensi."* Di server, payload tanpa koordinat ditolak dengan kode `LOCATION_REQUIRED`.
6. **GPS tidak tersedia (S06, E06).** Chrome `POSITION_UNAVAILABLE` menghasilkan *"Lokasi tidak tersedia…"*. Koordinat tidak valid (teks, 0,0, lat > 90) ditolak server.
7. **Akurasi kurang (S07, E07).** Browser mencoba 3 kali, lalu server menolak dengan *"Akurasi GPS belum mencukupi (±150 m, maksimal 50 m). Silakan coba kembali di area terbuka."* Ambang dapat diubah Admin (S07b).
8. **Jam perangkat digeser (S08, E08).** Jam browser dimajukan 5 jam. Jam di layar tetap menunjukkan jam server (07:5x WIB), dan data tersimpan dengan jam server. Layar memakai `performance.now()` sejak sinkronisasi, bukan `Date.now()`.
9. **Timestamp palsu (S09).** Payload berisi `timestamp`, `checkInAt`, `status: 'Hadir'`, `lateMinutes: 0`, `workDate` lama. Semua diabaikan: tercatat jam server 09:10, status `Terlambat` 70 menit.
10. **Koordinat kantor dari frontend (S10).** Payload `officeLat/officeLng`, `radius: 999999`, `isInsideOffice: true` diabaikan, dan jarak dihitung dari titik kantor di sheet (ditolak, ±5 km).
    **Catatan jujur (S10b):** jika perangkat memalsukan koordinatnya sendiri *menjadi* titik kantor (aplikasi fake GPS), server tidak dapat membedakannya dari lokasi asli. Absensi tetap diterima, tetapi diberi penanda `EXACT_OFFICE_COORD` dan `ACC_SUSPICIOUS` yang hanya terlihat oleh HR/Admin. Ini batasan Geolocation API browser, bukan bug.
11. **Check-in ganda (S11).** Ditolak: *"Anda sudah check-in pada Senin, 26 Oktober 2026 pukul 07:50."*
12. **Check-out ganda (S12).** Ditolak dengan `DUPLICATE_CHECKOUT`, dan waktu check-out pertama tidak tertimpa. Check-out sebelum check-in juga ditolak (`NO_CHECKIN`).
13. **Akses foto (S13, S13b, R01).** Admin, HR, dan pemilik foto dapat melihat. Karyawan lain, termasuk rekan satu departemen dan akun ber-role lama `manager`, ditolak (`FORBIDDEN`). Setiap akses tercatat `PHOTO_VIEW` di audit log. Foto disajikan lewat server, tanpa tautan publik.
14. **Data tersimpan (S14).** Semua kolom wajib terisi. Tanggal dan jam disimpan sebagai teks, tidak berubah menjadi tipe Date. Input berawalan `=` disimpan sebagai teks, bukan formula (X20).
15. **Konkurensi (S15a–d).**
    - Perangkat kedua yang lebih dulu mendapat Script Lock menyebabkan permintaan pertama ditolak `DUPLICATE_CHECKIN`, dan hanya 1 baris tersimpan. Foto permintaan yang ditolak dipindahkan ke sampah.
    - Dua karyawan bersamaan: keduanya tersimpan.
    - Lock sibuk: ditolak `BUSY` tanpa data setengah jadi.
    - Pengiriman ulang: cooldown, nonce sekali pakai, dan hash foto yang sama ditolak.
16. **Smartphone (E01).** Emulasi viewport 390×844 dengan touch: urutan tampilan jam → kamera → checklist → tombol, dan tombol absensi tetap terlihat di layar (sticky). Screenshot: `screenshots/mobile-*.png`.
17. **Reload (S17, E02).** Setelah reload, jam masuk tetap tampil dan mode berubah menjadi check-out.

### Uji tambahan (semua PASS)

| ID | Uji |
|---|---|
| E09 | Kamera (semua track) berhenti saat pindah halaman dan setelah foto diambil |
| E10 | 13 halaman Admin terbuka tanpa error JavaScript |
| E11 | Klik menu di dalam iframe (seperti web app Apps Script) tidak membuka halaman kosong |
| E12 | Alur gaji di browser: check-out ponsel dengan jobdesk + foto hasil kerja → HR setujui di halaman Gaji → rekap menampilkan Rp 50.000 |
| E13 | Izin kamera ditolak tetapi foto kamera HP diizinkan: aplikasi beralih ke "Buka kamera", lokasi tampil terkunci, check-in tersimpan dengan penanda `LAMPIRAN` dan hash file asli |
| E14 | Di iframe yang meniru Google (izin kamera tidak ada): tidak mencoba kamera langsung, check-in lalu check-out memakai kamera HP; check-out terkunci sampai selfie, foto hasil kerja, dan jobdesk lengkap; foto tersimpan 720×960 dengan cap nama, jam server, dan lokasi ([`foto-kerja-tercap.jpg`](screenshots/foto-kerja-tercap.jpg)) |
| E15 | Bonus host di ponsel: tab Bonus terbuka otomatis, 100 paket dengan target 40 menampilkan "(100 − 40) × Rp 500 = Rp 30.000", kirim tanpa screenshot ditolak, screenshot dipilih lewat pemilih file, laporan tersimpan (60 paket, Rp 30.000, hash file asli); HR membuka screenshot, menyetujui, dan rekap menampilkan bonus Rp 30.000 |
| B01–B07 | Bonus: HR mengelola jenis paket (tarif, target, peserta; validasi), karyawan ditolak; hanya peserta melihat menu Bonus; rumus (jumlah − target) × tarif, di bawah/tepat target Rp 0, tarif & target disalin; wajib screenshot, tanggal hari ini s/d 7 hari ke belakang, sekali per jenis paket per hari, kirim ulang setelah ditolak, jenis nonaktif ditolak; screenshot tidak bisa dipakai orang lain/tanggal lain/foto absensi; verifikasi hanya HR & Super Admin, tolak wajib alasan, rekap = jobdesk + bonus disetujui, notifikasi HR; privasi bonus & screenshot; penanda `TANPA_ABSEN`; jenis paket terpakai hanya dinonaktifkan |
| R01–R03 | Privasi: karyawan (termasuk akun ber-role lama `manager` dan role salah ketik) hanya melihat profil, absen, riwayat, foto, foto kerja, laporan jobdesk, izin, dan jobdesk miliknya; 9 aksi data karyawan lain ditolak; dashboard dan boot tanpa data tim; HRD & Super Admin tetap melihat semua; role Manager tidak bisa dipilih lagi |
| L01–L05 | Foto kamera HP: diterima dengan penanda `LAMPIRAN` (absensi & laporan jobdesk), ditolak bila Admin menonaktifkan (tanpa data setengah jadi), file asli yang sama ditolak walau cap berbeda (antar-karyawan, selfie ↔ foto kerja, foto kerja kemarin), umur > 15 menit ditandai `FOTO_LAMA`, data meta tidak valid diabaikan, tetap wajib lolos radius, format JPEG, dan jam server |
| P01–P08 | Gaji: tarif (hak akses, validasi, nama ganda), check-out wajib foto hasil kerja/keterangan/jobdesk, foto kerja ≠ selfie, tanpa tarif tetap bisa check-out (Rp 0), verifikasi (hanya HR & Super Admin, bukan laporan sendiri, tolak wajib alasan), rekap hanya laporan Disetujui dengan tarif saat dilaporkan, akses foto hasil kerja, jobdesk terpakai hanya dinonaktifkan |
| X01–X05, X22, X31 | Jam kerja bebas: check-in 00.30, 05.30, 13.00, 23.40 dan hari Minggu diterima sebagai Hadir; check-out kapan saja tanpa Pulang Cepat; batas check-out 04.00 keesokan hari; lupa check-out tidak menghalangi check-in pagi; kerja lewat tengah malam masuk ke tanggal check-in; rekap tanpa alpha/terlambat. Hapus karyawan: hilang dari daftar beserta akun & sesinya, riwayat tetap jadi arsip, nomor tidak dipakai ulang |
| E17 | Di browser: halaman absen menampilkan "Jam bebas", check-in pukul 13.00 tercatat Hadir; HR menghapus karyawan dari menu Karyawan, kolom Jadwal sudah tidak ada |
| V07 | Status absensi ikut diambil sekaligus setelah login tanpa pernah membuat sesi kamera |
| E18–E19 | Versi Vercel: halaman statis memanggil server lewat `doPost` (POST text/plain tanpa preflight), kamera langsung aktif, check-in tersimpan; service worker membuat halaman terbuka 59 ms tanpa jaringan |
| V01–V06 | Percepatan tahap 2: boot, status absensi, dan notifikasi berulang tanpa membuka spreadsheet; check-in/check-out, laporan baru, verifikasi, dan bonus langsung terlihat walau di-cache; absen ganda tetap ditolak; `app.prefetch` patuh role & cakupan dan menolak aksi tulis; edit manual Attendance terlihat ≤ 5 menit; rekap bulan lengkap walau bagian akhir sheet tidak mencakup awal bulan |
| E16 | Kecepatan di browser dengan server tiruan 1.200 ms per panggilan: satu panggilan prefetch setelah login, Jobdesk/Izin/Gaji tampil 11–32 ms dari cache, data baru di server muncul sendiri lewat pembaruan di belakang, pengajuan izin baru langsung terlihat, aplikasi dibuka ulang dalam 68–74 ms, cache terhapus saat keluar |
| Q01–Q05 | Percepatan: cache tabel tidak membuka spreadsheet, perubahan role/nonaktif langsung berlaku, edit manual terlihat ≤ 5 menit, satu panggilan boot, status absensi membawa sesi kamera & riwayat, sheet baru dibuat otomatis |
| X01–X08 | Jendela check-in, hari libur, batas check-out, shift malam lintas tengah malam, izin/cuti memblokir check-in, validasi jadwal, perubahan zona waktu (WIB → WITA) |
| X09–X11 | Validasi format foto, nonce milik orang lain/kedaluwarsa, retensi foto |
| X12–X21 | Hanya 5 fungsi publik, `setup()` dijaga, hash PBKDF2, hash tidak bocor, ID rahasia tidak bocor, kunci login 5× gagal, token palsu, role dari payload diabaikan, isolasi data antar-karyawan, wajib ganti password sementara, admin terakhir terlindungi |
| X22–X24 | Rekap bulanan (hadir, terlambat, izin, alpha, tanpa check-out), audit koreksi HR, render dashboard & `doGet()` |
| X30 | `resetAdminPassword()` mengembalikan password admin ke 12345678 dan membuka kunci login |
| X25–X29 | Regresi tinjauan kode: HR tidak dapat menonaktifkan Admin, retensi hanya dari trigger/editor, username ditolak tanpa data setengah jadi, kolom tambahan tidak tertimpa, penanda wajah mengikuti pengaturan |

## Temuan di web app asli

- **Kamera langsung diblokir oleh Google.** Di web app asli (iPhone pemilik, lalu diperiksa di Chrome), iframe aplikasi memiliki daftar izin `accelerometer; autoplay; clipboard-read; clipboard-write; encrypted-media; fullscreen; geolocation; gyroscope; local-network-access; magnetometer; midi; payment; picture-in-picture; screen-wake-lock; sync-xhr; web-share`, tanpa `camera`. Hasilnya `document.featurePolicy.allowsFeature('camera') === false` dan `getUserMedia` selalu gagal `NotAllowedError`, sedangkan lokasi berfungsi. Ini tidak dapat diubah dari kode Apps Script. Versi 7 memakai kamera bawaan HP lewat `<input type="file" capture>` dan mencap jam server serta lokasi pada foto (E13, E14, L01–L05). Server pratinjau (`/__frame`) kini meniru daftar izin ini.

- Di lebar 390 px, halaman pembungkus Google (banner "Aplikasi ini dibuat oleh pengguna Google Apps Script") melebar menjadi 411 px, sehingga tepi kanan bisa tergeser sekitar 20 px. Aplikasi sendiri tidak overflow (`scrollWidth` = lebar iframe). Banner ini hanya muncul untuk akun Google biasa dan dapat ditutup dengan tombol X.

## Keterbatasan lingkungan simulasi

Hasil PASS di A/B **belum** membuktikan perilaku layanan Google asli. Hal yang tidak dapat direproduksi mock:

- **LockService asli.** Konkurensi diuji dengan menyisipkan transaksi kedua saat lock diminta. Antrean lock asli di bawah beban puluhan pengguna belum diuji.
- **Parsing Google Sheets.** Mock meniru parsing tanggal/jam/angka dan menolak formula, tetapi format sel asli mungkin berbeda.
- **iframe HtmlService.** Web app Apps Script berjalan di iframe `*.googleusercontent.com`. Pemblokiran kamera sudah ditiru di `/__frame`, tetapi perilaku pemilih file (`capture`) di Android Chrome dan iPhone Safari asli, termasuk apakah galeri ikut ditawarkan, harus diverifikasi di perangkat.
- **Kuota & batas.** Waktu eksekusi, ukuran payload `google.script.run`, CacheService yang bisa mengosongkan nonce lebih awal, dan izin berbagi Drive pada akun Workspace.
- **Kamera asli.** Kamera palsu Chrome menghasilkan gambar sintetis. Kamera depan asli, perpindahan kamera depan/belakang, dan iOS Safari belum diuji.

## Checklist uji manual setelah deploy (C dan D)

Lakukan dengan akun uji, lalu isi kolom hasil.

| # | Langkah | Harapan | Hasil |
|---|---|---|---|
| M1 | Jalankan `setup()` di editor | Spreadsheet, folder foto PRIVAT, admin & password sementara tampil di log | |
| M2 | Login admin, ganti password, tambah Lokasi Kerja dengan "Gunakan lokasi saya" di kantor | Lokasi tersimpan, peta menampilkan radius | |
| M3 | Android Chrome: buka URL `/exec`, login karyawan, buka Absensi | Browser meminta izin kamera & lokasi, kamera depan aktif | |
| M4 | Ambil foto & check-in di dalam kantor | Bukti tampil, baris baru di sheet Attendance, file foto di Drive | |
| M5 | iPhone Safari: ulangi M3–M4 | Sama seperti M3–M4 | |
| M6 | Check-in dari luar radius (±200 m) | Ditolak "di luar area kantor" | |
| M7 | Tolak izin kamera, lalu izinkan kembali dari pengaturan browser | Pesan jelas, berhasil setelah diizinkan | |
| M8 | Ubah jam HP ±2 jam, lalu check-out | Jam tercatat tetap jam server | |
| M9 | Dua HP check-in bersamaan dengan akun berbeda | Keduanya tersimpan | |
| M10 | Akun yang sama di dua HP, tekan check-in bersamaan | Hanya satu berhasil | |
| M11 | Buka link file foto di Drive dari akun Google lain | Akses ditolak (file privat) | |
| M12 | HR membuka Laporan → Riwayat → Detail | Foto tampil, penanda (bila ada) terlihat | |
