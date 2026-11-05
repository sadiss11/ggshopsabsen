# antislop Delivery Gate: tema GGSHOPS.ID (24 Oktober 2026)

Mode: **DURING** (dipilih pemilik pada sesi ini). Arahan: [`DESIGN.md`](../DESIGN.md). Bukti klik: [`hasil-klik.txt`](hasil-klik.txt). Hasil uji: [`hasil-uji-otomatis.txt`](hasil-uji-otomatis.txt).

Lingkup verifikasi: server pratinjau lokal (mock Apps Script) di Google Chrome. Web app Google asli dan HP fisik belum diverifikasi untuk tema ini (lihat bagian akhir).

## Blok 1: Hard Gate (semua harus "tidak")

| Aturan | Hasil | Bukti |
|---|---|---|
| R-02 em dash | PASS | Hasil `grep "—"` pada `src/`, `README.md`, `DESIGN.md`, dan `docs/*.md` = 0. Nilai kosong memakai "–". |
| R-03 mobile | PASS | Uji klik di lebar 390 px: `scrollWidth` ≤ 390 di login, dashboard, jobdesk, izin, absensi, dan profil. Tinggi tombol navigasi bawah 52 px. Target sentuh minimal 44 px (`pointer: coarse`). |
| R-17 angka tanpa sumber | PASS | Semua angka (kehadiran hari ini, rekap, grafik) dihitung dari sheet. Tidak ada metrik atau delta karangan. |
| R-18 testimoni | PASS | Tidak ada. |
| R-23 aset tanpa izin | PASS | Logo dan latar diberikan pemilik (`assets/`). Avatar memakai inisial. |
| R-24 navigasi mati | PASS | 8 menu sidebar dan 5 navigasi bawah diklik, semua menuju halaman yang ada. |
| R-25 kontras | PASS | Tabel `contrast-check.py` di `DESIGN.md`. Teks di atas titik tergelap gambar latar: 8,11 : 1. |
| R-26 elemen tidak berfungsi | PASS | 65 langkah klik PASS. Setiap tombol, dialog, filter, unduh CSV, setujui izin, tab Gaji, dan tambah jobdesk menghasilkan aksi nyata. Alur check-out + verifikasi gaji diuji di E12. |
| R-27 status kosong/memuat/galat | PASS | Status memuat berupa teks ("Memuat dashboard…"). Status kosong menyebut sebab dan langkah berikutnya. Galat tampil sebagai callout (uji E04–E07). |
| R-28 FAQ | PASS | Tidak ada. |
| R-32 keyboard | PASS | Tab memberi outline 2 px solid. Escape menutup dialog. Urutan DOM mengikuti urutan visual. Input memakai cincin tinta 2 px sebagai pengganti outline. |
| R-33 patch skrip | PASS | Fitur ditulis langsung di source, dan tidak ada skrip patch yang tertinggal di repo. `dev/embed-assets.js` hanya membangkitkan file aset dari gambar. |
| R-34 tema rusak | PASS | Satu tema terang, tanpa toggle. |
| R-35 dijalankan & diklik | PASS | Dijalankan di Chrome pada `src/` dan hasil build, 65 langkah klik dicatat, 0 error konsol di desktop dan ponsel. |
| R-36 klaim palsu | PASS | Tiga poin di halaman login (selfie bercap jam & lokasi, lokasi diverifikasi server, jam server) adalah fitur nyata dan sudah diuji (S01–S10, L01–L05, E13–E14). Klaim lama "tidak bisa memakai foto dari galeri" dihapus karena mode kamera HP di sebagian perangkat tetap menawarkan galeri. |
| R-37 arahan desain | PASS | `DESIGN.md` berisi arahan pemilik. Override R-01 dicatat. |
| R-38 konten karangan | PASS | Tidak ada. Data demo hanya ada di server pratinjau lokal (`npm run dev`). |

## Blok 2: Purpose-Gate (teknik boleh, alasan tertulis)

| Aturan | Hasil | Alasan / bukti |
|---|---|---|
| R-01 gradien/pastel | PASS (override pemilik) | Latar pastel adalah pilihan pemilik saat ditanya, dicatat di `DESIGN.md`. |
| R-04 ikon | PASS | Ikon garis hanya di navigasi dan aksi; relevansinya tertulis di `DESIGN.md`. |
| R-06 tipografi | PASS | Cormorant Garamond dan Manrope dipilih pemilik, alasannya tertulis. Label huruf kapital berspasi lebar dihapus. |
| R-07 pola latar | PASS | Tidak ada grid atau pola titik. |
| R-08 panah | PASS | Tidak ada panah hiasan. Ikon tombol adalah ikon aksi. |
| R-09 badge | PASS | Hanya label status nyata. Titik hiasan di dalam badge dihapus. |
| R-10 kaca | PASS | Hanya bilah atas (1 elemen). |
| R-12 bayangan | PASS | Satu tingkat elevasi untuk kartu di atas latar, plus dialog. |
| R-13 glow | PASS | Tidak ada; cahaya di titik sinkron jam dihapus. |
| R-14 kartu seragam | PASS | Deretan empat kartu angka di dashboard diganti kartu fokus kehadiran. |
| R-19 animasi | PASS | MOTION 2: hanya dialog, laci menu, dan kilat kamera. Kedip titik "Kamera aktif" dihapus. Spinner hanya saat memuat. |
| R-22 ilustrasi | PASS | Tidak ada. |

## Blok 3: Liveliness (semua harus "ya")

| Butir | Hasil | Bukti |
|---|---|---|
| Dial dinyatakan | PASS | ENERGY 2 / RHYTHM 1 / MOTION 2 di `DESIGN.md` |
| Hasil sesuai dial | PASS | Pola halaman seragam (disengaja untuk alat kerja); gerak hanya transisi fungsional |
| Satu titik fokus per layar | PASS | Dashboard: angka "hadir / total". Absensi: tombol absen emas. Login: kartu masuk. |
| Ruang kosong struktural | PASS | Skala spasi 4–32 px; jarak antarbagian lebih besar dari jarak di dalam kartu |
| Satu aksen disengaja | PASS | Emas hanya untuk merek dan aksi absen |
| Motif identitas | PASS | Judul serif + garis emas 44 px, gema garis pada logo |
| Design Read dinyatakan | PASS | Kalimat Design Read di `DESIGN.md` |

## Blok 4: Craftsmanship & Quality Locks (semua harus "tidak")

| Butir | Hasil | Bukti |
|---|---|---|
| C-1 keputusan default AI | PASS | Setiap keputusan punya alasan di `DESIGN.md` |
| C-2 kontrol mati | PASS | 65 langkah klik |
| C-3 bagian pengisi template | PASS | Dashboard disusun dari keputusan harian HR |
| C-4 rusak di state/breakpoint/keyboard | PASS | 1440 px dan 390 px, uji keyboard, uji iframe (E11) |
| C-5 klaim karangan | PASS | Tidak ada |
| R-05 layout template | PASS | Bukan pola hero/kartu/bento; dashboard bukan "empat kartu + grafik" |
| R-11 semua pill | PASS | Radius 14/9 px; pill hanya untuk label status dan chip |
| R-15 CTA generik | PASS | "Check-in sekarang", "Tinjau pengajuan", "Tambah karyawan" |
| R-16 buzzword | PASS | Tidak ada |
| R-20 generik bila logo ditukar | PASS | Marmer, emas, serif, dan latar pemilik membentuk identitas khas |
| R-21 mode gelap | PASS | Terang tetap dengan alasan merek (latar pemilik terang) |
| R-29 palet | PASS | 2 inti (tinta, gading) + 1 aksen (emas), ditambah warna status semantik |
| R-30 tiruan produk lain | PASS | Tidak meniru produk lain |
| R-31 alasan tertulis | PASS | Tabel "Keputusan & alasan" di `DESIGN.md` |

## Checklist skill tambahan

- **antislop-ui:** PASS. Palet dari merek, aksen terbatas, tanpa emoji, tanpa titik/kedip hiasan, dashboard dibangun dari keputusan pengguna, angka nyata, status kosong/memuat/galat menyebut sebab.
- **antislop-layoutmobile:** PASS. Tata letak ponsel berbeda (navigasi bawah + laci menu berlabel "Menu"), grid bertumpuk, tanpa overflow, target 44 px, navigasi bawah tidak menutupi konten (padding bawah + safe area).
- **antislop-human:** PASS. Kontras dihitung, fokus terlihat, Escape menutup dialog, status selalu disertai teks.

## Pembaruan: fitur gaji (laporan jobdesk)

| Butir | Hasil | Bukti |
|---|---|---|
| R-17/R-38 angka nyata | PASS | Semua nominal Rupiah dihitung server dari tarif di sheet `JobRates` dan laporan `WorkReports`. Perkiraan di layar check-out diberi label "menunggu verifikasi HR". |
| R-27 status | PASS | Status kosong menyebut sebab dan langkah ("Laporan jobdesk dibuat otomatis saat karyawan check-out…"). Status memuat berupa teks ("Menghitung gaji…"). Tanpa tarif, check-out tetap bisa dengan penjelasan. |
| R-25 kontras | PASS | Komponen baru hanya memakai token yang sudah diuji (tinta, teks redup, tepi input 3,57 : 1, label status). |
| R-29 palet | PASS | Tidak ada warna baru. Emas tetap hanya untuk aksi absen; nominal memakai tinta tebal. |
| R-03 mobile | PASS | Formulir jobdesk diuji di 390 px: baris pilihan setinggi 52 px, tanpa overflow; konten diberi `scroll-margin` agar tidak tertutup tombol absen yang menempel. |
| R-32 keyboard | PASS | Pilihan jobdesk berupa checkbox asli dengan cincin fokus; dialog tolak ditutup dengan Escape. |

## Belum diverifikasi

- Tampilan di web app Google asli (iframe `googleusercontent.com`) dan di HP fisik. Pemilik perlu membuat **New version** pada deployment lalu memeriksanya.
- Zoom teks 200% belum diuji otomatis.
