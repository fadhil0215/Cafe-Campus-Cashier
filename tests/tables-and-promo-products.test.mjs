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

    test('12 Menu produk baru Cafe Campus terdaftar dengan data flyer yang valid', async () => {
        const [rows] = await pool.query(`
            SELECT id, name, price, student_price, image_url, sort_order, is_available 
            FROM products 
            WHERE id IN (
                'prod-mocca-blue', 'prod-spanish-latte', 'prod-oat-latte', 'prod-ubee-latte',
                'prod-nasgor-bp', 'prod-bekal-nugas', 'prod-nasi-kulit', 'prod-bakmi-matah',
                'prod-burger-classic', 'prod-burger-cheesy', 'prod-toast-butter', 'prod-toast-moo'
            )
            ORDER BY sort_order ASC
        `);

        assert.equal(rows.length, 12, 'Harus ada 12 menu promo baru terdaftar');

        const spanish = rows.find(r => r.id === 'prod-spanish-latte');
        assert.ok(spanish, 'Spanish Latte harus ada');
        assert.equal(Number(spanish.student_price), 16000, 'Harga pelajar Spanish Latte 16K');
        assert.equal(spanish.image_url, '/assets/spanish-latte.jpg');

        const oat = rows.find(r => r.id === 'prod-oat-latte');
        assert.ok(oat, 'Oat Latte harus ada');
        assert.equal(Number(oat.student_price), 16000, 'Harga pelajar Oat Latte 16K');
        assert.equal(oat.image_url, '/assets/oat-latte.jpg');

        const ubee = rows.find(r => r.id === 'prod-ubee-latte');
        assert.ok(ubee, 'Ubee Latte harus ada');
        assert.equal(Number(ubee.student_price), 16000, 'Harga pelajar Ubee Latte 16K');
        assert.equal(ubee.image_url, '/assets/ubee-latte.jpg');

        const classicBurger = rows.find(r => r.id === 'prod-burger-classic');
        assert.ok(classicBurger, 'Classic Campus Burger harus ada');
        assert.equal(Number(classicBurger.student_price), 16000, 'Harga pelajar Classic Campus Burger 16K');

        const cheesyBurger = rows.find(r => r.id === 'prod-burger-cheesy');
        assert.ok(cheesyBurger, 'Cheesy Campus Burger harus ada');
        assert.equal(Number(cheesyBurger.student_price), 18000, 'Harga pelajar Cheesy Campus Burger 18K');

        const butterToast = rows.find(r => r.id === 'prod-toast-butter');
        assert.ok(butterToast, 'Butter Boom Toast harus ada');
        assert.equal(Number(butterToast.student_price), 15000, 'Harga pelajar Butter Boom Toast 15K');

        const mooToast = rows.find(r => r.id === 'prod-toast-moo');
        assert.ok(mooToast, 'Moo Toast harus ada');
        assert.equal(Number(mooToast.student_price), 15000, 'Harga pelajar Moo Toast 15K');
    });

    test('Semua 65 menu produk resmi terdaftar aktif dan menu lama dinonaktifkan', async () => {
        const [activeRows] = await pool.query('SELECT id, name FROM products WHERE is_active = 1');
        assert.equal(activeRows.length, 65, 'Harus persis 65 menu resmi Cafe Campus yang aktif');

        const [inactiveRows] = await pool.query("SELECT id, name, is_active FROM products WHERE id IN ('prod-1','prod-2','prod-3','prod-4','prod-5','prod-6','prod-7','prod-8','prod-9','prod-10','prod-cig-1','prod-cig-2')");
        for (const row of inactiveRows) {
            assert.equal(row.is_active, 0, `Produk lama ${row.id} (${row.name}) harus dinonaktifkan`);
        }
    });
});
