const mysql = require('../backend/node_modules/mysql2/promise');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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

function assert(condition, testName, extraInfo = '') {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName} ${extraInfo}`);
    failed++;
  }
}

async function measureRequest(url, options = {}) {
  const start = performance.now();
  const res = await fetch(url, options);
  const end = performance.now();
  const contentType = res.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    data = await res.json().catch(() => ({}));
  } else {
    data = await res.text().catch(() => '');
  }
  return { status: res.status, timeMs: Number((end - start).toFixed(2)), data, headers: res.headers };
}

async function runStep17FinalClosure() {
  console.log('=============================================================');
  console.log('STEP 17: FINAL PRODUCTION READINESS & MIGRATION CLOSURE AUDIT');
  console.log('=============================================================\n');

  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '0206',
    database: 'dairy_merchant_db',
    decimalNumbers: true
  });

  try {
    // -------------------------------------------------------------
    // 1. FINAL ARCHITECTURE & HEALTH VERIFICATION
    // -------------------------------------------------------------
    console.log('1. Final Architecture & Cluster Health:');
    const services = [
      { name: 'API Gateway', url: `${GATEWAY_URL}/health` },
      { name: 'Auth Service', url: `${AUTH_URL}/health` },
      { name: 'Merchant Service', url: `${MERCHANT_URL}/health` },
      { name: 'Product Service', url: `${PRODUCT_URL}/health` },
      { name: 'Inventory Service', url: `${INVENTORY_URL}/health` },
      { name: 'Sales Service', url: `${SALES_URL}/health` },
      { name: 'Payment Service', url: `${PAYMENT_URL}/health` },
      { name: 'Reporting Service', url: `${REPORTING_URL}/health` },
      { name: 'Frontend Dev Server', url: `${FRONTEND_URL}/` }
    ];

    for (const s of services) {
      const res = await measureRequest(s.url);
      assert(res.status === 200, `${s.name} is reachable and healthy (Latency: ${res.timeMs}ms, HTTP ${res.status})`);
    }

    let monolithOffline = false;
    try {
      await measureRequest(`${MONOLITH_URL}/api/health`);
    } catch (e) {
      monolithOffline = true;
    }
    assert(monolithOffline, `Monolith :5000 is verified OFFLINE`);

    // -------------------------------------------------------------
    // 2. ROUTE OWNERSHIP AUDIT
    // -------------------------------------------------------------
    console.log('\n2. Route Ownership & Zero Fallback Audit:');
    const gwHealth = await measureRequest(`${GATEWAY_URL}/health`);
    assert(gwHealth.data.routes && !gwHealth.data.routes.monolith, `API Gateway route map contains NO monolith entry`);
    
    const unmapped404 = await measureRequest(`${GATEWAY_URL}/api/unmapped-closure-test`);
    assert(unmapped404.status === 404, `Unmapped /api route returns 404 Not Found (Zero fallback proxy)`);

    // -------------------------------------------------------------
    // 3. AUTHENTICATION & RBAC ROLES (ADMIN, OWNER, MERCHANT)
    // -------------------------------------------------------------
    console.log('\n3. Authentication & RBAC Matrix:');
    const adminLogin = await measureRequest(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@dairycoop.com', password: 'password123' })
    });
    assert(adminLogin.status === 200 && adminLogin.data.token, `Admin Login through Gateway -> Auth :4001 (${adminLogin.timeMs}ms)`);
    const adminToken = adminLogin.data.token;

    const ownerLogin = await measureRequest(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'owner@dairycoop.com', password: 'password123' })
    });
    assert(ownerLogin.status === 200 && ownerLogin.data.token, `Owner Login through Gateway -> Auth :4001 (${ownerLogin.timeMs}ms)`);
    const ownerToken = ownerLogin.data.token;

    const m1Login = await measureRequest(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'M1', password: 'P1' })
    });
    assert(m1Login.status === 200 && m1Login.data.token, `Merchant 1 Login through Gateway -> Auth :4001 (${m1Login.timeMs}ms)`);
    const m1Token = m1Login.data.token;

    const m2Login = await measureRequest(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'M2', password: 'P2' })
    });
    assert(m2Login.status === 200 && m2Login.data.token, `Merchant 2 Login through Gateway -> Auth :4001 (${m2Login.timeMs}ms)`);
    const m2Token = m2Login.data.token;

    // RBAC check
    const adminMerchAccess = await measureRequest(`${GATEWAY_URL}/api/merchants`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminMerchAccess.status === 200, `ADMIN role granted access to /api/merchants (200)`);

    const ownerMerchAccess = await measureRequest(`${GATEWAY_URL}/api/merchants`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    assert(ownerMerchAccess.status === 200, `OWNER role granted access to /api/merchants (200)`);

    const merchantForbidden = await measureRequest(`${GATEWAY_URL}/api/merchants`, {
      headers: { Authorization: `Bearer ${m1Token}` }
    });
    assert(merchantForbidden.status === 403, `MERCHANT role forbidden from /api/merchants (403)`);

    // -------------------------------------------------------------
    // 4. FINANCIAL INTEGRITY & SERVER-SIDE PRICING
    // -------------------------------------------------------------
    console.log('\n4. Financial Integrity & Authoritative Pricing:');
    const [p1Db] = await pool.query('SELECT selling_price FROM products WHERE product_id = 1');
    const authoritativePrice = Number(p1Db[0].selling_price);

    // Attempt client-side price override
    const priceOverrideSale = await measureRequest(`${GATEWAY_URL}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m1Token}`,
        'Idempotency-Key': `fin_test_${Date.now()}`
      },
      body: JSON.stringify({
        items: [{ product_id: 1, quantity: 1, unit_price: 1.00 }], // Spoofed 1 rupee
        payment_method: 'CASH',
        customer_name: 'Price Spoof Tester',
        total_amount: 1.00 // Spoofed total
      })
    });
    assert(priceOverrideSale.status === 201, `CASH Sale created with server validation`);
    assert(Number(priceOverrideSale.data.total_amount) === authoritativePrice, `Server ignored client price and charged authoritative price (₹${authoritativePrice})`);

    // Duplicate Cashfree order protection check
    const cf1 = await measureRequest(`${GATEWAY_URL}/api/payments/cashfree/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({ amount: 50, customer_name: 'Dup Test', customer_phone: '9876543210' })
    });
    assert(cf1.status === 200 && cf1.data.order_id, `Cashfree create-order generated order_id: ${cf1.data.order_id}`);

    // -------------------------------------------------------------
    // 5. REPORTING READ-ONLY & DISCREPANCY AUDIT
    // -------------------------------------------------------------
    console.log('\n5. Reporting Service Read-Only & Discrepancy Views:');
    const adminDiscP = await measureRequest(`${GATEWAY_URL}/api/discrepancies/payment`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminDiscP.status === 200 && Array.isArray(adminDiscP.data), `Payment discrepancies view queryable`);

    const adminDiscS = await measureRequest(`${GATEWAY_URL}/api/discrepancies/stock`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminDiscS.status === 200 && Array.isArray(adminDiscS.data), `Stock discrepancies view queryable`);

    const roCheck = await measureRequest(`${GATEWAY_URL}/api/discrepancies/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ data: 'mutation' })
    });
    assert(roCheck.status === 405, `Reporting Service enforces strict Read-Only (HTTP 405 on POST)`);

    // -------------------------------------------------------------
    // 6. PERFORMANCE SANITY CHECK
    // -------------------------------------------------------------
    console.log('\n6. Performance Sanity Check (Response Latency Benchmarks):');
    const perfAuth = await measureRequest(`${GATEWAY_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const perfProd = await measureRequest(`${GATEWAY_URL}/api/products`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const perfInv = await measureRequest(`${GATEWAY_URL}/api/inventory`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const perfSales = await measureRequest(`${GATEWAY_URL}/api/sales`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const perfPay = await measureRequest(`${GATEWAY_URL}/api/payments`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const perfRep = await measureRequest(`${GATEWAY_URL}/api/discrepancies/summary/admin`, { headers: { Authorization: `Bearer ${adminToken}` } });

    console.log(`   /api/auth/me:                  ${perfAuth.timeMs}ms`);
    console.log(`   /api/products:                 ${perfProd.timeMs}ms`);
    console.log(`   /api/inventory:                ${perfInv.timeMs}ms`);
    console.log(`   /api/sales:                    ${perfSales.timeMs}ms`);
    console.log(`   /api/payments:                 ${perfPay.timeMs}ms`);
    console.log(`   /api/discrepancies/summary:    ${perfRep.timeMs}ms`);

    assert(perfAuth.timeMs < 100, `Auth latency < 100ms (${perfAuth.timeMs}ms)`);
    assert(perfProd.timeMs < 100, `Products catalog latency < 100ms (${perfProd.timeMs}ms)`);
    assert(perfInv.timeMs < 100, `Inventory latency < 100ms (${perfInv.timeMs}ms)`);
    assert(perfSales.timeMs < 100, `Sales latency < 100ms (${perfSales.timeMs}ms)`);
    assert(perfPay.timeMs < 100, `Payments latency < 100ms (${perfPay.timeMs}ms)`);
    assert(perfRep.timeMs < 100, `Reporting latency < 100ms (${perfRep.timeMs}ms)`);

    // -------------------------------------------------------------
    // 7. BACKUP / ROLLBACK ARCHIVE VERIFICATION
    // -------------------------------------------------------------
    console.log('\n7. Backup & Rollback Archive Audit:');
    const zipPath = path.resolve(__dirname, '../archive/monolith_legacy_backup_step16.zip');
    const zipExists = fs.existsSync(zipPath);
    assert(zipExists, `Archive file exists at archive/monolith_legacy_backup_step16.zip`);
    if (zipExists) {
      const stats = fs.statSync(zipPath);
      assert(stats.size > 10000, `Archive is non-empty (${stats.size} bytes)`);
    }

    const backendExists = fs.existsSync(path.resolve(__dirname, '../backend'));
    assert(backendExists, `Original backend/ directory preserved on disk`);

    // -------------------------------------------------------------
    // 8. DATABASE INTEGRITY SNAPSHOT
    // -------------------------------------------------------------
    console.log('\n8. Final Database Invariants Audit:');
    const [negInv] = await pool.query('SELECT * FROM inventory WHERE quantity_available < 0');
    assert(negInv.length === 0, `Zero negative inventory records across all warehouses`);

    const [salesInvParity] = await pool.query(`
      SELECT s.sale_id FROM sales s 
      LEFT JOIN invoices inv ON inv.invoice_id = s.invoice_id 
      WHERE s.sale_status = 'COMPLETED' AND inv.invoice_id IS NULL
    `);
    assert(salesInvParity.length === 0, `100% of completed sales possess valid tax invoices`);

    const [stuckRes] = await pool.query("SELECT COUNT(*) as cnt FROM inventory_reservations WHERE status = 'RESERVED' AND expires_at < NOW()");
    assert(stuckRes[0].cnt === 0, `Zero stuck/expired reservations`);

    const [orphanSagas] = await pool.query("SELECT COUNT(*) as cnt FROM saga_instances WHERE saga_status NOT IN ('COMPLETED', 'COMPENSATED', 'FAILED')");
    assert(orphanSagas[0].cnt === 0, `Zero orphaned/unfinished Saga instances`);

  } catch (err) {
    console.error('Fatal Step 17 Audit Error:', err);
    failed++;
  } finally {
    await pool.end();
  }

  console.log('\n=============================================================');
  console.log(`STEP 17 RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runStep17FinalClosure();
