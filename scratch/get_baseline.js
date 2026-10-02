const mysql = require('../backend/node_modules/mysql2/promise');

async function getBaseline() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '0206',
    database: 'dairy_merchant_db',
    decimalNumbers: true
  });

  const tables = [
    'users', 'merchants', 'products', 'product_quality',
    'stock_entries', 'inventory', 'inventory_reservations',
    'invoices', 'sales', 'sale_items', 'payments', 'saga_instances'
  ];

  const counts = {};
  for (const t of tables) {
    const [rows] = await pool.query(`SELECT COUNT(*) as cnt FROM ${t}`);
    counts[t] = rows[0].cnt;
  }

  const [[inv]] = await pool.query(`SELECT SUM(quantity_available) as total_qty, MIN(quantity_available) as min_qty FROM inventory`);
  const [[sales]] = await pool.query(`SELECT COUNT(*) as completed_sales, SUM(total_amount) as sales_sum FROM sales WHERE sale_status = 'COMPLETED'`);
  const [[payments]] = await pool.query(`SELECT COUNT(*) as success_payments, SUM(amount) as payments_sum FROM payments WHERE payment_status = 'SUCCESS'`);
  const [stuckRes] = await pool.query(`SELECT COUNT(*) as stuck FROM inventory_reservations WHERE status = 'RESERVED' AND expires_at < NOW()`);

  console.log('BASELINE DATABASE TABLE COUNTS:');
  console.log(JSON.stringify(counts, null, 2));
  console.log('\nBASELINE INVENTORY TOTALS:', inv);
  console.log('BASELINE COMPLETED SALES:', sales);
  console.log('BASELINE SUCCESSFUL PAYMENTS:', payments);
  console.log('BASELINE STUCK RESERVATIONS:', stuckRes[0].stuck);

  await pool.end();
}

getBaseline();
