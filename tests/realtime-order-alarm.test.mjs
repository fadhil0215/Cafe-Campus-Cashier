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

describe('REALTIME & ALARM FIXES: Kasir Realtime Orders & Audio Broadcast', () => {

    it('1. Admin login mengembalikan token di JSON response untuk fallback authorization header & SSE query token', async () => {
        const testPort = 4185;
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

            // Login
            const loginRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: 'admin@cafecampus.demo', password: 'admin123' })
            });
            assert.equal(loginRes.status, 200);
            const loginData = await loginRes.json();
            assert.ok(loginData.token, 'Response login harus menyertakan token JWT');

            // 2. Akses SSE /api/events dengan token query param tanpa cookie harus sukses (200 OK)
            const sseWithTokenRes = await fetch(`http://127.0.0.1:${testPort}/api/events?channel=admin&token=${encodeURIComponent(loginData.token)}`);
            assert.equal(sseWithTokenRes.status, 200, 'SSE dengan query token harus 200 OK');
            assert.equal(sseWithTokenRes.headers.get('content-type'), 'text/event-stream');

            // 3. Akses Polling /api/events/poll dengan token query param harus sukses (200 OK)
            const pollWithTokenRes = await fetch(`http://127.0.0.1:${testPort}/api/events/poll?channel=admin&since=0&token=${encodeURIComponent(loginData.token)}`);
            assert.equal(pollWithTokenRes.status, 200, 'Poll dengan query token harus 200 OK');
            const pollData = await pollWithTokenRes.json();
            assert.equal(pollData.ok, true);
            assert.ok(Array.isArray(pollData.events));
        } finally {
            child.kill('SIGTERM');
            await sleep(200);
        }
    });

    it('2. Saat customer selesai memesan, event admin-order harus langsung diterima di polling/stream kasir', async () => {
        const testPort = 4186;
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

            // Login kasir
            const loginRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: 'admin@cafecampus.demo', password: 'admin123' })
            });
            const loginData = await loginRes.json();
            const cookie = loginRes.headers.get('set-cookie');

            // Cek cursor sebelum order
            const pollBefore = await fetch(`http://127.0.0.1:${testPort}/api/events/poll?channel=admin&since=0`, {
                headers: { Cookie: cookie }
            });
            const beforeData = await pollBefore.json();
            const cursorBefore = beforeData.cursor || 0;

            // Ambil produk yang tersedia
            const prodRes = await fetch(`http://127.0.0.1:${testPort}/api/public/products`);
            const prods = await prodRes.json();
            const avail = prods.find(p => p.isAvailable);

            // Customer memesan di Meja 01
            const orderPayload = {
                tableToken: 'demo-table-01',
                customerType: 'REGULAR',
                paymentMethod: 'CASH',
                items: [{ productId: avail.id, quantity: 1 }],
                idempotencyKey: 'rt-test-' + Date.now()
            };

            const orderRes = await fetch(`http://127.0.0.1:${testPort}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderPayload)
            });
            assert.equal(orderRes.status, 201, 'Order customer harus berhasil dibuat');
            const createdOrder = await orderRes.json();

            // Polling event setelah order dibuat
            const pollAfter = await fetch(`http://127.0.0.1:${testPort}/api/events/poll?channel=admin&since=${cursorBefore}`, {
                headers: { Cookie: cookie }
            });
            assert.equal(pollAfter.status, 200);
            const afterData = await pollAfter.json();

            const adminOrderEvent = afterData.events.find(e => e.event === 'admin-order' && e.data?.orderNumber === createdOrder.orderNumber);
            assert.ok(adminOrderEvent, 'Event admin-order untuk pesanan baru harus ada di polling kasir');
            assert.equal(adminOrderEvent.data.tableName, 'Meja 01');
            assert.equal(adminOrderEvent.data.status, 'NEW');
        } finally {
            child.kill('SIGTERM');
            await sleep(200);
        }
    });

    it('3. Alarm kasir HANYA berbunyi saat pesanan baru (NEW) dan pembayaran lunas (payment-update), BUKAN saat panggilan pelayan atau status dapur', async () => {
        const testPort = 4187;
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

            const loginRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: 'admin@cafecampus.demo', password: 'admin123' })
            });
            const cookie = loginRes.headers.get('set-cookie');

            // 1. Dapatkan baseline cursor
            const pollBase = await fetch(`http://127.0.0.1:${testPort}/api/events/poll?channel=admin&since=0`, {
                headers: { Cookie: cookie }
            });
            const baseData = await pollBase.json();
            let curCursor = baseData.cursor || 0;

            // 2. Buat pesanan baru QRIS
            const prodRes = await fetch(`http://127.0.0.1:${testPort}/api/public/products`);
            const prods = await prodRes.json();
            const avail = prods.find(p => p.isAvailable);

            const orderRes = await fetch(`http://127.0.0.1:${testPort}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tableToken: 'demo-table-01',
                    customerType: 'REGULAR',
                    paymentMethod: 'QRIS_DEMO',
                    items: [{ productId: avail.id, quantity: 1 }],
                    idempotencyKey: 'rt-pay-alarm-' + Date.now()
                })
            });
            assert.equal(orderRes.status, 201);
            const ord = await orderRes.json();

            // Polling cek event order baru
            const pollNew = await fetch(`http://127.0.0.1:${testPort}/api/events/poll?channel=admin&since=${curCursor}`, {
                headers: { Cookie: cookie }
            });
            const newEvts = await pollNew.json();
            curCursor = newEvts.cursor;
            const newOrderEvt = newEvts.events.find(e => e.event === 'admin-order' && e.data?.orderNumber === ord.orderNumber);
            assert.ok(newOrderEvt, 'Event admin-order harus diterima');
            assert.equal(newOrderEvt.data.status, 'NEW');
            assert.equal(newOrderEvt.data.isWaiterCall, undefined);

            // 3. Panggilan Pelayan (call-waiter)
            const waiterRes = await fetch(`http://127.0.0.1:${testPort}/api/public/tables/demo-table-01/call-waiter`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'Bantuan Pembayaran', note: 'Minta struk' })
            });
            assert.equal(waiterRes.status, 200);

            const pollWaiter = await fetch(`http://127.0.0.1:${testPort}/api/events/poll?channel=admin&since=${curCursor}`, {
                headers: { Cookie: cookie }
            });
            const waiterEvts = await pollWaiter.json();
            curCursor = waiterEvts.cursor;
            const waiterEvt = waiterEvts.events.find(e => e.data?.isWaiterCall === true);
            assert.ok(waiterEvt, 'Event panggilan pelayan memiliki flag isWaiterCall=true');

            // 4. Selesai Pembayaran (Simulasi QRIS / notifyPaidOrder)
            const payRes = await fetch(`http://127.0.0.1:${testPort}/api/demo/payments/${ord.orderNumber}/pay`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accessToken: ord.accessToken })
            });
            assert.equal(payRes.status, 200);

            const pollPay = await fetch(`http://127.0.0.1:${testPort}/api/events/poll?channel=admin&since=${curCursor}`, {
                headers: { Cookie: cookie }
            });
            const payEvts = await pollPay.json();
            curCursor = payEvts.cursor;
            const payEvt = payEvts.events.find(e => e.data?.orderNumber === ord.orderNumber && e.data?._eventType === 'payment-update');
            assert.ok(payEvt, 'Event payment-update harus diterima dengan paid=true');
            assert.equal(payEvt.data.paid, true);

            // 5. Update Status Dapur ke PROCESSING
            const statusRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/orders/${ord.orderNumber}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Cookie: cookie },
                body: JSON.stringify({ status: 'PROCESSING' })
            });
            assert.equal(statusRes.status, 200);

            const pollKitchen = await fetch(`http://127.0.0.1:${testPort}/api/events/poll?channel=admin&since=${curCursor}`, {
                headers: { Cookie: cookie }
            });
            const kitchenEvts = await pollKitchen.json();
            const orderUpdateEvt = kitchenEvts.events.find(e => e.event === 'order-update' && e.data?.orderNumber === ord.orderNumber);
            assert.ok(orderUpdateEvt, 'Status dapur mengirimkan order-update/kitchen-order, bukan event admin-order baru');
        } finally {
            child.kill('SIGTERM');
            await sleep(200);
        }
    });

});

