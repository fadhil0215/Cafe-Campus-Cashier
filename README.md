# Cafe Campus — Smart Cashier & QR Order System ☕📱

Sistem kasir dan pemesanan digital berbasis Web & QR Code yang dirancang khusus untuk operasional cafe modern, kampus, dan co-working space. Dilengkapi fitur dual kitchen printer, validasi kartu mahasiswa / pelajar, notifikasi pesanan masuk otomatis, dan manajemen meja pintar.

---

## 🚀 Fitur Utama

### 1. Customer Self-Ordering (Pemesanan Mandiri via HP)
- **Scan QR Meja Dinamis**: Pelanggan cukup scan QR Code di meja untuk langsung membuka menu tanpa unduh aplikasi.
- **Harga Khusus Mahasiswa/Pelajar**: Fitur diskon khusus dengan upload foto KTM/Kartu Pelajar & verifikasi OTP email institusi (`.ac.id`).
- **Kustomisasi Minuman**: Pilihan ukuran (*Regular / Large*), tingkat manis (*Normal, Less, No Sugar*), dan es (*Normal, Sedikit Es, Tanpa Es*).
- **Pembayaran Fleksibel**: Mendukung **Cash (Bayar di Kasir)** dan simulasi **QRIS** (Midtrans sandbox ready).
- **Realtime Order Tracking**: Pelanggan dapat memantau status pesanan secara langsung (*MENUNGGU -> DIRACIK -> SIAP DIAMBIL / DIANTAR*).

### 2. Cashier & Admin POS (Dashboard Kasir & Manajemen)
- **Alarm Suara Notifikasi Pesanan Masuk**: Bunyi bel otomatis ketika ada pesanan baru masuk (baik Tunai maupun QRIS).
- **Dual Kitchen Printing (Pisah Printer Dapur)**:
  - 🖨️ **Dapur Minuman (Barista)**: Khusus tiket racikan kopi & non-kopi.
  - 🖨️ **Dapur Makanan (Kitchen)**: Khusus tiket masakan, snack, dan makanan utama.
  - 🖨️ **Struk Kasir/Customer**: Struk lengkap dengan rincian pembayaran, pajak, dan nomor meja.
- **Manajemen Meja & QR**: Generate, cetak, atau unduh QR Code meja beresolusi tinggi (format SVG).
- **Katalog & Stok**: Toggle cepat ketersediaan menu (*Available / Sold Out*).
- **Laporan & Transaksi**: Rekapitulasi omzet harian, metode pembayaran terpopuler, dan riwayat pesanan.

---

## 🛠️ Persyaratan Sistem (Prerequisites)

- **Node.js**: Versi 18 ke atas (direkomendasikan Node.js 20 LTS)
- **Database**: MySQL 5.7+ / MySQL 8.0+ / MariaDB
- **Jaringan**: Wi-Fi lokal yang sama antara PC Server (Kasir) dan Smartphone (Pelanggan) untuk pengujian lokal.

---

## ⚡ Panduan Instalasi & Menjalankan Lokal

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/fadhil0215/Cafe-Campus-Cashier.git
cd Cafe-Campus-Cashier
npm install
```

### 2. Setup Environment (`.env`)
Salin file `.env.example` ke `.env`:
```bash
cp .env.example .env
```
Sesuaikan konfigurasi database MySQL Anda:
```env
PORT=4176
NODE_ENV=development
DB_HOST=localhost
DB_USER=root
DB_PASS=
DB_NAME=cafe_campus_db
JWT_SECRET=rahasia_jwt_minimal_32_karakter_acak
```

### 3. Build Aset Frontend
```bash
npm run build
```

### 4. Jalankan Server
```bash
node server.mjs
```
Server akan aktif di:
- 💻 **Admin / Kasir (PC)**: `http://localhost:4176/admin/login`
- 📱 **Customer (HP via Wi-Fi)**: `http://<IP_KOMPUTER>:4176`

**Kredensial Default Admin:**
- **Email**: `admin@cafecampus.demo`
- **Password**: `admin123`

---

## 📱 Pengujian Scan QR dari Smartphone

1. Pastikan PC dan Smartphone terhubung ke **jaringan Wi-Fi yang sama**.
2. Port `4176` sudah diizinkan di Windows Firewall.
3. Buka Dashboard Kasir -> Menu **Meja & QR Code**.
4. Scan QR code meja menggunakan kamera smartphone atau Google Lens. Halaman menu meja tersebut akan langsung terbuka di browser HP.

---

## 🌐 Rekomendasi Deployment & Hosting

Untuk panduan lengkap deploy ke server live (VPS Ubuntu, Railway, atau Shared Hosting Node.js), silakan baca [PANDUAN_HOSTING.md](PANDUAN_HOSTING.md).

---

## 📄 Lisensi
Hak Cipta © 2026 Cafe Campus Team.