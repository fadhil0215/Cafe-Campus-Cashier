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

describe('QRIS ANTI-FRAUD & MERCHANT STANDARDS TEST SUITE', () => {

    it('1. GET /api/public/merchant-qris & /qr/merchant-qris.svg', async () => {
        const testPort = 4231;
        const child = spawn(process.execPath, ['server.mjs'], {
            cwd: rootDir,
            env: { ...process.env, PORT: String(testPort), HOST: '127.0.0.1', APP_MODE: 'demo' },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        try {
            await waitForServer(`http://127.0.0.1:${testPort}/api/health`);

            // Verify merchant qris metadata
            const resMeta = await fetch(`http://127.0.0.1:${testPort}/api/public/merchant-qris`);
            assert.equal(resMeta.status, 200);
            const dataMeta = await resMeta.json();
            assert.equal(dataMeta.merchantName, 'WISATA NIAGA CAMPUS');
            assert.equal(dataMeta.nmid, 'ID2024361872201');
            assert.equal(dataMeta.acquirer, 'bale by btn');
            assert.ok(dataMeta.qrPayload.startsWith('00020101021126650013ID.CO.BTN.WWW'));

            // Verify SVG QR code
            const resSvg = await fetch(`http://127.0.0.1:${testPort}/qr/merchant-qris.svg`);
            assert.equal(resSvg.status, 200);
            const svgText = await resSvg.text();
            assert.ok(svgText.includes('<svg'));

            // Verify public settings include merchantQris
            const resSettings = await fetch(`http://127.0.0.1:${testPort}/api/public/settings`);
            assert.equal(resSettings.status, 200);
            const settingsData = await resSettings.json();
            assert.ok(settingsData.merchantQris);
            assert.equal(settingsData.merchantQris.merchantName, 'WISATA NIAGA CAMPUS');
        } finally {
            child.kill();
        }
    });

    it('2. Checkout dengan QRIS menghasilkan kode unik 3 digit & grand total akurat', async () => {
        const testPort = 4232;
        const child = spawn(process.execPath, ['server.mjs'], {
            cwd: rootDir,
            env: { ...process.env, PORT: String(testPort), HOST: '127.0.0.1', APP_MODE: 'demo' },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        try {
            await waitForServer(`http://127.0.0.1:${testPort}/api/health`);

            const prodsRes = await fetch(`http://127.0.0.1:${testPort}/api/public/products`);
            const prods = await prodsRes.json();
            const availableProd = prods.find(p => !p.isSoldOut && p.price > 0);
            assert.ok(availableProd);

            const checkoutRes = await fetch(`http://127.0.0.1:${testPort}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tableToken: 'demo-table-01',
                    customerType: 'REGULAR',
                    paymentMethod: 'QRIS',
                    items: [{ productId: availableProd.id, quantity: 1, options: {} }]
                })
            });

            assert.equal(checkoutRes.status, 201);
            const order = await checkoutRes.json();
            assert.ok(order.orderNumber);
            assert.ok(order.accessToken);
            assert.equal(order.payment?.method, 'QRIS');
            assert.ok(order.uniqueCode >= 100 && order.uniqueCode <= 999);
            assert.ok(order.total > availableProd.price);

            // Fetch order status and check payment object
            const ordRes = await fetch(`http://127.0.0.1:${testPort}/api/orders/${order.orderNumber}?access=${order.accessToken}`);
            assert.equal(ordRes.status, 200);
            const ordData = await ordRes.json();
            assert.ok(ordData.payment);
            assert.equal(ordData.payment.method, 'QRIS');
            assert.equal(ordData.payment.uniqueCode, order.uniqueCode);
            assert.equal(ordData.payment.status, 'PENDING');
            assert.equal(ordData.payment.proofUrl, null);
        } finally {
            child.kill();
        }
    });

});
