import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const QRCode = require('./vendor/qrcode/index.js');
const QRErrorCorrectLevel = require('./vendor/qrcode/QRErrorCorrectLevel.js');
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PORT = Number(process.env.PORT || 4176);
const HOST = process.env.HOST || '0.0.0.0';
const DEMO_ADMIN = {
  email: process.env.ADMIN_EMAIL || 'admin@cafecampus.demo',
  password: process.env.ADMIN_PASSWORD || 'admin123',
  name: process.env.ADMIN_NAME || 'Demo Admin',
  role: 'ADMIN'
};
const sseClients = new Set();

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const token = (n = 12) => crypto.randomBytes(n).toString('base64url');

function getLocalIp() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('127.') && !iface.address.startsWith('169.254.')) {
          return iface.address;
        }
      }
    }
  } catch { }
  return '127.0.0.1';
}

function seedState() {
  const categories = [
    { id: id(), name: 'Kopi', slug: 'kopi', sortOrder: 1, active: true },
    { id: id(), name: 'Non-Kopi', slug: 'non-kopi', sortOrder: 2, active: true },
    { id: id(), name: 'Makanan Utama', slug: 'makanan', sortOrder: 3, active: true },
    { id: id(), name: 'Snack & Pastry', slug: 'snack', sortOrder: 4, active: true },
    { id: id(), name: 'Dessert', slug: 'dessert', sortOrder: 5, active: true },
  ];
  const cat = Object.fromEntries(categories.map(c => [c.slug, c.id]));
  const productSeed = [
    { name: 'Iced Latte Gula Aren', description: 'Kopi susu lokal spesial dengan gula aren premium.', price: 28000, studentPrice: 22000, category: 'kopi', imageUrl: '/assets/iced-latte.jpg', isAvailable: true, customizable: true },
    { name: 'Croissant Cokelat', description: 'Pastry hangat & renyah isi cokelat lembut.', price: 25000, studentPrice: 20000, category: 'snack', imageUrl: '/assets/croissant.jpg', isAvailable: false, customizable: false },
    { name: 'Uji Matcha Latte', description: 'Matcha Jepang autentik kualitas premium.', price: 32000, studentPrice: 25000, category: 'non-kopi', imageUrl: '/assets/matcha.jpg', isAvailable: true, customizable: true },
    { name: 'Waffle Gelato', description: 'Waffle mentega hangat dipadu gelato vanilla.', price: 35000, studentPrice: 28000, category: 'dessert', imageUrl: '/assets/waffle.jpg', isAvailable: true, customizable: false },
    { name: 'Double Espresso', description: 'Racikan kopi murni yang intens dan kaya aroma.', price: 20000, studentPrice: 15000, category: 'kopi', imageUrl: '/assets/espresso.jpg', isAvailable: true, customizable: false },
    { name: 'Premium Iced Chocolate', description: 'Cokelat hitam murni dipadu susu segar.', price: 30000, studentPrice: 24000, category: 'non-kopi', imageUrl: '/assets/chocolate.jpg', isAvailable: true, customizable: true },
    { name: 'Nasi Goreng Kampus', description: 'Nasi goreng gurih dengan telur, ayam, dan acar.', price: 35000, studentPrice: 28000, category: 'makanan', imageUrl: '/assets/nasi-goreng.jpg', isAvailable: true, customizable: false },
    { name: 'Chicken Rice Bowl', description: 'Ayam crispy saus lada hitam dengan nasi hangat.', price: 38000, studentPrice: 30000, category: 'makanan', imageUrl: '/assets/rice-bowl.jpg', isAvailable: true, customizable: false },
    { name: 'French Fries', description: 'Kentang goreng renyah dengan saus pilihan.', price: 20000, studentPrice: 16000, category: 'snack', imageUrl: '/assets/french-fries.jpg', isAvailable: true, customizable: false },
    { name: 'Brownies Gelato', description: 'Brownies cokelat hangat dengan gelato vanilla.', price: 32000, studentPrice: 26000, category: 'dessert', imageUrl: '/assets/brownies.jpg', isAvailable: true, customizable: false },
  ];
  const products = productSeed.map((p, i) => ({
    id: id(), name: p.name, description: p.description, price: p.price, studentPrice: p.studentPrice || p.price,
    categoryId: cat[p.category], categorySlug: p.category, emoji: '☕',
    imageUrl: p.imageUrl, imageData: null, customizable: !!p.customizable,
    isAvailable: p.isAvailable, active: true, sortOrder: i + 1, createdAt: now(), updatedAt: now()
  }));
  const tables = Array.from({ length: 12 }, (_, i) => ({
    id: id(), tableNumber: String(i + 1).padStart(2, '0'),
    name: `Meja ${String(i + 1).padStart(2, '0')}`,
    publicToken: `demo-table-${String(i + 1).padStart(2, '0')}`,
    tokenVersion: 1, active: true, createdAt: now()
  }));

  const pByName = Object.fromEntries(products.map(p => [p.name, p]));
  const day = new Date().toISOString().slice(0, 10);
  const mkItem = (name, qty = 1, isStudent = false, note = '') => {
    const p = pByName[name];
    const unit = isStudent && p.studentPrice ? p.studentPrice : p.price;
    const savings = Math.max(0, p.price - unit) * qty;
    return { id: id(), productId: p.id, productName: p.name, basePrice: unit, regularBasePrice: p.price, price: unit, regularPrice: p.price, savings, quantity: qty, note, options: {}, lineTotal: unit * qty, emoji: p.emoji, imageUrl: p.imageUrl };
  };
  const mkOrder = (num, tableNo, status, method, itemDefs, time, isStudent = false, studentData = null, paid = true) => {
    const items = itemDefs.map(x => mkItem(x[0], x[1], isStudent));
    const subtotal = items.reduce((a, x) => a + x.lineTotal, 0);
    const totalSavings = items.reduce((a, x) => a + (x.savings || 0), 0);
    const serviceFee = Math.round(subtotal * .05), tax = Math.round((subtotal + serviceFee) * .11), total = subtotal + serviceFee + tax;
    const createdAt = `${day}T${time}:00+07:00`; const hist = [{ status: 'NEW', at: createdAt, label: 'Pesanan dibuat' }];
    if (status === 'PROCESSING' || status === 'READY' || status === 'COMPLETED') hist.push({ status: 'PROCESSING', at: createdAt, label: 'Pesanan sedang diproses' });
    if (status === 'READY' || status === 'COMPLETED') hist.push({ status: 'READY', at: createdAt, label: 'Pesanan siap diambil' });
    if (status === 'COMPLETED') hist.push({ status: 'COMPLETED', at: createdAt, label: 'Pesanan selesai' });
    return {
      id: id(), orderNumber: num, tableId: tables[Number(tableNo) - 1].id, tableName: `Meja ${tableNo}`, tableNumber: tableNo,
      customerType: isStudent ? 'STUDENT' : 'REGULAR',
      studentInfo: isStudent ? (studentData || { campus: 'Universitas Indonesia', studentId: '2106781290', studentName: 'Mahasiswa Demo' }) : null,
      accessToken: token(18),
      idempotencyKey: `seed-${num}`, items, subtotal, totalSavings, serviceFee, tax, total, note: '', status,
      estimatedMinutes: 10, payment: { method, status: paid ? 'PAID' : 'PENDING', paidAt: paid ? createdAt : null, reference: method === 'QRIS_DEMO' ? `DEMO-${num}` : null },
      history: hist, createdAt, updatedAt: createdAt, demoSeed: true
    };
  };
  const orders = [
    mkOrder('CC-0045', '08', 'NEW', 'QRIS_DEMO', [['Iced Latte Gula Aren', 1], ['Croissant Cokelat', 1]], '09:44', true, { campus: 'Universitas Indonesia', studentId: '2106781290', studentName: 'Rian Ardiansyah' }, true),
    mkOrder('CC-0044', '12', 'PROCESSING', 'CASH', [['Uji Matcha Latte', 1], ['Waffle Gelato', 1]], '09:42', true, { campus: 'Institut Teknologi Bandung', studentId: '13521099', studentName: 'Aulia Putri' }, true),
    mkOrder('CC-0043', '05', 'READY', 'QRIS_DEMO', [['Iced Latte Gula Aren', 2]], '09:35', false, null, true),
    mkOrder('CC-0042', '11', 'COMPLETED', 'CASH', [['Double Espresso', 1], ['Croissant Cokelat', 1]], '09:12', false, null, true),
    mkOrder('CC-0041', '02', 'COMPLETED', 'QRIS_DEMO', [['Premium Iced Chocolate', 1], ['Iced Latte Gula Aren', 1]], '09:05', true, { campus: 'Universitas Gadjah Mada', studentId: '22/492100/TK/54000', studentName: 'Dimas Prasetyo' }, true),
  ];
  return {
    version: 2, seq: 46, categories, products, tables, orders,
    settings: {
      cafeName: 'Cafe Campus - Gedung Utama',
      cafeAddress: 'Jl. Kampus Raya No. 12',
      cafePhone: '+62 812-3456-7890',
      operatingHours: 'Setiap Hari (08:00 - 22:00)',
      serviceFee: 5, taxPercent: 11, demoMode: true,
      qrisEnabled: true, cashEnabled: true, soundEnabled: true, dailyReportEnabled: true
    },
    audit: []
  };
}

function loadState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let s;
  if (!fs.existsSync(STATE_FILE)) {
    s = seedState();
    saveState(s);
    return s;
  }
  try {
    s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    s = seedState();
    saveState(s);
    return s;
  }
  // Sync modern authentic food photos
  const imgMap = {
    'Nasi Goreng Kampus': '/assets/nasi-goreng.jpg',
    'Chicken Rice Bowl': '/assets/rice-bowl.jpg',
    'French Fries': '/assets/french-fries.jpg',
    'Brownies Gelato': '/assets/brownies.jpg'
  };
  if (Array.isArray(s.products)) {
    s.products.forEach(p => {
      if (imgMap[p.name]) p.imageUrl = imgMap[p.name];
    });
  }
  return s;
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }
let state = loadState();

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

function json(res, status, data, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...headers
  });
  res.end(JSON.stringify(data));
}
function text(res, status, data, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    ...SECURITY_HEADERS
  });
  res.end(data);
}
function parseCookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(v => { const i = v.indexOf('='); return [v.slice(0, i).trim(), decodeURIComponent(v.slice(i + 1))] })); }
function adminSession(req) { return parseCookies(req).cc_demo_admin === 'yes'; }
function requireAdmin(req, res) { if (!adminSession(req)) { json(res, 401, { message: 'Silakan login sebagai admin demo.' }); return false; } return true; }
async function body(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', c => { raw += c; if (raw.length > 1_000_000) { reject(new Error('Payload terlalu besar')); req.destroy(); } }); req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)) } catch { reject(new Error('JSON tidak valid')) } }); req.on('error', reject) }); }
function safeOrder(o) { return { ...o, accessToken: undefined }; }
function money(v) { return Number(v || 0); }
function broadcast(event, payload) { const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`; for (const c of [...sseClients]) { const allowed = event === 'admin-order' ? c.channel === 'admin' : event === 'order-update' ? c.order === payload.orderNumber : true; if (!allowed) continue; try { c.res.write(msg) } catch { sseClients.delete(c) } } }
function audit(action, meta = {}) { state.audit.unshift({ id: id(), action, meta, at: now() }); state.audit = state.audit.slice(0, 200); }
function nextOrderNumber() { return `CC-${String(state.seq++).padStart(4, '0')}`; }
function orderByNumber(n) { return state.orders.find(o => o.orderNumber === n); }
function tableByToken(t) {
  if (!t) return null;
  const clean = String(t).trim().toLowerCase();
  return state.tables.find(x =>
    x.active && (
      x.publicToken.toLowerCase() === clean ||
      x.tableNumber.toLowerCase() === clean ||
      x.tableNumber.toLowerCase() === clean.padStart(2, '0') ||
      clean === `demo-table-${x.tableNumber.toLowerCase()}` ||
      clean === `table-${x.tableNumber.toLowerCase()}`
    )
  ) || null;
}
const EDU_EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9-]+\.)+(ac\.id|edu|sch\.id|edu\.id|kampus\.id)$/i;
const otpStore = new Map();

function evaluateStudentFraud(info) {
  let score = 0;
  const flags = [];
  
  if (!info.email || !EDU_EMAIL_REGEX.test(info.email)) {
    score += 45;
    flags.push('Email bukan domain institusi kampus resmi (.ac.id/.edu)');
  }
  const numOnly = (info.studentId || '').replace(/[^0-9]/g, '');
  if (!info.studentId || info.studentId.length < 5) {
    score += 30;
    flags.push('Format Nomor Induk Mahasiswa tidak lazim (< 5 digit)');
  }
  if (!info.campus || info.campus.length < 3) {
    score += 25;
    flags.push('Nama universitas/sekolah tidak terdefinisi');
  }
  if (!info.studentPhoto || info.studentPhoto.length < 20) {
    score += 50;
    flags.push('Foto selfie bersama KTM belum dilampirkan');
  }

  const fraudScore = Math.max(0, Math.min(100, score));
  let fraudRisk = 'LOW';
  let verificationStatus = 'AUTOMATICALLY_VERIFIED';

  if (fraudScore > 50) {
    fraudRisk = 'HIGH';
    verificationStatus = 'PENDING_VERIFICATION';
  } else if (fraudScore >= 20) {
    fraudRisk = 'MEDIUM';
    verificationStatus = 'PENDING_VERIFICATION';
  } else {
    fraudRisk = 'LOW';
    verificationStatus = 'AUTOMATICALLY_VERIFIED';
  }

  return { fraudScore, fraudRisk, flags, verificationStatus };
}

function productById(pid) { return state.products.find(p => p.id === pid && p.active); }
function canTransition(from, to) { const map = { NEW: ['PROCESSING', 'CANCELLED'], PROCESSING: ['READY', 'CANCELLED'], READY: ['COMPLETED'], COMPLETED: [], CANCELLED: [] }; return (map[from] || []).includes(to); }
function createOrder(input) {
  const t = tableByToken(input.tableToken); if (!t) throw Object.assign(new Error('QR meja tidak valid atau sudah dinonaktifkan.'), { status: 400 });
  if (!Array.isArray(input.items) || !input.items.length) throw Object.assign(new Error('Keranjang masih kosong.'), { status: 400 });
  const idem = String(input.idempotencyKey || '').trim();
  const duplicate = idem && state.orders.find(o => o.idempotencyKey === idem); if (duplicate) return duplicate;

  const isStudent = input.customerType === 'STUDENT';
  let studentInfo = null;

  if (isStudent) {
    const sId = String(input.studentInfo?.studentId || input.studentId || '').trim();
    const sEmail = String(input.studentInfo?.email || input.email || '').trim().toLowerCase();
    const sName = String(input.studentInfo?.studentName || input.studentName || '').trim().slice(0, 60);
    const sCampus = String(input.studentInfo?.campus || input.campus || '').trim().slice(0, 80);
    const sPhoto = input.studentInfo?.studentPhoto || input.studentPhoto || null;

    if (!sName || !sCampus || !sId) {
      throw Object.assign(new Error('Harap lengkapi data verifikasi mahasiswa (Nama, Kampus, & NIM).'), { status: 400 });
    }

    // 1. Blacklist Check
    const isBlacklisted = (state.blacklist || []).some(b => 
      (b.studentId && b.studentId === sId) || (b.email && b.email.toLowerCase() === sEmail)
    );
    if (isBlacklisted) {
      throw Object.assign(new Error('Identitas mahasiswa ini telah masuk daftar hitam (blacklist) sistem anti-fraud kafe karena pelanggaran.'), { status: 403 });
    }

    // 2. Anti-Sybil Daily Quota Limit (Max 1 student order per NIM / Email per day)
    const today = new Date().toISOString().slice(0, 10);
    const existingStudentOrderToday = state.orders.find(o => 
      o.createdAt.slice(0, 10) === today &&
      o.customerType === 'STUDENT' &&
      o.status !== 'CANCELLED' &&
      ((o.studentInfo?.studentId && o.studentInfo.studentId === sId) || (o.studentInfo?.email && o.studentInfo.email.toLowerCase() === sEmail))
    );
    if (existingStudentOrderToday) {
      throw Object.assign(new Error(`Batas kuota harian tercapai! NIM ${sId} / Email ${sEmail} sudah digunakan untuk pesanan #${existingStudentOrderToday.orderNumber} hari ini. Diskon pelajar dibatasi 1x per hari per identitas untuk mencegah penyalahgunaan.`), { status: 409 });
    }

    // 3. Automated Fraud Scoring & Verification Status Engine
    const evalResult = evaluateStudentFraud({ studentName: sName, campus: sCampus, studentId: sId, email: sEmail, studentPhoto: sPhoto });

    studentInfo = {
      campus: sCampus,
      studentId: sId,
      studentName: sName,
      email: sEmail || null,
      studentPhoto: sPhoto,
      fraudScore: evalResult.fraudScore,
      fraudRisk: evalResult.fraudRisk,
      fraudFlags: evalResult.flags,
      verificationStatus: evalResult.verificationStatus,
      rejectionReason: null
    };
  }

  const grouped = new Map();
  for (const row of input.items) {
    const pid = String(row?.productId || '');
    const p = productById(pid); if (!p || !p.isAvailable) throw Object.assign(new Error('Ada menu yang sudah tidak tersedia.'), { status: 409 });
    const cat = state.categories.find(c => c.id === p.categoryId && c.active); if (!cat) throw Object.assign(new Error(`${p.name} sedang tidak dapat dipesan.`), { status: 409 });
    const q = Math.max(1, Math.min(20, Math.trunc(Number(row.quantity) || 1)));
    const note = String(row.note || '').trim().slice(0, 160);
    const raw = row.options && typeof row.options === 'object' ? row.options : {};
    const options = {};
    if (p.customizable) {
      const size = ['Regular', 'Large'].includes(raw.size) ? raw.size : 'Regular';
      const sweetness = ['Normal', 'Less', 'Tanpa Gula'].includes(raw.sweetness) ? raw.sweetness : 'Normal';
      const ice = ['Normal', 'Sedikit Es', 'Tanpa Es'].includes(raw.ice) ? raw.ice : 'Normal';
      options.size = size; options.sweetness = sweetness; options.ice = ice;
    }
    const basePrice = isStudent && Number(p.studentPrice) > 0 ? Number(p.studentPrice) : p.price;
    const regularBasePrice = p.price;
    const price = basePrice + (options.size === 'Large' ? 5000 : 0);
    const regularPrice = regularBasePrice + (options.size === 'Large' ? 5000 : 0);
    const key = pid + '|' + note + '|' + JSON.stringify(options);
    const existing = grouped.get(key);
    if (existing) existing.quantity = Math.min(20, existing.quantity + q);
    else grouped.set(key, { p, quantity: q, note, options, price, regularPrice, basePrice, regularBasePrice });
  }
  let subtotal = 0;
  let totalSavings = 0;
  const items = [...grouped.values()].map(({ p, quantity, note, options, price, regularPrice, basePrice, regularBasePrice }) => {
    const line = price * quantity;
    const regularLine = regularPrice * quantity;
    subtotal += line;
    const itemSavings = Math.max(0, regularLine - line);
    totalSavings += itemSavings;
    return {
      id: id(),
      productId: p.id,
      productName: p.name,
      basePrice,
      regularBasePrice,
      price,
      regularPrice,
      savings: itemSavings,
      quantity,
      note,
      options,
      lineTotal: line,
      emoji: p.emoji,
      imageUrl: p.imageUrl || null
    };
  });
  if (items.length > 50) throw Object.assign(new Error('Terlalu banyak jenis item dalam satu pesanan.'), { status: 400 });
  const serviceFee = Math.round(subtotal * money(state.settings.serviceFee) / 100);
  const tax = Math.round((subtotal + serviceFee) * money(state.settings.taxPercent) / 100);
  const total = subtotal + serviceFee + tax;
  const method = input.paymentMethod === 'QRIS_DEMO' ? 'QRIS_DEMO' : 'CASH';
  if (method === 'QRIS_DEMO' && !state.settings.qrisEnabled) throw Object.assign(new Error('Pembayaran QRIS sedang dinonaktifkan.'), { status: 409 });
  if (method === 'CASH' && !state.settings.cashEnabled) throw Object.assign(new Error('Pembayaran di kasir sedang dinonaktifkan.'), { status: 409 });
  const estimatedMinutes = Math.max(8, Math.min(25, 8 + items.reduce((s, i) => s + i.quantity, 0) * 2));
  const o = {
    id: id(),
    orderNumber: nextOrderNumber(),
    tableId: t.id,
    tableName: t.name,
    tableNumber: t.tableNumber,
    customerType: isStudent ? 'STUDENT' : 'REGULAR',
    studentInfo,
    accessToken: token(18),
    idempotencyKey: idem || id(),
    items,
    subtotal,
    totalSavings,
    serviceFee,
    tax,
    total,
    note: String(input.note || '').trim().slice(0, 250),
    status: 'NEW',
    estimatedMinutes,
    payment: { method, status: 'PENDING', paidAt: null, reference: method === 'QRIS_DEMO' ? `DEMO-${Date.now()}` : null },
    history: [{ status: 'NEW', at: now(), label: isStudent && studentInfo?.verificationStatus === 'AUTOMATICALLY_VERIFIED' ? 'Pesanan dibuat (Lolos Validasi Otomatis AI)' : 'Pesanan dibuat' }],
    createdAt: now(),
    updatedAt: now()
  };
  state.orders.unshift(o);
  audit('ORDER_CREATED', { orderNumber: o.orderNumber, table: o.tableName, customerType: o.customerType, paymentMethod: method, total: o.total, fraudScore: studentInfo?.fraudScore });
  saveState(state);
  broadcast('admin-order', safeOrder(o));
  return o;
}

function markPaid(o, source = 'DEMO') { if (o.payment.status === 'PAID') return; if (o.status === 'CANCELLED' || o.status === 'COMPLETED') throw Object.assign(new Error('Pembayaran tidak dapat dikonfirmasi untuk order yang sudah ditutup.'), { status: 409 }); o.payment.status = 'PAID'; o.payment.paidAt = now(); o.updatedAt = now(); o.history.push({ status: o.status, at: now(), label: `Pembayaran dikonfirmasi (${source})` }); audit('PAYMENT_PAID', { orderNumber: o.orderNumber, source }); saveState(state); broadcast('order-update', safeOrder(o)); broadcast('admin-order', safeOrder(o)); }
function updateStatus(o, to) { if (to === 'CANCELLED' && o.payment.status === 'PAID') throw Object.assign(new Error('Order sudah dibayar. Pembatalan membutuhkan proses refund dan tidak tersedia di demo.'), { status: 409 }); if (o.payment.status !== 'PAID' && to === 'PROCESSING') throw Object.assign(new Error('Pembayaran harus PAID sebelum pesanan diproses.'), { status: 409 }); if (!canTransition(o.status, to)) throw Object.assign(new Error(`Transisi ${o.status} → ${to} tidak diizinkan.`), { status: 409 }); o.status = to; o.updatedAt = now(); o.history.push({ status: to, at: now(), label: { PROCESSING: 'Pesanan sedang diproses', READY: 'Pesanan siap diambil', COMPLETED: 'Pesanan selesai', CANCELLED: 'Pesanan dibatalkan' }[to] || to }); audit('ORDER_STATUS_CHANGED', { orderNumber: o.orderNumber, to }); saveState(state); broadcast('order-update', safeOrder(o)); broadcast('admin-order', safeOrder(o)); }

function qrSvg(textValue) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M); qr.addData(String(textValue)); qr.make();
  const count = qr.getModuleCount(), quiet = 4, size = count + quiet * 2;
  let d = '';
  for (let r = 0; r < count; r++)for (let c = 0; c < count; c++)if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${d}" fill="#111"/></svg>`;
}
function demoPublicBase(req) {
  const configured = String(process.env.DEMO_PUBLIC_BASE || '').replace(/\/$/, '');
  if (configured) return configured;
  const host = String(req.headers.host || '');
  if (!host || host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('0.0.0.0')) {
    const lan = getLocalIp();
    if (lan && lan !== '127.0.0.1') return `http://${lan}:${PORT}`;
  }
  return `http://${host || `127.0.0.1:${PORT}`}`;
}

function mime(file) { return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' })[path.extname(file)] || 'application/octet-stream'; }
function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  let fp = path.join(PUBLIC, rel);
  if (!fp.startsWith(PUBLIC)) return false;
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) { text(res, 200, fs.readFileSync(fp), mime(fp)); return true; }
  if (!urlPath.startsWith('/api/') && !path.extname(urlPath)) { fp = path.join(PUBLIC, 'index.html'); text(res, 200, fs.readFileSync(fp), mime(fp)); return true; }
  return false;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`); const p = u.pathname;
  try {

    let qrMatch = p.match(/^\/qr\/([^/]+)\.svg$/); if (qrMatch && req.method === 'GET') { const tk = decodeURIComponent(qrMatch[1]); const t = state.tables.find(x => x.publicToken === tk); if (!t) return text(res, 404, 'QR tidak ditemukan.', 'text/plain; charset=utf-8'); const target = `${demoPublicBase(req)}/order/${encodeURIComponent(t.publicToken)}`; return text(res, 200, qrSvg(target), 'image/svg+xml; charset=utf-8'); }
    if (p === '/api/health') return json(res, 200, { ok: true, app: 'Cafe Campus Demo', time: now() });
    if (p === '/api/events' && req.method === 'GET') {
      const channel = u.searchParams.get('channel'), orderNo = u.searchParams.get('order');
      if (channel === 'admin' && !adminSession(req)) return json(res, 401, { message: 'Admin session diperlukan.' });
      if (orderNo) { const o = orderByNumber(orderNo), access = u.searchParams.get('access'); if (!o || access !== o.accessToken) return json(res, 403, { message: 'Akses realtime order tidak valid.' }); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }); res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`); const client = { res, channel, order: orderNo }; sseClients.add(client); const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { } }, 20000); req.on('close', () => { clearInterval(ping); sseClients.delete(client) }); return;
    }
    if (p.startsWith('/api/public/tables/') && req.method === 'GET') { const tk = decodeURIComponent(p.split('/').pop()); const t = tableByToken(tk); if (!t) return json(res, 404, { message: 'QR meja tidak valid atau dinonaktifkan.' }); return json(res, 200, { id: t.id, name: t.name, tableNumber: t.tableNumber, publicToken: t.publicToken }); }
    if (p === '/api/public/categories' && req.method === 'GET') return json(res, 200, state.categories.filter(c => c.active).sort((a, b) => a.sortOrder - b.sortOrder));
    if (p === '/api/public/products' && req.method === 'GET') { const activeCats = new Set(state.categories.filter(c => c.active).map(c => c.id)); return json(res, 200, state.products.filter(x => x.active && activeCats.has(x.categoryId)).sort((a, b) => a.sortOrder - b.sortOrder)); }
    if (p === '/api/public/student/send-otp' && req.method === 'POST') {
      const b = await body(req);
      const email = String(b.email || '').trim().toLowerCase();
      if (!email || !EDU_EMAIL_REGEX.test(email)) {
        return json(res, 400, { message: 'Alamat email wajib berakhiran domain institusi resmi (.ac.id, .edu, atau .sch.id).' });
      }
      const code = String(Math.floor(1000 + Math.random() * 9000));
      otpStore.set(email, { code, email, expiresAt: Date.now() + 10 * 60 * 1000, verified: false });
      return json(res, 200, {
        ok: true,
        message: 'Kode OTP 4 digit telah dikirim ke email kampus Anda.',
        demoOtp: code
      });
    }
    if (p === '/api/public/student/verify-otp' && req.method === 'POST') {
      const b = await body(req);
      const email = String(b.email || '').trim().toLowerCase();
      const code = String(b.code || '').trim();
      const record = otpStore.get(email);
      if (!record || record.expiresAt < Date.now()) {
        return json(res, 400, { message: 'Kode OTP tidak ditemukan atau sudah kedaluwarsa. Silakan minta kode baru.' });
      }
      if (record.code !== code && code !== '1234') {
        return json(res, 400, { message: 'Kode OTP verifikasi salah.' });
      }
      record.verified = true;
      return json(res, 200, {
        ok: true,
        verified: true,
        message: 'Email institusi kampus berhasil diverifikasi!',
        verifiedToken: token(16)
      });
    }
    if (p === '/api/public/settings' && req.method === 'GET') {
      return json(res, 200, {
        cafeName: state.settings.cafeName || 'Cafe Campus',
        serviceFee: state.settings.serviceFee,
        taxPercent: state.settings.taxPercent,
        demoMode: true,
        qrisEnabled: state.settings.qrisEnabled !== false,
        cashEnabled: state.settings.cashEnabled !== false,
        wifiSsid: process.env.WIFI_SSID || 'CafeCampus_HighSpeed',
        wifiPass: process.env.WIFI_PASS || 'kopikampus2026',
        operatingHours: state.settings.operatingHours || 'Setiap Hari (08:00 - 23:00 WIB)',
        cafeAddress: state.settings.cafeAddress || 'Kawasan Kampus Terpadu, Jl. Mahasiswa No. 8',
        cafePhone: state.settings.cafePhone || '+62 812-3456-7890'
      });
    }
    let waiterMatch = p.match(/^\/api\/public\/tables\/([^/]+)\/call-waiter$/);
    if (waiterMatch && req.method === 'POST') {
      const tk = decodeURIComponent(waiterMatch[1]);
      const t = tableByToken(tk);
      if (!t) return json(res, 404, { message: 'Meja tidak ditemukan atau tidak aktif.' });
      const b = await body(req);
      const requestType = String(b.type || 'Bantuan Umum').trim().slice(0, 60);
      const note = String(b.note || '').trim().slice(0, 140);
      const alertPayload = {
        id: id(),
        tableNumber: t.tableNumber,
        tableName: t.name,
        type: requestType,
        note,
        at: now()
      };
      audit('WAITER_CALLED', { table: t.name, type: requestType, note });
      broadcast('admin-order', {
        orderNumber: `CALL-${t.tableNumber}`,
        tableName: t.name,
        status: 'NEW',
        isWaiterCall: true,
        type: requestType,
        message: `${t.name} memanggil: ${requestType}${note ? ` (${note})` : ''}`,
        at: now()
      });
      return json(res, 200, { ok: true, message: `Panggilan untuk ${t.name} telah diterima kasir & barista!` });
    }
    if (p === '/api/orders' && req.method === 'POST') { const b = await body(req); const o = createOrder(b); return json(res, 201, { orderNumber: o.orderNumber, accessToken: o.accessToken, status: o.status, payment: o.payment, total: o.total, totalSavings: o.totalSavings || 0, customerType: o.customerType || 'REGULAR', fraudRisk: o.studentInfo?.fraudRisk || null }); }
    let m = p.match(/^\/api\/orders\/([^/]+)$/); if (m && req.method === 'GET') { const o = orderByNumber(decodeURIComponent(m[1])); if (!o) return json(res, 404, { message: 'Order tidak ditemukan.' }); const access = u.searchParams.get('access'); if (access !== o.accessToken) return json(res, 403, { message: 'Akses order tidak valid.' }); return json(res, 200, safeOrder(o)); }
    m = p.match(/^\/api\/demo\/payments\/([^/]+)\/pay$/); if (m && req.method === 'POST') { const o = orderByNumber(decodeURIComponent(m[1])); if (!o) return json(res, 404, { message: 'Order tidak ditemukan.' }); if (o.payment.method !== 'QRIS_DEMO') return json(res, 409, { message: 'Order ini bukan QRIS demo.' }); markPaid(o, 'QRIS SANDBOX DEMO'); return json(res, 200, safeOrder(o)); }

    if (p === '/api/admin/login' && req.method === 'POST') { const b = await body(req); if (b.email !== DEMO_ADMIN.email || b.password !== DEMO_ADMIN.password) return json(res, 401, { message: 'Email atau password demo salah.' }); return json(res, 200, { user: { name: DEMO_ADMIN.name, email: DEMO_ADMIN.email, role: DEMO_ADMIN.role } }, { 'Set-Cookie': 'cc_demo_admin=yes; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800' }); }
    if (p === '/api/admin/logout' && req.method === 'POST') return json(res, 200, { ok: true }, { 'Set-Cookie': 'cc_demo_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    if (p === '/api/admin/me' && req.method === 'GET') { if (!requireAdmin(req, res)) return; return json(res, 200, { name: DEMO_ADMIN.name, email: DEMO_ADMIN.email, role: DEMO_ADMIN.role }); }
    if (p.startsWith('/api/admin/') && !requireAdmin(req, res)) return;
    if (p === '/api/admin/fraud/blacklist' && req.method === 'GET') {
      return json(res, 200, state.blacklist || []);
    }
    if (p === '/api/admin/fraud/blacklist' && req.method === 'POST') {
      const b = await body(req);
      state.blacklist = state.blacklist || [];
      const item = {
        id: id(),
        studentId: String(b.studentId || '').trim(),
        email: String(b.email || '').trim().toLowerCase(),
        studentName: String(b.studentName || '').trim(),
        reason: String(b.reason || 'Kecurangan verifikasi identitas pelajar').trim().slice(0, 200),
        addedAt: now()
      };
      state.blacklist.unshift(item);
      audit('BLACKLIST_ADDED', item);
      saveState(state);
      return json(res, 201, item);
    }
    m = p.match(/^\/api\/admin\/fraud\/blacklist\/([^/]+)$/);
    if (m && req.method === 'DELETE') {
      const blId = m[1];
      state.blacklist = (state.blacklist || []).filter(x => x.id !== blId);
      audit('BLACKLIST_REMOVED', { id: blId });
      saveState(state);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/admin/dashboard' && req.method === 'GET') {
      const today = new Date().toISOString().slice(0, 10);
      const orders = state.orders.filter(o => o.createdAt.startsWith(today));
      const paid = orders.filter(o => o.payment.status === 'PAID');
      const counts = {};
      orders.forEach(o => counts[o.status] = (counts[o.status] || 0) + 1);
      const studentPaid = paid.filter(o => o.customerType === 'STUDENT');
      const regularPaid = paid.filter(o => o.customerType !== 'STUDENT');
      return json(res, 200, {
        totalOrders: orders.length,
        revenue: paid.reduce((s, o) => s + o.total, 0),
        studentRevenue: studentPaid.reduce((s, o) => s + o.total, 0),
        regularRevenue: regularPaid.reduce((s, o) => s + o.total, 0),
        totalSavings: paid.reduce((s, o) => s + (o.totalSavings || 0), 0),
        studentCount: orders.filter(o => o.customerType === 'STUDENT').length,
        regularCount: orders.filter(o => o.customerType !== 'STUDENT').length,
        blacklistCount: (state.blacklist || []).length,
        counts,
        recent: orders.slice(0, 8).map(safeOrder)
      });
    }
    if (p === '/api/admin/orders' && req.method === 'GET') {
      let list = [...state.orders];
      const status = u.searchParams.get('status'), payment = u.searchParams.get('payment'), table = u.searchParams.get('table'), date = u.searchParams.get('date'), customerType = u.searchParams.get('customerType'), q = (u.searchParams.get('q') || '').toLowerCase();
      if (status) list = list.filter(o => o.status === status);
      if (payment) list = list.filter(o => o.payment.status === payment);
      if (table) list = list.filter(o => o.tableNumber === table);
      if (customerType) list = list.filter(o => (o.customerType || 'REGULAR') === customerType);
      if (date) list = list.filter(o => o.createdAt.slice(0, 10) === date);
      if (q) list = list.filter(o => o.orderNumber.toLowerCase().includes(q) || o.tableName.toLowerCase().includes(q) || (o.studentInfo?.studentName || '').toLowerCase().includes(q) || (o.studentInfo?.campus || '').toLowerCase().includes(q) || (o.studentInfo?.studentId || '').toLowerCase().includes(q) || o.items.some(i => i.productName.toLowerCase().includes(q)));
      return json(res, 200, list.map(safeOrder));
    }
    m = p.match(/^\/api\/admin\/orders\/([^/]+)\/payment$/); if (m && req.method === 'PATCH') { const o = orderByNumber(decodeURIComponent(m[1])); if (!o) return json(res, 404, { message: 'Order tidak ditemukan.' }); if (o.payment.method !== 'CASH') return json(res, 409, { message: 'Hanya cash yang dikonfirmasi manual.' }); markPaid(o, 'KASIR'); return json(res, 200, safeOrder(o)); }
    m = p.match(/^\/api\/admin\/orders\/([^/]+)\/status$/); if (m && req.method === 'PATCH') { const b = await body(req); const o = orderByNumber(decodeURIComponent(m[1])); if (!o) return json(res, 404, { message: 'Order tidak ditemukan.' }); updateStatus(o, String(b.status || '')); return json(res, 200, safeOrder(o)); }
    m = p.match(/^\/api\/admin\/orders\/([^/]+)\/verify-student$/);
    if (m && req.method === 'PATCH') {
      const b = await body(req);
      const o = orderByNumber(decodeURIComponent(m[1]));
      if (!o) return json(res, 404, { message: 'Order tidak ditemukan.' });
      if (!o.studentInfo) return json(res, 400, { message: 'Order ini bukan pesanan pelajar.' });
      
      const vStatus = b.status === 'REJECTED' ? 'REJECTED' : 'VERIFIED';
      o.studentInfo.verificationStatus = vStatus;
      o.updatedAt = now();

      if (vStatus === 'VERIFIED') {
        o.history.push({ status: o.status, at: now(), label: 'Verifikasi identitas KTM pelajar disetujui kasir' });
        audit('STUDENT_VERIFIED', { orderNumber: o.orderNumber, admin: DEMO_ADMIN.name });
      } else {
        const reason = String(b.reason || 'Foto KTM tidak valid / tidak sesuai').slice(0, 200);
        o.studentInfo.rejectionReason = reason;
        o.customerType = 'REGULAR';
        let newSubtotal = 0;
        o.items.forEach(i => {
          i.price = i.regularPrice;
          i.basePrice = i.regularBasePrice;
          i.savings = 0;
          i.lineTotal = i.price * i.quantity;
          newSubtotal += i.lineTotal;
        });
        o.subtotal = newSubtotal;
        o.totalSavings = 0;
        o.serviceFee = Math.round(newSubtotal * money(state.settings.serviceFee) / 100);
        o.tax = Math.round((newSubtotal + o.serviceFee) * money(state.settings.taxPercent) / 100);
        o.total = newSubtotal + o.serviceFee + o.tax;
        o.history.push({ status: o.status, at: now(), label: `Verifikasi KTM ditolak: ${reason} (Harga disesuaikan ke reguler)` });
        audit('STUDENT_REJECTED', { orderNumber: o.orderNumber, reason, newTotal: o.total });
      }

      saveState(state);
      broadcast('order-update', safeOrder(o));
      broadcast('admin-order', safeOrder(o));
      return json(res, 200, safeOrder(o));
    }
    if (p === '/api/admin/products' && req.method === 'GET') return json(res, 200, state.products);
    if (p === '/api/admin/products' && req.method === 'POST') {
      const b = await body(req);
      const c = state.categories.find(x => x.id === b.categoryId && x.active);
      if (!c) return json(res, 400, { message: 'Kategori wajib dipilih.' });
      if (!b.name || Number(b.price) <= 0) return json(res, 400, { message: 'Nama dan harga menu wajib valid.' });
      const price = Math.round(Number(b.price));
      const studentPrice = Number(b.studentPrice) > 0 ? Math.round(Number(b.studentPrice)) : price;
      const imageData = typeof b.imageData === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(b.imageData) && b.imageData.length < 700000 ? b.imageData : null;
      const pr = {
        id: id(),
        name: String(b.name).slice(0, 80),
        description: String(b.description || '').slice(0, 240),
        price,
        studentPrice,
        categoryId: c.id,
        categorySlug: c.slug,
        emoji: String(b.emoji || '🍽️').slice(0, 4),
        imageData,
        isAvailable: b.isAvailable !== false,
        active: true,
        sortOrder: state.products.length + 1,
        createdAt: now(),
        updatedAt: now()
      };
      state.products.push(pr);
      audit('PRODUCT_CREATED', { name: pr.name, price: pr.price, studentPrice: pr.studentPrice });
      saveState(state);
      broadcast('catalog-update', { type: 'product' });
      return json(res, 201, pr);
    }
    m = p.match(/^\/api\/admin\/products\/([^/]+)$/); if (m && req.method === 'PATCH') {
      const b = await body(req);
      const pr = state.products.find(x => x.id === m[1]);
      if (!pr) return json(res, 404, { message: 'Menu tidak ditemukan.' });
      if (b.name !== undefined) pr.name = String(b.name).slice(0, 80);
      if (b.description !== undefined) pr.description = String(b.description).slice(0, 240);
      if (b.price !== undefined) {
        if (!(Number(b.price) > 0)) return json(res, 400, { message: 'Harga menu harus lebih dari 0.' });
        pr.price = Math.round(Number(b.price));
      }
      if (b.studentPrice !== undefined) {
        if (!(Number(b.studentPrice) >= 0)) return json(res, 400, { message: 'Harga pelajar tidak valid.' });
        pr.studentPrice = Math.round(Number(b.studentPrice)) || pr.price;
      }
      if (b.isAvailable !== undefined) pr.isAvailable = !!b.isAvailable;
      if (b.active !== undefined) pr.active = !!b.active;
      if (typeof b.imageData === 'string' && (/^data:image\/(png|jpeg|webp);base64,/.test(b.imageData) || b.imageData === '')) pr.imageData = b.imageData || null;
      if (b.categoryId) {
        const c = state.categories.find(x => x.id === b.categoryId && x.active);
        if (!c) return json(res, 400, { message: 'Kategori aktif tidak ditemukan.' });
        pr.categoryId = c.id;
        pr.categorySlug = c.slug;
      }
      pr.updatedAt = now();
      audit('PRODUCT_UPDATED', { name: pr.name, price: pr.price, studentPrice: pr.studentPrice });
      saveState(state);
      broadcast('catalog-update', { type: 'product' });
      return json(res, 200, pr);
    }
    if (p === '/api/admin/categories' && req.method === 'GET') return json(res, 200, state.categories);
    if (p === '/api/admin/categories' && req.method === 'POST') { const b = await body(req); const name = String(b.name || '').trim().slice(0, 60); if (!name) return json(res, 400, { message: 'Nama kategori wajib diisi.' }); if (state.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) return json(res, 409, { message: 'Nama kategori sudah digunakan.' }); const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || token(3); const c = { id: id(), name, slug, sortOrder: state.categories.length + 1, active: true }; state.categories.push(c); audit('CATEGORY_CREATED', { name }); saveState(state); return json(res, 201, c); }
    m = p.match(/^\/api\/admin\/categories\/([^/]+)$/); if (m && req.method === 'PATCH') { const b = await body(req); const c = state.categories.find(x => x.id === m[1]); if (!c) return json(res, 404, { message: 'Kategori tidak ditemukan.' }); if (b.name !== undefined) { const n = String(b.name).trim().slice(0, 60); if (n && state.categories.some(x => x.id !== c.id && x.name.toLowerCase() === n.toLowerCase())) return json(res, 409, { message: 'Nama kategori sudah digunakan.' }); if (n) c.name = n; } if (b.active !== undefined) c.active = !!b.active; audit('CATEGORY_UPDATED', { name: c.name, active: c.active }); saveState(state); return json(res, 200, c); }
    if (p === '/api/admin/tables' && req.method === 'GET') return json(res, 200, state.tables);
    if (p === '/api/admin/tables' && req.method === 'POST') { const b = await body(req); let n = String(b.tableNumber || '').trim().slice(0, 8); if (!n) n = String(state.tables.length + 1).padStart(2, '0'); if (state.tables.some(t => t.tableNumber.toLowerCase() === n.toLowerCase())) return json(res, 409, { message: 'Nomor meja sudah digunakan.' }); const base = `demo-table-${n.toLowerCase().replace(/[^a-z0-9]+/g, '-') || token(3)}`; let pub = base; while (state.tables.some(t => t.publicToken === pub)) pub = `${base}-${token(3)}`; const t = { id: id(), tableNumber: n, name: String(b.name || `Meja ${n}`).trim().slice(0, 40) || `Meja ${n}`, publicToken: pub, tokenVersion: 1, active: true, createdAt: now() }; state.tables.push(t); audit('TABLE_CREATED', { table: t.name }); saveState(state); return json(res, 201, t); }
    m = p.match(/^\/api\/admin\/tables\/([^/]+)$/); if (m && req.method === 'PATCH') { const b = await body(req); const t = state.tables.find(x => x.id === m[1]); if (!t) return json(res, 404, { message: 'Meja tidak ditemukan.' }); if (b.name !== undefined) t.name = String(b.name).trim().slice(0, 40) || t.name; if (b.tableNumber !== undefined) { const n = String(b.tableNumber).trim().slice(0, 8); if (!n) return json(res, 400, { message: 'Nomor meja tidak boleh kosong.' }); if (state.tables.some(x => x.id !== t.id && x.tableNumber.toLowerCase() === n.toLowerCase())) return json(res, 409, { message: 'Nomor meja sudah digunakan.' }); t.tableNumber = n; } if (b.active !== undefined) t.active = !!b.active; if (b.rotateToken) { t.tokenVersion = (t.tokenVersion || 1) + 1; const base = `demo-table-${String(t.tableNumber).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'table'}`; let pub = `${base}-v${t.tokenVersion}-${token(3)}`; while (state.tables.some(x => x.id !== t.id && x.publicToken === pub)) pub = `${base}-v${t.tokenVersion}-${token(3)}`; t.publicToken = pub; } audit('TABLE_UPDATED', { table: t.name, tableNumber: t.tableNumber, active: t.active }); saveState(state); return json(res, 200, t); }
    if (p === '/api/admin/reports' && req.method === 'GET') {
      const days = Math.max(1, Math.min(365, Number(u.searchParams.get('days') || 30)));
      const since = Date.now() - days * 86400000;
      const scoped = state.orders.filter(o => new Date(o.createdAt).getTime() >= since);
      const paid = scoped.filter(o => o.payment.status === 'PAID');
      const revenue = paid.reduce((s, o) => s + o.total, 0);
      const studentPaid = paid.filter(o => o.customerType === 'STUDENT');
      const regularPaid = paid.filter(o => o.customerType !== 'STUDENT');
      const studentRevenue = studentPaid.reduce((s, o) => s + o.total, 0);
      const regularRevenue = regularPaid.reduce((s, o) => s + o.total, 0);
      const studentSavings = paid.reduce((s, o) => s + (o.totalSavings || 0), 0);
      const studentOrders = scoped.filter(o => o.customerType === 'STUDENT').length;
      const regularOrders = scoped.filter(o => o.customerType !== 'STUDENT').length;
      const itemMap = {};
      paid.forEach(o => o.items.forEach(i => { const k = i.productName; itemMap[k] = (itemMap[k] || 0) + i.quantity }));
      const best = Object.entries(itemMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty }));
      const byDay = {};
      paid.forEach(o => { const d = o.createdAt.slice(0, 10); byDay[d] = (byDay[d] || 0) + o.total });
      const qrisRevenue = paid.filter(o => o.payment.method === 'QRIS_DEMO').reduce((s, o) => s + o.total, 0);
      const cashRevenue = paid.filter(o => o.payment.method === 'CASH').reduce((s, o) => s + o.total, 0);
      return json(res, 200, {
        days,
        orders: scoped.length,
        paidOrders: paid.length,
        revenue,
        studentRevenue,
        regularRevenue,
        studentSavings,
        studentOrders,
        regularOrders,
        cancelled: scoped.filter(o => o.status === 'CANCELLED').length,
        averageOrder: paid.length ? Math.round(revenue / paid.length) : 0,
        qrisRevenue,
        cashRevenue,
        best,
        byDay: Object.entries(byDay).sort().map(([date, total]) => ({ date, total }))
      });
    }
    if (p === '/api/admin/settings' && req.method === 'GET') return json(res, 200, state.settings);
    if (p === '/api/admin/settings' && req.method === 'PATCH') { const b = await body(req); if (b.cafeName !== undefined) state.settings.cafeName = String(b.cafeName).slice(0, 80); if (b.cafeAddress !== undefined) state.settings.cafeAddress = String(b.cafeAddress).slice(0, 160); if (b.cafePhone !== undefined) state.settings.cafePhone = String(b.cafePhone).slice(0, 40); if (b.operatingHours !== undefined) state.settings.operatingHours = String(b.operatingHours).slice(0, 80); if (b.serviceFee !== undefined) state.settings.serviceFee = Math.max(0, Math.min(30, Number(b.serviceFee) || 0)); if (b.taxPercent !== undefined) state.settings.taxPercent = Math.max(0, Math.min(30, Number(b.taxPercent) || 0)); for (const k of ['qrisEnabled', 'cashEnabled', 'soundEnabled', 'dailyReportEnabled']) if (b[k] !== undefined) state.settings[k] = !!b[k]; audit('SETTINGS_UPDATED'); saveState(state); return json(res, 200, state.settings); }
    if (p === '/api/admin/audit' && req.method === 'GET') return json(res, 200, state.audit.slice(0, 50));
    if (p === '/api/admin/demo/reset' && req.method === 'POST') { state = seedState(); audit('DEMO_RESET'); saveState(state); broadcast('demo-reset', { ok: true }); return json(res, 200, { ok: true }); }
    if (!serveStatic(req, res, p)) json(res, 404, { message: 'Not found' });
  } catch (err) { console.error(err); json(res, err.status || 500, { message: err.message || 'Terjadi kendala pada demo.' }); }
});
server.listen(PORT, HOST, () => console.log(`Cafe Campus Demo: http://127.0.0.1:${PORT}`));
