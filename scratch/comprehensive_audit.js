const mysql = require('d:/Documents/Sem 2-1/DBSE_DBD/dairy-merchant-system/backend/node_modules/mysql2/promise');

const GATEWAY_URL = 'http://localhost:4000';
const MONOLITH_URL = 'http://localhost:5000';
const AUTH_URL = 'http://localhost:4001';
const MERCHANT_URL = 'http://localhost:4002';
const PRODUCT_URL = 'http://localhost:4003';
const INVENTORY_URL = 'http://localhost:4004';
const SALES_URL = 'http://localhost:4005';
const PAYMENT_URL = 'http://localhost:4006';
const REPORTING_URL = 'http://localhost:4007';

async function runAudit() {
  console.log('====================================================');
  console.log('READ-ONLY COMPREHENSIVE END-TO-END AUDIT SUITE');
  console.log('====================================================\n');

  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '0206',
    database: 'dairy_merchant_db',
    decimalNumbers: true
  });

  const results = {
    health: {},
    routing: {},
    auth: {},
    rbac: {},
    tenantIsolation: {},
    databaseSchema: {},
    mathStock: {}
  };

  // --- 1. Service Health Checks ---
  console.log('--- 1. Service Health Checks ---');
  const services = [
    { name: 'Gateway', port: 4000, url: `${GATEWAY_URL}/health` },
    { name: 'Auth Service', port: 4001, url: `${AUTH_URL}/health` },
    { name: 'Merchant Service', port: 4002, url: `${MERCHANT_URL}/health` },
    { name: 'Product Service', port: 4003, url: `${PRODUCT_URL}/health` },
    { name: 'Inventory Service', port: 4004, url: `${INVENTORY_URL}/health` },
    { name: 'Sales Service', port: 4005, url: `${SALES_URL}/health` },
    { name: 'Payment Service', port: 4006, url: `${PAYMENT_URL}/health` },
    { name: 'Reporting Service', port: 4007, url: `${REPORTING_URL}/health` },
    { name: 'Monolith Fallback', port: 5000, url: `${MONOLITH_URL}/api/health` }
  ];

  for (const s of services) {
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(2000) });
      const data = await res.json().catch(() => ({}));
      results.health[s.name] = { reachable: true, status: res.status, data };
      console.log(`  [${res.status === 200 ? 'OK' : 'WARN'}] ${s.name} (: ${s.port}) -> HTTP ${res.status}`);
    } catch (err) {
      results.health[s.name] = { reachable: false, error: err.message };
      console.log(`  [DOWN/SKELETON] ${s.name} (: ${s.port}) -> ${err.message}`);
    }
  }

  // --- 2. Auth & Tokens ---
  console.log('\n--- 2. Auth & JWT Verification ---');
  let adminToken = '', m1Token = '', m2Token = '', ownerToken = '';
  try {
    const adminRes = await fetch(`${AUTH_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@dairycoop.com', password: 'password123' })
    });
    const adminData = await adminRes.json();
    adminToken = adminData.token;

    const m1Res = await fetch(`${AUTH_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'M1', password: 'P1' })
    });
    const m1Data = await m1Res.json();
    m1Token = m1Data.token;

    const m2Res = await fetch(`${AUTH_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'M2', password: 'P2' })
    });
    const m2Data = await m2Res.json();
    m2Token = m2Data.token;

    const ownerRes = await fetch(`${AUTH_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'owner@dairycoop.com', password: 'password123' })
    });
    const ownerData = await ownerRes.json();
    ownerToken = ownerData.token;

    console.log(`  [PASS] Tokens retrieved for Admin (role: ${adminData.user.role}), M1 (id: ${m1Data.user.merchant_id}), M2 (id: ${m2Data.user.merchant_id}), Owner (role: ${ownerData.user.role})`);
  } catch (err) {
    console.error('  [FAIL] Error fetching auth tokens:', err.message);
  }

  // --- 3. Gateway Routing Verification ---
  console.log('\n--- 3. API Gateway Routing Verification ---');
  const routeChecks = [
    { path: '/api/auth/me', token: adminToken, expectedStatus: 200, label: 'Auth Service (/api/auth/me)' },
    { path: '/api/merchants', token: adminToken, expectedStatus: 200, label: 'Merchant Service (/api/merchants)' },
    { path: '/api/products', token: adminToken, expectedStatus: 200, label: 'Product Service (/api/products)' },
    { path: '/api/inventory', token: adminToken, expectedStatus: 200, label: 'Inventory Service (/api/inventory)' },
    { path: '/api/sales', token: m1Token, expectedStatus: 200, label: 'Sales Service (/api/sales)' },
    { path: '/api/invoices', token: m1Token, expectedStatus: 200, label: 'Sales Service (/api/invoices)' },
    { path: '/api/payments', token: adminToken, expectedStatus: 200, label: 'Payment Service (/api/payments)' },
    { path: '/api/discrepancies/stock', token: adminToken, expectedStatus: 200, label: 'Monolith Fallback (/api/discrepancies/stock)' }
  ];

  for (const rc of routeChecks) {
    try {
      const res = await fetch(`${GATEWAY_URL}${rc.path}`, {
        headers: { Authorization: `Bearer ${rc.token}` }
      });
      console.log(`  [${res.status === rc.expectedStatus ? 'PASS' : 'FAIL'}] Gateway ${rc.path} -> HTTP ${res.status} (${rc.label})`);
    } catch (err) {
      console.log(`  [FAIL] Gateway ${rc.path} -> ${err.message}`);
    }
  }

  // --- 4. RBAC & Tenant Isolation Checks ---
  console.log('\n--- 4. RBAC & Tenant Isolation Checks ---');
  // Merchant cannot view all merchants
  const mMerchantsRes = await fetch(`${GATEWAY_URL}/api/merchants`, { headers: { Authorization: `Bearer ${m1Token}` } });
  console.log(`  [${mMerchantsRes.status === 403 ? 'PASS' : 'FAIL'}] Merchant role cannot access /api/merchants -> HTTP ${mMerchantsRes.status}`);

  // Merchant 1 inventory query returns only Merchant 1 items
  const m1InvRes = await fetch(`${GATEWAY_URL}/api/inventory`, { headers: { Authorization: `Bearer ${m1Token}` } });
  const m1Inv = await m1InvRes.json();
  const m1Only = Array.isArray(m1Inv) && m1Inv.every(item => item.merchant_id === 1);
  console.log(`  [${m1Only ? 'PASS' : 'FAIL'}] Merchant 1 inventory scoped strictly to merchant_id = 1 (Count: ${m1Inv.length})`);

  // Merchant 2 cannot access Merchant 1 single sale
  const [m1SalesRows] = await pool.query('SELECT sale_id FROM sales WHERE merchant_id = 1 LIMIT 1');
  if (m1SalesRows.length > 0) {
    const saleId = m1SalesRows[0].sale_id;
    const m2SaleRes = await fetch(`${GATEWAY_URL}/api/sales/${saleId}`, { headers: { Authorization: `Bearer ${m2Token}` } });
    console.log(`  [${m2SaleRes.status === 404 ? 'PASS' : 'FAIL'}] Merchant 2 cross-tenant access to M1 sale ${saleId} -> HTTP ${m2SaleRes.status}`);
  }

  // --- 5. Database Schema & Math Integrity Audit ---
  console.log('\n--- 5. Database Schema & Stock Integrity Audit ---');
  const [tables] = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'dairy_merchant_db' AND table_type = 'BASE TABLE'
  `);
  console.log(`  [INFO] Total base tables in DB: ${tables.length}`);
  console.log(`  [INFO] Tables: ${tables.map(t => t.TABLE_NAME || t.table_name).join(', ')}`);

  const [negStock] = await pool.query('SELECT * FROM inventory WHERE quantity_available < 0');
  console.log(`  [${negStock.length === 0 ? 'PASS' : 'FAIL'}] Negative inventory count: ${negStock.length}`);

  const [invSummary] = await pool.query(`
    SELECT m.shop_name, p.product_name, i.quantity_available 
    FROM inventory i
    JOIN merchants m ON m.merchant_id = i.merchant_id
    JOIN products p ON p.product_id = i.product_id
  `);
  console.log('  [INFO] Current Available Stock by Merchant:');
  invSummary.forEach(row => {
    console.log(`    - [${row.shop_name}] ${row.product_name}: ${row.quantity_available}`);
  });

  const [sagaCounts] = await pool.query(`
    SELECT saga_status, COUNT(*) as count 
    FROM saga_instances 
    GROUP BY saga_status
  `);
  console.log('  [INFO] Saga Instances Distribution:');
  sagaCounts.forEach(r => console.log(`    - ${r.saga_status}: ${r.count}`));

  await pool.end();
  console.log('\n====================================================');
  console.log('AUDIT RUN COMPLETED');
  console.log('====================================================');
}

runAudit().catch(err => {
  console.error('Audit Error:', err);
  process.exit(1);
});
