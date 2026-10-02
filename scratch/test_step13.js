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

async function login(baseUrl, identifier, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password })
  });
  const data = await res.json();
  return { status: res.status, ...data };
}

async function runStep13Tests() {
  console.log('====================================================');
  console.log('STEP 13: FRONTEND -> API GATEWAY CUTOVER VALIDATION');
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
    // 1. SERVICE CLUSTER & FRONTEND HEALTH
    // -------------------------------------------------------------
    console.log('1. Service Cluster & Frontend Proxy Health Check:');
    await startServiceIfNotRunning('Auth Service', 'services/auth-service', 'index.js', `${AUTH_URL}/health`);
    await startServiceIfNotRunning('Merchant Service', 'services/merchant-service', 'index.js', `${MERCHANT_URL}/health`);
    await startServiceIfNotRunning('Product Service', 'services/product-service', 'index.js', `${PRODUCT_URL}/health`);
    await startServiceIfNotRunning('Inventory Service', 'services/inventory-service', 'index.js', `${INVENTORY_URL}/health`);
    await startServiceIfNotRunning('Sales Service', 'services/sales-service', 'index.js', `${SALES_URL}/health`);
    await startServiceIfNotRunning('Payment Service', 'services/payment-service', 'index.js', `${PAYMENT_URL}/health`);
    await startServiceIfNotRunning('Reporting Service', 'services/reporting-service', 'index.js', `${REPORTING_URL}/health`);
    await startServiceIfNotRunning('API Gateway', 'services/api-gateway', 'index.js', `${GATEWAY_URL}/health`);

    const monoHealthRes = await fetch(`${MONOLITH_URL}/api/health`);
    const monoHealth = await monoHealthRes.json();
    assert(monoHealthRes.status === 200 && monoHealth.status === 'OK', 'Monolith :5000 remains operational as fallback');

    const gwHealthRes = await fetch(`${GATEWAY_URL}/health`);
    const gwHealth = await gwHealthRes.json();
    assert(gwHealthRes.status === 200 && gwHealth.status === 'OK', 'API Gateway :4000 is operational');

    // Check Frontend Vite Dev Server
    const feRes = await fetch(`${FRONTEND_URL}/`);
    assert(feRes.status === 200, 'Frontend Vite dev server is running on port 5173');

    // -------------------------------------------------------------
    // 2. BROWSER-LEVEL AUTHENTICATION THROUGH FRONTEND PROXY
    // -------------------------------------------------------------
    console.log('\n2. Frontend-Proxied Authentication (/api/auth/* through :5173 -> :4000):');
    const adminLogin = await login(FRONTEND_URL, 'admin@dairycoop.com', 'password123');
    const ownerLogin = await login(FRONTEND_URL, 'owner@dairycoop.com', 'password123');
    const m1Login = await login(FRONTEND_URL, 'M1', 'P1');
    const m2Login = await login(FRONTEND_URL, 'M2', 'P2');

    assert(adminLogin.status === 200 && adminLogin.token && adminLogin.user.role === 'ADMIN', 'Admin authentication through Frontend -> Gateway succeeds');
    assert(ownerLogin.status === 200 && ownerLogin.token && ownerLogin.user.role === 'OWNER', 'Owner authentication through Frontend -> Gateway succeeds');
    assert(m1Login.status === 200 && m1Login.token && m1Login.user.role === 'MERCHANT', 'Merchant 1 authentication through Frontend -> Gateway succeeds');
    assert(m2Login.status === 200 && m2Login.token && m2Login.user.role === 'MERCHANT', 'Merchant 2 authentication through Frontend -> Gateway succeeds');

    const adminToken = adminLogin.token;
    const ownerToken = ownerLogin.token;
    const m1Token = m1Login.token;
    const m2Token = m2Login.token;

    // Session verification via /auth/me through Frontend proxy
    const meRes = await fetch(`${FRONTEND_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const meData = await meRes.json();
    assert(meRes.status === 200 && meData.user && meData.user.role === 'ADMIN', 'GET /api/auth/me resolves session through Frontend -> Gateway -> Auth Service');

    // Negative login test
    const badLogin = await login(FRONTEND_URL, 'admin@dairycoop.com', 'wrongpassword');
    assert(badLogin.status === 401, 'Invalid password through Frontend returns 401');

    // -------------------------------------------------------------
    // 3. ADMIN UI API CALLS THROUGH FRONTEND PROXY
    // -------------------------------------------------------------
    console.log('\n3. Admin UI Endpoints Through Frontend Proxy (:5173 -> :4000):');
    // Admin Dashboard Summary
    const adminDashRes = await fetch(`${FRONTEND_URL}/api/discrepancies/summary/admin`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const adminDash = await adminDashRes.json();
    assert(adminDashRes.status === 200 && 'total_merchants' in adminDash && 'total_sales' in adminDash,
      'Admin Dashboard summary metrics load successfully via Frontend');

    // Admin Merchants View
    const merchRes = await fetch(`${FRONTEND_URL}/api/merchants`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const merchData = await merchRes.json();
    assert(merchRes.status === 200 && Array.isArray(merchData) && merchData.length >= 2,
      'Admin Merchants table loads successfully via Frontend');

    // Admin Products View
    const prodRes = await fetch(`${FRONTEND_URL}/api/products`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const prodData = await prodRes.json();
    assert(prodRes.status === 200 && Array.isArray(prodData) && prodData.length > 0,
      'Admin Products table loads successfully via Frontend');

    // Admin Inventory View
    const invRes = await fetch(`${FRONTEND_URL}/api/inventory`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const invData = await invRes.json();
    assert(invRes.status === 200 && Array.isArray(invData),
      'Admin Inventory table loads successfully via Frontend');

    // Admin Sales View
    const salesRes = await fetch(`${FRONTEND_URL}/api/sales`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const salesData = await salesRes.json();
    assert(salesRes.status === 200 && Array.isArray(salesData),
      'Admin Sales table loads successfully via Frontend');

    // Admin Payments View
    const payRes = await fetch(`${FRONTEND_URL}/api/payments`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const payData = await payRes.json();
    assert(payRes.status === 200 && Array.isArray(payData),
      'Admin Payments table loads successfully via Frontend');

    // Admin Discrepancies Views
    const payDiscRes = await fetch(`${FRONTEND_URL}/api/discrepancies/payment`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(payDiscRes.status === 200, 'Payment Discrepancies view loads successfully via Frontend');

    const stockDiscRes = await fetch(`${FRONTEND_URL}/api/discrepancies/stock`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(stockDiscRes.status === 200, 'Stock Discrepancies view loads successfully via Frontend');

    // -------------------------------------------------------------
    // 4. MERCHANT UI API CALLS THROUGH FRONTEND PROXY
    // -------------------------------------------------------------
    console.log('\n4. Merchant UI Endpoints Through Frontend Proxy (:5173 -> :4000):');
    // Merchant Dashboard
    const m1DashRes = await fetch(`${FRONTEND_URL}/api/discrepancies/summary/merchant`, { headers: { Authorization: `Bearer ${m1Token}` } });
    const m1Dash = await m1DashRes.json();
    assert(m1DashRes.status === 200 && 'todays_sales' in m1Dash && 'inventory' in m1Dash,
      'Merchant Dashboard loads scoped data successfully via Frontend');

    // Merchant Products
    const m1ProdRes = await fetch(`${FRONTEND_URL}/api/products`, { headers: { Authorization: `Bearer ${m1Token}` } });
    assert(m1ProdRes.status === 200, 'Merchant Products view loads via Frontend');

    // Merchant Inventory
    const m1InvRes = await fetch(`${FRONTEND_URL}/api/inventory`, { headers: { Authorization: `Bearer ${m1Token}` } });
    const m1Inv = await m1InvRes.json();
    assert(m1InvRes.status === 200 && Array.isArray(m1Inv) && m1Inv.every(i => i.merchant_id === 1),
      'Merchant Inventory view strictly scoped to merchant_id = 1');

    // Merchant Sales
    const m1SalesRes = await fetch(`${FRONTEND_URL}/api/sales`, { headers: { Authorization: `Bearer ${m1Token}` } });
    const m1Sales = await m1SalesRes.json();
    assert(m1SalesRes.status === 200 && Array.isArray(m1Sales) && m1Sales.every(s => s.merchant_id === 1),
      'Merchant Sales view strictly scoped to merchant_id = 1');

    // Merchant Invoices
    const m1InvoicesRes = await fetch(`${FRONTEND_URL}/api/invoices`, { headers: { Authorization: `Bearer ${m1Token}` } });
    const m1Invoices = await m1InvoicesRes.json();
    assert(m1InvoicesRes.status === 200 && Array.isArray(m1Invoices) && m1Invoices.every(inv => inv.merchant_id === 1),
      'Merchant Invoices view strictly scoped to merchant_id = 1');

    // Merchant Payments
    const m1PaymentsRes = await fetch(`${FRONTEND_URL}/api/payments`, { headers: { Authorization: `Bearer ${m1Token}` } });
    const m1Payments = await m1PaymentsRes.json();
    assert(m1PaymentsRes.status === 200 && Array.isArray(m1Payments) && m1Payments.every(p => p.merchant_id === 1),
      'Merchant Payments view strictly scoped to merchant_id = 1');

    // -------------------------------------------------------------
    // 5. TENANT ISOLATION THROUGH FRONTEND PROXY
    // -------------------------------------------------------------
    console.log('\n5. Tenant Isolation Validation Through Frontend Proxy:');
    const [m1SaleRow] = await pool.query('SELECT sale_id FROM sales WHERE merchant_id = 1 LIMIT 1');
    const [m2SaleRow] = await pool.query('SELECT sale_id FROM sales WHERE merchant_id = 2 LIMIT 1');

    if (m1SaleRow.length > 0 && m2SaleRow.length > 0) {
      const m1SaleId = m1SaleRow[0].sale_id;
      const m2SaleId = m2SaleRow[0].sale_id;

      const crossM1Res = await fetch(`${FRONTEND_URL}/api/sales/${m2SaleId}`, { headers: { Authorization: `Bearer ${m1Token}` } });
      assert(crossM1Res.status === 404, 'Merchant 1 accessing Merchant 2 sale through Frontend returns 404');

      const crossM2Res = await fetch(`${FRONTEND_URL}/api/sales/${m1SaleId}`, { headers: { Authorization: `Bearer ${m2Token}` } });
      assert(crossM2Res.status === 404, 'Merchant 2 accessing Merchant 1 sale through Frontend returns 404');
    }

    // -------------------------------------------------------------
    // 6. PRODUCT MANAGEMENT UI WORKFLOW
    // -------------------------------------------------------------
    console.log('\n6. Product Management Workflow Through Frontend Proxy:');
    const newProdRes = await fetch(`${FRONTEND_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        product_name: 'Frontend Proxy Cutover Butter',
        category: 'BUTTER',
        unit: 'KG',
        fat_content: 80.0,
        snf: 1.5,
        selling_price: 520.00
      })
    });
    const newProd = await newProdRes.json();
    assert(newProdRes.status === 201 && newProd.product_id, 'Admin creates product via Frontend proxy');

    const tempProdId = newProd.product_id;

    const updateProdRes = await fetch(`${FRONTEND_URL}/api/products/${tempProdId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        product_name: 'Frontend Proxy Cutover Butter Updated',
        category: 'BUTTER',
        unit: 'KG',
        fat_content: 81.0,
        snf: 1.5,
        selling_price: 540.00,
        is_active: 1
      })
    });
    assert(updateProdRes.status === 200, 'Admin updates product via Frontend proxy');

    const deleteProdRes = await fetch(`${FRONTEND_URL}/api/products/${tempProdId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(deleteProdRes.status === 200, 'Admin deletes product via Frontend proxy (cleaned up)');

    // -------------------------------------------------------------
    // 7. INVENTORY STOCK ENTRY WORKFLOW
    // -------------------------------------------------------------
    console.log('\n7. Inventory Stock Entry Workflow Through Frontend Proxy:');
    const stockAddRes = await fetch(`${FRONTEND_URL}/api/inventory/stock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({
        product_id: 1,
        quantity: 10,
        cost_per_unit: 40.00,
        entry_date: '2026-10-01'
      })
    });
    assert(stockAddRes.status === 200 || stockAddRes.status === 201, 'Merchant posts stock entry via Frontend proxy');

    // -------------------------------------------------------------
    // 8. SALES SAGA (CASH) THROUGH FRONTEND PROXY
    // -------------------------------------------------------------
    console.log('\n8. Sales Saga (CASH) Execution Through Frontend Proxy:');
    const cashSaleRes = await fetch(`${FRONTEND_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({
        items: [{ product_id: 1, quantity: 2 }],
        payment_method: 'CASH'
      })
    });
    const cashSale = await cashSaleRes.json();
    assert(cashSaleRes.status === 201 && cashSale.sale_id && cashSale.invoice_id,
      'Distributed CASH Sale completes through Frontend proxy creating sale and invoice');

    // -------------------------------------------------------------
    // 9. UPI / CASHFREE FLOW THROUGH FRONTEND PROXY
    // -------------------------------------------------------------
    console.log('\n9. UPI / Cashfree Simulation Through Frontend Proxy:');
    const cfOrderRes = await fetch(`${FRONTEND_URL}/api/payments/cashfree/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({
        amount: 120.00,
        customer_phone: '9988776655'
      })
    });
    const cfOrder = await cfOrderRes.json();
    assert(cfOrderRes.status === 200 && cfOrder.order_id, 'Cashfree order creation through Frontend proxy succeeds');

    const cfVerifyRes = await fetch(`${FRONTEND_URL}/api/payments/cashfree/verify-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({ order_id: cfOrder.order_id })
    });
    assert(cfVerifyRes.status === 200, 'Cashfree order verification through Frontend proxy succeeds');

    // -------------------------------------------------------------
    // 10. ERROR HANDLING THROUGH FRONTEND PROXY
    // -------------------------------------------------------------
    console.log('\n10. Error Handling & Rejection Responses Through Frontend Proxy:');
    const badStockSale = await fetch(`${FRONTEND_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({
        items: [{ product_id: 1, quantity: 999999 }],
        payment_method: 'CASH'
      })
    });
    assert(badStockSale.status === 400, 'Insufficient stock sale rejected with 400 through Frontend');

    const forbiddenMerchants = await fetch(`${FRONTEND_URL}/api/merchants`, { headers: { Authorization: `Bearer ${m1Token}` } });
    assert(forbiddenMerchants.status === 403, 'Merchant accessing admin route through Frontend returns 403');

    const notFoundRoute = await fetch(`${FRONTEND_URL}/api/unmapped-route-testing-404`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(notFoundRoute.status === 404, 'Unmapped path through Frontend returns 404');

    // -------------------------------------------------------------
    // 11. DATABASE INTEGRITY POST-RUN
    // -------------------------------------------------------------
    console.log('\n11. Database Integrity Post-Run:');
    const [negStock] = await pool.query('SELECT * FROM inventory WHERE quantity_available < 0');
    assert(negStock.length === 0, 'Zero negative stock balances across all records');

    const [stuckReservations] = await pool.query('SELECT * FROM inventory_reservations WHERE status = "RESERVED" AND expires_at <= NOW()');
    assert(stuckReservations.length === 0, 'Zero stuck/expired reservations');

  } catch (err) {
    console.error('Fatal Step 13 Test Suite Error:', err);
    failed++;
  } finally {
    await pool.end();
    for (const p of spawnedProcesses) {
      try { p.kill(); } catch (e) {}
    }
  }

  console.log('\n====================================================');
  console.log(`STEP 13 AUDIT SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runStep13Tests();
