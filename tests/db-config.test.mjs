import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
// config/db.mjs creates the runtime pool at module load, so provide a harmless
// baseline before importing it; individual cases pass isolated env objects.
process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test_user';
process.env.DB_NAME ||= 'test_database';
const { getDatabaseConfig } = await import('../config/db.mjs');

describe('Database configuration', () => {
  it('parses the Railway MYSQL_URL connection string', () => {
    const config = getDatabaseConfig({
      MYSQL_URL: 'mysql://cafe_user:p%40ssword@mysql.railway.internal:3306/cafe_prod',
      NODE_ENV: 'production',
    });
    assert.equal(config.host, 'mysql.railway.internal');
    assert.equal(config.port, 3306);
    assert.equal(config.user, 'cafe_user');
    assert.equal(config.password, 'p@ssword');
    assert.equal(config.database, 'cafe_prod');
  });

  it('accepts Railway MYSQL* individual variables', () => {
    const config = getDatabaseConfig({
      MYSQLHOST: 'mysql.railway.internal',
      MYSQLPORT: '3306',
      MYSQLUSER: 'root',
      MYSQLPASSWORD: 'secret',
      MYSQLDATABASE: 'railway',
      RAILWAY_PROJECT_ID: 'project-id',
    });
    assert.equal(config.host, 'mysql.railway.internal');
    assert.equal(config.database, 'railway');
    assert.equal(config.password, 'secret');
  });

  it('continues to support legacy DB_* variables', () => {
    const config = getDatabaseConfig({
      DB_HOST: '127.0.0.1',
      DB_PORT: '3307',
      DB_USER: 'local_user',
      DB_PASSWORD: 'local_pass',
      DB_NAME: 'cafe_campus_db',
    });
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 3307);
    assert.equal(config.database, 'cafe_campus_db');
  });

  it('rejects PostgreSQL URLs with an actionable explanation', () => {
    assert.throws(
      () => getDatabaseConfig({ DATABASE_URL: 'postgresql://user:pass@host:5432/db' }),
      /membutuhkan MySQL\/MariaDB/
    );
  });

  it('does not allow a Railway service to silently fall back to localhost', () => {
    assert.throws(
      () => getDatabaseConfig({
        DB_HOST: 'localhost', DB_USER: 'root', DB_NAME: 'cafe_campus_db',
        RAILWAY_PROJECT_ID: 'project-id',
      }),
      /masih mengarah ke localhost/
    );
  });
});
