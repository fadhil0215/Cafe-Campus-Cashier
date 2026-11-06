import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const truthy = (value) => ['1', 'true', 'yes', 'on', 'required'].includes(String(value ?? '').trim().toLowerCase());

function parseMySqlUrl(rawUrl, env) {
  let cleaned = String(rawUrl || '').trim();
  // Hapus tanda kutip jika user membungkus dengan "..." atau '...'
  cleaned = cleaned.replace(/^['"]+|['"]+$/g, '').trim();
  // Hapus prefix jika user menempelkan "MYSQL_URL=..." atau "DATABASE_URL=..."
  cleaned = cleaned.replace(/^(?:MYSQL_URL|DATABASE_URL)\s*=\s*/i, '').trim();

  // Jika string merupakan template Railway yang belum ter-resolve (misal: ${{MySQL.MYSQL_URL}})
  if (cleaned.includes('${{')) {
    console.warn(`[db] Peringatan: MYSQL_URL "${cleaned}" belum ter-resolve oleh Railway template. Beralih ke variabel individual...`);
    return null;
  }

  // Jika user memasukkan format host[:port] tanpa protocol (misal: mysql.railway.internal atau mysql.railway.internal:3306)
  if (!cleaned.includes('://')) {
    if (cleaned.toLowerCase().startsWith('postgres')) {
      throw new Error('Database memakai protokol "postgresql", sedangkan aplikasi Cafe Campus membutuhkan MySQL/MariaDB. Pilih Railway MySQL, bukan PostgreSQL.');
    }
    cleaned = 'mysql://' + cleaned;
  }

  let parsed;
  try {
    parsed = new URL(cleaned);
  } catch {
    // Fallback regex untuk password yang memiliki karakter khusus (seperti #, @, %, dll)
    const match = cleaned.match(/^(?:mysql|mariadb):\/\/(?:([^:]+)(?::([^@]*))?@)?([^:\/?#]+)(?::(\d+))?(?:\/([^?#]*))?/i);
    if (match) {
      const user = match[1] ? decodeURIComponent(match[1]) : (env.MYSQLUSER || env.DB_USER || 'root');
      const password = match[2] ? decodeURIComponent(match[2]) : (env.MYSQLPASSWORD ?? env.DB_PASSWORD ?? env.DB_PASS ?? '');
      const host = match[3] || env.MYSQLHOST || 'mysql.railway.internal';
      const port = match[4] ? Number(match[4]) : (Number(env.MYSQLPORT || env.DB_PORT) || 3306);
      const database = (match[5] ? decodeURIComponent(match[5]) : '') || env.MYSQLDATABASE || env.DB_NAME || 'railway';

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

    if (env.MYSQLHOST || env.DB_HOST) {
      console.warn(`[db] Peringatan: Format URL "${cleaned}" tidak dapat di-parse, beralih ke variabel MYSQLHOST/DB_HOST...`);
      return null;
    }
    throw new Error('Format MYSQL_URL/DATABASE_URL tidak valid. Gunakan URL koneksi MySQL dari Railway.');
  }

  if (!['mysql:', 'mariadb:'].includes(parsed.protocol)) {
    const kind = parsed.protocol.replace(':', '') || 'unknown';
    throw new Error(`Database memakai protokol "${kind}", sedangkan aplikasi Cafe Campus membutuhkan MySQL/MariaDB. Pilih Railway MySQL, bukan PostgreSQL.`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) || env.MYSQLDATABASE || env.DB_NAME || 'railway';
  const hostname = parsed.hostname || env.MYSQLHOST || (cleaned.includes('railway') ? 'mysql.railway.internal' : '');
  const username = decodeURIComponent(parsed.username || '') || env.MYSQLUSER || env.DB_USER || 'root';
  const password = decodeURIComponent(parsed.password || '') || (env.MYSQLPASSWORD ?? env.DB_PASSWORD ?? env.DB_PASS ?? '');

  if (!hostname) {
    if (env.MYSQLHOST || env.DB_HOST) return null;
    throw new Error('MYSQL_URL belum lengkap. Pastikan URL berisi host, username, dan nama database.');
  }

  const sslFromUrl = truthy(parsed.searchParams.get('ssl')) ||
    ['required', 'verify_ca', 'verify_identity'].includes(String(parsed.searchParams.get('ssl-mode') || '').toLowerCase());

  return {
    host: hostname,
    port: Number(parsed.port) || Number(env.MYSQLPORT || env.DB_PORT) || 3306,
    user: username,
    password: password,
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
  if (connectionUrl) {
    try {
      const parsed = parseMySqlUrl(connectionUrl, env);
      if (parsed) return parsed;
    } catch (urlErr) {
      if (!env.MYSQLHOST && !env.DB_HOST) {
        throw urlErr;
      }
      console.warn(`[db] parseMySqlUrl gagal (${urlErr.message}), mencoba konfigurasi MYSQLHOST/DB_HOST...`);
    }
  }

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
