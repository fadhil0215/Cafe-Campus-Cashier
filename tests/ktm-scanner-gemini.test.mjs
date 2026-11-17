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

describe('GEMINI AI KTM SCANNER & BARISTA CHATBOT TEST SUITE', () => {

    it('1. Endpoint /api/public/scan-ktm menolak request tanpa foto (400 Bad Request)', async () => {
        const testPort = 4210;
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

            // Panggilan tanpa gambar
            const resNoImage = await fetch(`http://127.0.0.1:${testPort}/api/public/scan-ktm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            assert.equal(resNoImage.status, 400, 'Request tanpa foto KTM harus ditolak 400');
            const dataNoImage = await resNoImage.json();
            assert.equal(dataNoImage.ok, false);
            assert.ok(dataNoImage.error.includes('Foto KTM'));
        } finally {
            child.kill();
        }
    });

    it('2. Endpoint /api/public/scan-ktm memproses foto KTM & mengembalikan deskripsi lengkap mahasiswa', async () => {
        const testPort = 4211;
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

            // 1x1 transparent dummy PNG base64
            const dummyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

            const scanRes = await fetch(`http://127.0.0.1:${testPort}/api/public/scan-ktm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: dummyPng,
                    existingInfo: {
                        studentName: 'Ahmad Faiz Al-Ghifari',
                        campus: 'Institut Teknologi Bandung',
                        studentId: '13521099',
                        studyProgram: 'Teknik Informatika'
                    }
                })
            });

            assert.equal(scanRes.status, 200, 'Scan KTM harus mengembalikan 200 OK');
            const scanData = await scanRes.json();
            assert.equal(scanData.ok, true);
            assert.ok(scanData.data, 'Harus memuat data mahasiswa hasil pemindaian');
            
            const info = scanData.data;
            assert.ok(info.studentName, 'Nama mahasiswa wajib ada');
            assert.ok(info.campus, 'Nama kampus wajib ada');
            assert.ok(info.studentId, 'NIM/NPM wajib ada');
            assert.ok(info.facultyCode, 'Kode fakultas wajib terisi');
            assert.ok(info.facultyName, 'Nama fakultas wajib terisi');
            assert.ok(info.facultyColor, 'Warna tema fakultas wajib terisi');
            assert.ok(info.studyProgram, 'Program studi wajib terisi');
            assert.ok(info.email && info.email.includes('@'), 'Email institusi resmi wajib valid');
            assert.equal(info.emailVerified, true, 'Email institusi harus terverifikasi');
            assert.ok(info.confidence, 'Tingkat keyakinan OCR wajib ada');
        } finally {
            child.kill();
        }
    });

    it('3. Endpoint /api/public/scan-ktm menolak kartu non-KTM (Kartu Pelajar SMP/SMA/KTP) dengan HTTP 422', async () => {
        const testPort = 4212;
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

            // Panggilan dengan identitas bertema sekolah SMP
            const dummyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
            const scanRejectRes = await fetch(`http://127.0.0.1:${testPort}/api/public/scan-ktm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: dummyPng,
                    existingInfo: {
                        studentName: 'Fadhil Putra Santoso',
                        campus: 'SMP Negeri 3 Cibinong',
                        studentId: '5848220134',
                        studyProgram: 'Umum'
                    }
                })
            });

            assert.equal(scanRejectRes.status, 422, 'Kartu pelajar SMP harus ditolak dengan HTTP 422');
            const rejectData = await scanRejectRes.json();
            assert.equal(rejectData.ok, false);
            assert.equal(rejectData.isValidKtm, false);
            assert.ok(rejectData.message.includes('bukan') || rejectData.message.includes('sekolah') || rejectData.message.includes('Mahasiswa') || rejectData.message.includes('KTM'));
        } finally {
            child.kill();
        }
    });

    it('4. Barista AI Chatbot merespons dengan konteks menu Cafe Campus, WiFi, dan Diskon', async () => {
        const testPort = 4214;
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

            // Sapaan / Tanya rekomendasi kopi
            const chatRes = await fetch(`http://127.0.0.1:${testPort}/api/public/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: 'Halo, saya mau nugas sambil ngopi. Rekomendasi kopi yang cocok apa ya?',
                    customerType: 'STUDENT',
                    history: [
                        { role: 'user', text: 'Halo barista' },
                        { role: 'assistant', text: 'Halo! Ada yang bisa saya bantu?' }
                    ]
                })
            });

            assert.equal(chatRes.status, 200, 'Chatbot harus merespons 200 OK');
            const chatData = await chatRes.json();
            assert.equal(chatData.ok, true);
            assert.ok(chatData.reply && chatData.reply.length > 20, 'Harus ada teks jawaban dari Barista AI');
            assert.ok(Array.isArray(chatData.suggestions) && chatData.suggestions.length > 0, 'Harus ada saran pertanyaan lanjutan');
            assert.ok(Array.isArray(chatData.recommendedProducts), 'Harus ada array produk rekomendasi');
        } finally {
            child.kill();
        }
    });

    it('5. Deteksi Kunci Gemini AI: Settings status aktif & endpoint uji koneksi berfungsi', async () => {
        const testPort = 4215;
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

            // Login admin
            const loginRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: 'admin@cafecampus.demo', password: 'admin123' })
            });
            const loginData = await loginRes.json();
            const token = loginData.token;

            // Cek Settings Gemini Status
            const settingsRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/settings`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            assert.equal(settingsRes.status, 200);
            const settingsData = await settingsRes.json();
            assert.ok(settingsData.geminiStatus, 'Harus memuat object geminiStatus');
            assert.equal(settingsData.geminiStatus.active, true, 'Gemini AI wajib terdeteksi aktif');
            assert.ok(settingsData.geminiStatus.source, 'Harus mencantumkan sumber kunci (ENV/DATABASE/BUILTIN)');

            // Uji endpoint test koneksi AI
            const testAiRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/gemini/test`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({})
            });
            const testAiText = await testAiRes.text();
            if (testAiRes.status !== 200) {
                console.error('testAiRes failed:', testAiRes.status, testAiText);
            }
            assert.equal(testAiRes.status, 200, `Test koneksi AI harus mengembalikan 200 OK (got ${testAiRes.status}: ${testAiText})`);
            const testAiData = JSON.parse(testAiText);
            assert.equal(testAiData.ok, true);
            assert.ok(testAiData.latencyMs >= 0);
            assert.ok(testAiData.message.includes('Berhasil') || testAiData.message.includes('aktif'));
        } finally {
            child.kill();
        }
    });

    it('6. Verifikasi 2 Langkah: Order mahasiswa dengan foto wajah real-time tersimpan persisten & streaming via /photo/face', async () => {
        const testPort = 4216;
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

            const dummyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
            const dummyFaceJpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

            // Ambil produk untuk order
            const prodRes = await fetch(`http://127.0.0.1:${testPort}/api/public/products`);
            const prods = await prodRes.json();
            const sampleProd = prods.find(p => p.isAvailable) || prods[0];

            // Submit order dengan data mahasiswa 2-Langkah (KTM + Face Selfie)
            const orderRes = await fetch(`http://127.0.0.1:${testPort}/api/orders`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tableToken: 'demo-table-12',
                    customerType: 'STUDENT',
                    studentInfo: {
                        studentName: 'Helmi Hanatul Adam',
                        campus: 'Universitas Amikom Purwokerto',
                        studentId: '24SA11A065',
                        email: 'helmi.hanatul@uap.ac.id',
                        studentPhoto: dummyPng,
                        facePhoto: dummyFaceJpg
                    },
                    items: [{ productId: sampleProd.id, quantity: 1 }],
                    paymentMethod: 'CASH',
                    idempotencyKey: 'face-test-' + Date.now()
                })
            });

            assert.equal(orderRes.status, 201, 'Order mahasiswa dengan foto selfie harus 201 Created');
            const orderData = await orderRes.json();
            assert.ok(orderData.orderNumber);

            // 1. Ambil detail pesanan publik
            const detailRes = await fetch(`http://127.0.0.1:${testPort}/api/orders/${orderData.orderNumber}?access=${orderData.accessToken}`);
            assert.equal(detailRes.status, 200);
            const detailData = await detailRes.json();
            assert.ok(detailData.studentInfo, 'studentInfo harus ada');
            assert.ok(detailData.studentInfo.facePhoto, 'facePhoto harus ada');
            assert.ok(detailData.studentInfo.facePhoto.includes('/photo/face'), 'facePhoto harus mengarah ke endpoint streaming');

            // 2. Ambil gambar dari endpoint streaming /photo/face
            const faceStreamRes = await fetch(`http://127.0.0.1:${testPort}/api/orders/${orderData.orderNumber}/photo/face`);
            assert.equal(faceStreamRes.status, 200, 'Streaming foto wajah harus mengembalikan 200 OK');
            assert.match(faceStreamRes.headers.get('content-type') || '', /image\/jpeg|image\/png/);
            const faceBytes = await faceStreamRes.arrayBuffer();
            assert.ok(faceBytes.byteLength > 0, 'Byte foto wajah harus lebih besar dari 0');

            // 3. Login admin & pastikan data wajah muncul di daftar pesanan admin
            const loginRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: 'admin@cafecampus.demo', password: 'admin123' })
            });
            const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];
            assert.ok(cookie);

            const adminOrdersRes = await fetch(`http://127.0.0.1:${testPort}/api/admin/orders?q=${encodeURIComponent(orderData.orderNumber)}`, {
                headers: { Cookie: cookie }
            });
            assert.equal(adminOrdersRes.status, 200);
            const adminOrders = await adminOrdersRes.json();
            const matchedOrder = adminOrders.find(o => o.orderNumber === orderData.orderNumber);
            assert.ok(matchedOrder, 'Pesanan harus ditemukan di admin');
            assert.ok(matchedOrder.studentInfo?.facePhoto, 'Foto wajah harus masuk ke studentInfo pesanan admin');
            assert.ok(matchedOrder.studentInfo.facePhoto.includes('/photo/face'));
        } finally {
            child.kill();
        }
    });

});

