const mysql = require('../backend/node_modules/mysql2/promise');

async function runAudit() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '0206',
    database: 'dairy_merchant_db',
    decimalNumbers: true
  });

  console.log('=== RUNNING DEEP SYSTEM CHECKS ===\n');

  // 1. Error contract audit: compare Monolith vs Gateway error formats
  console.log('1. Error Contract Audit:');
  const gw404 = await fetch('http://localhost:4000/api/unknown-route-12345');
  const gw404Json = await gw404.json().catch(() => ({}));
  console.log('Gateway 404 response:', gw404.status, gw404Json);

  const gw401 = await fetch('http://localhost:4000/api/auth/me');
  const gw401Json = await gw401.json().catch(() => ({}));
  console.log('Gateway 401 response (unauthenticated):', gw401.status, gw401Json);

  const gw403 = await fetch('http://localhost:4000/api/merchants', {
    headers: { Authorization: `Bearer ${await getMerchantToken()}` }
  });
  const gw403Json = await gw403.json().catch(() => ({}));
  console.log('Gateway 403 response (RBAC forbidden):', gw403.status, gw403Json);

  // 2. Monolith Fallback Test
  console.log('\n2. Monolith Fallback Test:');
  const monoRes = await fetch('http://localhost:5000/api/health');
  const monoJson = await monoRes.json().catch(() => ({}));
  console.log('Monolith direct /api/health:', monoRes.status, monoJson);

  // 3. Database Invariants
  console.log('\n3. Database Invariant Verifications:');
  const [invRows] = await pool.query('SELECT MIN(quantity_available) as min_qty FROM inventory');
  console.log('Inventory min quantity:', invRows[0].min_qty);

  const [resRows] = await pool.query("SELECT COUNT(*) as count FROM inventory_reservations WHERE status = 'RESERVED' AND expires_at < NOW()");
  console.log('Expired stuck reservations:', resRows[0].count);

  const [sagaRows] = await pool.query("SELECT saga_id, saga_status, current_step, created_at FROM saga_instances ORDER BY created_at DESC LIMIT 5");
  console.log('Recent 5 Saga instances:', JSON.stringify(sagaRows, null, 2));

  // 4. Financial Parity Check
  console.log('\n4. Financial Parity Audit:');
  const [[finAudit]] = await pool.query(`
    SELECT 
      SUM(s.total_amount) AS sales_sum,
      SUM(p.amount) AS payments_sum,
      COUNT(s.sale_id) AS total_sales_count,
      COUNT(p.payment_id) AS total_payments_count
    FROM sales s
    JOIN payments p ON p.sale_id = s.sale_id
    WHERE s.sale_status = 'COMPLETED' AND p.payment_status = 'SUCCESS'
  `);
  console.log('Financial Audit Sums:', finAudit);

  // 5. Restart Test of Stateless Microservice (Product Service on Port 4003)
  console.log('\n5. Controlled Restart Test of Product Service:');
  const preCheck = await fetch('http://localhost:4000/api/products');
  console.log('Before restart, Gateway -> Product Service:', preCheck.status);

  // Check product service health
  const pHealth = await fetch('http://localhost:4003/health');
  console.log('Direct Product Service Health before restart:', pHealth.status);

  await pool.end();
  console.log('\n=== CHECKS COMPLETE ===');
}

async function getMerchantToken() {
  const res = await fetch('http://localhost:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'M1', password: 'P1' })
  });
  const data = await res.json();
  return data.token;
}

runAudit();
