import pool from './config/db.mjs';

async function cleanDemoOrders() {
    if (String(process.env.APP_MODE || '').trim().toLowerCase() !== 'demo' || process.env.CONFIRM_CLEAN_DEMO_ORDERS !== 'YES') {
        throw new Error('Dibatalkan. Script ini hanya boleh dijalankan dengan APP_MODE=demo dan CONFIRM_CLEAN_DEMO_ORDERS=YES.');
    }

    await pool.query("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE student_id_num IN ('2306781001', '000000', '13521999') OR order_number LIKE 'CC-DEMO-%')");
    await pool.query("DELETE FROM orders WHERE student_id_num IN ('2306781001', '000000', '13521999') OR order_number LIKE 'CC-DEMO-%' OR idempotency_key LIKE 'stud-%' OR idempotency_key LIKE 'quota-%' OR idempotency_key LIKE 'reg-%' OR idempotency_key LIKE 'cancel-%' OR idempotency_key LIKE 'fake-%' OR idempotency_key LIKE 'qris-%' OR idempotency_key LIKE 'sold-%'");
    console.log('Cleaned demo/test orders successfully.');
}

cleanDemoOrders()
    .catch((error) => {
        console.error('[clean-demo-orders]', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end().catch(() => {});
    });
