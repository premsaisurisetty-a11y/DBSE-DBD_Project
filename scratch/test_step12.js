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

async function runStep12Tests() {
  console.log('====================================================');
  console.log('STEP 12: FULL GATEWAY CUTOVER VALIDATION SUITE');
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
    // 1. PRE-FLIGHT ARCHITECTURE & SERVICE HEALTH CHECK
    // -------------------------------------------------------------
    console.log('1. Pre-Flight Architecture & Service Health Check:');
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
    assert(monoHealthRes.status === 200 && monoHealth.status === 'OK', 'Monolith :5000 is healthy and operational as fallback');

    const gwHealthRes = await fetch(`${GATEWAY_URL}/health`);
    const gwHealth = await gwHealthRes.json();
    assert(gwHealthRes.status === 200 && gwHealth.status === 'OK', 'API Gateway :4000 is healthy and operational');

    // -------------------------------------------------------------
    // 2. COMPLETE GATEWAY ROUTING MATRIX
    // -------------------------------------------------------------
    console.log('\n2. Complete Gateway Routing Matrix Verification:');
    assert(gwHealth.routes.auth === 'http://localhost:4001', 'Gateway routes /api/auth -> Auth :4001');
    assert(gwHealth.routes.merchants === 'http://localhost:4002', 'Gateway routes /api/merchants -> Merchant :4002');
    assert(gwHealth.routes.products === 'http://localhost:4003', 'Gateway routes /api/products -> Product :4003');
    assert(gwHealth.routes.inventory === 'http://localhost:4004', 'Gateway routes /api/inventory -> Inventory :4004');
    assert(gwHealth.routes.sales === 'http://localhost:4005', 'Gateway routes /api/sales -> Sales :4005');
    assert(gwHealth.routes.payments === 'http://localhost:4006', 'Gateway routes /api/payments -> Payment :4006');
    assert(gwHealth.routes.reporting === 'http://localhost:4007', 'Gateway routes /api/discrepancies -> Reporting :4007');
    assert(gwHealth.routes.monolith === 'http://localhost:5000', 'Gateway routes unmigrated /api -> Monolith :5000');

    // -------------------------------------------------------------
    // 3. AUTHENTICATION THROUGH GATEWAY
    // -------------------------------------------------------------
    console.log('\n3. Authentication Through Gateway :4000:');
    const adminLogin = await login(GATEWAY_URL, 'admin@dairycoop.com', 'password123');
    const ownerLogin = await login(GATEWAY_URL, 'owner@dairycoop.com', 'password123');
    const m1Login = await login(GATEWAY_URL, 'M1', 'P1');
    const m2Login = await login(GATEWAY_URL, 'M2', 'P2');

    assert(adminLogin.status === 200 && adminLogin.token && adminLogin.user.role === 'ADMIN', 'Admin login succeeds through Gateway');
    assert(ownerLogin.status === 200 && ownerLogin.token && ownerLogin.user.role === 'OWNER', 'Owner login succeeds through Gateway');
    assert(m1Login.status === 200 && m1Login.token && m1Login.user.role === 'MERCHANT', 'Merchant 1 login succeeds through Gateway');
    assert(m2Login.status === 200 && m2Login.token && m2Login.user.role === 'MERCHANT', 'Merchant 2 login succeeds through Gateway');

    const adminToken = adminLogin.token;
    const ownerToken = ownerLogin.token;
    const m1Token = m1Login.token;
    const m2Token = m2Login.token;

    // Bad logins
    const badPass = await login(GATEWAY_URL, 'admin@dairycoop.com', 'wrongpassword');
    assert(badPass.status === 401, 'Invalid password returns 401 through Gateway');

    const badUser = await login(GATEWAY_URL, 'nonexistent_user@dairycoop.com', 'password123');
    assert(badUser.status === 401, 'Nonexistent user returns 401 through Gateway');

    // Auth Me verification
    const meRes = await fetch(`${GATEWAY_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const meData = await meRes.json();
    assert(meRes.status === 200 && meData.user && meData.user.role === 'ADMIN', 'GET /api/auth/me resolves authenticated user through Gateway');

    const noTokenMe = await fetch(`${GATEWAY_URL}/api/auth/me`);
    assert(noTokenMe.status === 401, 'Missing token on /api/auth/me returns 401 through Gateway');

    const badTokenMe = await fetch(`${GATEWAY_URL}/api/auth/me`, { headers: { Authorization: 'Bearer fake_jwt_token' } });
    assert(badTokenMe.status === 401, 'Invalid token on /api/auth/me returns 401 through Gateway');

    // Snapshot database state before running tests
    const [[invCountBefore]] = await pool.query('SELECT COUNT(*) as c, SUM(quantity_available) as sum_qty FROM inventory');
    const [[salesCountBefore]] = await pool.query('SELECT COUNT(*) as c, SUM(total_amount) as sum_amount FROM sales');
    const [[payCountBefore]] = await pool.query('SELECT COUNT(*) as c, SUM(amount) as sum_amount FROM payments');
    const [[merchCountBefore]] = await pool.query('SELECT COUNT(*) as c FROM merchants');
    const [[prodCountBefore]] = await pool.query('SELECT COUNT(*) as c FROM products');

    // -------------------------------------------------------------
    // 4. RBAC THROUGH GATEWAY
    // -------------------------------------------------------------
    console.log('\n4. Role-Based Access Control (RBAC) Through Gateway:');
    // Merchants endpoint RBAC
    const merchAdmin = await fetch(`${GATEWAY_URL}/api/merchants`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(merchAdmin.status === 200, 'ADMIN authorized for GET /api/merchants (200)');

    const merchOwner = await fetch(`${GATEWAY_URL}/api/merchants`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(merchOwner.status === 200, 'OWNER authorized for GET /api/merchants via master access (200)');

    const merchMerchant = await fetch(`${GATEWAY_URL}/api/merchants`, { headers: { Authorization: `Bearer ${m1Token}` } });
    assert(merchMerchant.status === 403, 'MERCHANT forbidden from GET /api/merchants (403)');

    // Discrepancies RBAC
    const discAdmin = await fetch(`${GATEWAY_URL}/api/discrepancies/stock`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(discAdmin.status === 200, 'ADMIN authorized for GET /api/discrepancies/stock (200)');

    const discMerchant = await fetch(`${GATEWAY_URL}/api/discrepancies/stock`, { headers: { Authorization: `Bearer ${m1Token}` } });
    assert(discMerchant.status === 403, 'MERCHANT forbidden from GET /api/discrepancies/stock (403)');

    // -------------------------------------------------------------
    // 5. TENANT / MERCHANT ISOLATION
    // -------------------------------------------------------------
    console.log('\n5. Tenant / Merchant Isolation Through Gateway:');
    // Fetch an M1 sale and an M2 sale for cross-tenant testing
    const [m1Sales] = await pool.query('SELECT sale_id, invoice_id FROM sales WHERE merchant_id = 1 ORDER BY sale_id DESC LIMIT 1');
    const [m2Sales] = await pool.query('SELECT sale_id, invoice_id FROM sales WHERE merchant_id = 2 ORDER BY sale_id DESC LIMIT 1');

    if (m1Sales.length > 0 && m2Sales.length > 0) {
      const m1SaleId = m1Sales[0].sale_id;
      const m2SaleId = m2Sales[0].sale_id;
      const m1InvoiceId = m1Sales[0].invoice_id;
      const m2InvoiceId = m2Sales[0].invoice_id;

      // M1 accesses M1 sale -> 200
      const m1SelfSale = await fetch(`${GATEWAY_URL}/api/sales/${m1SaleId}`, { headers: { Authorization: `Bearer ${m1Token}` } });
      assert(m1SelfSale.status === 200, 'Merchant 1 can access own sale record');

      // M1 accesses M2 sale -> 404 (isolated)
      const m1CrossSale = await fetch(`${GATEWAY_URL}/api/sales/${m2SaleId}`, { headers: { Authorization: `Bearer ${m1Token}` } });
      assert(m1CrossSale.status === 404, 'Merchant 1 accessing Merchant 2 sale is rejected with 404');

      // M2 accesses M1 sale -> 404 (isolated)
      const m2CrossSale = await fetch(`${GATEWAY_URL}/api/sales/${m1SaleId}`, { headers: { Authorization: `Bearer ${m2Token}` } });
      assert(m2CrossSale.status === 404, 'Merchant 2 accessing Merchant 1 sale is rejected with 404');

      // Invoices isolation
      const m1SelfInv = await fetch(`${GATEWAY_URL}/api/invoices/${m1InvoiceId}`, { headers: { Authorization: `Bearer ${m1Token}` } });
      assert(m1SelfInv.status === 200, 'Merchant 1 can access own invoice');

      const m1CrossInv = await fetch(`${GATEWAY_URL}/api/invoices/${m2InvoiceId}`, { headers: { Authorization: `Bearer ${m1Token}` } });
      assert(m1CrossInv.status === 404, 'Merchant 1 accessing Merchant 2 invoice is rejected with 404');

      // Admin global access
      const adminSaleAccess = await fetch(`${GATEWAY_URL}/api/sales/${m1SaleId}`, { headers: { Authorization: `Bearer ${adminToken}` } });
      assert(adminSaleAccess.status === 200, 'Admin can access any merchant sale record');

      const adminInvAccess = await fetch(`${GATEWAY_URL}/api/invoices/${m1InvoiceId}`, { headers: { Authorization: `Bearer ${adminToken}` } });
      assert(adminInvAccess.status === 200, 'Admin can access any merchant invoice record');
    }

    // -------------------------------------------------------------
    // 6. PRODUCT SERVICE THROUGH GATEWAY
    // -------------------------------------------------------------
    console.log('\n6. Product Service Through Gateway:');
    const prodsRes = await fetch(`${GATEWAY_URL}/api/products`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const prods = await prodsRes.json();
    assert(prodsRes.status === 200 && Array.isArray(prods) && prods.length > 0, 'GET /api/products returns product catalog');

    const singleProdRes = await fetch(`${GATEWAY_URL}/api/products/1`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(singleProdRes.status === 200, 'GET /api/products/1 returns single product');

    // Create temporary product as Admin
    const createProdRes = await fetch(`${GATEWAY_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        product_name: 'Test Temporary Butter',
        category: 'BUTTER',
        unit: 'KG',
        fat_content: 80.5,
        snf: 1.5,
        selling_price: 450.00
      })
    });
    const createdProd = await createProdRes.json();
    assert(createProdRes.status === 201 && createdProd.product_id, 'POST /api/products creates product via Admin');

    const tempProdId = createdProd.product_id;

    // Update product
    const updateProdRes = await fetch(`${GATEWAY_URL}/api/products/${tempProdId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        product_name: 'Test Temporary Butter Updated',
        category: 'BUTTER',
        unit: 'KG',
        fat_content: 82.0,
        snf: 1.5,
        selling_price: 480.00,
        is_active: 1
      })
    });
    assert(updateProdRes.status === 200, 'PUT /api/products/:id updates product');

    // Quality log check
    const qualityRes = await fetch(`${GATEWAY_URL}/api/products/${tempProdId}/quality`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(qualityRes.status === 200, 'GET /api/products/:id/quality returns quality logs');

    // Delete temporary product
    const deleteProdRes = await fetch(`${GATEWAY_URL}/api/products/${tempProdId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(deleteProdRes.status === 200, 'DELETE /api/products/:id deletes product');

    // -------------------------------------------------------------
    // 7. MERCHANT SERVICE THROUGH GATEWAY
    // -------------------------------------------------------------
    console.log('\n7. Merchant Service Through Gateway:');
    const merchantsListRes = await fetch(`${GATEWAY_URL}/api/merchants`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const merchantsList = await merchantsListRes.json();
    assert(merchantsListRes.status === 200 && Array.isArray(merchantsList) && merchantsList.length >= 2, 'GET /api/merchants returns merchant list');

    const m1DetailRes = await fetch(`${GATEWAY_URL}/api/merchants/1`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(m1DetailRes.status === 200, 'GET /api/merchants/1 returns Merchant 1 details');

    // Toggle merchant status test & rollback
    const toggleStatusRes = await fetch(`${GATEWAY_URL}/api/merchants/1/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'ACTIVE' })
    });
    assert(toggleStatusRes.status === 200, 'PUT /api/merchants/:id/status updates merchant status');

    // -------------------------------------------------------------
    // 8. INVENTORY SERVICE & RESERVATIONS THROUGH GATEWAY
    // -------------------------------------------------------------
    console.log('\n8. Inventory Service & Reservation Infrastructure Through Gateway:');
    const invRes = await fetch(`${GATEWAY_URL}/api/inventory`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const invData = await invRes.json();
    assert(invRes.status === 200 && Array.isArray(invData), 'GET /api/inventory returns inventory list');

    const lowStockRes = await fetch(`${GATEWAY_URL}/api/inventory/low-stock`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(lowStockRes.status === 200, 'GET /api/inventory/low-stock returns low-stock items');

    // Multi-item reservation lifecycle
    const resGroupRes = await fetch(`${GATEWAY_URL}/api/inventory/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({
        items: [{ product_id: 1, quantity: 2 }]
      })
    });
    const resGroup = await resGroupRes.json();
    assert(resGroupRes.status === 201 && resGroup.reservation_group_id, 'POST /api/inventory/reservations creates reservation group');

    const resGroupId = resGroup.reservation_group_id;

    // Check reservation status
    const resStatusRes = await fetch(`${GATEWAY_URL}/api/inventory/reservations/${resGroupId}`, {
      headers: { Authorization: `Bearer ${m1Token}` }
    });
    const resStatusData = await resStatusRes.json();
    assert(resStatusRes.status === 200 && resStatusData.status === 'RESERVED', 'Reservation status is RESERVED');

    // Release reservation to keep state clean
    const releaseRes = await fetch(`${GATEWAY_URL}/api/inventory/reservations/${resGroupId}/release`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${m1Token}` }
    });
    assert(releaseRes.status === 200, 'POST /api/inventory/reservations/:id/release releases reserved stock');

    // Idempotent release check
    const releaseIdempotentRes = await fetch(`${GATEWAY_URL}/api/inventory/reservations/${resGroupId}/release`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${m1Token}` }
    });
    assert(releaseIdempotentRes.status === 200, 'Re-releasing already released reservation is cleanly idempotent');

    // -------------------------------------------------------------
    // 9. SALES SAGA THROUGH GATEWAY
    // -------------------------------------------------------------
    console.log('\n9. Sales Saga End-to-End Execution Through Gateway:');
    // A. Successful CASH sale
    const cashSaleRes = await fetch(`${GATEWAY_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({
        items: [{ product_id: 1, quantity: 1 }],
        payment_method: 'CASH'
      })
    });
    const cashSale = await cashSaleRes.json();
    assert(cashSaleRes.status === 201 && cashSale.sale_id && cashSale.invoice_id, 'A. Successful CASH Sale creates sale & invoice via distributed Saga');

    // B. Successful UPI/Cashfree Flow
    const upiOrderId = `order_s12_val_${Date.now()}`;
    const upiSaleRes = await fetch(`${GATEWAY_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({
        items: [{ product_id: 2, quantity: 1 }],
        payment_method: 'UPI',
        order_id: upiOrderId
      })
    });
    const upiSale = await upiSaleRes.json();
    assert(upiSaleRes.status === 201 && upiSale.sale_id, 'B. Successful UPI Sale succeeds via distributed Saga');

    // C. Invalid Product
    const invalidProdSale = await fetch(`${GATEWAY_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({
        items: [{ product_id: 999999, quantity: 1 }],
        payment_method: 'CASH'
      })
    });
    assert(invalidProdSale.status === 400, 'C. Sale with invalid product ID rejected with 400');

    // E. Insufficient Stock
    const excessStockSale = await fetch(`${GATEWAY_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({
        items: [{ product_id: 1, quantity: 999999 }],
        payment_method: 'CASH'
      })
    });
    assert(excessStockSale.status === 400, 'E. Sale with insufficient stock rejected with 400');

    // F. Invalid Quantity (<= 0)
    const invalidQtySale = await fetch(`${GATEWAY_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({
        items: [{ product_id: 1, quantity: 0 }],
        payment_method: 'CASH'
      })
    });
    assert(invalidQtySale.status === 400, 'F. Sale with zero quantity rejected with 400');

    // G. Invalid Discount
    const invalidDiscountSale = await fetch(`${GATEWAY_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({
        items: [{ product_id: 1, quantity: 1 }],
        discount: 999999,
        payment_method: 'CASH'
      })
    });
    assert(invalidDiscountSale.status === 400, 'G. Sale with excessive discount rejected with 400');

    // -------------------------------------------------------------
    // 10. IDEMPOTENCY TESTING
    // -------------------------------------------------------------
    console.log('\n10. Idempotency Key & Duplicate Protection:');
    const idempotencyKey = `idem_step12_${Date.now()}`;
    const payload1 = {
      items: [{ product_id: 1, quantity: 1 }],
      payment_method: 'CASH'
    };

    // First request
    const firstReq = await fetch(`${GATEWAY_URL}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m1Token}`,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(payload1)
    });
    const firstData = await firstReq.json();
    assert(firstReq.status === 201 && firstData.sale_id, 'First request with Idempotency-Key succeeds (201)');

    // Second identical request returns idempotent completed sale
    const secondReq = await fetch(`${GATEWAY_URL}/api/sales`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m1Token}`,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(payload1)
    });
    const secondData = await secondReq.json();
    assert(secondReq.status === 200 || secondReq.status === 201, 'Second request with same Idempotency-Key succeeds (200 OK idempotent)');
    assert(secondData.sale_id === firstData.sale_id, 'Idempotent replay returns same sale_id without creating duplicate records');

    // Duplicate Cashfree order ID rejection check
    const dupUpiSale = await fetch(`${GATEWAY_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({
        items: [{ product_id: 2, quantity: 1 }],
        payment_method: 'UPI',
        order_id: upiOrderId
      })
    });
    assert(dupUpiSale.status === 400 || dupUpiSale.status === 409, 'Duplicate Cashfree order ID rejected cleanly');

    // -------------------------------------------------------------
    // 11. PAYMENT SERVICE THROUGH GATEWAY
    // -------------------------------------------------------------
    console.log('\n11. Payment Service Through Gateway:');
    const paymentsListRes = await fetch(`${GATEWAY_URL}/api/payments`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const paymentsList = await paymentsListRes.json();
    assert(paymentsListRes.status === 200 && Array.isArray(paymentsList), 'GET /api/payments returns payment list');

    // Cashfree order creation
    const cfOrderRes = await fetch(`${GATEWAY_URL}/api/payments/cashfree/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({
        amount: 60.00,
        customer_phone: '9876543210'
      })
    });
    const cfOrder = await cfOrderRes.json();
    assert(cfOrderRes.status === 200 && cfOrder.order_id, 'POST /api/payments/cashfree/create-order creates Cashfree session');

    // Cashfree order verification
    const cfVerifyRes = await fetch(`${GATEWAY_URL}/api/payments/cashfree/verify-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${m1Token}` },
      body: JSON.stringify({
        order_id: cfOrder.order_id
      })
    });
    assert(cfVerifyRes.status === 200, 'POST /api/payments/cashfree/verify-order returns verification status');

    // -------------------------------------------------------------
    // 12. SAGA RECOVERY & COMPENSATION
    // -------------------------------------------------------------
    console.log('\n12. Saga Recovery & Compensation:');
    const recoverySweepRes = await fetch(`${SALES_URL}/api/sales/recovery-sweep`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const recoveryData = await recoverySweepRes.json();
    assert(recoverySweepRes.status === 200 && recoveryData.success, 'POST /api/sales/recovery-sweep executes safely');

    const orphanPayRes = await fetch(`${SALES_URL}/api/sales/orphan-payments`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(orphanPayRes.status === 200, 'GET /api/sales/orphan-payments returns orphan audit report');

    // -------------------------------------------------------------
    // 13. REPORTING SERVICE THROUGH GATEWAY
    // -------------------------------------------------------------
    console.log('\n13. Reporting Service Through Gateway:');
    const repPayRes = await fetch(`${GATEWAY_URL}/api/discrepancies/payment`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(repPayRes.status === 200, 'GET /api/discrepancies/payment succeeds via Gateway');

    const repStockRes = await fetch(`${GATEWAY_URL}/api/discrepancies/stock`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(repStockRes.status === 200, 'GET /api/discrepancies/stock succeeds via Gateway');

    const repAdminSumRes = await fetch(`${GATEWAY_URL}/api/discrepancies/summary/admin`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(repAdminSumRes.status === 200, 'GET /api/discrepancies/summary/admin succeeds via Gateway');

    const repM1SumRes = await fetch(`${GATEWAY_URL}/api/discrepancies/summary/merchant`, { headers: { Authorization: `Bearer ${m1Token}` } });
    assert(repM1SumRes.status === 200, 'GET /api/discrepancies/summary/merchant succeeds via Gateway');

    const repRevRes = await fetch(`${GATEWAY_URL}/api/discrepancies/revenue`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert(repRevRes.status === 200, 'GET /api/discrepancies/revenue succeeds via Gateway');

    // Read-only mutation rejection
    const repMutateRes = await fetch(`${GATEWAY_URL}/api/discrepancies/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ test: 'mutate' })
    });
    assert(repMutateRes.status === 405, 'POST to reporting endpoint rejected with 405 Method Not Allowed');

    // -------------------------------------------------------------
    // 14. INVOICE APIS THROUGH GATEWAY
    // -------------------------------------------------------------
    console.log('\n14. Invoice APIs Through Gateway:');
    const invListRes = await fetch(`${GATEWAY_URL}/api/invoices`, { headers: { Authorization: `Bearer ${m1Token}` } });
    const invListData = await invListRes.json();
    assert(invListRes.status === 200 && Array.isArray(invListData), 'GET /api/invoices returns merchant invoices');

    const invalidInvRes = await fetch(`${GATEWAY_URL}/api/invoices/9999999`, { headers: { Authorization: `Bearer ${m1Token}` } });
    assert(invalidInvRes.status === 404, 'GET /api/invoices/9999999 for non-existent invoice returns 404');

    // -------------------------------------------------------------
    // 15. GATEWAY ERROR HANDLING & DOWNSTREAM FAILURES
    // -------------------------------------------------------------
    console.log('\n15. Gateway Error Handling & 404/5xx Responses:');
    const gw404Res = await fetch(`${GATEWAY_URL}/api/nonexistent-route-for-testing-404`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(gw404Res.status === 404, 'Unmapped route returns 404 cleanly');

    // -------------------------------------------------------------
    // 16. GATEWAY HEADER / QUERY / BODY FORWARDING
    // -------------------------------------------------------------
    console.log('\n16. Gateway Header, Query Parameter & Body Forwarding:');
    const queryFilterRes = await fetch(`${GATEWAY_URL}/api/discrepancies/revenue?merchant_id=1`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const queryFilterData = await queryFilterRes.json();
    assert(queryFilterRes.status === 200 && queryFilterData.length === 1 && queryFilterData[0].merchant_id === 1,
      'Gateway forwards query parameters (?merchant_id=1) accurately');

    // -------------------------------------------------------------
    // 17. CORS / BROWSER COMPATIBILITY
    // -------------------------------------------------------------
    console.log('\n17. CORS & Browser Compatibility:');
    const corsRes = await fetch(`${GATEWAY_URL}/api/products`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type, Idempotency-Key'
      }
    });
    assert(corsRes.status === 200 || corsRes.status === 204, 'Gateway handles CORS OPTIONS preflight correctly');

    // -------------------------------------------------------------
    // 18. MONOLITH FALLBACK & SIDE-BY-SIDE PARITY
    // -------------------------------------------------------------
    console.log('\n18. Monolith Fallback & Side-by-Side Contract Parity:');
    const monoProdRes = await fetch(`${MONOLITH_URL}/api/products`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const monoProd = await monoProdRes.json();
    const gwProdRes = await fetch(`${GATEWAY_URL}/api/products`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const gwProd = await gwProdRes.json();
    assert(monoProdRes.status === gwProdRes.status, 'Product list status matches (Monolith vs Gateway)');
    assert(monoProd.length === gwProd.length, 'Product list count matches (Monolith vs Gateway)');

    const monoDiscrepancyRes = await fetch(`${MONOLITH_URL}/api/discrepancies/summary/admin`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const monoDisc = await monoDiscrepancyRes.json();
    const gwDiscrepancyRes = await fetch(`${GATEWAY_URL}/api/discrepancies/summary/admin`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const gwDisc = await gwDiscrepancyRes.json();
    assert(JSON.stringify(monoDisc) === JSON.stringify(gwDisc), 'Admin discrepancy summary matches 100% (Monolith vs Gateway)');

    // -------------------------------------------------------------
    // 19. DATABASE INTEGRITY AUDIT
    // -------------------------------------------------------------
    console.log('\n19. Database Integrity Post-Run Audit:');
    const [negStock] = await pool.query('SELECT * FROM inventory WHERE quantity_available < 0');
    assert(negStock.length === 0, 'Zero negative stock balances across all merchants and products');

    const [orphanReservations] = await pool.query('SELECT * FROM inventory_reservations WHERE status = "RESERVED" AND expires_at <= NOW()');
    assert(orphanReservations.length === 0, 'Zero stuck/expired active reservations');

    const [[invCountAfter]] = await pool.query('SELECT COUNT(*) as c FROM inventory');
    assert(invCountBefore.c === invCountAfter.c, 'Inventory item count preserved without row corruption');

    const [[merchCountAfter]] = await pool.query('SELECT COUNT(*) as c FROM merchants');
    assert(merchCountBefore.c === merchCountAfter.c, 'Merchants count preserved');

    const [[prodCountAfter]] = await pool.query('SELECT COUNT(*) as c FROM products');
    assert(prodCountBefore.c === prodCountAfter.c, 'Products count restored after temporary test product deletion');

  } catch (err) {
    console.error('Fatal Step 12 Test Suite Error:', err);
    failed++;
  } finally {
    await pool.end();
    for (const p of spawnedProcesses) {
      try { p.kill(); } catch (e) {}
    }
  }

  console.log('\n====================================================');
  console.log(`STEP 12 AUDIT SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runStep12Tests();
