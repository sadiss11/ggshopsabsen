# Keamanan, Privasi, dan Keterbatasan

**GGSHOPS.ID · SDM & Absensi** · versi aplikasi 1.0.0

Dokumen ini menjelaskan cara aplikasi melindungi akun, data, dan integritas absensi, serta hal-hal yang **tidak dapat** dijamin oleh aplikasi berbasis browser. Semua angka di dokumen ini diambil dari kode server di `src/`, terutama `LIMITS_`, `CONFIG_DEFAULTS_`, `PHOTO_ACCESS_`, dan `routes_()`.

Dokumen terkait: [DEPLOYMENT.md](DEPLOYMENT.md) · [DATABASE.md](DATABASE.md)

## Daftar isi

1. [Ringkasan](#1-ringkasan)
2. [Arsitektur dan batas kepercayaan](#2-arsitektur-dan-batas-kepercayaan)
3. [Autentikasi](#3-autentikasi)
4. [Otorisasi per role](#4-otorisasi-per-role)
5. [Integritas data absensi](#5-integritas-data-absensi)
6. [Perlindungan lain](#6-perlindungan-lain)
7. [Audit log](#7-audit-log)
8. [Retensi dan privasi data](#8-retensi-dan-privasi-data)
9. [Keterbatasan](#9-keterbatasan)
10. [Catatan risiko pada versi 1.0.0](#10-catatan-risiko-pada-versi-100)
11. [Rekomendasi penguatan bertahap](#11-rekomendasi-penguatan-bertahap)

---

## 1. Ringkasan

Kontrol utama:

- Password disimpan sebagai hash PBKDF2-HMAC-SHA256 dengan salt acak. Sesi memakai token acak, dan server hanya menyimpan hash token tersebut.
- Login dikunci 15 menit setelah 5 kali gagal. Password sementara wajib diganti sebelum fitur lain dapat dipakai.
- Setiap aksi diperiksa role dan cakupan datanya di server. Role dan status pengguna selalu dibaca ulang dari sheet, tidak pernah diambil dari browser.
- Waktu resmi absensi adalah waktu server saat permintaan diterima. Jam perangkat diabaikan.
- Jarak ke kantor dan aturan jadwal dihitung ulang di server. Status "di dalam kantor" dari browser diabaikan.
- Foto absensi terikat pada sesi kamera sekali pakai (10 menit), divalidasi formatnya, dicek agar tidak dipakai ulang (hash SHA-256), disimpan di folder Drive privat, dan hanya dapat dilihat lewat server sesuai role.
- Google memblokir kamera langsung di web app Apps Script. Karena itu foto diambil lewat kamera HP (input file), lalu aplikasi mencap jam server dan lokasi GPS terverifikasi pada foto. Foto seperti ini ditandai `LAMPIRAN` untuk HR. Admin dapat menonaktifkannya. Lihat [5.6](#56-anti-manipulasi-foto) dan [9.2](#92-foto-dapat-dipalsukan).
- Transaksi tulis diserialkan dengan Script Lock, lalu dievaluasi ulang di dalam lock.
- Aktivitas penting dicatat di audit log.

Yang **tidak** dapat dijamin: lokasi GPS dan foto dari browser dapat dipalsukan oleh pengguna yang cukup teknis. Server hanya menambahkan **penanda kewajaran** untuk ditinjau HR. Aplikasi ini tidak anti-spoofing. Lihat [bagian 9](#9-keterbatasan).

---

## 2. Arsitektur dan batas kepercayaan

| Komponen | Peran | Dipercaya? |
|---|---|---|
| Browser karyawan | Mengirim username/password, token sesi, koordinat dan akurasi GPS, foto JPEG, hasil deteksi wajah, catatan | **Tidak.** Semua masukan divalidasi ulang di server. |
| Server Apps Script | Menentukan waktu, tanggal kerja, status hadir/terlambat, jarak, dan hak akses | Ya |
| Google Sheets | Database (8 sheet) | Ya, selama aksesnya dibatasi |
| Google Drive | Foto absensi di folder privat | Ya, selama aksesnya dibatasi |
| Script Properties | Konfigurasi, ID spreadsheet/folder, sesi | Ya |
| CacheService | Data sementara: nonce foto, penghitung login, cooldown, rate limit | Upaya terbaik (dapat terhapus lebih awal) |

Semua eksekusi web app berjalan sebagai **akun pemilik** (Execute as: Me). Pihak berikut berada **di luar kendali aplikasi**: tidak melewati login, role, maupun audit log.

| Pihak | Yang dapat dilakukan |
|---|---|
| Pemilik akun Google | Semua hal |
| Editor proyek Apps Script | Mengubah kode, membaca dan mengubah Script Properties, menjalankan `setup()` dan `resetAdminPassword()` (sehingga dapat memperoleh password admin) |
| Siapa pun yang diberi akses ke spreadsheet | Membaca dan mengubah semua data, termasuk kolom `passwordHash` dan audit log |
| Siapa pun yang diberi akses ke folder foto | Melihat semua foto |

Karena itu, jangan bagikan spreadsheet maupun folder foto, dan batasi editor proyek hanya untuk orang yang setara Admin.

---

## 3. Autentikasi

### 3.1 Penyimpanan password

- Algoritma: PBKDF2-HMAC-SHA256 dengan **1000 iterasi** (`LIMITS_.HASH_ITERATIONS`), salt acak 16 byte per password, dan keluaran 32 byte.
- Format di kolom `Users.passwordHash`: `pbkdf2$<iterasi>$<salt base64>$<hash base64>`.
- Hasil hash dibandingkan dengan perbandingan waktu-konstan.
- Server mampu memverifikasi hash dengan 1–100.000 iterasi, sehingga jumlah iterasi dapat dinaikkan kemudian tanpa membatalkan hash lama.

Catatan jujur: 1000 iterasi jauh di bawah rekomendasi industri saat ini untuk PBKDF2-SHA256 (ratusan ribu iterasi). Angka ini dipilih karena keterbatasan kinerja Apps Script. Akibatnya, jika isi sheet Users bocor, password lemah dapat ditebak secara offline relatif cepat. Jaga spreadsheet tetap privat.

### 3.2 Kebijakan password

- Panjang 8–128 karakter, wajib mengandung huruf dan angka, dan password baru harus berbeda dari password lama.
- Password sementara terdiri dari 11 karakter: 8 huruf (tanpa I, O, l, o) diikuti 3 angka (2–9), dibuat dari sumber acak server. Password sementara diterbitkan oleh `setup()`, `resetAdminPassword()`, saat akun dibuat, dan saat Admin mereset password.
- Akun dengan password sementara (`mustChangePassword = TRUE`) hanya dapat memanggil `auth.me`, `auth.changePassword`, dan `auth.logout`. Aksi lain ditolak dengan kode `PASSWORD_CHANGE_REQUIRED`.

### 3.3 Sesi

- **Token:** 64 karakter heksadesimal acak (dari dua UUID acak), diberikan ke browser saat login dan dikirim pada setiap panggilan `api()`.
- **Penyimpanan:** server hanya menyimpan hash SHA-256 token sebagai Script Property `sess_<hash>`, berisi `userId`, waktu dibuat, waktu terakhir dipakai, dan sidik jari hash password. Isi Script Properties tidak dapat dipakai untuk membuat ulang token.
- **Sesi gugur jika:**
  - tidak dipakai selama **12 jam** (waktu terakhir dipakai diperbarui paling sering setiap 10 menit),
  - sudah berumur **16 jam** sejak login, berapa pun aktivitasnya,
  - password berubah (diganti sendiri, direset Admin, atau lewat `resetAdminPassword()`),
  - status akun bukan `Aktif`, atau akun dihapus,
  - pengguna logout. Logout hanya mengakhiri sesi di perangkat tersebut.
- Role dan status dibaca ulang dari sheet Users pada **setiap** permintaan, sehingga perubahan role berlaku pada permintaan berikutnya.
- Saat password diganti, semua sesi lama gugur dan perangkat yang mengganti password mendapat sesi baru.
- Tidak ada batas jumlah sesi per pengguna, dan tidak ada fitur "keluar dari semua perangkat" selain mengganti password. Dalam keadaan darurat, Anda dapat menghapus semua properti `sess_*` agar semua pengguna keluar.
- Sesi kedaluwarsa dibersihkan setiap kali ada login berhasil, karena kapasitas Script Properties dibatasi 500 KB.
- Sesi tidak disimpan di CacheService karena masa simpan maksimalnya 6 jam, lebih pendek dari jarak antara check-in pagi dan check-out sore.

Siapa pun yang memperoleh token (misalnya di perangkat bersama yang tidak di-logout) dapat memakai sesi itu sampai kedaluwarsa. Minta karyawan selalu logout di perangkat bersama.

### 3.4 Pembatasan percobaan login

- Setelah **5 kali gagal** untuk satu username, username tersebut dikunci **15 menit**, dihitung sejak kegagalan terakhir. Selama terkunci, password yang benar pun ditolak.
- Penghitung juga berlaku untuk username yang tidak ada. Pesan galat selalu sama ("Username atau password salah."), dan server tetap menghitung hash untuk username yang tidak dikenal agar waktu respons serupa.
- Penghitung disimpan di CacheService, sehingga dapat hilang lebih awal. Kunci dibuka oleh reset password dari Admin atau oleh `resetAdminPassword()`.
- Keterbatasan: penghitung bersifat per username, bukan per perangkat atau alamat IP (Apps Script tidak menyediakan IP klien). Akibatnya:
  - orang lain dapat sengaja mengunci username yang diketahui, misalnya `admin`;
  - mencoba satu password ke banyak username tidak dibatasi secara global.

---

## 4. Otorisasi per role

### 4.1 Role

| Nilai `role` | Label | Cakupan data |
|---|---|---|
| `admin` | Super Admin | Semua karyawan, plus pengaturan, lokasi, jadwal, pengguna, dan audit log |
| `hr` | HRD | Semua karyawan |
| `karyawan` | Karyawan | Hanya dirinya sendiri: profil, absen, foto, izin, jobdesk, laporan, dan gaji miliknya |

Aturan pemilik (24 Oktober 2026): **hanya Super Admin dan HRD yang dapat melihat data karyawan lain.** Jabatan seperti admin toko atau host live tetap memakai role Karyawan. Role `manager` (dulu melihat satu departemen) sudah dihapus. Akun yang di sheet masih bertuliskan `manager`, atau role lain yang tidak dikenal (misalnya salah ketik saat edit manual), diperlakukan sebagai `karyawan` oleh server (`effectiveRole_`). Jangan memberi role Super Admin kepada staf yang jabatannya "admin"; role itu membuka semua data dan pengaturan.

### 4.2 Alur pemeriksaan di `api()`

1. Nama aksi harus terdaftar di `routes_()`. Aksi lain ditolak (`BAD_REQUEST`).
2. Semua aksi kecuali `auth.login` dan `time.now` memerlukan sesi yang sah.
3. Jika password masih sementara, hanya `auth.me`, `auth.changePassword`, dan `auth.logout` yang diizinkan.
4. Jika aksi membatasi role dan role pengguna tidak termasuk, permintaan ditolak (`FORBIDDEN`) dan dicatat sebagai `ACCESS_DENIED`.
5. Fungsi aksi kemudian memeriksa cakupan data: Super Admin dan HRD semua karyawan, role lain hanya data miliknya.

### 4.3 Matriks aksi dan role

Aksi tanpa sesi: `auth.login` (tunduk pada kunci 5x gagal/15 menit) dan `time.now` (hanya mengembalikan waktu server).

Aksi yang tetap boleh saat password masih sementara: `auth.me`, `auth.changePassword` (wajib menyertakan password lama), `auth.logout`.

Aksi lain memerlukan sesi dan password yang sudah diganti:

| Aksi | admin | hr | karyawan | Pembatasan tambahan di server |
|---|:-:|:-:|:-:|---|
| `dashboard.summary` | Ya | Ya | Ya | Ringkasan tim hanya untuk admin/hr |
| `notif.summary` | Ya | Ya | Ya | Data diri sendiri; jumlah pengajuan dan laporan yang menunggu hanya untuk admin/hr |
| `attendance.state` | Ya | Ya | Ya | Data diri sendiri |
| `attendance.begin` | Ya | Ya | Ya | Akun harus terhubung ke data karyawan aktif; maks. 30 kali per 10 menit |
| `attendance.checkLocation` | Ya | Ya | Ya | Sama seperti di atas; maks. 60 kali per 10 menit; hasilnya tidak disimpan |
| `attendance.submit` | Ya | Ya | Ya | Sama seperti di atas; wajib nonce; cooldown 4 detik; diproses di dalam lock |
| `attendance.history` | Ya | Ya | Ya | Riwayat sendiri; riwayat karyawan lain hanya untuk admin/hr; rentang 1–93 hari |
| `attendance.photo` | Ya | Ya | Ya | Mengikuti `PHOTO_ACCESS_` ([4.5](#45-akses-foto-photo_access_)) |
| `attendance.list` | Ya | Ya | – | Rentang maks. 62 hari |
| `attendance.update` | Ya | Ya | – | Hanya status dan catatan; waktu dan foto tidak dapat diubah |
| `employees.list` | Ya | Ya | – | |
| `employees.get` | Ya | Ya | Ya | Sesuai cakupan; karyawan hanya data dirinya |
| `employees.save` | Ya | Ya | – | HR hanya dapat membuat akun dengan role karyawan |
| `employees.remove` | Ya | Ya | – | Menghapus data karyawan beserta akun loginnya (sesi langsung gugur). Riwayat absensi, laporan, bonus, dan foto tetap tersimpan sebagai arsip, tetapi tidak tampil lagi di rekap. Tidak dapat menghapus data diri sendiri; HR tidak dapat menghapus karyawan yang terhubung ke akun Super Admin; nomor karyawan tidak pernah dipakai ulang (`EMP_SEQ`) |
| `employees.updateSelf` | Ya | Ya | Ya | Hanya nomor HP dan alamat milik sendiri |
| `jobs.list` | Ya | Ya | Ya | Karyawan hanya tugas miliknya |
| `jobs.save` | Ya | Ya | – | |
| `jobs.updateStatus` | Ya | Ya | Ya | Karyawan hanya tugas miliknya |
| `jobs.remove` | Ya | Ya | – | |
| `leave.list` | Ya | Ya | Ya | Karyawan hanya pengajuan miliknya; daftar persetujuan (`scope=approvals`) hanya untuk admin/hr |
| `leave.submit` | Ya | Ya | Ya | Wajib data karyawan aktif; maks. 30 hari per pengajuan; tanggal mulai paling lama 7 hari ke belakang; maks. 10 pengajuan per jam |
| `leave.decide` | Ya | Ya | – | Tidak untuk pengajuan sendiri; hanya pengajuan berstatus Menunggu |
| `leave.cancel` | Ya | Ya | Ya | Hanya pengajuan sendiri yang berstatus Menunggu |
| `report.monthly` | Ya | Ya | – | |
| `meta.options` | Ya | Ya | – | Daftar pilihan formulir |
| `settings.get`, `settings.save` | Ya | – | – | |
| `locations.list`, `locations.save`, `locations.remove` | Ya | – | – | Lokasi yang masih dipakai karyawan tidak dapat dihapus |
| `schedules.list` | Ya | Ya | – | |
| `schedules.save`, `schedules.remove` | Ya | – | – | Jadwal default dan jadwal yang dipakai karyawan tidak dapat dihapus |
| `users.list`, `users.save`, `users.resetPassword`, `users.remove` | Ya | – | – | Minimal satu admin aktif harus tersisa; admin tidak dapat mengubah role/status atau menghapus akunnya sendiri |
| `audit.list` | Ya | – | – | |

Batas laju ("maks. N kali per X menit") memakai penghitung di CacheService yang masa berlakunya diperpanjang pada setiap permintaan. Penghitung baru kembali ke nol setelah jendela waktu tersebut berlalu tanpa permintaan.

### 4.4 Cakupan data

- **Melihat:** admin dan hr melihat semua karyawan. Karyawan hanya melihat dirinya; rekan satu departemen pun tidak terlihat (`canSeeEmployee_`).
- **Mengelola** (menyetujui cuti, memverifikasi laporan jobdesk, menugaskan dan menghapus jobdesk): hanya admin dan hr (`canManageEmployee_`). Tidak seorang pun dapat memproses pengajuan cuti atau laporan jobdesknya sendiri.
- **Penyaringan field yang dikirim ke browser:**
  - Koordinat GPS dan timestamp mentah absensi hanya dikirim ke admin dan hr (di daftar absensi).
  - Penanda kewajaran (flags) hanya dikirim ke admin dan hr. Karyawan tidak melihat flags pada datanya sendiri.
  - `passwordHash` tidak pernah dikirim.
  - ID spreadsheet dan ID folder foto tidak pernah dikirim. `settings.get` hanya memberi tahu apakah keduanya sudah dikonfigurasi.
- **Batasan HR:** HR hanya dapat membuat akun dengan role karyawan, dan tidak dapat mengubah status akun admin lewat perubahan status data karyawan. Ada satu pengecualian, lihat [bagian 10](#10-catatan-risiko-pada-versi-100).

### 4.5 Akses foto (`PHOTO_ACCESS_`)

| Role | Nilai di kode | Foto yang dapat dilihat |
|---|---|---|
| admin | `all` | Semua |
| hr | `all` | Semua |
| karyawan | `own` | Foto sendiri |

- Server membaca file foto dari Drive dan mengirimkannya sebagai data URL setelah memeriksa hak akses. Tidak ada tautan Drive publik maupun tautan berbagi.
- Setiap permintaan foto dicatat sebagai `PHOTO_VIEW`, baik berhasil (`SUCCESS`) maupun ditolak (`DENIED`).
- Setelah tampil di layar, foto berada di browser pengguna yang berwenang dan dapat disimpan atau di-screenshot. Aplikasi tidak dapat mencegah hal ini.

---

## 5. Integritas data absensi

### 5.1 Waktu resmi dari server

- `api()` mengambil `new Date()` saat permintaan diterima (`ctx.now`). Waktu inilah yang dipakai untuk `checkInAt`/`checkOutAt`, penentuan tanggal kerja, keterlambatan, pulang cepat, dan masa berlaku nonce.
- Yang dicatat adalah waktu **penerimaan** permintaan, bukan waktu setelah menunggu antrean lock. Karyawan yang menunggu antrean tidak dirugikan.
- Jam dan zona waktu perangkat diabaikan. Jam di layar disinkronkan dari `time.now` dan `serverTime` (dikirim di setiap respons) hanya untuk keperluan tampilan.

### 5.2 Payload di-whitelist

`attendance.submit` hanya membaca field berikut: `action`, `nonce`, `photo`, `lat`, `lng`, `accuracy`, `faceCheck`, `note` (maks. 200 karakter).

Field lain diabaikan, termasuk timestamp, koordinat kantor, radius, `isInsideOffice`, status, dan `employeeId`. Identitas karyawan selalu diambil dari sesi. Aksi lain juga hanya membaca field tertentu dan memvalidasi nilai enum (role, status, jenis cuti, prioritas, dan sebagainya).

### 5.3 Validasi lokasi di server

Server menjalankan urutan berikut, baik pada pra-cek (`attendance.checkLocation`, hasilnya tidak disimpan) maupun saat submit di dalam lock (hasil inilah yang menentukan):

1. Koordinat wajib ada dan berupa angka dalam rentang yang sah; titik (0, 0) ditolak; akurasi harus lebih dari 0.
2. Lokasi kandidat adalah lokasi aktif yang ditetapkan untuk karyawan, atau semua lokasi aktif jika tidak ada penetapan.
3. Jarak ke setiap lokasi dihitung dengan rumus Haversine (jari-jari bumi 6.371.008,8 m). Server memilih lokasi dengan nilai (jarak − radius) terkecil.
4. Penanda kewajaran dihitung ([5.4](#54-penanda-kewajaran-flags)).
5. Absensi ditolak jika akurasi lebih besar dari ambang (default 50 m).
6. Absensi ditolak jika jarak lebih besar dari radius lokasi.

| Kode | Arti |
|---|---|
| `LOCATION_REQUIRED` | Koordinat tidak dikirim (izin lokasi tidak diberikan) |
| `LOCATION_INVALID` | Koordinat di luar rentang atau (0, 0) |
| `ACCURACY_LOW` | Akurasi tidak terbaca, atau lebih besar dari ambang |
| `NO_OFFICE` | Tidak ada lokasi aktif untuk karyawan ini |
| `OUTSIDE_RADIUS` | Jarak lebih besar dari radius |
| `OK` | Lokasi diterima |

Ketidakpastian akurasi tidak ditambahkan ke radius. Jarak dihitung dari titik yang dilaporkan perangkat.

### 5.4 Penanda kewajaran (flags)

Flags **tidak menolak** absensi. Flags disimpan di kolom `Attendance.flags` dengan awalan `IN:` (check-in) atau `OUT:` (check-out), misalnya `IN:LOW_PRECISION,OUT:FACE_NOT_DETECTED`, untuk ditinjau HR.

| Penanda | Kondisi di server | Kemungkinan arti |
|---|---|---|
| `ACC_SUSPICIOUS` | Akurasi yang dilaporkan kurang dari 1 m | Nilai tidak wajar untuk GPS ponsel; sering muncul pada lokasi palsu atau emulator |
| `EXACT_OFFICE_COORD` | Jarak ke titik lokasi kurang dari 0,5 m | Koordinat nyaris persis sama dengan titik kantor; pola umum pemalsuan dengan menyalin koordinat kantor |
| `LOW_PRECISION` | Latitude atau longitude memiliki 3 digit desimal atau kurang (resolusi sekitar 100 m) | Koordinat dibulatkan atau diketik manual. Dapat juga muncul jika perangkat atau browser membulatkan koordinat. |
| `IMPOSSIBLE_TRAVEL` | Berpindah lebih dari 2 km dari transaksi sebelumnya dengan kecepatan lebih dari 250 km/jam | Lokasi "melompat". Check-out dibandingkan dengan check-in-nya; check-in dibandingkan dengan check-out terakhir (hari ini atau kemarin). Selisih waktu minimal dihitung 1 menit. |
| `FACE_NOT_DETECTED` | Browser melaporkan wajah tidak terdeteksi | Hasil dari browser, bukan dihitung server; mudah dipalsukan |
| `LAMPIRAN` | Foto dikirim dari kamera HP (input file), bukan dari kamera langsung di aplikasi | Normal di web app Apps Script karena Google memblokir kamera langsung. Penanda ini mengingatkan HR bahwa jalur ini lebih lemah (lihat 9.2). |
| `FOTO_LAMA` | Umur file foto lebih dari 15 menit saat dikirim | Kemungkinan foto lama atau foto dari galeri. Umur dihitung di perangkat dari waktu file dibuat, jadi dapat dipalsukan. |

Penanda yang sama berlaku untuk foto hasil kerja dan disimpan di kolom `WorkReports.flags` (tanpa awalan). Halaman **Gaji → Verifikasi** menampilkannya di bawah nama jobdesk.

Membaca flags dengan benar:

- Flags dapat muncul pada absensi yang sah (positif palsu).
- Tidak adanya flags **bukan** bukti absensi asli. Pemalsuan yang rapi tidak meninggalkan penanda.
- Jadikan flags sebagai alasan untuk memeriksa foto dan menanyakan langsung ke karyawan, bukan sebagai dasar sanksi otomatis.

### 5.5 Aturan absensi dievaluasi di server

Aturan pemilik (5 November 2026): **tidak ada jadwal atau shift.** Karyawan bebas check-in kapan saja (satu kali per tanggal) dan check-out kapan saja setelahnya, paling lambat pukul 04.00 keesokan hari. Lewat dari itu, catatan tersebut ditutup tanpa jam pulang, dan karyawan dapat check-in lagi untuk tanggal baru. Status otomatis selalu **Hadir**; tidak ada lagi Terlambat, Pulang Cepat, atau Alpha otomatis. Durasi kerja = jam pulang − jam masuk.

Yang tetap dihitung di server: larangan absen ganda, cuti/izin yang sudah disetujui, batas check-out, jeda minimal 2 menit antara check-in dan check-out, serta jam resmi dari server. Saat submit, semuanya dievaluasi ulang di dalam lock dengan membaca data terbaru langsung dari sheet.

### 5.6 Anti-manipulasi foto

1. **Sesi kamera (nonce).** `attendance.begin` membuat nonce acak 32 karakter heksadesimal yang disimpan di CacheService selama **10 menit**, terikat pada `userId`, jenis aksi (check-in atau check-out), dan waktu server. Batasnya 30 sesi per pengguna; penghitung kembali ke nol setelah 10 menit tanpa permintaan.
2. **Verifikasi nonce.** Saat submit, nonce harus cocok dengan pengguna dan aksi, dan umurnya tidak lebih dari 10 menit. Nonce dihapus setelah transaksi **berhasil**. Percobaan yang gagal (misalnya di luar radius) dapat diulang dengan nonce yang sama selama masih berlaku.
3. **Validasi file:**
   - harus berupa data URL `data:image/jpeg;base64,` dengan base64 yang sah;
   - ukuran setelah didekode minimal 4.000 byte dan maksimal sekitar 1,5 MB;
   - diawali penanda JPEG `FFD8` dan diakhiri `FFD9`;
   - dimensi dibaca dari marker SOF; tiap sisi harus 240–2000 piksel.
4. **Cegah pemakaian ulang.** Server menghitung SHA-256 dari isi file. Jika hash yang sama sudah ada di kolom `checkInPhotoHash`, `checkOutPhotoHash`, atau `WorkReports.photoHash`, absensi ditolak (`DUPLICATE_PHOTO`). Untuk foto dari kamera HP, yang disimpan dan dicek adalah hash **file asli** yang dipilih (dihitung browser), karena cap waktu membuat JPEG yang dikirim selalu berbeda. Jadi file yang sama tidak dapat dipakai dua kali, oleh karyawan yang sama maupun orang lain, sebagai selfie maupun foto hasil kerja.
5. **Penyimpanan privat.** Foto disimpan di folder Drive privat milik akun pemilik. Deskripsi file mencatat waktu diterima server dan hash-nya. Spreadsheet hanya menyimpan ID file dan hash.
6. **Pembersihan saat gagal.** Jika transaksi gagal setelah foto tersimpan, foto dipindahkan ke Sampah.
7. **Akses lewat server.** Foto hanya dapat dibuka melalui `attendance.photo` dengan pemeriksaan role ([4.5](#45-akses-foto-photo_access_)). Setiap akses dicatat sebagai `PHOTO_VIEW`.
8. **Mode kamera HP (lampiran).** Web app Apps Script ditampilkan Google di dalam iframe yang tidak memberi izin `camera` (daftar izin iframe Google hanya memuat geolocation, clipboard, fullscreen, dan sejenisnya). Akibatnya `getUserMedia` selalu ditolak di semua perangkat, dan ini tidak dapat diubah dari kode aplikasi. Aplikasi lalu memakai `<input type="file" accept="image/*" capture>`, yang di Android dan iPhone membuka kamera bawaan HP:
   - foto dipotong ke 720 × 960 lalu dicap **saat konfirmasi**: nama, label (CHECK-IN / CHECK-OUT / BUKTI KERJA), tanggal dan jam server, lokasi terverifikasi (nama lokasi, jarak, koordinat, akurasi), nama perusahaan, sesi, dan sumber "kamera HP". Cap ini dibuat oleh aplikasi; tidak ada kolom yang dapat diedit karyawan;
   - lokasi tetap diambil dari GPS dan divalidasi ulang di server seperti biasa. Jam resmi tetap jam server;
   - browser mengirim `photoSource`, hash SHA-256 file asli, dan umur file. Server menambahkan penanda `LAMPIRAN` dan, bila umur lebih dari 15 menit, `FOTO_LAMA`;
   - check-out tetap wajib selfie, foto hasil kerja, dan laporan jobdesk;
   - Admin dapat menonaktifkan jalur ini di **Pengaturan → Perusahaan & aturan** ("Izinkan foto dari kamera HP bila kamera langsung diblokir"). Jika dinonaktifkan, server menolak foto lampiran (`PHOTO_UPLOAD_DISABLED`); di web app Apps Script ini berarti karyawan tidak dapat absen sama sekali.

Kontrol-kontrol ini **tidak** membuktikan bahwa foto diambil dari kamera saat itu. Lihat [bagian 9](#9-keterbatasan).

Tips investigasi: Drive mencatat waktu pembuatan setiap file. Anda dapat membandingkannya dengan `checkInAt` dan dengan isi deskripsi file.

### 5.7 Konkurensi

- Semua transaksi tulis memakai **Script Lock** global (menunggu maks. 20 detik): absensi, pembaruan `lastLoginAt` saat login, cuti, jobdesk, karyawan, pengguna, lokasi, jadwal, dan retensi. Jika lock tidak didapat dalam 20 detik, pengguna menerima pesan "Server sedang sibuk" (`BUSY`).
- Di dalam lock, absensi mengevaluasi ulang secara berurutan: nonce, catatan hari ini (dibaca langsung dari sheet), aturan jadwal, lokasi, dan hash foto. Baru setelah itu foto disimpan dan baris ditulis. Perubahan di-flush sebelum lock dilepas.
- **Cooldown 4 detik** per pengguna (CacheService) menolak kiriman ganda yang beruntun.
- Dua kiriman paralel dengan nonce yang sama hanya berhasil satu kali, karena nonce dihapus di dalam lock setelah transaksi berhasil.
- Audit log ditulis di luar lock dengan penambahan baris (`appendRow`) yang atomik.

---

## 6. Perlindungan lain

### 6.1 Anti formula-injection

- Semua nilai teks ditulis dengan awalan apostrof (`'`), sehingga Google Sheets menyimpannya sebagai teks. Masukan seperti `=IMPORTXML(...)` tidak dieksekusi sebagai formula.
- Saat sebuah baris diperbarui, nilai teks lama di baris itu juga ditulis ulang dengan apostrof.
- Perlindungan ini hanya berlaku di Google Sheets. Jika data diekspor ke CSV lalu dibuka di Excel, sel yang diawali `=`, `+`, `-`, atau `@` dapat ditafsirkan sebagai formula. Gunakan format XLSX, atau impor CSV dengan semua kolom bertipe teks.

### 6.2 Validasi masukan

- Teks bebas: karakter kontrol dibuang, spasi di awal dan akhir dipangkas, dan panjangnya dibatasi per field.
- Tanggal harus `yyyy-MM-dd` yang valid, jam harus `HH:mm`, dan nilai enum harus persis sama dengan daftar yang diizinkan. Email dan nomor HP diperiksa formatnya; angka diperiksa rentangnya.
- Payload yang bukan objek diperlakukan sebagai objek kosong.
- Galat tak terduga ditampilkan ke pengguna sebagai pesan generik ("Terjadi kesalahan pada server"). Detailnya dicatat di log Apps Script dan di AuditLogs (`SERVER_ERROR`, maks. 200 karakter).

### 6.3 Fungsi yang dapat dipanggil dari browser

Apps Script mengizinkan browser memanggil fungsi tingkat atas yang namanya tidak diakhiri garis bawah (`_`) melalui `google.script.run`. Semua fungsi internal aplikasi diakhiri `_`. Hanya lima fungsi yang publik:

| Fungsi | Penjaga | Catatan |
|---|---|---|
| `doGet` | – | Menyajikan halaman |
| `api` | Sesi dan role per aksi | Satu-satunya pintu data |
| `setup` | `guardEditor_` | Email pengguna aktif harus ada dan sama dengan email pengguna efektif |
| `resetAdminPassword` | `guardEditor_` | Sama seperti `setup` |
| `runRetentionCleanup` | Trigger proyek atau `guardEditor_` | Berjalan hanya jika dipanggil trigger milik proyek ini (dicocokkan lewat `triggerUid`, yang tidak diketahui pengunjung) atau dari editor |

Pada web app "Execute as: Me", pengunjung anonim atau pengguna akun lain tidak lolos `guardEditor_`, karena email aktifnya kosong atau berbeda dari email pemilik. Sebaliknya, setiap **editor proyek** yang menjalankan fungsi dari editor Apps Script lolos pemeriksaan ini. Perlakukan editor proyek sebagai Admin penuh.

### 6.4 Rahasia server

- `SPREADSHEET_ID` dan `PHOTO_FOLDER_ID` tidak pernah dikirim ke browser.
- Data awal yang disisipkan ke halaman hanya nama perusahaan, nama aplikasi, dan versi. Data ini di-escape agar aman berada di dalam tag `<script>`.

---

## 6A. Gaji & laporan jobdesk

Aturan pemilik: tarif tetap per laporan, satu jobdesk dibayar sekali per hari kerja, tanpa gaji pokok, dan hanya laporan **Disetujui** yang dihitung.

- **Laporan dibuat server saat check-out.** Browser hanya mengirim foto hasil kerja, daftar `rateId`, dan keterangan. Nama jobdesk dan tarif disalin dari sheet `JobRates` oleh server; nominal dari browser tidak dipakai.
- **Wajib saat pulang.** Check-out ditolak tanpa foto hasil kerja yang valid (JPEG dari kamera, hash belum pernah dipakai, dan berbeda dari selfie), tanpa keterangan minimal 5 karakter, atau tanpa jobdesk bila ada jobdesk bertarif untuk departemen karyawan. Jika belum ada tarif, laporan tetap dibuat dengan tarif 0.
- **Satu transaksi.** Foto selfie, foto hasil kerja, check-out, dan laporan ditulis di dalam Script Lock yang sama. Bila gagal sebelum check-out tersimpan, kedua foto dipindahkan ke sampah.
- **Tarif lama tidak berubah.** Mengubah tarif hanya berlaku untuk laporan baru. Jobdesk yang sudah dipakai di laporan tidak dapat dihapus, hanya dinonaktifkan.
- **Verifikasi.** Hanya Admin dan HR yang memverifikasi, untuk semua karyawan. Tidak ada yang dapat memverifikasi laporannya sendiri. Penolakan wajib disertai alasan yang terlihat oleh karyawan.
- **Akses.** Rekap gaji (`payroll.summary`) dan pengelolaan tarif hanya untuk Admin dan HR. Karyawan hanya melihat laporan dan bayarannya sendiri. Foto hasil kerja mengikuti aturan akses foto absensi ([4.5](#45-akses-foto-photo_access_)).

| Aksi | admin | hr | karyawan |
|---|---|---|---|
| `rates.list` | Ya | Ya | – |
| `rates.save`, `rates.remove` | Ya | Ya | – |
| `work.list` | Ya | Ya | Miliknya |
| `work.verify` | Ya | Ya | – |
| `work.photo` | Ya | Ya | Miliknya |
| `payroll.summary` | Ya | Ya | – |
| `bonus.schemes`, `bonus.saveScheme`, `bonus.removeScheme` | Ya | Ya | – |
| `bonus.form`, `bonus.submit` | Ya | Ya | Hanya peserta jenis paket |
| `bonus.list`, `bonus.photo` | Ya | Ya | Miliknya |
| `bonus.verify` | Ya | Ya | – |

### Bonus penjualan paket

Aturan pemilik: setiap jenis paket punya bonus per paket dan target harian sendiri; bonus per hari = (paket terjual − target) × bonus per paket, di bawah target Rp 0. Peserta (mis. host live) dipilih HR.

- **Angka dihitung server.** Browser hanya mengirim tanggal, `schemeId`, jumlah paket, keterangan, dan screenshot. Tarif dan target diambil dari sheet `BonusSchemes` lalu disalin ke laporan, sehingga perubahan tarif tidak mengubah bonus lama.
- **Hanya peserta.** Server menolak jenis paket yang nonaktif atau yang tidak mencantumkan karyawan itu (`BONUS_SCHEME_INVALID`). Karyawan yang bukan peserta tidak melihat menu Bonus, dan peserta tidak melihat daftar peserta lain.
- **Tanggal.** Hari ini sampai 7 hari ke belakang, tidak boleh tanggal mendatang. Satu laporan per jenis paket per hari; yang Ditolak boleh dikirim ulang (`BONUS_DUPLICATE`).
- **Screenshot wajib.** Berbeda dari foto absensi, screenshot memang diambil dari galeri. Browser mengecilkannya menjadi JPEG dan mengirim SHA-256 file asli. Screenshot yang sudah dipakai karyawan lain, dipakai untuk tanggal lain, atau sama dengan foto absensi/hasil kerja ditolak (`DUPLICATE_PHOTO`). Satu screenshot boleh dipakai untuk beberapa jenis paket pada tanggal yang sama oleh orang yang sama.
- **Penanda `TANPA_ABSEN`.** Laporan untuk tanggal tanpa check-in tetap diterima tetapi ditandai agar HR memeriksa.
- **Verifikasi.** Hanya HR dan Super Admin, tidak untuk laporan sendiri, penolakan wajib alasan. Hanya bonus Disetujui yang masuk rekap gaji.
- **Keterbatasan.** Angka paket ditulis oleh peserta dan screenshot dapat diedit. Server tidak membaca isi screenshot. HR wajib mencocokkan angka dengan screenshot, dan bila ragu dengan dashboard toko, sebelum menyetujui.

## 6B. Cache data

Tabel yang dibaca hampir di setiap permintaan (`Users`, `Employees`, `WorkSchedules`, `WorkLocations`, `LeaveRequests`, `Jobdesk`, `JobRates`, `BonusSchemes`, `WorkReports`, `BonusReports`) dan bagian akhir sheet `Attendance` disimpan di CacheService selama maksimal 5 menit agar aplikasi tidak membuka spreadsheet di setiap klik. Boot, status absensi, dan notifikasi yang berulang tidak membuka spreadsheet sama sekali (uji V01).

- Setiap tabel punya penanda versi (`TBLV_<nama>`) di Script Properties. Versi dibaca sebelum sheet dibaca dan diganti setelah penulisan di-flush, sehingga cache dari data lama tidak pernah dipakai setelah aplikasi menulis. Contohnya, perubahan role atau penonaktifan akun langsung berlaku (uji Q01).
- Pembacaan di dalam Script Lock (semua transaksi tulis) selalu langsung dari sheet. Contohnya, pengecekan "sudah check-in hari ini" saat absen membaca kolom kunci langsung, sehingga cache tidak membuka celah absen ganda (uji V02).
- Rekap bulanan dan daftar absensi memakai bagian akhir sheet `Attendance` hanya bila baris pertamanya terbukti lebih tua dari awal periode; selain itu seluruh sheet dibaca (uji V06).
- **Batasan:** perubahan yang diketik manual langsung di spreadsheet baru terlihat di aplikasi paling lambat **5 menit** kemudian, termasuk koreksi manual di sheet Attendance (uji V05). Untuk menonaktifkan akun secara darurat, pakai menu Pengaturan → Pengguna (langsung berlaku), bukan edit sheet.

### Cache di browser

Agar pindah halaman dan membuka ulang aplikasi terasa instan, data halaman yang pernah dibuka disimpan di browser (`sdm_cache`). Halaman tampil dari cache lalu dicocokkan dengan server di belakang (penanda "Memperbarui" di bilah atas); bila datanya berubah, halaman diganti otomatis, atau muncul tombol "Data baru · muat ulang" bila pengguna sedang mengisi formulir.

- **Tempat penyimpanan sama dengan token:** localStorage bila pengguna mencentang "ingat saya", selain itu sessionStorage (hilang saat tab ditutup).
- **Per pengguna:** cache pengguna lain di perangkat yang sama dibuang saat login.
- **Dibuang** saat keluar, saat sesi berakhir, setelah 12 jam, dan untuk domain data yang baru diubah (mis. setelah check-in, data absen, laporan, bonus, dashboard, dan rekap dibuang).
- **Tidak di-cache:** foto dan screenshot, status absensi dan sesi kamera, serta semua aksi tulis. Server tetap memeriksa sesi, role, dan cakupan data di setiap panggilan; cache hanya mempercepat tampilan.
- **Konsekuensi:** pada perangkat yang dipakai bersama, data yang pernah dibuka (termasuk rekap gaji untuk HR) tersimpan di browser sampai pengguna keluar. Minta HR dan Admin selalu menekan **Keluar** di perangkat bersama dan tidak mencentang "ingat saya".
- **Ambil sekaligus.** Setelah login, `app.prefetch` mengambil data beberapa halaman dalam satu eksekusi. Hanya aksi baca dalam daftar `PREFETCHABLE_` yang diterima, masing-masing diperiksa role-nya seperti lewat `api()` (uji V04).

## 7. Audit log

Audit log disimpan di sheet **AuditLogs** (struktur kolom ada di [DATABASE.md](DATABASE.md)).

### 7.1 Yang dicatat

| `action` | `entity` | `result` | Isi `detail` |
|---|---|---|---|
| `LOGIN` | User | SUCCESS / FAIL / DENIED | FAIL: `reason: BAD_CREDENTIALS`, `attempt`. DENIED: `reason: LOCKED` atau `INACTIVE`. Untuk FAIL/DENIED, `entityId` berisi username yang diketik. |
| `LOGOUT` | User | SUCCESS | – |
| `CHANGE_PASSWORD` | User | SUCCESS / FAIL | FAIL: `reason: BAD_OLD_PASSWORD` |
| `ACCESS_DENIED` | Route | DENIED | `entityId` berisi nama aksi |
| `SERVER_ERROR` | Route | FAIL | `message` (maks. 200 karakter) |
| `CHECKIN`, `CHECKOUT` | Attendance | SUCCESS / FAIL / DENIED | `mode`, `workDate`, `distance`, `accuracy`, ditambah `flags` (SUCCESS) atau `code` (FAIL). DENIED berarti cooldown (`RATE_LIMIT`). |
| `ATTENDANCE_EDIT` | Attendance | SUCCESS | Status dan catatan sebelum (`from`) dan sesudah (`to`) |
| `PHOTO_VIEW` | Attendance | SUCCESS / DENIED | `type`: `in` atau `out` |
| `EMPLOYEE_CREATE`, `EMPLOYEE_UPDATE` | Employee | SUCCESS | `account`: username jika akun dibuat |
| `EMPLOYEE_REMOVE` | Employee | SUCCESS | `outcome`: `deleted` atau `deactivated` |
| `EMPLOYEE_SELF_UPDATE` | Employee | SUCCESS | – |
| `JOB_CREATE`, `JOB_UPDATE`, `JOB_STATUS`, `JOB_REMOVE` | Jobdesk | SUCCESS | `employeeId` atau `status` |
| `LEAVE_SUBMIT`, `LEAVE_DECIDE`, `LEAVE_CANCEL` | LeaveRequest | SUCCESS | `jenis` dan `days`, atau `decision` |
| `RATE_CREATE`, `RATE_UPDATE`, `RATE_REMOVE` | JobRate | SUCCESS | Nama, tarif, dan status sebelum/sesudah |
| `REPORT_VERIFY` | WorkReport | SUCCESS | `decision`, jumlah laporan yang berubah |
| `SETTINGS_UPDATE` | Config | SUCCESS | `changed`: semua nilai pengaturan yang berubah |
| `SETUP`, `ADMIN_PASSWORD_RESET` | System / User | SUCCESS | Dijalankan dari editor; `username` berisi email akun yang menjalankan |
| `LOCATION_CREATE`, `LOCATION_UPDATE`, `LOCATION_REMOVE` | WorkLocation | SUCCESS | `nama`, `radius`, `status` |
| `SCHEDULE_CREATE`, `SCHEDULE_UPDATE`, `SCHEDULE_REMOVE` | WorkSchedule | SUCCESS | Data jadwal |
| `USER_CREATE`, `USER_UPDATE`, `USER_RESET_PASSWORD`, `USER_REMOVE` | User | SUCCESS | `role`, `status` |
| `RETENTION` | System | SUCCESS | `photos`, `auditRows` |

### 7.2 Yang TIDAK dicatat

- Password, baik teks maupun hash.
- Token sesi.
- Isi foto.
- Koordinat GPS. Percobaan absensi yang gagal hanya mencatat kode, jarak, dan akurasi. Koordinat absensi yang berhasil disimpan di sheet Attendance, bukan di audit log.
- Hasil pra-cek lokasi (`attendance.checkLocation`).
- Aktivitas membaca data, kecuali `PHOTO_VIEW` (foto absensi dan foto hasil kerja).
- Kegagalan yang terjadi sebelum transaksi absensi dimulai, misalnya akun tanpa data karyawan atau format nonce yang salah.
- Perubahan langsung di spreadsheet, Drive, atau Script Properties.

### 7.3 Sifat audit log

- **Upaya terbaik:** jika penulisan audit gagal, transaksi tetap berjalan, dan kegagalannya dicatat ke log Apps Script.
- **Tidak tahan modifikasi:** siapa pun yang memiliki akses edit ke spreadsheet dapat mengubah atau menghapus baris audit.
- Halaman Audit di aplikasi membaca 3.000 baris terakhir dan menampilkan paling banyak 500 hasil. Untuk penelusuran yang lebih lama, buka sheet AuditLogs langsung.
- Username yang diketik saat login gagal dicatat apa adanya. Isinya bisa berupa salah ketik, termasuk password yang tidak sengaja diketik di kolom username.

---

## 8. Retensi dan privasi data

### 8.1 Retensi otomatis

Retensi dijalankan oleh trigger harian `runRetentionCleanup` (sekitar pukul 02.00–03.00 menurut zona waktu proyek, `Asia/Jakarta`).

| Data | Default | Yang terjadi |
|---|---|---|
| Foto absensi | 365 hari (`CFG_PHOTO_RETENTION_DAYS`) | Foto dari absensi dengan tanggal kerja lebih lama dari batas dipindahkan ke **Sampah** Drive. ID foto di sheet diganti `DIHAPUS:RETENSI`, sedangkan hash tetap disimpan. Setiap eksekusi memproses maks. 300 baris absensi (≤ 600 foto). |
| Audit log | 730 hari (`CFG_AUDIT_RETENTION_DAYS`) | Baris yang lebih lama dihapus permanen dari sheet |
| Absensi, koordinat, cuti, jobdesk, karyawan, pengguna | – | **Tidak dihapus otomatis** |

- Nilai `0` mematikan retensi untuk jenis data tersebut.
- Google Drive menghapus permanen item di Sampah setelah 30 hari (kebijakan Drive saat dokumen ini ditulis). Kosongkan Sampah akun pemilik jika foto perlu hilang lebih cepat.
- Retensi tidak berjalan lebih dari sekali dalam 6 jam.

### 8.2 Data pribadi yang diproses

| Data | Lokasi |
|---|---|
| Foto wajah saat check-in dan check-out | Google Drive |
| Koordinat GPS, akurasi, dan jarak ke kantor | Sheet Attendance |
| Waktu kehadiran, keterlambatan, durasi kerja | Sheet Attendance |
| Identitas dan kontak: nama, email, nomor HP, alamat, jabatan, departemen | Sheet Employees dan Users |
| Alasan izin, sakit, dan cuti (dapat memuat informasi kesehatan) | Sheet LeaveRequests |
| Jejak aktivitas | Sheet AuditLogs |

Server hanya menerima lokasi ketika halaman absensi mengirimkannya untuk pemeriksaan lokasi atau untuk check-in/check-out. Aplikasi web ini tidak memiliki pelacakan latar belakang.

### 8.3 Kewajiban dan rekomendasi kebijakan

Foto wajah dan data lokasi termasuk data pribadi. Di Indonesia, pemrosesan data pribadi diatur oleh **Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP)**. Secara umum, undang-undang ini mengatur kewajiban pihak yang memproses data, antara lain memberi tahu subjek data, menjaga keamanan data, membatasi masa simpan, dan memenuhi hak subjek data. Dokumen ini bukan nasihat hukum. Konsultasikan kewajiban spesifik perusahaan dengan penasihat hukum atau petugas pelindungan data.

Rekomendasi:

1. **Pemberitahuan tertulis** kepada karyawan sebelum aplikasi dipakai, yang mencakup:
   - data yang dikumpulkan (lihat [8.2](#82-data-pribadi-yang-diproses)) dan tujuannya (pencatatan kehadiran),
   - kapan data diambil (hanya saat pemeriksaan lokasi dan check-in/check-out),
   - siapa yang dapat melihatnya (lihat [4.5](#45-akses-foto-photo_access_) dan [4.4](#44-cakupan-data)),
   - masa simpan,
   - kontak untuk pertanyaan atau koreksi data.
2. **Dasar pemrosesan** (misalnya persetujuan atau ketentuan dalam perjanjian kerja) ditetapkan sesuai kebijakan perusahaan.
3. **Akses minimal:** spreadsheet dan folder foto hanya dapat diakses akun pemilik. Editor proyek Apps Script dibatasi.
4. **Masa simpan:** tetapkan retensi foto sesuai kebutuhan nyata. Untuk data absensi lama (yang tidak dihapus otomatis), tetapkan kebijakan arsip, misalnya menghapus koordinat lama setelah periode tertentu (lihat DATABASE.md, bagian Arsip).
5. **Prosedur insiden** (dugaan kebocoran):
   - ganti password akun pemilik,
   - hapus semua properti `sess_*`,
   - periksa pengaturan berbagi spreadsheet dan folder,
   - periksa daftar editor proyek,
   - telusuri AuditLogs,
   - ikuti kewajiban pemberitahuan yang berlaku.
6. **Karyawan keluar:** nonaktifkan datanya. Riwayat tetap tersimpan sesuai kebijakan retensi.

---

## 9. Keterbatasan

Bagian ini sengaja ditulis lugas agar ekspektasi pengguna sesuai kenyataan.

### 9.1 Lokasi GPS dapat dipalsukan

Browser tidak dapat membuktikan bahwa koordinat berasal dari GPS asli. Aplikasi fake GPS, perangkat yang di-root atau di-jailbreak, emulator, alat developer browser, dan browser yang dimodifikasi dapat mengirim koordinat apa pun dengan akurasi yang tampak wajar. Server hanya dapat menangkap pola pemalsuan yang naif melalui flags. Mitigasinya adalah prosedur: peninjauan flags, pemeriksaan foto acak, dan verifikasi oleh atasan langsung.

### 9.2 Foto dapat dipalsukan

Nonce hanya membuktikan bahwa sesi kamera dibuka paling lama 10 menit sebelum pengiriman. Klien yang dimodifikasi dapat mengirim JPEG apa pun, misalnya foto lama, foto orang lain, atau foto dari layar. Pemeriksaan hash hanya mendeteksi file yang **identik byte demi byte**. Foto yang dipotong, dikompres ulang, atau diubah satu piksel saja menghasilkan hash yang berbeda. Server tidak memeriksa EXIF dan tidak memeriksa isi gambar.

**Mode kamera HP lebih lemah daripada kamera langsung.** Atribut `capture` hanya permintaan ke browser:
- di sebagian HP dan browser, pemilih file tetap menawarkan **galeri**, sehingga karyawan dapat memilih foto lama;
- di komputer, pemilih file selalu membuka folder;
- umur file dan hash file asli dihitung oleh perangkat, sehingga dapat dipalsukan oleh klien yang dimodifikasi.

Cap jam server dan lokasi pada foto bersifat **pencegah dan alat bantu tinjauan**, bukan bukti. Jaga dengan prosedur: HR memeriksa foto berpenanda `FOTO_LAMA`, mencocokkan latar foto dengan lokasi kerja, dan menolak laporan jobdesk yang fotonya meragukan.

### 9.3 Deteksi wajah bukan pengenalan wajah

- Mode `advisory` mengandalkan API deteksi wajah bawaan browser (FaceDetector). API ini tidak tersedia di banyak browser; dalam kondisi itu hasilnya "tidak didukung" dan tidak ada penanda yang ditambahkan.
- Deteksi hanya menjawab "ada wajah atau tidak", bukan "wajah siapa".
- Hasil deteksi dilaporkan oleh browser, sehingga dapat dipalsukan.
- Aplikasi tidak melakukan pengenalan atau pencocokan wajah.

### 9.4 CacheService bersifat upaya terbaik

Google dapat menghapus item cache sebelum masa berlakunya habis. Dampaknya:
- nonce dapat hilang sebelum 10 menit, sehingga karyawan diminta mengambil ulang foto;
- penghitung kunci login, cooldown, dan rate limit dapat ter-reset lebih awal, sehingga pembatasan-pembatasan ini tidak mutlak.

### 9.5 Batas Google Apps Script

- Satu eksekusi maksimal **6 menit**.
- Sekitar **30 eksekusi simultan** per akun. Karena semua eksekusi berjalan sebagai akun pemilik, perlakukan batas ini sebagai batas seluruh aplikasi.
- Kuota harian berbeda antara akun Google gratis dan Google Workspace. Lihat https://developers.google.com/apps-script/guides/services/quotas.
- **Script Lock memproses absensi satu per satu.** Satu transaksi absensi (membaca sheet, menyimpan foto ke Drive, menulis baris) diperkirakan memakan 1–3 detik, bergantung pada kecepatan layanan Google. Jika banyak karyawan menekan tombol pada saat yang sama, antrean dapat melebihi 20 detik dan sebagian karyawan menerima "Server sedang sibuk" sehingga harus mencoba lagi. Jendela check-in yang dibuka lebih awal (default 120 menit) membantu menyebar kedatangan.

### 9.6 Batas Google Sheets

- Satu spreadsheet maksimal **10 juta sel**, termasuk sel kosong di dalam grid.
- Banyak fungsi membaca seluruh isi sheet, sehingga aplikasi makin lambat seiring data bertambah.
- Rencanakan arsip tahunan (lihat [DATABASE.md](DATABASE.md), bagian Kapasitas dan arsip).
- Riwayat absensi dan dashboard tim hanya membaca **6.000 baris terakhir** sheet Attendance. Untuk jadwal Senin–Jumat, riwayat 93 hari mulai terpotong pada sekitar 90 karyawan, dan riwayat default 31 hari pada sekitar 270 karyawan.

### 9.7 Batas Script Properties

Kapasitas total Script Properties adalah **500 KB**. Satu sesi memakai sekitar 150–200 byte, sehingga kapasitasnya cukup untuk ribuan sesi aktif. Sesi kedaluwarsa dibersihkan setiap ada login berhasil.

### 9.8 Tidak ada transaksi atomik

Google Sheets tidak memiliki mekanisme rollback. Jika galat terjadi di tengah proses yang menulis beberapa hal, sebagian data dapat sudah tersimpan. Beberapa contoh nyata ada di [bagian 10](#10-catatan-risiko-pada-versi-100).

### 9.9 Keterbatasan fungsional yang berdampak pada data

- Tidak ada kalender hari libur.
- Rekap bulanan memakai jadwal karyawan saat ini untuk seluruh bulan, dan menghitung hari kerja sebelum aplikasi dipakai sebagai Alpha.
- HR hanya dapat mengoreksi status dan catatan absensi. Untuk menambah jam pulang yang terlewat, data harus diubah langsung di sheet, dan perubahan itu tidak tercatat di audit log.
- Satu zona waktu berlaku untuk semua lokasi.

---

## 10. Catatan risiko pada versi 1.0.0

Tinjauan kode versi 1.0.0 menemukan beberapa perilaku berisiko. Sebagian besar sudah **diperbaiki sebelum deploy pertama**, dan masing-masing dijaga oleh uji regresi:

| Temuan | Perbaikan | Uji |
|---|---|---|
| Menghapus data karyawan dapat menonaktifkan akun admin, juga oleh HR | Hanya Admin yang dapat menghapus/menonaktifkan karyawan yang tertaut ke akun admin, dan aturan "minimal satu admin aktif" berlaku | X25 |
| `runRetentionCleanup` dapat dipicu pengunjung web app | Hanya berjalan dari trigger proyek atau dari editor | X26 |
| `setup()`/`resetAdminPassword()` tidak tercatat | Dicatat sebagai `SETUP` dan `ADMIN_PASSWORD_RESET` | – |
| Data karyawan tersimpan walau username akun ditolak | Username divalidasi sebelum data apa pun ditulis | X27 |
| Galat "menonaktifkan diri sendiri" muncul setelah status tersimpan | Pemeriksaan dilakukan sebelum menulis | – |
| Karyawan dengan cuti/jobdesk dapat dihapus, lalu ID-nya dipakai ulang | Karyawan dengan riwayat absensi, izin, atau jobdesk hanya dinonaktifkan | – |
| Pembaruan baris menimpa rumus di kolom tambahan | Hanya kolom yang berubah yang ditulis | X28 |
| Penanda `FACE_NOT_DETECTED` dicatat walau fitur nonaktif | Hanya dicatat bila pemeriksaan wajah = Saran | X29 |
| Audit pengaturan tidak lengkap | Semua nilai yang berubah dicatat | X29 |
| Folder foto di Sampah Drive tetap dipakai | `setup()` membuat folder baru bila folder lama ada di Sampah | – |

Yang masih berlaku:

| Perilaku | Dampak | Langkah |
|---|---|---|
| Setiap **editor proyek** Apps Script lolos `guardEditor_` | Editor proyek dapat menjalankan `setup()`/`resetAdminPassword()` dan memperoleh akses admin (kini tercatat di AuditLogs) | Batasi editor proyek hanya untuk pemilik |
| HR tidak dapat mengoreksi jam masuk/pulang dari aplikasi | Koreksi jam harus diubah langsung di sheet, tanpa jejak audit aplikasi | Catat koreksi di kolom `note` dan log internal HR; gunakan riwayat versi Google Sheets untuk jejak perubahan |

---

## 11. Rekomendasi penguatan bertahap

### Tahap 1: sebelum go-live (konfigurasi, tanpa mengubah kode)

1. Gunakan akun pemilik khusus perusahaan dengan Verifikasi 2 Langkah.
2. Pastikan spreadsheet dan folder foto tidak dibagikan kepada siapa pun. Batasi editor proyek Apps Script.
3. Ganti password admin. Buat admin cadangan dengan username yang tidak mudah ditebak, dan simpan kredensialnya di pengelola password.
4. Gunakan radius sekecil mungkin yang masih realistis untuk gedung Anda. Pertahankan ambang akurasi GPS di 50 m atau lebih ketat.
5. Tetapkan zona waktu sebelum ada data absensi.
6. Siapkan dan sampaikan pemberitahuan privasi; tetapkan nilai retensi.
7. Jalankan daftar uji di [DEPLOYMENT.md](DEPLOYMENT.md), bagian Uji coba sebelum go-live.

### Tahap 2: operasional rutin

| Frekuensi | Kegiatan |
|---|---|
| Mingguan | Tinjau flags di daftar absensi; periksa foto secara acak dan cocokkan dengan orangnya |
| Mingguan | Tinjau AuditLogs: `LOGIN` FAIL/DENIED yang berulang, `ACCESS_DENIED`, `PHOTO_VIEW` yang tidak wajar, `SERVER_ERROR` |
| Bulanan | Periksa panel Share spreadsheet dan folder foto, daftar editor proyek, dan menu Executions (pemanggilan `setup`/`resetAdminPassword`) |
| Bulanan | Nonaktifkan akun karyawan yang sudah keluar |
| Bulanan | Cadangkan data (**File → Make a copy** atau unduh sebagai .xlsx) dan simpan secara privat |
| Tahunan | Arsipkan data; tinjau kapasitas, retensi, dan kebijakan privasi |

Pertimbangkan juga:
- akses **Anyone within domain** jika semua karyawan memiliki akun Google Workspace;
- mode pemeriksaan wajah `advisory` jika perangkat karyawan mendukungnya.

### Tahap 3: pengembangan (memerlukan developer)

1. Perbaiki perilaku di [bagian 10](#10-catatan-risiko-pada-versi-100), terutama dengan menambahkan penjaga pada `runRetentionCleanup` dan pemeriksaan role admin di jalur hapus karyawan.
2. Catat pemanggilan `setup()`/`resetAdminPassword()` dan semua perubahan pengaturan di AuditLogs.
3. Naikkan iterasi PBKDF2 setelah mengukur waktu login. Verifikasi saat ini menerima hingga 100.000 iterasi. Hash lama dapat diperbarui ketika pengguna login berikutnya (memerlukan kode tambahan).
4. Tambahkan pembatasan login global dan notifikasi ke admin saat akun terkunci.
5. Tambahkan fitur koreksi jam absensi oleh HR yang tercatat di audit log, dan kalender hari libur.
6. Tambahkan bukti kehadiran yang lebih sulit dipalsukan, misalnya kode QR dinamis yang dipindai di kantor, perangkat kios absensi di kantor, atau aplikasi native yang dapat memeriksa lokasi palsu dan integritas perangkat (misalnya Play Integrity API di Android). Cara-cara ini pun tidak menjamin 100%.
7. Pengenalan wajah di server hanya dipertimbangkan setelah kajian privasi, karena pencocokan wajah memproses data biometrik.
8. Pertimbangkan migrasi ke database terkelola jika jumlah karyawan atau volume data melampaui batas yang nyaman untuk Google Sheets.
