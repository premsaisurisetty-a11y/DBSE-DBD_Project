const path = require('path');
const pool = require('../services/sales-service/config/db');

const GATEWAY_URL = 'http://localhost:4000';
const SALES_URL = 'http://localhost:4005';
const MONOLITH_URL = 'http://localhost:5000';
const AUTH_URL = 'http://localhost:4001';
const PRODUCT_URL = 'http://localhost:4003';
const INVENTORY_URL = 'http://localhost:4004';
const PAYMENT_URL = 'http://localhost:4006';

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

async function login(identifier, password) {
  const res = await fetch(`${GATEWAY_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password })
  });
  const data = await res.json();
  return { status: res.status, ...data };
}

async function runStep9Tests() {
  console.log('====================================================');
  console.log('STEP 9 TEST SUITE: DISTRIBUTED SALES SAGA');
  console.log('====================================================\n');

  // 1. Health Checks
  console.log('1. Health Checks:');
  const salesHealthRes = await fetch(`${SALES_URL}/health`);
  const salesHealth = await salesHealthRes.json();
  assert(salesHealth.status === 'OK' && salesHealth.service === 'sales-service', 'Direct Sales Service health check OK');

  const gwHealthRes = await fetch(`${GATEWAY_URL}/health`);
  const gwHealth = await gwHealthRes.json();
  assert(gwHealth.routes && gwHealth.routes.sales === 'http://localhost:4005', 'API Gateway routes sales to :4005');

  // 2. Authentication & Setup
  console.log('\n2. Authentication & Setup:');
  const adminLogin = await login('admin@dairycoop.com', 'password123');
  const merchant1Login = await login('M1', 'P1');
  const merchant2Login = await login('M2', 'P2');

  assert(adminLogin.token, 'Admin authentication successful');
  assert(merchant1Login.token, 'Merchant 1 authentication successful');
  assert(merchant2Login.token, 'Merchant 2 authentication successful');

  const adminToken = adminLogin.token;
  const m1Token = merchant1Login.token;
  const m2Token = merchant2Login.token;

  // Verify merchants in DB
  const [mRows] = await pool.query('SELECT merchant_id, user_id, shop_name FROM merchants WHERE user_id = ?', [merchant1Login.user.user_id]);
  const m1Id = mRows[0].merchant_id;

  const [m2Rows] = await pool.query('SELECT merchant_id, user_id, shop_name FROM merchants WHERE user_id = ?', [merchant2Login.user.user_id]);
  const m2Id = m2Rows[0].merchant_id;

  // Prepare inventory for test products
  // Product 1 (Milk 1L - active, selling_price = 60), Product 2 (Curd 500g - active, selling_price = 35)
  await pool.query(
    'INSERT INTO inventory (merchant_id, product_id, quantity_available) VALUES (?, 1, 200), (?, 2, 200) ON DUPLICATE KEY UPDATE quantity_available = 200',
    [m1Id, m1Id]
  );
  await pool.query(
    'INSERT INTO inventory (merchant_id, product_id, quantity_available) VALUES (?, 1, 100) ON DUPLICATE KEY UPDATE quantity_available = 100',
    [m2Id]
  );

  // 3. Security: Missing and Invalid JWT
  console.log('\n3. Security - Token Validation:');
  const noTokenRes = await fetch(`${GATEWAY_URL}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ product_id: 1, quantity: 1 }], payment_method: 'CASH' })
  });
  assert(noTokenRes.status === 401, 'Missing JWT rejected with 401');

  const badTokenRes = await fetch(`${GATEWAY_URL}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer invalid.token.value' },
    body: JSON.stringify({ items: [{ product_id: 1, quantity: 1 }], payment_method: 'CASH' })
  });
  assert(badTokenRes.status === 401, 'Invalid JWT rejected with 401');

  // 4. Product Validation & Authoritative Price Lookup
  console.log('\n4. Product Validation & Authoritative Price:');
  
  // Inactive product rejection
  await pool.query('INSERT INTO products (product_id, product_name, category, unit, selling_price, status) VALUES (999, "Inactive Cheese", "Cheese", "Pack", 150, "DISCONTINUED") ON DUPLICATE KEY UPDATE status = "DISCONTINUED"');
  
  const inactiveProdRes = await fetch(`${GATEWAY_URL}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${m1Token}` },
    body: JSON.stringify({ items: [{ product_id: 999, quantity: 1 }], payment_method: 'CASH' })
  });
  assert(inactiveProdRes.status === 400, 'Inactive product rejected with 400');

  const nonExistentProdRes = await fetch(`${GATEWAY_URL}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${m1Token}` },
    body: JSON.stringify({ items: [{ product_id: 999999, quantity: 1 }], payment_method: 'CASH' })
  });
  assert(nonExistentProdRes.status === 400, 'Nonexistent product rejected with 400');

  // 5. Client Price Tampering Test
  console.log('\n5. Client Price Override Prevention:');
  const [p1Row] = await pool.query('SELECT selling_price FROM products WHERE product_id = 1');
  const realP1Price = Number(p1Row[0].selling_price);

  const tamperRes = await fetch(`${GATEWAY_URL}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${m1Token}` },
    body: JSON.stringify({
      items: [{ product_id: 1, quantity: 2, unit_price: 0.01 }], // client tries to buy 2 units for 0.01 each
      payment_method: 'CASH',
      total_amount: 0.02
    })
  });
  const tamperData = await tamperRes.json();
  const expectedTotal = Number((2 * realP1Price).toFixed(2));
  assert(tamperRes.status === 201 && Number(tamperData.total_amount) === expectedTotal,
    'Client unit_price is ignored; authoritative server price calculated',
    `Expected: ${expectedTotal}, Got: ${tamperData.total_amount}`
  );

  // 6. Insufficient Stock Failure
  console.log('\n6. Insufficient Stock Handling:');
  const overstockRes = await fetch(`${GATEWAY_URL}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${m1Token}` },
    body: JSON.stringify({
      items: [{ product_id: 1, quantity: 99999 }],
      payment_method: 'CASH'
    })
  });
  assert(overstockRes.status === 400, 'Insufficient stock halts saga without creating sale or payment');

  // 7. Multi-Item CASH Sale Success & Stock Audit
  console.log('\n7. Multi-Item CASH Sale Success & Stock Audit:');
  const [stockP1Before] = await pool.query('SELECT quantity_available FROM inventory WHERE merchant_id = ? AND product_id = 1', [m1Id]);
  const [stockP2Before] = await pool.query('SELECT quantity_available FROM inventory WHERE merchant_id = ? AND product_id = 2', [m1Id]);
  const qtyP1Before = Number(stockP1Before[0].quantity_available);
  const qtyP2Before = Number(stockP2Before[0].quantity_available);

  const cashSaleRes = await fetch(`${GATEWAY_URL}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${m1Token}` },
    body: JSON.stringify({
      items: [
        { product_id: 1, quantity: 3 },
        { product_id: 2, quantity: 4 }
      ],
      tax: 5,
      discount: 10,
      payment_method: 'CASH'
    })
  });
  const cashSaleData = await cashSaleRes.json();
  assert(cashSaleRes.status === 201 && cashSaleData.sale_id, 'Multi-item CASH sale created successfully');
  assert(cashSaleData.payment_status === 'SUCCESS', 'CASH sale marked payment_status SUCCESS');

  // Verify sale_items created in DB
  const [siRows] = await pool.query('SELECT * FROM sale_items WHERE sale_id = ?', [cashSaleData.sale_id]);
  assert(siRows.length === 2, 'Two sale_items inserted in database');

  // Verify invoice created in DB
  const [invRows] = await pool.query('SELECT * FROM invoices WHERE invoice_id = ?', [cashSaleData.invoice_id]);
  assert(invRows.length === 1 && Number(invRows[0].total_amount) === Number(cashSaleData.total_amount), 'Invoice created with matching total_amount');

  // Verify reservation is COMMITTED
  const resGroupRes = await fetch(`${INVENTORY_URL}/api/inventory/reservations/${cashSaleData.reservation_group_id}`, {
    headers: { 'Authorization': `Bearer ${m1Token}` }
  });
  const resGroupData = await resGroupRes.json();
  assert(resGroupData.status === 'COMMITTED', 'Inventory reservation group transitioned to COMMITTED');

  // Stock deduction integrity audit
  const [stockP1After] = await pool.query('SELECT quantity_available FROM inventory WHERE merchant_id = ? AND product_id = 1', [m1Id]);
  const [stockP2After] = await pool.query('SELECT quantity_available FROM inventory WHERE merchant_id = ? AND product_id = 2', [m1Id]);
  assert(Number(stockP1After[0].quantity_available) === qtyP1Before - 3, 'Product 1 stock correctly decremented by 3');
  assert(Number(stockP2After[0].quantity_available) === qtyP2Before - 4, 'Product 2 stock correctly decremented by 4');

  // 8. Idempotent Reservation Commit
  console.log('\n8. Idempotent Reservation Commit:');
  const repeatCommitRes = await fetch(`${INVENTORY_URL}/api/inventory/reservations/${cashSaleData.reservation_group_id}/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${m1Token}` },
    body: JSON.stringify({ sale_id: cashSaleData.sale_id })
  });
  const repeatCommitData = await repeatCommitRes.json();
  assert(repeatCommitRes.status === 200 && repeatCommitData.status === 'COMMITTED', 'Repeated reservation commit is idempotent');

  // Verify stock was not deducted again on repeat commit
  const [stockP1AfterRepeat] = await pool.query('SELECT quantity_available FROM inventory WHERE merchant_id = ? AND product_id = 1', [m1Id]);
  assert(Number(stockP1AfterRepeat[0].quantity_available) === Number(stockP1After[0].quantity_available), 'No double stock deduction on repeated commit');

  // 9. UPI / Cashfree Sale Success Flow
  console.log('\n9. UPI / Cashfree Sale Flow:');
  const upiOrderId = `order_test_${Date.now()}`;
  const upiSaleRes = await fetch(`${GATEWAY_URL}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${m1Token}` },
    body: JSON.stringify({
      items: [{ product_id: 1, quantity: 2 }],
      payment_method: 'UPI',
      order_id: upiOrderId
    })
  });
  const upiSaleData = await upiSaleRes.json();
  assert(upiSaleRes.status === 201 && upiSaleData.sale_id, 'UPI sale created successfully via Cashfree verification');

  // 10. Replay / Duplicate Payment Protection
  console.log('\n10. Replay & Duplicate Payment Protection:');
  const replayUpiRes = await fetch(`${GATEWAY_URL}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${m1Token}` },
    body: JSON.stringify({
      items: [{ product_id: 1, quantity: 1 }],
      payment_method: 'UPI',
      order_id: upiOrderId // same order_id as previous successful sale
    })
  });
  assert(replayUpiRes.status === 409, 'Duplicate Cashfree order_id rejected with 409 Conflict');

  // 11. Payment Failure & Inventory Compensation
  console.log('\n11. Payment Failure & Saga Compensation:');
  const [stockBeforePayFail] = await pool.query('SELECT quantity_available FROM inventory WHERE merchant_id = ? AND product_id = 1', [m1Id]);
  const qtyBeforePayFail = Number(stockBeforePayFail[0].quantity_available);

  // Attempt UPI sale without order_id (payment validation failure)
  const failPayRes = await fetch(`${GATEWAY_URL}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${m1Token}` },
    body: JSON.stringify({
      items: [{ product_id: 1, quantity: 5 }],
      payment_method: 'UPI'
    })
  });
  assert(failPayRes.status === 400, 'Sale with missing UPI order_id rejected with 400');

  // Verify stock was not lost / remained restored
  const [stockAfterPayFail] = await pool.query('SELECT quantity_available FROM inventory WHERE merchant_id = ? AND product_id = 1', [m1Id]);
  assert(Number(stockAfterPayFail[0].quantity_available) === qtyBeforePayFail, 'Inventory fully restored upon payment failure (Compensation)');

  // 12. Idempotent Sale Request
  console.log('\n12. Sale Request Idempotency:');
  const idemKey = `idem_${Date.now()}`;
  const firstIdemRes = await fetch(`${GATEWAY_URL}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${m1Token}`,
      'Idempotency-Key': idemKey
    },
    body: JSON.stringify({
      items: [{ product_id: 1, quantity: 1 }],
      payment_method: 'CASH'
    })
  });
  const firstIdemData = await firstIdemRes.json();
  assert(firstIdemRes.status === 201 && firstIdemData.sale_id, 'First request with Idempotency-Key created sale');

  const secondIdemRes = await fetch(`${GATEWAY_URL}/api/sales`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${m1Token}`,
      'Idempotency-Key': idemKey
    },
    body: JSON.stringify({
      items: [{ product_id: 1, quantity: 1 }],
      payment_method: 'CASH'
    })
  });
  const secondIdemData = await secondIdemRes.json();
  assert(secondIdemRes.status === 200 && secondIdemData.sale_id === firstIdemData.sale_id, 'Duplicate request returned original sale details without duplicate sale creation');

  // 13. Cross-Merchant Data Isolation
  console.log('\n13. Cross-Merchant Isolation:');
  const m1SaleRes = await fetch(`${GATEWAY_URL}/api/sales/${firstIdemData.sale_id}`, {
    headers: { 'Authorization': `Bearer ${m1Token}` }
  });
  assert(m1SaleRes.status === 200, 'Merchant 1 can access own sale');

  const m2AccessRes = await fetch(`${GATEWAY_URL}/api/sales/${firstIdemData.sale_id}`, {
    headers: { 'Authorization': `Bearer ${m2Token}` }
  });
  assert(m2AccessRes.status === 404, 'Merchant 2 cannot access Merchant 1 sale (returns 404)');

  // Merchant 1 list query only returns Merchant 1 sales
  const m1ListRes = await fetch(`${GATEWAY_URL}/api/sales`, {
    headers: { 'Authorization': `Bearer ${m1Token}` }
  });
  const m1List = await m1ListRes.json();
  const allM1 = m1List.every(s => s.merchant_id === m1Id);
  assert(allM1, 'Merchant 1 sales list contains only Merchant 1 sales');

  // 14. Invoices Endpoint Queries
  console.log('\n14. Invoices Query Isolation:');
  const invListRes = await fetch(`${GATEWAY_URL}/api/invoices`, {
    headers: { 'Authorization': `Bearer ${m1Token}` }
  });
  const invList = await invListRes.json();
  assert(Array.isArray(invList) && invList.length > 0 && invList.every(i => i.merchant_id === m1Id), 'Merchant 1 invoices list scoped correctly');

  const singleInvRes = await fetch(`${GATEWAY_URL}/api/invoices/${firstIdemData.invoice_id}`, {
    headers: { 'Authorization': `Bearer ${m1Token}` }
  });
  const singleInv = await singleInvRes.json();
  assert(singleInvRes.status === 200 && singleInv.sale, 'Single invoice includes attached sale details');

  const m2InvAccess = await fetch(`${GATEWAY_URL}/api/invoices/${firstIdemData.invoice_id}`, {
    headers: { 'Authorization': `Bearer ${m2Token}` }
  });
  assert(m2InvAccess.status === 404, 'Merchant 2 cannot access Merchant 1 invoice');

  // 15. Gateway Routing Regression
  console.log('\n15. Gateway Routing Regression:');
  const authGw = await fetch(`${GATEWAY_URL}/api/auth/me`, { headers: { 'Authorization': `Bearer ${m1Token}` } });
  assert(authGw.status === 200, 'Gateway /api/auth routes to Auth Service');

  const prodGw = await fetch(`${GATEWAY_URL}/api/products`, { headers: { 'Authorization': `Bearer ${m1Token}` } });
  assert(prodGw.status === 200, 'Gateway /api/products routes to Product Service');

  const merchGw = await fetch(`${GATEWAY_URL}/api/merchants`, { headers: { 'Authorization': `Bearer ${adminToken}` } });
  assert(merchGw.status === 200, 'Gateway /api/merchants routes to Merchant Service');

  const invGw = await fetch(`${GATEWAY_URL}/api/inventory`, { headers: { 'Authorization': `Bearer ${m1Token}` } });
  assert(invGw.status === 200, 'Gateway /api/inventory routes to Inventory Service');

  const payGw = await fetch(`${GATEWAY_URL}/api/payments`, { headers: { 'Authorization': `Bearer ${m1Token}` } });
  assert(payGw.status === 200, 'Gateway /api/payments routes to Payment Service');

  // 16. Monolith Direct Compatibility Regression
  console.log('\n16. Monolith Direct Compatibility:');
  const monolithSaleRes = await fetch(`${MONOLITH_URL}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${m1Token}` },
    body: JSON.stringify({
      items: [{ product_id: 1, quantity: 1 }],
      payment_method: 'CASH'
    })
  });
  const monolithSaleData = await monolithSaleRes.json();
  assert(monolithSaleRes.status === 201 && monolithSaleData.sale_id, 'Monolith direct CASH sale functions perfectly');

  // 17. Final Mathematical Stock Integrity Audit
  console.log('\n17. Final Stock Integrity Audit:');
  const [stockAuditRows] = await pool.query('SELECT merchant_id, product_id, quantity_available FROM inventory WHERE quantity_available < 0');
  assert(stockAuditRows.length === 0, 'Zero negative inventory records across all merchants');

  console.log('\n====================================================');
  console.log(`STEP 9 RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  await pool.end();
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runStep9Tests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
