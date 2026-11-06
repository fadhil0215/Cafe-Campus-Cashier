# Cafe Campus — Smart Cashier (POS) & Self-Ordering QR System ☕📱

> Sistem Kasir & Pemesanan Digital Berbasis Web & QR Code Meja Terintegrasi Penuh dengan Kitchen Display System (KDS), Barista AI Assistant, Sound Alarm Engine Real-time, dan Manajemen Stok Resep Otomatis.

[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/Database-MySQL%208.0%20%2F%20MariaDB-blue.svg)](https://www.mysql.com/)
[![License](https://img.shields.io/badge/License-ISC-green.svg)](LICENSE)
[![Tests Status](https://img.shields.io/badge/Tests-51%2F51%20Checks%20Passed-success.svg)](tests/)

---

## 📋 Daftar Isi
1. [Latar Belakang & Gambaran Umum](#-latar-belakang--gambaran-umum)
2. [Fitur-Fitur Utama](#-fitur-fitur-utama)
   - [A. Sisi Pelanggan (Customer Self-Order)](#a-sisi-pelanggan-customer-self-ordering)
   - [B. Sisi Kasir & Staf Dapur (POS & KDS)](#b-sisi-kasir--staf-dapur-pos--kds)
3. [Arsitektur & Teknologi (Tech Stack)](#-arsitektur--teknologi-tech-stack)
4. [Prasyarat & Persyaratan Sistem](#-prasyarat--persyaratan-sistem)
5. [Panduan Instalasi & Menjalankan](#-panduan-instalasi--menjalankan)
6. [Daftar Akun Pengguna & Meja Pengujian](#-daftar-akun-pengguna--meja-pengujian)
7. [Skenario Pengujian Presentasi (Demo Guide)](#-skenario-pengujian-presentasi-demo-guide)
8. [Pengujian Otomatis (Automated Test Report)](#-pengujian-otomatis-automated-test-report)

---

## 💡 Latar Belakang & Gambaran Umum

Pada operasional cafe modern—terutama yang berlokasi di area kampus dan *co-working space*—antrean fisik di meja kasir pada jam-jam sibuk (*rush hour*) sering kali menjadi hambatan utama. Cafe juga sering kali ingin memberikan harga promosi khusus pelajar/mahasiswa, namun verifikasi manual kerap memperlambat pelayanan dan rentan disalahgunakan.

**Cafe Campus** menghadirkan solusi menyeluruh:
- **Pelanggan** memesan mandiri via scan QR meja di smartphone tanpa perlu mengunduh aplikasi (SPA Web App).
- **Validasi Pelajar** terotomatisasi dengan verifikasi OTP email institusi (`.ac.id`), foto selfie liveness KTM, dan proteksi anti-sybil (1x diskon per hari per NIM).
- **Kasir & Dapur** terhubung secara real-time melalui Server-Sent Events (SSE) & polling fallback, dilengkapi **Sound Alarm Engine** yang hanya berbunyi saat pesanan baru masuk atau pembayaran telah lunas.
- **Kitchen Display System (KDS)** memisahkan tiket minuman (Barista) dan makanan (Kitchen) secara otomatis.
- **Inventaris & Resep** memotong stok bahan baku (biji kopi, susu, gula aren) secara atomik per transaksi dan memulihkannya jika pesanan di-*void*.

---

## 🚀 Fitur-Fitur Utama

### A. Sisi Pelanggan (Customer Self-Ordering)
1. **Scan QR Meja Dinamis**: Cukup scan QR code meja (Meja 01 s/d 12), nomor meja dan token keamanan otomatis terpasang.
2. **Dual Pricing (Umum vs Pelajar)**: Switcher harga transparan. Subsidi pelajar diverifikasi dengan OTP email kampus dan foto KTM.
3. **Kustomisasi Minuman**: Pilihan ukuran cup (*Regular / Large*), tingkat manis (*Normal, Less, No Sugar*), dan es (*Normal, Less Ice, No Ice*).
4. **Peringatan Produk Tembakau (21+ Age Gate)**: Validasi usia otomatis untuk produk rokok/tembakau.
5. **Barista AI Assistant Chatbot**: Asisten interaktif cerdas untuk rekomendasi rasa, kecocokan mood, dan estimasi kalori.
6. **Pembayaran Fleksibel**: Simulasi QRIS instan otomatis dan opsi Bayar Tunai ke Meja Kasir.
7. **Layar Pelacakan Pesanan Real-time**: Pelanggan memantau status pembuatan pesanan (*Menunggu -> Diracik -> Siap Diambil -> Selesai*).
8. **Alert "Jangan Tutup Halaman" & Screen Wake Lock**: Memastikan tab browser tetap aktif agar dering lonceng dan notifikasi buzzer HP berbunyi saat pesanan siap diambil.

### B. Sisi Kasir & Staf Dapur (POS & KDS)
1. **Alarm Suara Akurat (Sound Alarm Engine)**: Bunyi lonceng kencang kasir hanya dipicu saat ada pesanan baru masuk (`NEW`) atau pembayaran selesai (`PAID`). Interaksi klik pelanggan sepenuhnya senyap (*100% silent unlock*).
2. **Kitchen Display System (KDS)**: Kanban board real-time untuk barista dan koki dapur memproses antrean pesanan.
3. **Dual Kitchen Ticket Routing**: Pemisahan item struk antara minuman (Barista Station) dan makanan (Kitchen Station).
4. **Manajemen Resep & Stok Bahan Baku**: Pengurangan stok otomatis berbasis resep dan pemulihan stok saat pesanan dibatalkan (*Void*).
5. **Manajemen Shift Kasir**: Pembukuan modal awal (*Starting Cash*), rekap penerimaan tunai, dan perhitungan selisih kas fisik (*Cash Variance*).
6. **Audit Trail & Keamanan**: Pencatatan riwayat setiap aksi staf dan pembatalan transaksi dengan integritas tinggi.

---

## 🛠️ Arsitektur & Teknologi (Tech Stack)

| Komponen | Teknologi | Keterangan |
| :--- | :--- | :--- |
| **Runtime Backend** | Node.js (v18+) | ESM (ECMAScript Modules) |
| **Web Server** | Express.js 4.22 | RESTful API, Helmet, CORS |
| **Database** | MySQL 8.0 / MariaDB | Driver `mysql2/promise`, Pool & Transaksi ACID |
| **Frontend Client** | Vanilla JavaScript | Modern ES2022 Single Page Application (SPA) |
| **Desain Antarmuka**| CSS3 Modern | Responsive Mobile-First, Figma System Theme |
| **Bundler** | esbuild | Kompilasi & minifikasi cepat ke `public/app.min.js` |
| **Realtime Stream** | SSE & Polling Fallback | Kompatibel dengan Cloudflare Tunnel (HTTP/2) |
| **Audio Engine** | Web Audio API | Sintesis nada lonceng (*Oscillator & Compressor*) |
| **Push Notification**| Service Worker | Web Push Protocol (VAPID) |
| **Payment Gateway** | Midtrans Client | Snap & Core API (Sandbox & Production) |

---

## 💻 Prasyarat & Persyaratan Sistem

- **Node.js**: Versi 18.0.0 ke atas (direkomendasikan Node.js 20 LTS).
- **Database**: MySQL 5.7+ / MySQL 8.0+ / MariaDB.
- **Port**: Port default `4176` (bebas dari proses lain).

---

## ⚡ Panduan Instalasi & Menjalankan

### 1. Salin Repositori & Pasang Dependensi
```bash
git clone https://github.com/fadhil0215/Cafe-Campus-Cashier.git
cd Cafe-Campus-Cashier
npm install
```

### 2. Konfigurasi Lingkungan (`.env`)
Salin file `.env.example` ke `.env`:
```bash
cp .env.example .env
```
Sesuaikan konfigurasi database MySQL Anda di `.env`:
```env
APP_MODE=demo
PORT=4176
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=cafe_campus_db
JWT_SECRET=rahasia_jwt_minimal_32_karakter_acak_anda
```

### 3. Buat Database MySQL
Buat database baru bernama `cafe_campus_db` di MySQL/phpMyAdmin:
```sql
CREATE DATABASE cafe_campus_db;
```
*Saat `npm start`, script persiapan database akan mengimpor schema awal hanya jika database benar-benar kosong. Jika database berisi sebagian tabel, proses akan berhenti untuk melindungi data yang sudah ada.*

### 4. Build Frontend & Jalankan Server
```bash
# Build bundle minifikasi
npm run build

# Periksa/siapkan database (aman dijalankan ulang)
npm run db:setup

# Menyalakan server (otomatis menjalankan pemeriksaan database lagi)
npm start
```

### 5. Konfigurasi Railway MySQL

Project ini menggunakan **MySQL/MariaDB**, bukan PostgreSQL. Jika deploy di Railway:

1. Tambahkan service **MySQL** pada project Railway.
2. Pada service aplikasi Cafe Campus, buka **Variables** → **Add Reference Variable**.
3. Pilih service MySQL lalu hubungkan variabel `MYSQL_URL` ke aplikasi (misalnya `${{MySQL.MYSQL_URL}}`; sesuaikan nama service MySQL Anda).
4. Tambahkan `NODE_ENV=production`, `APP_MODE=production`, `JWT_SECRET` berisi secret acak minimal 32 karakter, serta `ADMIN_EMAIL` dan `ADMIN_PASSWORD` untuk akun admin awal (password minimal 12 karakter) bila database masih memakai seed demo. Buat secret dengan `openssl rand -base64 48`.
5. Pastikan Start Command menggunakan `npm start` atau biarkan Dockerfile project ini menjalankan `npm start`.
6. Deploy ulang. Database kosong akan diinisialisasi otomatis; database yang sudah berisi data tidak akan di-reset.
7. Setelah deploy, periksa endpoint `/ready`. Respons `{"ok":true,"status":"ready","database":"connected"}` menandakan koneksi dan tabel inti tersedia.

Railway MySQL juga menyediakan variabel terpisah `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, dan `MYSQLDATABASE`; aplikasi mendukung keduanya. Jangan arahkan project MySQL ini ke Railway PostgreSQL tanpa migrasi driver dan seluruh SQL.

**Penyimpanan file upload:** aplikasi menyimpan file di `public/uploads`. Pada Railway, tambahkan Volume ke service aplikasi dengan mount path `/app/public/uploads` agar foto/berkas yang diunggah tetap ada setelah redeploy. Filesystem container di luar volume bersifat ephemeral.

**Penting:** `database.sql` berisi perintah `DROP TABLE IF EXISTS`. Jangan impor file itu secara manual ke database yang sudah berisi data. Script `npm run db:setup` hanya mengimpor dump ketika database terpilih benar-benar kosong dan akan menolak database dengan schema parsial.

> **Tips Presentasi Windows:**
> - Klik ganda `start-demo.bat` untuk menyalakan server lokal secara otomatis.
> - Klik ganda `start-online-demo.bat` untuk menyalakan demo publik berbasis Cloudflare Tunnel (link langsung disalin ke clipboard).
> - Klik ganda `stop-demo.bat` untuk mematikan server dengan aman.

---

## 🔑 Daftar Akun Pengguna & Meja Pengujian

### Akun Default Staf (Seed Data):
| Role / Jabatan | Email | Password | Akses Halaman |
| :--- | :--- | :--- | :--- |
| **Admin / Owner** | `admin@cafecampus.demo` | `admin123` | Seluruh Dashboard & Pengaturan |
| **Kasir Utama** | `kasir@cafecampus.demo` | `kasir123` | POS Kasir & Transaksi |
| **Barista / Dapur** | `dapur@cafecampus.demo` | `dapur123` | Kitchen Display System (KDS) |

> Akun di atas hanya aktif saat `APP_MODE=demo`. Dalam production, akun admin seed harus diganti menggunakan `ADMIN_EMAIL` dan `ADMIN_PASSWORD` saat bootstrap pertama, atau password admin diubah ketika masih dalam mode demo. Jangan gunakan password demo untuk client.

### Tautan Akses Aplikasi:
- **Menu Pelanggan (Meja 01)**: `http://localhost:4176/order/demo-table-01/menu`
- **Dashboard Kasir (POS)**: `http://localhost:4176/admin/orders`
- **Layar Dapur (KDS)**: `http://localhost:4176/admin/kds`
- **Manajemen Meja & QR**: `http://localhost:4176/admin/tables`
- **Stok & Inventaris Resep**: `http://localhost:4176/admin/inventory`
- **Buku Kas & Shift**: `http://localhost:4176/admin/shifts`

---

## 🎯 Skenario Pengujian Presentasi (Demo Guide)

1. **Uji Real-time Order & Alarm Kasir**:
   - Buka layar kasir di tab 1 (`/admin/orders`) dan menu meja pelanggan di tab 2 (`/order/demo-table-01/menu`).
   - Masukkan item ke keranjang dan lakukan checkout Tunai.
   - Amati: Alarm lonceng kasir **seketika berbunyi kencang** tanpa reload, dan di browser pelanggan tampil modal peringatan *"⚠️ Jangan Tutup Halaman Ini"*.
2. **Uji Diskon Mahasiswa & Anti-Sybil**:
   - Beralih ke mode "Pelajar / Mahasiswa" di menu pelanggan.
   - Masukkan identitas kampus (NIM, email `.ac.id`, foto KTM).
   - Kasir dapat memeriksa foto KTM dan mengonfirmasi atau menolak diskon.
3. **Uji Siklus Dapur (KDS) ke HP Pelanggan**:
   - Buka KDS (`/admin/kds`).
   - Tekan "Proses Racik" lalu "Tandai Siap".
   - Layar HP pelanggan otomatis berdering dan menampilkan layar hijau *"Pesanan Siap Diambil"*.
4. **Uji Asisten Cerdas Barista AI**:
   - Klik tombol AI di halaman menu pelanggan dan tanyakan rekomendasi kopi sesuai selera/kondisi.

---

## 🧪 Pengujian Otomatis (Automated Test Report)

Jalankan pengujian unit dan integrasi end-to-end melalui perintah:
```bash
npm test
```

### Hasil Pengujian:
```text
✓ Health check
✓ Figma review landing served
✓ All SPA routes served
✓ Dynamic table QR generated
✓ Dual student pricing & sold-out validation
✓ Campus email OTP verification & Anti-Sybil daily quota
✓ Cash confirmation & QRIS sandbox payment flow
✓ Order state machine NEW -> PROCESSING -> READY -> COMPLETED
✓ Raw materials atomic deduction & void restoration
✓ Cashier shifts open/close with variance calculation
✓ 51/51 automated demo API/business checks PASSED.
✓ 3/3 test suites (payment-stock-chatbot, phase0, realtime-alarm) PASSED.
```

---

## 📄 Lisensi & Hak Cipta
Hak Cipta © 2026 Cafe Campus Team. Dikembangkan untuk keperluan akademik, tugas akhir, dan implementasi operasional cafe mandiri.
