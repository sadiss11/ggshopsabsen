# Panduan Deployment

**GGSHOPS.ID · SDM & Absensi** · versi aplikasi 1.0.0

Panduan ini membawa Anda dari kode sumber di folder `src/` sampai aplikasi siap dipakai karyawan. Setelah selesai, Anda memiliki:

- satu proyek Google Apps Script berisi kode aplikasi,
- satu spreadsheet database privat dan satu folder foto privat di Google Drive,
- satu URL web app berakhiran `/exec` untuk karyawan,
- akun admin yang sudah diamankan, plus konfigurasi awal (lokasi, jadwal, karyawan).

Perkiraan waktu: 30–60 menit.

Dokumen terkait:
- [KEAMANAN.md](KEAMANAN.md): model keamanan, privasi, dan keterbatasan.
- [DATABASE.md](DATABASE.md): struktur sheet, Script Properties, dan folder Drive.

> Label menu Google di panduan ini memakai antarmuka bahasa Inggris. Jika akun Google Anda berbahasa Indonesia, cari menu yang setara.

## Daftar isi

1. [Sebelum mulai](#1-sebelum-mulai)
2. [Jalur A: unggah kode dengan clasp](#2-jalur-a-unggah-kode-dengan-clasp)
3. [Jalur B: salin-tempel manual di editor](#3-jalur-b-salin-tempel-manual-di-editor)
4. [Menjalankan setup()](#4-menjalankan-setup)
5. [Deploy sebagai Web app](#5-deploy-sebagai-web-app)
6. [Konfigurasi awal](#6-konfigurasi-awal)
7. [Memperbarui kode](#7-memperbarui-kode)
8. [Troubleshooting](#8-troubleshooting)
9. [Referensi cepat](#9-referensi-cepat)

---

## 1. Sebelum mulai

### 1.1 Pilih akun pemilik

Web app ini berjalan dengan identitas akun yang men-deploy-nya (**Execute as: Me**). Akibatnya:

- Spreadsheet database dan semua foto absensi tersimpan di Google Drive akun ini dan memakai kuota penyimpanannya.
- Semua kuota Apps Script (waktu eksekusi, eksekusi simultan, kuota harian) dihitung terhadap akun ini.
- Jika akun ini dihapus, dinonaktifkan, atau kehilangan akses ke spreadsheet/folder, aplikasi berhenti bekerja.
- Siapa pun yang menguasai akun ini menguasai seluruh data.

Rekomendasi:

- Gunakan akun Google khusus milik perusahaan, bukan akun pribadi seorang staf.
- Aktifkan Verifikasi 2 Langkah pada akun tersebut.
- Gunakan **akun yang sama** untuk semua langkah: `clasp login`, menjalankan `setup()`, dan deploy.

### 1.2 Perkirakan ruang Google Drive

Rumus kasar ruang foto per bulan:

```
jumlah karyawan × 2 foto × hari kerja per bulan × ukuran rata-rata foto
```

Server menerima foto JPEG berukuran 4 KB sampai sekitar 1,5 MB, dengan panjang sisi 240–2000 piksel. Ukuran rata-rata bergantung pada kompresi di browser. Contoh dengan asumsi 150 KB per foto: 100 karyawan × 2 × 22 hari × 150 KB ≈ 660 MB per bulan. Dengan retensi default 365 hari, siapkan ruang untuk sekitar 12 bulan foto (≈ 8 GB pada contoh ini). Foto yang dibersihkan retensi masuk Sampah Drive dan tetap memakai kuota sampai Sampah dikosongkan.

### 1.3 Perangkat lunak

- Browser desktop terbaru (Chrome, Edge, atau Firefox) untuk editor Apps Script.
- Khusus Jalur A: Node.js (versi LTS) dan npm. Periksa dengan `node -v` dan `npm -v`.

### 1.4 Isi folder `src/`

| Jenis | File | Di editor Apps Script menjadi |
|---|---|---|
| Kode server (17 file) | `Config.js`, `Util.js`, `Db.js`, `Time.js`, `Audit.js`, `Auth.js`, `Geo.js`, `Schedule.js`, `Photo.js`, `Attendance.js`, `Employees.js`, `Leave.js`, `Jobdesk.js`, `Report.js`, `Settings.js`, `Setup.js`, `Code.js` | file skrip `.gs` dengan nama yang sama |
| Antarmuka | `Index.html`, `Styles.html`, `JsCore.html`, `JsAttendance.html`, `JsPages.html`, `JsSettings.html` | file HTML dengan nama yang sama |
| Manifest | `appsscript.json` | manifest proyek |

Manifest menetapkan: zona waktu proyek `Asia/Jakarta`, runtime `V8`, web app `executeAs: USER_DEPLOYING` dan `access: ANYONE_ANONYMOUS`, serta empat scope OAuth (lihat [bagian 4](#4-menjalankan-setup)).

---

## 2. Jalur A: unggah kode dengan clasp

clasp adalah alat baris perintah resmi Google untuk proyek Apps Script. Jalur ini disarankan karena pembaruan kode berikutnya cukup dengan satu perintah.

Contoh perintah di bawah memakai PowerShell di Windows.

**Langkah 1. Pasang clasp**

```powershell
npm i -g @google/clasp
clasp --version
```

**Langkah 2. Login ke akun pemilik**

```powershell
clasp login
```

Browser terbuka. Pilih akun pemilik, lalu klik **Allow**.

**Langkah 3. Aktifkan Apps Script API**

Buka https://script.google.com/home/usersettings, lalu ubah **Google Apps Script API** menjadi **On**. Tanpa langkah ini, `clasp create` dan `clasp push` gagal.

**Langkah 4. Cadangkan manifest, lalu buat proyek**

`clasp create` dapat menimpa `src/appsscript.json` dengan manifest default yang zona waktu, pengaturan web app, dan scope-nya berbeda. Simpan cadangannya dulu, lalu kembalikan setelah proyek dibuat:

```powershell
cd "d:\FILE PRIBADI\GGSHOPS.ID\ABSEN GGSHOPS.ID"
Copy-Item src\appsscript.json appsscript.json.bak
clasp create --type standalone --title "GGSHOPS.ID SDM & Absensi" --rootDir src
Copy-Item appsscript.json.bak src\appsscript.json -Force
```

Untuk berjaga-jaga, Anda juga dapat menyalin seluruh folder `src` sebelum menjalankan `clasp create`.

Periksa bahwa `src\appsscript.json` kembali berisi `"timeZone": "Asia/Jakarta"`, `"runtimeVersion": "V8"`, blok `"webapp"`, dan empat entri `"oauthScopes"`:

```powershell
Get-Content src\appsscript.json
```

`clasp create` membuat file `.clasp.json` di folder proyek. File ini berisi ID skrip dan `rootDir`. Simpan file ini karena setiap `clasp push` berikutnya memerlukannya.

> Jika memakai Command Prompt (cmd.exe), gunakan `copy src\appsscript.json appsscript.json.bak` dan `copy /Y appsscript.json.bak src\appsscript.json`.

**Langkah 5. Unggah kode**

```powershell
npm install      # sekali
npm run push     # membangun build/ (kode dipadatkan) lalu clasp push --force
```

`.clasp.json` memakai `"rootDir": "build"`: yang di-push adalah hasil `node dev/build.js`, yaitu salinan `src/` dengan JavaScript dan CSS halaman yang dipadatkan. Selalu ubah file di `src/`, jangan di `build/`.

**Langkah 6. Periksa di editor**

Buka https://script.google.com/home, lalu buka proyek **GGSHOPS.ID SDM & Absensi**. Pastikan ke-17 file `.gs` dan semua file HTML ada. Lanjutkan ke [bagian 4](#4-menjalankan-setup).

---

## 3. Jalur B: salin-tempel manual di editor

Pakai jalur ini jika Anda tidak bisa memasang Node.js.

1. Buka https://script.google.com/home, lalu klik **New project**.
2. Klik judul "Untitled project" dan ganti menjadi `GGSHOPS.ID SDM & Absensi`.
3. **Manifest:** buka **Project Settings** (ikon roda gigi), lalu centang **Show "appsscript.json" manifest file in editor**. Kembali ke **Editor**, buka `appsscript.json`, ganti seluruh isinya dengan isi `src/appsscript.json`, lalu simpan.
4. **File server:** proyek baru sudah berisi `Code.gs`. Ganti isinya dengan isi `src/Code.js`; jangan membuat file `Code` kedua. Untuk 16 file `.js` lainnya:
   - klik **+** di samping **Files**, lalu pilih **Script**,
   - ketik nama tanpa ekstensi, misalnya `Config` (editor menambahkan `.gs` sendiri),
   - tempel seluruh isi file `.js` yang sesuai.
5. **File HTML:** klik **+**, pilih **HTML**, lalu ketik nama persis tanpa ekstensi: `Index`, `Styles`, `JsCore`, `JsAttendance`, `JsPages`, `JsSettings`. Tempel isi file yang sesuai.
6. Simpan semua file (Ctrl+S) dan pastikan tidak ada pesan galat sintaks.

Aturan penting:

- Nama file harus sama persis, termasuk huruf besar-kecil. File HTML dipanggil berdasarkan nama, misalnya `HtmlService.createTemplateFromFile('Index')`.
- Urutan file tidak berpengaruh, karena tidak ada kode tingkat atas yang bergantung pada file lain.

> **Varian proyek terikat spreadsheet:** jika Anda membuat proyek dari spreadsheet (**Extensions → Apps Script**), `setup()` otomatis memakai spreadsheet itu sebagai database.

---

## 4. Menjalankan setup()

`setup()` membuat database, folder foto, konfigurasi default, jadwal default, akun admin pertama, dan trigger retensi harian. Jalankan sekali dari editor. Fungsi ini aman dijalankan ulang.

### 4.1 Langkah

1. Di editor, buka `Setup.gs`.
2. Pilih fungsi `setup` dari menu tarik-turun di toolbar, lalu klik **Run**.
3. Saat muncul **Authorization required**, klik **Review permissions** dan pilih akun pemilik.
4. Jika muncul **Google hasn't verified this app**, klik **Advanced**, lalu **Go to GGSHOPS.ID SDM & Absensi (unsafe)**. Peringatan ini wajar untuk proyek internal yang tidak diajukan ke verifikasi Google.
5. Jika izin ditampilkan sebagai daftar centang, centang **semuanya**, lalu klik **Allow**.

Izin yang diminta:

| Scope | Dipakai untuk |
|---|---|
| `https://www.googleapis.com/auth/spreadsheets` | membuat, membaca, dan menulis spreadsheet database |
| `https://www.googleapis.com/auth/drive` | membuat folder foto, menyimpan foto, mematikan berbagi tautan folder, memindahkan foto lama ke Sampah |
| `https://www.googleapis.com/auth/script.scriptapp` | memasang trigger harian `runRetentionCleanup` |
| `https://www.googleapis.com/auth/userinfo.email` | memeriksa identitas pemanggil `setup()` dan `resetAdminPassword()` (pengaman `guardEditor_`) |

> Jika izin email tidak dicentang, `setup()` gagal dengan pesan "Fungsi ini hanya dapat dijalankan oleh pemilik skrip melalui editor Apps Script." Jalankan ulang dan setujui semua izin.

6. Tunggu sampai panel **Execution log** menampilkan "Execution completed". Pada eksekusi pertama, isinya kurang lebih seperti ini:

```
Spreadsheet baru dibuat: https://docs.google.com/spreadsheets/d/<ID>/edit
Sheet dibuat: Users
Sheet dibuat: Employees
Sheet dibuat: Attendance
Sheet dibuat: WorkLocations
Sheet dibuat: WorkSchedules
Sheet dibuat: LeaveRequests
Sheet dibuat: Jobdesk
Sheet dibuat: AuditLogs
Folder foto dibuat: https://drive.google.com/drive/folders/<ID>
Jadwal default dibuat: Reguler 08:00–17:00, toleransi 15 menit.
AKUN ADMIN DIBUAT → username: admin | password sementara: 12345678 (wajib diganti saat login pertama)
Trigger retensi harian dipasang (pukul 02.00).
LANGKAH BERIKUTNYA: login sebagai admin → Pengaturan → Lokasi Kerja, lalu tambahkan titik kantor & radius.
```

7. Catat tiga hal: **URL spreadsheet**, **URL folder foto**, dan **password sementara admin**.
   - Password awal admin adalah `12345678` (konstanta `INITIAL_ADMIN_PASSWORD_` di `Setup.js`). Karena nilainya diketahui, **login dan ganti password segera** setelah `setup()`, sebaiknya sebelum URL web app dibagikan. Jika lupa password, jalankan `resetAdminPassword()` ([bagian 8.4](#84-lupa-password-admin)) untuk mengembalikannya ke `12345678`.
   - URL folder foto hanya muncul saat folder baru dibuat.
   - Log eksekusi mungkin dapat dibuka kembali oleh editor proyek lewat menu **Executions**. Karena itu, segera ganti password sementara ([bagian 6.1](#61-login-pertama-dan-ganti-password)).
8. Opsional: buka menu **Triggers** (ikon jam) dan pastikan ada trigger `runRetentionCleanup` bertipe time-based harian.

### 4.2 Apa yang dilakukan setup()

| Bagian | Pada eksekusi pertama | Jika dijalankan ulang |
|---|---|---|
| Spreadsheet | Memakai `SPREADSHEET_ID` jika ada. Jika tidak ada, memakai spreadsheet induk (proyek terikat spreadsheet). Jika itu pun tidak ada, membuat **"GGSHOPS.ID · Database SDM & Absensi"** di My Drive. Zona waktu spreadsheet disetel ke zona waktu aplikasi. | Memakai spreadsheet yang sama |
| Sheet & header | Membuat 8 sheet beserta header-nya, membekukan dan mewarnai baris header, lalu menghapus sheet bawaan yang kosong bernama `Sheet1`, `Lembar1`, atau `Sheet 1` | Tidak menduplikasi sheet. Kolom yang hilang ditambahkan di ujung kanan. |
| Folder foto | Memakai `PHOTO_FOLDER_ID` jika valid. Jika tidak, membuat **"GGSHOPS.ID · Foto Absensi (PRIVAT)"** di My Drive. Berbagi via tautan dimatikan. | Memakai folder yang sama |
| Konfigurasi | Menulis nilai default `CFG_*` yang belum ada | Nilai yang sudah ada tidak ditimpa |
| Jadwal default | Jika sheet WorkSchedules kosong, membuat "Reguler (Senin–Jumat)" (detail di [6.4](#64-jadwal-kerja)) dan menjadikannya default | Tidak dibuat lagi |
| Admin pertama | Jika sheet Users kosong, membuat akun `admin` dengan password sementara | Tidak dibuat lagi |
| Trigger | `runRetentionCleanup` setiap hari antara pukul 02.00–03.00 menurut zona waktu proyek (`Asia/Jakarta` di manifest) | Tidak diduplikasi |

### 4.3 Opsi: memakai spreadsheet yang sudah ada

1. Buka spreadsheet tujuan dan salin ID dari URL-nya: `https://docs.google.com/spreadsheets/d/<ID>/edit`.
2. Pastikan akun pemilik memiliki akses edit ke spreadsheet itu.
3. Di editor, buka **Project Settings → Script Properties → Add script property**. Isi Property `SPREADSHEET_ID` dan Value `<ID>`, lalu klik **Save script properties**.
4. Jalankan `setup()`.

Yang perlu Anda ketahui:

- Sheet yang namanya sama dengan nama sheet aplikasi (Users, Employees, Attendance, WorkLocations, WorkSchedules, LeaveRequests, Jobdesk, AuditLogs) **dipakai apa adanya**, dan kolom yang hilang ditambahkan di kanan. Pastikan tidak ada sheet bernama sama yang berisi data lain.
- Zona waktu spreadsheet diubah menjadi zona waktu aplikasi.
- Sheet kosong bernama `Sheet1`, `Lembar1`, atau `Sheet 1` dihapus.
- Pengaturan berbagi spreadsheet **tidak** diubah. Pastikan sendiri spreadsheet tidak dibagikan (lihat [KEAMANAN.md](KEAMANAN.md)).

Folder foto yang sudah ada dapat dipakai dengan cara yang sama lewat properti `PHOTO_FOLDER_ID` (ambil ID dari `https://drive.google.com/drive/folders/<ID>`). `setup()` hanya mematikan berbagi via tautan; orang yang ditambahkan langsung ke folder tetap memiliki akses. Periksa panel **Share** folder secara manual.

---

## 5. Deploy sebagai Web app

### 5.1 Langkah

1. Di editor, klik **Deploy → New deployment**.
2. Klik ikon roda gigi di samping **Select type**, lalu pilih **Web app**.
3. Isi formulir:

   | Field | Nilai |
   |---|---|
   | Description | misalnya `v1.0.0 rilis awal` |
   | Execute as | **Me** (email akun pemilik) |
   | Who has access | **Anyone** |

4. Klik **Deploy**. Jika diminta, klik **Authorize access** dan setujui izin.
5. Salin **Web app URL** yang berakhiran `/exec`. Inilah URL untuk karyawan.

### 5.2 Mengapa pengaturan ini

**Execute as: Me.** Hanya akun pemilik yang punya akses ke spreadsheet dan folder foto privat. Karyawan tidak perlu, dan tidak boleh, memiliki akses langsung ke keduanya. Jangan memilih **User accessing the web app**: setiap pengguna harus login Google dan memerlukan akses langsung ke spreadsheet dan folder, sehingga data privat terbuka.

**Who has access: Anyone.** Karyawan login dengan akun aplikasi (username dan password di sheet Users), bukan akun Google. Dengan "Anyone", URL dapat dibuka dari browser ponsel mana pun tanpa login Google. Konsekuensinya, halaman login dapat dibuka siapa saja yang tahu URL-nya, sehingga perlindungan bertumpu pada login aplikasi (lihat KEAMANAN.md, bagian Autentikasi).

| Pilihan Who has access | Dampak |
|---|---|
| **Anyone** (disarankan) | Tanpa login Google. Paling mudah bagi karyawan. |
| Anyone with Google account | Setiap pengguna harus masuk ke akun Google (akun apa pun) sebelum halaman terbuka, lalu tetap login dengan akun aplikasi. Pengunjung anonim tersaring, tetapi ada langkah tambahan, karyawan tanpa akun Google kesulitan, dan web app Apps Script kadang gagal dimuat jika browser masuk ke beberapa akun Google sekaligus. Aplikasi tidak memakai identitas Google pengunjung. |
| Anyone within *domain* (khusus Google Workspace) | Hanya akun domain perusahaan yang dapat membuka. Pilihan paling ketat jika semua karyawan memiliki akun Workspace. |
| Only myself | Hanya pemilik. Gunakan untuk uji. |

Pada akun Google Workspace, pilihan "Anyone" bisa tidak tersedia jika dibatasi kebijakan admin domain.

> URL `/dev` (**Deploy → Test deployments**) hanya dapat dibuka editor proyek dan selalu menjalankan kode terakhir yang tersimpan. Jangan bagikan URL ini ke karyawan.

---

## 6. Konfigurasi awal

### 6.1 Login pertama dan ganti password

1. Buka URL `/exec`.
2. Login dengan username `admin` dan password sementara dari log `setup()`.
3. Aplikasi mewajibkan Anda mengganti password sebelum fitur lain dapat dipakai. Syaratnya: 8–128 karakter, mengandung huruf dan angka, dan berbeda dari password lama.
4. Simpan password baru di pengelola password perusahaan.

Setelah 5 kali gagal login, username tersebut dikunci selama 15 menit.

### 6.2 Pengaturan umum

Buka menu **Pengaturan**.

| Pengaturan | Default | Rentang | Keterangan |
|---|---|---|---|
| Nama perusahaan | `GGSHOPS.ID` | wajib, maks. 80 karakter | Tampil di judul halaman |
| Alamat, telepon, email perusahaan | kosong | – | Informasi tampilan |
| Zona waktu | `Asia/Jakarta` | 20 pilihan | Menentukan tanggal kerja, keterlambatan, dan tampilan jam. **Tetapkan sebelum absensi pertama.** Perubahan berikutnya tidak mengonversi data lama. Satu zona waktu berlaku untuk semua lokasi. |
| Ambang akurasi GPS | 50 m | 5–1000 m | Absensi ditolak jika akurasi yang dilaporkan perangkat lebih buruk (angkanya lebih besar) dari nilai ini |
| Radius default | 100 m | 10–5000 m | Nilai awal untuk formulir lokasi. Server memakai radius yang tersimpan di tiap lokasi. |
| Jadwal default | dibuat `setup()` | – | Dipakai karyawan yang tidak diberi jadwal |
| Izinkan absen di luar hari kerja | Tidak | – | Jika Ya, check-in tetap bisa dilakukan pada hari di luar daftar hari kerja jadwal |
| Izinkan pulang lebih awal | Ya | – | Jika Ya, check-out sebelum jam pulang dicatat "Pulang Cepat". Jika Tidak, check-out sebelum jam pulang ditolak. |
| Pemeriksaan wajah | `off` | `off` / `advisory` | `advisory`: hasil deteksi wajah di browser hanya menjadi penanda, tidak menolak absensi |
| Retensi foto | 365 hari | 0–3650 (0 = tidak dihapus) | Foto lebih lama dipindahkan ke Sampah Drive oleh trigger harian |
| Retensi audit log | 730 hari | 0–3650 (0 = tidak dihapus) | Baris AuditLogs lebih lama dihapus |

### 6.3 Lokasi kerja

Absensi selalu ditolak dengan pesan "Lokasi kantor belum dikonfigurasi untuk akun Anda" sampai minimal satu lokasi aktif tersedia.

1. Buka **Pengaturan → Lokasi Kerja**, lalu tambahkan lokasi.
2. Ambil koordinat dari Google Maps di desktop: klik kanan titik pusat kantor, lalu klik angka koordinat (otomatis tersalin). Angka pertama adalah latitude, angka kedua longitude. Gunakan titik sebagai pemisah desimal, misalnya `-6.2087634` dan `106.8455990`. Server menyimpan hingga 7 digit desimal.
3. Isi radius dalam meter, berupa bilangan bulat 10–5000. Mulailah dari 100 m, lalu sesuaikan setelah uji.
4. Biarkan status **Aktif**.

Cara server memvalidasi lokasi: server menghitung jarak dari koordinat yang dilaporkan perangkat ke titik lokasi (rumus Haversine) dan menolak absensi jika jarak lebih besar dari radius. Ketidakpastian akurasi GPS **tidak** ditambahkan ke radius. Di dalam gedung akurasi GPS sering lebih buruk, jadi radius yang terlalu kecil menimbulkan penolakan palsu.

Aturan untuk beberapa lokasi:

- Karyawan yang diberi lokasi tertentu hanya dapat absen di lokasi aktif yang ditetapkan untuknya.
- Karyawan tanpa penetapan lokasi dapat absen di semua lokasi aktif.
- Jika semua lokasi yang ditetapkan untuk seorang karyawan nonaktif, ia tidak dapat absen. Server tidak beralih ke semua lokasi.
- Lokasi yang masih ditetapkan pada karyawan tidak dapat dihapus. Nonaktifkan saja.

Tips uji: lakukan absensi uji di beberapa titik dalam gedung. Jarak dan akurasi hasil hitungan server tercatat di sheet Attendance (`checkInDistance`, `checkInAccuracy`). Untuk percobaan yang ditolak, nilainya tercatat di kolom `detail` AuditLogs (`distance`, `accuracy`, `code`).

### 6.4 Jam kerja bebas

Sejak versi 11 aplikasi **tidak memakai jadwal kerja**, dan menu Pengaturan → Jadwal kerja sudah dihapus. Karyawan bebas check-in dan check-out kapan saja:

| Situasi | Hasil |
|---|---|
| Check-in jam berapa pun (sekali per tanggal) | Tercatat **Hadir** dengan jam server |
| Check-out minimal 2 menit setelah check-in | Tercatat; durasi = jam pulang − jam masuk |
| Kerja lewat tengah malam | Check-out sampai pukul 04.00 keesokan hari masuk ke tanggal check-in |
| Lupa check-out | Setelah pukul 04.00 catatan ditutup tanpa jam pulang; karyawan tetap bisa check-in untuk hari itu |
| Izin/cuti yang disetujui | Check-in pada tanggal itu ditolak |

Rekap bulanan tidak lagi menghitung terlambat, pulang cepat, atau alpha, karena tidak ada jadwal sebagai patokan. Data jadwal lama di sheet `WorkSchedules` dibiarkan sebagai arsip dan tidak dipakai.

### 6.5 Karyawan dan akun

1. Buka menu **Karyawan**, lalu tambahkan data karyawan.
2. Isi nama (wajib), email, nomor HP, jabatan, departemen, alamat, tanggal bergabung, lokasi (kosong = semua lokasi aktif), dan status.
3. Tulis **departemen** secara konsisten, misalnya selalu `Gudang`, karena jobdesk bertarif dapat dibatasi per departemen (huruf besar-kecil berpengaruh).
4. Untuk membuat akun login, isi username: 3–30 karakter berupa huruf kecil, angka, titik, garis bawah, atau strip. Username tidak dapat diubah kemudian.
   - Role HR hanya dapat membuat akun dengan role **karyawan**.
   - Super Admin dapat memilih Super Admin, HRD, atau Karyawan.
   - Staf dengan jabatan seperti "Admin toko" atau "Host live" tetap diberi role **Karyawan**. Hanya Super Admin dan HRD yang dapat melihat absen, laporan, dan gaji karyawan lain.
5. Password sementara hanya ditampilkan sekali. Serahkan langsung secara pribadi kepada karyawan, bukan lewat grup chat. Karyawan wajib menggantinya saat login pertama.
6. Jika karyawan lupa password, Admin dapat membuat password sementara baru dari menu **Pengaturan → Pengguna**. Sesi lama pengguna itu gugur dan kunci login-nya dibuka.

ID karyawan dibuat otomatis: `K001`, `K002`, dan seterusnya, dan tidak pernah dipakai ulang.

**Karyawan yang berhenti:** tekan ikon hapus di menu **Karyawan**. Data karyawan dan akun loginnya langsung terhapus sehingga daftar tidak menumpuk. Riwayat absensi, laporan jobdesk, bonus, dan fotonya tetap tersimpan di spreadsheet dan Drive sebagai arsip, tetapi tidak tampil lagi di rekap gaji/absensi. Unduh CSV rekap terlebih dahulu bila masih diperlukan.

Role Manager sudah dihapus. Akun lama yang masih ber-role `manager` otomatis berlaku sebagai Karyawan; ubah role-nya di **Pengaturan → Pengguna** bila perlu.

### 6.5A Bonus penjualan (host)

1. Buka **Gaji → Bonus**, lalu tekan **Tambah jenis paket**.
2. Isi nama (mis. `Paket Reguler`), **bonus per paket** (mis. Rp 500), dan **target minimal per hari** (mis. 40 paket). Buat jenis paket lain untuk tarif lain (mis. `Paket Premium` Rp 1.000).
3. Centang karyawan yang ikut (mis. semua host). Hanya mereka yang melihat tab Bonus.
4. Host membuka **Gaji → Bonus** setiap hari, menulis paket terjual per jenis paket, melampirkan screenshot penjualan, lalu mengirim. Contoh: 100 paket, target 40 → (100 − 40) × Rp 500 = Rp 30.000.
5. HR memeriksa laporan di bagian **Verifikasi bonus penjualan** pada tab yang sama, membuka screenshot, lalu menyetujui atau menolak dengan alasan.
6. **Rekap gaji** menampilkan kolom Jobdesk, Bonus, dan Total gaji.

Karyawan yang baru ditambahkan sebagai peserta melihat tab Bonus setelah memuat ulang aplikasi.

### 6.6 Akun admin

- Akun `admin` buatan `setup()` tidak terhubung ke data karyawan, sehingga tidak dapat melakukan absensi. Jika admin juga perlu absen, buat data karyawan untuknya dan **akun terpisah dengan role karyawan** untuk absensi. Akun admin juga dapat dihubungkan ke data karyawan lewat **Pengaturan → Pengguna**. HR tidak dapat menghapus atau menonaktifkan akun admin melalui data karyawan, tetapi akun terpisah tetap lebih rapi untuk pemisahan tugas.
- Buat **admin kedua** sebagai cadangan, dengan username yang tidak mudah ditebak. Username `admin` mudah ditebak, dan siapa pun dapat membuatnya terkunci 15 menit dengan 5 percobaan password salah.
- Aplikasi menolak menurunkan, menonaktifkan, atau menghapus admin aktif terakhir. Admin juga tidak dapat mengubah role atau status akunnya sendiri.

### 6.7 Uji coba sebelum go-live

- [ ] Buka URL `/exec` dari ponsel dengan jaringan seluler, di Chrome Android dan Safari iOS.
- [ ] Login dengan akun karyawan uji, lalu ganti password sementara.
- [ ] Izinkan akses kamera dan lokasi.
- [ ] Check-in di kantor: baris baru muncul di sheet Attendance, foto muncul di subfolder `yyyy-MM` folder foto, dan AuditLogs mencatat `CHECKIN` dengan `SUCCESS`.
- [ ] Check-in dari luar radius: ditolak, dan AuditLogs mencatat `CHECKIN` dengan `FAIL` (`code: OUTSIDE_RADIUS`).
- [ ] Check-out minimal 2 menit setelah check-in.
- [ ] Akun karyawan tidak dapat membuka fitur Admin. Percobaan akses tercatat sebagai `ACCESS_DENIED`.
- [ ] Buka URL folder foto dari jendela incognito atau akun Google lain: Drive harus menolak akses.
- [ ] Bersihkan data uji di luar jam kerja: hapus baris uji di sheet Attendance dan pindahkan fotonya ke Sampah. Karyawan uji yang masih memiliki riwayat absensi hanya dapat dinonaktifkan dari aplikasi, bukan dihapus.

### 6.8 Sebelum mengumumkan ke karyawan

- Sampaikan pemberitahuan privasi tentang foto wajah dan lokasi (lihat [KEAMANAN.md](KEAMANAN.md), bagian Retensi dan privasi data).
- Rekap bulan pertama menghitung hari kerja tanpa absensi sebagai Alpha, termasuk hari sebelum aplikasi mulai dipakai. Mulailah pada awal bulan, atau abaikan hari-hari sebelum go-live saat membaca rekap.
- Beri tahu karyawan bahwa banner Google di atas halaman adalah hal normal ([8.2](#82-banner-google-di-atas-halaman)).
- Minta karyawan membuka URL di Chrome atau Safari, bukan di browser bawaan aplikasi chat.

---

## 7. Memperbarui kode

### 7.1 Jalur clasp

1. Ubah file di `src/`. Jika gambar di `assets/` diganti, jalankan dulu `npm run assets`.
2. Jalankan uji, lalu bangun dan unggah:

   ```powershell
   npm run test:all   # uji backend, E2E, dan klik satu per satu
   npm run push       # build/ lalu clasp push
   ```

   Untuk menerbitkan dari baris perintah: `clasp create-version "keterangan"`, lalu `clasp update-deployment <ID deployment> -V <nomor versi>` untuk setiap ID dari `clasp list-deployments`.

3. Uji lewat URL `/dev` (**Deploy → Test deployments**). URL ini menjalankan kode terbaru tetapi memakai database yang sama, sehingga transaksi uji tercatat sebagai data nyata.
4. Terbitkan versi baru: **Deploy → Manage deployments**, pilih deployment aktif, klik ikon pensil (**Edit**), pada **Version** pilih **New version**, isi deskripsi, lalu klik **Deploy**.
5. URL `/exec` tetap sama.

Jangan memakai **New deployment** untuk pembaruan, karena perintah itu membuat URL baru.

### 7.2 Jalur manual

Ubah file di editor, simpan, lalu ikuti langkah 3–5 di atas.

### 7.3 Catatan pembaruan

- Sheet atau kolom baru dari skema (`SCHEMA_` di `Config.js`) dibuat otomatis saat pertama dipakai, jadi `setup()` tidak perlu dijalankan ulang. Contohnya sheet `JobRates` dan `WorkReports` untuk fitur gaji.
- Jika pembaruan menambah scope OAuth di manifest, jalankan `setup()` sekali dari editor untuk menyetujui izin baru.
- Trigger harian selalu menjalankan kode terakhir yang tersimpan di proyek, bukan versi deployment.
- Jangan mengedit kode di editor online dan di `src/` sekaligus. `npm run push` menimpa kode di editor.
- **Rollback:** buka **Manage deployments → Edit**, pilih versi lama pada **Version**, lalu klik **Deploy**.

---

## 8. Troubleshooting

### 8.1 Kamera atau lokasi tidak muncul atau ditolak

**Kamera langsung memang diblokir oleh Google.** Web app Apps Script ditampilkan di dalam iframe Google yang tidak memberi izin kamera, sehingga di semua HP muncul "Izin kamera ditolak" walaupun izin browser sudah diberikan. Ini batasan Google, bukan pengaturan HP. Aplikasi otomatis beralih ke tombol **Buka kamera**: kamera bawaan HP terbuka, lalu jam server dan lokasi GPS dicap otomatis pada foto. Lokasi tetap wajib diizinkan. Jika tombol ini tidak muncul, pastikan **Pengaturan → Perusahaan & aturan → Izinkan foto dari kamera HP bila kamera langsung diblokir** aktif.

| Periksa | Tindakan |
|---|---|
| Koneksi aman (HTTPS) | Browser hanya mengizinkan kamera dan lokasi di halaman HTTPS. URL Apps Script (`https://script.google.com/macros/s/.../exec`) sudah HTTPS. Jangan menyalin halaman ke hosting lain atau ke alamat HTTP. |
| Cara membuka URL | Buka URL `/exec` langsung di Chrome atau Safari. Jangan sematkan di Google Sites atau iframe lain. Browser bawaan aplikasi (WhatsApp, Instagram, Facebook, Telegram, LINE) sering tidak mendukung izin kamera atau lokasi; pakai menu "Buka di browser". |
| Izin di Chrome Android | Ketuk ikon di kiri address bar, buka **Permissions**, lalu izinkan **Camera** dan **Location**. Di pengaturan Android, buka **Aplikasi → Chrome → Izin** dan izinkan Kamera serta Lokasi. Pastikan lokasi perangkat aktif. |
| Izin di Safari iOS | Buka **Settings → Safari** (di iOS 18: **Settings → Apps → Safari**), lalu setel **Camera** dan **Location** ke **Ask** atau **Allow**. Di **Settings → Privacy & Security → Location Services**, pastikan Location Services aktif, **Safari Websites** disetel **While Using the App**, dan **Precise Location** aktif. |
| Chrome di iOS | Buka **Settings → Chrome**, lalu izinkan Camera dan Location. |
| Izin sempat ditolak | Ubah izin situs di pengaturan browser, lalu muat ulang halaman. |
| Kamera sedang dipakai | Tutup aplikasi lain yang memakai kamera. |

Pesan absensi yang terkait lokasi:

- **"Akurasi GPS belum mencukupi"**: aktifkan lokasi presisi atau mode akurasi tinggi, pindah ke area terbuka atau dekat jendela, tunggu beberapa detik, lalu perbarui lokasi.
- **"Anda berada di luar area kantor"**: periksa koordinat dan radius lokasi. Jarak dihitung ke titik koordinat lokasi, bukan ke batas gedung.

### 8.2 Banner Google di atas halaman

Pesan seperti "This application was created by a Google Apps Script user" adalah banner standar Google untuk web app Apps Script. Banner ini tidak dapat dihilangkan dari kode dan tidak memengaruhi fungsi aplikasi. Umumnya banner tidak tampil jika pemilik dan pengunjung berada dalam domain Google Workspace yang sama (dengan akses dibatasi ke domain). Menyematkan aplikasi di situs lain bukan solusi, karena iframe dapat memblokir kamera dan lokasi.

### 8.3 Pesan galat aplikasi

| Pesan | Penyebab umum | Tindakan |
|---|---|---|
| Database belum dikonfigurasi. Admin perlu menjalankan fungsi setup() di editor Apps Script. | Script Property `SPREADSHEET_ID` kosong: `setup()` belum dijalankan, dijalankan di proyek lain (misalnya salinan proyek), atau properti terhapus | Jalankan `setup()` di proyek yang di-deploy. Untuk memakai database lama, isi dulu `SPREADSHEET_ID` dengan ID spreadsheet lama, lalu jalankan `setup()`. |
| Sheet "…" tidak ditemukan. | Sheet diganti nama atau dihapus | Kembalikan nama sheet. Menjalankan `setup()` akan membuat sheet kosong baru. |
| Kolom "…" tidak ada di sheet … | Nama header diubah | Kembalikan nama header persis seperti semula. Menjalankan `setup()` hanya menambah kolom kosong baru, sementara data lama tetap di kolom yang diganti nama. |
| Folder foto belum dikonfigurasi. | `PHOTO_FOLDER_ID` kosong | Jalankan `setup()` |
| Foto tidak dapat dibuka dari Google Drive. | File foto sudah dihapus permanen, atau akun pemilik tidak lagi memiliki akses ke file tersebut | Foto tidak dapat dipulihkan dari aplikasi. Isi kolom ID foto dengan `DIHAPUS:MANUAL` agar tampil sebagai foto terhapus (lihat [DATABASE.md](DATABASE.md)). |
| Server sedang sibuk memproses transaksi lain. | Antrean Script Lock lebih dari 20 detik (biasanya saat jam masuk) | Coba lagi beberapa detik kemudian. Sesi foto tetap berlaku sampai 10 menit sejak kamera dibuka. |
| Sesi foto tidak valid atau sudah kedaluwarsa. | Foto dikirim lebih dari 10 menit setelah kamera dibuka, atau cache server terhapus lebih awal | Ambil ulang foto |
| Permintaan sebelumnya masih diproses. | Tombol kirim ditekan lagi dalam 4 detik | Tunggu, lalu periksa status absensi |
| Foto ini sudah pernah digunakan. | File foto identik dengan foto absensi atau foto hasil kerja sebelumnya | Ambil foto baru lewat kamera |
| Admin mewajibkan foto langsung dari kamera aplikasi, sehingga lampiran foto tidak diterima. | Pengaturan "Izinkan foto dari kamera HP" dimatikan | Aktifkan lagi di **Pengaturan → Perusahaan & aturan**. Di web app Apps Script kamera langsung selalu diblokir, jadi tanpa pengaturan ini karyawan tidak dapat absen. |
| Lokasi kantor belum dikonfigurasi untuk akun Anda. | Tidak ada lokasi aktif, atau semua lokasi yang ditetapkan untuk karyawan nonaktif | Tambah atau aktifkan lokasi, atau ubah penetapan lokasi karyawan |
| Jadwal kerja Anda belum diatur. | Tidak ada jadwal aktif | Aktifkan atau buat jadwal |
| Akun Anda belum terhubung dengan data karyawan. | Akun tanpa `employeeId` (misalnya akun `admin` awal) | Hubungkan akun ke data karyawan di **Pengaturan → Pengguna** |
| Data karyawan Anda tidak aktif. | Status di sheet Employees bukan `Aktif` | Aktifkan data karyawan |
| Terlalu banyak percobaan masuk. | 5 kali gagal login | Tunggu 15 menit, atau minta Admin membuat password sementara baru |
| Akun Anda tidak aktif. | Status di sheet Users bukan `Aktif` | Admin mengaktifkan akun |
| Batas waktu check-out telah lewat. | Waktu sudah melewati jam pulang + batas check-out | Aplikasi hanya mengizinkan HR mengoreksi status dan catatan. Jam pulang tidak dapat ditambahkan lewat aplikasi. |
| Terjadi kesalahan pada server. | Galat tak terduga, misalnya kuota habis atau Drive penuh | Cari baris `SERVER_ERROR` di AuditLogs (kolom `detail`), lalu periksa menu **Executions** di editor |
| Fungsi ini hanya dapat dijalankan oleh pemilik skrip melalui editor Apps Script. | `setup()` atau `resetAdminPassword()` dipanggil dari luar editor, atau izin email tidak disetujui | Jalankan dari editor dan setujui semua izin |

### 8.4 Lupa password admin

1. Buka editor proyek dengan akun pemilik.
2. Pilih fungsi `resetAdminPassword`, lalu klik **Run**.
3. Baca Execution log: `Password sementara untuk "admin": <password>`.
4. Login dengan password tersebut, lalu ganti password.

Detail perilaku `resetAdminPassword()`:

- Mereset akun admin yang **paling awal dibuat** (berdasarkan `createdAt`), biasanya akun `admin` buatan `setup()`.
- Mengaktifkan kembali akun tersebut (status `Aktif`), mewajibkan ganti password, membuka kunci login, dan menggugurkan semua sesi lama akun itu.
- Tidak tercatat di AuditLogs. Jejaknya hanya ada di menu **Executions** editor.
- Siapa pun yang memiliki akses edit ke proyek Apps Script dapat menjalankan fungsi ini. Batasi editor proyek.

Jika masih ada admin lain yang bisa login, ia dapat mereset password admin mana pun dari **Pengaturan → Pengguna**.

### 8.5 Kuota dan batas Google

| Gejala / contoh pesan | Kemungkinan penyebab | Tindakan |
|---|---|---|
| `Exceeded maximum execution time` | Satu eksekusi melebihi 6 menit (misalnya laporan atau retensi pada data besar) | Arsipkan data lama; persempit rentang laporan |
| `Service invoked too many times for one day` | Kuota harian suatu layanan habis | Tunggu reset kuota (24 jam). Pertimbangkan akun Google Workspace yang kuotanya lebih besar. |
| `Too many simultaneous invocations` atau absensi lambat saat jam masuk | Banyak eksekusi bersamaan (sekitar 30 per akun) dan Script Lock memproses transaksi satu per satu | Buka check-in lebih awal agar kedatangan menyebar; minta karyawan mencoba lagi jika muncul "Server sedang sibuk" |
| Absensi gagal dengan `SERVER_ERROR` dan foto tidak tersimpan | Penyimpanan Drive akun pemilik penuh | Kosongkan Sampah, tambah kapasitas, atau sesuaikan retensi foto |

Batas resmi dan nilai terbarunya ada di https://developers.google.com/apps-script/guides/services/quotas.

### 8.6 Lain-lain

- **Perubahan kode tidak terlihat di `/exec`:** versi baru belum diterbitkan ([7.1](#71-jalur-clasp) langkah 4). Muat ulang halaman setelah menerbitkan.
- **Halaman tidak termuat padahal URL benar:** coba jendela incognito. Jika browser masuk ke beberapa akun Google sekaligus, web app Apps Script kadang gagal dimuat.
- **Semua pengguna perlu dipaksa keluar** (misalnya dugaan kebocoran): di **Project Settings → Script Properties**, hapus semua properti yang berawalan `sess_`.

---

## 9. Referensi cepat

### 9.1 Fungsi yang dijalankan dari editor

| Fungsi | Kapan dipakai | Aman diulang? |
|---|---|---|
| `setup()` | Instalasi; setelah pembaruan yang menambah kolom atau scope | Ya. Tidak menduplikasi sheet, jadwal, admin, atau trigger. |
| `resetAdminPassword()` | Lupa password admin | Ya. Setiap eksekusi mengembalikan password admin ke `12345678` dan mewajibkan penggantian saat login. |
| `runRetentionCleanup()` | Dijalankan otomatis setiap hari oleh trigger. Jalankan manual hanya jika perlu. | Ya. Paling banyak sekali per 6 jam; eksekusi lain dalam rentang itu dilewati, termasuk eksekusi trigger. |

### 9.2 Lokasi penting

| Hal | Lokasi |
|---|---|
| Kode | script.google.com → proyek "GGSHOPS.ID SDM & Absensi" |
| Konfigurasi dan ID rahasia | Project Settings → Script Properties (lihat [DATABASE.md](DATABASE.md)) |
| Database | Spreadsheet "GGSHOPS.ID · Database SDM & Absensi" (atau ID di `SPREADSHEET_ID`) |
| Foto | Folder "GGSHOPS.ID · Foto Absensi (PRIVAT)" (atau ID di `PHOTO_FOLDER_ID`) |
| Log galat | Editor → Executions; sheet AuditLogs (`SERVER_ERROR`) |
| Trigger | Editor → Triggers |
