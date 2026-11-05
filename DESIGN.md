# DESIGN.md: GGSHOPS.ID SDM & Absensi

Arahan dari pemilik pada 24 Oktober 2026, ditulis ulang apa adanya. Pemilik adalah penulis arahan ini; agen hanya merapikan formatnya.

## Arahan pemilik

| Bidang | Arahan | Sumber |
|---|---|---|
| Identitas | Logo GGSHOPS.ID: huruf "GG" emas bermahkota di atas marmer putih | `assets/logo.png` |
| Latar | Gambar pastel (merah muda, lavender, krem, biru muda) dipakai sebagai latar tema | `assets/background.jpg` |
| Tipografi | Elegan dan estetik. Pilihan pemilik: Cormorant Garamond (judul) + Manrope (teks) | Jawaban pemilik |
| Suasana | Elegan, estetik, tetap profesional dan mudah dipakai karyawan di HP | Prompt awal & jawaban pemilik |

**Override antislop (R-01, R-37):** latar pastel merah muda–ungu–biru di seluruh halaman termasuk pola yang diawasi R-01. Saat ditanya, pemilik memilih **tetap memakai gambar asli**. Override dicatat di sini, dan kartu tetap solid agar teks terbaca.

## Design Read

> Membaca ini sebagai: aplikasi kerja internal (absensi & SDM) untuk karyawan GGSHOPS.ID di HP dan HR/Admin di desktop, dengan gaya butik lembut (marmer, emas, serif) di atas latar pastel pemilik, dial ENERGY 2 / RHYTHM 1 / MOTION 2.

| Dial | Nilai | Alasan |
|---|---|---|
| ENERGY | 2 | Latar pastel dan judul serif sudah memberi karakter; isi kerja tetap tenang agar data mudah dibaca. |
| RHYTHM | 1 | Alat kerja harian: pola halaman yang sama memudahkan karyawan menemukan tombol. Keseragaman ini disengaja. |
| MOTION | 2 | Hanya transisi fungsional (dialog, laci menu, kilat kamera saat foto diambil). Tanpa animasi gulir dan tanpa animasi berulang. |

## Palet (2 inti + 1 aksen)

| Peran | Warna | Dipakai untuk |
|---|---|---|
| Inti: tinta | `#14213D` | Teks utama, sidebar (`#13203B`), tombol utama |
| Inti: gading | `#FFFDF9` (+ `#F7F2EA`, `#EFE8DD`) | Kartu, dialog, panel di atas latar |
| Aksen: emas | `#C9A65E` (isi), `#B08D4A` (garis), `#7A5A1C` (teks) | Logo, penanda menu aktif, garis motif judul, aksi absen (tombol check-in/out, shutter, tombol Absen di bawah) |
| Latar | Gambar pemilik | Seluruh halaman, di belakang kartu |
| Status | hijau `#1E6B45`, kuning `#8A4F06`, merah `#A8221B`, biru `#1A5A84` | Hanya label status (Hadir, Terlambat, Alpha, Izin), selalu disertai teks |

## Tipografi

- **Cormorant Garamond** untuk judul halaman, judul dialog, nama merek, dan angka fokus dashboard. Serifnya selaras dengan huruf emas di logo.
- **Manrope** untuk teks, formulir, tabel, dan jam. Mudah dibaca di layar kecil dan memiliki angka tabular, sehingga jam detik tidak bergoyang.
- Tidak ada label huruf kapital dengan spasi lebar. Label memakai huruf kalimat.

## Motif identitas

Judul serif diikuti **garis emas pendek** (44 px × 2 px). Garis ini menggemakan garis di bawah tulisan GGSHOPS.ID pada logo, dan dipakai di setiap judul halaman serta di judul halaman login.

## Keputusan & alasan (R-31)

| Keputusan | Alasan satu baris |
|---|---|
| Warna | Tinta dan emas diambil dari logo; latar adalah pilihan pemilik. |
| Kartu gading solid | Mengangkat isi dari gambar latar agar kontras teks terjamin di semua titik gambar. |
| Bayangan kartu | Penanda elevasi tunggal (kartu di atas latar), bukan hiasan di setiap elemen. |
| Kaca (blur) | Hanya bilah atas, agar tanggal dan aksi terbaca saat konten bergulir di atas gambar. |
| Radius | 14 px untuk kartu, 9 px untuk input dan tombol, bulat penuh hanya untuk label status dan chip pilihan. |
| Dashboard | Dibangun di sekitar keputusan harian HR: jumlah hadir hari ini sebagai fokus, lalu daftar siapa yang belum hadir. Tidak memakai deretan empat kartu angka. |
| Judul grafik | Ditulis sebagai pertanyaan yang dijawab grafik ("Berapa karyawan hadir dalam 7 hari terakhir?"). |
| Ikon | Ikon garis dipakai hanya di navigasi dan aksi, dan masing-masing mewakili fungsinya (kamera untuk foto, pin untuk lokasi, jam untuk waktu). Garis 1,7 px senada dengan serif yang tipis. |
| Avatar | Inisial nama, bukan foto buatan (R-23). |
| Tema | Terang tetap, karena gambar latar pemilik terang. Mode gelap tidak dibuat (R-21: alasan merek). |
| Jendela kamera gelap | Pratinjau wajah lebih kontras dan menjadi fokus layar absensi. |
| Spasi | Skala 4/8/12/16/24/32 px; jarak antarbagian lebih besar daripada jarak di dalam kartu agar kelompok terbaca. |
| Penanda "Memperbarui" | Saat halaman tampil dari cache, bilah atas menampilkan spinner kecil "Memperbarui" (teks disembunyikan di ponsel). Bila data baru datang ketika pengguna sedang mengisi formulir, halaman tidak diganti; muncul tombol "Data baru · muat ulang" agar isian tidak hilang. |
| Bonus penjualan | Satu kotak per jenis paket dengan angka paket di kanan dan rumus hasilnya di bawah ("(100 − 40) × Rp 500 = Rp 30.000"), agar host melihat cara hitungnya sebelum mengirim. Tombol kirim memakai warna tinta, karena emas hanya untuk aksi absensi. |
| Mode kamera HP | Saat Google memblokir kamera langsung, kotak kamera tetap gelap dan berisi satu tombol emas "Buka kamera". Di bawah foto ada baris pin "Lokasi terkunci: …" yang hanya bisa dibaca, agar karyawan tahu lokasi tidak dapat diubah. |
| Check-out dua foto | Tab "Selfie" dan "Foto hasil kerja" di atas kamera; setelah selfie aplikasi pindah otomatis agar urutan jelas tanpa membaca petunjuk. |
| Pilihan jobdesk | Baris checkbox setinggi 52 px dengan nama, deskripsi, dan tarif di kanan, karena keputusan karyawan adalah "apa yang saya kerjakan dan berapa nilainya". |
| Nominal Rupiah | Tinta tebal dengan angka tabular, tanpa warna baru, agar uang terbaca jelas dan emas tetap khusus aksi absen. |
| Verifikasi HR | Tabel dengan pilih banyak + Setujui/Tolak per baris, karena pekerjaan HR adalah memproses antrean laporan Menunggu. |

## Kontras (dihitung dengan `contrast-check.py`)

| Pasangan | Rasio | Hasil |
|---|---|---|
| Tinta di atas titik tergelap latar (`#CCACEB`) | 8,11 : 1 | AA |
| Teks sekunder `#2F3B55` di atas titik tergelap latar | 5,68 : 1 | AA |
| Tinta di atas gading | 15,72 : 1 | AA |
| Teks redup `#565F73` di atas gading / `#F7F2EA` | 6,30 / 5,74 : 1 | AA |
| Teks samar `#6A7283` di atas gading | 4,75 : 1 | AA |
| Putih di atas tombol tinta | 15,97 : 1 | AA |
| Tinta di atas tombol emas | 6,92 : 1 | AA |
| Teks emas `#7A5A1C` di atas gading | 6,25 : 1 | AA |
| Teks sidebar `#C9CFDD` di atas `#13203B` | 10,37 : 1 | AA |
| Label status (hijau, kuning, merah, biru, netral) | 5,34 sampai 6,40 : 1 | AA |
| Tepi input `#8F8576` di atas gading (non-teks) | 3,57 : 1 | ≥ 3 : 1 |
| Garis emas `#B08D4A` (non-teks) | 3,06 : 1 | ≥ 3 : 1 |

## Aset

Gambar di `assets/` disematkan ke `src/Background.html` dan `src/Logo.html` oleh `node dev/embed-assets.js`, karena Apps Script tidak dapat menyajikan file gambar biasa. Latar diperkecil ke lebar 1024 px (15 KB) karena gambarnya lembut; tampilannya sama dengan aslinya. Setelah mengganti gambar, jalankan ulang perintah itu lalu `npm run push`.
