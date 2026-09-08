# Cafe Campus — Figma UI Review Demo v5

Demo v5 adalah versi review lokal yang menyesuaikan tampilan dengan hasil final Figma Cafe Campus sekaligus memperketat business logic. Demo ini belum untuk transaksi uang nyata atau deployment production.

## Cara menjalankan di Windows

1. Extract ZIP ke folder biasa, misalnya `Documents\Cafe-Campus-Demo-v5`.
2. Double-click `start-demo.bat`.
3. Launcher mencari Node.js 20+ di PATH/lokasi umum. Jika tidak ditemukan, Node.js LTS portable resmi disiapkan otomatis di `.runtime`.
4. Server harus lolos health-check + smoke-check sebelum browser dibuka.
5. Browser membuka `http://127.0.0.1:4176`.

Tidak membutuhkan `npm install`, Docker, database server, atau konfigurasi PATH manual.

## Akses dari HP

Launcher menampilkan URL `[MOBILE]`, misalnya `http://192.168.1.10:4176`. HP dan laptop harus berada di Wi-Fi/LAN yang sama. Jika Windows Firewall bertanya, izinkan akses pada **Private networks**.

QR meja dihasilkan dinamis menggunakan alamat LAN launcher sehingga QR dapat benar-benar discan dari HP pada jaringan yang sama.

## Login Admin Demo

- Email: `admin@cafecampus.demo`
- Password: `admin123`

## Tampilan v5

UI v5 mengikuti final Figma Cafe Campus sebagai visual source of truth:

- warm ivory `#FAF6F0`
- dark coffee brown `#3C2415`
- caramel orange `#D4702C`
- rounded cards/buttons
- customer mobile-first 320–430 px
- customer desktop menu + sticky cart
- product detail dengan customization
- cart/checkout/status/READY screen
- admin desktop sidebar
- admin mobile bottom navigation dan stacked cards
- menu/category/table/payment/report/settings yang responsive

Asset foto demo pada v5 berasal dari visual yang diberikan dalam file desain Figma user dan dipakai hanya untuk demo/review.

## Customer Flow

`QR meja → Table detected → Menu → Product detail → Cart → Checkout → Cash/QRIS sandbox → Tracking realtime → READY → Completed`

Drink customization yang tersedia pada item tertentu:

- Regular / Large (+Rp5.000)
- Normal / Less / Tanpa Gula
- Normal / Sedikit Es / Tanpa Es
- catatan item

Harga modifier dihitung ulang di server, bukan dipercaya dari browser.

## Admin Flow

`Login → Dashboard → Orders → Payment confirmation → PROCESSING → READY → COMPLETED`

Admin juga dapat:

- filter/search order
- melihat detail dan history order
- mengelola menu dan sold-out
- mengelola kategori
- mengelola meja dan rotate/download QR
- melihat pembayaran
- melihat laporan penjualan
- mengubah profil cafe, fee, tax, payment toggles, notification settings
- reset data demo

## Business Logic yang Diproteksi

- opaque QR table token
- server-side table validation
- server-side price calculation
- order item price/name/options snapshot
- stable idempotency key pada retry checkout
- sold-out validation
- archived-category validation
- duplicate category/table protection
- CASH payment confirmation sebelum processing
- payment method enable/disable enforcement
- paid order tidak dapat di-cancel tanpa refund workflow
- strict order state machine
- QR token rotation
- protected customer order access token
- protected admin API dan realtime stream
- audit trail

## Payment

`QRIS` pada demo adalah **sandbox simulation**, bukan transaksi uang nyata. Tidak ada provider palsu yang diklaim sebagai pembayaran real. Integrasi gateway resmi akan menjadi tahap production/integration berikutnya.

## Testing

Jalankan `run-tests.bat` untuk business/API regression suite. Hasil build v5 terakhir: **37/37 PASS**.

Juga tersedia `smoke-check.mjs` untuk memverifikasi health endpoint, SPA landing, public settings, products, table resolution, dan QR SVG.

## Troubleshooting

- `logs/demo-server.log` — output server
- `logs/demo-server-error.log` — error server
- `stop-demo.bat` — hentikan server
- `run-tests.bat` — jalankan QA

Jika mobile URL tidak dapat dibuka, pastikan perangkat berada di jaringan yang sama dan Windows Firewall mengizinkan Node pada Private network.
