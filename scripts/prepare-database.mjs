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
      .replace(/^\s*CREATE DATABASE IF NOT EXISTS `cafe_campus_db`[^;]*;\s*$/im, '')
      .replace(/^\s*USE `cafe_campus_db`;\s*$/im, '');
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

  await connection.query('SELECT 1');
  console.log(`[db-setup] Database siap. Tabel terdeteksi: ${postSetupTableRows.length}.`);
} catch (error) {
  console.error('\n[db-setup] GAGAL menyiapkan database. Aplikasi tidak akan dijalankan agar error tidak tersembunyi.');
  console.error(`[db-setup] ${error.message}`);
  if (error.code) console.error(`[db-setup] Kode error: ${error.code}`);
  process.exitCode = 1;
} finally {
  if (connection) await connection.end().catch(() => {});
}
