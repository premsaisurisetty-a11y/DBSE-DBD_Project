const mysql = require('../backend/node_modules/mysql2/promise');
const { spawn, execSync } = require('child_process');
const path = require('path');

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
  return { status: res.status, timeMs: (end - start).toFixed(2), data, headers: res.headers };
}

async function runStep16Decommissioning() {
  console.log('=============================================================');
  console.log('STEP 16: MONOLITH DECOMMISSIONING & FINAL SYSTEM VALIDATION');
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
    // 1. POST-DECOMMISSIONING ARCHITECTURE & HEALTH VERIFICATION
    // -------------------------------------------------------------
    console.log('1. Post-Decommissioning Service Cluster Health:');
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
      assert(res.status === 200, `${s.name} is healthy (Latency: ${res.timeMs}ms, HTTP ${res.status})`);
    }

    // Verify Monolith is completely offline
    let monolithOffline = false;
    try {
      await measureRequest(`${MONOLITH_URL}/api/health`);
    } catch (e) {
      monolithOffline = true;
    }
    assert(monolithOffline, `Monolith :5000 is confirmed STOPPED and offline`);

    // Verify unmapped route returns 404 from Gateway
    const unmappedRes = await measureRequest(`${GATEWAY_URL}/api/unknown-retired-endpoint-99`);
    assert(unmappedRes.status === 404, `Unmapped Gateway route returns 404 Not Found (Zero fallback to :5000)`);

    // -------------------------------------------------------------
    // 2. AUTHENTICATION & SESSION VERIFICATION
    // -------------------------------------------------------------
    console.log('\n2. Authentication & Session Verification:');
    const adminLogin = await measureRequest(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@dairycoop.com', password: 'password123' })
    });
    assert(adminLogin.status === 200 && adminLogin.data.token, `Admin Login -> Auth Service :4001 (${adminLogin.timeMs}ms)`);
    const adminToken = adminLogin.data.token;

    const m1Login = await measureRequest(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'M1', password: 'P1' })
    });
    assert(m1Login.status === 200 && m1Login.data.token, `Merchant 1 Login -> Auth Service :4001 (${m1Login.timeMs}ms)`);
    const m1Token = m1Login.data.token;

    const m2Login = await measureRequest(`${GATEWAY_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'M2', password: 'P2' })
    });
    assert(m2Login.status === 200 && m2Login.data.token, `Merchant 2 Login -> Auth Service :4001 (${m2Login.timeMs}ms)`);
    const m2Token = m2Login.data.token;

    const meRes = await measureRequest(`${GATEWAY_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(meRes.status === 200 && meRes.data.user.email === 'admin@dairycoop.com', `GET /api/auth/me resolves session successfully`);

    // -------------------------------------------------------------
    // 3. COMPLETE ADMIN FRONTEND FLOWS
    // -------------------------------------------------------------
    console.log('\n3. Admin Frontend Flows Verification:');
    const adminDash = await measureRequest(`${GATEWAY_URL}/api/discrepancies/summary/admin`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminDash.status === 200, `Admin Dashboard metrics -> Reporting :4007 (${adminDash.timeMs}ms)`);

    const adminMerchants = await measureRequest(`${GATEWAY_URL}/api/merchants`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminMerchants.status === 200, `Admin Merchants catalog -> Merchant :4002 (${adminMerchants.timeMs}ms)`);

    const adminProducts = await measureRequest(`${GATEWAY_URL}/api/products`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminProducts.status === 200, `Admin Products catalog -> Product :4003 (${adminProducts.timeMs}ms)`);

    const adminInventory = await measureRequest(`${GATEWAY_URL}/api/inventory`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminInventory.status === 200, `Admin Inventory ledger -> Inventory :4004 (${adminInventory.timeMs}ms)`);

    const adminSales = await measureRequest(`${GATEWAY_URL}/api/sales`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminSales.status === 200, `Admin Sales ledger -> Sales :4005 (${adminSales.timeMs}ms)`);

    const adminPayments = await measureRequest(`${GATEWAY_URL}/api/payments`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminPayments.status === 200, `Admin Payments ledger -> Payment :4006 (${adminPayments.timeMs}ms)`);

    const adminDiscPay = await measureRequest(`${GATEWAY_URL}/api/discrepancies/payment`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminDiscPay.status === 200, `Admin Payment Discrepancies -> Reporting :4007 (${adminDiscPay.timeMs}ms)`);

    const adminDiscStock = await measureRequest(`${GATEWAY_URL}/api/discrepancies/stock`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(adminDiscStock.status === 200, `Admin Stock Discrepancies -> Reporting :4007 (${adminDiscStock.timeMs}ms)`);

    // -------------------------------------------------------------
    // 4. COMPLETE MERCHANT FRONTEND FLOWS
    // -------------------------------------------------------------
    console.log('\n4. Merchant Frontend Flows Verification:');
    const mDash = await measureRequest(`${GATEWAY_URL}/api/discrepancies/summary/merchant`, {
      headers: { Authorization: `Bearer ${m1Token}` }
    });
    assert(mDash.status === 200, `Merchant Dashboard metrics -> Reporting :4007 (${mDash.timeMs}ms)`);

    const mInv = await measureRequest(`${GATEWAY_URL}/api/inventory`, {
      headers: { Authorization: `Bearer ${m1Token}` }
    });
    assert(mInv.status === 200, `Merchant Inventory -> Inventory :4004 (${mInv.timeMs}ms)`);

    const mProd = await measureRequest(`${GATEWAY_URL}/api/products`, {
      headers: { Authorization: `Bearer ${m1Token}` }
    });
    assert(mProd.status === 200, `Merchant Products catalog -> Product :4003 (${mProd.timeMs}ms)`);

    const mInvList = await measureRequest(`${GATEWAY_URL}/api/invoices`, {
      headers: { Authorization: `Bearer ${m1Token}` }
    });
    assert(mInvList.status === 200, `Merchant Invoices list -> Sales :4005 (${mInvList.timeMs}ms)`);

    const mSales = await measureRequest(`${GATEWAY_URL}/api/sales`, {
      headers: { Authorization: `Bearer ${m1Token}` }
    });
    assert(mSales.status === 200, `Merchant Sales history -> Sales :4005 (${mSales.timeMs}ms)`);

    const mPay = await measureRequest(`${GATEWAY_URL}/api/payments`, {
      headers: { Authorization: `Bearer ${m1Token}` }
    });
    assert(mPay.status === 200, `Merchant Payments history -> Payment :4006 (${mPay.timeMs}ms)`);

    // -------------------------------------------------------------
    // 5. CONTROLLED CASH SALE DISTRIBUTED SAGA
    // -------------------------------------------------------------
    console.log('\n5. Controlled CASH Sale Distributed Saga:');
    const [[invBefore]] = await pool.query('SELECT quantity_available FROM inventory WHERE merchant_id = 1 AND product_id = 1');
    const saleRes = await measureRequest(`${GATEWAY_URL}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m1Token}`,
        'Idempotency-Key': `decom_sale_${Date.now()}`
      },
      body: JSON.stringify({
        items: [{ product_id: 1, quantity: 1 }],
        payment_method: 'CASH',
        customer_name: 'Decommissioning Verification Buyer',
        customer_phone: '9988776655'
      })
    });
    assert(saleRes.status === 201 && saleRes.data.sale_id, `Controlled CASH Sale completed with HTTP 201 (${saleRes.timeMs}ms)`);
    const saleId = saleRes.data.sale_id;

    const [[invAfter]] = await pool.query('SELECT quantity_available FROM inventory WHERE merchant_id = 1 AND product_id = 1');
    assert(invBefore.quantity_available - invAfter.quantity_available === 1, `Inventory for Product 1 decremented by exactly 1 unit`);

    const singleSale = await measureRequest(`${GATEWAY_URL}/api/sales/${saleId}`, {
      headers: { Authorization: `Bearer ${m1Token}` }
    });
    assert(singleSale.status === 200 && singleSale.data.invoice_id, `Generated invoice linked to sale`);

    // -------------------------------------------------------------
    // 6. SECURITY & NEGATIVE TESTS
    // -------------------------------------------------------------
    console.log('\n6. Security & Negative Tests (Zero Fallback):');
    const unauthRes = await measureRequest(`${GATEWAY_URL}/api/products`);
    assert(unauthRes.status === 401, `Missing JWT returns 401 Unauthorized`);

    const badTokenRes = await measureRequest(`${GATEWAY_URL}/api/auth/me`, {
      headers: { Authorization: 'Bearer INVALID_JWT_TOKEN' }
    });
    assert(badTokenRes.status === 401, `Invalid JWT returns 401 Unauthorized`);

    const forbidRes = await measureRequest(`${GATEWAY_URL}/api/merchants`, {
      headers: { Authorization: `Bearer ${m1Token}` }
    });
    assert(forbidRes.status === 403, `Merchant accessing admin endpoint returns 403 Forbidden`);

    const crossTenantRes = await measureRequest(`${GATEWAY_URL}/api/sales/${saleId}`, {
      headers: { Authorization: `Bearer ${m2Token}` }
    });
    assert(crossTenantRes.status === 404, `Cross-merchant tenant access returns 404 Not Found`);

    const notFoundProd = await measureRequest(`${GATEWAY_URL}/api/products/999999`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(notFoundProd.status === 404, `Nonexistent product ID returns 404 Not Found`);

    const overStockSale = await measureRequest(`${GATEWAY_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({ items: [{ product_id: 1, quantity: 999999 }], payment_method: 'CASH' })
    });
    assert(overStockSale.status === 400, `Insufficient stock returns 400 Bad Request`);

    const zeroQtySale = await measureRequest(`${GATEWAY_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({ items: [{ product_id: 1, quantity: 0 }], payment_method: 'CASH' })
    });
    assert(zeroQtySale.status === 400, `Zero quantity returns 400 Bad Request`);

    // -------------------------------------------------------------
    // 7. DATABASE INTEGRITY VERIFICATION
    // -------------------------------------------------------------
    console.log('\n7. Database Invariants Verification:');
    const [negStock] = await pool.query('SELECT * FROM inventory WHERE quantity_available < 0');
    assert(negStock.length === 0, `Zero negative inventory records across all warehouses`);

    const [salesWithoutInvoices] = await pool.query(`
      SELECT s.sale_id FROM sales s 
      LEFT JOIN invoices inv ON inv.invoice_id = s.invoice_id 
      WHERE s.sale_status = 'COMPLETED' AND inv.invoice_id IS NULL
    `);
    assert(salesWithoutInvoices.length === 0, `100% of completed sales have associated tax invoices`);

    const [stuckReservations] = await pool.query("SELECT COUNT(*) as cnt FROM inventory_reservations WHERE status = 'RESERVED' AND expires_at < NOW()");
    assert(stuckReservations[0].cnt === 0, `Zero stuck/expired active reservations`);

    const [orphanSagas] = await pool.query("SELECT COUNT(*) as cnt FROM saga_instances WHERE saga_status NOT IN ('COMPLETED', 'COMPENSATED', 'FAILED')");
    assert(orphanSagas[0].cnt === 0, `Zero orphaned active Sagas`);

  } catch (err) {
    console.error('Step 16 Decommissioning Error:', err);
    failed++;
  } finally {
    await pool.end();
  }

  console.log('\n=============================================================');
  console.log(`STEP 16 RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runStep16Decommissioning();
