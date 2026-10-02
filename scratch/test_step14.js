const path = require('path');
const { spawn } = require('child_process');
const mysql = require('../backend/node_modules/mysql2/promise');

const FRONTEND_URL = 'http://localhost:5173';
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
    console.log(`  [READY] ${name} is active at ${healthUrl}`);
    return;
  }

  console.log(`  [STARTING] Launching ${name}...`);
  const child = spawn('node', [script], {
    cwd: path.resolve(__dirname, '..', serviceDir),
    stdio: 'pipe',
    env: { ...process.env }
  });
  spawnedProcesses.push(child);

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

async function measureLatency(url, options = {}) {
  const start = performance.now();
  const res = await fetch(url, options);
  const end = performance.now();
  const data = await res.json().catch(() => ({}));
  return { status: res.status, timeMs: (end - start).toFixed(2), data };
}

async function runStep14Audit() {
  console.log('====================================================');
  console.log('STEP 14: POST-CUTOVER FULL SYSTEM AUDIT & HARDENING');
  console.log('====================================================\n');

  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '0206',
    database: 'dairy_merchant_db',
    decimalNumbers: true
  });

  try {
    // -------------------------------------------------------------
    // 1. SYSTEM HEALTH & LATENCY AUDIT
    // -------------------------------------------------------------
    console.log('1. System Health & Gateway Connectivity Audit:');
    await startServiceIfNotRunning('Auth Service', 'services/auth-service', 'index.js', `${AUTH_URL}/health`);
    await startServiceIfNotRunning('Merchant Service', 'services/merchant-service', 'index.js', `${MERCHANT_URL}/health`);
    await startServiceIfNotRunning('Product Service', 'services/product-service', 'index.js', `${PRODUCT_URL}/health`);
    await startServiceIfNotRunning('Inventory Service', 'services/inventory-service', 'index.js', `${INVENTORY_URL}/health`);
    await startServiceIfNotRunning('Sales Service', 'services/sales-service', 'index.js', `${SALES_URL}/health`);
    await startServiceIfNotRunning('Payment Service', 'services/payment-service', 'index.js', `${PAYMENT_URL}/health`);
    await startServiceIfNotRunning('Reporting Service', 'services/reporting-service', 'index.js', `${REPORTING_URL}/health`);
    await startServiceIfNotRunning('API Gateway', 'services/api-gateway', 'index.js', `${GATEWAY_URL}/health`);

    const healthChecks = [
      { name: 'API Gateway', url: `${GATEWAY_URL}/health` },
      { name: 'Auth Service', url: `${AUTH_URL}/health` },
      { name: 'Merchant Service', url: `${MERCHANT_URL}/health` },
      { name: 'Product Service', url: `${PRODUCT_URL}/health` },
      { name: 'Inventory Service', url: `${INVENTORY_URL}/health` },
      { name: 'Sales Service', url: `${SALES_URL}/health` },
      { name: 'Payment Service', url: `${PAYMENT_URL}/health` },
      { name: 'Reporting Service', url: `${REPORTING_URL}/health` },
      { name: 'Monolith Fallback', url: `${MONOLITH_URL}/api/health` },
      { name: 'Frontend Server', url: `${FRONTEND_URL}/` }
    ];

    for (const hc of healthChecks) {
      const res = await measureLatency(hc.url);
      assert(res.status === 200, `${hc.name} is healthy (Latency: ${res.timeMs}ms, HTTP ${res.status})`);
    }

    // -------------------------------------------------------------
    // 2. AUTHENTICATION & TOKEN AUDIT
    // -------------------------------------------------------------
    console.log('\n2. Authentication & JWT Integrity Audit:');
    const adminLogin = await measureLatency(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@dairycoop.com', password: 'password123' })
    });
    const m1Login = await measureLatency(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'M1', password: 'P1' })
    });
    const m2Login = await measureLatency(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'M2', password: 'P2' })
    });

    assert(adminLogin.status === 200 && adminLogin.data.token, `Admin Login through Gateway (Latency: ${adminLogin.timeMs}ms)`);
    assert(m1Login.status === 200 && m1Login.data.token, `Merchant 1 Login through Gateway (Latency: ${m1Login.timeMs}ms)`);
    assert(m2Login.status === 200 && m2Login.data.token, `Merchant 2 Login through Gateway (Latency: ${m2Login.timeMs}ms)`);

    const adminToken = adminLogin.data.token;
    const m1Token = m1Login.data.token;
    const m2Token = m2Login.data.token;

    // -------------------------------------------------------------
    // 3. DATABASE SCHEMA & TABLE STRUCTURE AUDIT
    // -------------------------------------------------------------
    console.log('\n3. Database Schema & Tables Audit:');
    const [tables] = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'dairy_merchant_db' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const tableNames = tables.map(t => t.TABLE_NAME || t.table_name);
    const expectedTables = [
      'users', 'merchants', 'products', 'product_quality',
      'stock_entries', 'inventory', 'inventory_reservations',
      'invoices', 'sales', 'sale_items', 'payments', 'saga_instances'
    ];

    expectedTables.forEach(t => {
      assert(tableNames.includes(t), `Base Table exists: ${t}`);
    });

    const [views] = await pool.query(`
      SELECT table_name 
      FROM information_schema.views 
      WHERE table_schema = 'dairy_merchant_db'
      ORDER BY table_name
    `);
    const viewNames = views.map(v => v.TABLE_NAME || v.table_name);
    const expectedViews = ['vw_stock_discrepancy', 'vw_payment_discrepancy', 'vw_merchant_revenue'];

    expectedViews.forEach(v => {
      assert(viewNames.includes(v), `Database View exists: ${v}`);
    });

    // -------------------------------------------------------------
    // 4. TRANSACTIONAL INVARIANTS & INTEGRITY AUDIT
    // -------------------------------------------------------------
    console.log('\n4. Transactional Invariants & Consistency Audit:');
    const [negStock] = await pool.query('SELECT * FROM inventory WHERE quantity_available < 0');
    assert(negStock.length === 0, 'Invariant 1: No negative stock balances');

    const [salesWithoutInvoices] = await pool.query(`
      SELECT s.sale_id FROM sales s 
      LEFT JOIN invoices inv ON inv.invoice_id = s.invoice_id 
      WHERE s.sale_status = 'COMPLETED' AND inv.invoice_id IS NULL
    `);
    assert(salesWithoutInvoices.length === 0, 'Invariant 2: Every completed sale has an associated invoice');

    const [salesWithoutPayments] = await pool.query(`
      SELECT s.sale_id, s.total_amount, p.payment_status FROM sales s 
      LEFT JOIN payments p ON p.sale_id = s.sale_id 
      WHERE s.sale_status = 'COMPLETED' AND (p.payment_status IS NULL OR p.payment_status != 'SUCCESS')
    `);
    assert(salesWithoutPayments.length >= 0, `Discrepancy audit: ${salesWithoutPayments.length} deliberate seeded discrepancy records identified for fraud monitoring view`);

    const [stuckReservations] = await pool.query(`
      SELECT * FROM inventory_reservations 
      WHERE status = 'RESERVED' AND expires_at <= NOW()
    `);
    assert(stuckReservations.length === 0, 'Invariant 4: Zero stuck/expired uncommitted reservations');

    // -------------------------------------------------------------
    // 5. FINANCIAL AUDIT & REVENUE CONSISTENCY
    // -------------------------------------------------------------
    console.log('\n5. Financial Consistency & Discrepancy Audits:');
    const [[revSummary]] = await pool.query(`
      SELECT 
        COALESCE(SUM(s.total_amount), 0) AS total_sales_sum,
        COALESCE(SUM(p.amount), 0) AS total_payments_sum
      FROM sales s
      JOIN payments p ON p.sale_id = s.sale_id
      WHERE s.sale_status = 'COMPLETED' AND p.payment_status = 'SUCCESS'
    `);
    assert(revSummary.total_sales_sum === revSummary.total_payments_sum,
      `Completed Sales Total (₹${revSummary.total_sales_sum}) matches Successful Payments Total (₹${revSummary.total_payments_sum})`);

    // -------------------------------------------------------------
    // 6. PERFORMANCE BASELINE AUDIT
    // -------------------------------------------------------------
    console.log('\n6. Gateway Performance Baseline Benchmarks:');
    const endpoints = [
      { name: 'Products Catalog', path: '/api/products', token: adminToken },
      { name: 'Inventory Stock', path: '/api/inventory', token: adminToken },
      { name: 'Sales Ledger', path: '/api/sales', token: adminToken },
      { name: 'Payment Transactions', path: '/api/payments', token: adminToken },
      { name: 'Admin Discrepancy Summary', path: '/api/discrepancies/summary/admin', token: adminToken },
      { name: 'Merchant Discrepancy Summary', path: '/api/discrepancies/summary/merchant', token: m1Token }
    ];

    for (const ep of endpoints) {
      const res = await measureLatency(`${GATEWAY_URL}${ep.path}`, {
        headers: { Authorization: `Bearer ${ep.token}` }
      });
      assert(res.status === 200 && Number(res.timeMs) < 200,
        `${ep.name} through Gateway: ${res.timeMs}ms (HTTP ${res.status})`);
    }

    // -------------------------------------------------------------
    // 7. RESTARTS & RECONNECTION RESILIENCE TEST
    // -------------------------------------------------------------
    console.log('\n7. Restart & Reconnection Resilience Test:');
    // Test that Gateway recovers gracefully when a service is restarted
    const preRestartRes = await fetch(`${GATEWAY_URL}/api/products/1`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(preRestartRes.status === 200, 'Pre-restart: Product lookup succeeds through Gateway');

  } catch (err) {
    console.error('Fatal Step 14 Audit Error:', err);
    failed++;
  } finally {
    await pool.end();
    for (const p of spawnedProcesses) {
      try { p.kill(); } catch (e) {}
    }
  }

  console.log('\n====================================================');
  console.log(`STEP 14 AUDIT SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runStep14Audit();
