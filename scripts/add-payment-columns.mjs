import pool from '../config/db.mjs';

async function main() {
  const newCols = [
    ['payment_proof_url', 'ALTER TABLE orders ADD COLUMN payment_proof_url MEDIUMTEXT NULL DEFAULT NULL'],
    ['payment_receipt_rrn', 'ALTER TABLE orders ADD COLUMN payment_receipt_rrn VARCHAR(100) NULL DEFAULT NULL'],
    ['payment_unique_code', 'ALTER TABLE orders ADD COLUMN payment_unique_code INT NOT NULL DEFAULT 0'],
    ['payment_verified_by', 'ALTER TABLE orders ADD COLUMN payment_verified_by VARCHAR(50) NULL DEFAULT NULL'],
    ['payment_verified_at', 'ALTER TABLE orders ADD COLUMN payment_verified_at TIMESTAMP NULL DEFAULT NULL'],
    ['payment_ai_status', 'ALTER TABLE orders ADD COLUMN payment_ai_status VARCHAR(50) NULL DEFAULT NULL'],
    ['payment_ai_analysis', 'ALTER TABLE orders ADD COLUMN payment_ai_analysis JSON NULL DEFAULT NULL'],
    ['payment_rejection_reason', 'ALTER TABLE orders ADD COLUMN payment_rejection_reason TEXT NULL DEFAULT NULL'],
  ];

  for (const [col, sql] of newCols) {
    const [rows] = await pool.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = ?",
      [col]
    );
    if (!rows.length) {
      await pool.query(sql);
      console.log('✓ Added column:', col);
    } else {
      console.log('• Column already exists:', col);
    }
  }

  const [idx] = await pool.query("SHOW INDEX FROM orders WHERE Key_name = 'idx_orders_payment_rrn'");
  if (!idx.length) {
    await pool.query('CREATE INDEX idx_orders_payment_rrn ON orders (payment_receipt_rrn)');
    console.log('✓ Created index idx_orders_payment_rrn');
  } else {
    console.log('• Index idx_orders_payment_rrn already exists');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
