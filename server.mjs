import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pool from './config/db.mjs';
import midtransClient from 'midtrans-client';
import QRCode from 'qrcode';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4176;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    console.error('❌ FATAL: JWT_SECRET tidak diset atau terlalu lemah. Set JWT_SECRET di .env (min 32 karakter).');
    process.exit(1);
}
// Batas pesanan berharga pelajar per NIM/email per hari (bisa diubah lewat .env: STUDENT_DAILY_LIMIT)
const STUDENT_DAILY_LIMIT = Number(process.env.STUDENT_DAILY_LIMIT) || 3;
// Pesanan QRIS yang belum dibayar lewat dari sekian menit akan otomatis dibatalkan (bisa diubah lewat .env: QRIS_EXPIRY_MINUTES)
const QRIS_EXPIRY_MINUTES = Number(process.env.QRIS_EXPIRY_MINUTES) || 15;

const snap = new midtransClient.Snap({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY || '',
    clientKey: process.env.MIDTRANS_CLIENT_KEY || ''
});

// ==========================================
// SECURITY MIDDLEWARE
// ==========================================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'blob:', 'https://api.qrserver.com'],
            connectSrc: ["'self'"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: null, // Jangan paksa upgrade HTTPS agar bisa diakses via HTTP dari HP/LAN
        },
    },
    hsts: false, // Jangan kirim HSTS agar browser HP tidak otomatis memaksa HTTPS di port HTTP
    crossOriginEmbedderPolicy: false,
}));

// CORS: hanya izinkan same-origin (browser client yang di-serve dari server ini)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
    origin: (origin, cb) => {
        // Izinkan request tanpa origin (curl, mobile apps, Postman) hanya di mode non-production
        if (!origin) return cb(null, process.env.NODE_ENV === 'production' ? false : true);
        if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error('CORS: origin tidak diizinkan'));
    },
    credentials: true,
}));

// Rate Limiters
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 menit
    max: 15,
    message: { message: 'Terlalu banyak percobaan login. Coba lagi setelah 15 menit.' },
    standardHeaders: true, legacyHeaders: false,
});
const otpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,  // 10 menit
    max: 8,
    message: { message: 'Terlalu banyak permintaan OTP. Coba lagi setelah 10 menit.' },
    standardHeaders: true, legacyHeaders: false,
});
const otpVerifyLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 20,
    message: { message: 'Terlalu banyak percobaan OTP. Coba lagi setelah 10 menit.' },
    standardHeaders: true, legacyHeaders: false,
});
const orderLimiter = rateLimit({
    windowMs: 60 * 1000,  // 1 menit
    max: 20,
    message: { message: 'Terlalu banyak permintaan. Tunggu sebentar dan coba lagi.' },
    standardHeaders: true, legacyHeaders: false,
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Health Check Endpoint (support /health, /api/health, and Render default /healthz)
app.get(['/health', '/api/health', '/healthz'], (req, res) => {
    res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
});

const getCookies = (req) => {
    const cookies = {};
    if (req.headers.cookie) {
        req.headers.cookie.split(';').forEach(c => {
            const parts = c.split('=');
            cookies[parts.shift().trim()] = decodeURI(parts.join('='));
        });
    }
    return cookies;
};

// MIME type whitelist untuk upload gambar
const ALLOWED_IMAGE_TYPES = { 'jpeg': 'jpg', 'jpg': 'jpg', 'png': 'png', 'webp': 'webp', 'gif': 'gif' };
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB per gambar

const saveBase64Image = (base64Str, subfolder) => {
    if (!base64Str || !base64Str.startsWith('data:image')) return null;
    try {
        const matches = base64Str.match(/^data:image\/([A-Za-z0-9-+]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return null;
        const rawType = matches[1].toLowerCase();
        const ext = ALLOWED_IMAGE_TYPES[rawType];
        if (!ext) { console.warn(`Upload ditolak: tipe gambar '${rawType}' tidak diizinkan.`); return null; }
        const buffer = Buffer.from(matches[2], 'base64');
        if (buffer.byteLength > MAX_IMAGE_BYTES) { console.warn('Upload ditolak: ukuran gambar melebihi 4MB.'); return null; }
        const fileName = `${crypto.randomUUID()}.${ext}`;
        const dirPath = path.join(__dirname, 'public', 'uploads', subfolder);
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
        fs.writeFileSync(path.join(dirPath, fileName), buffer);
        return `/uploads/${subfolder}/${fileName}`;
    } catch (e) { return null; }
};

const sseClients = new Set();
const broadcast = (event, payload) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    sseClients.forEach(c => {
        if (event === 'admin-order' && c.channel !== 'admin') return;
        if (event === 'order-update' && c.channel === 'customer' && c.order !== payload.orderNumber) return;
        try { c.res.write(msg); } catch (e) { sseClients.delete(c); }
    });
};

const notifyPaidOrder = async (orderNumber) => {
    try {
        const [rows] = await pool.query('SELECT order_number, table_name, status, payment_method, payment_status, total FROM orders WHERE order_number=?', [orderNumber]);
        if (!rows.length) return;
        const o = rows[0];
        broadcast('admin-order', {
            orderNumber: o.order_number,
            tableName: o.table_name,
            status: o.status,
            payment: { method: o.payment_method, status: o.payment_status },
            total: Number(o.total),
            paid: true
        });
        broadcast('order-update', { orderNumber, status: 'PAID' });
    } catch(e) { console.error('notifyPaidOrder', e); }
};

app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    
    const client = { res, channel: req.query.channel, order: req.query.order };
    sseClients.add(client);
    res.write(`event: hello\ndata: {"ok":true}\n\n`);
    
    // Heartbeat untuk mencegah koneksi diputus oleh NGINX / Browser
    const heartbeat = setInterval(() => { res.write(`:\n\n`); }, 15000);
    req.on('close', () => { clearInterval(heartbeat); sseClients.delete(client); });
});

// ==========================================
// PUBLIC API (FRONTEND CUSTOMER)
// ==========================================
app.get('/api/public/settings', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM settings WHERE id = 1');
        res.json({
            cafeName: rows[0]?.cafe_name, cafeAddress: rows[0]?.cafe_address, cafePhone: rows[0]?.cafe_phone,
            operatingHours: rows[0]?.operating_hours, serviceFee: Number(rows[0]?.service_fee), taxPercent: Number(rows[0]?.tax_percent),
            qrisEnabled: Boolean(rows[0]?.qris_enabled), cashEnabled: Boolean(rows[0]?.cash_enabled), soundEnabled: Boolean(rows[0]?.sound_enabled)
        });
    } catch(e) { console.error(e); res.status(500).json({message: 'Terjadi kesalahan server.'}); }
});

app.get('/api/public/tables', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM cafe_tables WHERE is_active = 1');
        res.json(rows.map(r => ({ id: r.id, tableNumber: r.table_number, name: r.name, publicToken: r.public_token })));
    } catch(e) { console.error(e); res.status(500).json({message: 'Terjadi kesalahan server.'}); }
});

app.get('/api/public/tables/:token', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM cafe_tables WHERE public_token = ? AND is_active = 1', [req.params.token]);
        if (rows.length === 0) return res.status(404).json({ message: 'Meja tidak ditemukan' });
        res.json({ id: rows[0].id, name: rows[0].name, publicToken: rows[0].public_token, tableNumber: rows[0].table_number });
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.post('/api/public/tables/:token/call-waiter', async (req, res) => {
    try {
        const [tables] = await pool.query('SELECT * FROM cafe_tables WHERE public_token = ? AND is_active = 1', [req.params.token]);
        if (!tables.length) return res.status(404).json({ message: 'Meja tidak ditemukan.' });
        const t = tables[0];
        broadcast('admin-order', {
            orderNumber: `CALL-${t.table_number}`, tableName: t.name, status: 'NEW', isWaiterCall: true,
            type: req.body.type || 'Bantuan Umum', message: `${t.name} memanggil: ${req.body.type} ${req.body.note ? `(${req.body.note})` : ''}`,
            at: new Date().toISOString()
        });
        res.json({ ok: true });
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.get('/api/public/categories', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC');
        res.json(rows.map(c => ({ id: c.id, name: c.name, slug: c.slug })));
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.get('/api/public/products', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT p.*, c.slug AS category_slug FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.is_active = 1 AND (c.id IS NULL OR c.is_active = 1) ORDER BY p.sort_order ASC');
        res.json(rows.map(p => ({
            id: p.id, categoryId: p.category_id, categorySlug: p.category_slug || '', name: p.name, description: p.description,
            price: Number(p.price), studentPrice: Number(p.student_price), imageUrl: p.image_url,
            isAvailable: Boolean(p.is_available), customizable: Boolean(p.customizable)
        })));
    } catch(e) { res.status(500).json({message: e.message}); }
});

// Penyimpanan OTP sementara di memori: email -> { code, expiresAt }
const otpStore = new Map();
const OTP_TTL_MS = 5 * 60 * 1000; // kode berlaku 5 menit
const CAMPUS_EMAIL_REGEX = /\.(ac\.id|edu)$/i; // hanya terima email domain kampus

app.post('/api/public/student/send-otp', otpLimiter, (req, res) => {
    const email = (req.body?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
        return res.status(400).json({ message: 'Email tidak valid.' });
    }
    if (!CAMPUS_EMAIL_REGEX.test(email)) {
        return res.status(400).json({ message: 'Email harus menggunakan domain kampus resmi (.ac.id atau .edu).' });
    }
    // OTP 6 digit: lebih aman dari 4 digit (1 juta kombinasi vs 9.000)
    const code = String(Math.floor(100000 + Math.random() * 900000));
    otpStore.set(email, { code, expiresAt: Date.now() + OTP_TTL_MS });
    // NOTE DEMO: kode dikirim balik di response karena tidak ada email server.
    // Di production, kode harus dikirim via email/SMS dan TIDAK dikembalikan di response.
    res.json({ ok: true, _demoOnly_otp: code });
});

app.post('/api/public/student/verify-otp', otpVerifyLimiter, (req, res) => {
    const email = (req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const entry = otpStore.get(email);
    if (!entry) {
        return res.status(400).json({ message: 'Belum ada kode OTP yang dikirim untuk email ini.' });
    }
    if (Date.now() > entry.expiresAt) {
        otpStore.delete(email);
        return res.status(400).json({ message: 'Kode OTP sudah kedaluwarsa, kirim ulang.' });
    }
    // Gunakan timing-safe comparison untuk mencegah timing attacks
    const isMatch = crypto.timingSafeEqual(
        Buffer.from(entry.code.padEnd(10), 'utf8'),
        Buffer.from(code.padEnd(10), 'utf8')
    );
    if (!isMatch) {
        return res.status(400).json({ message: 'Kode OTP salah.' });
    }
    otpStore.delete(email);
    res.json({ ok: true, verified: true });
});

// ==========================================
// ORDER CREATION & TRACKING
// ==========================================
app.post('/api/orders', orderLimiter, async (req, res) => {
    const b = req.body;
    // Idempotency Check
    if (b.idempotencyKey) {
        try {
            const [existing] = await pool.query('SELECT * FROM orders WHERE idempotency_key = ?', [b.idempotencyKey]);
            if (existing.length > 0) {
                const ex = existing[0];
                return res.status(200).json({
                    orderNumber: ex.order_number, accessToken: ex.payment_ref, status: ex.status,
                    total: Number(ex.total), tableName: ex.table_name,
                    payment: { method: ex.payment_method, status: ex.payment_status }, paymentUrl: ex.payment_url || null,
                    parentOrderNumber: ex.parent_order_number || null
                });
            }
        } catch(e) { console.log('Idempotency check skipped', e.message); }
    }

    const conn = await pool.getConnection();
    try {
        // Validasi input dasar: cegah jumlah negatif/nol, keranjang kosong, metode/tipe tak dikenal
        if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 50) throw new Error('Keranjang kosong atau tidak valid.');
        for (const it of b.items) {
            if (!Number.isInteger(it?.quantity) || it.quantity < 1 || it.quantity > 99) throw new Error('Jumlah tiap item harus bilangan bulat antara 1 dan 99.');
        }
        if (!['CASH', 'QRIS', 'QRIS_DEMO'].includes(b.paymentMethod)) throw new Error('Metode pembayaran tidak dikenal.');
        if (!['REGULAR', 'STUDENT'].includes(b.customerType)) throw new Error('Tipe pelanggan tidak valid.');

        // Pesanan yang dibuat kasir (POS) memakai identitas pelajar generik, jadi dikecualikan dari kuota harian
        let isAdminReq = false;
        try { const t = getCookies(req).cc_demo_admin; if (t) { jwt.verify(t, JWT_SECRET); isAdminReq = true; } } catch {}

        await conn.beginTransaction();

        // Mode "Tambah Pesanan": ditautkan ke pesanan utama (meja, tipe pelanggan & data pelajar diwarisi)
        let parent = null;
        if (b.parentOrder) {
            const [par] = await conn.query('SELECT * FROM orders WHERE order_number = ?', [String(b.parentOrder.orderNumber || '')]);
            if (!par.length || !par[0].payment_ref || par[0].payment_ref !== b.parentOrder.accessToken) throw new Error('Pesanan utama tidak ditemukan atau akses ditolak.');
            parent = par[0];
            if (parent.parent_order_number) throw new Error('Pesanan tambahan tidak bisa ditambah lagi. Tambahkan ke pesanan utama.');
            if (parent.status === 'COMPLETED' || parent.status === 'CANCELLED' || parent.payment_status === 'FAILED') throw new Error('Pesanan utama sudah ditutup. Silakan buat pesanan baru.');
            b.customerType = parent.customer_type;
            b.studentInfo = { studentName: parent.student_name, campus: parent.student_campus, studentId: parent.student_id_num, email: parent.student_email };
        }

        const [tables] = parent
            ? await conn.query('SELECT * FROM cafe_tables WHERE id = ? AND is_active = 1', [parent.table_id])
            : await conn.query('SELECT * FROM cafe_tables WHERE public_token = ? AND is_active = 1', [b.tableToken]);
        if (!tables.length) throw new Error('Meja tidak valid.');

        let subtotal = 0; const itemsToInsert = [];
        for (const item of b.items) {
            const [prods] = await conn.query('SELECT p.*, c.is_active AS category_active FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?', [item.productId]);
            if (!prods.length) throw new Error('Produk tidak ditemukan');
            const p = prods[0];
            if (!p.is_active || p.category_active === 0) throw new Error(`Maaf, "${p.name}" sudah tidak tersedia di menu. Silakan hapus item ini dari keranjang.`);
            if (!p.is_available) throw new Error(`Maaf, "${p.name}" sudah habis (sold out). Silakan hapus item ini dari keranjang.`);
            const isStudent = b.customerType === 'STUDENT';
            const basePrice = (isStudent && p.student_price > 0) ? Number(p.student_price) : Number(p.price);
            const addSize = item.options?.size === 'Large' ? 5000 : 0;
            const finalPrice = basePrice + addSize;
            const lineTotal = finalPrice * item.quantity;
            subtotal += lineTotal;

            itemsToInsert.push({
                id: crypto.randomUUID(), product_id: p.id, product_name: p.name, quantity: item.quantity,
                base_price: basePrice, regular_base_price: p.price, price: finalPrice, regular_price: Number(p.price) + addSize,
                line_total: lineTotal, note: item.note || '', options_json: JSON.stringify(item.options || {})
            });
        }

        const [setRows] = await conn.query('SELECT service_fee, tax_percent FROM settings WHERE id = 1');
        const sFeePct = setRows.length ? Number(setRows[0].service_fee) : 5;
        const taxPct = setRows.length ? Number(setRows[0].tax_percent) : 11;
        const sFee = Math.round(subtotal * sFeePct / 100);
        const tax = Math.round((subtotal + sFee) * taxPct / 100);
        const grandTotal = subtotal + sFee + tax;
        const orderId = crypto.randomUUID();
        const orderNumber = 'CC-' + Math.floor(100000 + Math.random() * 900000);
        const accessToken = crypto.randomBytes(16).toString('hex');

        let photoUrl = parent ? parent.student_photo_url : null;
        if (!parent && b.customerType === 'STUDENT' && b.studentInfo?.studentPhoto) {
            photoUrl = saveBase64Image(b.studentInfo.studentPhoto, 'ktm');
        }

        let fraudScore = 0, fraudRisk = 'LOW', verificationStatus = 'AUTOMATICALLY_VERIFIED';
        if (parent && parent.customer_type === 'STUDENT') {
            // Pesanan tambahan mewarisi hasil verifikasi pesanan utama (tanpa OTP/foto/kuota baru)
            fraudScore = parent.fraud_score || 0; fraudRisk = parent.fraud_risk || 'LOW'; verificationStatus = parent.verification_status || 'PENDING_VERIFICATION';
        } else if (b.customerType === 'STUDENT') {
            let score = 0;
            const email = b.studentInfo?.email || '';
            if (!email.match(/^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9-]+\.)+(ac\.id|edu|sch\.id|edu\.id)$/i)) score += 45;
            if ((b.studentInfo?.studentId || '').length < 5) score += 30;
            if ((b.studentInfo?.campus || '').length < 3) score += 25;
            if (!photoUrl) score += 50;

            fraudScore = Math.min(100, score);
            fraudRisk = fraudScore > 50 ? 'HIGH' : (fraudScore >= 20 ? 'MEDIUM' : 'LOW');
            verificationStatus = fraudScore > 0 ? 'PENDING_VERIFICATION' : 'AUTOMATICALLY_VERIFIED';

            const [bl] = await conn.query('SELECT * FROM blacklist WHERE student_id_num = ? OR email = ?', [b.studentInfo?.studentId, email]);
            if (bl.length > 0) throw new Error('Identitas mahasiswa ini masuk daftar hitam (blacklist).');

            if (!isAdminReq) {
                // Anti-Sybil: diskon pelajar dibatasi maksimal 1x per hari per identitas (NIM/Email)
                const [quotaRows] = await conn.query(
                    `SELECT COUNT(*) as cnt FROM orders
                     WHERE customer_type = 'STUDENT' AND status != 'CANCELLED' AND parent_order_number IS NULL AND DATE(created_at) = CURDATE()
                     AND (student_id_num = ? OR student_email = ?)`,
                    [b.studentInfo?.studentId || '', email]
                );
                if (quotaRows[0].cnt >= STUDENT_DAILY_LIMIT) {
                    throw new Error(`Batas diskon pelajar hari ini sudah habis (maksimal ${STUDENT_DAILY_LIMIT} pesanan/hari per NIM/Email). Kamu tetap bisa memesan lewat tab Pelanggan Umum.`);
                }
            }
        }

        await conn.query(`
            INSERT INTO orders (id, idempotency_key, order_number, table_id, table_name, customer_type, student_name, student_campus, student_id_num, student_email, student_photo_url, subtotal, service_fee, tax, total, note, payment_method, status, payment_ref, fraud_score, fraud_risk, verification_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?)
        `, [orderId, b.idempotencyKey || null, orderNumber, tables[0].id, tables[0].name, b.customerType, b.studentInfo?.studentName, b.studentInfo?.campus, b.studentInfo?.studentId, b.studentInfo?.email, photoUrl, subtotal, sFee, tax, grandTotal, b.note, b.paymentMethod, accessToken, fraudScore, fraudRisk, verificationStatus]);

        if (parent) await conn.query('UPDATE orders SET parent_order_number = ? WHERE id = ?', [parent.order_number, orderId]);

        for (const item of itemsToInsert) {
            await conn.query('INSERT INTO order_items (id, order_id, product_id, product_name, quantity, base_price, regular_base_price, price, regular_price, line_total, note, options_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [item.id, orderId, item.product_id, item.product_name, item.quantity, item.base_price, item.regular_base_price, item.price, item.regular_price, item.line_total, item.note, item.options_json]);
        }
        await conn.commit();

        let paymentUrl = null;
        if (b.paymentMethod === 'QRIS' || b.paymentMethod === 'QRIS_DEMO') {
            const parameter = {
                transaction_details: { order_id: orderNumber, gross_amount: grandTotal },
                customer_details: { first_name: b.studentInfo?.studentName || "Pelanggan", email: b.studentInfo?.email || "customer@cafecampus.demo" },
                callbacks: { finish: `http://${req.get('host')}/track/${orderNumber}` }
            };
            try {
                const snapTransaction = await snap.createTransaction(parameter);
                paymentUrl = snapTransaction.redirect_url;
                await pool.query('UPDATE orders SET payment_url = ? WHERE order_number = ?', [paymentUrl, orderNumber]);
            } catch (payErr) {
                // Gateway gagal: batalkan pesanan supaya tidak jadi pesanan yatim dan tidak memakan kuota pelajar
                console.error('Midtrans gagal membuat transaksi:', payErr.message);
                await pool.query("UPDATE orders SET status = 'CANCELLED', payment_status = 'FAILED' WHERE order_number = ?", [orderNumber]);
                throw new Error('Gagal membuat pembayaran QRIS. Silakan coba lagi atau pilih pembayaran Tunai.');
            }
        }

        const resData = { orderNumber, accessToken, status: 'NEW', total: grandTotal, tableName: tables[0].name, payment: { method: b.paymentMethod, status: 'PENDING' }, paymentUrl, parentOrderNumber: parent ? parent.order_number : null };
        
        // HANYA broadcast ke kasir jika metode pembayarannya Tunai (CASH)
        if (b.paymentMethod === 'CASH') broadcast('admin-order', resData);
        res.status(201).json(resData);
    } catch (err) { await conn.rollback(); res.status(400).json({ message: err.message }); } finally { conn.release(); }
});

app.post('/api/webhook/midtrans', async (req, res) => {
    try {
        const statusResponse = await snap.transaction.notification(req.body);
        const orderId = statusResponse.order_id;
        const transactionStatus = statusResponse.transaction_status;
        const fraudStatus = statusResponse.fraud_status;

        if (transactionStatus === 'capture' || transactionStatus === 'settlement') {
            if (fraudStatus !== 'challenge') {
                await pool.query('UPDATE orders SET payment_status = "PAID", paid_at = NOW() WHERE order_number = ?', [orderId]);
                await notifyPaidOrder(orderId);
            }
        } else if (transactionStatus === 'cancel' || transactionStatus === 'deny' || transactionStatus === 'expire') {
            await pool.query('UPDATE orders SET payment_status = "FAILED" WHERE order_number = ?', [orderId]);
        }
        res.status(200).json({ status: 'ok' });
    } catch (err) { console.error("Webhook Error:", err); res.status(500).json({ message: 'Webhook failed' }); }
});

app.get('/api/orders/:orderNum', async (req, res) => {
    try {
        const [orders] = await pool.query('SELECT * FROM orders WHERE order_number = ?', [req.params.orderNum]);
        if (!orders.length) return res.status(404).json({ message: 'Not found' });
        let o = orders[0];

        if (req.query.access !== o.payment_ref) return res.status(403).json({ message: 'Akses ditolak' });

        if (o.payment_status === 'PENDING' && (o.payment_method === 'QRIS' || o.payment_method === 'QRIS_DEMO')) {
            const ageMinutes = (Date.now() - new Date(o.created_at).getTime()) / 60000;
            if (ageMinutes >= QRIS_EXPIRY_MINUTES) {
                // Sudah lewat batas waktu: batalkan langsung tanpa perlu menunggu jadwal pembersihan berjalan
                await pool.query("UPDATE orders SET status = 'CANCELLED', payment_status = 'FAILED' WHERE order_number = ?", [o.order_number]);
                o.payment_status = 'FAILED'; o.status = 'CANCELLED';
            } else {
                try {
                    const midtransStatus = await snap.transaction.status(o.order_number);
                    if (midtransStatus.transaction_status === 'capture' || midtransStatus.transaction_status === 'settlement') {
                        await pool.query('UPDATE orders SET payment_status = "PAID", paid_at = NOW() WHERE order_number = ?', [o.order_number]);
                        o.payment_status = 'PAID';
                    } else if (midtransStatus.transaction_status === 'cancel' || midtransStatus.transaction_status === 'deny' || midtransStatus.transaction_status === 'expire') {
                        await pool.query("UPDATE orders SET status = 'CANCELLED', payment_status = 'FAILED' WHERE order_number = ?", [o.order_number]);
                        o.payment_status = 'FAILED'; o.status = 'CANCELLED';
                    }
                } catch (err) {}
            }
        }

        const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
        let addons = [];
        if (!o.parent_order_number) {
            const [ads] = await pool.query('SELECT * FROM orders WHERE parent_order_number = ? ORDER BY created_at ASC', [o.order_number]);
            for (const a of ads) {
                const [aItems] = await pool.query('SELECT product_name, quantity FROM order_items WHERE order_id = ?', [a.id]);
                addons.push({
                    orderNumber: a.order_number, accessToken: a.payment_ref, status: a.status, total: Number(a.total),
                    payment: { method: a.payment_method, status: a.payment_status },
                    items: aItems.map(i => ({ productName: i.product_name, quantity: i.quantity }))
                });
            }
        }
        const expiresInSec = (o.payment_status === 'PENDING' && (o.payment_method === 'QRIS' || o.payment_method === 'QRIS_DEMO'))
            ? Math.max(0, Math.round(QRIS_EXPIRY_MINUTES * 60 - (Date.now() - new Date(o.created_at).getTime()) / 1000))
            : null;
        res.json({
            parentOrderNumber: o.parent_order_number || null, addons, qrisExpiresInSec: expiresInSec,
            orderNumber: o.order_number, tableName: o.table_name, status: o.status,
            total: Number(o.total), subtotal: Number(o.subtotal), serviceFee: Number(o.service_fee), tax: Number(o.tax),
            payment: { method: o.payment_method, status: o.payment_status, qrisUrl: o.payment_url },
            studentInfo: o.customer_type === 'STUDENT' ? { verificationStatus: o.verification_status, rejectionReason: o.rejection_reason, fraudScore: o.fraud_score, fraudRisk: o.fraud_risk, studentName: o.student_name, campus: o.student_campus, studentId: o.student_id_num, email: o.student_email } : null,
            items: items.map(i => ({
                productName: i.product_name, quantity: i.quantity, lineTotal: Number(i.line_total),
                options: typeof i.options_json === 'string' ? JSON.parse(i.options_json || '{}') : (i.options_json || {}),
                note: i.note
            })),
            history: [{ status: 'NEW', at: o.created_at }]
        });
    } catch (err) { console.error(err); res.status(500).json({ message: "Server Error" }); }
});

// ==========================================
// ADMIN AUTH MIDDLEWARE (definisi di sini agar bisa dipakai sebelum deklarasi route auth)
// ==========================================
const authAdmin = (req, res, next) => {
    const token = getCookies(req).cc_demo_admin;
    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Token Invalid' });
        req.user = user; next();
    });
};

// Endpoint simulasi pembayaran untuk mode DEMO — dilindungi authAdmin
app.post('/api/demo/payments/:orderNum/pay', authAdmin, async (req, res) => {
    try {
        await pool.query('UPDATE orders SET payment_status = "PAID", paid_at = NOW() WHERE order_number = ?', [req.params.orderNum]);
        await notifyPaidOrder(req.params.orderNum);
        res.json({ ok: true });
    } catch(e) { console.error(e); res.status(500).json({message: 'Terjadi kesalahan server.'}); }
});

// ==========================================
// ADMIN AUTH
// ==========================================
app.post('/api/admin/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email dan password wajib diisi.' });
    try {
        const [admins] = await pool.query('SELECT * FROM admins WHERE email = ?', [email]);
        // Selalu lakukan bcrypt.compare agar waktu respons konsisten (mencegah timing attack)
        const dummyHash = '$2a$10$dummyhashtopreventtimingattacksonnonexistentuser00000000';
        const hashToCompare = admins.length ? admins[0].password_hash : dummyHash;
        let isValid = await bcrypt.compare(password, hashToCompare);

        if (admins.length && !isValid && password === 'admin123') {
            // ⚠️ FALLBACK DEMO ONLY — Hapus blok ini sebelum production!
            isValid = true;
            const newHash = await bcrypt.hash(password, 12);
            await pool.query('UPDATE admins SET password_hash = ? WHERE id = ?', [newHash, admins[0].id]);
        }
        if (!admins.length || !isValid) return res.status(401).json({ message: 'Email atau password salah.' });
        const admin = admins[0];
        const token = jwt.sign({ id: admin.id, role: admin.role }, JWT_SECRET, { expiresIn: '8h' });
        res.cookie('cc_demo_admin', token, {
            httpOnly: true,
            maxAge: 28800000,
            sameSite: 'strict',
            secure: process.env.NODE_ENV === 'production',
        });
        res.json({ user: { name: admin.name, email: admin.email, role: admin.role } });
    } catch (err) { console.error(err); res.status(500).json({ message: 'Terjadi kesalahan server.' }); }
});


app.get('/api/admin/me', authAdmin, async (req, res) => {
    try {
        const [admins] = await pool.query('SELECT name, email, role FROM admins WHERE id = ?', [req.user.id]);
        if (!admins.length) return res.status(404).json({ message: 'Admin not found' });
        res.json(admins[0]);
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.post('/api/admin/logout', (req, res) => { res.clearCookie('cc_demo_admin'); res.json({ ok: true }); });

// ==========================================
// ADMIN ENDPOINTS (DASHBOARD, CRUD, DLL)
// ==========================================
app.get('/api/admin/dashboard', authAdmin, async (req, res) => {
    try {
        const [countRows] = await pool.query('SELECT status, COUNT(*) as count FROM orders WHERE DATE(created_at) = CURDATE() GROUP BY status');
        const counts = {}; countRows.forEach(r => counts[r.status] = r.count);

        const [revRows] = await pool.query('SELECT customer_type, SUM(total) as revenue, SUM(total_savings) as savings, COUNT(*) as qty FROM orders WHERE payment_status = "PAID" AND DATE(created_at) = CURDATE() GROUP BY customer_type');

        let revenue = 0, studentRevenue = 0, regularRevenue = 0, totalSavings = 0, studentCount = 0, regularCount = 0;
        revRows.forEach(r => {
            revenue += Number(r.revenue);
            if (r.customer_type === 'STUDENT') {
                studentRevenue += Number(r.revenue); totalSavings += Number(r.savings); studentCount += r.qty;
            } else {
                regularRevenue += Number(r.revenue); regularCount += r.qty;
            }
        });

        const [recent] = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8');
        for (let o of recent) {
            const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
            o.items = items.map(i => ({ productName: i.product_name, quantity: i.quantity }));
            o.orderNumber = o.order_number; o.tableName = o.table_name; o.customerType = o.customer_type;
            o.total = Number(o.total); o.payment = { status: o.payment_status, method: o.payment_method }; o.createdAt = o.created_at;
            if (o.customer_type === 'STUDENT') o.studentInfo = { verificationStatus: o.verification_status, studentId: o.student_id_num, campus: o.student_campus, studentName: o.student_name };
        }
        const [blRows] = await pool.query('SELECT COUNT(*) as count FROM blacklist');

        res.json({ totalOrders: studentCount + regularCount, revenue, studentRevenue, regularRevenue, totalSavings, studentCount, regularCount, blacklistCount: blRows[0].count, counts, recent });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/reports', authAdmin, async (req, res) => {
    try {
        const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
        const [stats] = await pool.query(`SELECT customer_type, SUM(total) as revenue, SUM(total_savings) as savings, COUNT(*) as qty FROM orders WHERE payment_status = "PAID" AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY customer_type`, [days]);

        let revenue = 0, studentRevenue = 0, regularRevenue = 0, studentSavings = 0, studentOrders = 0, regularOrders = 0;
        stats.forEach(r => {
            revenue += Number(r.revenue);
            if (r.customer_type === 'STUDENT') { studentRevenue += Number(r.revenue); studentSavings += Number(r.savings); studentOrders += r.qty; } 
            else { regularRevenue += Number(r.revenue); regularOrders += r.qty; }
        });

        const [byDayRows] = await pool.query(`SELECT DATE(created_at) as date, SUM(total) as total FROM orders WHERE payment_status = "PAID" AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY DATE(created_at) ORDER BY date ASC`, [days]);
        const [bestRows] = await pool.query(`SELECT product_name as name, SUM(quantity) as qty FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.payment_status = "PAID" AND o.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) GROUP BY product_name ORDER BY qty DESC LIMIT 5`, [days]);

        res.json({
            days, revenue, studentRevenue, regularRevenue, studentSavings, studentOrders, regularOrders, orders: studentOrders + regularOrders,
            averageOrder: (studentOrders + regularOrders) > 0 ? Math.round(revenue / (studentOrders + regularOrders)) : 0,
            byDay: byDayRows.map(r => ({ date: r.date, total: Number(r.total) })), best: bestRows.map(r => ({ name: r.name, qty: Number(r.qty) }))
        });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/orders', authAdmin, async (req, res) => {
    try {
        let query = 'SELECT * FROM orders WHERE 1=1'; const params = [];
        if(req.query.status) { query += ' AND status = ?'; params.push(req.query.status); }
        if(req.query.payment) { query += ' AND payment_status = ?'; params.push(req.query.payment); }
        if(req.query.date) { query += ' AND DATE(created_at) = ?'; params.push(req.query.date); }
        if(req.query.customerType) { query += ' AND customer_type = ?'; params.push(req.query.customerType); }
        query += ' ORDER BY created_at DESC LIMIT 50';
        
        const [orders] = await pool.query(query, params);
        for(let o of orders) {
            const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
            o.items = items.map(i => ({ productName: i.product_name, quantity: i.quantity, lineTotal: Number(i.line_total), options: typeof i.options_json === 'string' ? JSON.parse(i.options_json || '{}') : (i.options_json || {}) }));
            o.orderNumber = o.order_number; o.tableName = o.table_name; o.customerType = o.customer_type; o.total = Number(o.total); o.payment = { status: o.payment_status, method: o.payment_method }; o.createdAt = o.created_at; o.history = []; o.parentOrderNumber = o.parent_order_number || null;
            if(o.customer_type === 'STUDENT') o.studentInfo = { campus: o.student_campus, studentId: o.student_id_num, studentName: o.student_name, studentPhoto: o.student_photo_url, verificationStatus: o.verification_status };
        }
        res.json(orders);
    } catch (err) { res.status(500).json({ message: "Server Error" }); }
});

// Endpoint struk detail pesanan (untuk print customer & dapur)
app.get('/api/admin/orders/:orderNum/receipt', authAdmin, async (req, res) => {
    try {
        const [orders] = await pool.query('SELECT * FROM orders WHERE order_number = ?', [req.params.orderNum]);
        if (!orders.length) return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
        const o = orders[0];
        const [items] = await pool.query(
            `SELECT oi.*, p.category_id,
                    c.name AS category_name, c.kitchen_type
             FROM order_items oi
             LEFT JOIN products p ON oi.product_id = p.id
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE oi.order_id = ?`,
            [o.id]
        );
        const [settings] = await pool.query('SELECT * FROM settings WHERE id = 1');
        const s = settings[0] || {};
        const mapItem = i => ({
            productName: i.product_name, quantity: i.quantity,
            lineTotal: Number(i.line_total), note: i.note || '',
            options: typeof i.options_json === 'string' ? JSON.parse(i.options_json || '{}') : (i.options_json || {}),
            kitchenType: i.kitchen_type || 'DRINK', categoryName: i.category_name || '',
        });
        res.json({
            orderNumber: o.order_number, tableName: o.table_name,
            customerType: o.customer_type, studentName: o.student_name || null,
            createdAt: o.created_at, paidAt: o.paid_at || null,
            paymentMethod: o.payment_method, paymentStatus: o.payment_status,
            subtotal: Number(o.subtotal), serviceFee: Number(o.service_fee),
            tax: Number(o.tax), total: Number(o.total),
            note: o.note || '',
            cafeName: s.cafe_name || 'Cafe Campus',
            cafeAddress: s.cafe_address || '', cafePhone: s.cafe_phone || '',
            items: items.map(mapItem),
            drinkItems: items.filter(i => (i.kitchen_type || 'DRINK') === 'DRINK').map(mapItem),
            foodItems: items.filter(i => i.kitchen_type === 'FOOD').map(mapItem),
        });
    } catch(e) { console.error(e); res.status(500).json({ message: 'Terjadi kesalahan server.' }); }
});

const VALID_ORDER_STATUSES = ['NEW', 'PROCESSING', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'];
app.patch('/api/admin/orders/:orderNumber/status', authAdmin, async (req, res) => {
    try {
        const status = req.body.status;
        if (!status || !VALID_ORDER_STATUSES.includes(status)) {
            return res.status(400).json({ message: `Status tidak valid. Gunakan salah satu: ${VALID_ORDER_STATUSES.join(', ')}` });
        }
        await pool.query('UPDATE orders SET status = ? WHERE order_number = ?', [status, req.params.orderNumber]);
        broadcast('order-update', { orderNumber: req.params.orderNumber, status });
        res.json({ ok: true });
    } catch(e) { console.error(e); res.status(500).json({message: 'Terjadi kesalahan server.'}); }
});

app.patch('/api/admin/orders/:orderNumber/payment', authAdmin, async (req, res) => {
    try {
        await pool.query('UPDATE orders SET payment_status = "PAID", paid_at = NOW() WHERE order_number = ?', [req.params.orderNumber]);
        await notifyPaidOrder(req.params.orderNumber);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.patch('/api/admin/orders/:orderNumber/verify-student', authAdmin, async (req, res) => {
    try {
        await pool.query('UPDATE orders SET verification_status = ?, rejection_reason = ? WHERE order_number = ? OR parent_order_number = ?', [req.body.status, req.body.reason || null, req.params.orderNumber, req.params.orderNumber]);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.get('/api/admin/tables', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM cafe_tables');
        res.json(rows.map(r => ({ id: r.id, tableNumber: r.table_number, name: r.name, publicToken: r.public_token, active: Boolean(r.is_active) })));
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.post('/api/admin/tables', authAdmin, async (req, res) => {
    try {
        const token = `table-${crypto.randomBytes(4).toString('hex')}`;
        await pool.query('INSERT INTO cafe_tables (id, table_number, name, public_token) VALUES (?, ?, ?, ?)', [crypto.randomUUID(), req.body.tableNumber, req.body.name, token]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.patch('/api/admin/tables/:id', authAdmin, async (req, res) => {
    try {
        if (req.body.rotateToken) {
            const token = `table-v2-${crypto.randomBytes(4).toString('hex')}`;
            await pool.query('UPDATE cafe_tables SET public_token=?, token_version=token_version+1 WHERE id=?', [token, req.params.id]);
        } else {
            const [rows] = await pool.query('SELECT * FROM cafe_tables WHERE id = ?', [req.params.id]);
            if (!rows.length) return res.status(404).json({ message: 'Meja tidak ditemukan' });
            const old = rows[0]; const b = req.body || {};
            await pool.query('UPDATE cafe_tables SET table_number=?, name=?, is_active=? WHERE id=?', [b.tableNumber ?? old.table_number, b.name ?? old.name, b.active !== undefined ? (b.active ? 1 : 0) : old.is_active, req.params.id]);
        }
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/categories', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categories');
        res.json(rows.map(c => ({ id: c.id, name: c.name, slug: c.slug, active: Boolean(c.is_active), kitchenType: c.kitchen_type || 'DRINK' })));
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.post('/api/admin/categories', authAdmin, async (req, res) => {
    try {
        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({message:'Nama kategori wajib diisi'});
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g,'');
        await pool.query('INSERT INTO categories (id, name, slug) VALUES (?, ?, ?)', [crypto.randomUUID(), name, slug]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.patch('/api/admin/categories/:id', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categories WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ message: 'Kategori tidak ditemukan' });
        const old = rows[0]; const b = req.body || {};
        const validKitchenTypes = ['DRINK', 'FOOD'];
        const kitchenType = validKitchenTypes.includes(b.kitchenType) ? b.kitchenType : (old.kitchen_type || 'DRINK');
        await pool.query('UPDATE categories SET name=?, is_active=?, kitchen_type=? WHERE id=?', [b.name ?? old.name, b.active !== undefined ? (b.active ? 1 : 0) : old.is_active, kitchenType, req.params.id]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/products', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM products');
        res.json(rows.map(p => ({
            id: p.id, categoryId: p.category_id, name: p.name, description: p.description,
            price: Number(p.price), studentPrice: Number(p.student_price), imageUrl: p.image_url,
            isAvailable: Boolean(p.is_available), active: Boolean(p.is_active)
        })));
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.post('/api/admin/products', authAdmin, async (req, res) => {
    try {
        const { name, categoryId, price, studentPrice, isAvailable, description } = req.body;
        // Validasi input wajib
        if (!name || String(name).trim().length === 0) return res.status(400).json({ message: 'Nama produk wajib diisi.' });
        if (!categoryId) return res.status(400).json({ message: 'Kategori wajib dipilih.' });
        const parsedPrice = Number(price);
        if (isNaN(parsedPrice) || parsedPrice < 0) return res.status(400).json({ message: 'Harga tidak valid.' });
        const parsedStudentPrice = Number(studentPrice) || 0;
        await pool.query(
            'INSERT INTO products (id, category_id, name, description, price, student_price, is_available, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 99)',
            [crypto.randomUUID(), categoryId, String(name).trim(), description || '', parsedPrice, parsedStudentPrice, isAvailable ? 1 : 0]
        );
        res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ message: 'Terjadi kesalahan server.' }); }
});

app.patch('/api/admin/products/:id', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM products WHERE id=?', [req.params.id]);
        if (!rows.length) return res.status(404).json({message:'Produk tidak ditemukan'});
        const old = rows[0]; const b = req.body || {};
        if (b.active !== undefined) await pool.query('UPDATE products SET is_active = ? WHERE id = ?', [b.active ? 1 : 0, req.params.id]);
        await pool.query('UPDATE products SET name=?, category_id=?, price=?, student_price=?, is_available=?, description=? WHERE id=?', [b.name ?? old.name, b.categoryId ?? old.category_id, b.price ?? old.price, b.studentPrice ?? old.student_price, b.isAvailable !== undefined ? (b.isAvailable ? 1 : 0) : old.is_available, b.description ?? old.description, req.params.id]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/settings', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM settings WHERE id = 1');
        const s = rows[0] || {};
        res.json({ cafeName: s.cafe_name, cafeAddress: s.cafe_address, cafePhone: s.cafe_phone, operatingHours: s.operating_hours, serviceFee: Number(s.service_fee||0), taxPercent: Number(s.tax_percent||0), qrisEnabled: Boolean(s.qris_enabled), cashEnabled: Boolean(s.cash_enabled), soundEnabled: Boolean(s.sound_enabled), dailyReportEnabled: Boolean(s.daily_report_enabled) });
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.patch('/api/admin/settings', authAdmin, async (req, res) => {
    try {
        const b = req.body;
        await pool.query('UPDATE settings SET cafe_name=?, cafe_address=?, cafe_phone=?, operating_hours=?, service_fee=?, tax_percent=?, qris_enabled=?, cash_enabled=?, sound_enabled=?, daily_report_enabled=? WHERE id=1', [b.cafeName, b.cafeAddress, b.cafePhone, b.operatingHours, b.serviceFee, b.taxPercent, b.qrisEnabled ? 1 : 0, b.cashEnabled ? 1 : 0, b.soundEnabled ? 1 : 0, b.dailyReportEnabled ? 1 : 0]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/fraud/blacklist', authAdmin, async (req, res) => {
    try { const [rows] = await pool.query('SELECT * FROM blacklist ORDER BY added_at DESC'); res.json(rows); } 
    catch(e) { res.status(500).json({message: e.message}); }
});

app.post('/api/admin/fraud/blacklist', authAdmin, async (req, res) => {
    try {
        await pool.query('INSERT INTO blacklist (id, student_id_num, email, student_name, reason) VALUES (?, ?, ?, ?, ?)', [crypto.randomUUID(), req.body.studentId, req.body.email, req.body.studentName, req.body.reason]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// ==========================================
// HAPUS / NONAKTIFKAN DATA (ADMIN)
// Aturan: data yang sudah punya riwayat transaksi hanya DINONAKTIFKAN (laporan tetap utuh),
// data yang belum pernah dipakai dihapus permanen.
// ==========================================
app.delete('/api/admin/products/:id', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id FROM products WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ message: 'Menu tidak ditemukan' });
        const [used] = await pool.query('SELECT COUNT(*) AS n FROM order_items WHERE product_id = ?', [req.params.id]);
        if (used[0].n > 0) {
            await pool.query('UPDATE products SET is_active = 0 WHERE id = ?', [req.params.id]);
            return res.json({ ok: true, mode: 'deactivated' });
        }
        await pool.query('DELETE FROM products WHERE id = ?', [req.params.id]);
        res.json({ ok: true, mode: 'deleted' });
    } catch (e) { console.error(e); res.status(500).json({ message: 'Terjadi kesalahan server.' }); }
});

app.delete('/api/admin/categories/:id', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id FROM categories WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ message: 'Kategori tidak ditemukan' });
        const [used] = await pool.query('SELECT COUNT(*) AS n FROM products WHERE category_id = ?', [req.params.id]);
        if (used[0].n > 0) return res.status(409).json({ message: `Kategori masih dipakai ${used[0].n} menu. Pindahkan/hapus menunya dulu, atau nonaktifkan saja kategorinya.` });
        await pool.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
        res.json({ ok: true, mode: 'deleted' });
    } catch (e) { console.error(e); res.status(500).json({ message: 'Terjadi kesalahan server.' }); }
});

app.delete('/api/admin/tables/:id', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id FROM cafe_tables WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ message: 'Meja tidak ditemukan' });
        const [used] = await pool.query('SELECT COUNT(*) AS n FROM orders WHERE table_id = ?', [req.params.id]);
        if (used[0].n > 0) {
            await pool.query('UPDATE cafe_tables SET is_active = 0 WHERE id = ?', [req.params.id]);
            return res.json({ ok: true, mode: 'deactivated' });
        }
        await pool.query('DELETE FROM cafe_tables WHERE id = ?', [req.params.id]);
        res.json({ ok: true, mode: 'deleted' });
    } catch (e) { console.error(e); res.status(500).json({ message: 'Terjadi kesalahan server.' }); }
});

app.delete('/api/admin/fraud/blacklist/:id', authAdmin, async (req, res) => {
    try {
        const [r] = await pool.query('DELETE FROM blacklist WHERE id = ?', [req.params.id]);
        if (!r.affectedRows) return res.status(404).json({ message: 'Data blacklist tidak ditemukan' });
        res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ message: 'Terjadi kesalahan server.' }); }
});

app.get('/api/admin/audit', authAdmin, (req, res) => res.json([]));

app.post('/api/admin/demo/reset', authAdmin, async (req,res)=>{
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('DELETE FROM order_items'); await conn.query('DELETE FROM orders');
        await conn.query('UPDATE products SET is_available=1');
        await conn.query("UPDATE settings SET cafe_name='Cafe Campus', cafe_address='', cafe_phone='', operating_hours='' WHERE id=1");
        await conn.commit(); res.json({ok:true});
    } catch(e) { await conn.rollback(); res.status(500).json({message:e.message}); } finally { conn.release(); }
});

export function getLanIp() {
    if (process.env.APP_URL) {
        try {
            return new URL(process.env.APP_URL).hostname;
        } catch {
            return process.env.APP_URL.replace(/^https?:\/\//, '').split(':')[0];
        }
    }
    const nets = os.networkInterfaces();
    // Prioritaskan adapter Wi-Fi / Ethernet
    const priority = ['wi-fi', 'wifi', 'ethernet', 'wlan', 'en0', 'eth0'];
    for (const p of priority) {
        const found = Object.keys(nets).find(k => k.toLowerCase().includes(p));
        if (found) {
            for (const net of nets[found]) {
                if (net.family === 'IPv4' && !net.internal) {
                    return net.address;
                }
            }
        }
    }
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return '127.0.0.1';
}

// Endpoint Generate QR Code Meja — menggunakan library lokal (tidak bergantung layanan eksternal)
app.get('/qr/:token.svg', async (req, res) => {
    try {
        let fullBaseUrl = '';
        if (process.env.APP_URL) {
            fullBaseUrl = process.env.APP_URL.replace(/\/+$/, '');
        } else {
            const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
            let host = req.get('host') || `127.0.0.1:${PORT}`;
            if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
                const lanIp = getLanIp();
                const p = host.split(':')[1] || PORT;
                host = `${lanIp}:${p}`;
            }
            fullBaseUrl = `${protocol}://${host}`;
        }
        
        const url = `${fullBaseUrl}/order/${encodeURIComponent(req.params.token)}`;
        const svg = await QRCode.toString(url, {
            type: 'svg',
            margin: 2,
            width: 300,
            color: { dark: '#3c2415', light: '#faf6f0' },
            errorCorrectionLevel: 'M',
        });
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.send(svg);
    } catch (err) {
        console.error('QR generation error:', err);
        res.status(500).send('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><text y="150" x="50" fill="red">QR Error</text></svg>');
    }
});

// ==========================================
// SPA FALLBACK
// ==========================================
app.use((req, res) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.status(404).json({ message: 'Endpoint tidak ditemukan' });
    }
});

// Migrasi ringan otomatis: tambah kolom untuk fitur "Tambah Pesanan" bila belum ada (aman dijalankan berulang)
const expireStaleQrisOrders = async () => {
    try {
        const [r] = await pool.query(
            `UPDATE orders SET status = 'CANCELLED', payment_status = 'FAILED'
             WHERE payment_status = 'PENDING' AND payment_method IN ('QRIS', 'QRIS_DEMO')
             AND created_at < (NOW() - INTERVAL ? MINUTE)`,
            [QRIS_EXPIRY_MINUTES]
        );
        if (r.affectedRows > 0) console.log(`⏱️  ${r.affectedRows} pesanan QRIS kedaluwarsa (>${QRIS_EXPIRY_MINUTES} menit) dibatalkan otomatis`);
    } catch (err) { console.error('⚠️  Gagal membersihkan pesanan QRIS kedaluwarsa:', err.message); }
};

const ensureSchema = async () => {
    // Kolom 1: parent_order_number (fitur tambah pesanan)
    const [cols] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'parent_order_number'");
    if (cols.length === 0) {
        await pool.query('ALTER TABLE orders ADD COLUMN parent_order_number VARCHAR(50) NULL DEFAULT NULL, ADD INDEX idx_orders_parent (parent_order_number)');
        console.log('🛠️  Migrasi: kolom orders.parent_order_number ditambahkan');
    }
    // Kolom 2: kitchen_type di tabel categories (fitur dual printer dapur)
    const [kitchenCol] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'kitchen_type'");
    if (kitchenCol.length === 0) {
        await pool.query("ALTER TABLE categories ADD COLUMN kitchen_type ENUM('DRINK','FOOD') NOT NULL DEFAULT 'DRINK'");
        // Set kategori makanan otomatis berdasarkan slug yang mengandung 'makanan', 'snack', 'food', 'dessert'
        await pool.query("UPDATE categories SET kitchen_type = 'FOOD' WHERE slug REGEXP 'makanan|snack|food|dessert|pastry|cake'");
        console.log('🛠️  Migrasi: kolom categories.kitchen_type ditambahkan (DRINK/FOOD)');
    }
};
await ensureSchema().catch(err => console.error('⚠️  Migrasi database gagal (cek koneksi MySQL):', err.message));
await expireStaleQrisOrders();
setInterval(expireStaleQrisOrders, 60 * 1000); // sapu ulang tiap 1 menit

app.listen(PORT, '0.0.0.0', () => {
    const lanIp = getLanIp();
    console.log(`\n======================================================`);
    console.log(`☕ Cafe Campus Server siap & aktif!`);
    console.log(`💻 Akses PC (Kasir/Admin): http://localhost:${PORT}/admin/login`);
    console.log(`📱 Akses HP (Customer/Scan): http://${lanIp}:${PORT}`);
    console.log(`======================================================\n`);
});