import pool from './config/db.mjs';

async function migrate() {
    console.log('🚀 Menjalankan migrasi database v7...');
    const conn = await pool.getConnection();

    try {
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');

        // 1. Faculties Table
        await conn.query(`
            CREATE TABLE IF NOT EXISTS faculties (
                id VARCHAR(50) NOT NULL PRIMARY KEY,
                code VARCHAR(20) NOT NULL UNIQUE,
                name VARCHAR(150) NOT NULL,
                color VARCHAR(20) NOT NULL DEFAULT '#1e3a8a',
                secondary_color VARCHAR(20) NOT NULL DEFAULT '#f1f5f9',
                icon VARCHAR(50) DEFAULT 'academic-cap',
                is_active TINYINT(1) DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const faculties = [
            ['fac-ft', 'FT', 'Fakultas Teknik', '#1e3a8a', '#dbeafe', 'tool', 1],
            ['fac-fk', 'FK', 'Fakultas Kedokteran', '#065f46', '#d1fae5', 'heart', 1],
            ['fac-feb', 'FEB', 'Fakultas Ekonomi dan Bisnis', '#b45309', '#fef3c7', 'trending-up', 1],
            ['fac-fh', 'FH', 'Fakultas Hukum', '#991b1b', '#fee2e2', 'scale', 1],
            ['fac-cs', 'FASILKOM', 'Fakultas Ilmu Komputer', '#6b21a8', '#f3e8ff', 'cpu', 1],
            ['fac-mipa', 'FMIPA', 'Fakultas Matematika & IPA', '#0e7490', '#cffafe', 'atom', 1],
            ['fac-fisip', 'FISIP', 'Fakultas Ilmu Sosial & Politik', '#c2410c', '#ffedd5', 'users', 1],
            ['fac-fib', 'FIB', 'Fakultas Ilmu Pengetahuan Budaya', '#0f766e', '#ccfbf1', 'book-open', 1],
            ['fac-fpsi', 'FPSI', 'Fakultas Psikologi', '#be185d', '#fce7f3', 'smile', 1]
        ];

        for (const [id, code, name, color, secondary_color, icon, is_active] of faculties) {
            await conn.query(`
                INSERT INTO faculties (id, code, name, color, secondary_color, icon, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE name=VALUES(name), color=VALUES(color), secondary_color=VALUES(secondary_color)
            `, [id, code, name, color, secondary_color, icon, is_active]);
        }
        console.log('✅ Master Fakultas siap');

        // 2. Categories Alterations & Tobacco Category
        const [catCols] = await conn.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'kitchen_type'");
        if (!catCols.length) {
            await conn.query("ALTER TABLE categories ADD COLUMN kitchen_type ENUM('DRINK','FOOD') NOT NULL DEFAULT 'DRINK'");
        }
        const [catTob] = await conn.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'is_tobacco'");
        if (!catTob.length) {
            await conn.query("ALTER TABLE categories ADD COLUMN is_tobacco TINYINT(1) DEFAULT 0");
        }

        await conn.query(`
            INSERT INTO categories (id, name, slug, sort_order, is_active, kitchen_type, is_tobacco)
            VALUES ('cat-rokok', 'Rokok & Tembakau (21+)', 'rokok', 6, 1, 'DRINK', 1)
            ON DUPLICATE KEY UPDATE name=VALUES(name), is_tobacco=1
        `);
        await conn.query("UPDATE categories SET kitchen_type = 'FOOD' WHERE slug IN ('makanan', 'snack', 'dessert')");
        await conn.query("UPDATE categories SET kitchen_type = 'DRINK' WHERE slug IN ('kopi', 'non-kopi')");
        console.log('✅ Kategori Rokok & kitchen_type siap');

        // 3. Products Alterations & Tobacco Products
        const [prodTob] = await conn.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'is_tobacco'");
        if (!prodTob.length) {
            await conn.query("ALTER TABLE products ADD COLUMN is_tobacco TINYINT(1) DEFAULT 0");
        }

        const tobaccoProducts = [
            ['prod-cig-1', 'cat-rokok', 'Marlboro Filter Black', 'Rokok filter premium (Khusus usia 21+ tahun, tanpa diskon mahasiswa).', 42000.00, 42000.00, '🚬', '/assets/croissant.jpg', 1, 0, 11, 1, 1],
            ['prod-cig-2', 'cat-rokok', 'Esse Change Grape', 'Rokok mild kapsul rasa anggur (Khusus usia 21+ tahun, tanpa diskon mahasiswa).', 40000.00, 40000.00, '🚬', '/assets/croissant.jpg', 1, 0, 12, 1, 1]
        ];
        for (const [id, category_id, name, description, price, student_price, emoji, image_url, is_available, customizable, sort_order, is_active, is_tobacco] of tobaccoProducts) {
            await conn.query(`
                INSERT INTO products (id, category_id, name, description, price, student_price, emoji, image_url, is_available, customizable, sort_order, is_active, is_tobacco)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE price=VALUES(price), student_price=VALUES(price), is_tobacco=1
            `, [id, category_id, name, description, price, student_price, emoji, image_url, is_available, customizable, sort_order, is_active, is_tobacco]);
        }
        console.log('✅ Master Produk Rokok siap');

        // Safe upgrade: never drop live inventory tables or their data.
        // 4. Raw Materials & Recipes (Inventory)
        await conn.query(`
            CREATE TABLE IF NOT EXISTS raw_materials (
                id VARCHAR(50) NOT NULL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                sku VARCHAR(50) NOT NULL UNIQUE,
                unit VARCHAR(20) NOT NULL DEFAULT 'gram',
                current_stock DECIMAL(12,2) NOT NULL DEFAULT '0.00',
                minimum_stock DECIMAL(12,2) NOT NULL DEFAULT '5.00',
                cost_per_unit DECIMAL(10,2) NOT NULL DEFAULT '0.00',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const rawMaterials = [
            ['mat-coffee-bean', 'Biji Kopi Arabika House Blend', 'MAT-COFFEE', 'gram', 2500.00, 500.00, 250.00],
            ['mat-fresh-milk', 'Susu Segar Pasteurisasi', 'MAT-MILK', 'ml', 10000.00, 2000.00, 18.00],
            ['mat-aren-sugar', 'Sirup Gula Aren Asli', 'MAT-AREN', 'ml', 3000.00, 500.00, 40.00],
            ['mat-matcha-powder', 'Bubuk Uji Matcha Jepang', 'MAT-MATCHA', 'gram', 1500.00, 300.00, 350.00],
            ['mat-croissant-dough', 'Frozen Butter Croissant', 'MAT-CROISSANT', 'pcs', 40.00, 10.00, 12000.00],
            ['mat-rice', 'Beras Pulen Super', 'MAT-RICE', 'gram', 15000.00, 3000.00, 16.00],
            ['mat-chicken-cut', 'Daging Ayam Fillet Siap Masak', 'MAT-CHICKEN', 'gram', 5000.00, 1000.00, 50.00],
            ['mat-french-fries', 'Frozen French Fries Cut', 'MAT-FRIES', 'gram', 4000.00, 1000.00, 35.00],
            ['mat-cig-marlboro', 'Stok Marlboro Filter Black', 'MAT-CIG-MB', 'bks', 30.00, 5.00, 38000.00],
            ['mat-cig-esse', 'Stok Esse Change Grape', 'MAT-CIG-ES', 'bks', 25.00, 5.00, 36000.00]
        ];
        for (const [id, name, sku, unit, current_stock, minimum_stock, cost_per_unit] of rawMaterials) {
            await conn.query(`
                INSERT INTO raw_materials (id, name, sku, unit, current_stock, minimum_stock, cost_per_unit)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE name=VALUES(name), unit=VALUES(unit)
            `, [id, name, sku, unit, current_stock, minimum_stock, cost_per_unit]);
        }

        await conn.query(`
            CREATE TABLE IF NOT EXISTS product_recipes (
                id VARCHAR(50) NOT NULL PRIMARY KEY,
                product_id VARCHAR(50) NOT NULL,
                raw_material_id VARCHAR(50) NOT NULL,
                quantity_needed DECIMAL(10,2) NOT NULL DEFAULT '1.00',
                UNIQUE KEY uniq_prod_mat (product_id, raw_material_id),
                KEY raw_material_id (raw_material_id),
                CONSTRAINT fk_recipe_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
                CONSTRAINT fk_recipe_material FOREIGN KEY (raw_material_id) REFERENCES raw_materials (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const recipes = [
            ['rcp-1a', 'prod-1', 'mat-coffee-bean', 18.00],
            ['rcp-1b', 'prod-1', 'mat-fresh-milk', 150.00],
            ['rcp-1c', 'prod-1', 'mat-aren-sugar', 25.00],
            ['rcp-2a', 'prod-2', 'mat-croissant-dough', 1.00],
            ['rcp-3a', 'prod-3', 'mat-matcha-powder', 15.00],
            ['rcp-3b', 'prod-3', 'mat-fresh-milk', 180.00],
            ['rcp-5a', 'prod-5', 'mat-coffee-bean', 20.00],
            ['rcp-7a', 'prod-7', 'mat-rice', 180.00],
            ['rcp-7b', 'prod-7', 'mat-chicken-cut', 60.00],
            ['rcp-8a', 'prod-8', 'mat-rice', 180.00],
            ['rcp-8b', 'prod-8', 'mat-chicken-cut', 100.00],
            ['rcp-9a', 'prod-9', 'mat-french-fries', 150.00],
            ['rcp-c1', 'prod-cig-1', 'mat-cig-marlboro', 1.00],
            ['rcp-c2', 'prod-cig-2', 'mat-cig-esse', 1.00]
        ];
        for (const [id, product_id, raw_material_id, quantity_needed] of recipes) {
            await conn.query(`
                INSERT INTO product_recipes (id, product_id, raw_material_id, quantity_needed)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE quantity_needed=VALUES(quantity_needed)
            `, [id, product_id, raw_material_id, quantity_needed]);
        }

        await conn.query(`
            CREATE TABLE IF NOT EXISTS stock_mutations (
                id VARCHAR(50) NOT NULL PRIMARY KEY,
                raw_material_id VARCHAR(50) NOT NULL,
                type ENUM('SALE','VOID_RESTORE','RESTOCK','ADJUSTMENT') NOT NULL,
                quantity DECIMAL(10,2) NOT NULL,
                balance_after DECIMAL(12,2) NOT NULL,
                reference_order_number VARCHAR(50) DEFAULT NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY raw_material_id (raw_material_id),
                KEY reference_order_number (reference_order_number),
                CONSTRAINT fk_mutation_material FOREIGN KEY (raw_material_id) REFERENCES raw_materials (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ Bahan Baku, Resep & Log Mutasi siap');

        // 5. Birthday Rewards Table
        await conn.query(`
            CREATE TABLE IF NOT EXISTS birthday_rewards (
                id VARCHAR(50) NOT NULL PRIMARY KEY,
                student_id_num VARCHAR(50) NOT NULL,
                reward_year INT NOT NULL,
                reward_name VARCHAR(150) NOT NULL,
                order_number VARCHAR(50) NOT NULL,
                granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_student_year (student_id_num, reward_year)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ Tabel Birthday Rewards siap');

        // 6. Loyalty Tables
        await conn.query(`
            CREATE TABLE IF NOT EXISTS loyalty_accounts (
                id VARCHAR(50) NOT NULL PRIMARY KEY,
                student_id_num VARCHAR(50) NOT NULL UNIQUE,
                student_name VARCHAR(100) NOT NULL,
                points_balance INT NOT NULL DEFAULT '0',
                total_spent DECIMAL(12,2) NOT NULL DEFAULT '0.00',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        await conn.query(`
            CREATE TABLE IF NOT EXISTS loyalty_logs (
                id VARCHAR(50) NOT NULL PRIMARY KEY,
                student_id_num VARCHAR(50) NOT NULL,
                points_change INT NOT NULL,
                balance_after INT NOT NULL,
                type ENUM('EARNED','REDEEMED','BIRTHDAY_BONUS','ADJUSTMENT') NOT NULL,
                reference_order_number VARCHAR(50) DEFAULT NULL,
                description VARCHAR(255) DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY student_id_num (student_id_num)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ Tabel Loyalitas Poin siap');

        // 7. Cashier Shifts Table
        await conn.query(`
            CREATE TABLE IF NOT EXISTS cashier_shifts (
                id VARCHAR(50) NOT NULL PRIMARY KEY,
                cashier_id VARCHAR(50) NOT NULL,
                cashier_name VARCHAR(100) NOT NULL,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ended_at TIMESTAMP NULL DEFAULT NULL,
                starting_cash DECIMAL(10,2) NOT NULL DEFAULT '0.00',
                ending_cash_system DECIMAL(10,2) NOT NULL DEFAULT '0.00',
                ending_cash_actual DECIMAL(10,2) NOT NULL DEFAULT '0.00',
                cash_difference DECIMAL(10,2) NOT NULL DEFAULT '0.00',
                total_sales_cash DECIMAL(10,2) NOT NULL DEFAULT '0.00',
                total_sales_qris DECIMAL(10,2) NOT NULL DEFAULT '0.00',
                total_orders_count INT NOT NULL DEFAULT '0',
                status ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
                notes TEXT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ Tabel Shift Kasir siap');

        // 8. Audit Logs Table
        await conn.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id VARCHAR(50) NOT NULL PRIMARY KEY,
                user_id VARCHAR(50) DEFAULT NULL,
                user_name VARCHAR(100) DEFAULT NULL,
                role VARCHAR(30) DEFAULT NULL,
                action VARCHAR(100) NOT NULL,
                target_type VARCHAR(50) NOT NULL,
                target_id VARCHAR(100) DEFAULT NULL,
                details JSON DEFAULT NULL,
                ip_address VARCHAR(50) DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_audit_action (action),
                KEY idx_audit_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ Tabel Audit Log siap');

        // 9. Staff / Admin Seeders
        await conn.query(`
            INSERT INTO admins (id, name, email, password_hash, role)
            VALUES
            ('admin-kasir-1', 'Kasir Utama', 'kasir@cafecampus.demo', '$2b$10$0EE0QHUTP7y0S9kI1x0bXOjzyFdfzbBm9EI5qkmkaAWUL4CVZy4JG', 'CASHIER'),
            ('admin-dapur-1', 'Staf Dapur & Barista', 'dapur@cafecampus.demo', '$2b$10$0EE0QHUTP7y0S9kI1x0bXOjzyFdfzbBm9EI5qkmkaAWUL4CVZy4JG', 'KITCHEN')
            ON DUPLICATE KEY UPDATE name=VALUES(name), role=VALUES(role)
        `);
        console.log('✅ Akun Kasir & Dapur siap');

        // 10. Orders Alterations (Idempotent column additions)
        const orderColumns = [
            { name: 'student_faculty_id', sql: 'ALTER TABLE orders ADD COLUMN student_faculty_id VARCHAR(50) NULL DEFAULT NULL' },
            { name: 'student_faculty_code', sql: 'ALTER TABLE orders ADD COLUMN student_faculty_code VARCHAR(20) NULL DEFAULT NULL' },
            { name: 'student_faculty_name', sql: 'ALTER TABLE orders ADD COLUMN student_faculty_name VARCHAR(150) NULL DEFAULT NULL' },
            { name: 'student_study_program', sql: 'ALTER TABLE orders ADD COLUMN student_study_program VARCHAR(150) NULL DEFAULT NULL' },
            { name: 'student_birth_date', sql: 'ALTER TABLE orders ADD COLUMN student_birth_date DATE NULL DEFAULT NULL' },
            { name: 'queue_number', sql: 'ALTER TABLE orders ADD COLUMN queue_number VARCHAR(20) NULL DEFAULT NULL' },
            { name: 'is_birthday_reward', sql: 'ALTER TABLE orders ADD COLUMN is_birthday_reward TINYINT(1) DEFAULT 0' },
            { name: 'birthday_reward_name', sql: 'ALTER TABLE orders ADD COLUMN birthday_reward_name VARCHAR(150) NULL DEFAULT NULL' },
            { name: 'void_reason', sql: 'ALTER TABLE orders ADD COLUMN void_reason TEXT NULL DEFAULT NULL' },
            { name: 'voided_by', sql: 'ALTER TABLE orders ADD COLUMN voided_by VARCHAR(50) NULL DEFAULT NULL' },
            { name: 'voided_at', sql: 'ALTER TABLE orders ADD COLUMN voided_at TIMESTAMP NULL DEFAULT NULL' }
        ];

        for (const col of orderColumns) {
            const [c] = await conn.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = ?", [col.name]);
            if (!c.length) {
                await conn.query(col.sql);
            }
        }
        console.log('✅ Kolom orders diperbarui');

        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        console.log('🎉 Migrasi dan Seeder v7 Berhasil 100%!');
    } finally {
        await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch((resetErr) => {
            console.error('⚠️ Gagal memulihkan FOREIGN_KEY_CHECKS:', resetErr.code || resetErr.message);
        });
        conn.release();
    }
}

migrate().then(() => process.exit(0)).catch(err => {
    console.error('❌ Migrasi gagal:', err);
    process.exit(1);
});
