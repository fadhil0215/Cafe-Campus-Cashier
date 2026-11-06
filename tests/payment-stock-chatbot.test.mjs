import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForServer(url, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.ok) return true;
        } catch {}
        await sleep(150);
    }
    throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`);
}

describe('PAYMENT, STOCK VALIDATION & BARISTA AI CHATBOT TEST SUITE', () => {

    it('1. Validasi Stok: Menu yang habis / sold-out diblokir dari checkout (409 Conflict)', async () => {
        const testPort = 4197;
        const child = spawn(process.execPath, ['server.mjs'], {
            cwd: rootDir,
            env: {
                ...process.env,
                PORT: String(testPort),
                HOST: '127.0.0.1',
                APP_MODE: 'demo'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        try {
            await waitForServer(`http://127.0.0.1:${testPort}/api/health`);

            // Ambil daftar produk
            const prodsRes = await fetch(`http://127.0.0.1:${testPort}/api/public/products`);
            assert.equal(prodsRes.status, 200);
            const prods = await prodsRes.json();
            assert.ok(prods.length > 0);

            // Cari produk yang sudah sold-out dari seed (misal prod-5 Double Espresso)
            let soldOutItem = prods.find(p => p.isAvailable === false);
            if (!soldOutItem) {
                const loginRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: 'admin@cafecampus.demo', password: 'admin123' })
                });
                const loginData = await loginRes.json();
                await fetch(`http://127.0.0.1:${testPort}/api/admin/products/prod-5`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${loginData.token}`
                    },
                    body: JSON.stringify({ isAvailable: false })
                });
                soldOutItem = { id: 'prod-5', name: 'Double Espresso' };
            }

            // Coba checkout item yang habis: WAJIB ditolak dengan status 409 Conflict
            const orderRes = await fetch(`http://127.0.0.1:${testPort}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tableToken: 'demo-table-01',
                    customerType: 'REGULAR',
                    paymentMethod: 'CASH',
                    items: [{ productId: soldOutItem.id, quantity: 1 }]
                })
            });

            assert.equal(orderRes.status, 409, 'Checkout item yang habis harus mengembalikan 409 Conflict');
            const errBody = await orderRes.json();
            assert.ok(errBody.message.includes('habis') || errBody.message.includes('sold out'));
        } finally {
            child.kill();
        }
    });

    it('2. Simulasi Pembayaran & Konfirmasi Kasir: QRIS Demo & Cashier Payment', async () => {
        const testPort = 4198;
        const child = spawn(process.execPath, ['server.mjs'], {
            cwd: rootDir,
            env: {
                ...process.env,
                PORT: String(testPort),
                HOST: '127.0.0.1',
                APP_MODE: 'demo'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        try {
            await waitForServer(`http://127.0.0.1:${testPort}/api/health`);

            // Buat pesanan dengan metode QRIS_DEMO
            const orderQrisRes = await fetch(`http://127.0.0.1:${testPort}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tableToken: 'demo-table-01',
                    customerType: 'REGULAR',
                    paymentMethod: 'QRIS_DEMO',
                    items: [{ productId: 'prod-1', quantity: 1 }]
                })
            });
            assert.equal(orderQrisRes.status, 201);
            const qrisOrder = await orderQrisRes.json();
            assert.equal(qrisOrder.payment.status, 'PENDING');

            // Simulasikan pembayaran QRIS via /api/demo/payments/:orderNum/pay
            const simPayRes = await fetch(`http://127.0.0.1:${testPort}/api/demo/payments/${qrisOrder.orderNumber}/pay`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accessToken: qrisOrder.accessToken })
            });
            assert.equal(simPayRes.status, 200, 'Simulasi pembayaran QRIS demo harus sukses 200 OK');
            const simPayData = await simPayRes.json();
            assert.equal(simPayData.payment.status, 'PAID');

            // Buat pesanan CASH
            const orderCashRes = await fetch(`http://127.0.0.1:${testPort}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tableToken: 'demo-table-01',
                    customerType: 'REGULAR',
                    paymentMethod: 'CASH',
                    items: [{ productId: 'prod-1', quantity: 1 }]
                })
            });
            assert.equal(orderCashRes.status, 201);
            const cashOrder = await orderCashRes.json();

            // Simulasi pembayaran demo TIDAK boleh meloloskan pesanan CASH (wajib ditolak 400)
            const failCashDemoRes = await fetch(`http://127.0.0.1:${testPort}/api/demo/payments/${cashOrder.orderNumber}/pay`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accessToken: cashOrder.accessToken })
            });
            assert.equal(failCashDemoRes.status, 400, 'Simulasi QRIS demo tidak boleh melunasi pesanan CASH');

            // Login admin / kasir
            const loginRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: 'admin@cafecampus.demo', password: 'admin123' })
            });
            const loginData = await loginRes.json();
            const token = loginData.token;

            // Kasir mengonfirmasi pembayaran lunas via PATCH /api/admin/orders/:orderNum/payment
            const confirmRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/orders/${cashOrder.orderNumber}/payment`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({})
            });
            assert.equal(confirmRes.status, 200, 'Kasir harus dapat melunasi pesanan tunai');
            const confirmData = await confirmRes.json();
            assert.equal(confirmData.payment.status, 'PAID');
        } finally {
            child.kill();
        }
    });

    it('3. Barista AI Chatbot: Respon Cerdas, Info Wi-Fi, Fasilitas & Rekomendasi Menu', async () => {
        const testPort = 4199;
        const child = spawn(process.execPath, ['server.mjs'], {
            cwd: rootDir,
            env: {
                ...process.env,
                PORT: String(testPort),
                HOST: '127.0.0.1',
                APP_MODE: 'demo'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        try {
            await waitForServer(`http://127.0.0.1:${testPort}/api/health`);

            // Sapaan awal (pesan kosong)
            const greetingRes = await fetch(`http://127.0.0.1:${testPort}/api/public/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: '' })
            });
            assert.equal(greetingRes.status, 200);
            const greetingData = await greetingRes.json();
            assert.ok(greetingData.reply.includes('Barista AI'));
            assert.ok(Array.isArray(greetingData.suggestions));

            // Tanya Wi-Fi
            const wifiRes = await fetch(`http://127.0.0.1:${testPort}/api/public/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'sandi wifi cafe campus apa ya?' })
            });
            assert.equal(wifiRes.status, 200);
            const wifiData = await wifiRes.json();
            assert.ok(wifiData.reply.includes('CafeCampus_FreeWiFi'), 'Chatbot harus memberikan SSID Wi-Fi');
            assert.ok(wifiData.reply.includes('kopikampus2026'), 'Chatbot harus memberikan password Wi-Fi');

            // Tanya Rekomendasi Kopi Manis
            const coffeeRes = await fetch(`http://127.0.0.1:${testPort}/api/public/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'rekomendasi kopi yang manis dan creamy' })
            });
            assert.equal(coffeeRes.status, 200);
            const coffeeData = await coffeeRes.json();
            assert.ok(coffeeData.reply.toLowerCase().includes('latte') || coffeeData.reply.toLowerCase().includes('aren'));
            assert.ok(Array.isArray(coffeeData.recommendedProducts) && coffeeData.recommendedProducts.length > 0, 'Harus mengembalikan produk rekomendasi terstruktur');
            assert.ok(coffeeData.recommendedProducts[0].price > 0, 'Produk rekomendasi harus memiliki harga');

            // Tanya Jam Buka
            const hoursRes = await fetch(`http://127.0.0.1:${testPort}/api/public/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'buka jam berapa dan tutup jam berapa?' })
            });
            assert.equal(hoursRes.status, 200);
            const hoursData = await hoursRes.json();
            assert.ok(hoursData.reply.includes('08:00') && hoursData.reply.includes('23:00'));

            // Tanya Colokan Listrik / Nugas
            const plugRes = await fetch(`http://127.0.0.1:${testPort}/api/public/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'ada colokan listrik buat laptop gak?' })
            });
            assert.equal(plugRes.status, 200);
            const plugData = await plugRes.json();
            assert.ok(plugData.reply.toLowerCase().includes('stopkontak') || plugData.reply.toLowerCase().includes('colokan'));

            // Tanya Diskon Mahasiswa
            const studRes = await fetch(`http://127.0.0.1:${testPort}/api/public/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'gimana cara dapat diskon mahasiswa?' })
            });
            assert.equal(studRes.status, 200);
            const studData = await studRes.json();
            assert.ok(studData.reply.toLowerCase().includes('pelajar') || studData.reply.toLowerCase().includes('ktm'));
        } finally {
            child.kill();
        }
    });

});
