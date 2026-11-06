import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

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

describe('FASE 0: Persiapan dan Environment Mode', () => {

    it('1. .env.example memuat SEMUA variabel yang diwajibkan spesifikasi', () => {
        const envExamplePath = path.join(rootDir, '.env.example');
        assert.ok(fs.existsSync(envExamplePath), '.env.example harus ada');
        const content = fs.readFileSync(envExamplePath, 'utf8');

        const requiredVars = [
            'APP_MODE',
            'PORT',
            'HOST',
            'NODE_ENV',
            'APP_URL',
            'ALLOWED_ORIGINS',
            'JWT_SECRET',
            'DB_HOST',
            'DB_PORT',
            'DB_USER',
            'DB_NAME',
            'DB_SSL',
            'DATABASE_URL',
            'MIDTRANS_IS_PRODUCTION',
            'MIDTRANS_SERVER_KEY',
            'MIDTRANS_CLIENT_KEY',
            'VAPID_PUBLIC_KEY',
            'VAPID_PRIVATE_KEY',
            'VAPID_EMAIL',
            'STUDENT_DAILY_LIMIT',
            'QRIS_EXPIRY_MINUTES'
        ];

        for (const v of requiredVars) {
            const regex = new RegExp(`^#?\\s*${v}\\s*=`, 'm');
            assert.ok(
                regex.test(content),
                `Variabel ${v} wajib ada di .env.example`
            );
        }

        // Cek juga salah satu password db
        const hasDbPass = /^#?\s*DB_PASSWORD\s*=/m.test(content) || /^#?\s*DB_PASS\s*=/m.test(content);
        assert.ok(hasDbPass, 'DB_PASSWORD atau DB_PASS harus ada di .env.example');
    });

    it('2. Default APP_MODE adalah production saat variabel tidak diset', async () => {
        const testPort = 4191;
        const child = spawn(process.execPath, ['server.mjs'], {
            cwd: rootDir,
            env: {
                ...process.env,
                PORT: String(testPort),
                HOST: '127.0.0.1',
                APP_MODE: '' // dikosongkan agar memicu default
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdoutLog = '';
        child.stdout.on('data', d => { stdoutLog += d.toString(); });

        try {
            await waitForServer(`http://127.0.0.1:${testPort}/api/health`);
            const res = await fetch(`http://127.0.0.1:${testPort}/api/public/settings`);
            assert.equal(res.status, 200);
            const data = await res.json();

            assert.equal(data.appMode, 'production', 'appMode harus "production" secara default');
            assert.equal(data.demoMode, false, 'demoMode harus false saat di production');
            assert.match(stdoutLog, /Mode Aplikasi:\s+PRODUCTION/i, 'Startup log harus menampilkan PRODUCTION');
        } finally {
            child.kill('SIGTERM');
            await sleep(200);
        }
    });

    it('3. APP_MODE=demo mengaktifkan mode demo dan mencerminkannya di response & log', async () => {
        const testPort = 4192;
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

        let stdoutLog = '';
        child.stdout.on('data', d => { stdoutLog += d.toString(); });

        try {
            await waitForServer(`http://127.0.0.1:${testPort}/api/health`);
            const res = await fetch(`http://127.0.0.1:${testPort}/api/public/settings`);
            assert.equal(res.status, 200);
            const data = await res.json();

            assert.equal(data.appMode, 'demo', 'appMode harus "demo" saat APP_MODE=demo');
            assert.equal(data.demoMode, true, 'demoMode harus true saat APP_MODE=demo');
            assert.match(stdoutLog, /Mode Aplikasi:\s+DEMO/i, 'Startup log harus menampilkan DEMO');
        } finally {
            child.kill('SIGTERM');
            await sleep(200);
        }
    });

});

