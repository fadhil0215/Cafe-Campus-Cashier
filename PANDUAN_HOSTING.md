# Panduan Cepat Hosting Website Cafe Campus 🚀

Website Cafe Campus dibangun menggunakan **Native Node.js ESM** tanpa dependensi npm eksternal yang rumit. Anda bisa menghostingnya dalam 5 menit ke berbagai layanan gratis maupun berbayar.

---

## Opsi 1: Render.com (Paling Populer & Ada Gratis)
1. Buat akun di [Render.com](https://render.com).
2. Upload folder proyek ini ke akun GitHub Anda.
3. Di dashboard Render, klik **New +** > **Web Service**.
4. Hubungkan repositori GitHub Cafe Campus Anda.
5. Konfigurasi service:
   - **Environment**: `Node`
   - **Build Command**: *(kosongkan)*
   - **Start Command**: `node server.mjs`
   - **Environment Variables**:
     - `PORT` = `10000` (atau biarkan default Render)
     - `ADMIN_PASSWORD` = `password_rahasia_anda`
6. Klik **Create Web Service**. Website Anda langsung aktif dengan domain HTTPS gratis (contoh: `https://cafe-campus.onrender.com`).

---

## Opsi 2: Railway.app (Cepat & Mendukung Disk Persisten)
1. Buka [Railway.app](https://railway.app).
2. Buat proyek baru dan pilih **Deploy from GitHub repo**.
3. Railway otomatis mendeteksi `Dockerfile` atau `package.json`.
4. (Sangat Disarankan) Tambahkan **Persistent Volume** yang diarahkan ke `/app/data` agar data menu dan pesanan tidak hilang saat redeploy.
5. Generate domain publik di tab **Settings > Networking**.

---

## Opsi 3: VPS Sendiri (Ubuntu / Debian dengan Nginx & PM2)
Jika Anda memiliki server VPS (DigitalOcean, Biznet, IDCloudHost, Niagahoster):
1. Install Node.js:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
2. Salin folder proyek ke server, misalnya di `/var/www/cafe-campus`.
3. Install PM2 agar server otomatis hidup kembali saat reboot:
   ```bash
   sudo npm install -g pm2
   cd /var/www/cafe-campus
   pm2 start server.mjs --name "cafe-campus"
   pm2 startup
   pm2 save
   ```
4. Pasang Nginx reverse proxy ke `http://127.0.0.1:4176` dengan SSL Certbot gratis:
   ```nginx
   server {
       server_name cafecampus.com www.cafecampus.com;
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
5. Jalankan `sudo certbot --nginx -d cafecampus.com` untuk mengaktifkan HTTPS.

---

## Kredensial Default:
- **Halaman Kasir**: `/admin/login`
- **Email**: `admin@cafecampus.demo` (atau sesuai `ADMIN_EMAIL` di `.env`)
- **Password**: `admin123` (atau sesuai `ADMIN_PASSWORD` di `.env`)
