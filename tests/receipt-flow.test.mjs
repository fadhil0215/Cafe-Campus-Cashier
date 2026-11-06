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

describe('RECEIPT FLOW: Mandatory Receipt Printing Before Kitchen Processing', () => {

    it('Verifikasi alur cetak struk wajib sebelum order diproses ke dapur/barista', async () => {
        const testPort = 4189;
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

            // 1. Login Admin
            const loginRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: 'admin@cafecampus.demo', password: 'admin123' })
            });
            assert.equal(loginRes.status, 200);
            const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];
            const { token } = await loginRes.json();
            const authHeaders = {
                'Content-Type': 'application/json',
                'Cookie': cookie,
                'Authorization': `Bearer ${token}`
            };

            // 2. Buat Pesanan Baru (Cash)
            const productsRes = await fetch(`http://127.0.0.1:${testPort}/api/public/products`);
            const products = await productsRes.json();
            const sampleProduct = products.find(p => p.isAvailable);

            const orderPayload = {
                tableToken: 'demo-table-12',
                customerType: 'REGULAR',
                items: [{ productId: sampleProduct.id, quantity: 2, note: 'Normal ice' }],
                paymentMethod: 'CASH',
                idempotencyKey: 'receipt-test-' + Date.now()
            };

            const orderRes = await fetch(`http://127.0.0.1:${testPort}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderPayload)
            });
            assert.equal(orderRes.status, 201);
            const { orderNumber } = await orderRes.json();
            assert.ok(orderNumber);

            // 3. Konfirmasi Bayar Kasir
            const payRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/orders/${orderNumber}/payment`, {
                method: 'PATCH',
                headers: authHeaders,
                body: '{}'
            });
            assert.equal(payRes.status, 200);

            // 4. Periksa endpoint receipt: status receiptPrinted harus false di awal
            const receiptRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/orders/${orderNumber}/receipt`, {
                headers: authHeaders
            });
            assert.equal(receiptRes.status, 200);
            const receiptData = await receiptRes.json();
            assert.equal(receiptData.receiptPrinted, false, 'receiptPrinted awal harus false');
            assert.equal(receiptData.orderNumber, orderNumber);
            assert.ok(Array.isArray(receiptData.items));

            // 5. Coba langsung proses ke PROCESSING dengan enforcement header x-enforce-receipt: true
            const earlyProcessRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/orders/${orderNumber}/status`, {
                method: 'PATCH',
                headers: { ...authHeaders, 'x-enforce-receipt': 'true' },
                body: JSON.stringify({ status: 'PROCESSING' })
            });
            assert.equal(earlyProcessRes.status, 409, 'Harus ditolak 409 bila struk belum dicetak');
            const earlyData = await earlyProcessRes.json();
            assert.match(earlyData.message, /Struk pesanan wajib dicetak/i);

            // 6. Cetak Struk via POST /api/admin/orders/:orderNum/print
            const printRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/orders/${orderNumber}/print`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ type: 'CUSTOMER' })
            });
            assert.equal(printRes.status, 200);
            const printData = await printRes.json();
            assert.equal(printData.ok, true);
            assert.equal(printData.receiptPrinted, true);
            assert.ok(printData.receiptPrintedAt);

            // 7. Periksa kembali endpoint receipt: receiptPrinted sekarang harus true
            const receiptRes2 = await fetch(`http://127.0.0.1:${testPort}/api/admin/orders/${orderNumber}/receipt`, {
                headers: authHeaders
            });
            const receiptData2 = await receiptRes2.json();
            assert.equal(receiptData2.receiptPrinted, true, 'receiptPrinted harus true setelah dicetak');
            assert.ok(receiptData2.receiptPrintedAt);

            // 8. Sekarang proses ke PROCESSING dengan enforcement header x-enforce-receipt: true harus SUKSES
            const processRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/orders/${orderNumber}/status`, {
                method: 'PATCH',
                headers: { ...authHeaders, 'x-enforce-receipt': 'true' },
                body: JSON.stringify({ status: 'PROCESSING' })
            });
            assert.equal(processRes.status, 200, 'Harus berhasil 200 karena struk sudah dicetak');
            const processData = await processRes.json();
            assert.equal(processData.status, 'PROCESSING');

            // 9. Periksa KDS orders endpoint memuat receiptPrinted
            const kdsRes = await fetch(`http://127.0.0.1:${testPort}/api/kds/orders`, {
                headers: authHeaders
            });
            assert.equal(kdsRes.status, 200);
            const kdsOrders = await kdsRes.json();
            const ourKdsOrder = kdsOrders.find(o => o.orderNumber === orderNumber);
            assert.ok(ourKdsOrder);
            assert.equal(ourKdsOrder.receiptPrinted, true);

            // 10. Periksa Audit Trail mencatat aktivitas PRINT_RECEIPT
            const auditRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/audit`, {
                headers: authHeaders
            });
            assert.equal(auditRes.status, 200);
            const auditLogs = await auditRes.json();
            const printLog = auditLogs.find(l => l.action === 'PRINT_RECEIPT' && (l.targetId === orderNumber || l.target_id === orderNumber));
            assert.ok(printLog, 'Audit trail harus mencatat PRINT_RECEIPT untuk order');
        } finally {
            child.kill('SIGTERM');
            await sleep(150);
        }
    });

});
