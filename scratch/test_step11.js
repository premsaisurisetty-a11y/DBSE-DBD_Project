const path = require('path');
const { spawn } = require('child_process');
const mysql = require('../backend/node_modules/mysql2/promise');

const GATEWAY_URL = 'http://localhost:4000';
const AUTH_URL = 'http://localhost:4001';
const MERCHANT_URL = 'http://localhost:4002';
const PRODUCT_URL = 'http://localhost:4003';
const INVENTORY_URL = 'http://localhost:4004';
const SALES_URL = 'http://localhost:4005';
const PAYMENT_URL = 'http://localhost:4006';
const REPORTING_URL = 'http://localhost:4007';
const MONOLITH_URL = 'http://localhost:5000';

let passed = 0;
let failed = 0;
const spawnedProcesses = [];

function assert(condition, testName, extraInfo = '') {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName} ${extraInfo}`);
    failed++;
  }
}

async function isPortHealthy(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return res.status === 200;
  } catch (e) {
    return false;
  }
}

async function startServiceIfNotRunning(name, serviceDir, script, healthUrl) {
  const healthy = await isPortHealthy(healthUrl);
  if (healthy) {
    console.log(`  [READY] ${name} is already active at ${healthUrl}`);
    return;
  }

  console.log(`  [STARTING] Launching ${name}...`);
  const child = spawn('node', [script], {
    cwd: path.resolve(__dirname, '..', serviceDir),
    stdio: 'pipe',
    env: { ...process.env }
  });
  spawnedProcesses.push(child);

  // Poll until healthy
  const startTime = Date.now();
  while (Date.now() - startTime < 8000) {
    await new Promise(r => setTimeout(r, 400));
    if (await isPortHealthy(healthUrl)) {
      console.log(`  [STARTED] ${name} is now healthy at ${healthUrl}`);
      return;
    }
  }
  throw new Error(`Failed to start ${name} within timeout`);
}

async function login(baseUrl, identifier, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password })
  });
  const data = await res.json();
  return { status: res.status, ...data };
}

async function runStep11Tests() {
  console.log('====================================================');
  console.log('STEP 11 AUDIT & TEST SUITE: REPORTING SERVICE');
  console.log('====================================================\n');

  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '0206',
    database: 'dairy_merchant_db',
    decimalNumbers: true
  });

  try {
    // 0. Ensure all services are up
    console.log('0. Microservice Cluster Initialization:');
    await startServiceIfNotRunning('Auth Service', 'services/auth-service', 'index.js', `${AUTH_URL}/health`);
    await startServiceIfNotRunning('Merchant Service', 'services/merchant-service', 'index.js', `${MERCHANT_URL}/health`);
    await startServiceIfNotRunning('Product Service', 'services/product-service', 'index.js', `${PRODUCT_URL}/health`);
    await startServiceIfNotRunning('Inventory Service', 'services/inventory-service', 'index.js', `${INVENTORY_URL}/health`);
    await startServiceIfNotRunning('Sales Service', 'services/sales-service', 'index.js', `${SALES_URL}/health`);
    await startServiceIfNotRunning('Payment Service', 'services/payment-service', 'index.js', `${PAYMENT_URL}/health`);
    await startServiceIfNotRunning('Reporting Service', 'services/reporting-service', 'index.js', `${REPORTING_URL}/health`);
    await startServiceIfNotRunning('API Gateway', 'services/api-gateway', 'index.js', `${GATEWAY_URL}/health`);

    // 1. Health Checks & Route Mapping
    console.log('\n1. Health Checks & Gateway Route Mapping:');
    const directHealthRes = await fetch(`${REPORTING_URL}/health`);
    const directHealth = await directHealthRes.json();
    assert(directHealth.status === 'OK' && directHealth.service === 'reporting-service', 'Direct Reporting Service health check returns 200 OK');

    const directApiHealthRes = await fetch(`${REPORTING_URL}/api/discrepancies/health`);
    const directApiHealth = await directApiHealthRes.json();
    assert(directApiHealth.status === 'OK' && directApiHealth.service === 'reporting-service', 'Direct /api/discrepancies/health returns 200 OK');

    const gwHealthRes = await fetch(`${GATEWAY_URL}/health`);
    const gwHealth = await gwHealthRes.json();
    assert(gwHealth.status === 'OK', 'API Gateway health endpoint returns 200 OK');
    assert(gwHealth.routes && gwHealth.routes.reporting === 'http://localhost:4007', 'API Gateway route table maps reporting to http://localhost:4007');

    const gwDiscrepancyHealthRes = await fetch(`${GATEWAY_URL}/api/discrepancies/health`);
    const gwDiscrepancyHealth = await gwDiscrepancyHealthRes.json();
    assert(gwDiscrepancyHealth.service === 'reporting-service', 'Gateway routes /api/discrepancies/health to Reporting Service :4007');

    // 2. Authentication Setup
    console.log('\n2. Authentication Tokens & User Setup:');
    const adminLogin = await login(GATEWAY_URL, 'admin@dairycoop.com', 'password123');
    const ownerLogin = await login(GATEWAY_URL, 'owner@dairycoop.com', 'password123');
    const m1Login = await login(GATEWAY_URL, 'M1', 'P1');
    const m2Login = await login(GATEWAY_URL, 'M2', 'P2');

    assert(adminLogin.token && adminLogin.user.role === 'ADMIN', 'Admin authentication successful (role: ADMIN)');
    assert(ownerLogin.token && ownerLogin.user.role === 'OWNER', 'Owner authentication successful (role: OWNER)');
    assert(m1Login.token && m1Login.user.role === 'MERCHANT', 'Merchant 1 authentication successful (role: MERCHANT)');
    assert(m2Login.token && m2Login.user.role === 'MERCHANT', 'Merchant 2 authentication successful (role: MERCHANT)');

    const adminToken = adminLogin.token;
    const ownerToken = ownerLogin.token;
    const m1Token = m1Login.token;
    const m2Token = m2Login.token;

    // Snapshot database state for data integrity checks
    const [[invCountBefore]] = await pool.query('SELECT COUNT(*) as c, SUM(quantity_available) as sum_qty FROM inventory');
    const [[salesCountBefore]] = await pool.query('SELECT COUNT(*) as c, SUM(total_amount) as sum_amount FROM sales');
    const [[payCountBefore]] = await pool.query('SELECT COUNT(*) as c, SUM(amount) as sum_amount FROM payments');
    const [[merchCountBefore]] = await pool.query('SELECT COUNT(*) as c FROM merchants');
    const [[prodCountBefore]] = await pool.query('SELECT COUNT(*) as c FROM products');
    const [[sagaCountBefore]] = await pool.query('SELECT COUNT(*) as c FROM saga_instances');

    // 3. JWT & Authentication Middleware Tests
    console.log('\n3. JWT & Authentication Middleware Validation:');
    const noTokenPay = await fetch(`${GATEWAY_URL}/api/discrepancies/payment`);
    assert(noTokenPay.status === 401, 'Missing JWT on /api/discrepancies/payment returns 401 Unauthorized');

    const badTokenPay = await fetch(`${GATEWAY_URL}/api/discrepancies/payment`, {
      headers: { Authorization: 'Bearer malformed.invalid.token' }
    });
    assert(badTokenPay.status === 401, 'Invalid JWT on /api/discrepancies/payment returns 401 Unauthorized');

    const noTokenStock = await fetch(`${GATEWAY_URL}/api/discrepancies/stock`);
    assert(noTokenStock.status === 401, 'Missing JWT on /api/discrepancies/stock returns 401 Unauthorized');

    const noTokenAdminSum = await fetch(`${GATEWAY_URL}/api/discrepancies/summary/admin`);
    assert(noTokenAdminSum.status === 401, 'Missing JWT on /api/discrepancies/summary/admin returns 401 Unauthorized');

    const noTokenMerchSum = await fetch(`${GATEWAY_URL}/api/discrepancies/summary/merchant`);
    assert(noTokenMerchSum.status === 401, 'Missing JWT on /api/discrepancies/summary/merchant returns 401 Unauthorized');

    const noTokenRev = await fetch(`${GATEWAY_URL}/api/discrepancies/revenue`);
    assert(noTokenRev.status === 401, 'Missing JWT on /api/discrepancies/revenue returns 401 Unauthorized');

    // 4. Role-Based Access Control (RBAC) Tests
    console.log('\n4. Role-Based Access Control (RBAC) Validation:');
    // Merchant forbidden from admin routes
    const m1Pay = await fetch(`${GATEWAY_URL}/api/discrepancies/payment`, { headers: { Authorization: `Bearer ${m1Token}` } });
    assert(m1Pay.status === 403, 'Merchant user forbidden from /api/discrepancies/payment (403)');

    const m1Stock = await fetch(`${GATEWAY_URL}/api/discrepancies/stock`, { headers: { Authorization: `Bearer ${m1Token}` } });
    assert(m1Stock.status === 403, 'Merchant user forbidden from /api/discrepancies/stock (403)');

    const m1AdminSum = await fetch(`${GATEWAY_URL}/api/discrepancies/summary/admin`, { headers: { Authorization: `Bearer ${m1Token}` } });
    assert(m1AdminSum.status === 403, 'Merchant user forbidden from /api/discrepancies/summary/admin (403)');

    // Admin allowed
    const adminPay = await fetch(`${GATEWAY_URL}/api/discrepancies/payment`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(adminPay.status === 200, 'Admin user can access /api/discrepancies/payment (200)');

    const adminStock = await fetch(`${GATEWAY_URL}/api/discrepancies/stock`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(adminStock.status === 200, 'Admin user can access /api/discrepancies/stock (200)');

    const adminSum = await fetch(`${GATEWAY_URL}/api/discrepancies/summary/admin`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(adminSum.status === 200, 'Admin user can access /api/discrepancies/summary/admin (200)');

    // Owner allowed (master access)
    const ownerPay = await fetch(`${GATEWAY_URL}/api/discrepancies/payment`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(ownerPay.status === 200, 'Owner user can access /api/discrepancies/payment via master access (200)');

    const ownerStock = await fetch(`${GATEWAY_URL}/api/discrepancies/stock`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(ownerStock.status === 200, 'Owner user can access /api/discrepancies/stock via master access (200)');

    const ownerSum = await fetch(`${GATEWAY_URL}/api/discrepancies/summary/admin`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(ownerSum.status === 200, 'Owner user can access /api/discrepancies/summary/admin via master access (200)');

    // 5. Tenant Isolation & Merchant Scoping
    console.log('\n5. Tenant Isolation & Merchant Scoping:');
    const m1SumRes = await fetch(`${GATEWAY_URL}/api/discrepancies/summary/merchant`, { headers: { Authorization: `Bearer ${m1Token}` } });
    assert(m1SumRes.status === 200, 'Merchant 1 can access /api/discrepancies/summary/merchant');
    const m1Sum = await m1SumRes.json();

    const m2SumRes = await fetch(`${GATEWAY_URL}/api/discrepancies/summary/merchant`, { headers: { Authorization: `Bearer ${m2Token}` } });
    assert(m2SumRes.status === 200, 'Merchant 2 can access /api/discrepancies/summary/merchant');
    const m2Sum = await m2SumRes.json();

    assert('todays_sales' in m1Sum && 'inventory' in m1Sum && 'recent_sales' in m1Sum, 'Merchant 1 summary contains complete expected structure');
    assert('todays_sales' in m2Sum && 'inventory' in m2Sum && 'recent_sales' in m2Sum, 'Merchant 2 summary contains complete expected structure');

    // Spoofing attempt: Merchant 1 supplies ?merchant_id=2
    const spoofedRes = await fetch(`${GATEWAY_URL}/api/discrepancies/summary/merchant?merchant_id=2`, {
      headers: { Authorization: `Bearer ${m1Token}` }
    });
    const spoofedData = await spoofedRes.json();
    assert(JSON.stringify(spoofedData) === JSON.stringify(m1Sum), 'Spoofed merchant_id=2 parameter is strictly ignored and bound to Merchant 1 token');

    // Merchant Revenue isolation
    const m1RevRes = await fetch(`${GATEWAY_URL}/api/discrepancies/revenue?merchant_id=2`, {
      headers: { Authorization: `Bearer ${m1Token}` }
    });
    assert(m1RevRes.status === 200, 'Merchant 1 can access /api/discrepancies/revenue');
    const m1Rev = await m1RevRes.json();
    assert(Array.isArray(m1Rev) && m1Rev.length === 1 && m1Rev[0].merchant_id === 1, 'Merchant 1 revenue report scoped strictly to merchant_id=1');

    const m2RevRes = await fetch(`${GATEWAY_URL}/api/discrepancies/revenue`, {
      headers: { Authorization: `Bearer ${m2Token}` }
    });
    assert(m2RevRes.status === 200, 'Merchant 2 can access /api/discrepancies/revenue');
    const m2Rev = await m2RevRes.json();
    assert(Array.isArray(m2Rev) && m2Rev.length === 1 && m2Rev[0].merchant_id === 2, 'Merchant 2 revenue report scoped strictly to merchant_id=2');

    // Admin revenue report with and without filter
    const adminRevAllRes = await fetch(`${GATEWAY_URL}/api/discrepancies/revenue`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(adminRevAllRes.status === 200, 'Admin can view cooperative-wide revenue report');
    const adminRevAll = await adminRevAllRes.json();
    assert(Array.isArray(adminRevAll) && adminRevAll.length >= 2, 'Admin revenue report includes all active merchants');

    const adminRevM2Res = await fetch(`${GATEWAY_URL}/api/discrepancies/revenue?merchant_id=2`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const adminRevM2 = await adminRevM2Res.json();
    assert(Array.isArray(adminRevM2) && adminRevM2.length === 1 && adminRevM2[0].merchant_id === 2, 'Admin can filter revenue report by merchant_id=2');

    // Admin discrepancy filters
    const adminPayM1Res = await fetch(`${GATEWAY_URL}/api/discrepancies/payment?merchant_id=1`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const adminPayM1 = await adminPayM1Res.json();
    assert(Array.isArray(adminPayM1) && adminPayM1.every(r => r.merchant_id === 1), 'Admin can filter payment discrepancies by merchant_id=1');

    const adminStockM1Res = await fetch(`${GATEWAY_URL}/api/discrepancies/stock?merchant_id=1`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const adminStockM1 = await adminStockM1Res.json();
    assert(Array.isArray(adminStockM1) && adminStockM1.every(r => r.merchant_id === 1), 'Admin can filter stock discrepancies by merchant_id=1');

    // 6. Mathematical Report Calculations & Database View Audits
    console.log('\n6. Mathematical Report Calculations & Database View Audits:');
    const payRows = await adminPay.json();
    assert(Array.isArray(payRows), 'Payment discrepancy response is an array');
    if (payRows.length > 0) {
      const p = payRows[0];
      assert('shop_name' in p && 'merchant_id' in p && 'total_sales' in p && 'total_successful_payments' in p && 'discrepancy' in p,
        'Payment discrepancy row contains all expected fields');
      const expectedDiff = Number((Number(p.total_sales) - Number(p.total_successful_payments)).toFixed(2));
      const actualDiff = Number(Number(p.discrepancy).toFixed(2));
      assert(expectedDiff === actualDiff, `Payment discrepancy math verified (${p.total_sales} - ${p.total_successful_payments} = ${p.discrepancy})`);
    }

    const stockRows = await adminStock.json();
    assert(Array.isArray(stockRows), 'Stock discrepancy response is an array');
    if (stockRows.length > 0) {
      const s = stockRows[0];
      assert('shop_name' in s && 'merchant_id' in s && 'product_id' in s && 'product_name' in s && 'expected_stock' in s && 'actual_stock' in s && 'discrepancy' in s,
        'Stock discrepancy row contains all expected fields');
      const expectedDiff = Number((Number(s.expected_stock) - Number(s.actual_stock)).toFixed(2));
      const actualDiff = Number(Number(s.discrepancy).toFixed(2));
      assert(expectedDiff === actualDiff, `Stock discrepancy math verified (${s.expected_stock} - ${s.actual_stock} = ${s.discrepancy})`);
    }

    const adminSumData = await adminSum.json();
    assert('total_merchants' in adminSumData && 'total_sales' in adminSumData && 'total_revenue' in adminSumData && 'payment_discrepancies' in adminSumData && 'stock_discrepancies' in adminSumData,
      'Admin summary structure matches specification completely');

    // 7. Monolith vs Reporting Service API Contract Parity
    console.log('\n7. Monolith vs Reporting Service Contract Parity:');
    const monoPayRes = await fetch(`${MONOLITH_URL}/api/discrepancies/payment`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const monoPay = await monoPayRes.json();
    const repPayRes = await fetch(`${REPORTING_URL}/api/discrepancies/payment`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const repPay = await repPayRes.json();
    assert(monoPayRes.status === repPayRes.status, 'Payment discrepancy status codes match (Monolith vs Reporting Service)');
    assert(JSON.stringify(monoPay) === JSON.stringify(repPay), 'Payment discrepancy payload matches 100% (Monolith vs Reporting Service)');

    const monoStockRes = await fetch(`${MONOLITH_URL}/api/discrepancies/stock`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const monoStock = await monoStockRes.json();
    const repStockRes = await fetch(`${REPORTING_URL}/api/discrepancies/stock`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const repStock = await repStockRes.json();
    assert(monoStockRes.status === repStockRes.status, 'Stock discrepancy status codes match (Monolith vs Reporting Service)');
    assert(JSON.stringify(monoStock) === JSON.stringify(repStock), 'Stock discrepancy payload matches 100% (Monolith vs Reporting Service)');

    const monoAdminSumRes = await fetch(`${MONOLITH_URL}/api/discrepancies/summary/admin`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const monoAdminSum = await monoAdminSumRes.json();
    const repAdminSumRes = await fetch(`${REPORTING_URL}/api/discrepancies/summary/admin`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const repAdminSum = await repAdminSumRes.json();
    assert(monoAdminSumRes.status === repAdminSumRes.status, 'Admin summary status codes match (Monolith vs Reporting Service)');
    assert(JSON.stringify(monoAdminSum) === JSON.stringify(repAdminSum), 'Admin summary payload matches 100% (Monolith vs Reporting Service)');

    const monoM1SumRes = await fetch(`${MONOLITH_URL}/api/discrepancies/summary/merchant`, { headers: { Authorization: `Bearer ${m1Token}` } });
    const monoM1Sum = await monoM1SumRes.json();
    const repM1SumRes = await fetch(`${REPORTING_URL}/api/discrepancies/summary/merchant`, { headers: { Authorization: `Bearer ${m1Token}` } });
    const repM1Sum = await repM1SumRes.json();
    assert(monoM1SumRes.status === repM1SumRes.status, 'Merchant summary status codes match (Monolith vs Reporting Service)');
    assert(JSON.stringify(monoM1Sum) === JSON.stringify(repM1Sum), 'Merchant summary payload matches 100% (Monolith vs Reporting Service)');

    // 8. Read-Only Guarantee & SQL Injection Safety
    console.log('\n8. Read-Only Enforcement & SQL Injection Safety:');
    const postPay = await fetch(`${GATEWAY_URL}/api/discrepancies/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ malicious: 'write' })
    });
    assert(postPay.status === 405, 'POST to /api/discrepancies/payment rejected with 405 Method Not Allowed');

    const putStock = await fetch(`${GATEWAY_URL}/api/discrepancies/stock`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ malicious: 'write' })
    });
    assert(putStock.status === 405, 'PUT to /api/discrepancies/stock rejected with 405 Method Not Allowed');

    const deleteSum = await fetch(`${GATEWAY_URL}/api/discrepancies/summary/admin`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(deleteSum.status === 405, 'DELETE to /api/discrepancies/summary/admin rejected with 405 Method Not Allowed');

    const sqliRes = await fetch(`${GATEWAY_URL}/api/discrepancies/payment?merchant_id=1%27%20OR%20%271%27=%271`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(sqliRes.status === 400, 'SQL injection attempt in query parameter safely rejected with 400 Bad Request');

    // 9. API Gateway Error Handling & Fallback
    console.log('\n9. API Gateway Error Handling & Downstream Failure:');
    const notFoundRes = await fetch(`${GATEWAY_URL}/api/nonexistent-route-testing-404`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(notFoundRes.status === 404, 'Nonexistent gateway path cleanly returns 404');

    // 10. Data Integrity Audit
    console.log('\n10. Data Integrity Post-Run Audit:');
    const [[invCountAfter]] = await pool.query('SELECT COUNT(*) as c, SUM(quantity_available) as sum_qty FROM inventory');
    const [[salesCountAfter]] = await pool.query('SELECT COUNT(*) as c, SUM(total_amount) as sum_amount FROM sales');
    const [[payCountAfter]] = await pool.query('SELECT COUNT(*) as c, SUM(amount) as sum_amount FROM payments');
    const [[merchCountAfter]] = await pool.query('SELECT COUNT(*) as c FROM merchants');
    const [[prodCountAfter]] = await pool.query('SELECT COUNT(*) as c FROM products');
    const [[sagaCountAfter]] = await pool.query('SELECT COUNT(*) as c FROM saga_instances');

    assert(invCountBefore.c === invCountAfter.c && invCountBefore.sum_qty === invCountAfter.sum_qty, 'Inventory balances completely untouched by reporting operations');
    assert(salesCountBefore.c === salesCountAfter.c && salesCountBefore.sum_amount === salesCountAfter.sum_amount, 'Sales records completely untouched by reporting operations');
    assert(payCountBefore.c === payCountAfter.c && payCountBefore.sum_amount === payCountAfter.sum_amount, 'Payment records completely untouched by reporting operations');
    assert(merchCountBefore.c === merchCountAfter.c, 'Merchants table completely untouched by reporting operations');
    assert(prodCountBefore.c === prodCountAfter.c, 'Products table completely untouched by reporting operations');
    assert(sagaCountBefore.c === sagaCountAfter.c, 'Saga instances table completely untouched by reporting operations');

    // 11. Steps 2–10 End-to-End Regression Suite
    console.log('\n11. Steps 2–10 End-to-End Microservices Regression Suite:');
    // Step 2: Auth Service
    const meRes = await fetch(`${GATEWAY_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(meRes.status === 200, 'Step 2: Auth Service /api/auth/me returns 200');

    // Step 3: Merchant Service
    const merchRes = await fetch(`${GATEWAY_URL}/api/merchants`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(merchRes.status === 200, 'Step 3: Merchant Service /api/merchants returns 200');

    // Step 4: Product Service
    const prodRes = await fetch(`${GATEWAY_URL}/api/products`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(prodRes.status === 200, 'Step 4: Product Service /api/products returns 200');

    // Step 5: Inventory Service
    const invRes = await fetch(`${GATEWAY_URL}/api/inventory`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(invRes.status === 200, 'Step 5: Inventory Service /api/inventory returns 200');

    // Step 6: Sales Service
    const salesRes = await fetch(`${GATEWAY_URL}/api/sales`, { headers: { Authorization: `Bearer ${m1Token}` } });
    assert(salesRes.status === 200, 'Step 6: Sales Service /api/sales returns 200');

    // Step 7: Invoices
    const invListRes = await fetch(`${GATEWAY_URL}/api/invoices`, { headers: { Authorization: `Bearer ${m1Token}` } });
    assert(invListRes.status === 200, 'Step 7: Sales Service /api/invoices returns 200');

    // Step 8: Payment Service
    const payListRes = await fetch(`${GATEWAY_URL}/api/payments`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(payListRes.status === 200, 'Step 8: Payment Service /api/payments returns 200');

    // Step 9: Distributed Sales Saga (CASH)
    const newSaleRes = await fetch(`${GATEWAY_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({
        items: [{ product_id: 1, quantity: 1 }],
        payment_method: 'CASH'
      })
    });
    assert(newSaleRes.status === 201, 'Step 9: Distributed Sales Saga (CASH) creates sale & invoice (201)');

    // Step 10: Payment compensation & refund handling
    const refundCompRes = await fetch(`${PAYMENT_URL}/api/payments/cashfree/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        order_id: `test_nonexistent_${Date.now()}`,
        refund_amount: 50,
        refund_id: `ref_s11_${Date.now()}`
      })
    });
    assert(refundCompRes.status === 200, 'Step 10: Payment compensation refund endpoint handles simulated order');

  } catch (err) {
    console.error('Fatal Test Suite Error:', err);
    failed++;
  } finally {
    await pool.end();
    for (const p of spawnedProcesses) {
      try { p.kill(); } catch (e) {}
    }
  }

  console.log('\n====================================================');
  console.log(`STEP 11 AUDIT SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runStep11Tests();
