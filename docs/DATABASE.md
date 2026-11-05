# Struktur Data

**GGSHOPS.ID · SDM & Absensi** · versi aplikasi 1.0.0

Dokumen ini menjelaskan di mana dan bagaimana aplikasi menyimpan data: sheet di Google Sheets, Script Properties, cache sementara, dan folder foto di Google Drive. Sumber kebenarannya adalah `SCHEMA_` dan `CONFIG_DEFAULTS_` di `src/Config.js`, serta lapisan akses data di `src/Db.js`.

Dokumen terkait: [DEPLOYMENT.md](DEPLOYMENT.md) · [KEAMANAN.md](KEAMANAN.md)

## Daftar isi

1. [Gambaran umum](#1-gambaran-umum)
2. [Konvensi kolom](#2-konvensi-kolom)
3. [Aturan pemeliharaan spreadsheet](#3-aturan-pemeliharaan-spreadsheet)
4. [Sheet](#4-sheet)
5. [Nilai enum yang valid](#5-nilai-enum-yang-valid)
6. [Format ID](#6-format-id)
7. [Script Properties](#7-script-properties)
8. [Data sementara di CacheService](#8-data-sementara-di-cacheservice)
9. [Struktur folder Google Drive](#9-struktur-folder-google-drive)
10. [Kapasitas dan arsip](#10-kapasitas-dan-arsip)

---

## 1. Gambaran umum

| Penyimpanan | Isi | Cara menemukannya |
|---|---|---|
| Google Sheets | Database: 8 sheet | Script Property `SPREADSHEET_ID`. Nama default: "GGSHOPS.ID · Database SDM & Absensi" |
| Google Drive | Foto absensi (JPEG) | Script Property `PHOTO_FOLDER_ID`. Nama default: "GGSHOPS.ID · Foto Absensi (PRIVAT)" |
| Script Properties | ID rahasia, konfigurasi `CFG_*`, sesi `sess_*` | Editor Apps Script → Project Settings → Script Properties |
| CacheService | Nonce foto, penghitung login gagal, cooldown, rate limit | Tidak dapat dilihat dari antarmuka; hilang sendiri |

Relasi antar data:

```
Users.employeeId ─────────────────► Employees.employeeId   (satu akun untuk satu karyawan)
Employees.scheduleId ─────────────► WorkSchedules.scheduleId
Employees.locationIds (daftar) ───► WorkLocations.locationId
Attendance.employeeId ────────────► Employees.employeeId
Attendance.scheduleId ────────────► WorkSchedules.scheduleId
Attendance.checkIn/OutLocationId ─► WorkLocations.locationId
Attendance.checkIn/OutPhotoId ────► file JPEG di Google Drive
LeaveRequests.employeeId ─────────► Employees.employeeId
LeaveRequests.diprosesOleh ───────► Users.username
Jobdesk.employeeId ───────────────► Employees.employeeId
Jobdesk.dibuatOleh ───────────────► Users.username
AuditLogs.userId ─────────────────► Users.userId
CFG_DEFAULT_SCHEDULE_ID ──────────► WorkSchedules.scheduleId
```

Relasi ini dijaga oleh aplikasi, bukan oleh Google Sheets. Perubahan manual di sheet dapat merusaknya.

---

## 2. Konvensi kolom

### 2.1 Tipe kolom

| Kode | Tipe | Format | Contoh | Ditulis aplikasi sebagai |
|---|---|---|---|---|
| `s` | Teks | bebas | `Budi Santoso` | teks berawalan apostrof |
| `n` | Angka | angka desimal | `12.5` | angka |
| `b` | Boolean | `TRUE` / `FALSE` | `TRUE` | boolean |
| `d` | Tanggal | `yyyy-MM-dd` | `2026-10-24` | teks berawalan apostrof |
| `t` | Jam | `HH:mm` (24 jam) | `08:00` | teks berawalan apostrof |
| `dt` | Timestamp | ISO-8601 dalam **UTC** | `2026-10-24T01:05:09.123Z` | teks berawalan apostrof |

Timestamp `dt` selalu dalam UTC. Contoh: `2026-10-24T01:05:09.123Z` sama dengan 08:05:09 WIB. Untuk waktu lokal, lihat kolom `checkInLocal`, `checkOutLocal`, atau `waktuLokal`.

### 2.2 Cara aplikasi membaca dan menulis

- **Header** ada di baris 1. Aplikasi memetakan kolom berdasarkan **nama header**, bukan posisi.
- **Penulisan:** semua teks ditulis dengan awalan apostrof (`'`). Tujuannya dua: mencegah Sheets mengubah teks menjadi tanggal atau angka (misalnya `08:00` atau `081234567890`), dan mencegah teks dieksekusi sebagai formula (anti formula-injection). Apostrof tidak terlihat di sel, tetapi terlihat di bilah formula.
- **Pembacaan:** nilai dinormalkan sesuai tipe kolom. Jika sebuah sel terlanjur dikonversi Sheets menjadi tanggal (misalnya karena diedit manual), aplikasi mengubahnya kembali: kolom `d` menjadi `yyyy-MM-dd`, kolom `t` menjadi `HH:mm`, kolom `dt` menjadi ISO UTC, dan kolom `s` menjadi `yyyy-MM-dd HH:mm:ss`. Sel `n` yang kosong dibaca sebagai kosong (null). Kolom `b` bernilai benar jika isinya boolean TRUE atau teks `TRUE`.
- Baris yang seluruh selnya kosong dilewati.
- Kolom yang tidak dikenal skema dibaca sebagai teks.

---

## 3. Aturan pemeliharaan spreadsheet

**Boleh:**

- Menambah kolom baru dengan nama header yang unik. Nilainya tetap dipertahankan saat aplikasi memperbarui baris (kecuali rumus, lihat di bawah).
- Memindahkan urutan kolom.
- Memakai **Data → Filter views** untuk menyaring atau mengurutkan tampilan, karena tidak mengubah urutan data.
- Mengawali teks yang tampak seperti angka atau tanggal dengan apostrof saat mengetik manual, misalnya ID, nomor HP, dan tanggal.
- Menulis nilai enum persis seperti di [bagian 5](#5-nilai-enum-yang-valid).
- Menulis `locationIds` tanpa spasi, misalnya `LOC-A,LOC-B`.
- Membuat cadangan berkala dengan **File → Make a copy**.

**Jangan:**

- **Mengubah nama sheet atau nama header.** Aplikasi tidak lagi menemukan kolom tersebut. Contohnya, jika `Users.status` diganti nama, tidak ada yang dapat login.
- **Menaruh rumus** di kolom tambahan pada sheet aplikasi. Saat aplikasi memperbarui sebuah baris, rumus di baris itu diganti dengan nilai statisnya. Taruh rumus dan analisis di sheet terpisah.
- **Mengurutkan (Sort)** sheet Attendance atau AuditLogs. Riwayat, dashboard, dan retensi audit mengandalkan urutan baris sesuai waktu penambahan.
- Menyisipkan atau menghapus baris saat aplikasi sedang dipakai. Penyuntingan manual tidak ikut antre di Script Lock dan dapat bertabrakan dengan transaksi yang sedang berjalan. Jika perlu menyunting, lakukan di luar jam kerja.
- Mengetik nomor HP tanpa apostrof. Sheets mengubahnya menjadi angka dan angka 0 di depan hilang.
- Menulis status dengan huruf kecil, misalnya `aktif`. Untuk Users dan Employees, nilai itu dianggap tidak aktif.
- Menghapus baris Attendance yang fotonya belum dibersihkan retensi ([10.2](#102-prosedur-arsip-tahunan)).
- Membagikan spreadsheet. Sheet Users berisi hash password.

### 3.1 Perilaku `setup()` terhadap spreadsheet

- Tidak menduplikasi sheet yang sudah ada.
- Menambahkan kolom yang hilang di ujung kanan header.
- Tidak menghapus, mengganti nama, atau memindahkan kolom tambahan buatan Admin, dan tidak memindahkan data.
- Membekukan baris 1 dan mewarnai seluruh baris header, termasuk kolom tambahan.
- Menghapus sheet bawaan yang benar-benar kosong bernama `Sheet1`, `Lembar1`, atau `Sheet 1`.
- Menyetel zona waktu spreadsheet ke zona waktu aplikasi.

Jika sebuah header terlanjur diganti nama, **kembalikan nama header tersebut**. Jangan langsung menjalankan `setup()`: fungsi itu akan menambahkan kolom kosong baru bernama benar, sementara data lama tetap berada di kolom yang diganti nama.

---

## 4. Sheet

### 4.1 Users

Akun login aplikasi. Satu baris untuk satu akun.

| Kolom | Tipe | Arti | Contoh |
|---|---|---|---|
| `userId` | s | ID akun, dibuat sistem | `USR-3F9A0C12BE` |
| `username` | s | Nama login; huruf kecil, 3–30 karakter (`a-z 0-9 . _ -`); unik; tidak dapat diubah lewat aplikasi | `budi.santoso` |
| `passwordHash` | s | Hash PBKDF2: `pbkdf2$<iterasi>$<salt base64>$<hash base64>`. Jangan disunting. | `pbkdf2$1000$Qm9u…==$4f0a…=` |
| `role` | s | `admin` (Super Admin), `hr`, atau `karyawan`. Nilai lain, termasuk `manager` lama, berlaku sebagai `karyawan` | `karyawan` |
| `employeeId` | s | Tautan ke `Employees.employeeId`. Kosong untuk akun tanpa data karyawan, misalnya admin awal. | `K001` |
| `nama` | s | Nama tampilan, dipakai jika akun tidak terhubung ke data karyawan | `Administrator` |
| `email` | s | Email kontak; tidak dipakai untuk login | `budi@contoh.co.id` |
| `status` | s | `Aktif` atau `Nonaktif`. Hanya nilai `Aktif` persis yang dapat login. | `Aktif` |
| `mustChangePassword` | b | `TRUE` berarti password masih sementara dan wajib diganti | `TRUE` |
| `lastLoginAt` | dt | Waktu login berhasil terakhir | `2026-10-24T00:58:12.345Z` |
| `createdAt` | dt | Waktu akun dibuat | `2026-10-01T03:00:00.000Z` |
| `updatedAt` | dt | Waktu perubahan terakhir | `2026-10-24T00:58:12.345Z` |

### 4.2 Employees

Data karyawan. Satu baris untuk satu karyawan.

| Kolom | Tipe | Arti | Contoh |
|---|---|---|---|
| `employeeId` | s | ID karyawan, dibuat otomatis berurutan | `K001` |
| `nama` | s | Nama lengkap (wajib, maks. 80 karakter) | `Budi Santoso` |
| `email` | s | Email (opsional, divalidasi formatnya) | `budi@contoh.co.id` |
| `noHp` | s | Nomor HP: angka, spasi, `+`, atau `-` (6–20 karakter); disimpan sebagai teks | `081234567890` |
| `jabatan` | s | Maks. 60 karakter | `Staf Gudang` |
| `departemen` | s | Maks. 60 karakter. Dasar jobdesk bertarif per departemen; tulis konsisten (huruf besar-kecil berpengaruh). | `Gudang` |
| `alamat` | s | Maks. 200 karakter; dapat diubah karyawan sendiri | `Jl. Contoh No. 1` |
| `tanggalBergabung` | d | Tanggal mulai bekerja. Rekap tidak menghitung hari sebelum tanggal ini. | `2025-03-01` |
| `scheduleId` | s | Tidak dipakai sejak versi 11 (jam kerja bebas). Nilai lama dibiarkan. | |
| `locationIds` | s | Daftar lokasi kerja yang diizinkan, dipisah koma tanpa spasi. Kosong berarti semua lokasi aktif. | `LOC-7C1E9A0B3D,LOC-22F0A9C4E1` |
| `status` | s | `Aktif` atau `Nonaktif`. Hanya `Aktif` persis yang dapat absen dan mengajukan cuti. | `Aktif` |
| `createdAt` | dt | Waktu data dibuat | |
| `updatedAt` | dt | Waktu perubahan terakhir | |

### 4.3 Attendance

Satu baris untuk satu karyawan per tanggal kerja. Check-in membuat baris baru; check-out memperbarui baris yang sama. Aplikasi tidak pernah menghapus baris di sheet ini.

| Kolom | Tipe | Arti | Contoh |
|---|---|---|---|
| `attendanceId` | s | ID absensi | `ABS-20261024-9F3C2A1B` |
| `key` | s | Kunci unik `employeeId\|workDate`, dijaga aplikasi | `K001\|2026-10-24` |
| `employeeId` | s | Karyawan | `K001` |
| `workDate` | d | Tanggal kerja. Untuk shift lintas tengah malam, tanggal kerja adalah tanggal jam masuk. | `2026-10-24` |
| `scheduleId` | s | Kosong sejak versi 11 (jam kerja bebas); berisi jadwal lama pada catatan sebelumnya | |
| `status` | s | Diisi otomatis `Hadir` atau `Terlambat`; dapat dikoreksi HR | `Terlambat` |
| `lateMinutes` | n | Menit terlambat, dihitung dari jam masuk (bukan dari akhir toleransi). 0 jika Hadir. | `20` |
| `checkInAt` | dt | Waktu server saat permintaan check-in diterima | `2026-10-24T01:20:04.512Z` |
| `checkInLocal` | s | Waktu yang sama dalam zona waktu aplikasi saat transaksi | `2026-10-24 08:20:04` |
| `checkInPhotoId` | s | ID file foto di Drive. Berisi `DIHAPUS:RETENSI` setelah dibersihkan retensi. | `1AbC…xyz` |
| `checkInPhotoHash` | s | SHA-256 isi file foto (64 karakter heksa); untuk mendeteksi foto yang dipakai ulang | `9b1d…e3a0` |
| `checkInLat` | n | Latitude yang dilaporkan perangkat | `-6.20871234` |
| `checkInLng` | n | Longitude yang dilaporkan perangkat | `106.84561234` |
| `checkInAccuracy` | n | Akurasi yang dilaporkan perangkat (meter, 1 desimal) | `12.3` |
| `checkInDistance` | n | Jarak ke titik lokasi terpilih, dihitung server (meter, 1 desimal) | `38.7` |
| `checkInLocationId` | s | Lokasi kerja yang dipakai | `LOC-7C1E9A0B3D` |
| `checkOutAt` | dt | Waktu server saat check-out diterima. Kosong jika belum check-out. | `2026-10-24T10:02:41.007Z` |
| `checkOutLocal` | s | Waktu lokal check-out | `2026-10-24 17:02:41` |
| `checkOutPhotoId` | s | ID file foto check-out | |
| `checkOutPhotoHash` | s | SHA-256 foto check-out. Untuk foto dari kamera HP: SHA-256 file asli yang dipilih (sama untuk `checkInPhotoHash`) | |
| `checkOutLat` | n | Latitude saat check-out | |
| `checkOutLng` | n | Longitude saat check-out | |
| `checkOutAccuracy` | n | Akurasi saat check-out (meter) | |
| `checkOutDistance` | n | Jarak saat check-out (meter) | |
| `checkOutLocationId` | s | Lokasi saat check-out | |
| `checkOutStatus` | s | `Normal`, `Pulang Cepat`, atau kosong jika belum check-out | `Normal` |
| `earlyMinutes` | n | Menit lebih awal dari jam pulang (untuk Pulang Cepat) | `0` |
| `workMinutes` | n | Durasi kerja bersih dalam menit, dikurangi jam istirahat yang beririsan | `462` |
| `flags` | s | Penanda kewajaran, dipisah koma, berawalan `IN:` atau `OUT:` | `IN:LOW_PRECISION` |
| `note` | s | Catatan karyawan (maks. 200 karakter per transaksi; catatan check-out ditambahkan dengan pemisah ` \| `). HR dapat mengganti seluruh isinya (maks. 300 karakter). | `Rapat di luar` |
| `createdAt` | dt | Waktu baris dibuat (sama dengan `checkInAt`) | |
| `updatedAt` | dt | Waktu perubahan terakhir | |
| `updatedBy` | s | `userId` terakhir yang mengubah baris (karyawan sendiri atau HR) | `USR-3F9A0C12BE` |

Arti setiap penanda di `flags` dijelaskan di [KEAMANAN.md](KEAMANAN.md), bagian Penanda kewajaran.

### 4.4 WorkLocations

Titik lokasi kerja beserta radius.

| Kolom | Tipe | Arti | Contoh |
|---|---|---|---|
| `locationId` | s | ID lokasi | `LOC-7C1E9A0B3D` |
| `nama` | s | Nama lokasi (wajib, maks. 80 karakter) | `Kantor Pusat` |
| `alamat` | s | Maks. 200 karakter | `Jl. Contoh No. 1, Jakarta` |
| `latitude` | n | −90 sampai 90, disimpan hingga 7 desimal | `-6.2087634` |
| `longitude` | n | −180 sampai 180, disimpan hingga 7 desimal | `106.8455990` |
| `radius` | n | Radius dalam meter, bilangan bulat 10–5000. Lokasi dengan radius kosong atau 0 diabaikan. | `100` |
| `status` | s | `Aktif` atau `Nonaktif`. Nilai apa pun selain `Nonaktif` dianggap aktif. | `Aktif` |
| `createdAt` | dt | | |
| `updatedAt` | dt | | |

### 4.5 WorkSchedules

Arsip jadwal kerja lama. **Tidak dipakai sejak versi 11**: karyawan bebas check-in dan check-out kapan saja (lihat [KEAMANAN.md](KEAMANAN.md) 5.5).

| Kolom | Tipe | Arti | Contoh |
|---|---|---|---|
| `scheduleId` | s | ID jadwal | `JDW-5A0C3E9F12` |
| `nama` | s | Nama jadwal (wajib, maks. 60 karakter) | `Reguler (Senin–Jumat)` |
| `jamMasuk` | t | Jam masuk | `08:00` |
| `jamPulang` | t | Jam pulang. Jika lebih kecil atau sama dengan jam masuk, jadwal dianggap shift lintas tengah malam. | `17:00` |
| `toleransiMenit` | n | Menit setelah jam masuk sebelum dihitung terlambat (0–240) | `15` |
| `istirahatMulai` | t | Awal istirahat; diisi berpasangan dengan `istirahatSelesai` atau keduanya kosong | `12:00` |
| `istirahatSelesai` | t | Akhir istirahat | `13:00` |
| `bukaCheckInMenit` | n | Berapa menit sebelum jam masuk check-in dibuka (0–720; jika kosong dianggap 120) | `120` |
| `batasCheckOutMenit` | n | Berapa menit setelah jam pulang check-out ditutup (0–1080; jika kosong dianggap 360) | `360` |
| `hariKerja` | s | Hari kerja ISO dipisah koma: 1 = Senin … 7 = Minggu. Jika kosong atau tidak valid, dianggap Senin–Jumat. | `1,2,3,4,5` |
| `status` | s | `Aktif` atau `Nonaktif`. Nilai apa pun selain `Nonaktif` dianggap aktif. | `Aktif` |
| `createdAt` | dt | | |
| `updatedAt` | dt | | |

Saat disimpan lewat aplikasi, jumlah `bukaCheckInMenit` + durasi shift + `batasCheckOutMenit` harus kurang dari 24 jam. Penyuntingan manual di sheet tidak melewati pemeriksaan ini.

### 4.6 LeaveRequests

Pengajuan izin, sakit, cuti, dan dinas luar.

| Kolom | Tipe | Arti | Contoh |
|---|---|---|---|
| `leaveId` | s | ID pengajuan | `LV-1B2C3D4E5F` |
| `employeeId` | s | Karyawan yang mengajukan | `K001` |
| `jenis` | s | `Izin`, `Sakit`, `Cuti`, atau `Dinas Luar` | `Sakit` |
| `tanggalMulai` | d | Paling lama 7 hari sebelum tanggal pengajuan | `2026-10-27` |
| `tanggalSelesai` | d | Tidak boleh sebelum `tanggalMulai`; maks. 30 hari per pengajuan | `2026-10-28` |
| `alasan` | s | Wajib, maks. 300 karakter. Dapat memuat informasi kesehatan. | `Demam` |
| `status` | s | `Menunggu`, `Disetujui`, `Ditolak`, atau `Dibatalkan` | `Menunggu` |
| `diajukanAt` | dt | Waktu pengajuan (waktu server) | |
| `diprosesOleh` | s | **Username** yang menyetujui atau menolak. Kosong jika dibatalkan sendiri oleh karyawan. | `hr.rina` |
| `diprosesAt` | dt | Waktu diproses atau dibatalkan | |
| `catatan` | s | Catatan pemroses (maks. 300 karakter) | `Lampirkan surat dokter` |

Aplikasi menolak pengajuan baru jika rentang tanggalnya beririsan dengan pengajuan lain milik karyawan yang sama yang berstatus Menunggu atau Disetujui. Cuti yang sudah disetujui memblokir check-in pada tanggal tersebut.

### 4.7 Jobdesk

Tugas karyawan.

| Kolom | Tipe | Arti | Contoh |
|---|---|---|---|
| `jobId` | s | ID tugas | `JOB-0A9B8C7D6E` |
| `employeeId` | s | Karyawan yang ditugaskan | `K001` |
| `judul` | s | Wajib, maks. 120 karakter | `Stok opname rak A` |
| `deskripsi` | s | Maks. 1000 karakter | |
| `deadline` | d | Opsional | `2026-10-31` |
| `prioritas` | s | `Rendah`, `Sedang`, atau `Tinggi` (default `Sedang`) | `Tinggi` |
| `status` | s | `Pending`, `In Progress`, atau `Selesai` (default `Pending`) | `In Progress` |
| `dibuatOleh` | s | **Username** pembuat tugas | `mgr.andi` |
| `createdAt` | dt | | |
| `updatedAt` | dt | | |

### 4.8 AuditLogs

Jejak aktivitas. Daftar nilai `action` beserta isi `detail`-nya ada di [KEAMANAN.md](KEAMANAN.md), bagian Audit log.

| Kolom | Tipe | Arti | Contoh |
|---|---|---|---|
| `logId` | s | ID log (16 karakter heksa) | `3f9a0c12be4d5e6f` |
| `timestamp` | dt | Waktu kejadian (UTC) | `2026-10-24T01:20:05.101Z` |
| `waktuLokal` | s | Waktu kejadian dalam zona waktu aplikasi | `2026-10-24 08:20:05` |
| `userId` | s | Pelaku. Kosong untuk login gagal dan proses sistem. | `USR-3F9A0C12BE` |
| `username` | s | Username pelaku, atau username yang diketik saat login gagal | `budi.santoso` |
| `role` | s | Role pelaku saat kejadian | `karyawan` |
| `action` | s | Jenis aksi | `CHECKIN` |
| `entity` | s | Jenis objek: `User`, `Route`, `Attendance`, `Employee`, `LeaveRequest`, `Jobdesk`, `Report`, `Config`, `WorkLocation`, `WorkSchedule`, atau `System` | `Attendance` |
| `entityId` | s | ID objek | `ABS-20261024-9F3C2A1B` |
| `result` | s | `SUCCESS`, `FAIL`, atau `DENIED` | `SUCCESS` |
| `detail` | s | JSON ringkas, maks. 1000 karakter | `{"mode":"checkin","workDate":"2026-10-24","distance":38.7,"accuracy":12.3,"flags":[]}` |

Baris yang lebih tua dari `CFG_AUDIT_RETENTION_DAYS` (default 730 hari) dihapus otomatis dari atas sheet.

---

### 4.9 JobRates

Daftar jobdesk berbayar. Tarif tetap per laporan; satu jobdesk dibayar sekali per hari kerja.

| Kolom | Tipe | Arti | Contoh |
|---|---|---|---|
| `rateId` | s | ID unik | `TRF-1A2B3C4D5E` |
| `nama` | s | Nama jobdesk (unik per departemen) | `Packing pesanan` |
| `deskripsi` | s | Penjelasan singkat | `Kemas & beri label pesanan hari itu` |
| `tarif` | n | Bayaran per laporan (Rp, bilangan bulat) | `50000` |
| `departemen` | s | Kosong = berlaku untuk semua departemen | `Gudang` |
| `status` | s | `Aktif` / `Nonaktif` | `Aktif` |
| `createdAt`, `updatedAt` | dt | Waktu dibuat/diubah (UTC) | |

### 4.10 WorkReports

Laporan jobdesk yang dibuat server saat check-out. Satu baris per jobdesk yang dipilih.

| Kolom | Tipe | Arti | Contoh |
|---|---|---|---|
| `reportId` | s | ID unik | `LPK-9F8E7D6C5B` |
| `attendanceId` | s | Absensi asal (Attendance) | `ABS-20261026-…` |
| `employeeId` | s | Karyawan | `K001` |
| `workDate` | d | Tanggal kerja | `2026-10-26` |
| `rateId` | s | Jobdesk (kosong bila belum ada tarif) | `TRF-…` |
| `namaJobdesk` | s | Salinan nama saat dilaporkan | `Packing pesanan` |
| `tarif` | n | Salinan tarif saat dilaporkan (Rp) | `50000` |
| `keterangan` | s | Tulisan karyawan tentang pekerjaannya | `Packing 40 pesanan Shopee` |
| `photoId` | s | ID file foto hasil kerja di Drive | |
| `photoHash` | s | SHA-256 foto (mencegah foto dipakai ulang). Untuk foto dari kamera HP: SHA-256 file asli | |
| `status` | s | `Menunggu` / `Disetujui` / `Ditolak` | `Menunggu` |
| `diverifikasiOleh` | s | Username pemverifikasi | `rina` |
| `diverifikasiAt` | dt | Waktu verifikasi (UTC) | |
| `catatanVerifikasi` | s | Alasan penolakan atau catatan | |
| `createdAt`, `updatedAt` | dt | Waktu dibuat/diubah (UTC) | |
| `flags` | s | Penanda foto hasil kerja, dipisah koma: `LAMPIRAN`, `FOTO_LAMA` | `LAMPIRAN` |

Gaji jobdesk pada suatu rentang = jumlah `tarif` baris berstatus `Disetujui` dengan `workDate` di rentang itu. Kedua sheet dibuat otomatis saat pertama dipakai.

### 4.11 BonusSchemes

Jenis paket bonus penjualan (mis. untuk host live). Dikelola HR di **Gaji → Bonus**.

| Kolom | Tipe | Arti | Contoh |
|---|---|---|---|
| `schemeId` | s | ID unik | `PKT-4D3C2B1A09` |
| `nama` | s | Nama jenis paket, unik di antara yang aktif | `Paket Reguler` |
| `deskripsi` | s | Penjelasan singkat | `Paket harga di bawah Rp 100.000` |
| `tarif` | n | Bonus per paket di atas target (Rp, bilangan bulat) | `500` |
| `target` | n | Target minimal paket per hari | `40` |
| `peserta` | s | `employeeId` peserta, dipisah koma. Hanya mereka yang melihat menu Bonus dan dapat melapor | `K003,K007` |
| `status` | s | `Aktif` / `Nonaktif` | `Aktif` |
| `createdAt`, `updatedAt` | dt | Waktu dibuat/diubah (UTC) | |

### 4.12 BonusReports

Laporan penjualan: satu baris per jenis paket per hari per peserta. Bonus = `max(0, jumlah − target) × tarif`, dihitung server.

| Kolom | Tipe | Arti | Contoh |
|---|---|---|---|
| `bonusId` | s | ID unik | `BON-1A2B3C4D5E` |
| `batchId` | s | Satu kiriman (beberapa jenis paket dengan satu screenshot) | `BNS-9F8E7D6C5B` |
| `employeeId` | s | Peserta | `K003` |
| `workDate` | d | Tanggal penjualan (hari ini s/d 7 hari ke belakang) | `2026-10-26` |
| `schemeId`, `namaSkema` | s | Jenis paket dan salinan namanya | `PKT-…`, `Paket Reguler` |
| `tarif`, `target` | n | Salinan bonus per paket dan target saat dilaporkan | `500`, `40` |
| `jumlah` | n | Paket terjual yang ditulis peserta | `100` |
| `paketBonus` | n | Paket di atas target | `60` |
| `nominal` | n | Bonus (Rp) | `30000` |
| `keterangan` | s | Catatan peserta, mis. jam live | `Live TikTok 19.00–23.00` |
| `photoId` | s | ID file screenshot di Drive | |
| `photoHash` | s | SHA-256 file screenshot asli (mencegah dipakai ulang) | |
| `status` | s | `Menunggu` / `Disetujui` / `Ditolak` | `Menunggu` |
| `diverifikasiOleh`, `diverifikasiAt`, `catatanVerifikasi` | s / dt / s | Verifikasi HR | |
| `createdAt`, `updatedAt` | dt | Waktu dibuat/diubah (UTC) | |
| `flags` | s | `TANPA_ABSEN` bila tidak ada check-in di tanggal itu | |

Gaji total pada suatu rentang = gaji jobdesk + jumlah `nominal` BonusReports berstatus `Disetujui` di rentang itu. Kedua sheet dibuat otomatis saat pertama dipakai.

## 5. Nilai enum yang valid

Semua nilai berikut peka huruf besar-kecil.

| Kolom | Nilai valid | Catatan |
|---|---|---|
| `Users.role` | `admin`, `hr`, `karyawan` | `manager` sudah dihapus; nilai lain diperlakukan sebagai `karyawan` |
| `Users.status` | `Aktif`, `Nonaktif` | Hanya `Aktif` yang dapat login |
| `Employees.status` | `Aktif`, `Nonaktif` | Hanya `Aktif` yang dapat absen dan mengajukan cuti |
| `WorkLocations.status`, `WorkSchedules.status` | `Aktif`, `Nonaktif` | Nilai apa pun selain `Nonaktif` dianggap aktif |
| `Attendance.status` | `Hadir`, `Terlambat`, `Izin`, `Sakit`, `Cuti`, `Dinas Luar`, `Alpha` | `Hadir`/`Terlambat` diisi otomatis; nilai lain berasal dari koreksi HR |
| `Attendance.checkOutStatus` | `Normal`, `Pulang Cepat`, atau kosong | |
| `Attendance.flags` | `ACC_SUSPICIOUS`, `EXACT_OFFICE_COORD`, `LOW_PRECISION`, `IMPOSSIBLE_TRAVEL`, `FACE_NOT_DETECTED`, `LAMPIRAN`, `FOTO_LAMA` | Masing-masing berawalan `IN:` atau `OUT:` |
| `WorkReports.flags` | `LAMPIRAN`, `FOTO_LAMA` | Tanpa awalan |
| `BonusReports.status` | `Menunggu`, `Disetujui`, `Ditolak` | Laporan Ditolak boleh dikirim ulang untuk tanggal & jenis paket yang sama |
| `BonusReports.flags` | `TANPA_ABSEN` | |
| `BonusSchemes.status` | `Aktif`, `Nonaktif` | Jenis paket yang sudah dilaporkan tidak dihapus, hanya dinonaktifkan |
| `Attendance.checkInPhotoId`, `checkOutPhotoId` | ID file Drive, atau nilai berawalan `DIHAPUS` | Nilai apa pun yang berawalan `DIHAPUS` dianggap foto terhapus |
| `LeaveRequests.jenis` | `Izin`, `Sakit`, `Cuti`, `Dinas Luar` | |
| `LeaveRequests.status` | `Menunggu`, `Disetujui`, `Ditolak`, `Dibatalkan` | |
| `Jobdesk.prioritas` | `Rendah`, `Sedang`, `Tinggi` | |
| `Jobdesk.status` | `Pending`, `In Progress`, `Selesai` | |
| `AuditLogs.result` | `SUCCESS`, `FAIL`, `DENIED` | |
| `WorkSchedules.hariKerja` | angka 1–7 dipisah koma | 1 = Senin, 7 = Minggu |

Jika Anda menghapus sebuah foto secara manual dari Drive, isi kolom ID foto yang bersangkutan dengan `DIHAPUS:MANUAL`. Dengan begitu aplikasi menampilkannya sebagai foto terhapus, bukan sebagai galat.

---

## 6. Format ID

| ID | Format | Contoh |
|---|---|---|
| `userId` | `USR-` + 10 karakter heksa kapital | `USR-3F9A0C12BE` |
| `employeeId` | `K` + nomor urut 3 digit (`K001`–`K999`), lalu `K1000` dan seterusnya | `K001` |
| `attendanceId` | `ABS-` + tanggal kerja `yyyyMMdd` + `-` + 8 karakter heksa kapital | `ABS-20261024-9F3C2A1B` |
| `locationId` | `LOC-` + 10 karakter heksa kapital | `LOC-7C1E9A0B3D` |
| `scheduleId` | `JDW-` + 10 karakter heksa kapital | `JDW-5A0C3E9F12` |
| `leaveId` | `LV-` + 10 karakter heksa kapital | `LV-1B2C3D4E5F` |
| `jobId` | `JOB-` + 10 karakter heksa kapital | `JOB-0A9B8C7D6E` |
| `schemeId` | `PKT-` + 10 karakter heksa kapital | `PKT-4D3C2B1A09` |
| `bonusId` / `batchId` | `BON-` / `BNS-` + 10 karakter heksa kapital | `BON-1A2B3C4D5E` |
| `logId` | 16 karakter heksa huruf kecil | `3f9a0c12be4d5e6f` |
| `Attendance.key` | `employeeId\|workDate` | `K001\|2026-10-24` |

`employeeId` baru = nomor terbesar yang pernah dipakai + 1. Nomor terbesar diambil dari Script Property `EMP_SEQ` dan dari kolom `employeeId` di Employees, Users, Attendance, LeaveRequests, Jobdesk, WorkReports, dan BonusReports, sehingga nomor karyawan yang sudah dihapus tidak pernah dipakai ulang (riwayatnya tidak menempel ke karyawan baru).

---

## 7. Script Properties

Lokasi: editor Apps Script → **Project Settings → Script Properties**.

| Properti | Isi | Default | Rentang / nilai valid |
|---|---|---|---|
| `SPREADSHEET_ID` | ID spreadsheet database | diisi `setup()`, atau diisi manual sebelum `setup()` | – |
| `PHOTO_FOLDER_ID` | ID folder foto | diisi `setup()`, atau diisi manual sebelum `setup()` | – |
| `CFG_COMPANY_NAME` | Nama perusahaan | `GGSHOPS.ID` | maks. 80 karakter |
| `CFG_COMPANY_ADDRESS` | Alamat perusahaan | kosong | maks. 200 karakter |
| `CFG_COMPANY_PHONE` | Telepon perusahaan | kosong | format nomor HP |
| `CFG_COMPANY_EMAIL` | Email perusahaan | kosong | format email |
| `CFG_TIMEZONE` | Zona waktu aplikasi | `Asia/Jakarta` | salah satu dari 20 zona di bawah |
| `CFG_GPS_MAX_ACCURACY_M` | Ambang akurasi GPS (m) | `50` | 5–1000 |
| `CFG_DEFAULT_RADIUS_M` | Radius awal di formulir lokasi (m) | `100` | 10–5000 |
| `CFG_DEFAULT_SCHEDULE_ID` | Jadwal default | kosong, lalu diisi `setup()` | `scheduleId` yang ada |
| `CFG_ALLOW_NON_WORKDAY` | Izinkan absen di luar hari kerja | `false` | `true` / `false` |
| `CFG_ALLOW_EARLY_CHECKOUT` | Izinkan pulang lebih awal | `true` | `true` / `false` |
| `CFG_FACE_CHECK` | Mode pemeriksaan wajah | `off` | `off` / `advisory` |
| `CFG_ALLOW_PHOTO_UPLOAD` | Izinkan foto dari kamera HP (input file) bila kamera langsung diblokir | `true` | `true` / `false` |
| `CFG_PHOTO_RETENTION_DAYS` | Retensi foto (hari) | `365` | 0–3650; 0 = tidak dihapus |
| `CFG_AUDIT_RETENTION_DAYS` | Retensi audit log (hari) | `730` | 0–3650; 0 = tidak dihapus |
| `sess_<64 heksa>` | Sesi login. Nama properti adalah hash SHA-256 token. | dibuat saat login | JSON `{"u":userId,"c":dibuat,"s":terakhirDipakai,"h":sidikJariPassword}`, waktu dalam epoch milidetik |

Zona waktu yang diterima: `Asia/Jakarta`, `Asia/Pontianak`, `Asia/Makassar`, `Asia/Jayapura`, `Asia/Singapore`, `Asia/Kuala_Lumpur`, `Asia/Bangkok`, `Asia/Ho_Chi_Minh`, `Asia/Manila`, `Asia/Hong_Kong`, `Asia/Tokyo`, `Asia/Seoul`, `Asia/Kolkata`, `Asia/Dubai`, `Asia/Riyadh`, `Australia/Perth`, `Australia/Sydney`, `Europe/London`, `Europe/Amsterdam`, `UTC`.

Catatan:

- Ubah nilai `CFG_*` lewat menu Pengaturan di aplikasi. Perubahan itu divalidasi dan tercatat di audit log; penyuntingan langsung di Script Properties tidak.
- Nilai `CFG_*` yang kosong atau tidak valid otomatis diganti nilai default, atau dibatasi ke rentang yang sah. Contoh: `2000` pada `CFG_GPS_MAX_ACCURACY_M` dibaca sebagai 1000; zona waktu yang tidak ada di daftar dibaca sebagai `Asia/Jakarta`.
- Perubahan Script Properties berlaku pada permintaan berikutnya, tanpa perlu deploy ulang.
- Jangan menyunting properti `sess_*`. Menghapus semuanya membuat semua pengguna keluar.
- Properti `TBLV_<Sheet>` adalah penanda versi cache tabel. Aplikasi menggantinya setiap kali menulis ke sheet tersebut. Menghapusnya aman: cache hanya dibangun ulang.
- Kapasitas total Script Properties adalah 500 KB.

---

## 8. Data sementara di CacheService

Data ini tidak terlihat di antarmuka Google, hilang dengan sendirinya, dan dapat terhapus lebih awal oleh Google.

| Kunci | Isi | Masa berlaku |
|---|---|---|
| `nonce_<32 heksa>` | Sesi kamera: `userId`, aksi, waktu server | 600 detik |
| `tbl_<Sheet>` dan `tbl_<Sheet>_<versi>_<n>` | Salinan tabel (Users, Employees, WorkSchedules, WorkLocations, LeaveRequests, Jobdesk, JobRates, BonusSchemes, WorkReports, BonusReports) dalam potongan 45.000 karakter; tabel di atas ±1,8 MB tidak di-cache | 300 detik |
| `tail_Attendance_<n>` dan `tail_Attendance_<n>_<versi>_<i>` | Salinan <n> baris terakhir sheet Attendance | 300 detik |
| `lf_<32 heksa>` | Jumlah login gagal untuk satu username (kunci berasal dari hash username) | 900 detik sejak kegagalan terakhir |
| `cd_<userId>` | Cooldown pengiriman absensi | 4 detik |
| `rl_nb_<userId>` | Penghitung pembukaan sesi kamera (batas 30) | 600 detik sejak permintaan terakhir |
| `rl_cl_<userId>` | Penghitung pra-cek lokasi (batas 60) | 600 detik sejak permintaan terakhir |
| `rl_lv_<userId>` | Penghitung pengajuan cuti (batas 10) | 3600 detik sejak permintaan terakhir |
| `retention_ran` | Penanda bahwa retensi sudah berjalan | 21600 detik (6 jam) |

Penghitung `rl_*` dan `lf_*` diperpanjang setiap ada permintaan baru, sehingga baru kembali ke nol setelah jendela waktunya berlalu tanpa permintaan.

---

## 9. Struktur folder Google Drive

```
GGSHOPS.ID · Foto Absensi (PRIVAT)/                 ← PHOTO_FOLDER_ID (folder root, privat)
├── 2026-10/                                        ← subfolder per bulan (yyyy-MM dari tanggal kerja)
│   ├── 2026-10-24_K001_masuk_ABS-20261024-9F3C2A1B.jpg
│   ├── 2026-10-24_K001_pulang_ABS-20261024-9F3C2A1B.jpg
│   └── …
└── 2026-11/
    └── …
```

- **Nama file:** `<tanggal kerja>_<employeeId>_<masuk|pulang|jobdesk>_<attendanceId>.jpg`, atau `<tanggal penjualan>_<employeeId>_bonus_<batchId>.jpg` untuk screenshot bonus. Foto check-out shift malam memakai tanggal kerja check-in, sehingga berada di folder bulan yang sama dengan foto check-in-nya.
- **Deskripsi file:** `Foto absensi <masuk|pulang> · <employeeId> · diterima server <timestamp ISO> · sha256 <hash>`.
- **Pemilik file:** akun pemilik skrip. File baru mewarisi izin folder induk; selama folder root privat, foto juga privat.
- **Nama folder root** diambil dari nama perusahaan saat `setup()` dijalankan. Folder root boleh diganti nama atau dipindahkan di dalam Drive yang sama, karena aplikasi menemukannya lewat ID.
- **Subfolder bulan** dicari berdasarkan **nama**. Jika Anda mengganti nama subfolder, aplikasi akan membuat subfolder baru dengan nama `yyyy-MM` untuk foto berikutnya.
- **Jangan menghapus folder root.** Jika terlanjur terhapus, pulihkan dari Sampah Drive.
- **Retensi** memindahkan foto lama ke Sampah. Subfolder bulan yang menjadi kosong tidak dihapus otomatis.
- **Jangan membagikan** folder root maupun subfolder. `setup()` hanya mematikan berbagi via tautan; orang yang ditambahkan langsung lewat panel Share tetap memiliki akses.

---

## 10. Kapasitas dan arsip

### 10.1 Perkiraan pertumbuhan

Batas Google Sheets adalah 10 juta sel per spreadsheet, termasuk sel kosong di dalam grid. Contoh perkiraan dengan asumsi 100 karyawan, 22 hari kerja per bulan, dan sekitar 4 entri audit per karyawan per hari kerja (login, check-in, check-out, aktivitas lain):

| Sheet | Kolom | Baris per tahun | Sel per tahun |
|---|---|---|---|
| Attendance | 33 | ≈ 26.400 | ≈ 0,87 juta |
| AuditLogs | 11 | ≈ 105.600 | ≈ 1,16 juta (dengan retensi 730 hari, stabil di sekitar 2,3 juta) |
| Sheet lain | – | kecil | kecil |

Dengan asumsi ini, total sel mencapai sekitar 5 juta pada tahun ketiga. Hitung ulang dengan jumlah karyawan Anda. Seiring data bertambah, aplikasi juga makin lambat, karena banyak fungsi membaca seluruh sheet.

### 10.2 Prosedur arsip tahunan

Lakukan di luar jam kerja dan umumkan sebelumnya.

1. **Buat salinan:** **File → Make a copy**, beri nama misalnya "Arsip Absensi s.d. 2026", dan simpan secara privat. Hapus sheet Users dari salinan arsip karena berisi hash password, atau pastikan salinan tetap privat.
2. **Attendance:** di spreadsheet aktif, hapus baris **paling atas** (paling lama) yang memenuhi dua syarat sekaligus:
   - tanggal kerjanya masuk periode yang diarsipkan, dan
   - kolom foto-nya sudah berisi `DIHAPUS:…`, artinya sudah lebih tua dari retensi foto.

   Alasannya: retensi menemukan foto melalui baris Attendance. Jika baris dihapus sebelum fotonya dibersihkan, foto itu tertinggal di Drive dan tidak pernah terhapus otomatis.
3. Hapus dari atas ke bawah secara berurutan. Jangan mengurutkan ulang sheet.
4. **LeaveRequests dan Jobdesk:** baris lama yang sudah selesai (Disetujui, Ditolak, Dibatalkan, Selesai) boleh dihapus jika tidak diperlukan lagi.
5. **AuditLogs:** dibersihkan otomatis oleh retensi.
6. **Jangan menghapus** baris Employees, Users, WorkLocations, maupun WorkSchedules yang masih dirujuk data aktif.
7. Buka aplikasi dan lakukan uji singkat: login, riwayat absensi, dan rekap bulan berjalan.

Dampak arsip:

- Rekap dan riwayat di aplikasi untuk bulan-bulan yang diarsipkan tidak lagi akurat; hari-hari itu akan tampil sebagai Alpha. Gunakan salinan arsip untuk laporan historis.
- Pemeriksaan foto ganda (hash) hanya mencakup baris yang tersisa.

### 10.3 Minimisasi data lama (opsional)

Untuk mengurangi data pribadi yang tersimpan, Anda dapat mengosongkan isi kolom koordinat (`checkInLat`, `checkInLng`, `checkOutLat`, `checkOutLng`) pada baris lama, tanpa menghapus kolomnya. Aplikasi hanya memakai koordinat absensi hari ini dan kemarin untuk perhitungan penanda `IMPOSSIBLE_TRAVEL`. Tetapkan batas usia data ini dalam kebijakan privasi perusahaan (lihat [KEAMANAN.md](KEAMANAN.md), bagian Retensi dan privasi data).
