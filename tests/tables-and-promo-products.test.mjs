import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.mjs';

describe('Meja & Produk Baru Cafe Campus', () => {
    after(async () => {
        await pool.end().catch(() => {});
    });

    test('Semua 39 meja cafe terdaftar dan aktif dengan nomor yang sesuai', async () => {
        const [rows] = await pool.query(`
            SELECT table_number, name, public_token, is_active 
            FROM cafe_tables 
            WHERE is_active = 1
            ORDER BY 
              CASE 
                WHEN table_number LIKE 'B%' THEN 1
                WHEN table_number LIKE '10%' THEN 2
                WHEN table_number LIKE '20%' OR table_number LIKE '21%' THEN 3
                WHEN table_number LIKE '30%' THEN 4
                WHEN table_number LIKE '40%' THEN 5
                WHEN table_number LIKE 'AD%' THEN 6
                ELSE 7
              END ASC,
              table_number ASC
        `);

        const numbers = rows.map(r => r.table_number);

        // B1 - B6
        for (let i = 1; i <= 6; i++) {
            assert.ok(numbers.includes(`B${i}`), `Meja B${i} harus ada`);
        }
        // 101 - 105
        for (let i = 101; i <= 105; i++) {
            assert.ok(numbers.includes(String(i)), `Meja ${i} harus ada`);
        }
        // 201 - 210
        for (let i = 201; i <= 210; i++) {
            assert.ok(numbers.includes(String(i)), `Meja ${i} harus ada`);
        }
        // 301 - 309
        for (let i = 301; i <= 309; i++) {
            assert.ok(numbers.includes(String(i)), `Meja ${i} harus ada`);
        }
        // 401 - 404
        for (let i = 401; i <= 404; i++) {
            assert.ok(numbers.includes(String(i)), `Meja ${i} harus ada`);
        }
        // AD 1 - AD 5
        for (let i = 1; i <= 5; i++) {
            assert.ok(numbers.includes(`AD ${i}`), `Meja AD ${i} harus ada`);
        }

        assert.equal(rows.length, 39, 'Total meja aktif harus persis 39 meja');
    });

    test('5 Menu produk baru Cafe Campus terdaftar dengan data flyer yang valid', async () => {
        const [rows] = await pool.query(`
            SELECT id, name, price, student_price, image_url, sort_order, is_available 
            FROM products 
            WHERE id IN ('prod-mocca-blue', 'prod-nasgor-bp', 'prod-bekal-nugas', 'prod-nasi-kulit', 'prod-bakmi-matah')
            ORDER BY sort_order ASC
        `);

        assert.equal(rows.length, 5, 'Harus ada 5 menu baru terdaftar');

        const mocca = rows.find(r => r.id === 'prod-mocca-blue');
        assert.ok(mocca, 'Mocca Blue harus ada');
        assert.equal(Number(mocca.student_price), 16000, 'Harga pelajar Mocca Blue 16K');
        assert.equal(mocca.image_url, '/assets/mocca-blue.jpg');

        const nasgor = rows.find(r => r.id === 'prod-nasgor-bp');
        assert.ok(nasgor, 'Nasi Goreng Banyak Pikiran harus ada');
        assert.equal(Number(nasgor.student_price), 19000, 'Harga pelajar Nasi Goreng Banyak Pikiran 19K');
        assert.equal(nasgor.image_url, '/assets/nasi-goreng-banyak-pikiran.jpg');

        const bekal = rows.find(r => r.id === 'prod-bekal-nugas');
        assert.ok(bekal, 'Bekal Nugas harus ada');
        assert.equal(Number(bekal.student_price), 23000, 'Harga pelajar Bekal Nugas 23K');
        assert.equal(bekal.image_url, '/assets/bekal-nugas.jpg');

        const kulit = rows.find(r => r.id === 'prod-nasi-kulit');
        assert.ok(kulit, 'Nasi Kulit Daun Jeruk harus ada');
        assert.equal(Number(kulit.student_price), 20000, 'Harga pelajar Nasi Kulit Daun Jeruk 20K');
        assert.equal(kulit.image_url, '/assets/nasi-kulit-daun-jeruk.jpg');

        const bakmi = rows.find(r => r.id === 'prod-bakmi-matah');
        assert.ok(bakmi, 'Bakmi Goreng Sambal Matah harus ada');
        assert.equal(Number(bakmi.student_price), 23000, 'Harga pelajar Bakmi Goreng Sambal Matah 23K');
        assert.equal(bakmi.image_url, '/assets/bakmi-goreng-sambal-matah.jpg');
    });
});
