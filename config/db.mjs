import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const truthy = (value) => ['1', 'true', 'yes', 'on', 'required'].includes(String(value ?? '').trim().toLowerCase());

function parseMySqlUrl(rawUrl, env) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Format MYSQL_URL/DATABASE_URL tidak valid. Gunakan URL koneksi MySQL dari Railway.');
  }

  if (!['mysql:', 'mariadb:'].includes(parsed.protocol)) {
    const kind = parsed.protocol.replace(':', '') || 'unknown';
    throw new Error(`Database memakai protokol "${kind}", sedangkan aplikasi Cafe Campus membutuhkan MySQL/MariaDB. Pilih Railway MySQL, bukan PostgreSQL.`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!parsed.hostname || !parsed.username || !database) {
    throw new Error('MYSQL_URL belum lengkap. Pastikan URL berisi host, username, dan nama database.');
  }

  const sslFromUrl = truthy(parsed.searchParams.get('ssl')) ||
    ['required', 'verify_ca', 'verify_identity'].includes(String(parsed.searchParams.get('ssl-mode') || '').toLowerCase());

  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    ssl: truthy(env.DB_SSL) || sslFromUrl ? { rejectUnauthorized: false } : undefined,
    waitForConnections: true,
    connectionLimit: Math.max(1, Number(env.DB_CONNECTION_LIMIT) || 10),
    queueLimit: 0,
    connectTimeout: Math.max(1000, Number(env.DB_CONNECT_TIMEOUT) || 10000),
    multipleStatements: true,
    dateStrings: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  };
}

export function getDatabaseConfig(env = process.env) {
  // Railway MySQL exposes MYSQL_URL. DATABASE_URL is also supported for
  // providers that publish a MySQL connection string under that name.
  const connectionUrl = env.MYSQL_URL || env.DATABASE_URL || env.MYSQL_PUBLIC_URL;
  if (connectionUrl) return parseMySqlUrl(connectionUrl, env);

  // Railway can also expose individual MYSQL* variables. Keep the legacy
  // DB_* names working for local installations and existing deployments.
  const host = env.MYSQLHOST || env.DB_HOST || '';
  const port = Number(env.MYSQLPORT || env.DB_PORT) || 3306;
  const user = env.MYSQLUSER || env.DB_USER || '';
  const password = env.MYSQLPASSWORD ?? env.DB_PASSWORD ?? env.DB_PASS ?? '';
  const database = env.MYSQLDATABASE || env.DB_NAME || '';

  const isRailway = Boolean(env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_SERVICE_ID);
  if (isRailway && (!host || ['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase()))) {
    throw new Error('Konfigurasi DB masih mengarah ke localhost/kosong. Hubungkan MYSQL_URL dari service MySQL Railway ke service aplikasi.');
  }
  if (!host || !user || !database) {
    throw new Error('Konfigurasi database belum lengkap. Isi MYSQL_URL atau MYSQLHOST, MYSQLPORT, MYSQLUSER, MYSQLPASSWORD, MYSQLDATABASE (atau variabel DB_* lama).');
  }

  return {
    host,
    port,
    user,
    password,
    database,
    ssl: truthy(env.DB_SSL) ? { rejectUnauthorized: false } : undefined,
    waitForConnections: true,
    connectionLimit: Math.max(1, Number(env.DB_CONNECTION_LIMIT) || 10),
    queueLimit: 0,
    connectTimeout: Math.max(1000, Number(env.DB_CONNECT_TIMEOUT) || 10000),
    multipleStatements: true,
    dateStrings: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  };
}

const pool = mysql.createPool(getDatabaseConfig());

export default pool;
