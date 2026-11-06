import mysql from 'mysql2/promise';

const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'cafe_campus_db',
    waitForConnections: true,
    connectionLimit: 5
});

async function clean() {
    await pool.query("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE student_id_num IN ('2306781001', '000000', '13521999') OR order_number LIKE 'CC-DEMO-%')");
    await pool.query("DELETE FROM orders WHERE student_id_num IN ('2306781001', '000000', '13521999') OR order_number LIKE 'CC-DEMO-%' OR idempotency_key LIKE 'stud-%' OR idempotency_key LIKE 'quota-%' OR idempotency_key LIKE 'reg-%' OR idempotency_key LIKE 'cancel-%' OR idempotency_key LIKE 'fake-%' OR idempotency_key LIKE 'qris-%' OR idempotency_key LIKE 'sold-%'");
    console.log('Cleaned test orders successfully');
    process.exit(0);
}

clean().catch(err => {
    console.error(err);
    process.exit(1);
});
