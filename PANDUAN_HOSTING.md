# 🚀 Panduan Hosting Murah & Terpercaya untuk Cafe Campus

Project **Cafe Campus** menggunakan stack:
- **Backend**: Node.js ESM (Express, Helmet, Rate Limit, CORS, Socket/SSE)
- **Database**: MySQL 5.7+ / 8.0+
- **Frontend**: Vanilla JS (Mini-SPA) + CSS, ter-bundle cepat via `esbuild`.

Berikut adalah rekomendasi hosting terbaik, termurah, dan paling stabil untuk deploy aplikasi ini ke klien:

---

## 🏆 Rekomendasi Paling Ideal: Cloud VPS (Rp 50.000 – Rp 80.000 / Bulan)

Untuk aplikasi kasir & pemesanan kafe (POS) di Indonesia, **Cloud VPS berlokasi di Jakarta/Indonesia** adalah opsi nomor 1 karena:
1. **Latensi Super Rendah (<10-20ms)**: Pelanggan scan QR meja dan kasir terima notifikasi secepat kilat.
2. **All-in-One**: Node.js + MySQL berjalan di 1 server tanpa biaya database terpisah.
3. **Fleksibel**: File foto KTM & struk tersimpan permanen di disk server.

### Pilihan Provider VPS Murah:
| Provider | Estimasi Biaya | Lokasi Data Center | Keunggulan |
| :--- | :--- | :--- | :--- |
| **IDCloudHost (Cloud VPS)** | ~Rp 50.000/bln (Billing per jam) | Jakarta, Indonesia | Sangat murah, bisa bayar pakai QRIS/GoPay, spek fleksibel |
| **Hostinger (KVM 1)** | ~Rp 79.000/bln | Singapura / Global | Sangat stabil, uptime 99.9%, kontrol panel hPanel mudah |
| **Biznet Gio (NEO Lite)** | ~Rp 55.000/bln | Indonesia | Jaringan lokal sangat kencang, terpercaya |

### 🛠️ Langkah Cepat Deploy di VPS (Ubuntu 22.04 / 24.04):
1. **Hubungkan SSH ke VPS Anda:**
   ```bash
   ssh root@ip_vps_anda
   ```
2. **Update & Install Node.js 20 & MySQL:**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt update && sudo apt install -y nodejs mysql-server nginx git
   ```
3. **Setup Database MySQL:**
   ```bash
   sudo mysql
   ```
   Di dalam prompt MySQL:
   ```sql
   CREATE DATABASE cafe_campus_db;
   CREATE USER 'cafecampus'@'localhost' IDENTIFIED BY 'PasswordKuat123!';
   GRANT ALL PRIVILEGES ON cafe_campus_db.* TO 'cafecampus'@'localhost';
   FLUSH PRIVILEGES;
   EXIT;
   ```
4. **Import Skema Database (`database.sql`):**
   ```bash
   mysql -u cafecampus -p cafe_campus_db < database.sql
   ```
5. **Clone Repositori & Install Dependencies:**
   ```bash
   git clone https://github.com/fadhil0215/Cafe-Campus-Cashier.git /var/www/cafe-campus
   cd /var/www/cafe-campus
   npm install
   npm run build
   ```
6. **Konfigurasi `.env`:**
   Buat file `/var/www/cafe-campus/.env`:
   ```env
   PORT=4176
   NODE_ENV=production
   DB_HOST=localhost
   DB_USER=cafecampus
   DB_PASS=PasswordKuat123!
   DB_NAME=cafe_campus_db
   JWT_SECRET=buat_token_jwt_acak_panjang_minimal_32_karakter
   APP_URL=https://pesan.cafecampus.com
   ```
7. **Jalankan Background Service dengan PM2 (Biar otomatis hidup saat server reboot):**
   ```bash
   sudo npm install -g pm2
   pm2 start server.mjs --name "cafe-campus"
   pm2 startup
   pm2 save
   ```
8. **Pasang Nginx & SSL Gratis (Certbot Let's Encrypt):**
   Edit `/etc/nginx/sites-available/default`:
   ```nginx
   server {
       listen 80;
       server_name pesan.cafecampus.com;

       location / {
           proxy_pass http://127.0.0.1:4176;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```
   Aktifkan SSL gratis:
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d pesan.cafecampus.com
   ```

---

## 🥈 Rekomendasi Tanpa Sysadmin: PaaS (Railway / Render)

Cocok jika Anda tidak mau pusing urus Linux/VPS dan ingin tinggal klik **Deploy from GitHub**:

### Opsi A: Railway.app (Sangat Praktis, Support MySQL 1-Klik)
- **Biaya**: Gratis awal ($5 credit trial), lalu ~$5/bulan (sekitar Rp 80.000).
- **Cara Setup**:
  1. Login ke [Railway.app](https://railway.app) pakai akun GitHub.
  2. Klik **New Project** -> **Provision MySQL**.
  3. Klik **New Service** -> **GitHub Repo** (pilih repositori Cafe Campus Anda).
  4. Buka tab **Variables** di Railway, masukkan variabel:
     - `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME` (Salin langsung dari variabel MySQL Railway).
     - `JWT_SECRET`
  5. Buka tab **Settings** -> **Generate Domain** (misal: `cafe-campus-production.up.railway.app`).
  6. Import `database.sql` ke database MySQL Railway via tool database (DBeaver / TablePlus).

### Opsi B: Render.com (Web Service) + TiDB Cloud / Aiven (Database Gratis)
- **Biaya**: **Rp 0 / GRATIS** (Sangat hemat untuk demo klien).
- **Cara Setup**:
  1. Buat database MySQL gratis di [TiDB Cloud](https://tidbcloud.com) atau [Aiven.io](https://aiven.io) (Free tier MySQL).
  2. Import `database.sql`.
  3. Di Render.com, buat **New Web Service** yang terhubung ke repositori GitHub Cafe Campus.
  4. Build Command: `npm install && npm run build`
  5. Start Command: `node server.mjs`
  6. Masukkan kredensial koneksi DB di **Environment Variables**.

---

## 💡 Tips Tambahan untuk Demo ke Klien

1. **Gunakan Domain Sendiri**:
   Beli domain murah (seperti `.my.id` seharga ~Rp 12.000/tahun di Niagahoster/DomaiNesia/IDCloudHost) lalu arahkan DNS ke IP server. Contoh: `order.cafecampus.my.id`. Klien akan sangat terkesan melihat nama cafenya ada di URL!
2. **Kredensial Default Login Kasir**:
   - URL: `/admin/login`
   - Email: `admin@cafecampus.demo`
   - Password: `admin123`
   *(Jangan lupa ganti email & password ini di menu Pengaturan Kasir saat sudah diserahkan ke klien)*.