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

    it('3. Barista AI Chatbot merespons dengan konteks menu Cafe Campus, WiFi, dan Diskon', async () => {
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

});

