import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabaseConfig } from '../config/db.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// These are the minimum tables required by the application. The baseline
// database.sql contains DROP TABLE statements, so it may ONLY be imported
// when the selected database contains zero tables.
const requiredTables = [
  'admins',
  'blacklist',
  'cafe_tables',
  'categories',
  'products',
  'orders',
  'order_items',
  'settings',
];

let connection;

try {
  const config = getDatabaseConfig();
  connection = await mysql.createConnection({ ...config, multipleStatements: true });

  const [[databaseInfo]] = await connection.query('SELECT DATABASE() AS databaseName');
  if (!databaseInfo?.databaseName) {
    throw new Error('Koneksi berhasil, tetapi belum memilih database. Periksa nama database MYSQLDATABASE/DB_NAME pada Railway.');
  }

  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME AS tableName
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
  );
  const existingTables = new Set(tableRows.map((row) => row.tableName));
  const missingRequired = requiredTables.filter((table) => !existingTables.has(table));

  if (existingTables.size === 0) {
    console.log(`[db-setup] Database "${databaseInfo.databaseName}" masih kosong. Menyiapkan schema awal Cafe Campus...`);
    const schemaPath = path.join(projectRoot, 'database.sql');
    let schemaSql = await fs.readFile(schemaPath, 'utf8');
    // The dump contains a local CREATE DATABASE/USE statement. Remove those
    // lines so Railway's already-selected database (MYSQLDATABASE) is used.
    schemaSql = schemaSql
      .replace(/^\s*CREATE DATABASE\b[^;]*;[^\S\r\n]*\r?$/gim, '')
      .replace(/^\s*USE\b[^;]*;[^\S\r\n]*\r?$/gim, '');
    await connection.query(schemaSql);
    console.log('[db-setup] Schema awal berhasil diimpor.');
  } else if (missingRequired.length > 0) {
    throw new Error(
      `Database "${databaseInfo.databaseName}" tidak kosong tetapi schema inti belum lengkap (${missingRequired.join(', ')}). ` +
      'Setup otomatis dihentikan untuk melindungi data yang sudah ada. Backup database dan periksa tabel yang hilang sebelum migrasi.'
    );
  } else {
    console.log(`[db-setup] Schema inti ditemukan di "${databaseInfo.databaseName}". Tidak mengimpor ulang database.sql.`);
  }

  // Safe, idempotent guard for receipt columns on databases created from an
  // older schema. Never drop or recreate production tables here.
  const receiptColumns = [
    ['receipt_printed', 'ALTER TABLE orders ADD COLUMN receipt_printed TINYINT(1) NOT NULL DEFAULT 0'],
    ['receipt_printed_at', 'ALTER TABLE orders ADD COLUMN receipt_printed_at TIMESTAMP NULL DEFAULT NULL'],
  ];
  for (const [columnName, alterSql] of receiptColumns) {
    const [rows] = await connection.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = ?`,
      [columnName]
    );
    if (rows.length === 0) await connection.query(alterSql);
  }

  const [postSetupTableRows] = await connection.query(
    `SELECT TABLE_NAME AS tableName FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
  );
  const [adminRows] = await connection.query('SELECT id FROM admins LIMIT 1');
  if (adminRows.length === 0) {
    throw new Error('Tabel admins tersedia tetapi belum berisi akun. Seed administrator awal belum terpasang; periksa import database.sql.');
  }

  // The SQL snapshot contains a known demo-only password hash. In production,
  // replace it once with credentials supplied through Railway Variables.
  // After the hash changes, later restarts will not overwrite the real password.
  const defaultDemoHash = '$2b$10$0EE0QHUTP7y0S9kI1x0bXOjzyFdfzbBm9EI5qkmkaAWUL4CVZy4JG';
  const [[bootstrapAdmin]] = await connection.query(
    'SELECT id, email, password_hash FROM admins WHERE id = ? LIMIT 1',
    ['admin-1']
  );
  const configuredAdminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const configuredAdminPassword = String(process.env.ADMIN_PASSWORD || '');
  const appMode = String(process.env.APP_MODE || 'production').trim().toLowerCase();

  const hasDefaultAdminPassword = bootstrapAdmin
    ? (bootstrapAdmin.password_hash === defaultDemoHash || await bcrypt.compare('admin123', bootstrapAdmin.password_hash))
    : false;

  if (hasDefaultAdminPassword) {
    if (configuredAdminEmail || configuredAdminPassword) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredAdminEmail) || /contoh-client|example/i.test(configuredAdminEmail) || configuredAdminPassword.length < 12 || Buffer.byteLength(configuredAdminPassword, 'utf8') > 72 || /ganti_dengan|change_me|placeholder|example/i.test(configuredAdminPassword)) {
        throw new Error('ADMIN_EMAIL harus berupa email client yang valid dan ADMIN_PASSWORD wajib berupa secret asli 12-72 byte (bukan nilai placeholder).');
      }
      const newAdminHash = await bcrypt.hash(configuredAdminPassword, 12);
      await connection.query(
        'UPDATE admins SET email = ?, password_hash = ? WHERE id = ?',
        [configuredAdminEmail, newAdminHash, bootstrapAdmin.id]
      );
      console.log(`[db-setup] Kredensial awal administrator diperbarui untuk ${configuredAdminEmail}.`);
    } else if (appMode !== 'demo') {
      throw new Error('Akun admin database masih memakai kredensial demo. Untuk production, isi ADMIN_EMAIL dan ADMIN_PASSWORD (minimal 12 karakter) di Railway Variables, atau ubah password admin saat APP_MODE=demo lalu deploy ulang dengan APP_MODE=production.');
    } else {
      console.log('[db-setup] Mode demo: akun admin demo awal tetap aktif untuk testing.');
    }
  }

  // Sync requested tables: B1-B6, 101-105, 201-210, 301-309, 401-404, AD 1-AD 5
  const requestedTables = [
    { id: 'tbl-b1', number: 'B1', name: 'Meja B1', token: 'demo-table-b1' },
    { id: 'tbl-b2', number: 'B2', name: 'Meja B2', token: 'demo-table-b2' },
    { id: 'tbl-b3', number: 'B3', name: 'Meja B3', token: 'demo-table-b3' },
    { id: 'tbl-b4', number: 'B4', name: 'Meja B4', token: 'demo-table-b4' },
    { id: 'tbl-b5', number: 'B5', name: 'Meja B5', token: 'demo-table-b5' },
    { id: 'tbl-b6', number: 'B6', name: 'Meja B6', token: 'demo-table-b6' },
    { id: 'tbl-101', number: '101', name: 'Meja 101', token: 'demo-table-101' },
    { id: 'tbl-102', number: '102', name: 'Meja 102', token: 'demo-table-102' },
    { id: 'tbl-103', number: '103', name: 'Meja 103', token: 'demo-table-103' },
    { id: 'tbl-104', number: '104', name: 'Meja 104', token: 'demo-table-104' },
    { id: 'tbl-105', number: '105', name: 'Meja 105', token: 'demo-table-105' },
    { id: 'tbl-201', number: '201', name: 'Meja 201', token: 'demo-table-201' },
    { id: 'tbl-202', number: '202', name: 'Meja 202', token: 'demo-table-202' },
    { id: 'tbl-203', number: '203', name: 'Meja 203', token: 'demo-table-203' },
    { id: 'tbl-204', number: '204', name: 'Meja 204', token: 'demo-table-204' },
    { id: 'tbl-205', number: '205', name: 'Meja 205', token: 'demo-table-205' },
    { id: 'tbl-206', number: '206', name: 'Meja 206', token: 'demo-table-206' },
    { id: 'tbl-207', number: '207', name: 'Meja 207', token: 'demo-table-207' },
    { id: 'tbl-208', number: '208', name: 'Meja 208', token: 'demo-table-208' },
    { id: 'tbl-209', number: '209', name: 'Meja 209', token: 'demo-table-209' },
    { id: 'tbl-210', number: '210', name: 'Meja 210', token: 'demo-table-210' },
    { id: 'tbl-301', number: '301', name: 'Meja 301', token: 'demo-table-301' },
    { id: 'tbl-302', number: '302', name: 'Meja 302', token: 'demo-table-302' },
    { id: 'tbl-303', number: '303', name: 'Meja 303', token: 'demo-table-303' },
    { id: 'tbl-304', number: '304', name: 'Meja 304', token: 'demo-table-304' },
    { id: 'tbl-305', number: '305', name: 'Meja 305', token: 'demo-table-305' },
    { id: 'tbl-306', number: '306', name: 'Meja 306', token: 'demo-table-306' },
    { id: 'tbl-307', number: '307', name: 'Meja 307', token: 'demo-table-307' },
    { id: 'tbl-308', number: '308', name: 'Meja 308', token: 'demo-table-308' },
    { id: 'tbl-309', number: '309', name: 'Meja 309', token: 'demo-table-309' },
    { id: 'tbl-401', number: '401', name: 'Meja 401', token: 'demo-table-401' },
    { id: 'tbl-402', number: '402', name: 'Meja 402', token: 'demo-table-402' },
    { id: 'tbl-403', number: '403', name: 'Meja 403', token: 'demo-table-403' },
    { id: 'tbl-404', number: '404', name: 'Meja 404', token: 'demo-table-404' },
    { id: 'tbl-ad-1', number: 'AD 1', name: 'Meja AD 1', token: 'demo-table-ad-1' },
    { id: 'tbl-ad-2', number: 'AD 2', name: 'Meja AD 2', token: 'demo-table-ad-2' },
    { id: 'tbl-ad-3', number: 'AD 3', name: 'Meja AD 3', token: 'demo-table-ad-3' },
    { id: 'tbl-ad-4', number: 'AD 4', name: 'Meja AD 4', token: 'demo-table-ad-4' },
    { id: 'tbl-ad-5', number: 'AD 5', name: 'Meja AD 5', token: 'demo-table-ad-5' },
  ];
  await connection.query("UPDATE cafe_tables SET is_active = 0 WHERE id NOT LIKE 'tbl-b%' AND id NOT LIKE 'tbl-10%' AND id NOT LIKE 'tbl-20%' AND id NOT LIKE 'tbl-21%' AND id NOT LIKE 'tbl-30%' AND id NOT LIKE 'tbl-40%' AND id NOT LIKE 'tbl-ad-%'");
  for (const t of requestedTables) {
    await connection.query(`
      INSERT INTO cafe_tables (id, table_number, name, public_token, token_version, is_active)
      VALUES (?, ?, ?, ?, 1, 1)
      ON DUPLICATE KEY UPDATE table_number=VALUES(table_number), name=VALUES(name), is_active=1
    `, [t.id, t.number, t.name, t.token]);
  }

  // Sync promotional products
  const promoProducts = [
    ['prod-mocca-blue', 'cat-1', 'Mocca Blue', 'Bold espresso, rich chocolate, and a sweet blueberry twist. Sounds unexpected, tastes unforgettable!', 19000.00, 16000.00, '🫐', '/assets/mocca-blue.jpg', 1, 1, 1, 1, 0],
    ['prod-nasgor-bp', 'cat-3', 'Nasi Goreng Banyak Pikiran', 'Nasi goreng gurih yang dimasak dengan penuh rasa, dipadukan telur mata sapi yang lembut dan creamy, serta kerupuk renyah. Hangat, sederhana, dan pas untuk nemenin kamu yang lagi banyak pikiran!', 22000.00, 19000.00, '🍳', '/assets/nasi-goreng-banyak-pikiran.jpg', 1, 0, 2, 1, 0],
    ['prod-bekal-nugas', 'cat-3', 'Bekal Nugas', 'Seporsi nasi putih hangat disajikan bersama fried chicken renyah keemasan, scrambled egg lembut & creamy, serta jukut bayam segar. Pas untuk bekal nugas kapan saja. (Tersedia opsi Sambal Matah / Sambal Bawang).', 26000.00, 23000.00, '🍱', '/assets/bekal-nugas.jpg', 1, 0, 3, 1, 0],
    ['prod-nasi-kulit', 'cat-3', 'Nasi Kulit Daun Jeruk', 'Nasi hangat dengan kulit ayam crispy gurih & renyah dipadukan aroma segar daun jeruk yang menggugah selera. Bikin susah berhenti makan!', 23000.00, 20000.00, '🍗', '/assets/nasi-kulit-daun-jeruk.jpg', 1, 0, 4, 1, 0],
    ['prod-bakmi-matah', 'cat-3', 'Bakmi Goreng Sambal Matah', 'Bakmi goreng hangat dengan bumbu gurih yang meresap sempurna, dipadukan sambal matah segar yang pedas, dan wangi. Bikin setiap suapan terasa spesial!', 26000.00, 23000.00, '🍜', '/assets/bakmi-goreng-sambal-matah.jpg', 1, 0, 5, 1, 0]
  ];
  for (const [id, category_id, name, description, price, student_price, emoji, image_url, is_available, customizable, sort_order, is_active, is_tobacco] of promoProducts) {
    await connection.query(`
      INSERT INTO products (id, category_id, name, description, price, student_price, emoji, image_url, is_available, customizable, sort_order, is_active, is_tobacco)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        name=VALUES(name), description=VALUES(description), price=VALUES(price), 
        student_price=VALUES(student_price), emoji=VALUES(emoji), image_url=VALUES(image_url), 
        is_available=VALUES(is_available), customizable=VALUES(customizable), sort_order=VALUES(sort_order), 
        is_active=1
    `, [id, category_id, name, description, price, student_price, emoji, image_url, is_available, customizable, sort_order, is_active, is_tobacco]);
  }

  await connection.query('SELECT 1');
  console.log(`[db-setup] Database siap. Tabel terdeteksi: ${postSetupTableRows.length}. Meja dan menu terupdate.`);
} catch (error) {
  console.error('\n[db-setup] GAGAL menyiapkan database. Aplikasi tidak akan dijalankan agar error tidak tersembunyi.');
  console.error(`[db-setup] ${error.message}`);
  if (error.code) console.error(`[db-setup] Kode error: ${error.code}`);
  process.exitCode = 1;
} finally {
  if (connection) await connection.end().catch(() => {});
}
