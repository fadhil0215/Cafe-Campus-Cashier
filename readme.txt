================================================================================
              DOKUMENTASI TUGAS AKHIR / PROYEK PRAKTIKUM
                     APLIKASI WEB "CAFE CAMPUS"
       SISTEM KASIR DIGITAL (POS) & SELF-ORDER QR CODE REAL-TIME
                 DILENGKAPI KITCHEN DISPLAY & BARISTA AI
================================================================================

Nama Proyek        : Cafe Campus - Smart Cashier & Self-Ordering QR System
Tipe Aplikasi      : Full-Stack Web Application (SPA + Real-time Engine)
Teknologi Utama    : Node.js (ESM), Express.js, MySQL 8, Vanilla JS, CSS3 Modern
Arsitektur         : REST API, Server-Sent Events (SSE) & Cursor-Based Polling
Versi Sistem       : v7.0 (Hardened Production & Demo Ready)
Tanggal Penyusunan : November 2026

--------------------------------------------------------------------------------
[IDENTITAS PENYUSUN / SISWA]
--------------------------------------------------------------------------------
Nama Siswa / Mahasiswa : [Nama Lengkap Anda / Siswa]
NISN / NIM             : [Nomor Induk Siswa / Mahasiswa]
Kelas / Jurusan        : Rekayasa Perangkat Lunak (RPL) / Teknik Informatika
Sekolah / Kampus       : [Nama Sekolah / Institusi Anda]
Guru / Dosen Pembimbing: [Nama Guru / Penguji Anda]

================================================================================
1. LATAR BELAKANG & DESKRIPSI SISTEM
================================================================================
Pada operasional cafe modern, terutama yang berlokasi di area kampus dan 
co-working space, sering kali terjadi kendala antrean panjang di meja kasir pada 
jam-jam sibuk (rush hour). Selain itu, cafe sering memberikan promo khusus untuk 
mahasiswa/pelajar, namun proses verifikasi kartu pelajar secara manual kerap 
memperlambat antrean dan rentan dimanipulasi (jastip/pinjam kartu identitas).

"Cafe Campus" hadir sebagai solusi sistem kasir (Point of Sale) cerdas berbasis 
Web dan QR Code Meja yang terintegrasi penuh:
1. Pelanggan dapat memesan langsung dari meja tanpa mengunduh aplikasi (Scan QR).
2. Terdapat validasi identitas pelajar terotomatisasi (AI Radar & OTP email kampus).
3. Pesanan langsung diteruskan secara real-time ke layar kasir dengan alarm lonceng 
   dan ke Kitchen Display System (KDS) untuk diproses barista/dapur.
4. Sistem stok bahan baku berkurang otomatis per cangkir berdasarkan resep.
5. Tersedia manajemen pembukuan shift kasir untuk mencegah selisih uang laci kas.

================================================================================
2. FITUR UTAMA & KEUNGGULAN INOVATIF SISTEM
================================================================================

A. SISI PELANGGAN (CUSTOMER SELF-ORDERING VIA SMARTPHONE)
--------------------------------------------------------------------------------
1. Scan QR Meja Dinamis:
   - Pelanggan cukup mengarahkan kamera HP ke QR Code meja (Meja 01 - 12).
   - Menu otomatis terbuka dengan nomor meja yang terkunci secara aman.
2. Dual Pricing & Pemindaian KTM Real-time dengan Google Gemini AI Vision:
   - Switcher harga fleksibel antara "Pelanggan Umum" dan "Pelajar/Mahasiswa" (Diskon s.d 30%).
   - Pemindaian Cerdas KTM (Kartu Tanda Mahasiswa): Pelanggan cukup mengunggah/memfoto KTM,
     sistem Gemini AI Vision (gemini-3.1-flash-lite) membaca OCR secara presisi tinggi:
     * Nama Lengkap Mahasiswa
     * Asal Universitas / Kampus
     * Nomor Induk Mahasiswa (NIM / NPM)
     * Fakultas Terdaftar (Otomatis matching dengan tema warna fakultas di database)
     * Program Studi / Jurusan
     * Pembuatan email institusi resmi (@ui.ac.id, @itb.ac.id, dll.) terverifikasi otomatis.
   - Perlindungan Anti-Sybil: Kuota diskon dibatasi maksimal 1x per hari per NIM.
3. Kustomisasi Menu & Add-ons:
   - Pemilihan ukuran cup (Regular / Large), tingkat manis (Normal, Less, No Sugar),
     serta tingkat es (Normal, Less Ice, No Ice).
   - Deteksi otomatis menu habis (Sold-Out) berdasarkan stok bahan baku nyata.
4. Peringatan Produk Tembakau (21+ Age Gate):
   - Validasi usia ketat untuk produk rokok/tembakau sesuai regulasi pemerintah.
5. Barista AI Chatbot bertenaga Google Gemini AI:
   - Asisten virtual pintar interaktif (gemini-3.1-flash-lite) yang memahami menu kafe
     real-time, merekomendasikan kopi & makanan sesuai selera/mood, memberikan info Wi-Fi,
     lokasi stopkontak/colokan listrik di meja, dan fasilitas nugas kafe.
   - Dilengkapi carousel produk rekomendasi yang bisa langsung ditambah ke keranjang.
6. Pembayaran Fleksibel:
   - Mendukung QRIS Digital Otomatis (Midtrans Sandbox / Simulator) dan 
     Bayar Tunai di Kasir.
7. Pelacakan Pesanan Real-time & Peringatan "Jangan Tutup Halaman":
   - Layar tracking interaktif: Menunggu -> Diracik -> Siap Diambil -> Selesai.
   - Modal alert edukatif pasca-checkout yang mengingatkan pelanggan untuk tidak 
     menutup tab agar alarm suara buzzer pesanan siap dapat berdering otomatis.
   - Screen Wake Lock API yang menjaga layar HP tetap menyala selama menunggu.

B. SISI KASIR & MANAJEMEN (ADMIN & POS DASHBOARD)
--------------------------------------------------------------------------------
1. Alarm Suara Pintar & Akurat (Sound Alarm Engine):
   - Menggunakan sintesis Web Audio API (Chime Oscillator & Compressor).
   - Alarm dering lonceng kasir HANYA berbunyi saat:
     * Pesanan baru masuk (Status: NEW).
     * Pelanggan menyelesaikan pembayaran (Status: PAID).
   - Suara klik interaksi pelanggan dinonaktifkan secara senyap (100% silent unlock).
2. Konfirmasi Pembayaran Kasir:
   - Kasir dapat mengonfirmasi pembayaran tunai atau QRIS manual dalam 1 klik.
3. Kitchen Display System (KDS):
   - Layar monitor khusus barista & koki dapur berbasis Kanban Board real-time 
     (Kolom Baru -> Diproses -> Siap Diambil).
4. Dual Kitchen Ticket Routing (Pemisahan Tiket Dapur):
   - Otomatis memisahkan item minuman (Barista Station) dan makanan (Kitchen Station)
     pada struk cetak kasir dan tiket dapur.
5. Manajemen Resep & Pengurangan Stok Otomatis (Atomic Inventory):
   - Setiap transaksi berhasil langsung memotong stok bahan baku (biji kopi, susu,
     sirup gula aren) secara otomatis di database.
   - Fitur Pembatalan Pesanan (Void Order) yang mengembalikan stok bahan baku utuh.
6. Manajemen Buku Kas & Shift Kasir (Cashier Shift Management):
   - Buka shift dengan modal awal (Starting Cash), catat transaksi kas, dan tutup 
     shift dengan validasi selisih kas fisik (Cash Variance).
7. Audit Log Trail (Pencatatan Keamanan & Hak Akses):
   - Merekam setiap aktivitas staf: login, perubahan harga, void pesanan, verifikasi
     KTM, dan penutupan shift ke dalam tabel audit yang tidak bisa dimanipulasi.

================================================================================
3. TEKNOLOGI YANG DIGUNAKAN (TECH STACK)
================================================================================
1. Backend Environment : Node.js (v18.0.0 ke atas, ES Module syntax)
2. Web Server Framework: Express.js v4.22
3. Database Management : MySQL 8.0 / MariaDB (Driver: mysql2/promise)
4. Frontend Client     : Vanilla JavaScript (ES2022+), Single Page Application (SPA)
5. Styling & Desain    : Custom Modern CSS3 (Glassmorphism, Responsive, Figma Design)
6. Bundler & Minifier  : esbuild (Menghasilkan public/app.min.js teroptimasi)
7. Komunikasi Real-time: Server-Sent Events (SSE) + Cursor-Based Fallback Polling
8. Audio Engine        : HTML5 Web Audio API (Synthesized Polyphonic Chime)
9. Push Notifications  : Service Worker PWA + Web Push Protocol (VAPID)
10. Payment Gateway    : Midtrans Snap & Core API (Sandbox & Production Ready)
11. Keamanan & Enkripsi: bcryptjs (Hashing Password), jsonwebtoken (JWT Auth),
                         Helmet HTTP Headers, Express Rate Limit

================================================================================
4. STRUKTUR DIREKTORI PROYEK
================================================================================
Cafe-Campus-Demo-v6-Figma/
├── config/
│   └── db.mjs                 # Konfigurasi pool koneksi MySQL (mysql2/promise)
├── migrations/
│   └── 001_full_features_v7.sql # Migrasi database skema lengkap v7
├── public/                    # Aset statis & frontend SPA
│   ├── app.js                 # Source code frontend JavaScript klien
│   ├── app.min.js             # Hasil bundle minifikasi via esbuild
│   ├── index.html             # Shell utama halaman Single Page Application
│   ├── styles.css             # Desain antarmuka responsif mobile & desktop
│   └── sw.js                  # Service Worker untuk Web Push Notifikasi
├── tests/                     # Skrip automated test suite
│   ├── payment-stock-chatbot.test.mjs  # Uji pembayaran, stok, & Barista AI
│   ├── phase0-env-mode.test.mjs        # Uji env production vs demo mode
│   └── realtime-order-alarm.test.mjs   # Uji filter alarm real-time kasir
├── .env.example               # Contoh template variabel lingkungan sistem
├── database.sql               # Skema awal dan backup struktur basis data
├── package.json               # Daftar pustaka dependency & skrip npm
├── server.mjs                 # Server utama Node.js Express & Endpoint REST
├── start-demo.bat             # Skrip launcher demo lokal otomatis (Windows)
├── start-online-demo.bat      # Skrip launcher demo online via Cloudflare Tunnel
├── stop-demo.bat              # Skrip pembersih port dan penutup server
├── test-demo.mjs              # Pengujian 51 skenario API & logika bisnis
└── readme.txt                 # Berkas dokumentasi panduan proyek ini

================================================================================
5. PANDUAN INSTALASI & MENJALANKAN SISTEM
================================================================================

A. PRASYARAT PERANGKAT LUNAK (PREREQUISITES)
1. Node.js versi 18 atau 20 LTS terpasang di komputer.
   Cek dengan perintah: node -v
2. MySQL Server (bisa melalui XAMPP, Laragon, atau MySQL Installer Service).
   Pastikan port default 3306 sudah aktif.

B. LANGKAH-LANGKAH INSTALASI
1. Buka folder proyek di Terminal / Command Prompt / PowerShell:
   cd /path/ke/Cafe-Campus-Demo-v6-Figma

2. Pasang modul dependensi:
   npm install

3. Konfigurasi Database (.env):
   - Salin file .env.example menjadi .env:
     copy .env.example .env     (di Windows CMD)
     cp .env.example .env       (di Git Bash / Linux)
   - Buka file .env dan pastikan kredensial MySQL sesuai (DB_USER, DB_PASSWORD, dll):
     DB_HOST=localhost
     DB_PORT=3306
     DB_USER=root
     DB_PASSWORD=
     DB_NAME=cafe_campus_db
     APP_MODE=demo
     PORT=4176
     GEMINI_KTM_API_KEY=AQ.Ab8...    (Google Gemini API Key untuk Vision OCR KTM)
     GEMINI_CHATBOT_API_KEY=AQ.Ab8... (Google Gemini API Key untuk Barista Chatbot)

4. Pembuatan Database & Migrasi Skema:
   - Buat database kosong bernama `cafe_campus_db` di phpMyAdmin atau MySQL CLI:
     CREATE DATABASE cafe_campus_db;
   - Saat server pertama kali dinyalakan, server akan otomatis menjalankan migrasi 
     skema tabel dan mengisi data awal (seed) secara cerdas (auto-migration).

5. Build Bundle Frontend:
   npm run build

C. CARA MENJALANKAN APLIKASI
Opsi 1: Menjalankan Langsung via Node.js
   npm start
   (atau: node server.mjs)

Opsi 2: Menggunakan Batch Script Otomatis (Sangat Direkomendasikan untuk Presentasi)
   Cukup klik dua kali pada file:
   start-demo.bat

Opsi 3: Menjalankan Online Demo Publik (Untuk dicoba guru/teman lewat HP di luar Wi-Fi)
   Klik dua kali pada file:
   start-online-demo.bat
   Sistem akan otomatis membuka Cloudflare Quick Tunnel (HTTP/2 anti-drop) dan 
   menyalin link URL publik ke clipboard laptop Anda.

================================================================================
6. AKUN PENGGUNA DEFAULT & TAUTAN AKSES SISTEM
================================================================================
Setelah server aktif di port 4176, berikut adalah halaman-halaman yang dapat dibuka:

1. HALAMAN PELANGGAN (CUSTOMER VIEW):
   - URL Beranda / Menu Meja: http://localhost:4176/order/demo-table-01/menu
   - Nomor Meja Tersedia    : Meja 01 s/d Meja 12 (ubah token demo-table-01 s/d 12)
   - Simulasi Keranjang     : http://localhost:4176/cart
   - Status Tracking Pesanan: http://localhost:4176/track/:orderNumber

2. HALAMAN KASIR & MANAJEMEN (ADMIN/STAFF VIEW):
   - URL Login Staff: http://localhost:4176/admin/login
   - Dashboard Kasir: http://localhost:4176/admin/orders
   - Layar KDS Dapur: http://localhost:4176/admin/kds
   - Meja & QR Code : http://localhost:4176/admin/tables
   - Stok & Resep   : http://localhost:4176/admin/inventory
   - Buku Kas Shift : http://localhost:4176/admin/shifts
   - Audit Log Trail: http://localhost:4176/admin/audit

3. DAFTAR KREDENSIAL LOGIN (DEFAULT SEED):
   +-----------------------+--------------------------+------------+-----------+
   | Peran (Role)          | Email Akun               | Password   | Hak Akses |
   +-----------------------+--------------------------+------------+-----------+
   | Administrator / Owner | admin@cafecampus.demo    | admin123   | Full Akses|
   | Kasir Utama (Cashier) | kasir@cafecampus.demo    | kasir123   | Kasir/POS |
   | Barista & Koki Dapur  | dapur@cafecampus.demo    | dapur123   | KDS Dapur |
   +-----------------------+--------------------------+------------+-----------+

================================================================================
7. SKENARIO DEMO PENGUJIAN UNTUK GURU / PENILAI (STEP-BY-STEP)
================================================================================
Untuk mendemonstrasikan sistem ini kepada penguji/guru, ikuti langkah berikut:

SKENARIO 1: PEMESANAN MENU REGULER & ALARM KASIR REAL-TIME
1. Buka browser pertama di layar kasir: http://localhost:4176/admin/login 
   dan login menggunakan akun admin@cafecampus.demo.
2. Buka browser kedua (atau smartphone Anda) di: 
   http://localhost:4176/order/demo-table-01/menu
3. Pilih minuman "Iced Latte Gula Aren", atur tingkat gula "Less Sugar", lalu 
   masukkan ke keranjang.
4. Lakukan Checkout dengan memilih metode "Bayar di Kasir (Tunai)".
5. Tekan tombol "Konfirmasi Pesanan".
6. Amati:
   - Di browser pelanggan: Muncul modal peringatan "⚠️ JANGAN TUTUP HALAMAN INI!"
     yang mengedukasi agar tab tidak ditutup supaya alarm siap saji bisa berdering.
   - Di browser kasir: Alarm lonceng kasir BERBUNYI KENCANG seketika dan banner 
     pesanan baru masuk muncul tanpa perlu kasir me-refresh halaman!

SKENARIO 2: DISKON MAHASISWA & VERIFIKASI IDENTITAS
1. Di halaman menu pelanggan, ubah mode pelanggan menjadi "Pelajar / Mahasiswa".
2. Masukkan menu ke keranjang (amati potongan harga subsidi pelajar aktif).
3. Di halaman checkout, isi form verifikasi mahasiswa:
   - Nama: Budi Santoso
   - Asal Kampus: Universitas Indonesia
   - NIM: 2206812345
   - Email: budi@ui.ac.id (klik "Kirim OTP", masukkan kode OTP demo).
   - Ambil foto selfie liveness bersama Kartu Pelajar melalui webcam/kamera HP.
4. Tekan "Konfirmasi Pesanan".
5. Di dashboard kasir, buka detail pesanan tersebut:
   Kasir dapat memverifikasi keabsahan foto KTM, menyetujui, atau menolak diskon 
   (jika ditolak, harga otomatis kembali ke tarif umum tanpa reload).

SKENARIO 3: SIKLUS DAPUR KDS & ALARM BUZZER SIAP DI HP PELANGGAN
1. Buka layar dapur KDS di http://localhost:4176/admin/kds.
2. Pesanan baru tampil di kolom "BARU".
3. Tekan tombol "Proses Racik" -> Tiket berpindah ke kolom "DIPROSES".
4. Tekan tombol "Tandai Siap" -> Tiket berpindah ke kolom "SIAP DIAMBIL".
5. Amati di HP pelanggan: 
   Alarm buzzer berbunyi, layar bergetar, dan antarmuka beralih ke layar hijau 
   "PESANAN SIAP DIAMBIL" lengkap dengan nomor antrean!

SKENARIO 4: KONSULTASI MENU DENGAN BARISTA AI
1. Di halaman menu pelanggan, klik tombol "🤖 Tanya Barista AI".
2. Ketik pertanyaan: "Kopi apa yang manis dan ramah di lambung untuk begadang tugas?"
3. Barista AI akan langsung menganalisis katalog menu secara cerdas dan memberikan
   rekomendasi minuman spesifik beserta alasan dan harganya.

================================================================================
8. HASIL PENGUJIAN OTOMATIS (AUTOMATED TESTING REPORT)
================================================================================
Aplikasi ini telah melalui pengujian unit dan integrasi otomatis yang ketat:

Perintah Pengujian:
   npm test

Hasil Pengujian:
   [OK] 51/51 Pemeriksaan Logika Bisnis & API Demo (100% LULUS)
   [OK] Test Suite 1: payment-stock-chatbot.test.mjs  (100% LULUS)
   [OK] Test Suite 2: phase0-env-mode.test.mjs        (100% LULUS)
   [OK] Test Suite 3: realtime-order-alarm.test.mjs   (100% LULUS)
   Total Kegagalan (Failures): 0 (Zero Errors)

Uji Stabilitas:
- Dukungan Cloudflare Tunnel HTTP/2 dengan keep-alive timeout 65 detik.
- Menggunakan database transaction (ACID) untuk mencegah selisih stok saat pesanan
  bersamaan (race condition).
- Pencegahan serangan pemalsuan identitas (Anti-Sybil Quota Protection).

================================================================================
9. KESIMPULAN
================================================================================
Aplikasi "Cafe Campus" berhasil merealisasikan sistem otomasi cafe yang aman, 
efisien, dan modern. Kombinasi fitur Self-Ordering QR, Kitchen Display System, 
Sound Alarm Engine yang akurat, integrasi Barista AI, dan pembukuan kasir terpadu 
menjadikan proyek ini siap untuk diimplementasikan pada operasional cafe nyata 
maupun sebagai materi tugas akhir / ujian kompetensi keahlian perangkat lunak.

================================================================================
                      Hak Cipta © 2026 Cafe Campus Team
================================================================================

