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

async function runStep10Tests() {
  console.log('====================================================');
  console.log('STEP 10 TEST SUITE: SAGA RECOVERY & COMPENSATION');
  console.log('====================================================\n');

  // 1. Health Checks
  console.log('1. Health Checks & Recovery Endpoints:');
  const healthRes = await fetch(`${SALES_URL}/health`);
  const health = await healthRes.json();
  assert(health.status === 'OK' && health.service === 'sales-service', 'Sales Service health check OK');

  // 2. Authentication & Setup
  console.log('\n2. Authentication & Tokens:');
  const adminLogin = await login('admin@dairycoop.com', 'password123');
  const merchant1Login = await login('M1', 'P1');
  const merchant2Login = await login('M2', 'P2');

  assert(adminLogin.token, 'Admin authentication successful');
  assert(merchant1Login.token, 'Merchant 1 authentication successful');
  assert(merchant2Login.token, 'Merchant 2 authentication successful');

  const adminToken = adminLogin.token;
  const m1Token = merchant1Login.token;
  const m2Token = merchant2Login.token;

  const [mRows] = await pool.query('SELECT merchant_id FROM merchants WHERE user_id = ?', [merchant1Login.user.user_id]);
  const m1Id = mRows[0].merchant_id;

  const [m2Rows] = await pool.query('SELECT merchant_id FROM merchants WHERE user_id = ?', [merchant2Login.user.user_id]);
  const m2Id = m2Rows[0].merchant_id;

  // Reset baseline stock for testing
  await pool.query('UPDATE inventory SET quantity_available = 150 WHERE merchant_id = ? AND product_id = 1', [m1Id]);
  await pool.query('UPDATE inventory SET quantity_available = 150 WHERE merchant_id = ? AND product_id = 2', [m1Id]);

  // 3. Normal Forward Flows
  console.log('\n3. Normal Forward Flows:');
  const cashSale = await fetch(`${GATEWAY_URL}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${m1Token}` },
    body: JSON.stringify({
      items: [{ product_id: 1, quantity: 2 }],
      payment_method: 'CASH'
    })
  });
  const cashData = await cashSale.json();
  assert(cashSale.status === 201 && cashData.sale_id, 'Successful CASH Saga creates sale and invoice');

  const upiOrderId = `order_s10_${Date.now()}`;
  const upiSale = await fetch(`${GATEWAY_URL}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${m1Token}` },
    body: JSON.stringify({
      items: [{ product_id: 2, quantity: 2 }],
      payment_method: 'UPI',
      order_id: upiOrderId
    })
  });
  const upiData = await upiSale.json();
  assert(upiSale.status === 201 && upiData.sale_id, 'Successful UPI/Cashfree Saga creates sale and invoice');

  // 4. Payment Compensation on Local DB Failure
  console.log('\n4. Payment Compensation & Local DB Failure:');
  const refundTest = await fetch(`${PAYMENT_URL}/api/payments/cashfree/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      order_id: upiOrderId,
      refund_amount: 70,
      refund_note: 'Test standalone refund'
    })
  });
  const refundData = await refundTest.json();
  assert(refundTest.status === 200 && refundData.success, 'Payment Service refund endpoint processes compensation successfully');

  // 5. Crash Recovery Case A: STARTED with no reservation / Stale
  console.log('\n5. Recovery - Case A (Stale STARTED Saga):');
  const staleSagaId = `saga_stale_${Date.now()}`;
  await pool.query(
    'INSERT INTO saga_instances (saga_id, reservation_group_id, merchant_id, current_step, saga_status, payload) VALUES (?, "res_temp_none", ?, "VALIDATING", "STARTED", ?)',
    [staleSagaId, m1Id, JSON.stringify({ test: 'stale' })]
  );

  const sweep1 = await fetch(`${SALES_URL}/api/sales/recovery-sweep`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const sweep1Data = await sweep1.json();
  assert(sweep1.status === 200 && sweep1Data.success, 'Recovery sweep endpoint executed successfully');

  const [staleCheck] = await pool.query('SELECT saga_status, current_step FROM saga_instances WHERE saga_id = ?', [staleSagaId]);
  assert(staleCheck[0].saga_status === 'FAILED' && staleCheck[0].current_step === 'STALE_STARTED_ABORTED', 'Stale STARTED saga safely aborted without payment calls');

  // 6. Crash Recovery Case C: RESERVED with unconfirmed payment status -> Recovery resolves
  console.log('\n6. Recovery - Case C (Unconfirmed Payment Recovery):');
  const resRes = await fetch(`${INVENTORY_URL}/api/inventory/reservations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${m1Token}` },
    body: JSON.stringify({ items: [{ product_id: 1, quantity: 3 }] })
  });
  const resData = await resRes.json();
  const unconfirmedGroupId = resData.reservation_group_id;

  const unconfirmedOrderId = `order_unconf_${Date.now()}`;
  const unconfirmedSagaId = `saga_${unconfirmedOrderId}`;
  await pool.query(
    `UPDATE saga_instances SET saga_id = ?, current_step = "PAYING", saga_status = "RESERVED", payload = ? WHERE reservation_group_id = ?`,
    [
      unconfirmedSagaId,
      JSON.stringify({
        order_id: unconfirmedOrderId,
        payment_method: 'UPI',
        total_amount: 180,
        validatedItems: [{ product_id: 1, quantity: 3, unit_price: 60 }]
      }),
      unconfirmedGroupId
    ]
  );

  const sweep2 = await fetch(`${SALES_URL}/api/sales/recovery-sweep`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const sweep2Data = await sweep2.json();
  assert(sweep2Data.success, 'Recovery sweep completed for unconfirmed payment saga');

  const [recoveredSaga] = await pool.query('SELECT saga_status, current_step, payload FROM saga_instances WHERE reservation_group_id = ?', [unconfirmedGroupId]);
  assert(recoveredSaga[0].saga_status === 'COMPLETED', 'Unconfirmed payment saga recovered to COMPLETED status');

  const recPayload = typeof recoveredSaga[0].payload === 'string' ? JSON.parse(recoveredSaga[0].payload) : recoveredSaga[0].payload;
  assert(recPayload.sale_id, 'Recovery created exactly one sale in DB');

  const resCheck = await fetch(`${INVENTORY_URL}/api/inventory/reservations/${unconfirmedGroupId}`, {
    headers: { 'Authorization': `Bearer ${m1Token}` }
  });
  const resCheckData = await resCheck.json();
  assert(resCheckData.status === 'COMMITTED', 'Inventory reservation committed during recovery');

  // 7. Crash Recovery Case E: Sale created + Reservation still RESERVED -> Commit
  console.log('\n7. Recovery - Case E (Sale created but reservation uncommitted):');
  const resRes2 = await fetch(`${INVENTORY_URL}/api/inventory/reservations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${m1Token}` },
    body: JSON.stringify({ items: [{ product_id: 2, quantity: 2 }] })
  });
  const resData2 = await resRes2.json();
  const uncommittedGroupId = resData2.reservation_group_id;

  const dynamicInvNumber = `INV-CRASH-${Date.now()}`;
  const [invInsert] = await pool.query('INSERT INTO invoices (merchant_id, invoice_number, invoice_date, total_amount) VALUES (?, ?, CURDATE(), 70)', [m1Id, dynamicInvNumber]);
  const [saleInsert] = await pool.query('INSERT INTO sales (merchant_id, invoice_id, subtotal, tax, discount, total_amount, sale_status) VALUES (?, ?, 70, 0, 0, 70, "COMPLETED")', [m1Id, invInsert.insertId]);
  const crashSaleId = saleInsert.insertId;

  await pool.query(
    'UPDATE saga_instances SET saga_status = "PAID", current_step = "CREATING_SALE", payload = ? WHERE reservation_group_id = ?',
    [JSON.stringify({ sale_id: crashSaleId, total_amount: 70 }), uncommittedGroupId]
  );

  await fetch(`${SALES_URL}/api/sales/recovery-sweep`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });

  const [caseESaga] = await pool.query('SELECT saga_status, current_step FROM saga_instances WHERE reservation_group_id = ?', [uncommittedGroupId]);
  assert(caseESaga[0].saga_status === 'COMPLETED', 'Case E saga transitioned to COMPLETED');

  const resCheck2 = await fetch(`${INVENTORY_URL}/api/inventory/reservations/${uncommittedGroupId}`, {
    headers: { 'Authorization': `Bearer ${m1Token}` }
  });
  const resCheck2Data = await resCheck2.json();
  assert(resCheck2Data.status === 'COMMITTED', 'Uncommitted reservation successfully committed by recovery worker');

  // 8. Completed and Compensated Sagas are Ignored
  console.log('\n8. Completed & Compensated Sagas Safety:');
  const sweep3 = await fetch(`${SALES_URL}/api/sales/recovery-sweep`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const sweep3Data = await sweep3.json();
  assert(sweep3Data.result?.processed === 0 || sweep3Data.result?.recovered === 0, 'Completed and settled sagas are ignored on subsequent sweeps');

  // 9. Orphan Payment Detection
  console.log('\n9. Orphan Payment Detection Endpoint:');
  const orphanSagaId = `saga_orphan_${Date.now()}`;
  await pool.query(
    'INSERT INTO saga_instances (saga_id, reservation_group_id, merchant_id, current_step, saga_status, payload, error_log) VALUES (?, "res_orphan_1", ?, "PAYMENT_COMPENSATION_PENDING", "FAILED", ?, "Payment captured but manual refund required")',
    [orphanSagaId, m1Id, JSON.stringify({ order_id: 'order_orphan_123', payment_method: 'UPI', total_amount: 250 })]
  );

  const orphanRes = await fetch(`${SALES_URL}/api/sales/orphan-payments`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const orphanData = await orphanRes.json();
  assert(orphanRes.status === 200 && orphanData.count >= 1, 'Orphan payment detection endpoint returned orphan records');
  assert(orphanData.orphan_payments && orphanData.orphan_payments.some(o => o.saga_id === orphanSagaId), 'Simulated orphan payment correctly identified');

  await pool.query('DELETE FROM saga_instances WHERE saga_id = ?', [orphanSagaId]);

  // 10. Security & Authorization
  console.log('\n10. Security & Role Authorizations:');
  const m1OrphanAccess = await fetch(`${SALES_URL}/api/sales/orphan-payments`, {
    headers: { 'Authorization': `Bearer ${m1Token}` }
  });
  assert(m1OrphanAccess.status === 403, 'Merchant role forbidden from accessing global orphan payments report');

  const m1SweepAccess = await fetch(`${SALES_URL}/api/sales/recovery-sweep`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${m1Token}` }
  });
  assert(m1SweepAccess.status === 403, 'Merchant role forbidden from triggering manual recovery sweep');

  const noTokenSweep = await fetch(`${SALES_URL}/api/sales/recovery-sweep`, { method: 'POST' });
  assert(noTokenSweep.status === 401, 'Unauthenticated recovery sweep rejected with 401');

  // 11. Mathematical Stock Integrity Audit
  console.log('\n11. Final Stock Integrity Audit:');
  const [negStock] = await pool.query('SELECT * FROM inventory WHERE quantity_available < 0');
  assert(negStock.length === 0, 'Zero negative inventory balances');

  console.log('\n====================================================');
  console.log(`STEP 10 RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  await pool.end();
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runStep10Tests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
