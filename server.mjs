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
import webpush from 'web-push';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 4176;
export const APP_MODE = (process.env.APP_MODE || 'production').trim().toLowerCase() === 'demo' ? 'demo' : 'production';
export const IS_DEMO = APP_MODE === 'demo';
const JWT_SECRET = process.env.JWT_SECRET || '';
if (JWT_SECRET.length < 32 || /ganti_dengan|change_me|placeholder|example/i.test(JWT_SECRET)) {
    console.error('❌ FATAL: JWT_SECRET belum aman. Atur secret acak minimal 32 karakter pada environment aplikasi (gunakan: openssl rand -base64 48).');
    process.exit(1);
}

const STUDENT_DAILY_LIMIT = Number(process.env.STUDENT_DAILY_LIMIT) || 1;
const QRIS_EXPIRY_MINUTES = Number(process.env.QRIS_EXPIRY_MINUTES) || 15;
const VALID_ORDER_STATUSES = ['NEW', 'PROCESSING', 'READY', 'COMPLETED', 'CANCELLED'];

const snap = new midtransClient.Snap({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
    serverKey: process.env.MIDTRANS_SERVER_KEY || '',
    clientKey: process.env.MIDTRANS_CLIENT_KEY || ''
});

// Gemini AI Keys (KTM OCR & Barista Chatbot)
const GEMINI_KTM_API_KEY = process.env.GEMINI_KTM_API_KEY || process.env.GEMINI_API_KEY || '';
const GEMINI_CHATBOT_API_KEY = process.env.GEMINI_CHATBOT_API_KEY || process.env.GEMINI_API_KEY || '';

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
            workerSrc: ["'self'"],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: null,
        },
    },
    hsts: false,
    crossOriginEmbedderPolicy: false,
}));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, process.env.NODE_ENV === 'production' ? false : true);
        if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error('CORS: origin tidak diizinkan'));
    },
    credentials: true,
}));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 25,
    message: { message: 'Terlalu banyak percobaan login. Coba lagi setelah 15 menit.' },
    standardHeaders: true, legacyHeaders: false,
});
const otpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 12,
    message: { message: 'Terlalu banyak permintaan OTP. Coba lagi setelah 10 menit.' },
    standardHeaders: true, legacyHeaders: false,
});
const otpVerifyLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
    message: { message: 'Terlalu banyak percobaan OTP. Coba lagi setelah 10 menit.' },
    standardHeaders: true, legacyHeaders: false,
});
const orderLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 40,
    message: { message: 'Terlalu banyak permintaan. Tunggu sebentar dan coba lagi.' },
    standardHeaders: true, legacyHeaders: false,
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Health Check Endpoint
app.get(['/health', '/api/health', '/healthz'], (req, res) => {
    res.json({ ok: true, status: 'ok', healthy: true, version: '2.0.0', timestamp: new Date().toISOString() });
});

// Readiness check: verifies that the application can reach its production database.
app.get(['/ready', '/api/ready'], async (req, res) => {
    try {
        await pool.query('SELECT 1');
        await pool.query('SELECT id FROM admins LIMIT 1');
        res.json({ ok: true, status: 'ready', database: 'connected' });
    } catch (err) {
        console.error('[readiness] Database belum siap:', err.code || err.message);
        res.status(503).json({ ok: false, status: 'not_ready', database: 'unavailable' });
    }
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

// MIME whitelist
const ALLOWED_IMAGE_TYPES = { 'jpeg': 'jpg', 'jpg': 'jpg', 'png': 'png', 'webp': 'webp', 'gif': 'gif' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const saveBase64Image = (base64Str, subfolder) => {
    if (!base64Str || !base64Str.startsWith('data:image')) return null;
    try {
        const matches = base64Str.match(/^data:image\/([A-Za-z0-9-+]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return null;
        const rawType = matches[1].toLowerCase();
        const ext = ALLOWED_IMAGE_TYPES[rawType];
        if (!ext) return null;
        const buffer = Buffer.from(matches[2], 'base64');
        if (buffer.byteLength > MAX_IMAGE_BYTES) return null;
        const fileName = `${crypto.randomUUID()}.${ext}`;
        const dirPath = path.join(__dirname, 'public', 'uploads', subfolder);
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
        fs.writeFileSync(path.join(dirPath, fileName), buffer);
        return `/uploads/${subfolder}/${fileName}`;
    } catch (e) { return null; }
};

const formatRupiah = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

// Audit logger helper
const logAudit = async (userId, userName, role, action, targetType, targetId, details, req = null) => {
    try {
        const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1') : '127.0.0.1';
        await pool.query(
            `INSERT INTO audit_logs (id, user_id, user_name, role, action, target_type, target_id, details, ip_address)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [crypto.randomUUID(), userId || 'SYSTEM', userName || 'Sistem', role || 'SYSTEM', action, targetType, targetId || null, JSON.stringify(details || {}), String(ip).slice(0, 50)]
        );
    } catch (err) {}
};

// ==========================================
// WEB PUSH NOTIFICATION SETUP (VAPID)
// ==========================================
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BJucDw6as39QK-qCN4fTqP4ejssCPUZA2NxEasJahXQc6T9SPy-TxnPZFDQ_i78pVO0jWmvvYJJwENUN0hhDge8';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'u7BR7Cdhk4QKLof5dYS0NLgy56046IhC9nWNelxMyHA';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@cafecampus.demo';

try {
    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} catch (e) {}

const pushSubscriptions = new Map();

const initPushTable = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                channel VARCHAR(50) NOT NULL,
                order_number VARCHAR(100) NULL,
                endpoint VARCHAR(500) NOT NULL,
                p256dh VARCHAR(255) NOT NULL,
                auth VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_ep (endpoint(255))
            )
        `);
        const [rows] = await pool.query('SELECT * FROM push_subscriptions');
        rows.forEach(r => {
            pushSubscriptions.set(r.endpoint, {
                channel: r.channel,
                orderNumber: r.order_number,
                sub: {
                    endpoint: r.endpoint,
                    keys: { p256dh: r.p256dh, auth: r.auth }
                }
            });
        });
    } catch (e) {}
};
initPushTable();

const sendPushNotification = async (channel, orderNumber, payload) => {
    const payloadStr = JSON.stringify(payload);
    for (const [endpoint, item] of pushSubscriptions.entries()) {
        if (channel && item.channel !== channel) continue;
        if (orderNumber && item.orderNumber !== orderNumber) continue;
        try {
            await webpush.sendNotification(item.sub, payloadStr);
        } catch (err) {
            if (err.statusCode === 404 || err.statusCode === 410) {
                pushSubscriptions.delete(endpoint);
                pool.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]).catch(() => {});
            }
        }
    }
};

// ==========================================
// SSE REAL-TIME SYSTEM (DAPUR, KASIR, CUSTOMER)
// ==========================================
const sseClients = new Set();
const sseIpCounts = new Map();
let currentEventId = 0;
const eventHistory = []; // Ring-buffer 100 items untuk Last-Event-ID & polling fallback

const safeWrite = (client, chunk) => {
    try {
        if (!client.res.writableEnded && !client.res.destroyed) {
            client.res.write(chunk);
            return true;
        } else {
            sseClients.delete(client);
            return false;
        }
    } catch (e) {
        sseClients.delete(client);
        return false;
    }
};

const broadcast = (event, payload) => {
    currentEventId++;
    const evtId = currentEventId;
    const historyItem = {
        id: evtId,
        event,
        payload,
        order: payload.orderNumber || null,
        timestamp: Date.now()
    };
    eventHistory.push(historyItem);
    if (eventHistory.length > 100) eventHistory.shift();

    const msg = `id: ${evtId}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    sseClients.forEach(c => {
        if (event === 'admin-order' && c.channel !== 'admin') return;
        if (event === 'kitchen-order' && c.channel !== 'kitchen' && c.channel !== 'admin') return;
        if (event === 'order-update' && c.channel === 'customer' && c.order && c.order !== payload.orderNumber) return;
        safeWrite(c, msg);
    });
};

const notifyPaidOrder = async (orderNumber) => {
    try {
        const [rows] = await pool.query('SELECT * FROM orders WHERE order_number=?', [orderNumber]);
        if (!rows.length) return;
        const o = rows[0];
        broadcast('admin-order', {
            orderNumber: o.order_number,
            tableName: o.table_name,
            queueNumber: o.queue_number,
            status: o.status,
            payment: { method: o.payment_method, status: o.payment_status },
            total: Number(o.total),
            paid: true,
            _eventType: 'payment-update'
        });
        broadcast('kitchen-order', {
            orderNumber: o.order_number,
            tableName: o.table_name,
            queueNumber: o.queue_number,
            status: o.status,
            paid: true
        });
        broadcast('order-update', {
            orderNumber,
            status: o.status,
            paymentStatus: 'PAID',
            tableName: o.table_name,
            queueNumber: o.queue_number,
            total: Number(o.total),
            payment: { method: o.payment_method, status: 'PAID' }
        });
    } catch(e) {}
};

// SSE Endpoint dengan Proteksi, Last-Event-ID, Heartbeat, dan Anti-Buffering
app.get('/api/events', async (req, res) => {
    const { channel, order, access } = req.query;

    if (channel === 'admin' || channel === 'kitchen') {
        const cookieToken = getCookies(req).cc_demo_admin;
        const authHeader = req.headers.authorization;
        const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : null;
        const token = cookieToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null) || queryToken;
        if (!token) {
            return res.status(401).json({ message: 'Unauthorized: login staff diperlukan' });
        }
        try {
            jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(403).json({ message: 'Forbidden: token staff tidak valid' });
        }
    }

    if (order) {
        if (!access) return res.status(403).json({ message: 'Akses ditolak: token akses pesanan diperlukan' });
        try {
            const [ords] = await pool.query('SELECT payment_ref FROM orders WHERE order_number = ?', [order]);
            if (!ords.length || ords[0].payment_ref !== access) {
                return res.status(403).json({ message: 'Akses ditolak: token tidak cocok' });
            }
        } catch (err) {
            return res.status(500).json({ message: 'Database error' });
        }
    }

    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const currentIpCount = sseIpCounts.get(clientIp) || 0;
    if (currentIpCount >= 10) {
        return res.status(429).json({ message: 'Terlalu banyak koneksi event stream dari IP ini.' });
    }
    sseIpCounts.set(clientIp, currentIpCount + 1);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const client = { res, channel: channel || 'customer', order, ip: clientIp };
    sseClients.add(client);

    safeWrite(client, 'retry: 3000\n\n');
    safeWrite(client, `event: hello\ndata: {"ok":true,"eventId":${currentEventId}}\n\n`);

    // Kirim event yang terlewat jika reconnect membawa Last-Event-ID
    const lastId = Number(req.headers['last-event-id'] || req.query.lastEventId || 0);
    if (lastId > 0 && lastId < currentEventId) {
        const missed = eventHistory.filter(e => e.id > lastId);
        missed.forEach(e => {
            if (e.event === 'admin-order' && client.channel !== 'admin') return;
            if (e.event === 'kitchen-order' && client.channel !== 'kitchen' && client.channel !== 'admin') return;
            if (e.event === 'order-update' && client.channel === 'customer' && client.order && client.order !== e.order) return;
            safeWrite(client, `id: ${e.id}\nevent: ${e.event}\ndata: ${JSON.stringify(e.payload)}\n\n`);
        });
    }

    const heartbeat = setInterval(() => {
        if (res.writableEnded || res.destroyed) {
            clearInterval(heartbeat);
            sseClients.delete(client);
            return;
        }
        safeWrite(client, `: ping\n\n`);
    }, 15000);

    const cleanup = () => {
        clearInterval(heartbeat);
        sseClients.delete(client);
        const cnt = sseIpCounts.get(clientIp) || 1;
        if (cnt <= 1) sseIpCounts.delete(clientIp);
        else sseIpCounts.set(clientIp, cnt - 1);
    };

    req.on('close', cleanup);
    req.on('error', cleanup);
});

// Endpoint Polling Ringan Berbasis Cursor (Fallback andal untuk Cloudflare Quick Tunnel)
app.get('/api/events/poll', async (req, res) => {
    const { channel, order, access } = req.query;

    if (channel === 'admin' || channel === 'kitchen') {
        const cookieToken = getCookies(req).cc_demo_admin;
        const authHeader = req.headers.authorization;
        const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : null;
        const token = cookieToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null) || queryToken;
        if (!token) return res.status(401).json({ message: 'Unauthorized' });
        try { jwt.verify(token, JWT_SECRET); } catch (err) { return res.status(403).json({ message: 'Forbidden' }); }
    }

    if (order) {
        if (!access) return res.status(403).json({ message: 'Akses ditolak: token diperlukan' });
        try {
            const [ords] = await pool.query('SELECT payment_ref FROM orders WHERE order_number = ?', [order]);
            if (!ords.length || ords[0].payment_ref !== access) {
                return res.status(403).json({ message: 'Akses ditolak: token tidak cocok' });
            }
        } catch (err) { return res.status(500).json({ message: 'Database error' }); }
    }

    const since = Number(req.query.since || 0);
    const events = eventHistory.filter(e => {
        if (e.id <= since) return false;
        if (e.event === 'admin-order' && channel !== 'admin') return false;
        if (e.event === 'kitchen-order' && channel !== 'kitchen' && channel !== 'admin') return false;
        if (e.event === 'order-update' && channel === 'customer' && order && order !== e.order) return false;
        return true;
    }).map(e => ({ id: e.id, event: e.event, data: e.payload, timestamp: e.timestamp }));

    res.json({
        ok: true,
        events,
        cursor: currentEventId
    });
});

app.get('/api/push/key', (req, res) => res.json({ publicKey: VAPID_PUBLIC_KEY }));

app.post('/api/push/subscribe', async (req, res) => {
    try {
        const { channel = 'customer', orderNumber = null, subscription } = req.body;
        if (!subscription || !subscription.endpoint || !subscription.keys) {
            return res.status(400).json({ message: 'Invalid subscription object' });
        }
        pushSubscriptions.set(subscription.endpoint, { channel, orderNumber, sub: subscription });
        try {
            await pool.query(`
                INSERT INTO push_subscriptions (channel, order_number, endpoint, p256dh, auth)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE channel = VALUES(channel), order_number = VALUES(order_number), p256dh = VALUES(p256dh), auth = VALUES(auth)
            `, [channel, orderNumber, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]);
        } catch (dbErr) {}
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ==========================================
// PUBLIC API (FRONTEND CUSTOMER)
// ==========================================
app.get('/api/public/settings', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM settings WHERE id = 1');
        const s = rows[0] || {};
        res.json({
            cafeName: s.cafe_name || 'Cafe Campus',
            cafeAddress: s.cafe_address || '',
            cafePhone: s.cafe_phone || '',
            operatingHours: s.operating_hours || '',
            serviceFee: Number(s.service_fee || 0),
            taxPercent: Number(s.tax_percent || 0),
            qrisEnabled: Boolean(s.qris_enabled),
            cashEnabled: Boolean(s.cash_enabled),
            soundEnabled: Boolean(s.sound_enabled),
            dailyReportEnabled: Boolean(s.daily_report_enabled),
            demoMode: IS_DEMO,
            appMode: APP_MODE
        });
    } catch(e) { res.status(500).json({message: 'Terjadi kesalahan server.'}); }
});

app.get('/api/public/tables', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM cafe_tables WHERE is_active = 1 ORDER BY table_number ASC');
        res.json(rows.map(r => ({ id: r.id, tableNumber: r.table_number, name: r.name, publicToken: r.public_token })));
    } catch(e) { res.status(500).json({message: 'Terjadi kesalahan server.'}); }
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
            type: req.body.type || 'Bantuan Umum', message: `${t.name} memanggil: ${req.body.type || 'Bantuan'} ${req.body.note ? `(${req.body.note})` : ''}`,
            at: new Date().toISOString()
        });
        res.json({ ok: true });
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.get('/api/public/categories', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC');
        res.json(rows.map(c => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
            kitchenType: c.kitchen_type || 'DRINK',
            isTobacco: Boolean(c.is_tobacco)
        })));
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.get('/api/public/products', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT p.*, c.slug AS category_slug, c.name AS category_name, c.kitchen_type, c.is_tobacco AS cat_is_tobacco
            FROM products p
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.is_active = 1 AND (c.id IS NULL OR c.is_active = 1)
            ORDER BY p.sort_order ASC
        `);

        // Evaluasi ketersediaan dinamis berdasarkan bahan baku resep yang menipis
        let outOfStockProductIds = new Set();
        try {
            const [outRecipes] = await pool.query(`
                SELECT DISTINCT r.product_id
                FROM product_recipes r
                JOIN raw_materials rm ON r.raw_material_id = rm.id
                WHERE rm.current_stock < r.quantity_needed
            `);
            outOfStockProductIds = new Set(outRecipes.map(r => r.product_id));
        } catch (_) {}

        res.json(rows.map(p => {
            const isAvailable = Boolean(p.is_available) && !outOfStockProductIds.has(p.id);
            return {
                id: p.id,
                categoryId: p.category_id,
                categorySlug: p.category_slug || '',
                categoryName: p.category_name || '',
                kitchenType: p.kitchen_type || 'DRINK',
                name: p.name,
                description: p.description,
                price: Number(p.price),
                studentPrice: Boolean(p.is_tobacco || p.cat_is_tobacco) ? Number(p.price) : Number(p.student_price),
                imageUrl: p.image_url,
                emoji: p.emoji || '☕',
                isAvailable,
                customizable: Boolean(p.customizable),
                isTobacco: Boolean(p.is_tobacco || p.cat_is_tobacco)
            };
        }));
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.get('/api/public/faculties', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM faculties WHERE is_active = 1 ORDER BY name ASC');
        res.json(rows.map(r => ({
            id: r.id,
            code: r.code,
            name: r.name,
            color: r.color,
            colorTheme: r.color,
            secondaryColor: r.secondary_color,
            icon: r.icon,
            isActive: Boolean(r.is_active)
        })));
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.get('/api/public/loyalty/:studentId', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM loyalty_accounts WHERE student_id_num = ?', [req.params.studentId]);
        if (!rows.length) return res.json({ studentId: req.params.studentId, points: 0, totalSpent: 0 });
        res.json({
            studentId: rows[0].student_id_num,
            studentName: rows[0].student_name,
            points: rows[0].points_balance,
            totalSpent: Number(rows[0].total_spent)
        });
    } catch(e) { res.status(500).json({message: e.message}); }
});

// OTP Mahasiswa
const otpStore = new Map();
const OTP_TTL_MS = 5 * 60 * 1000;
const CAMPUS_EMAIL_REGEX = /\.(ac\.id|edu)$/i;

app.post('/api/public/student/send-otp', otpLimiter, (req, res) => {
    const email = (req.body?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
        return res.status(400).json({ message: 'Email tidak valid.' });
    }
    if (!CAMPUS_EMAIL_REGEX.test(email)) {
        return res.status(400).json({ message: 'Email harus menggunakan domain kampus resmi (.ac.id atau .edu).' });
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    otpStore.set(email, { code, expiresAt: Date.now() + OTP_TTL_MS });
    res.json({ ok: true, demoOtp: code, _demoOnly_otp: code });
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
// GEMINI AI KTM OCR SCANNER
// ==========================================
app.post('/api/public/scan-ktm', async (req, res) => {
    try {
        const { image = '', existingInfo = null } = req.body || {};
        if (!image || typeof image !== 'string') {
            return res.status(400).json({ ok: false, error: 'Foto KTM (base64 image) wajib disertakan.' });
        }

        // Ambil daftar fakultas dari database untuk referensi matching
        const [faculties] = await pool.query('SELECT * FROM faculties WHERE is_active = 1 ORDER BY name ASC');
        const defaultFac = faculties[0] || { id: 'fac-cs', code: 'FASILKOM', name: 'Fakultas Ilmu Komputer', color: '#6b21a8' };

        let extracted = null;
        let aiSuccess = false;

        if (GEMINI_KTM_API_KEY) {
            try {
                let mimeType = 'image/jpeg';
                let base64Data = image;
                const match = image.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                    mimeType = match[1];
                    base64Data = match[2];
                }

                const facListDesc = faculties.map(f => `${f.code} (${f.name})`).join(', ');

                const systemPrompt = `Kamu adalah sistem OCR AI presisi tinggi untuk membaca Kartu Tanda Mahasiswa (KTM) atau Kartu Pelajar dari berbagai perguruan tinggi dan sekolah di Indonesia.
Tugasmu:
1. Baca dengan sangat teliti teks dan informasi yang tertera pada foto kartu identitas pelajar/mahasiswa ini.
2. Ekstrak data berikut:
   - studentName: Nama lengkap mahasiswa yang tertera (hilangkan titel/gelar akademik jika ada).
   - campus: Nama perguruan tinggi / universitas / institut / politeknik / sekolah (contoh: "Universitas Indonesia", "Institut Teknologi Bandung", "Universitas Gadjah Mada", "Universitas Brawijaya", dll).
   - studentId: Nomor Induk Mahasiswa (NIM / NPM / NIS). HANYA angka atau format ID resmi tanpa spasi di tengah.
   - facultyName: Nama fakultas (pilih yang paling cocok dari daftar fakultas berikut bila relevan: ${facListDesc}, atau sesuai yang tertulis di kartu).
   - facultyCode: Kode/singkatan fakultas (misal: FASILKOM, FT, FEB, FK, FH, FISIP, FIB, FPSI, FMIPA, atau UMUM).
   - studyProgram: Program studi / jurusan (misal: "Sistem Informasi", "Teknik Informatika", "Manajemen", "Ilmu Komunikasi", "Kedokteran", dll).
   - birthDate: Tanggal lahir jika tertera di kartu (format YYYY-MM-DD), atau null bila tidak ada.
   - confidence: Persentase keyakinan OCR (contoh: "99.4%").

PANDUAN:
- Jika teks di kartu agak buram atau foto miring, tetap gunakan ketelitian OCR terbaikmu untuk membaca nama, nim, dan kampus seakurat mungkin.
- Output WAJIB berupa JSON valid murni tanpa markdown wrapper:
{
  "studentName": string,
  "campus": string,
  "studentId": string,
  "facultyName": string,
  "facultyCode": string,
  "studyProgram": string,
  "birthDate": string | null,
  "confidence": string
}`;

                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${encodeURIComponent(GEMINI_KTM_API_KEY)}`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 12000);

                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: systemPrompt },
                                { inline_data: { mime_type: mimeType, data: base64Data } }
                            ]
                        }],
                        generationConfig: {
                            responseMimeType: 'application/json',
                            temperature: 0.1
                        }
                    })
                });
                clearTimeout(timeoutId);

                if (response.ok) {
                    const aiData = await response.json();
                    const rawJsonText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (rawJsonText) {
                        try {
                            const parsedAi = JSON.parse(rawJsonText);
                            if (parsedAi && (parsedAi.studentName || parsedAi.studentId || parsedAi.campus)) {
                                extracted = parsedAi;
                                aiSuccess = true;
                            }
                        } catch (parseErr) {
                            console.warn('[Gemini KTM OCR] Gagal parse JSON output:', parseErr.message);
                        }
                    }
                } else {
                    const errBody = await response.text();
                    console.warn(`[Gemini KTM OCR] API mengembalikan status ${response.status}:`, errBody.slice(0, 200));
                }
            } catch (geminiErr) {
                console.warn('[Gemini KTM OCR] Gagal memanggil Gemini API:', geminiErr.message);
            }
        }

        // Fallback jika Gemini belum/gagal membaca atau API tidak merespons
        if (!extracted) {
            extracted = {
                studentName: existingInfo?.studentName || 'Mahasiswa Terverifikasi',
                campus: existingInfo?.campus || 'Universitas Indonesia',
                studentId: existingInfo?.studentId || `${Math.floor(1000000000 + Math.random() * 9000000000)}`,
                facultyName: defaultFac.name,
                facultyCode: defaultFac.code,
                studyProgram: existingInfo?.studyProgram || 'Sistem Informasi',
                birthDate: existingInfo?.birthDate || '2004-05-14',
                confidence: '95.0%'
            };
        }

        // Normalisasi data hasil ekstraksi
        const studentName = String(extracted.studentName || 'Mahasiswa Terverifikasi').trim();
        const campus = String(extracted.campus || 'Universitas Indonesia').trim();
        let studentId = String(extracted.studentId || '').replace(/\s+/g, '').trim();
        if (!studentId || studentId.length < 4) {
            studentId = `${Math.floor(1000000000 + Math.random() * 9000000000)}`;
        }

        // Matching fakultas ke database
        const targetFacCode = String(extracted.facultyCode || '').toUpperCase();
        const targetFacName = String(extracted.facultyName || '').toLowerCase();
        const targetProg = String(extracted.studyProgram || '').toLowerCase();

        let matchedFac = faculties.find(f => f.code.toUpperCase() === targetFacCode);
        if (!matchedFac && targetFacName) {
            matchedFac = faculties.find(f => 
                f.name.toLowerCase().includes(targetFacName) || targetFacName.includes(f.name.toLowerCase())
            );
        }
        if (!matchedFac && (targetFacName || targetProg)) {
            const combined = `${targetFacName} ${targetProg}`;
            if (combined.includes('komputer') || combined.includes('informatika') || combined.includes('sistem informasi') || combined.includes('data science') || combined.includes('ti')) {
                matchedFac = faculties.find(f => f.code === 'FASILKOM');
            } else if (combined.includes('teknik') || combined.includes('mesin') || combined.includes('sipil') || combined.includes('elektro') || combined.includes('arsitektur') || combined.includes('industri')) {
                matchedFac = faculties.find(f => f.code === 'FT');
            } else if (combined.includes('ekonomi') || combined.includes('bisnis') || combined.includes('manajemen') || combined.includes('akuntansi')) {
                matchedFac = faculties.find(f => f.code === 'FEB');
            } else if (combined.includes('kedokteran') || combined.includes('medis') || combined.includes('dokter')) {
                matchedFac = faculties.find(f => f.code === 'FK');
            } else if (combined.includes('hukum')) {
                matchedFac = faculties.find(f => f.code === 'FH');
            } else if (combined.includes('sosial') || combined.includes('politik') || combined.includes('komunikasi') || combined.includes('hubungan internasional') || combined.includes('hi')) {
                matchedFac = faculties.find(f => f.code === 'FISIP');
            } else if (combined.includes('budaya') || combined.includes('sastra') || combined.includes('bahasa') || combined.includes('filsafat') || combined.includes('sejarah')) {
                matchedFac = faculties.find(f => f.code === 'FIB');
            } else if (combined.includes('psikologi')) {
                matchedFac = faculties.find(f => f.code === 'FPSI');
            } else if (combined.includes('mipa') || combined.includes('matematika') || combined.includes('fisika') || combined.includes('kimia') || combined.includes('biologi')) {
                matchedFac = faculties.find(f => f.code === 'FMIPA');
            }
        }
        if (!matchedFac) {
            matchedFac = defaultFac;
        }

        // Bangun domain email kampus institusi yang realistis
        let campusDomain = 'ui.ac.id';
        const cLower = campus.toLowerCase();
        if (cLower.includes('indonesia') || cLower === 'ui') campusDomain = 'ui.ac.id';
        else if (cLower.includes('teknologi bandung') || cLower.includes('itb')) campusDomain = 'itb.ac.id';
        else if (cLower.includes('gadjah mada') || cLower.includes('ugm')) campusDomain = 'ugm.ac.id';
        else if (cLower.includes('padjadjaran') || cLower.includes('unpad')) campusDomain = 'unpad.ac.id';
        else if (cLower.includes('airlangga') || cLower.includes('unair')) campusDomain = 'unair.ac.id';
        else if (cLower.includes('brawijaya') || cLower.includes('ub')) campusDomain = 'ub.ac.id';
        else if (cLower.includes('sepuluh nopember') || cLower.includes('its')) campusDomain = 'its.ac.id';
        else if (cLower.includes('diponegoro') || cLower.includes('undip')) campusDomain = 'undip.ac.id';
        else if (cLower.includes('telkom')) campusDomain = 'telkomuniversity.ac.id';
        else if (cLower.includes('binus') || cLower.includes('bina nusantara')) campusDomain = 'binus.ac.id';
        else if (cLower.includes('gunadarma')) campusDomain = 'gunadarma.ac.id';
        else {
            const words = campus.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean);
            if (words.length >= 2) {
                const acronym = words.map(w => w[0]).join('').toLowerCase();
                campusDomain = `${acronym}.ac.id`;
            } else {
                campusDomain = 'kampus.ac.id';
            }
        }

        const nameSlug = studentName.toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '') || 'mahasiswa';
        const generatedEmail = `${nameSlug.split('.').slice(0, 2).join('.')}@${campusDomain}`;

        const studyProgram = String(extracted.studyProgram || (matchedFac ? matchedFac.name.replace(/^Fakultas\s+/i, '') : 'Reguler')).trim();
        const birthDate = extracted.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(extracted.birthDate) ? extracted.birthDate : (existingInfo?.birthDate || '2004-05-14');

        const finalResult = {
            studentName,
            campus,
            studentId,
            facultyId: matchedFac.id,
            facultyCode: matchedFac.code,
            facultyName: matchedFac.name,
            facultyColor: matchedFac.color || matchedFac.color_theme || '#0284c7',
            studyProgram,
            birthDate,
            email: generatedEmail,
            emailVerified: true,
            studentPhoto: image,
            confidence: extracted.confidence || (aiSuccess ? '99.4%' : '95.0%'),
            isAiScanned: aiSuccess
        };

        res.json({
            ok: true,
            data: finalResult
        });
    } catch (err) {
        console.error('❌ Error /api/public/scan-ktm:', err);
        res.status(500).json({ ok: false, error: 'Gagal memproses pemindaian KTM AI: ' + err.message });
    }
});

// ==========================================
// BARISTA AI CHATBOT ENGINE
// ==========================================
app.post('/api/public/chat', async (req, res) => {
    try {
        const { message = '', history = [], customerType = 'REGULAR', tableToken = '' } = req.body || {};
        const q = String(message || '').trim();
        if (!q) {
            return res.json({
                reply: 'Halo! Saya Barista AI Cafe Campus ☕ Ada yang bisa saya bantu hari ini? Kamu bisa tanya rekomendasi kopi, camilan nugas, password Wi-Fi, info diskon pelajar, atau fasilitas cafe.',
                suggestions: ['☕ Rekomendasi Kopi Best Seller', '🍰 Camilan & Makanan Favorit', '🎓 Info Diskon Mahasiswa', '📶 Password Wi-Fi & Fasilitas'],
                recommendedProducts: []
            });
        }

        // Ambil data menu produk terkini beserta status ketersediaannya
        const [rows] = await pool.query(`
            SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.is_tobacco AS cat_is_tobacco
            FROM products p
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.is_active = 1 AND (c.id IS NULL OR c.is_active = 1)
            ORDER BY p.sort_order ASC
        `);
        let outOfStockSet = new Set();
        try {
            const [outRecipes] = await pool.query(`
                SELECT DISTINCT r.product_id
                FROM product_recipes r
                JOIN raw_materials rm ON r.raw_material_id = rm.id
                WHERE rm.current_stock < r.quantity_needed
            `);
            outOfStockSet = new Set(outRecipes.map(r => r.product_id));
        } catch (_) {}

        const allProducts = rows.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            categorySlug: p.category_slug || '',
            price: Number(p.price),
            studentPrice: Boolean(p.is_tobacco || p.cat_is_tobacco) ? Number(p.price) : Number(p.student_price),
            imageUrl: p.image_url,
            emoji: p.emoji || '☕',
            isAvailable: Boolean(p.is_available) && !outOfStockSet.has(p.id),
            isTobacco: Boolean(p.is_tobacco || p.cat_is_tobacco)
        }));

        const isStud = customerType === 'STUDENT';
        let reply = '';
        let suggestions = [];
        let recommendedProducts = [];

        // ----------------------------------------------------
        // JIKA GEMINI CHATBOT KEY TERSEDIA: GUNAKAN GEMINI AI
        // ----------------------------------------------------
        if (GEMINI_CHATBOT_API_KEY) {
            try {
                const catalogText = allProducts.map(p => 
                    `- ${p.name} (${p.categorySlug || 'menu'}): Rp${p.price.toLocaleString('id-ID')} (Mahasiswa: Rp${p.studentPrice.toLocaleString('id-ID')}) [${p.isAvailable ? 'Tersedia' : 'HABIS'}] - ${p.description || ''}`
                ).join('\n');

                const conversationHistoryText = Array.isArray(history) && history.length > 0
                    ? history.slice(-4).map(h => `${h.role === 'user' ? 'Customer' : 'Barista'}: ${h.text || ''}`).join('\n')
                    : '';

                const chatPrompt = `Kamu adalah Barista AI resmi Cafe Campus, sebuah coffee shop dan co-working space favorit mahasiswa.
Kamu ramah, hangat, gaul tapi sopan, helpful, dan sangat paham dunia kopi, kuliner, dan kehidupan mahasiswa nugas.

INFORMASI PENTING TENTANG CAFE CAMPUS:
- Jam Buka: Setiap hari 08:00 – 23:00 WIB (Pesanan dapur & KDS terakhir diterima pukul 22:30 WIB).
- Wi-Fi: Nama SSID "CafeCampus_FreeWiFi", Password "kopikampus2026", kecepatan 100 Mbps Dedicated Fiber, unlimited dan sangat stabil untuk Google Meet/Zoom/nugas.
- Fasilitas: Stopkontak / colokan listrik di SETIAP meja, AC dingin bebas rokok di ruang indoor, outdoor smoking area teduh, musholla bersih di lantai 2, toilet bersih.
- Program Diskon Mahasiswa: Mahasiswa/pelajar dapat subsidi harga hingga 30% OFF untuk seluruh minuman dan makanan (kecuali rokok/tobacco). Cara klaim: pilih tab "Pelajar" di menu, scan foto KTM saat checkout, diskon langsung otomatis terpotong!
- Pembayaran: QRIS instan (BCA, Mandiri, GoPay, OVO, Dana, ShopeePay) langsung di HP, atau Bayar Tunai di Kasir.
- Status Pelanggan Saat Ini: ${isStud ? 'Mahasiswa/Pelajar (Mendapat harga diskon pelajar)' : 'Pelanggan Reguler'}.

DAFTAR MENU REAL-TIME:
${catalogText}

${conversationHistoryText ? `RIWAYAT PERCAKAPAN SEBELUMNYA:\n${conversationHistoryText}\n` : ''}
PERTANYAAN PELANGGAN: "${q}"

ATURAN MENJAWAB:
1. Berikan jawaban dalam bahasa Indonesia yang ramah, santai tapi sopan, gunakan emoji kopi/senyum yang relevan, dan format markdown (bold, bullet) agar enak dibaca di HP.
2. Jawab secara spesifik pertanyaan pelanggan tentang menu, fasilitas, jam buka, promo, atau cara order.
3. Di field "recommendedProductNames", berikan 1-3 nama produk yang PERSIS terdaftar di DAFTAR MENU REAL-TIME di atas yang paling cocok direkomendasikan kepada pelanggan (hanya yang statusnya Tersedia). Jika pertanyaan tidak berkaitan dengan rekomendasi menu (misal hanya tanya wifi/jam buka), biarkan array kosong [].
4. Di field "suggestions", berikan 3-4 saran pertanyaan lanjutan yang relevan dan menarik untuk diklik pelanggan.
5. Format output WAJIB JSON murni:
{
  "reply": "...",
  "suggestions": ["...", "...", "..."],
  "recommendedProductNames": ["..."]
}`;

                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${encodeURIComponent(GEMINI_CHATBOT_API_KEY)}`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);

                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        contents: [{
                            parts: [{ text: chatPrompt }]
                        }],
                        generationConfig: {
                            responseMimeType: 'application/json',
                            temperature: 0.6
                        }
                    })
                });
                clearTimeout(timeoutId);

                if (response.ok) {
                    const aiData = await response.json();
                    const text = aiData?.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                        const parsed = JSON.parse(text);
                        if (parsed && parsed.reply) {
                            reply = parsed.reply;
                            suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
                            const recNames = Array.isArray(parsed.recommendedProductNames) ? parsed.recommendedProductNames : [];

                            // Cocokkan nama produk yang direkomendasikan dengan database
                            recommendedProducts = allProducts.filter(p => 
                                p.isAvailable && recNames.some(rn => 
                                    p.name.toLowerCase().includes(String(rn).toLowerCase()) || 
                                    String(rn).toLowerCase().includes(p.name.toLowerCase())
                                )
                            ).slice(0, 3);
                        }
                    }
                }
            } catch (geminiChatErr) {
                console.warn('[Gemini Barista AI] Fallback ke rule-based:', geminiChatErr.message);
            }
        }

        // ----------------------------------------------------
        // FALLBACK: JIKA GEMINI TIDAK AKTIF ATAU MENGALAMI GANGGUAN
        // ----------------------------------------------------
        if (!reply) {
            const qLower = q.toLowerCase();
            // 1. Pertanyaan Wi-Fi & Internet
            if (qLower.includes('wifi') || qLower.includes('wi-fi') || qLower.includes('password') || qLower.includes('sandi') || qLower.includes('internet') || qLower.includes('sinyal')) {
                reply = `📶 **Koneksi Wi-Fi Cafe Campus:**\n\n` +
                    `• **Nama Wi-Fi (SSID):** \`CafeCampus_FreeWiFi\`\n` +
                    `• **Password:** \`kopikampus2026\`\n` +
                    `• **Kecepatan:** Hingga 100 Mbps Unlimited Dedicated Fiber\n\n` +
                    `Koneksi sangat stabil untuk nugas, browsing, streaming, hingga Google Meet & Zoom. Silakan nikmati fasilitas internet berkecepatan tinggi gratis sambil memesan racikan favoritmu!`;
                suggestions = ['☕ Rekomendasi Kopi Nugas', '🔋 Lokasi Colokan Listrik', '🕒 Jam Buka Cafe'];
            }
            // 2. Pertanyaan Jam Buka, Lokasi & Operasional
            else if (qLower.includes('jam') || qLower.includes('buka') || qLower.includes('tutup') || qLower.includes('operasional') || qLower.includes('lokasi') || qLower.includes('alamat') || qLower.includes('dimana')) {
                reply = `🕒 **Jam Operasional & Lokasi Cafe Campus:**\n\n` +
                    `• **Buka Setiap Hari:** 08:00 – 23:00 WIB\n` +
                    `• **Kitchen & KDS Cutoff:** Pesanan dapur terakhir diterima pukul 22:30 WIB\n` +
                    `• **Lokasi:** Terletak strategis di pusat kawasan kampus dekat fakultas utama, mudah dijangkau jalan kaki atau parkir motor/mobil.\n\n` +
                    `Mau mampir pagi untuk sarapan croissant & americano, atau nongkrong malam nugas bersama teman? Kami selalu siap menyambutmu!`;
                suggestions = ['📶 Password Wi-Fi', '☕ Rekomendasi Menu', '🎓 Promo Pelajar'];
            }
            // 3. Pertanyaan Colokan / Stopkontak / Fasilitas / Nugas / Bawa Laptop
            else if (qLower.includes('colokan') || qLower.includes('stopkontak') || qLower.includes('listrik') || qLower.includes('charger') || qLower.includes('nugas') || qLower.includes('laptop') || qLower.includes('fasilitas') || qLower.includes('musholla') || qLower.includes('toilet') || qLower.includes('smoking') || qLower.includes('ac')) {
                reply = `⚡ **Fasilitas Lengkap Cafe Campus untuk Nugas & Kerja:**\n\n` +
                    `• **Stopkontak (Colokan):** Tersedia di SETIAP meja, aman untuk charger laptop & HP kamu.\n` +
                    `• **Ruang AC Dingin:** Area indoor bebas asap rokok yang hening dan nyaman untuk fokus kerja/belajar.\n` +
                    `• **Outdoor / Smoking Area:** Area terbuka teduh dengan view asri untuk santai dan ngobrol.\n` +
                    `• **Wi-Fi 100 Mbps:** Stabil tanpa drop.\n` +
                    `• **Toilet & Musholla:** Bersih, terawat, dan musholla nyaman berada di lantai 2.`;
                suggestions = ['📶 Password Wi-Fi', '☕ Kopi Anti Ngantuk', '🍟 Camilan Nugas'];
            }
            // 4. Pertanyaan Promo / Diskon Mahasiswa / KTM
            else if (qLower.includes('diskon') || qLower.includes('promo') || qLower.includes('pelajar') || qLower.includes('mahasiswa') || qLower.includes('ktm') || qLower.includes('kampus') || qLower.includes('hemat') || qLower.includes('murah') || qLower.includes('subsidi')) {
                reply = `🎓 **Program Diskon Khusus Mahasiswa & Pelajar:**\n\n` +
                    `Cafe Campus memberikan subsidi harga pelajar hingga **30% OFF** untuk seluruh menu minuman dan makanan favorit!\n\n` +
                    `**Cara Mendapatkan Diskon:**\n` +
                    `1. Di halaman menu, aktifkan tab **"🎓 Pelajar / Mahasiswa"**.\n` +
                    `2. Saat checkout, isi identitas singkat (Nama, Kampus, NIM/NIS) & foto selfie bersama KTM/kartu pelajar atau verifikasi email kampus (.ac.id).\n` +
                    `3. Diskon otomatis dipotong langsung dari tagihanmu!`;
                suggestions = ['☕ Menu Diskon Mahasiswa', '📝 Cara Checkout', '📶 Password Wi-Fi'];
                recommendedProducts = allProducts.filter(p => p.price > p.studentPrice && !p.isTobacco).slice(0, 3);
            }
            // 5. Cara Pesan & Pembayaran
            else if (qLower.includes('cara pesan') || qLower.includes('cara order') || qLower.includes('cara bayar') || qLower.includes('qris') || qLower.includes('tunai') || qLower.includes('cash') || qLower.includes('bayar')) {
                reply = `🛒 **Panduan Memesan & Pembayaran di Cafe Campus:**\n\n` +
                    `1. **Pilih Menu:** Pilih menu minuman atau makanan yang kamu suka, atur ukuran / takaran gula / es, lalu klik *Tambah ke Keranjang*.\n` +
                    `2. **Periksa Keranjang:** Klik icon keranjang untuk melihat rincian pesanan dan total harga.\n` +
                    `3. **Pilih Pembayaran:**\n` +
                    `   • **QRIS:** Bayar instan via M-Banking / GoPay / OVO / ShopeePay / Dana langsung di HP.\n` +
                    `   • **Bayar Tunai di Kasir:** Lakukan pembayaran langsung ke counter kasir.\n` +
                    `4. **Lacak Real-Time:** Pesanan langsung masuk ke KDS Barista & Dapur. Saat racikan siap, HP-mu akan berbunyi dan alarm pick-up menyala!`;
                suggestions = ['☕ Lihat Menu Kopi', '🍰 Lihat Camilan', '🎓 Cek Diskon Kampus'];
            }
            // 6. Rekomendasi Kopi & Minuman Kopi
            else if (qLower.includes('kopi') || qLower.includes('coffee') || qLower.includes('latte') || qLower.includes('aren') || qLower.includes('espresso') || qLower.includes('cappuccino') || qLower.includes('americano') || qLower.includes('ngantuk') || qLower.includes('pahit') || qLower.includes('manis')) {
                if (qLower.includes('manis') || qLower.includes('aren') || qLower.includes('susu') || qLower.includes('creamy')) {
                    reply = `☕ **Rekomendasi Kopi Manis & Creamy:**\n\n` +
                        `Cobain **Iced Latte Gula Aren**! Menu legendaris Cafe Campus dengan perpaduan espresso double shot arabika, susu segar dingin, dan sirup gula aren murni. Rasanya manis pas dan creamy banget!`;
                    recommendedProducts = allProducts.filter(p => p.name.toLowerCase().includes('latte') || p.name.toLowerCase().includes('cappuccino')).slice(0, 3);
                } else if (qLower.includes('pahit') || qLower.includes('hitam') || qLower.includes('strong') || qLower.includes('ngantuk') || qLower.includes('melek')) {
                    reply = `⚡ **Rekomendasi Kopi Strong Anti-Ngantuk:**\n\n` +
                        `Butuh fokus buat nugas semalaman atau persiapan ujian? Saya sarankan **Americano (Hot / Iced)** atau **Double Espresso**. Ekstraksi espresso murni tanpa gula yang ampuh bikin mata melek seketika!`;
                    recommendedProducts = allProducts.filter(p => p.name.toLowerCase().includes('americano') || p.name.toLowerCase().includes('espresso') || p.name.toLowerCase().includes('filter')).slice(0, 3);
                } else {
                    reply = `☕ **Pilihan Kopi Terfavorit di Cafe Campus:**\n\n` +
                        `Berikut racikan kopi yang paling banyak dipesan para mahasiswa dan pengunjung kami hari ini:`;
                    recommendedProducts = allProducts.filter(p => p.categorySlug.includes('coffee') || p.categorySlug.includes('kopi') || p.name.toLowerCase().includes('latte') || p.name.toLowerCase().includes('americano')).slice(0, 3);
                }
                suggestions = ['🍰 Rekomendasi Camilan', '🎓 Diskon Mahasiswa', '📶 Password Wi-Fi'];
            }
            // 7. Rekomendasi Makanan Berat & Snack
            else if (qLower.includes('makan') || qLower.includes('makanan') || qLower.includes('snack') || qLower.includes('camilan') || qLower.includes('croissant') || qLower.includes('nasi') || qLower.includes('geprek') || qLower.includes('teriyaki') || qLower.includes('kentang') || qLower.includes('fries') || qLower.includes('lapar') || qLower.includes('kenyang')) {
                if (qLower.includes('berat') || qLower.includes('nasi') || qLower.includes('kenyang') || qLower.includes('siang')) {
                    reply = `🍛 **Rekomendasi Makanan Berat Pengganjal Perut:**\n\n` +
                        `Untuk makan siang atau makan malam yang mengenyangkan, kami punya **Nasi Ayam Geprek Sambal Korek** yang pedas nendang, serta **Rice Bowl Chicken Teriyaki** yang gurih manis!`;
                    recommendedProducts = allProducts.filter(p => p.name.toLowerCase().includes('nasi') || p.name.toLowerCase().includes('rice') || p.name.toLowerCase().includes('ayam')).slice(0, 3);
                } else {
                    reply = `🥐 **Rekomendasi Camilan & Snack Teman Nugas:**\n\n` +
                        `Nugas paling asik ditemani camilan renyah. Coba **Butter Croissant** yang flaky dan wangi mentega, atau **French Fries** gurih renyah dengan saus cocolan spesial!`;
                    recommendedProducts = allProducts.filter(p => p.name.toLowerCase().includes('croissant') || p.name.toLowerCase().includes('fries') || p.name.toLowerCase().includes('kentang') || p.categorySlug.includes('snack') || p.categorySlug.includes('food')).slice(0, 3);
                }
                suggestions = ['☕ Kopi Pendamping', '🎓 Promo Pelajar', '📶 Password Wi-Fi'];
            }
            // 8. Rekomendasi Minuman Non-Kopi
            else if (qLower.includes('non') || qLower.includes('bukan kopi') || qLower.includes('matcha') || qLower.includes('teh') || qLower.includes('susu') || qLower.includes('cokelat') || qLower.includes('segar')) {
                reply = `🍵 **Rekomendasi Minuman Non-Kopi Segar:**\n\n` +
                    `Lagi gak pengen ngopi? Tenang! Kami punya **Matcha Latte** autentik dari bubuk teh hijau Jepang premium dipadukan susu segar lembut. Segar, menenangkan, dan tetap pas buat teman santai!`;
                recommendedProducts = allProducts.filter(p => p.name.toLowerCase().includes('matcha') || p.name.toLowerCase().includes('tea') || p.name.toLowerCase().includes('chocolate') || (!p.name.toLowerCase().includes('coffee') && !p.name.toLowerCase().includes('latte'))).slice(0, 3);
                suggestions = ['🥐 Pasangan Camilan', '🎓 Cek Harga Pelajar', '📶 Password Wi-Fi'];
            }
            // 9. Sapaan Ramah / Menu Best Seller
            else {
                reply = `👋 Halo! Senang bertemu denganmu di **Cafe Campus**. Saya Barista AI siap membantumu menemukan menu terbaik, informasi Wi-Fi, jam buka, atau promo pelajar.\n\n` +
                    `Ada menu spesial yang lagi bikin kamu penasaran hari ini? Berikut beberapa menu rekomendasi terpopuler yang wajib kamu coba:`;
                recommendedProducts = allProducts.filter(p => p.isAvailable && !p.isTobacco).slice(0, 3);
                suggestions = ['☕ Rekomendasi Kopi', '🥐 Camilan Nugas', '🎓 Diskon Mahasiswa', '📶 Password Wi-Fi'];
            }
        }

        // Pastikan format produk rekomendasi aman dan lengkap
        const safeRecommended = (recommendedProducts || []).map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            price: p.price,
            studentPrice: p.studentPrice,
            effectivePrice: isStud ? p.studentPrice : p.price,
            imageUrl: p.imageUrl,
            emoji: p.emoji,
            isAvailable: p.isAvailable
        }));

        res.json({
            ok: true,
            reply,
            suggestions,
            recommendedProducts: safeRecommended
        });
    } catch(err) {
        res.status(500).json({
            ok: false,
            reply: 'Maaf, sistem Barista AI sedang memproses pesanan lain. Silakan coba kembali sesaat lagi.',
            suggestions: ['☕ Menu Favorit', '📶 Password Wi-Fi'],
            recommendedProducts: []
        });
    }
});

const generateQueueNumber = async (conn) => {
    const [rows] = await conn.query('SELECT COUNT(*) as cnt FROM orders WHERE DATE(created_at) = CURDATE()');
    const seq = (rows[0]?.cnt || 0) + 1;
    return `Q-${String(seq).padStart(3, '0')}`;
};

const FACULTY_THEME_COLORS = {
    'FASILKOM': '#eab308', // Kuning Emas
    'FT': '#1d4ed8',       // Biru Teknik
    'FEB': '#15803d',      // Hijau Ekonomi
    'FK': '#047857',       // Hijau Medis
    'FH': '#b91c1c',       // Merah Hukum
    'FISIP': '#c2410c',    // Jingga FISIP
    'FIB': '#6d28d9',      // Ungu Budaya
    'FPSI': '#be185d',     // Pink Psikologi
    'FMIPA': '#0369a1',    // Biru Sains
    'FKM': '#0f766e'       // Toska Kesehatan
};

function getJakartaDate() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = formatter.format(new Date()).split('-');
    return {
        year: parseInt(parts[0], 10),
        month: parseInt(parts[1], 10),
        day: parseInt(parts[2], 10)
    };
}

function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function checkIsBirthdayToday(birthInput) {
    if (!birthInput) return false;
    const jkt = getJakartaDate();
    let bMonth = null;
    let bDay = null;

    if (birthInput instanceof Date) {
        // Date objects might have been parsed with UTC or local
        const mLocal = birthInput.getMonth() + 1;
        const dLocal = birthInput.getDate();
        const mUTC = birthInput.getUTCMonth() + 1;
        const dUTC = birthInput.getUTCDate();
        if (mLocal === jkt.month && dLocal === jkt.day) return true;
        if (mUTC === jkt.month && dUTC === jkt.day) return true;
        bMonth = mLocal;
        bDay = dLocal;
    } else {
        const str = String(birthInput);
        const match = str.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/) || str.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
        if (match) {
            if (match[1].length === 4) {
                bMonth = parseInt(match[2], 10);
                bDay = parseInt(match[3], 10);
            } else {
                bDay = parseInt(match[1], 10);
                bMonth = parseInt(match[2], 10);
            }
        } else {
            const d = new Date(str);
            if (!isNaN(d.getTime())) {
                bMonth = d.getMonth() + 1;
                bDay = d.getDate();
            }
        }
    }

    if (!bMonth || !bDay) return false;

    // Pencocokan hari ulang tahun normal
    if (bMonth === jkt.month && bDay === jkt.day) return true;

    // Aturan 29 Februari pada tahun non-kabisat (dirayakan pada 28 Februari)
    if (bMonth === 2 && bDay === 29 && !isLeapYear(jkt.year)) {
        if (jkt.month === 2 && jkt.day === 28) return true;
    }

    return false;
}

// ==========================================
// ORDER CREATION & TRACKING
// ==========================================
app.post('/api/orders', orderLimiter, async (req, res) => {
    const b = req.body;

    // Idempotency check
    if (b.idempotencyKey) {
        try {
            const [existing] = await pool.query('SELECT * FROM orders WHERE idempotency_key = ?', [b.idempotencyKey]);
            if (existing.length > 0) {
                const ex = existing[0];
                return res.status(201).json({
                    orderNumber: ex.order_number,
                    accessToken: ex.payment_ref,
                    status: ex.status,
                    queueNumber: ex.queue_number,
                    total: Number(ex.total),
                    tableName: ex.table_name,
                    payment: { method: ex.payment_method, status: ex.payment_status },
                    paymentUrl: ex.payment_url || null,
                    parentOrderNumber: ex.parent_order_number || null
                });
            }
        } catch(e) {}
    }

    const conn = await pool.getConnection();
    try {
        if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 50) {
            throw new Error('Keranjang kosong atau tidak valid.');
        }
        for (const it of b.items) {
            if (!Number.isInteger(it?.quantity) || it.quantity < 1 || it.quantity > 99) {
                throw new Error('Jumlah tiap item harus bilangan bulat antara 1 dan 99.');
            }
        }
        if (!['CASH', 'QRIS', 'QRIS_DEMO'].includes(b.paymentMethod)) throw new Error('Metode pembayaran tidak dikenal.');

        const customerType = b.customerType || 'REGULAR';
        if (!['REGULAR', 'STUDENT'].includes(customerType)) throw new Error('Tipe pelanggan tidak valid.');
        b.customerType = customerType;

        // Pengecekan status QRIS / Cash dari settings
        const [setRows] = await conn.query('SELECT service_fee, tax_percent, qris_enabled, cash_enabled FROM settings WHERE id = 1');
        const sFeePct = setRows.length ? Number(setRows[0].service_fee) : 5;
        const taxPct = setRows.length ? Number(setRows[0].tax_percent) : 11;
        const qrisEnabled = setRows.length ? Boolean(setRows[0].qris_enabled) : true;
        const cashEnabled = setRows.length ? Boolean(setRows[0].cash_enabled) : true;

        if ((b.paymentMethod === 'QRIS' || b.paymentMethod === 'QRIS_DEMO') && !qrisEnabled) {
            return res.status(409).json({ message: 'Pembayaran QRIS sedang dinonaktifkan oleh kasir.' });
        }
        if (b.paymentMethod === 'CASH' && !cashEnabled) {
            return res.status(409).json({ message: 'Pembayaran Tunai sedang dinonaktifkan oleh kasir.' });
        }

        let isAdminReq = false;
        try { const t = getCookies(req).cc_demo_admin; if (t) { jwt.verify(t, JWT_SECRET); isAdminReq = true; } } catch {}

        await conn.beginTransaction();

        let parent = null;
        if (b.parentOrder) {
            const [par] = await conn.query('SELECT * FROM orders WHERE order_number = ?', [String(b.parentOrder.orderNumber || '')]);
            if (!par.length || !par[0].payment_ref || par[0].payment_ref !== b.parentOrder.accessToken) {
                throw new Error('Pesanan utama tidak ditemukan atau akses ditolak.');
            }
            parent = par[0];
            if (parent.parent_order_number) throw new Error('Pesanan tambahan tidak bisa ditambah lagi. Tambahkan ke pesanan utama.');
            if (parent.status === 'COMPLETED' || parent.status === 'CANCELLED' || parent.payment_status === 'FAILED') {
                throw new Error('Pesanan utama sudah ditutup. Silakan buat pesanan baru.');
            }
            b.customerType = parent.customer_type;
            b.studentInfo = {
                studentName: parent.student_name,
                campus: parent.student_campus,
                studentId: parent.student_id_num,
                email: parent.student_email,
                facultyId: parent.student_faculty_id,
                facultyCode: parent.student_faculty_code,
                facultyName: parent.student_faculty_name,
                studyProgram: parent.student_study_program,
                birthDate: parent.student_birth_date
            };
        }

        const [tables] = parent
            ? await conn.query('SELECT * FROM cafe_tables WHERE id = ? AND is_active = 1', [parent.table_id])
            : await conn.query('SELECT * FROM cafe_tables WHERE public_token = ? AND is_active = 1', [b.tableToken]);
        if (!tables.length) throw new Error('Meja tidak valid.');

        let subtotal = 0;
        let totalRegularBase = 0;
        const itemsToInsert = [];
        const isStudent = b.customerType === 'STUDENT';

        for (const item of b.items) {
            const [prods] = await conn.query(
                `SELECT p.*, c.is_active AS category_active, c.is_tobacco AS cat_is_tobacco, c.slug AS cat_slug
                 FROM products p
                 LEFT JOIN categories c ON c.id = p.category_id
                 WHERE p.id = ?`,
                [item.productId]
            );
            if (!prods.length) throw new Error('Produk tidak ditemukan');
            const p = prods[0];
            if (!p.is_active || p.category_active === 0) {
                throw new Error(`Maaf, "${p.name}" sudah tidak tersedia di menu. Silakan hapus item ini.`);
            }
            if (!p.is_available) {
                await conn.rollback();
                return res.status(409).json({ message: `Maaf, "${p.name}" sudah habis (sold out). Silakan hapus item ini dari keranjang.` });
            }

            // Validasi ketersediaan bahan baku resep untuk kuantitas pesanan
            const [depletedMat] = await conn.query(
                `SELECT rm.name, rm.current_stock, r.quantity_needed
                 FROM product_recipes r
                 JOIN raw_materials rm ON r.raw_material_id = rm.id
                 WHERE r.product_id = ? AND rm.current_stock < (r.quantity_needed * ?)`,
                [p.id, item.quantity]
            );
            if (depletedMat.length > 0) {
                await conn.rollback();
                await pool.query('UPDATE products SET is_available = 0 WHERE id = ?', [p.id]).catch(() => {});
                return res.status(409).json({
                    message: `Maaf, stok menu "${p.name}" tidak mencukupi (bahan ${depletedMat[0].name} habis). Silakan pilih menu lain.`
                });
            }

            const isTobacco = Boolean(p.is_tobacco || p.cat_is_tobacco || p.cat_slug === 'rokok');

            // Aturan Poin 10: Rokok TIDAK MENDAPAT DISKON MAHASISWA
            const basePrice = (isStudent && !isTobacco && p.student_price > 0)
                ? Number(p.student_price)
                : Number(p.price);

            const addSize = item.options?.size === 'Large' ? 5000 : 0;
            const finalPrice = basePrice + addSize;
            const regularFinalPrice = Number(p.price) + addSize;
            const lineTotal = finalPrice * item.quantity;
            const lineSavings = Math.max(0, regularFinalPrice - finalPrice) * item.quantity;

            subtotal += lineTotal;
            totalRegularBase += regularFinalPrice * item.quantity;

            if (isTobacco) {
                const bDate = b.studentInfo?.birthDate || b.customerBirthDate;
                if (!bDate) {
                    throw new Error(`Produk tembakau/rokok "${p.name}" wajib verifikasi tanggal lahir (khusus usia 21+).`);
                }
                const birth = new Date(bDate);
                const ageDifMs = Date.now() - birth.getTime();
                const ageDate = new Date(ageDifMs);
                const age = Math.abs(ageDate.getUTCFullYear() - 1970);
                if (isNaN(age) || age < 21) {
                    throw new Error(`Produk tembakau/rokok "${p.name}" dibatasi untuk usia 21 tahun ke atas (usia Anda: ${isNaN(age) ? 'tidak valid' : age + ' tahun'}).`);
                }
            }

            itemsToInsert.push({
                id: crypto.randomUUID(),
                product_id: p.id,
                product_name: p.name,
                quantity: item.quantity,
                base_price: basePrice,
                regular_base_price: Number(p.price),
                price: finalPrice,
                regular_price: regularFinalPrice,
                savings: lineSavings,
                line_total: lineTotal,
                note: '',
                options_json: JSON.stringify(item.options || {})
            });
        }

        const totalSavings = Math.max(0, totalRegularBase - subtotal);
        const sFee = Math.round(subtotal * sFeePct / 100);
        const tax = Math.round((subtotal + sFee) * taxPct / 100);
        const grandTotal = subtotal + sFee + tax;

        const orderId = crypto.randomUUID();
        const orderNumber = 'CC-' + Math.floor(100000 + Math.random() * 900000);
        const accessToken = crypto.randomBytes(16).toString('hex');
        const queueNumber = await generateQueueNumber(conn);

        let photoUrl = parent ? parent.student_photo_url : null;
        if (!parent && isStudent && b.studentInfo?.studentPhoto) {
            if (b.studentInfo.studentPhoto.includes('mockselfie') || b.studentInfo.studentPhoto.length <= 255) {
                photoUrl = b.studentInfo.studentPhoto;
            } else {
                photoUrl = saveBase64Image(b.studentInfo.studentPhoto, 'ktm') || b.studentInfo.studentPhoto;
            }
        }

        let fraudScore = 0, fraudRisk = 'LOW', verificationStatus = 'AUTOMATICALLY_VERIFIED';
        if (parent && parent.customer_type === 'STUDENT') {
            fraudScore = parent.fraud_score || 0;
            fraudRisk = parent.fraud_risk || 'LOW';
            verificationStatus = parent.verification_status || 'PENDING_VERIFICATION';
        } else if (isStudent) {
            let score = 0;
            const email = (b.studentInfo?.email || '').trim().toLowerCase();
            const studId = (b.studentInfo?.studentId || '').trim();

            if (!email.match(/^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9-]+\.)+(ac\.id|edu|sch\.id|edu\.id)$/i)) score += 45;
            if (studId.length < 5) score += 30;
            if ((b.studentInfo?.campus || '').length < 3) score += 25;
            if (!photoUrl) score += 50;

            const yearMatch = studId.match(/^(20)?(1[0-9]|2[0-6])/);
            if (yearMatch) {
                const yearPrefix = yearMatch[2];
                const entryYear = 2000 + parseInt(yearPrefix, 10);
                const currentYear = new Date().getFullYear();
                if (currentYear - entryYear > 6) score += 40;
            }

            fraudScore = Math.min(100, score);
            fraudRisk = fraudScore > 50 ? 'HIGH' : (fraudScore >= 20 ? 'MEDIUM' : 'LOW');
            verificationStatus = fraudScore > 0 ? 'PENDING_VERIFICATION' : 'AUTOMATICALLY_VERIFIED';

            const [bl] = await conn.query('SELECT * FROM blacklist WHERE student_id_num = ? OR email = ?', [studId, email]);
            if (bl.length > 0) {
                await conn.rollback();
                return res.status(403).json({ message: 'Identitas mahasiswa ini masuk daftar hitam (blacklist).' });
            }

            if (!isAdminReq) {
                const [quotaRows] = await conn.query(
                    `SELECT COUNT(*) as cnt FROM orders
                     WHERE customer_type = 'STUDENT' AND status != 'CANCELLED' AND parent_order_number IS NULL AND DATE(created_at) = CURDATE()
                     AND (student_id_num = ? OR student_email = ?)`,
                    [studId, email]
                );
                if (quotaRows[0].cnt >= STUDENT_DAILY_LIMIT) {
                    await conn.rollback();
                    return res.status(409).json({
                        message: `Batas diskon pelajar hari ini sudah habis (maksimal ${STUDENT_DAILY_LIMIT} pesanan/hari per NIM/Email). Kamu tetap bisa memesan lewat Pelanggan Umum.`
                    });
                }
            }
        }

        const isBirthdayToday = isStudent && checkIsBirthdayToday(b.studentInfo?.birthDate);

        // Pengurangan stok atomik & deadlock-free (agregasi & sorting ID ASC)
        const matNeeds = new Map();
        for (const it of itemsToInsert) {
            const [recipes] = await conn.query(
                `SELECT r.raw_material_id, r.quantity_needed, rm.name as mat_name
                 FROM product_recipes r
                 JOIN raw_materials rm ON r.raw_material_id = rm.id
                 WHERE r.product_id = ?`,
                [it.product_id]
            );
            for (const r of recipes) {
                const qtyNeeded = Number(r.quantity_needed) * it.quantity;
                if (!matNeeds.has(r.raw_material_id)) {
                    matNeeds.set(r.raw_material_id, {
                        needed: qtyNeeded,
                        matName: r.mat_name,
                        products: new Set([it.product_id])
                    });
                } else {
                    const entry = matNeeds.get(r.raw_material_id);
                    entry.needed += qtyNeeded;
                    entry.products.add(it.product_id);
                }
            }
        }

        const sortedMatIds = Array.from(matNeeds.keys()).sort();
        for (const mId of sortedMatIds) {
            const info = matNeeds.get(mId);
            const [matRows] = await conn.query('SELECT id, name, current_stock FROM raw_materials WHERE id = ? FOR UPDATE', [mId]);
            if (!matRows.length) {
                await conn.rollback();
                return res.status(500).json({ message: `Bahan baku "${info.matName}" tidak ditemukan.` });
            }
            const currentStock = Number(matRows[0].current_stock);
            if (currentStock < info.needed) {
                await conn.rollback();
                for (const pid of info.products) {
                    await pool.query('UPDATE products SET is_available = 0 WHERE id = ?', [pid]);
                }
                return res.status(409).json({
                    message: `Stok bahan baku "${info.matName}" tidak mencukupi (stok: ${currentStock}, butuh: ${info.needed}). Menu otomatis ditandai habis.`
                });
            }

            const newStock = Math.round((currentStock - info.needed) * 100) / 100;
            await conn.query('UPDATE raw_materials SET current_stock = ? WHERE id = ?', [newStock, mId]);
            await conn.query(`
                INSERT INTO stock_mutations (id, raw_material_id, type, quantity, balance_after, reference_order_number, notes)
                VALUES (?, ?, 'SALE', ?, ?, ?, ?)
            `, [crypto.randomUUID(), mId, info.needed, newStock, orderNumber, `Pengurangan stok pesanan #${orderNumber}`]);

            const [allRec] = await conn.query('SELECT product_id, quantity_needed FROM product_recipes WHERE raw_material_id = ?', [mId]);
            for (const ar of allRec) {
                if (newStock < Number(ar.quantity_needed)) {
                    await conn.query('UPDATE products SET is_available = 0 WHERE id = ?', [ar.product_id]);
                }
            }
        }

        await conn.query(`
            INSERT INTO orders (
                id, idempotency_key, order_number, queue_number, table_id, table_name,
                customer_type, student_name, student_campus, student_id_num, student_email,
                student_photo_url, student_faculty_id, student_faculty_code, student_faculty_name,
                student_study_program, student_birth_date, is_birthday_reward,
                subtotal, total_savings, service_fee, tax, total, payment_method, status,
                payment_ref, fraud_score, fraud_risk, verification_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?)
        `, [
            orderId, b.idempotencyKey || null, orderNumber, queueNumber, tables[0].id, tables[0].name,
            b.customerType, b.studentInfo?.studentName || null, b.studentInfo?.campus || null,
            b.studentInfo?.studentId || null, b.studentInfo?.email || null, photoUrl,
            b.studentInfo?.facultyId || null, b.studentInfo?.facultyCode || null, b.studentInfo?.facultyName || null,
            b.studentInfo?.studyProgram || null, b.studentInfo?.birthDate || null, 0,
            subtotal, totalSavings, sFee, tax, grandTotal, b.paymentMethod, accessToken,
            fraudScore, fraudRisk, verificationStatus
        ]);

        if (parent) {
            await conn.query('UPDATE orders SET parent_order_number = ? WHERE id = ?', [parent.order_number, orderId]);
        }

        for (const item of itemsToInsert) {
            await conn.query(`
                INSERT INTO order_items (
                    id, order_id, product_id, product_name, quantity, base_price,
                    regular_base_price, price, regular_price, savings, line_total, options_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                item.id, orderId, item.product_id, item.product_name, item.quantity,
                item.base_price, item.regular_base_price, item.price, item.regular_price,
                item.savings, item.line_total, item.options_json
            ]);
        }

        await conn.commit();

        let paymentUrl = null;
        if (b.paymentMethod === 'QRIS' || b.paymentMethod === 'QRIS_DEMO') {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const studentEmail = (b.studentInfo?.email || '').trim();
            const safeEmail = (studentEmail && emailRegex.test(studentEmail)) ? studentEmail : 'customer@cafecampus.demo';
            const safeName = (b.studentInfo?.studentName || 'Pelanggan').trim().slice(0, 50) || 'Pelanggan';

            const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
            const appBase = process.env.APP_URL ? process.env.APP_URL.replace(/\/+$/, '') : `${protocol}://${req.get('host')}`;

            const parameter = {
                transaction_details: { order_id: orderNumber, gross_amount: grandTotal },
                customer_details: { first_name: safeName, email: safeEmail },
                callbacks: { finish: `${appBase}/track/${orderNumber}` }
            };
            try {
                const snapTransaction = await snap.createTransaction(parameter);
                paymentUrl = snapTransaction.redirect_url;
                await pool.query('UPDATE orders SET payment_url = ? WHERE order_number = ?', [paymentUrl, orderNumber]);
            } catch (payErr) {
                paymentUrl = `/track/${orderNumber}?simulated=qris`;
            }
        }

        const resData = {
            orderNumber,
            accessToken,
            queueNumber,
            status: 'NEW',
            total: grandTotal,
            subtotal,
            totalSavings,
            tableName: tables[0].name,
            payment: { method: b.paymentMethod, status: 'PENDING' },
            paymentUrl,
            parentOrderNumber: parent ? parent.order_number : null,
            isBirthdayToday
        };

        broadcast('admin-order', resData);
        broadcast('kitchen-order', resData);

        sendPushNotification('admin', null, {
            title: `🔔 Pesanan Baru #${orderNumber} (${queueNumber})`,
            body: `${tables[0].name} • Total ${formatRupiah(grandTotal)} (${b.paymentMethod})`,
            url: '/admin/orders',
            tag: 'admin-order-' + orderNumber
        });

        res.status(201).json(resData);
    } catch (err) {
        await conn.rollback();
        if ((err.code === 'ER_DUP_ENTRY' || err.message?.includes('Duplicate entry')) && b.idempotencyKey) {
            try {
                const [existing] = await pool.query('SELECT * FROM orders WHERE idempotency_key = ?', [b.idempotencyKey]);
                if (existing.length > 0) {
                    const ex = existing[0];
                    return res.status(200).json({
                        orderNumber: ex.order_number,
                        accessToken: ex.payment_ref,
                        status: ex.status,
                        queueNumber: ex.queue_number,
                        total: Number(ex.total),
                        tableName: ex.table_name,
                        payment: { method: ex.payment_method, status: ex.payment_status },
                        paymentUrl: ex.payment_url || null,
                        parentOrderNumber: ex.parent_order_number || null
                    });
                }
            } catch (exErr) {}
        }
        res.status(400).json({ message: err.message });
    } finally {
        conn.release();
    }
});

// Endpoint Midtrans Webhook
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
    } catch (err) { res.status(500).json({ message: 'Webhook failed' }); }
});

// Endpoint Detail & Pelacakan Pesanan Customer
app.get('/api/orders/:orderNum', async (req, res) => {
    try {
        const [orders] = await pool.query('SELECT * FROM orders WHERE order_number = ?', [req.params.orderNum]);
        if (!orders.length) return res.status(404).json({ message: 'Not found' });
        let o = orders[0];

        if (req.query.access !== o.payment_ref) return res.status(403).json({ message: 'Akses ditolak' });

        if (o.payment_status === 'PENDING' && (o.payment_method === 'QRIS' || o.payment_method === 'QRIS_DEMO')) {
            const ageMinutes = (Date.now() - new Date(o.created_at).getTime()) / 60000;
            if (ageMinutes >= QRIS_EXPIRY_MINUTES) {
                await pool.query("UPDATE orders SET status = 'CANCELLED', payment_status = 'FAILED' WHERE order_number = ?", [o.order_number]);
                o.payment_status = 'FAILED'; o.status = 'CANCELLED';
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
            parentOrderNumber: o.parent_order_number || null,
            addons,
            qrisExpiresInSec: expiresInSec,
            orderNumber: o.order_number,
            queueNumber: o.queue_number,
            tableName: o.table_name,
            status: o.status,
            customerType: o.customer_type,
            total: Number(o.total),
            subtotal: Number(o.subtotal),
            totalSavings: Number(o.total_savings || 0),
            serviceFee: Number(o.service_fee),
            tax: Number(o.tax),
            payment: { method: o.payment_method, status: o.payment_status, qrisUrl: o.payment_url },
            studentInfo: o.customer_type === 'STUDENT' ? {
                verificationStatus: o.verification_status,
                rejectionReason: o.rejection_reason,
                fraudScore: o.fraud_score,
                fraudRisk: o.fraud_risk,
                studentName: o.student_name,
                campus: o.student_campus,
                studentId: o.student_id_num,
                email: o.student_email,
                studentPhoto: o.student_photo_url,
                facultyId: o.student_faculty_id,
                facultyCode: o.student_faculty_code,
                facultyName: o.student_faculty_name,
                facultyColor: FACULTY_THEME_COLORS[(o.student_faculty_code || '').toUpperCase()] || '#0284c7',
                studyProgram: o.student_study_program,
                birthDate: o.student_birth_date,
                isBirthdayToday: checkIsBirthdayToday(o.student_birth_date),
                isBirthdayRewardClaimed: Boolean(o.is_birthday_reward)
            } : null,
            items: items.map(i => ({
                productName: i.product_name,
                quantity: i.quantity,
                price: Number(i.price),
                regularPrice: Number(i.regular_price || i.price),
                savings: Number(i.savings || 0),
                lineTotal: Number(i.line_total),
                options: typeof i.options_json === 'string' ? JSON.parse(i.options_json || '{}') : (i.options_json || {}),
                note: i.note
            })),
            history: [{ status: 'NEW', at: o.created_at }]
        });
    } catch (err) { res.status(500).json({ message: "Server Error" }); }
});

// ==========================================
// ADMIN & STAFF AUTHENTICATION MIDDLEWARE
// ==========================================
const authRole = (...allowedRoles) => (req, res, next) => {
    const cookieToken = getCookies(req).cc_demo_admin;
    const authHeader = req.headers.authorization;
    const token = cookieToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);

    if (!token) return res.status(401).json({ message: 'Unauthorized: login diperlukan' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: 'Token Invalid atau Kedaluwarsa' });
        req.user = user;
        if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
            return res.status(403).json({ message: `Akses ditolak: role ${user.role} tidak memiliki izin.` });
        }
        next();
    });
};

const authAdmin = authRole('ADMIN', 'CASHIER');
const authSuperAdmin = authRole('ADMIN');
const authKitchen = authRole('ADMIN', 'KITCHEN');

// Endpoint Login Staff / Kasir / Dapur
app.post('/api/admin/login', loginLimiter, async (req, res) => {
    const emailInput = String(req.body?.email || '').trim();
    const email = emailInput.toLowerCase();
    const password = req.body?.password;
    if (!email || !password) return res.status(400).json({ message: 'Email dan password wajib diisi.' });
    try {
        const [admins] = await pool.query('SELECT * FROM admins WHERE LOWER(email) = ?', [email]);
        const dummyHash = '$2b$10$0EE0QHUTP7y0S9kI1x0bXOjzyFdfzbBm9EI5qkmkaAWUL4CVZy4JG';
        const hashToCompare = admins.length ? admins[0].password_hash : dummyHash;
        let isValid = await bcrypt.compare(password, hashToCompare);
        // Block known seed credentials in production even if a legacy server
        // previously upgraded the seed hash to bcrypt(admin123/kasir123/dapur123).
        if (!IS_DEMO && (
            (email === 'admin@cafecampus.demo' && password === 'admin123') ||
            (email === 'kasir@cafecampus.demo' && password === 'kasir123') ||
            (email === 'dapur@cafecampus.demo' && password === 'dapur123')
        )) {
            isValid = false;
        }

        if (IS_DEMO && admins.length && !isValid) {
            if ((email === 'admin@cafecampus.demo' && password === 'admin123') ||
                (email === 'kasir@cafecampus.demo' && password === 'kasir123') ||
                (email === 'dapur@cafecampus.demo' && password === 'dapur123')) {
                isValid = true;
            }
        }

        if (!admins.length || !isValid) return res.status(401).json({ message: 'Email atau password salah.' });
        const admin = admins[0];
        const token = jwt.sign({ id: admin.id, name: admin.name, email: admin.email, role: admin.role }, JWT_SECRET, { expiresIn: '12h' });

        const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
        res.cookie('cc_demo_admin', token, {
            httpOnly: true,
            maxAge: 43200000,
            sameSite: 'lax',
            secure: isHttps,
        });

        await logAudit(admin.id, admin.name, admin.role, 'LOGIN', 'ADMIN', admin.id, { email: admin.email }, req);
        res.json({
            ok: true,
            token,
            user: { id: admin.id, name: admin.name, email: admin.email, role: admin.role }
        });
    } catch (err) {
        console.error('[auth] Login admin gagal:', err.code || err.message);
        res.status(500).json({ message: 'Terjadi kesalahan server. Periksa koneksi database atau log server.' });
    }
});

app.get('/api/admin/me', authRole('ADMIN', 'CASHIER', 'KITCHEN'), async (req, res) => {
    try {
        const [admins] = await pool.query('SELECT id, name, email, role FROM admins WHERE id = ?', [req.user.id]);
        if (!admins.length) return res.status(404).json({ message: 'User not found' });
        res.json(admins[0]);
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.put('/api/admin/me/password', authRole('ADMIN', 'CASHIER', 'KITCHEN'), async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Password saat ini dan password baru wajib diisi.' });
    }
    if (newPassword.length < 12) {
        return res.status(400).json({ message: 'Password baru minimal 12 karakter.' });
    }
    if (Buffer.byteLength(newPassword, 'utf8') > 72) {
        return res.status(400).json({ message: 'Password baru terlalu panjang. Maksimal 72 byte.' });
    }
    if (currentPassword === newPassword) {
        return res.status(400).json({ message: 'Password baru harus berbeda dari password saat ini.' });
    }

    try {
        const [rows] = await pool.query('SELECT id, password_hash, email, name, role FROM admins WHERE id = ? LIMIT 1', [req.user.id]);
        if (!rows.length) return res.status(404).json({ message: 'Akun tidak ditemukan.' });
        const admin = rows[0];
        let currentValid = await bcrypt.compare(currentPassword, admin.password_hash);
        if (!currentValid && IS_DEMO) {
            currentValid = (admin.email === 'admin@cafecampus.demo' && currentPassword === 'admin123') ||
                (admin.email === 'kasir@cafecampus.demo' && currentPassword === 'kasir123') ||
                (admin.email === 'dapur@cafecampus.demo' && currentPassword === 'dapur123');
        }
        if (!currentValid) return res.status(401).json({ message: 'Password saat ini tidak cocok.' });

        const newHash = await bcrypt.hash(newPassword, 12);
        await pool.query('UPDATE admins SET password_hash = ? WHERE id = ?', [newHash, admin.id]);
        await logAudit(admin.id, admin.name, admin.role, 'CHANGE_PASSWORD', 'ADMIN', admin.id, {}, req);
        res.json({ ok: true, message: 'Password berhasil diperbarui.' });
    } catch (err) {
        console.error('[auth] Gagal mengubah password:', err.code || err.message);
        res.status(500).json({ message: 'Password belum dapat diperbarui. Periksa log server.' });
    }
});

app.post('/api/admin/logout', (req, res) => {
    res.clearCookie('cc_demo_admin');
    res.json({ ok: true });
});

// Endpoint Pembayaran QRIS Sandbox Demo (Tanpa auth cookie agar bisa dipanggil customer/sandbox/test)
app.post('/api/demo/payments/:orderNum/pay', async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [ords] = await conn.query('SELECT * FROM orders WHERE order_number = ? FOR UPDATE', [req.params.orderNum]);
        if (!ords.length) {
            await conn.rollback();
            return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
        }
        const ord = ords[0];
        if (ord.status === 'CANCELLED') {
            await conn.rollback();
            return res.status(400).json({ message: 'Pesanan sudah dibatalkan.' });
        }
        if (ord.payment_method === 'CASH') {
            await conn.rollback();
            return res.status(400).json({ message: 'Pesanan dengan metode tunai harus dibayar dan dikonfirmasi langsung oleh kasir di meja kasir.' });
        }
        if (ord.payment_status === 'PAID') {
            await conn.rollback();
            return res.json({ ok: true, payment: { status: 'PAID' } });
        }

        await conn.query('UPDATE orders SET payment_status = "PAID", paid_at = NOW() WHERE order_number = ?', [req.params.orderNum]);

        // Catat ke shift kasir aktif jika ada
        const [openShift] = await conn.query('SELECT id FROM cashier_shifts WHERE status = "OPEN" ORDER BY started_at DESC LIMIT 1');
        if (openShift.length) {
            await conn.query(`
                UPDATE cashier_shifts
                SET total_orders_count = total_orders_count + 1,
                    total_sales_qris = total_sales_qris + ?
                WHERE id = ?
            `, [Number(ord.total), openShift[0].id]);
        }

        if (ord.customer_type === 'STUDENT' && ord.student_id_num) {
            const pointsEarned = Math.floor(Number(ord.total) / 10000);
            if (pointsEarned > 0) {
                await conn.query(`
                    INSERT INTO loyalty_accounts (id, student_id_num, student_name, points_balance, total_spent)
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE points_balance = points_balance + VALUES(points_balance), total_spent = total_spent + VALUES(total_spent)
                `, [crypto.randomUUID(), ord.student_id_num, ord.student_name || 'Pelajar', pointsEarned, Number(ord.total)]);

                const [acc] = await conn.query('SELECT points_balance FROM loyalty_accounts WHERE student_id_num = ?', [ord.student_id_num]);
                await conn.query(`
                    INSERT INTO loyalty_logs (id, student_id_num, points_change, balance_after, type, reference_order_number, description)
                    VALUES (?, ?, ?, ?, 'EARNED', ?, ?)
                `, [crypto.randomUUID(), ord.student_id_num, pointsEarned, acc[0]?.points_balance || pointsEarned, ord.order_number, `Poin dari transaksi #${ord.order_number}`]);
            }
        }

        await conn.commit();
        await notifyPaidOrder(req.params.orderNum);
        res.json({ ok: true, payment: { status: 'PAID' } });
    } catch(e) {
        await conn.rollback();
        res.status(500).json({ message: 'Terjadi kesalahan server.' });
    } finally {
        conn.release();
    }
});

// Poin 1: Penanganan Penolakan KTM (Revert to Regular Price Secara Otomatis & Konsisten)
app.patch('/api/admin/orders/:orderNumber/verify-student', authAdmin, async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { status, reason } = req.body;
        const orderNum = req.params.orderNumber;

        await conn.beginTransaction();
        const [orders] = await conn.query('SELECT * FROM orders WHERE order_number = ? FOR UPDATE', [orderNum]);
        if (!orders.length) {
            await conn.rollback();
            return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
        }
        const o = orders[0];

        if (status === 'REJECTED') {
            await conn.query(`
                UPDATE orders
                SET verification_status = 'REJECTED',
                    rejection_reason = ?,
                    customer_type = 'REGULAR',
                    total_savings = 0.00
                WHERE order_number = ? OR parent_order_number = ?
            `, [reason || 'Foto selfie bukan kartu mahasiswa', orderNum, orderNum]);

            const [items] = await conn.query('SELECT * FROM order_items WHERE order_id = ?', [o.id]);

            let newSubtotal = 0;
            for (const it of items) {
                const regPrice = Number(it.regular_price);
                const regBasePrice = Number(it.regular_base_price);
                const lineTotal = regPrice * it.quantity;
                newSubtotal += lineTotal;

                await conn.query(`
                    UPDATE order_items
                    SET price = ?, base_price = ?, savings = 0.00, line_total = ?
                    WHERE id = ?
                `, [regPrice, regBasePrice, lineTotal, it.id]);
            }

            const [setRows] = await conn.query('SELECT service_fee, tax_percent FROM settings WHERE id = 1');
            const sFeePct = setRows.length ? Number(setRows[0].service_fee) : 5;
            const taxPct = setRows.length ? Number(setRows[0].tax_percent) : 11;
            const newFee = Math.round(newSubtotal * sFeePct / 100);
            const newTax = Math.round((newSubtotal + newFee) * taxPct / 100);
            const newTotal = newSubtotal + newFee + newTax;

            await conn.query(`
                UPDATE orders
                SET subtotal = ?, service_fee = ?, tax = ?, total = ?
                WHERE id = ?
            `, [newSubtotal, newFee, newTax, newTotal, o.id]);

            await conn.commit();

            const [updatedOrders] = await pool.query('SELECT * FROM orders WHERE id = ?', [o.id]);
            const [updatedItems] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [o.id]);
            const u = updatedOrders[0];

            const itemPayload = updatedItems.map(i => ({
                id: i.id,
                productName: i.product_name,
                price: Number(i.price),
                regularPrice: Number(i.regular_price),
                quantity: i.quantity,
                lineTotal: Number(i.line_total),
                savings: 0,
                options: typeof i.options_json === 'string' ? JSON.parse(i.options_json || '{}') : (i.options_json || {})
            }));

            broadcast('order-update', {
                orderNumber: u.order_number,
                status: u.status,
                customerType: 'REGULAR',
                verificationStatus: 'REJECTED',
                rejectionReason: reason || 'Foto selfie bukan kartu mahasiswa',
                subtotal: Number(u.subtotal),
                serviceFee: Number(u.service_fee),
                tax: Number(u.tax),
                totalSavings: 0,
                total: Number(u.total),
                items: itemPayload
            });

            await logAudit(req.user.id, req.user.name, req.user.role, 'STUDENT_REJECT', 'ORDER', u.order_number, { reason }, req);

            return res.json({
                ok: true,
                orderNumber: u.order_number,
                customerType: 'REGULAR',
                totalSavings: 0,
                subtotal: Number(u.subtotal),
                total: Number(u.total),
                studentInfo: {
                    verificationStatus: 'REJECTED',
                    rejectionReason: reason || null,
                    studentName: u.student_name,
                    campus: u.student_campus,
                    studentId: u.student_id_num
                },
                items: updatedItems.map(i => ({
                    id: i.id,
                    productName: i.product_name,
                    price: Number(i.price),
                    regularPrice: Number(i.regular_price),
                    quantity: i.quantity,
                    lineTotal: Number(i.line_total)
                }))
            });
        } else {
            await conn.query(`
                UPDATE orders
                SET verification_status = 'VERIFIED'
                WHERE order_number = ? OR parent_order_number = ?
            `, [orderNum, orderNum]);

            await conn.commit();

            const [updatedOrders] = await pool.query('SELECT * FROM orders WHERE id = ?', [o.id]);
            const u = updatedOrders[0];

            broadcast('order-update', {
                orderNumber: u.order_number,
                status: u.status,
                verificationStatus: 'VERIFIED'
            });

            await logAudit(req.user.id, req.user.name, req.user.role, 'STUDENT_APPROVE', 'ORDER', u.order_number, {}, req);

            return res.json({
                ok: true,
                orderNumber: u.order_number,
                studentInfo: {
                    verificationStatus: 'VERIFIED',
                    studentName: u.student_name,
                    campus: u.student_campus,
                    studentId: u.student_id_num
                }
            });
        }
    } catch(e) {
        await conn.rollback();
        res.status(500).json({ message: e.message });
    } finally {
        conn.release();
    }
});

// Poin 3: Payment Confirmation Kasir
app.patch('/api/admin/orders/:orderNumber/payment', authAdmin, async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [ords] = await conn.query('SELECT * FROM orders WHERE order_number = ? FOR UPDATE', [req.params.orderNumber]);
        if (!ords.length) {
            await conn.rollback();
            return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
        }
        const o = ords[0];

        if (o.payment_status === 'PAID') {
            await conn.rollback();
            return res.status(400).json({ message: 'Pesanan sudah berstatus LUNAS sebelumnya.' });
        }
        if (o.status === 'CANCELLED') {
            await conn.rollback();
            return res.status(400).json({ message: 'Pesanan sudah dibatalkan.' });
        }

        const amountPaid = Number(req.body.amountPaid ?? req.body.cashGiven ?? o.total);
        if (amountPaid < Number(o.total)) {
            await conn.rollback();
            return res.status(400).json({
                message: `Nominal uang yang diterima (Rp ${amountPaid.toLocaleString('id-ID')}) kurang dari total tagihan (Rp ${Number(o.total).toLocaleString('id-ID')}).`
            });
        }
        const change = Math.max(0, amountPaid - Number(o.total));

        await conn.query('UPDATE orders SET payment_status = "PAID", paid_at = NOW() WHERE order_number = ?', [req.params.orderNumber]);

        const [openShift] = await conn.query('SELECT id FROM cashier_shifts WHERE cashier_id = ? AND status = "OPEN"', [req.user.id]);
        if (openShift.length) {
            const isCash = o.payment_method === 'CASH';
            await conn.query(`
                UPDATE cashier_shifts
                SET total_orders_count = total_orders_count + 1,
                    total_sales_cash = total_sales_cash + ?,
                    total_sales_qris = total_sales_qris + ?,
                    ending_cash_system = ending_cash_system + ?
                WHERE id = ?
            `, [isCash ? Number(o.total) : 0, isCash ? 0 : Number(o.total), isCash ? Number(o.total) : 0, openShift[0].id]);
        }

        if (o.customer_type === 'STUDENT' && o.student_id_num) {
            const pointsEarned = Math.floor(Number(o.total) / 10000);
            if (pointsEarned > 0) {
                await conn.query(`
                    INSERT INTO loyalty_accounts (id, student_id_num, student_name, points_balance, total_spent)
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE points_balance = points_balance + VALUES(points_balance), total_spent = total_spent + VALUES(total_spent)
                `, [crypto.randomUUID(), o.student_id_num, o.student_name || 'Pelajar', pointsEarned, Number(o.total)]);
            }
        }

        await conn.commit();
        await logAudit(req.user.id, req.user.name, req.user.role, 'CONFIRM_PAYMENT', 'ORDER', o.order_number, { total: o.total, method: o.payment_method, amountPaid, change }, req);
        await notifyPaidOrder(req.params.orderNumber);

        res.json({ ok: true, payment: { status: 'PAID', method: o.payment_method }, amountPaid, change });
    } catch(e) {
        await conn.rollback();
        res.status(500).json({ message: e.message });
    } finally {
        conn.release();
    }
});

// Update Status Alur Pesanan
app.patch('/api/admin/orders/:orderNumber/status', authAdmin, async (req, res) => {
    try {
        const { status } = req.body;
        if (!status || !VALID_ORDER_STATUSES.includes(status)) {
            return res.status(400).json({ message: `Status tidak valid. Gunakan salah satu: ${VALID_ORDER_STATUSES.join(', ')}` });
        }

        const [ords] = await pool.query('SELECT * FROM orders WHERE order_number = ?', [req.params.orderNumber]);
        if (!ords.length) return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
        const ord = ords[0];

        if (ord.customer_type === 'STUDENT' && ord.payment_status !== 'PAID' && (status === 'PROCESSING' || status === 'READY')) {
            return res.status(409).json({ message: 'Pesanan pelajar yang belum dibayar tidak dapat diproses dapur.' });
        }
        if (ord.payment_status === 'PAID' && status === 'CANCELLED') {
            return res.status(409).json({ message: 'Pesanan yang sudah lunas tidak bisa dibatalkan langsung. Gunakan menu Void/Refund Pesanan.' });
        }

        if (status === 'PROCESSING') {
            if (req.headers['x-enforce-receipt'] === 'true' && !ord.receipt_printed) {
                return res.status(409).json({ message: 'Struk pesanan wajib dicetak terlebih dahulu sebelum memproses pesanan ke dapur.' });
            }
            await pool.query('UPDATE orders SET status = ?, receipt_printed = 1, receipt_printed_at = COALESCE(receipt_printed_at, NOW()) WHERE order_number = ?', [status, req.params.orderNumber]);
        } else {
            await pool.query('UPDATE orders SET status = ? WHERE order_number = ?', [status, req.params.orderNumber]);
        }

        broadcast('order-update', {
            orderNumber: req.params.orderNumber,
            status,
            tableName: ord.table_name || '',
            total: Number(ord.total || 0),
            payment: { method: ord.payment_method, status: ord.payment_status },
            receiptPrinted: status === 'PROCESSING' ? true : Boolean(ord.receipt_printed)
        });
        broadcast('kitchen-order', {
            orderNumber: req.params.orderNumber,
            status
        });

        if (status === 'READY') {
            sendPushNotification('customer', req.params.orderNumber, {
                title: `☕ PESANAN #${req.params.orderNumber} SIAP DIAMBIL!`,
                body: `Pesanan di ${ord.table_name || 'meja Anda'} sudah selesai diracik. Silakan ambil di konter!`,
                url: `/track/${req.params.orderNumber}`,
                tag: `ready-${req.params.orderNumber}`
            });
        }

        await logAudit(req.user.id, req.user.name, req.user.role, 'STATUS_CHANGE', 'ORDER', req.params.orderNumber, { from: ord.status, to: status }, req);
        res.json({ ok: true, status });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

// Poin 17: Void / Refund Pesanan
app.post('/api/admin/orders/:orderNumber/void', authSuperAdmin, async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { reason } = req.body;
        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ message: 'Alasan pembatalan/void wajib diisi.' });
        }

        await conn.beginTransaction();
        const [ords] = await conn.query('SELECT * FROM orders WHERE order_number = ? FOR UPDATE', [req.params.orderNumber]);
        if (!ords.length) {
            await conn.rollback();
            return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
        }
        const o = ords[0];
        if (o.status === 'CANCELLED' || o.payment_status === 'REFUNDED') {
            await conn.rollback();
            return res.status(400).json({ message: 'Pesanan sudah berstatus CANCELLED / REFUNDED sebelumnya. Stok tidak dapat dikembalikan ganda.' });
        }

        const [items] = await conn.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [o.id]);
        for (const it of items) {
            const [recipes] = await conn.query('SELECT raw_material_id, quantity_needed FROM product_recipes WHERE product_id = ?', [it.product_id]);
            for (const r of recipes) {
                const returnQty = Number(r.quantity_needed) * it.quantity;
                await conn.query('UPDATE raw_materials SET current_stock = current_stock + ? WHERE id = ?', [returnQty, r.raw_material_id]);

                const [mat] = await conn.query('SELECT current_stock FROM raw_materials WHERE id = ?', [r.raw_material_id]);
                const newStock = Number(mat[0]?.current_stock || 0);

                await conn.query(`
                    INSERT INTO stock_mutations (id, raw_material_id, type, quantity, balance_after, reference_order_number, notes)
                    VALUES (?, ?, 'VOID_RESTORE', ?, ?, ?, ?)
                `, [crypto.randomUUID(), r.raw_material_id, returnQty, newStock, o.order_number, `Restorasi stok void #${o.order_number}: ${reason}`]);

                // Jika stok sekarang sudah di atas kebutuhan minimal, buka kembali ketersediaan produk
                if (newStock >= Number(r.quantity_needed)) {
                    await conn.query('UPDATE products SET is_available = 1 WHERE id = ?', [it.product_id]);
                }
            }
        }

        await conn.query(`
            UPDATE orders
            SET status = 'CANCELLED',
                payment_status = 'REFUNDED',
                void_reason = ?,
                voided_by = ?,
                voided_at = NOW()
            WHERE id = ?
        `, [reason, req.user.id, o.id]);

        await conn.commit();
        await logAudit(req.user.id, req.user.name, req.user.role, 'VOID_ORDER', 'ORDER', o.order_number, { reason, total: o.total }, req);

        broadcast('order-update', {
            orderNumber: o.order_number,
            status: 'CANCELLED',
            paymentStatus: 'REFUNDED'
        });

        res.json({ ok: true, message: `Pesanan #${o.order_number} berhasil di-void dan stok dikembalikan.` });
    } catch(e) {
        await conn.rollback();
        res.status(500).json({ message: e.message });
    } finally {
        conn.release();
    }
});

// Poin 9: Klaim Hadiah Ulang Tahun
const claimBirthdayHandler = async (req, res) => {
    try {
        const [ords] = await pool.query('SELECT * FROM orders WHERE order_number = ?', [req.params.orderNumber]);
        if (!ords.length) return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
        const o = ords[0];

        if (!o.student_id_num) return res.status(400).json({ message: 'Pesanan bukan milik mahasiswa.' });

        const currentYear = new Date().getFullYear();
        const [claimed] = await pool.query('SELECT * FROM birthday_rewards WHERE student_id_num = ? AND reward_year = ?', [o.student_id_num, currentYear]);
        if (claimed.length) {
            return res.status(400).json({ message: `Hadiah ulang tahun untuk NIM ${o.student_id_num} sudah pernah diklaim pada tahun ${currentYear}.` });
        }

        const rewardName = req.body.rewardName || 'Free Birthday Artisanal Treat';
        await pool.query(`
            INSERT INTO birthday_rewards (id, student_id_num, reward_year, reward_name, order_number)
            VALUES (?, ?, ?, ?, ?)
        `, [crypto.randomUUID(), o.student_id_num, currentYear, rewardName, o.order_number]);

        await pool.query('UPDATE orders SET is_birthday_reward = 1, birthday_reward_name = ? WHERE id = ?', [rewardName, o.id]);
        await logAudit(req.user.id, req.user.name, req.user.role, 'CLAIM_BIRTHDAY', 'STUDENT', o.student_id_num, { rewardName, orderNumber: o.order_number }, req);

        res.json({ ok: true, message: `Hadiah "${rewardName}" berhasil diberikan!` });
    } catch(e) { res.status(500).json({ message: e.message }); }
};

app.post('/api/admin/orders/:orderNumber/claim-birthday', authAdmin, claimBirthdayHandler);
app.post('/api/admin/orders/:orderNumber/birthday-reward', authAdmin, claimBirthdayHandler);

// Poin 5: Struk Pemesanan 3 Tahap & 2 Dapur
app.get('/api/admin/orders/:orderNum/receipt', authAdmin, async (req, res) => {
    try {
        const [orders] = await pool.query('SELECT * FROM orders WHERE order_number = ?', [req.params.orderNum]);
        if (!orders.length) return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
        const o = orders[0];

        const [items] = await pool.query(`
            SELECT oi.*, p.category_id, c.name AS category_name, c.kitchen_type
            FROM order_items oi
            LEFT JOIN products p ON oi.product_id = p.id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE oi.order_id = ?
        `, [o.id]);

        const [settings] = await pool.query('SELECT * FROM settings WHERE id = 1');
        const s = settings[0] || {};

        const mapItem = i => ({
            productName: i.product_name,
            quantity: i.quantity,
            price: Number(i.price),
            regularPrice: Number(i.regular_price || i.price),
            lineTotal: Number(i.line_total),
            note: i.note || '',
            options: typeof i.options_json === 'string' ? JSON.parse(i.options_json || '{}') : (i.options_json || {}),
            kitchenType: i.kitchen_type || 'DRINK',
            categoryName: i.category_name || ''
        });

        res.json({
            orderNumber: o.order_number,
            queueNumber: o.queue_number || 'Q-001',
            tableName: o.table_name,
            customerType: o.customer_type,
            studentName: o.student_name || null,
            studentCampus: o.student_campus || null,
            studentFaculty: o.student_faculty_name || null,
            studentIdNum: o.student_id_num || null,
            createdAt: o.created_at,
            paidAt: o.paid_at || null,
            status: o.status,
            paymentMethod: o.payment_method,
            paymentStatus: o.payment_status,
            subtotal: Number(o.subtotal),
            totalSavings: Number(o.total_savings || 0),
            serviceFee: Number(o.service_fee),
            tax: Number(o.tax),
            total: Number(o.total),
            cafeName: s.cafe_name || 'Cafe Campus',
            cafeAddress: s.cafe_address || '',
            cafePhone: s.cafe_phone || '',
            receiptPrinted: Boolean(o.receipt_printed),
            receiptPrintedAt: o.receipt_printed_at,
            items: items.map(mapItem),
            drinkItems: items.filter(i => (i.kitchen_type || 'DRINK') === 'DRINK').map(mapItem),
            foodItems: items.filter(i => i.kitchen_type === 'FOOD').map(mapItem),
        });
    } catch(e) { res.status(500).json({ message: 'Terjadi kesalahan server.' }); }
});

// Endpoint Konfirmasi Cetak Struk Pesanan
app.post('/api/admin/orders/:orderNum/print', authAdmin, async (req, res) => {
    try {
        const [orders] = await pool.query('SELECT * FROM orders WHERE order_number = ?', [req.params.orderNum]);
        if (!orders.length) return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
        const o = orders[0];

        await pool.query('UPDATE orders SET receipt_printed = 1, receipt_printed_at = NOW() WHERE order_number = ?', [req.params.orderNum]);

        await logAudit(req.user.id, req.user.name, req.user.role, 'PRINT_RECEIPT', 'ORDER', req.params.orderNum, {
            type: req.body.type || 'CUSTOMER',
            tableName: o.table_name
        }, req);

        broadcast('order-update', {
            orderNumber: req.params.orderNum,
            status: o.status,
            receiptPrinted: true,
            receiptPrintedAt: new Date().toISOString()
        });

        res.json({
            ok: true,
            orderNumber: req.params.orderNum,
            receiptPrinted: true,
            receiptPrintedAt: new Date().toISOString()
        });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

// ==========================================
// KITCHEN DISPLAY SYSTEM (KDS) ENDPOINTS
// ==========================================
app.get('/api/kds/orders', authKitchen, async (req, res) => {
    try {
        const station = req.query.station || 'ALL';
        const [orders] = await pool.query(`
            SELECT * FROM orders
            WHERE status IN ('NEW', 'PROCESSING', 'READY')
            ORDER BY created_at ASC
        `);

        const result = [];
        for (const o of orders) {
            const [items] = await pool.query(`
                SELECT oi.*, c.kitchen_type
                FROM order_items oi
                LEFT JOIN products p ON oi.product_id = p.id
                LEFT JOIN categories c ON c.id = p.category_id
                WHERE oi.order_id = ?
            `, [o.id]);

            const filteredItems = items.filter(i => {
                if (station === 'DRINK') return (i.kitchen_type || 'DRINK') === 'DRINK';
                if (station === 'FOOD') return i.kitchen_type === 'FOOD';
                return true;
            });

            if (station !== 'ALL' && filteredItems.length === 0) continue;

            result.push({
                orderNumber: o.order_number,
                queueNumber: o.queue_number,
                tableName: o.table_name,
                status: o.status,
                customerType: o.customer_type,
                createdAt: o.created_at,
                paymentStatus: o.payment_status,
                payment: { status: o.payment_status, method: o.payment_method },
                receiptPrinted: Boolean(o.receipt_printed),
                receiptPrintedAt: o.receipt_printed_at,
                items: filteredItems.map(i => ({
                    productName: i.product_name,
                    quantity: i.quantity,
                    kitchenType: i.kitchen_type || 'DRINK',
                    note: i.note,
                    options: typeof i.options_json === 'string' ? JSON.parse(i.options_json || '{}') : (i.options_json || {})
                }))
            });
        }
        res.json(result);
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.patch('/api/kds/orders/:orderNumber/bump', authKitchen, async (req, res) => {
    try {
        const [ords] = await pool.query('SELECT status, table_name FROM orders WHERE order_number = ?', [req.params.orderNumber]);
        if (!ords.length) return res.status(404).json({ message: 'Pesanan tidak ditemukan' });
        const current = ords[0].status;

        let nextStatus = 'PROCESSING';
        if (current === 'NEW') nextStatus = 'PROCESSING';
        else if (current === 'PROCESSING') nextStatus = 'READY';
        else if (current === 'READY') nextStatus = 'COMPLETED';

        await pool.query('UPDATE orders SET status = ? WHERE order_number = ?', [nextStatus, req.params.orderNumber]);

        broadcast('order-update', {
            orderNumber: req.params.orderNumber,
            status: nextStatus
        });
        broadcast('kitchen-order', {
            orderNumber: req.params.orderNumber,
            status: nextStatus
        });

        if (nextStatus === 'READY') {
            sendPushNotification('customer', req.params.orderNumber, {
                title: `☕ PESANAN #${req.params.orderNumber} SIAP DIAMBIL!`,
                body: `Pesanan di ${ords[0].table_name || 'meja Anda'} sudah selesai diracik. Silakan ambil di konter!`,
                url: `/track/${req.params.orderNumber}`,
                tag: `ready-${req.params.orderNumber}`
            });
        }

        res.json({ ok: true, status: nextStatus });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

// ==========================================
// MASTER DATA FAKULTAS (CRUD ADMIN)
// ==========================================
app.get('/api/admin/faculties', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM faculties ORDER BY name ASC');
        res.json(rows.map(r => ({
            ...r,
            colorTheme: r.color,
            secondaryColor: r.secondary_color
        })));
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/admin/faculties', authAdmin, async (req, res) => {
    try {
        const { id: customId, code, name, color, colorTheme, secondaryColor, icon } = req.body;
        if (!code || !name) return res.status(400).json({ message: 'Kode dan nama fakultas wajib diisi' });

        const [exists] = await pool.query('SELECT id FROM faculties WHERE code = ?', [code]);
        if (exists.length) return res.status(409).json({ message: 'Kode fakultas sudah terdaftar' });

        const id = customId || ('fac-' + String(code).toLowerCase().replace(/[^a-z0-9]/g, ''));
        const effectiveColor = color || colorTheme || '#1e3a8a';
        await pool.query(`
            INSERT INTO faculties (id, code, name, color, secondary_color, icon, is_active)
            VALUES (?, ?, ?, ?, ?, ?, 1)
        `, [id, code, name, effectiveColor, secondaryColor || '#dbeafe', icon || 'academic-cap']);

        await logAudit(req.user.id, req.user.name, req.user.role, 'CREATE_FACULTY', 'FACULTY', id, { code, name }, req);
        res.status(201).json({ ok: true, id });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.patch('/api/admin/faculties/:id', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM faculties WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ message: 'Fakultas tidak ditemukan' });
        const old = rows[0];
        const b = req.body || {};

        await pool.query(`
            UPDATE faculties
            SET name = ?, color = ?, secondary_color = ?, is_active = ?
            WHERE id = ?
        `, [
            b.name ?? old.name,
            b.color ?? b.colorTheme ?? old.color,
            b.secondaryColor ?? old.secondary_color,
            b.isActive !== undefined ? (b.isActive ? 1 : 0) : old.is_active,
            req.params.id
        ]);

        await logAudit(req.user.id, req.user.name, req.user.role, 'UPDATE_FACULTY', 'FACULTY', req.params.id, b, req);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/admin/faculties/:id', authAdmin, async (req, res) => {
    try {
        const [orders] = await pool.query('SELECT COUNT(*) as cnt FROM orders WHERE student_faculty_id = ?', [req.params.id]);
        if (orders[0].cnt > 0) {
            await pool.query('UPDATE faculties SET is_active = 0 WHERE id = ?', [req.params.id]);
            await logAudit(req.user.id, req.user.name, req.user.role, 'DEACTIVATE_FACULTY', 'FACULTY', req.params.id, { reason: 'Has order relations' }, req);
            return res.json({
                ok: true,
                deactivated: true,
                message: `Fakultas memiliki ${orders[0].cnt} riwayat transaksi mahasiswa. Fakultas berhasil dinonaktifkan (arsip) agar tidak muncul di form pemesanan.`
            });
        }
        await pool.query('DELETE FROM faculties WHERE id = ?', [req.params.id]);
        await logAudit(req.user.id, req.user.name, req.user.role, 'DELETE_FACULTY', 'FACULTY', req.params.id, {}, req);
        res.json({ ok: true, message: 'Fakultas berhasil dihapus.' });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

// ==========================================
// INVENTORY & RECIPES (CRUD ADMIN)
// ==========================================
app.get('/api/admin/inventory/materials', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM raw_materials ORDER BY name ASC');
        res.json(rows.map(r => ({
            id: r.id,
            name: r.name,
            sku: r.sku,
            unit: r.unit,
            current_stock: Number(r.current_stock),
            min_stock: Number(r.minimum_stock),
            currentStock: Number(r.current_stock),
            minimumStock: Number(r.minimum_stock),
            costPerUnit: Number(r.cost_per_unit),
            isLowStock: Number(r.current_stock) <= Number(r.minimum_stock)
        })));
    } catch(e) { res.status(500).json({ message: e.message }); }
});

// Aliases for /api/admin/materials
app.get('/api/admin/materials', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM raw_materials ORDER BY name ASC');
        res.json(rows.map(r => ({
            ...r,
            min_stock: Number(r.minimum_stock),
            current_stock: Number(r.current_stock)
        })));
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/admin/materials', authAdmin, async (req, res) => {
    try {
        const { name, unit, min_stock, current_stock, minimum_stock } = req.body;
        if (!name) return res.status(400).json({ message: 'Nama bahan baku wajib diisi' });
        const id = 'mat-' + crypto.randomUUID().slice(0, 8);
        const minStock = Number(min_stock ?? minimum_stock ?? 50);
        const currStock = Number(current_stock ?? 0);
        await pool.query(`
            INSERT INTO raw_materials (id, name, sku, unit, current_stock, minimum_stock, cost_per_unit)
            VALUES (?, ?, ?, ?, ?, ?, 0)
        `, [id, name, name.toUpperCase().slice(0, 6), unit || 'gram', currStock, minStock]);
        res.status(201).json({ ok: true, id });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/admin/materials/:id/adjust', authAdmin, async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { changeAmount, quantity, notes } = req.body;
        const qty = Number(changeAmount ?? quantity ?? 0);
        if (isNaN(qty) || qty === 0) return res.status(400).json({ message: 'Jumlah mutasi tidak valid' });

        await conn.beginTransaction();
        const [mats] = await conn.query('SELECT * FROM raw_materials WHERE id = ? FOR UPDATE', [req.params.id]);
        if (!mats.length) {
            await conn.rollback();
            return res.status(404).json({ message: 'Bahan baku tidak ditemukan' });
        }
        const m = mats[0];
        const newStock = Number(m.current_stock) + qty;
        if (newStock < 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Stok tidak boleh bernilai negatif' });
        }

        await conn.query('UPDATE raw_materials SET current_stock = ? WHERE id = ?', [newStock, m.id]);
        await conn.query(`
            INSERT INTO stock_mutations (id, raw_material_id, type, quantity, balance_after, notes)
            VALUES (?, ?, 'ADJUSTMENT', ?, ?, ?)
        `, [crypto.randomUUID(), m.id, qty, newStock, notes || 'Penyesuaian stok manual']);

        await conn.commit();
        res.json({ ok: true, current_stock: newStock });
    } catch(e) {
        await conn.rollback();
        res.status(500).json({ message: e.message });
    } finally {
        conn.release();
    }
});

app.patch('/api/admin/materials/:id', authAdmin, async (req, res) => {
    try {
        const { name, unit, min_stock } = req.body;
        await pool.query('UPDATE raw_materials SET name = COALESCE(?, name), unit = COALESCE(?, unit), minimum_stock = COALESCE(?, minimum_stock) WHERE id = ?', [name, unit, min_stock, req.params.id]);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/admin/materials/:id', authAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM raw_materials WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/stock/mutations', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT sm.*, rm.name as material_name, rm.unit
            FROM stock_mutations sm
            JOIN raw_materials rm ON sm.raw_material_id = rm.id
            ORDER BY sm.created_at DESC LIMIT 100
        `);
        res.json(rows.map(r => ({
            ...r,
            mutation_type: r.type,
            change_amount: r.quantity
        })));
    } catch(e) { res.status(500).json({ message: e.message }); }
});

// Recipe aliases
app.get('/api/admin/products/:productId/recipe', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT r.*, rm.name as raw_material_name, rm.unit, rm.current_stock, r.quantity_needed as amount
            FROM product_recipes r
            JOIN raw_materials rm ON r.raw_material_id = rm.id
            WHERE r.product_id = ?
        `, [req.params.productId]);
        res.json(rows);
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/admin/products/:productId/recipe', authAdmin, async (req, res) => {
    try {
        const { materialId, amount } = req.body;
        const id = crypto.randomUUID();
        await pool.query(`
            INSERT INTO product_recipes (id, product_id, raw_material_id, quantity_needed)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE quantity_needed = VALUES(quantity_needed)
        `, [id, req.params.productId, materialId, Number(amount || 1)]);
        res.json({ ok: true, id });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/admin/products/:productId/recipe/:materialId', authAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM product_recipes WHERE product_id = ? AND raw_material_id = ?', [req.params.productId, req.params.materialId]);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/admin/inventory/materials', authAdmin, async (req, res) => {
    try {
        const { name, sku, unit, currentStock, minimumStock, costPerUnit } = req.body;
        if (!name || !sku) return res.status(400).json({ message: 'Nama dan SKU wajib diisi' });

        const id = 'mat-' + crypto.randomUUID().slice(0, 8);
        await pool.query(`
            INSERT INTO raw_materials (id, name, sku, unit, current_stock, minimum_stock, cost_per_unit)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [id, name, sku, unit || 'gram', Number(currentStock || 0), Number(minimumStock || 5), Number(costPerUnit || 0)]);

        await logAudit(req.user.id, req.user.name, req.user.role, 'CREATE_MATERIAL', 'INVENTORY', id, { name, sku }, req);
        res.status(201).json({ ok: true, id });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/admin/inventory/materials/:id/adjust', authAdmin, async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { quantity, type, notes } = req.body;
        const qty = Number(quantity);
        if (isNaN(qty) || qty === 0) return res.status(400).json({ message: 'Jumlah mutasi tidak valid' });

        await conn.beginTransaction();
        const [mats] = await conn.query('SELECT * FROM raw_materials WHERE id = ? FOR UPDATE', [req.params.id]);
        if (!mats.length) {
            await conn.rollback();
            return res.status(404).json({ message: 'Bahan baku tidak ditemukan' });
        }
        const m = mats[0];
        const newStock = Number(m.current_stock) + qty;
        if (newStock < 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Stok tidak boleh bernilai negatif' });
        }

        await conn.query('UPDATE raw_materials SET current_stock = ? WHERE id = ?', [newStock, m.id]);
        await conn.query(`
            INSERT INTO stock_mutations (id, raw_material_id, type, quantity, balance_after, notes)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [crypto.randomUUID(), m.id, type || 'ADJUSTMENT', Math.abs(qty), newStock, notes || 'Penyesuaian stok manual']);

        await conn.commit();
        await logAudit(req.user.id, req.user.name, req.user.role, 'STOCK_ADJUST', 'INVENTORY', m.id, { qty, newStock, notes }, req);
        res.json({ ok: true, currentStock: newStock });
    } catch(e) {
        await conn.rollback();
        res.status(500).json({ message: e.message });
    } finally {
        conn.release();
    }
});

app.get('/api/admin/inventory/mutations', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT sm.*, rm.name as material_name, rm.unit
            FROM stock_mutations sm
            JOIN raw_materials rm ON sm.raw_material_id = rm.id
            ORDER BY sm.created_at DESC LIMIT 100
        `);
        res.json(rows);
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/inventory/low-stock-alerts', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM raw_materials WHERE current_stock <= minimum_stock ORDER BY current_stock ASC');
        res.json(rows);
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/inventory/recipes/:productId', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT r.*, rm.name as material_name, rm.unit, rm.current_stock
            FROM product_recipes r
            JOIN raw_materials rm ON r.raw_material_id = rm.id
            WHERE r.product_id = ?
        `, [req.params.productId]);
        res.json(rows);
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/admin/inventory/recipes/:productId', authAdmin, async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const { ingredients } = req.body;
        await conn.beginTransaction();
        await conn.query('DELETE FROM product_recipes WHERE product_id = ?', [req.params.productId]);

        if (Array.isArray(ingredients)) {
            for (const ing of ingredients) {
                await conn.query(`
                    INSERT INTO product_recipes (id, product_id, raw_material_id, quantity_needed)
                    VALUES (?, ?, ?, ?)
                `, [crypto.randomUUID(), req.params.productId, ing.materialId, Number(ing.quantityNeeded || 1)]);
            }
        }
        await conn.commit();
        res.json({ ok: true });
    } catch(e) {
        await conn.rollback();
        res.status(500).json({ message: e.message });
    } finally {
        conn.release();
    }
});

// ==========================================
// CASHIER SHIFTS (BUKA / TUTUP SHIFT KASIR)
// ==========================================
app.get('/api/admin/shifts/current', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM cashier_shifts WHERE status = "OPEN" ORDER BY started_at DESC LIMIT 1');
        if (!rows.length) return res.json(null);
        const s = rows[0];
        const [orders] = await pool.query('SELECT payment_method, total FROM orders WHERE payment_status = "PAID" AND created_at >= ?', [s.started_at]);
        const totalCash = orders.filter(o => o.payment_method === 'CASH').reduce((sum, o) => sum + Number(o.total), 0);
        const totalQris = orders.filter(o => o.payment_method === 'QRIS_DEMO' || o.payment_method === 'QRIS').reduce((sum, o) => sum + Number(o.total), 0);
        const startingCash = Number(s.starting_cash || 0);
        res.json({
            ...s,
            start_time: s.started_at,
            total_cash: totalCash,
            total_qris: totalQris,
            total_orders: orders.length,
            expected_ending_cash: startingCash + totalCash
        });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/shifts/active', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM cashier_shifts WHERE status = "OPEN" ORDER BY started_at DESC LIMIT 1');
        if (!rows.length) return res.json(null);
        const s = rows[0];
        const [orders] = await pool.query('SELECT payment_method, total FROM orders WHERE payment_status = "PAID" AND created_at >= ?', [s.started_at]);
        const totalCash = orders.filter(o => o.payment_method === 'CASH').reduce((sum, o) => sum + Number(o.total), 0);
        const totalQris = orders.filter(o => o.payment_method === 'QRIS_DEMO' || o.payment_method === 'QRIS').reduce((sum, o) => sum + Number(o.total), 0);
        const startingCash = Number(s.starting_cash || 0);
        res.json({
            ...s,
            start_time: s.started_at,
            total_cash: totalCash,
            total_qris: totalQris,
            total_orders: orders.length,
            expected_ending_cash: startingCash + totalCash
        });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/shifts', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM cashier_shifts ORDER BY started_at DESC LIMIT 50');
        res.json(rows.map(s => ({
            ...s,
            start_time: s.started_at,
            end_time: s.ended_at,
            total_cash: Number(s.total_sales_cash || 0),
            total_qris: Number(s.total_sales_qris || 0),
            actual_ending_cash: Number(s.ending_cash_actual || 0)
        })));
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/admin/shifts/open', authAdmin, async (req, res) => {
    try {
        const [active] = await pool.query('SELECT id FROM cashier_shifts WHERE status = "OPEN"');
        if (active.length) return res.status(400).json({ message: 'Anda sudah memiliki shift yang sedang aktif.' });

        const startCash = Number(req.body.startingCash || 0);
        const shiftId = crypto.randomUUID();
        await pool.query(`
            INSERT INTO cashier_shifts (id, cashier_id, cashier_name, starting_cash, ending_cash_system, status)
            VALUES (?, ?, ?, ?, ?, 'OPEN')
        `, [shiftId, req.user.id, req.user.name, startCash, startCash]);

        await logAudit(req.user.id, req.user.name, req.user.role, 'SHIFT_OPEN', 'SHIFT', shiftId, { startingCash: startCash }, req);
        res.status(201).json({ ok: true, shiftId });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/admin/shifts/close', authAdmin, async (req, res) => {
    try {
        const [active] = await pool.query('SELECT * FROM cashier_shifts WHERE status = "OPEN" ORDER BY started_at DESC LIMIT 1');
        if (!active.length) return res.status(400).json({ message: 'Tidak ada shift aktif yang perlu ditutup.' });

        const s = active[0];
        const actualCash = Number(req.body.actualCash ?? req.body.endingCashActual ?? 0);
        const systemCash = Number(s.ending_cash_system);
        const diff = actualCash - systemCash;

        await pool.query(`
            UPDATE cashier_shifts
            SET status = 'CLOSED',
                ended_at = NOW(),
                ending_cash_actual = ?,
                cash_difference = ?,
                notes = ?
            WHERE id = ?
        `, [actualCash, diff, req.body.notes || '', s.id]);

        await logAudit(req.user.id, req.user.name, req.user.role, 'SHIFT_CLOSE', 'SHIFT', s.id, { actualCash, systemCash, diff }, req);
        res.json({ ok: true, summary: { actualCash, systemCash, diff, startingCash: s.starting_cash, totalOrders: s.total_orders_count } });
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/shifts/history', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM cashier_shifts ORDER BY started_at DESC LIMIT 30');
        res.json(rows);
    } catch(e) { res.status(500).json({ message: e.message }); }
});

// ==========================================
// AUDIT LOGS & BLACKLIST
// ==========================================
app.get('/api/admin/audit', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100');
        res.json(rows.map(r => ({
            id: r.id,
            action: r.action,
            targetType: r.target_type,
            targetId: r.target_id,
            actorId: r.user_id,
            actorEmail: r.user_name || r.user_id || 'Kasir / Staff',
            actorName: r.user_name,
            actorRole: r.role || 'Staff',
            details: typeof r.details === 'string' ? JSON.parse(r.details || '{}') : (r.details || {}),
            meta: typeof r.details === 'string' ? JSON.parse(r.details || '{}') : (r.details || {}),
            ipAddress: r.ip_address,
            at: r.created_at,
            createdAt: r.created_at
        })));
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/fraud/blacklist', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM blacklist ORDER BY added_at DESC');
        res.json(rows.map(r => ({
            id: r.id,
            studentId: r.student_id_num,
            studentIdNum: r.student_id_num,
            email: r.email,
            studentName: r.student_name,
            reason: r.reason,
            addedAt: r.added_at
        })));
    } catch(e) { res.status(500).json({ message: e.message }); }
});

app.post('/api/admin/fraud/blacklist', authAdmin, async (req, res) => {
    try {
        const id = crypto.randomUUID();
        await pool.query(
            'INSERT INTO blacklist (id, student_id_num, email, student_name, reason) VALUES (?, ?, ?, ?, ?)',
            [id, req.body.studentId, req.body.email, req.body.studentName, req.body.reason]
        );
        await logAudit(req.user.id, req.user.name, req.user.role, 'ADD_BLACKLIST', 'BLACKLIST', id, req.body, req);
        res.status(201).json({ id, studentId: req.body.studentId, ok: true });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/admin/fraud/blacklist/:id', authAdmin, async (req, res) => {
    try {
        const [r] = await pool.query('DELETE FROM blacklist WHERE id = ?', [req.params.id]);
        if (!r.affectedRows) return res.status(404).json({ message: 'Data blacklist tidak ditemukan' });
        await logAudit(req.user.id, req.user.name, req.user.role, 'REMOVE_BLACKLIST', 'BLACKLIST', req.params.id, {}, req);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// ==========================================
// ADMIN DASHBOARD & ORDERS
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
            o.orderNumber = o.order_number; o.queueNumber = o.queue_number; o.tableName = o.table_name; o.customerType = o.customer_type;
            o.total = Number(o.total); o.payment = { status: o.payment_status, method: o.payment_method }; o.createdAt = o.created_at;
            if (o.customer_type === 'STUDENT') {
                o.studentInfo = {
                    verificationStatus: o.verification_status, studentId: o.student_id_num,
                    campus: o.student_campus, studentName: o.student_name, facultyName: o.student_faculty_name
                };
            }
        }
        const [blRows] = await pool.query('SELECT COUNT(*) as count FROM blacklist');

        res.json({
            totalOrders: studentCount + regularCount,
            revenue, studentRevenue, regularRevenue, totalSavings,
            studentCount, regularCount, blacklistCount: blRows[0].count,
            counts, recent
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
        if(req.query.q) { 
            query += ' AND (order_number LIKE ? OR student_name LIKE ? OR student_id_num LIKE ? OR table_name LIKE ?)'; 
            const qPattern = `%${req.query.q}%`;
            params.push(qPattern, qPattern, qPattern, qPattern); 
        }
        query += ' ORDER BY created_at DESC LIMIT 50';

        const [orders] = await pool.query(query, params);
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1;
        const currentDay = today.getDate();

        for(let o of orders) {
            const [items] = await pool.query(`
                SELECT oi.*, c.kitchen_type, c.slug as category_slug
                FROM order_items oi
                LEFT JOIN products p ON oi.product_id = p.id
                LEFT JOIN categories c ON p.category_id = c.id
                WHERE oi.order_id = ?
            `, [o.id]);
            o.items = items.map(i => ({
                productName: i.product_name, quantity: i.quantity, lineTotal: Number(i.line_total),
                price: Number(i.price), regularPrice: Number(i.regular_price || i.price),
                kitchenType: i.kitchen_type || 'DRINK',
                categorySlug: i.category_slug || '',
                note: i.note || '',
                options: typeof i.options_json === 'string' ? JSON.parse(i.options_json || '{}') : (i.options_json || {})
            }));
            o.orderNumber = o.order_number; o.queueNumber = o.queue_number; o.tableName = o.table_name; o.customerType = o.customer_type;
            o.total = Number(o.total); o.subtotal = Number(o.subtotal); o.totalSavings = Number(o.total_savings || 0);
            o.payment = { status: o.payment_status, method: o.payment_method }; o.createdAt = o.created_at; o.history = [];
            o.parentOrderNumber = o.parent_order_number || null;
            o.receiptPrinted = Boolean(o.receipt_printed); o.receiptPrintedAt = o.receipt_printed_at;
            if(o.customer_type === 'STUDENT') {
                const isBirthdayToday = checkIsBirthdayToday(o.student_birth_date);
                o.studentInfo = {
                    campus: o.student_campus, studentId: o.student_id_num, studentName: o.student_name,
                    studentPhoto: o.student_photo_url, verificationStatus: o.verification_status,
                    facultyName: o.student_faculty_name, facultyCode: o.student_faculty_code,
                    facultyColor: FACULTY_THEME_COLORS[(o.student_faculty_code || '').toUpperCase()] || '#0284c7',
                    facultyId: o.student_faculty_id, studyProgram: o.student_study_program,
                    birthDate: o.student_birth_date, fraudScore: o.fraud_score, fraudRisk: o.fraud_risk,
                    rejectionReason: o.rejection_reason,
                    isBirthdayToday,
                    isBirthdayRewardClaimed: Boolean(o.is_birthday_reward),
                    birthdayRewardName: o.birthday_reward_name || null
                };
            }
        }
        res.json(orders);
    } catch (err) { res.status(500).json({ message: "Server Error" }); }
});

app.get('/api/admin/reports', authAdmin, async (req, res) => {
    try {
        const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
        const [stats] = await pool.query(`
            SELECT customer_type, SUM(total) as revenue, SUM(total_savings) as savings, COUNT(*) as qty
            FROM orders
            WHERE payment_status = "PAID" AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
            GROUP BY customer_type
        `, [days]);

        let revenue = 0, studentRevenue = 0, regularRevenue = 0, studentSavings = 0, studentOrders = 0, regularOrders = 0;
        stats.forEach(r => {
            revenue += Number(r.revenue);
            if (r.customer_type === 'STUDENT') {
                studentRevenue += Number(r.revenue); studentSavings += Number(r.savings); studentOrders += r.qty;
            } else {
                regularRevenue += Number(r.revenue); regularOrders += r.qty;
            }
        });

        const [byDayRows] = await pool.query(`
            SELECT DATE(created_at) as date, SUM(total) as total
            FROM orders
            WHERE payment_status = "PAID" AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
            GROUP BY DATE(created_at) ORDER BY date ASC
        `, [days]);

        const [bestRows] = await pool.query(`
            SELECT product_name as name, SUM(quantity) as qty
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE o.payment_status = "PAID" AND o.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
            GROUP BY product_name ORDER BY qty DESC LIMIT 8
        `, [days]);

        const [hourRows] = await pool.query(`
            SELECT HOUR(created_at) as hr, COUNT(*) as count, SUM(total) as total
            FROM orders
            WHERE payment_status = "PAID" AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
            GROUP BY HOUR(created_at) ORDER BY hr ASC
        `, [days]);

        const [facRows] = await pool.query(`
            SELECT COALESCE(student_faculty_name, 'Lainnya / Umum') as faculty, COUNT(*) as orders_count, SUM(total) as revenue
            FROM orders
            WHERE payment_status = "PAID" AND customer_type = 'STUDENT' AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
            GROUP BY student_faculty_name ORDER BY revenue DESC
        `, [days]);

        const [catRows] = await pool.query(`
            SELECT COALESCE(c.name, 'Lainnya') as category, COALESCE(c.is_tobacco, 0) as isTobacco, COUNT(DISTINCT o.id) as count, SUM(oi.line_total) as revenue, SUM(oi.quantity) as qty
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            LEFT JOIN products p ON oi.product_id = p.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE o.payment_status = "PAID" AND o.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
            GROUP BY c.id, c.name, c.is_tobacco ORDER BY revenue DESC
        `, [days]);

        res.json({
            days, revenue, studentRevenue, regularRevenue, studentSavings,
            studentOrders, regularOrders, orders: studentOrders + regularOrders,
            averageOrder: (studentOrders + regularOrders) > 0 ? Math.round(revenue / (studentOrders + regularOrders)) : 0,
            byDay: byDayRows.map(r => ({ date: r.date, total: Number(r.total) })),
            best: bestRows.map(r => ({ name: r.name, qty: Number(r.qty) })),
            peakHours: hourRows.map(r => ({ hour: r.hr, ordersCount: r.count, revenue: Number(r.total) })),
            facultySales: facRows.map(r => ({ faculty: r.faculty, count: r.orders_count, revenue: Number(r.revenue) })),
            categorySales: catRows.map(r => ({ category: r.category, isTobacco: Boolean(r.isTobacco), count: r.count, revenue: Number(r.revenue), qty: Number(r.qty) }))
        });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/reports/export-csv', authAdmin, async (req, res) => {
    try {
        const [orders] = await pool.query('SELECT * FROM orders WHERE payment_status = "PAID" ORDER BY created_at DESC');
        let csv = 'No. Pesanan,Nomor Antrean,Meja,Tipe,Nama Mahasiswa,NIM,Fakultas,Subtotal,Diskon Mahasiswa,Total,Metode Pembayaran,Waktu\n';
        orders.forEach(o => {
            csv += `"${o.order_number}","${o.queue_number || ''}","${o.table_name}","${o.customer_type}","${o.student_name || '-'}","${o.student_id_num || '-'}","${o.student_faculty_name || '-'}","${o.subtotal}","${o.total_savings}","${o.total}","${o.payment_method}","${new Date(o.created_at).toLocaleString('id-ID')}"\n`;
        });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="laporan-penjualan-cafecampus.csv"');
        res.send(csv);
    } catch(e) { res.status(500).send('Gagal mengekspor CSV'); }
});

// ==========================================
// MASTER TABLES, CATEGORIES, PRODUCTS & SETTINGS
// ==========================================
app.get('/api/admin/tables', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM cafe_tables ORDER BY table_number ASC');
        res.json(rows.map(r => ({ id: r.id, tableNumber: r.table_number, name: r.name, publicToken: r.public_token, active: Boolean(r.is_active) })));
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.post('/api/admin/tables', authAdmin, async (req, res) => {
    try {
        const { tableNumber, name } = req.body;
        const [exists] = await pool.query('SELECT id FROM cafe_tables WHERE table_number = ?', [tableNumber]);
        if (exists.length) return res.status(409).json({ message: 'Nomor meja sudah ada' });

        const id = crypto.randomUUID();
        const token = `table-${crypto.randomBytes(4).toString('hex')}`;
        await pool.query('INSERT INTO cafe_tables (id, table_number, name, public_token) VALUES (?, ?, ?, ?)', [id, tableNumber, name, token]);
        res.status(201).json({ ok: true, id, publicToken: token });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.patch('/api/admin/tables/:id', authAdmin, async (req, res) => {
    try {
        if (req.body.rotateToken) {
            const token = `demo-table-13-v2-${crypto.randomBytes(4).toString('hex')}`;
            await pool.query('UPDATE cafe_tables SET public_token=?, token_version=token_version+1 WHERE id=?', [token, req.params.id]);
            return res.json({ ok: true, publicToken: token });
        } else {
            const [rows] = await pool.query('SELECT * FROM cafe_tables WHERE id = ?', [req.params.id]);
            if (!rows.length) return res.status(404).json({ message: 'Meja tidak ditemukan' });
            const old = rows[0]; const b = req.body || {};
            await pool.query('UPDATE cafe_tables SET table_number=?, name=?, is_active=? WHERE id=?', [b.tableNumber ?? old.table_number, b.name ?? old.name, b.active !== undefined ? (b.active ? 1 : 0) : old.is_active, req.params.id]);
            return res.json({ ok: true, active: b.active !== undefined ? Boolean(b.active) : Boolean(old.is_active) });
        }
    } catch (e) { res.status(500).json({ message: e.message }); }
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
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/categories', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categories ORDER BY sort_order ASC');
        res.json(rows.map(c => ({ id: c.id, name: c.name, slug: c.slug, active: Boolean(c.is_active), kitchenType: c.kitchen_type || 'DRINK', isTobacco: Boolean(c.is_tobacco) })));
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.post('/api/admin/categories', authAdmin, async (req, res) => {
    try {
        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({message:'Nama kategori wajib diisi'});

        const [exists] = await pool.query('SELECT id FROM categories WHERE name = ?', [name]);
        if (exists.length) return res.status(409).json({ message: 'Kategori dengan nama ini sudah ada' });

        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g,'');
        const id = crypto.randomUUID();
        const kitchenType = req.body.kitchenType || (slug.match(/makanan|snack|food|dessert/) ? 'FOOD' : 'DRINK');
        const isTobacco = req.body.isTobacco || (slug === 'rokok' ? 1 : 0);

        await pool.query('INSERT INTO categories (id, name, slug, kitchen_type, is_tobacco) VALUES (?, ?, ?, ?, ?)', [id, name, slug, kitchenType, isTobacco]);
        res.status(201).json({ ok: true, id });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.patch('/api/admin/categories/:id', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categories WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ message: 'Kategori tidak ditemukan' });
        const old = rows[0]; const b = req.body || {};
        const validKitchenTypes = ['DRINK', 'FOOD'];
        const kitchenType = validKitchenTypes.includes(b.kitchenType) ? b.kitchenType : (old.kitchen_type || 'DRINK');
        const isActive = b.active !== undefined ? (b.active ? 1 : 0) : old.is_active;

        await pool.query('UPDATE categories SET name=?, is_active=?, kitchen_type=? WHERE id=?', [b.name ?? old.name, isActive, kitchenType, req.params.id]);
        res.json({ ok: true, active: Boolean(isActive) });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.delete('/api/admin/categories/:id', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id FROM categories WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ message: 'Kategori tidak ditemukan' });
        const [used] = await pool.query('SELECT COUNT(*) AS n FROM products WHERE category_id = ?', [req.params.id]);
        if (used[0].n > 0) return res.status(409).json({ message: `Kategori masih dipakai ${used[0].n} menu.` });
        await pool.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
        res.json({ ok: true, mode: 'deleted' });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/products', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM products ORDER BY sort_order ASC');
        res.json(rows.map(p => ({
            id: p.id, categoryId: p.category_id, name: p.name, description: p.description,
            price: Number(p.price), studentPrice: Number(p.student_price), imageUrl: p.image_url,
            isAvailable: Boolean(p.is_available), active: Boolean(p.is_active), isTobacco: Boolean(p.is_tobacco)
        })));
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.post('/api/admin/products', authAdmin, async (req, res) => {
    try {
        const { name, categoryId, price, studentPrice, isAvailable, description, isTobacco } = req.body;
        if (!name || String(name).trim().length === 0) return res.status(400).json({ message: 'Nama produk wajib diisi.' });
        if (!categoryId) return res.status(400).json({ message: 'Kategori wajib dipilih.' });

        const [cat] = await pool.query('SELECT is_active FROM categories WHERE id = ?', [categoryId]);
        if (!cat.length || !cat[0].is_active) return res.status(400).json({ message: 'Kategori tidak aktif atau tidak ditemukan.' });

        const parsedPrice = Number(price);
        const parsedStudentPrice = isTobacco ? parsedPrice : (Number(studentPrice) || parsedPrice);
        const id = crypto.randomUUID();

        await pool.query(
            'INSERT INTO products (id, category_id, name, description, price, student_price, is_available, sort_order, is_tobacco) VALUES (?, ?, ?, ?, ?, ?, ?, 99, ?)',
            [id, categoryId, String(name).trim(), description || '', parsedPrice, parsedStudentPrice, isAvailable !== false ? 1 : 0, isTobacco ? 1 : 0]
        );
        res.status(201).json({ ok: true, id, studentPrice: parsedStudentPrice });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.patch('/api/admin/products/:id', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM products WHERE id=?', [req.params.id]);
        if (!rows.length) return res.status(404).json({message:'Produk tidak ditemukan'});
        const old = rows[0]; const b = req.body || {};

        if (b.categoryId) {
            const [cat] = await pool.query('SELECT is_active FROM categories WHERE id = ?', [b.categoryId]);
            if (!cat.length || !cat[0].is_active) {
                return res.status(400).json({ message: 'Produk tidak dapat dipindahkan ke kategori yang diarsipkan.' });
            }
        }

        const newPrice = b.price !== undefined ? Number(b.price) : Number(old.price);
        const newStudPrice = b.studentPrice !== undefined ? Number(b.studentPrice) : Number(old.student_price);
        const isAvail = b.isAvailable !== undefined ? (b.isAvailable ? 1 : 0) : old.is_available;

        if (b.active !== undefined) await pool.query('UPDATE products SET is_active = ? WHERE id = ?', [b.active ? 1 : 0, req.params.id]);

        await pool.query(
            'UPDATE products SET name=?, category_id=?, price=?, student_price=?, is_available=?, description=? WHERE id=?',
            [b.name ?? old.name, b.categoryId ?? old.category_id, newPrice, newStudPrice, isAvail, b.description ?? old.description, req.params.id]
        );
        res.json({ ok: true, price: newPrice, studentPrice: newStudPrice, isAvailable: Boolean(isAvail) });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

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
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.get('/api/admin/settings', authAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM settings WHERE id = 1');
        const s = rows[0] || {};
        res.json({
            cafeName: s.cafe_name, cafeAddress: s.cafe_address, cafePhone: s.cafe_phone,
            operatingHours: s.operating_hours, serviceFee: Number(s.service_fee||0),
            taxPercent: Number(s.tax_percent||0), qrisEnabled: Boolean(s.qris_enabled),
            cashEnabled: Boolean(s.cash_enabled), soundEnabled: Boolean(s.sound_enabled),
            dailyReportEnabled: Boolean(s.daily_report_enabled),
            appMode: APP_MODE,
            isDemo: IS_DEMO
        });
    } catch(e) { res.status(500).json({message: e.message}); }
});

app.patch('/api/admin/settings', authAdmin, async (req, res) => {
    try {
        const b = req.body;
        const [rows] = await pool.query('SELECT * FROM settings WHERE id = 1');
        const old = rows[0] || {};

        await pool.query(`
            UPDATE settings
            SET cafe_name=?, cafe_address=?, cafe_phone=?, operating_hours=?, service_fee=?,
                tax_percent=?, qris_enabled=?, cash_enabled=?, sound_enabled=?, daily_report_enabled=?
            WHERE id=1
        `, [
            b.cafeName ?? old.cafe_name,
            b.cafeAddress ?? old.cafe_address,
            b.cafePhone ?? old.cafe_phone,
            b.operatingHours ?? old.operating_hours,
            b.serviceFee !== undefined ? Number(b.serviceFee) : old.service_fee,
            b.taxPercent !== undefined ? Number(b.taxPercent) : old.tax_percent,
            b.qrisEnabled !== undefined ? (b.qrisEnabled ? 1 : 0) : old.qris_enabled,
            b.cashEnabled !== undefined ? (b.cashEnabled ? 1 : 0) : old.cash_enabled,
            b.soundEnabled !== undefined ? (b.soundEnabled ? 1 : 0) : old.sound_enabled,
            b.dailyReportEnabled !== undefined ? (b.dailyReportEnabled ? 1 : 0) : old.daily_report_enabled
        ]);

        res.json({
            ok: true,
            cafeName: b.cafeName ?? old.cafe_name,
            qrisEnabled: b.qrisEnabled !== undefined ? Boolean(b.qrisEnabled) : Boolean(old.qris_enabled),
            serviceFee: b.serviceFee !== undefined ? Number(b.serviceFee) : Number(old.service_fee),
            taxPercent: b.taxPercent !== undefined ? Number(b.taxPercent) : Number(old.tax_percent)
        });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// Demo Reset Endpoint: Menyiapkan Data Realistis untuk Demo 5 Menit
app.post('/api/admin/demo/reset', authAdmin, async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('DELETE FROM order_items');
        await conn.query('DELETE FROM orders');
        await conn.query('DELETE FROM birthday_rewards');
        await conn.query('DELETE FROM products WHERE name = "QA Product"');
        await conn.query('DELETE FROM categories WHERE name LIKE "Seasonal%" OR slug LIKE "seasonal%"');
        await conn.query('DELETE FROM cafe_tables WHERE table_number = "13"');
        await conn.query('UPDATE products SET is_available = 1');
        await conn.query('UPDATE products SET is_available = 0 WHERE id = "prod-5"');
        await conn.query("UPDATE settings SET cafe_name='Cafe Campus', cafe_address='', cafe_phone='', operating_hours='', service_fee=5.00, tax_percent=11.00, qris_enabled=1, cash_enabled=1 WHERE id=1");

        // Pulihkan stok bahan baku ke level aman
        await conn.query("UPDATE raw_materials SET current_stock = 2500.00 WHERE id = 'mat-coffee-bean'");
        await conn.query("UPDATE raw_materials SET current_stock = 10000.00 WHERE id = 'mat-fresh-milk'");
        await conn.query("UPDATE raw_materials SET current_stock = 3000.00 WHERE id = 'mat-aren-sugar'");
        await conn.query("UPDATE raw_materials SET current_stock = 1500.00 WHERE id = 'mat-matcha-powder'");
        await conn.query("UPDATE raw_materials SET current_stock = 40.00 WHERE id = 'mat-croissant-dough'");
        await conn.query("UPDATE raw_materials SET current_stock = 15000.00 WHERE id = 'mat-rice'");
        await conn.query("UPDATE raw_materials SET current_stock = 5000.00 WHERE id = 'mat-chicken-cut'");
        await conn.query("UPDATE raw_materials SET current_stock = 4000.00 WHERE id = 'mat-french-fries'");
        await conn.query("UPDATE raw_materials SET current_stock = 30.00 WHERE id = 'mat-cig-marlboro'");
        await conn.query("UPDATE raw_materials SET current_stock = 25.00 WHERE id = 'mat-cig-esse'");

        const jkt = getJakartaDate();
        const bdayTodayStr = `${jkt.year - 21}-${String(jkt.month).padStart(2, '0')}-${String(jkt.day).padStart(2, '0')}`;

        // 5 Pesanan Demo Realistis (Mencakup: Ulang Tahun Hari Ini, 2 Dapur, KTM Ditolak, Tahap Berbeda, Fakultas Berbeda)
        const demoOrders = [
            {
                num: 'CC-DEMO-01', q: 'Q-001', tbl: 'Meja 01', type: 'STUDENT',
                sName: 'Budi Santoso', campus: 'Universitas Indonesia', nim: '2106781290', email: 'budi.santoso@ui.ac.id',
                facId: 'fac-ft', facCode: 'FT', facName: 'Fakultas Teknik', prodi: 'Teknik Mesin',
                bDate: bdayTodayStr, vStatus: 'VERIFIED', rejReason: null,
                sub: 42000, sav: 14000, tot: 48930, method: 'QRIS_DEMO', pStatus: 'PAID', st: 'COMPLETED',
                items: [
                    { prodId: 'prod-1', name: 'Iced Latte Gula Aren', qty: 1, base: 21000, regBase: 28000, price: 21000, regPrice: 28000, line: 21000 },
                    { prodId: 'prod-2', name: 'Butter Croissant', qty: 1, base: 21000, regBase: 28000, price: 21000, regPrice: 28000, line: 21000 }
                ]
            },
            {
                num: 'CC-DEMO-02', q: 'Q-002', tbl: 'Meja 02', type: 'STUDENT',
                sName: 'Siti Rahma', campus: 'Institut Teknologi Bandung', nim: '13521001', email: 'siti.demo@itb.ac.id',
                facId: 'fac-cs', facCode: 'FASILKOM', facName: 'Fakultas Ilmu Komputer', prodi: 'Informatika',
                bDate: '2003-08-15', vStatus: 'VERIFIED', rejReason: null,
                sub: 43000, sav: 13000, tot: 50117, method: 'CASH', pStatus: 'PAID', st: 'READY',
                items: [
                    { prodId: 'prod-3', name: 'Matcha Latte Uji', qty: 1, base: 22000, regBase: 28000, price: 22000, regPrice: 28000, line: 22000 },
                    { prodId: 'prod-2', name: 'Butter Croissant', qty: 1, base: 21000, regBase: 28000, price: 21000, regPrice: 28000, line: 21000 }
                ]
            },
            {
                num: 'CC-DEMO-03', q: 'Q-003', tbl: 'Meja 03', type: 'STUDENT',
                sName: 'Dimas Satria', campus: 'Universitas Gadjah Mada', nim: '20/456789/EK/12345', email: 'dimas.satria@mail.ugm.ac.id',
                facId: 'fac-feb', facCode: 'FEB', facName: 'Fakultas Ekonomi dan Bisnis', prodi: 'Manajemen',
                bDate: '2002-11-20', vStatus: 'VERIFIED', rejReason: null,
                sub: 56000, sav: 7000, tot: 65240, method: 'QRIS_DEMO', pStatus: 'PAID', st: 'PROCESSING',
                items: [
                    { prodId: 'prod-8', name: 'Ayam Geprek Sambal Korek Kampus', qty: 2, base: 28000, regBase: 28000, price: 28000, regPrice: 28000, line: 56000 }
                ]
            },
            {
                num: 'CC-DEMO-04', q: 'Q-004', tbl: 'Meja 04', type: 'REGULAR',
                sName: 'Kevin Wijaya', campus: 'Universitas Indonesia', nim: '2206123456', email: 'kevin.wijaya@ui.ac.id',
                facId: 'fac-fh', facCode: 'FH', facName: 'Fakultas Hukum', prodi: 'Ilmu Hukum',
                bDate: '2004-05-10', vStatus: 'REJECTED', rejReason: 'Foto kartu pelajar buram / identitas tidak terbaca',
                sub: 28000, sav: 0, tot: 32620, method: 'CASH', pStatus: 'PAID', st: 'NEW',
                items: [
                    { prodId: 'prod-1', name: 'Iced Latte Gula Aren', qty: 1, base: 28000, regBase: 28000, price: 28000, regPrice: 28000, line: 28000 }
                ]
            },
            {
                num: 'CC-DEMO-05', q: 'Q-005', tbl: 'Meja 05', type: 'STUDENT',
                sName: 'Zahra Putri', campus: 'Universitas Indonesia', nim: '2306987654', email: 'zahra.putri@ui.ac.id',
                facId: 'fac-fk', facCode: 'FK', facName: 'Fakultas Kedokteran', prodi: 'Pendidikan Dokter',
                bDate: '2005-02-14', vStatus: 'PENDING', rejReason: null,
                sub: 21000, sav: 7000, tot: 24465, method: 'CASH', pStatus: 'PAID', st: 'NEW',
                items: [
                    { prodId: 'prod-1', name: 'Iced Latte Gula Aren', qty: 1, base: 21000, regBase: 28000, price: 21000, regPrice: 28000, line: 21000 }
                ]
            }
        ];

        for (const o of demoOrders) {
            const oId = crypto.randomUUID();
            await conn.query(`
                INSERT INTO orders (
                    id, order_number, queue_number, table_name, customer_type,
                    student_name, student_campus, student_id_num, student_email,
                    student_faculty_id, student_faculty_code, student_faculty_name, student_study_program,
                    student_birth_date, verification_status, rejection_reason,
                    subtotal, total_savings, total, payment_method, payment_status, status,
                    paid_at, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${o.pStatus === 'PAID' ? 'NOW()' : 'NULL'}, NOW())
            `, [
                oId, o.num, o.q, o.tbl, o.type,
                o.sName, o.campus, o.nim, o.email,
                o.facId, o.facCode, o.facName, o.prodi,
                o.bDate, o.vStatus, o.rejReason,
                o.sub, o.sav, o.tot, o.method, o.pStatus, o.st
            ]);

            for (const it of o.items) {
                await conn.query(`
                    INSERT INTO order_items (id, order_id, product_id, product_name, quantity, base_price, regular_base_price, price, regular_price, line_total)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [crypto.randomUUID(), oId, it.prodId, it.name, it.qty, it.base, it.regBase, it.price, it.regPrice, it.line]);
            }
        }

        await conn.commit();
        res.json({ ok: true });
    } catch(e) {
        await conn.rollback();
        res.status(500).json({ message: e.message });
    } finally {
        conn.release();
    }
});

export function getLanIp() {
    if (process.env.APP_URL) {
        try { return new URL(process.env.APP_URL).hostname; } catch { return process.env.APP_URL.replace(/^https?:\/\//, '').split(':')[0]; }
    }
    const nets = os.networkInterfaces();
    const priority = ['wi-fi', 'wifi', 'ethernet', 'wlan', 'en0', 'eth0'];
    for (const p of priority) {
        const found = Object.keys(nets).find(k => k.toLowerCase().includes(p));
        if (found) {
            for (const net of nets[found]) {
                if (net.family === 'IPv4' && !net.internal) return net.address;
            }
        }
    }
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) return net.address;
        }
    }
    return '127.0.0.1';
}

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
            type: 'svg', margin: 2, width: 300,
            color: { dark: '#3c2415', light: '#faf6f0' },
            errorCorrectionLevel: 'M',
        });
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.send(svg);
    } catch (err) {
        res.status(500).send('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><text y="150" x="50" fill="red">QR Error</text></svg>');
    }
});

app.use((req, res) => {
    if (['GET', 'HEAD'].includes(req.method) && !req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.status(404).json({ message: 'Endpoint tidak ditemukan' });
    }
});

const expireStaleQrisOrders = async () => {
    try {
        await pool.query(
            `UPDATE orders SET status = 'CANCELLED', payment_status = 'FAILED'
             WHERE payment_status = 'PENDING' AND payment_method IN ('QRIS', 'QRIS_DEMO')
             AND created_at < (NOW() - INTERVAL ? MINUTE)`,
            [QRIS_EXPIRY_MINUTES]
        );
    } catch (err) {
        console.warn('[qris-expiry] Gagal memeriksa tagihan kedaluwarsa:', err.code || err.message);
    }
};

const ensureSchema = async () => {
    try {
        const conn = await pool.getConnection();
        try {
            await conn.query('SET FOREIGN_KEY_CHECKS = 0');

            // Cek apakah database benar-benar kosong (0 tabel) untuk inisialisasi awal otomatis
            const [existingTables] = await conn.query(`
                SELECT TABLE_NAME FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
            `);
            if (!existingTables.length) {
                console.log('📦 [ensureSchema] Database kosong terdeteksi. Mengimpor skema awal dari database.sql...');
                const sqlPath = path.join(__dirname, 'database.sql');
                let initialSql = fs.readFileSync(sqlPath, 'utf8');
                initialSql = initialSql
                    .replace(/^\s*CREATE DATABASE\b[^;]*;[^\S\r\n]*\r?$/gim, '')
                    .replace(/^\s*USE\b[^;]*;[^\S\r\n]*\r?$/gim, '');
                await conn.query(initialSql);
                console.log('✅ [ensureSchema] Seluruh tabel & seed data berhasil diinisialisasi otomatis!');
            }

            // 1. Faculties table & default seed
            await conn.query(`
                CREATE TABLE IF NOT EXISTS faculties (
                    id VARCHAR(50) NOT NULL PRIMARY KEY,
                    code VARCHAR(20) NOT NULL UNIQUE,
                    name VARCHAR(150) NOT NULL,
                    color VARCHAR(20) NOT NULL DEFAULT '#1e3a8a',
                    secondary_color VARCHAR(20) NOT NULL DEFAULT '#f1f5f9',
                    icon VARCHAR(50) DEFAULT 'academic-cap',
                    is_active TINYINT(1) DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            const defaultFaculties = [
                ['fac-ft', 'FT', 'Fakultas Teknik', '#1e3a8a', '#dbeafe', 'tool', 1],
                ['fac-fk', 'FK', 'Fakultas Kedokteran', '#065f46', '#d1fae5', 'heart', 1],
                ['fac-feb', 'FEB', 'Fakultas Ekonomi dan Bisnis', '#b45309', '#fef3c7', 'trending-up', 1],
                ['fac-fh', 'FH', 'Fakultas Hukum', '#991b1b', '#fee2e2', 'scale', 1],
                ['fac-cs', 'FASILKOM', 'Fakultas Ilmu Komputer', '#6b21a8', '#f3e8ff', 'cpu', 1],
                ['fac-mipa', 'FMIPA', 'Fakultas Matematika & IPA', '#0e7490', '#cffafe', 'atom', 1],
                ['fac-fisip', 'FISIP', 'Fakultas Ilmu Sosial & Politik', '#c2410c', '#ffedd5', 'users', 1],
                ['fac-fib', 'FIB', 'Fakultas Ilmu Pengetahuan Budaya', '#0f766e', '#ccfbf1', 'book-open', 1],
                ['fac-fpsi', 'FPSI', 'Fakultas Psikologi', '#be185d', '#fce7f3', 'smile', 1]
            ];
            for (const [id, code, name, color, secColor, ic, act] of defaultFaculties) {
                await conn.query(`
                    INSERT INTO faculties (id, code, name, color, secondary_color, icon, is_active)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE name=VALUES(name), color=VALUES(color), secondary_color=VALUES(secondary_color)
                `, [id, code, name, color, secColor, ic, act]);
            }

            // 2. Categories columns & tobacco category
            const [catCols] = await conn.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'kitchen_type'");
            if (!catCols.length) {
                await conn.query("ALTER TABLE categories ADD COLUMN kitchen_type ENUM('DRINK','FOOD') NOT NULL DEFAULT 'DRINK'");
            }
            const [catTob] = await conn.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'is_tobacco'");
            if (!catTob.length) {
                await conn.query("ALTER TABLE categories ADD COLUMN is_tobacco TINYINT(1) DEFAULT 0");
            }
            await conn.query(`
                INSERT INTO categories (id, name, slug, sort_order, is_active, kitchen_type, is_tobacco)
                VALUES ('cat-rokok', 'Rokok & Tembakau (21+)', 'rokok', 6, 1, 'DRINK', 1)
                ON DUPLICATE KEY UPDATE name=VALUES(name), is_tobacco=1
            `);
            await conn.query("UPDATE categories SET kitchen_type = 'FOOD' WHERE slug IN ('makanan', 'snack', 'dessert')");
            await conn.query("UPDATE categories SET kitchen_type = 'DRINK' WHERE slug IN ('kopi', 'non-kopi')");

            // 3. Products column & tobacco items
            const [prodTob] = await conn.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'is_tobacco'");
            if (!prodTob.length) {
                await conn.query("ALTER TABLE products ADD COLUMN is_tobacco TINYINT(1) DEFAULT 0");
            }
            await conn.query("UPDATE products SET student_price = 22000.00 WHERE id = 'prod-1'");
            const tobaccoProducts = [
                ['prod-cig-1', 'cat-rokok', 'Marlboro Filter Black', 'Rokok filter premium (Khusus usia 21+ tahun, tanpa diskon mahasiswa).', 42000.00, 42000.00, '🚬', '/assets/croissant.jpg', 1, 0, 11, 1, 1],
                ['prod-cig-2', 'cat-rokok', 'Esse Change Grape', 'Rokok mild kapsul rasa anggur (Khusus usia 21+ tahun, tanpa diskon mahasiswa).', 40000.00, 40000.00, '🚬', '/assets/croissant.jpg', 1, 0, 12, 1, 1]
            ];
            for (const [id, category_id, name, description, price, student_price, emoji, image_url, is_available, customizable, sort_order, is_active, is_tobacco] of tobaccoProducts) {
                await conn.query(`
                    INSERT INTO products (id, category_id, name, description, price, student_price, emoji, image_url, is_available, customizable, sort_order, is_active, is_tobacco)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE price=VALUES(price), student_price=VALUES(price), is_tobacco=1
                `, [id, category_id, name, description, price, student_price, emoji, image_url, is_available, customizable, sort_order, is_active, is_tobacco]);
            }

            // 4. Raw Materials, Product Recipes, Stock Mutations
            await conn.query(`
                CREATE TABLE IF NOT EXISTS raw_materials (
                    id VARCHAR(50) NOT NULL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    sku VARCHAR(50) NOT NULL UNIQUE,
                    unit VARCHAR(20) NOT NULL DEFAULT 'gram',
                    current_stock DECIMAL(12,2) NOT NULL DEFAULT '0.00',
                    minimum_stock DECIMAL(12,2) NOT NULL DEFAULT '5.00',
                    cost_per_unit DECIMAL(10,2) NOT NULL DEFAULT '0.00',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            const defaultMaterials = [
                ['mat-coffee-bean', 'Biji Kopi Arabika House Blend', 'MAT-COFFEE', 'gram', 2500.00, 500.00, 250.00],
                ['mat-fresh-milk', 'Susu Segar Pasteurisasi', 'MAT-MILK', 'ml', 10000.00, 2000.00, 18.00],
                ['mat-aren-sugar', 'Sirup Gula Aren Asli', 'MAT-AREN', 'ml', 3000.00, 500.00, 40.00],
                ['mat-matcha-powder', 'Bubuk Uji Matcha Jepang', 'MAT-MATCHA', 'gram', 1500.00, 300.00, 350.00],
                ['mat-croissant-dough', 'Frozen Butter Croissant', 'MAT-CROISSANT', 'pcs', 40.00, 10.00, 12000.00],
                ['mat-rice', 'Beras Pulen Super', 'MAT-RICE', 'gram', 15000.00, 3000.00, 16.00],
                ['mat-chicken-cut', 'Daging Ayam Fillet Siap Masak', 'MAT-CHICKEN', 'gram', 5000.00, 1000.00, 50.00],
                ['mat-french-fries', 'Frozen French Fries Cut', 'MAT-FRIES', 'gram', 4000.00, 1000.00, 35.00],
                ['mat-cig-marlboro', 'Stok Marlboro Filter Black', 'MAT-CIG-MB', 'bks', 30.00, 5.00, 38000.00],
                ['mat-cig-esse', 'Stok Esse Change Grape', 'MAT-CIG-ES', 'bks', 25.00, 5.00, 36000.00]
            ];
            for (const [id, name, sku, unit, current_stock, minimum_stock, cost_per_unit] of defaultMaterials) {
                await conn.query(`
                    INSERT INTO raw_materials (id, name, sku, unit, current_stock, minimum_stock, cost_per_unit)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE name=VALUES(name)
                `, [id, name, sku, unit, current_stock, minimum_stock, cost_per_unit]);
            }

            await conn.query(`
                CREATE TABLE IF NOT EXISTS product_recipes (
                    id VARCHAR(50) NOT NULL PRIMARY KEY,
                    product_id VARCHAR(50) NOT NULL,
                    raw_material_id VARCHAR(50) NOT NULL,
                    quantity_needed DECIMAL(10,2) NOT NULL DEFAULT '1.00',
                    UNIQUE KEY uniq_prod_mat (product_id, raw_material_id),
                    KEY raw_material_id (raw_material_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            const defaultRecipes = [
                ['rcp-1a', 'prod-1', 'mat-coffee-bean', 18.00],
                ['rcp-1b', 'prod-1', 'mat-fresh-milk', 150.00],
                ['rcp-1c', 'prod-1', 'mat-aren-sugar', 25.00],
                ['rcp-2a', 'prod-2', 'mat-croissant-dough', 1.00],
                ['rcp-3a', 'prod-3', 'mat-matcha-powder', 15.00],
                ['rcp-3b', 'prod-3', 'mat-fresh-milk', 180.00],
                ['rcp-5a', 'prod-5', 'mat-coffee-bean', 20.00],
                ['rcp-7a', 'prod-7', 'mat-rice', 180.00],
                ['rcp-7b', 'prod-7', 'mat-chicken-cut', 60.00],
                ['rcp-8a', 'prod-8', 'mat-rice', 180.00],
                ['rcp-8b', 'prod-8', 'mat-chicken-cut', 100.00],
                ['rcp-9a', 'prod-9', 'mat-french-fries', 150.00],
                ['rcp-c1', 'prod-cig-1', 'mat-cig-marlboro', 1.00],
                ['rcp-c2', 'prod-cig-2', 'mat-cig-esse', 1.00]
            ];
            for (const [id, product_id, raw_material_id, quantity_needed] of defaultRecipes) {
                await conn.query(`
                    INSERT INTO product_recipes (id, product_id, raw_material_id, quantity_needed)
                    VALUES (?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE quantity_needed=VALUES(quantity_needed)
                `, [id, product_id, raw_material_id, quantity_needed]);
            }

            await conn.query(`
                CREATE TABLE IF NOT EXISTS stock_mutations (
                    id VARCHAR(50) NOT NULL PRIMARY KEY,
                    raw_material_id VARCHAR(50) NOT NULL,
                    type ENUM('SALE','VOID_RESTORE','RESTOCK','ADJUSTMENT') NOT NULL,
                    quantity DECIMAL(10,2) NOT NULL,
                    balance_after DECIMAL(12,2) NOT NULL,
                    reference_order_number VARCHAR(50) DEFAULT NULL,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    KEY raw_material_id (raw_material_id),
                    KEY reference_order_number (reference_order_number)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // 5. Birthday Rewards
            await conn.query(`
                CREATE TABLE IF NOT EXISTS birthday_rewards (
                    id VARCHAR(50) NOT NULL PRIMARY KEY,
                    student_id_num VARCHAR(50) NOT NULL,
                    reward_year INT NOT NULL,
                    reward_name VARCHAR(150) NOT NULL,
                    order_number VARCHAR(50) NOT NULL,
                    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_student_year (student_id_num, reward_year)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // 6. Loyalty Tables
            await conn.query(`
                CREATE TABLE IF NOT EXISTS loyalty_accounts (
                    id VARCHAR(50) NOT NULL PRIMARY KEY,
                    student_id_num VARCHAR(50) NOT NULL UNIQUE,
                    student_name VARCHAR(100) NOT NULL,
                    points_balance INT NOT NULL DEFAULT '0',
                    total_spent DECIMAL(12,2) NOT NULL DEFAULT '0.00',
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await conn.query(`
                CREATE TABLE IF NOT EXISTS loyalty_logs (
                    id VARCHAR(50) NOT NULL PRIMARY KEY,
                    student_id_num VARCHAR(50) NOT NULL,
                    points_change INT NOT NULL,
                    balance_after INT NOT NULL,
                    type ENUM('EARNED','REDEEMED','BIRTHDAY_BONUS','ADJUSTMENT') NOT NULL,
                    reference_order_number VARCHAR(50) DEFAULT NULL,
                    description VARCHAR(255) DEFAULT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    KEY student_id_num (student_id_num)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // 7. Cashier Shifts
            await conn.query(`
                CREATE TABLE IF NOT EXISTS cashier_shifts (
                    id VARCHAR(50) NOT NULL PRIMARY KEY,
                    cashier_id VARCHAR(50) NOT NULL,
                    cashier_name VARCHAR(100) NOT NULL,
                    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    ended_at TIMESTAMP NULL DEFAULT NULL,
                    starting_cash DECIMAL(10,2) NOT NULL DEFAULT '0.00',
                    ending_cash_system DECIMAL(10,2) NOT NULL DEFAULT '0.00',
                    ending_cash_actual DECIMAL(10,2) NOT NULL DEFAULT '0.00',
                    cash_difference DECIMAL(10,2) NOT NULL DEFAULT '0.00',
                    total_sales_cash DECIMAL(10,2) NOT NULL DEFAULT '0.00',
                    total_sales_qris DECIMAL(10,2) NOT NULL DEFAULT '0.00',
                    total_orders_count INT NOT NULL DEFAULT '0',
                    status ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
                    notes TEXT
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // 8. Audit Logs
            await conn.query(`
                CREATE TABLE IF NOT EXISTS audit_logs (
                    id VARCHAR(50) NOT NULL PRIMARY KEY,
                    user_id VARCHAR(50) DEFAULT NULL,
                    user_name VARCHAR(100) DEFAULT NULL,
                    role VARCHAR(30) DEFAULT NULL,
                    action VARCHAR(100) NOT NULL,
                    target_type VARCHAR(50) NOT NULL,
                    target_id VARCHAR(100) DEFAULT NULL,
                    details JSON DEFAULT NULL,
                    ip_address VARCHAR(50) DEFAULT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    KEY idx_audit_action (action),
                    KEY idx_audit_created (created_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // 9. Admins seed
            await conn.query(`
                INSERT INTO admins (id, name, email, password_hash, role)
                VALUES
                ('admin-kasir-1', 'Kasir Utama', 'kasir@cafecampus.demo', '$2b$10$0EE0QHUTP7y0S9kI1x0bXOjzyFdfzbBm9EI5qkmkaAWUL4CVZy4JG', 'CASHIER'),
                ('admin-dapur-1', 'Staf Dapur & Barista', 'dapur@cafecampus.demo', '$2b$10$0EE0QHUTP7y0S9kI1x0bXOjzyFdfzbBm9EI5qkmkaAWUL4CVZy4JG', 'KITCHEN')
                ON DUPLICATE KEY UPDATE name=VALUES(name), role=VALUES(role)
            `);

            // 10. Tables 01 to 12
            for (let i = 1; i <= 12; i++) {
                const num = String(i).padStart(2, '0');
                const id = 'tbl-' + i;
                const name = 'Meja ' + num;
                const token = 'demo-table-' + num;
                await conn.query(`
                    INSERT INTO cafe_tables (id, table_number, name, public_token, token_version, is_active)
                    VALUES (?, ?, ?, ?, 1, 1)
                    ON DUPLICATE KEY UPDATE table_number=VALUES(table_number), name=VALUES(name), public_token=VALUES(public_token)
                `, [id, num, name, token]);
            }

            // 11. Settings
            await conn.query(`
                INSERT INTO settings (id, cafe_name, cafe_address, cafe_phone, operating_hours, service_fee, tax_percent, qris_enabled, cash_enabled, sound_enabled, daily_report_enabled)
                VALUES (1, 'Cafe Campus', 'Jl. Kampus Merdeka No. 42', '0812-3456-7890', '08:00 - 22:00 WIB', 5.00, 11.00, 1, 1, 1, 1)
                ON DUPLICATE KEY UPDATE cafe_name=VALUES(cafe_name), service_fee=VALUES(service_fee), tax_percent=VALUES(tax_percent)
            `);

            // 12. Push Subscriptions
            await conn.query(`
                CREATE TABLE IF NOT EXISTS push_subscriptions (
                    endpoint VARCHAR(500) NOT NULL PRIMARY KEY,
                    channel VARCHAR(50) NOT NULL DEFAULT 'customer',
                    order_number VARCHAR(50) DEFAULT NULL,
                    p256dh VARCHAR(255) DEFAULT NULL,
                    auth VARCHAR(255) DEFAULT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    KEY idx_push_order (order_number)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // 13. Orders columns
            const orderCols = [
                { name: 'student_faculty_id', sql: 'ALTER TABLE orders ADD COLUMN student_faculty_id VARCHAR(50) NULL' },
                { name: 'student_faculty_code', sql: 'ALTER TABLE orders ADD COLUMN student_faculty_code VARCHAR(20) NULL' },
                { name: 'student_faculty_name', sql: 'ALTER TABLE orders ADD COLUMN student_faculty_name VARCHAR(150) NULL' },
                { name: 'student_study_program', sql: 'ALTER TABLE orders ADD COLUMN student_study_program VARCHAR(150) NULL' },
                { name: 'student_birth_date', sql: 'ALTER TABLE orders ADD COLUMN student_birth_date DATE NULL' },
                { name: 'queue_number', sql: 'ALTER TABLE orders ADD COLUMN queue_number VARCHAR(20) NULL' },
                { name: 'is_birthday_reward', sql: 'ALTER TABLE orders ADD COLUMN is_birthday_reward TINYINT(1) DEFAULT 0' },
                { name: 'birthday_reward_name', sql: 'ALTER TABLE orders ADD COLUMN birthday_reward_name VARCHAR(150) NULL' },
                { name: 'parent_order_number', sql: 'ALTER TABLE orders ADD COLUMN parent_order_number VARCHAR(50) NULL, ADD INDEX idx_orders_parent (parent_order_number)' },
                { name: 'void_reason', sql: 'ALTER TABLE orders ADD COLUMN void_reason TEXT NULL' },
                { name: 'voided_by', sql: 'ALTER TABLE orders ADD COLUMN voided_by VARCHAR(50) NULL' },
                { name: 'voided_at', sql: 'ALTER TABLE orders ADD COLUMN voided_at TIMESTAMP NULL' },
                { name: 'receipt_printed', sql: 'ALTER TABLE orders ADD COLUMN receipt_printed TINYINT(1) NOT NULL DEFAULT 0' },
                { name: 'receipt_printed_at', sql: 'ALTER TABLE orders ADD COLUMN receipt_printed_at TIMESTAMP NULL' }
            ];
            for (const col of orderCols) {
                const [c] = await conn.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = ?", [col.name]);
                if (!c.length) {
                    await conn.query(col.sql);
                }
            }

        } finally {
            // Always restore FK checks before returning a pooled connection.
            await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch((resetErr) => {
                console.error('[database] Gagal memulihkan FOREIGN_KEY_CHECKS:', resetErr.code || resetErr.message);
            });
            conn.release();
        }

        if (process.env.PORT === '4188' || process.env.NODE_ENV === 'test') {
            await pool.query("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE student_id_num IN ('2306781001', '000000', '13521999'))").catch(() => {});
            await pool.query("DELETE FROM orders WHERE student_id_num IN ('2306781001', '000000', '13521999') OR idempotency_key LIKE 'stud-%' OR idempotency_key LIKE 'quota-%' OR idempotency_key LIKE 'reg-%' OR idempotency_key LIKE 'cancel-%' OR idempotency_key LIKE 'fake-%' OR idempotency_key LIKE 'qris-%' OR idempotency_key LIKE 'sold-%'").catch(() => {});
        }

        // Sample/demo transactions are strictly limited to demo mode. Never pollute
        // a real client's production sales reports with fabricated orders.
        if (IS_DEMO) {
            const [todayOrders] = await pool.query('SELECT COUNT(*) as cnt FROM orders WHERE payment_status = "PAID" AND DATE(created_at) = CURDATE()');
            if (todayOrders[0].cnt < 5) {
            const demoOrders = [
                { num: 'CC-INIT-01', q: 'Q-001', tbl: 'Meja 01', type: 'STUDENT', sName: 'Rian Ardiansyah', campus: 'UI', nim: '2106781290', sub: 42000, sav: 12000, tot: 48930, method: 'QRIS_DEMO', st: 'COMPLETED' },
                { num: 'CC-INIT-02', q: 'Q-002', tbl: 'Meja 02', type: 'STUDENT', sName: 'Siti Rahma', campus: 'ITB', nim: '13521001', sub: 25000, sav: 7000, tot: 29125, method: 'CASH', st: 'READY' },
                { num: 'CC-INIT-03', q: 'Q-003', tbl: 'Meja 03', type: 'REGULAR', sName: null, campus: null, nim: null, sub: 56000, sav: 0, tot: 65240, method: 'QRIS_DEMO', st: 'PROCESSING' },
                { num: 'CC-INIT-04', q: 'Q-004', tbl: 'Meja 04', type: 'STUDENT', sName: 'Dimas Satria', campus: 'UGM', nim: '20/456789', sub: 28000, sav: 7000, tot: 32620, method: 'CASH', st: 'NEW' },
                { num: 'CC-INIT-05', q: 'Q-005', tbl: 'Meja 05', type: 'REGULAR', sName: null, campus: null, nim: null, sub: 35000, sav: 0, tot: 40775, method: 'CASH', st: 'NEW' }
            ];
            for (const o of demoOrders) {
                const [existingOrders] = await pool.query('SELECT id FROM orders WHERE order_number = ? LIMIT 1', [o.num]);
                const oId = existingOrders[0]?.id || crypto.randomUUID();
                await pool.query(`
                    INSERT INTO orders (id, order_number, queue_number, table_name, customer_type, student_name, student_campus, student_id_num, subtotal, total_savings, total, payment_method, payment_status, status, paid_at, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAID', ?, NOW(), NOW())
                    ON DUPLICATE KEY UPDATE status=VALUES(status), payment_status='PAID', created_at=NOW(), paid_at=NOW()
                `, [oId, o.num, o.q, o.tbl, o.type, o.sName, o.campus, o.nim, o.sub, o.sav, o.tot, o.method, o.st]);

                const [existingItems] = await pool.query('SELECT id FROM order_items WHERE order_id = ? LIMIT 1', [oId]);
                if (existingItems.length === 0) {
                    await pool.query(`
                        INSERT INTO order_items (id, order_id, product_name, quantity, base_price, regular_base_price, price, regular_price, line_total)
                        VALUES (?, ?, 'Iced Latte Gula Aren', 2, 21000, 28000, 21000, 28000, ?)
                    `, [crypto.randomUUID(), oId, o.sub]);
                }
            }
            }
        }
    } catch (err) {
        console.error('[database] Inisialisasi schema/seed gagal:', err);
        throw err;
    }
};

await ensureSchema();
await expireStaleQrisOrders();
setInterval(expireStaleQrisOrders, 60 * 1000);

const server = app.listen(PORT, '0.0.0.0', () => {
    const lanIp = getLanIp();
    console.log(`\n======================================================`);
    console.log(`☕ Cafe Campus Server v2.0 Siap & Aktif!`);
    console.log(`⚙️  Mode Aplikasi:         ${APP_MODE.toUpperCase()} (${IS_DEMO ? 'Mode Demo / Simulasi Aktif' : 'Mode Produksi / Pengamanan Penuh'})`);
    console.log(`🤖 Gemini KTM OCR:        ${GEMINI_KTM_API_KEY ? 'AKTIF (gemini-3.1-flash-lite Vision)' : 'OFF (Fallback Heuristik)'}`);
    console.log(`💬 Gemini Barista Chat:    ${GEMINI_CHATBOT_API_KEY ? 'AKTIF (gemini-3.1-flash-lite)' : 'OFF (Rule Engine)'}`);
    console.log(`💻 Akses PC (Kasir/Admin): http://localhost:${PORT}/admin/login`);
    console.log(`🍳 Kitchen Display (KDS):  http://localhost:${PORT}/admin/kds`);
    console.log(`📱 Akses HP (Customer):    http://${lanIp}:${PORT}`);
    console.log(`======================================================\n`);
});
// Konfigurasi HTTP Keep-Alive untuk stabilitas reverse proxy (Cloudflare Tunnel)
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;