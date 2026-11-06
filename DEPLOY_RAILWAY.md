# Deploy Cafe Campus Cashier ke Railway

## Sebelum deploy

1. Pastikan database service yang ditambahkan adalah **MySQL**, bukan PostgreSQL. Project ini menggunakan driver `mysql2` dan query SQL MySQL.
2. Pastikan service aplikasi dan service MySQL berada pada project/environment Railway yang sama.
3. Pada service aplikasi, buka **Variables** → **Add Reference Variable** dan hubungkan `MYSQL_URL` dari service MySQL. Contoh jika nama service database adalah `MySQL`:

   ```text
   MYSQL_URL = ${{MySQL.MYSQL_URL}}
   ```

   Gunakan nama service aktual, bukan harus persis `MySQL`.

4. Tambahkan variable berikut pada service aplikasi:

   ```text
   NODE_ENV=production
   APP_MODE=production
   JWT_SECRET=<secret-acak-minimal-32-karakter>
   ADMIN_EMAIL=<email-admin-client>
   ADMIN_PASSWORD=<password-acak-minimal-12-karakter>
   APP_URL=https://<domain-aplikasi-anda>
   ```

   Buat `JWT_SECRET` dengan `openssl rand -base64 48`. Jangan memakai nilai contoh atau mengirim secret ke orang lain. `ADMIN_EMAIL` dan `ADMIN_PASSWORD` dipakai satu kali untuk mengganti akun admin seed pada bootstrap database pertama; setelah password hash tersimpan, perubahan variable itu tidak menimpa password lagi. Jika ingin menguji mode demo terlebih dahulu, gunakan `APP_MODE=demo`, login dengan akun demo, lalu ubah password melalui menu **Pengaturan Sistem → Ubah Password** sebelum mengganti `APP_MODE=production`.

5. Biarkan Railway menggunakan `Dockerfile` dari repository. Start command harus menjalankan `npm start`, bukan langsung `node server.mjs`, karena `npm start` menyiapkan/memeriksa database sebelum server dimulai.

## Database bootstrap yang aman

Saat aplikasi dimulai, `npm start` menjalankan `scripts/prepare-database.mjs`:

- Database yang benar-benar kosong akan diisi dari `database.sql` pada database yang dipilih lewat `MYSQL_URL`.
- Database yang sudah memiliki tabel inti tidak akan diimpor ulang.
- Database yang berisi sebagian tabel inti akan membuat startup berhenti dengan pesan yang jelas, untuk mencegah data lama tertimpa.
- Script tidak menghapus tabel atau data dari database yang sudah digunakan.

Jangan menjalankan `database.sql` secara manual ke database yang sudah berisi data: dump tersebut merupakan snapshot awal dan mengandung perintah `DROP TABLE IF EXISTS`.

## Simpan file upload secara persisten

Aplikasi menulis file upload ke `public/uploads`. Pada service aplikasi di Railway, tambahkan Volume dengan **Mount Path** tepat:

```text
/app/public/uploads
```

Tanpa volume tersebut, file yang ditulis ke filesystem container di luar volume dapat hilang setelah redeploy atau penggantian container. Jika sudah ada file upload lama di deployment sebelumnya, backup/pindahkan file itu sebelum mengganti deployment.

## Verifikasi setelah deploy

1. Tunggu sampai deployment berstatus aktif dan periksa Deploy Logs.
2. Log setup database yang sukses akan diawali `[db-setup] Database siap`.
3. Buka `https://<domain-aplikasi-anda>/ready`. Respons yang diharapkan:

   ```json
   {"ok":true,"status":"ready","database":"connected"}
   ```

4. Untuk database baru yang di-bootstrap dari dump, akun demo awal:

   | Role | Email | Password |
   |---|---|---|
   | Admin | `admin@cafecampus.demo` | `admin123` |
   | Kasir | `kasir@cafecampus.demo` | `kasir123` |
   | Dapur | `dapur@cafecampus.demo` | `dapur123` |

   Kredensial di atas hanya berfungsi saat `APP_MODE=demo`. Dalam production, akun admin seed otomatis diganti melalui `ADMIN_EMAIL` dan `ADMIN_PASSWORD`, atau ubah password admin ketika masih berada dalam mode demo. Jika database sudah berisi data dan password admin sudah pernah diganti, script tidak menimpa akun tersebut. Jika database sudah berisi akun lain, gunakan akun yang sudah ada.

5. Bila `/ready` mengembalikan HTTP 503, periksa Deploy Logs dan baris `[db-setup]` atau `[database]`. Jangan menyalin password/token ke chat; bagikan hanya pesan error yang sudah disensor.

## Catatan operasional

- Aktifkan backup database Railway sebelum memasukkan data bisnis nyata.
- Atur kredensial Midtrans sesuai mode sandbox/production sebelum menerima pembayaran.
- Perbarui `APP_URL` ke domain HTTPS publik agar tautan dan callback memakai alamat yang benar.
- Jangan unggah `.env`, token, password, atau folder data upload ke repository publik.
