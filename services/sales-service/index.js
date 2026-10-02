const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config(); // Fallback

const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 4005;
const JWT_SECRET = process.env.JWT_SECRET || 'replace_with_a_long_random_secret';

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:4003';
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:4004';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:4006';

app.use(cors());
app.use(express.json());

// Service Health Checks
app.get('/health', (req, res) => {
  res.json({ service: 'sales-service', port: PORT, status: 'OK' });
});
app.get('/api/sales/health', (req, res) => {
  res.json({ service: 'sales-service', port: PORT, status: 'OK' });
});
app.get('/api/invoices/health', (req, res) => {
  res.json({ service: 'sales-service', port: PORT, status: 'OK' });
});

// Authentication Middleware
function authenticateToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { user_id, role, name }
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// Role Authorization Middleware (supports OWNER master access)
function authorizeRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    if (req.user.role === 'OWNER' && (allowedRoles.includes('ADMIN') || allowedRoles.includes('OWNER'))) {
      return next();
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied for this role' });
    }
    next();
  };
}

// Helper to safely call downstream service with configurable timeout
async function callService(url, options = {}) {
  const timeoutMs = options.timeout || 8000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// Helper to generate service-to-service internal authorization token
function generateInternalToken(role = 'ADMIN', userId = 1) {
  return jwt.sign({ user_id: userId, role: role, name: 'Saga Recovery Service' }, JWT_SECRET, {
    expiresIn: '1h'
  });
}

// Helper to release inventory reservation
async function releaseReservation(reservationGroupId, authHeader) {
  if (!reservationGroupId) return { success: false, message: 'No reservationGroupId' };
  try {
    const res = await callService(`${INVENTORY_SERVICE_URL}/api/inventory/reservations/${reservationGroupId}/release`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader || `Bearer ${generateInternalToken()}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await res.json().catch(() => ({}));
    return { success: res.ok, data };
  } catch (err) {
    console.error(`[Sales Saga] Compensation release failed for reservation ${reservationGroupId}:`, err.message);
    return { success: false, error: err.message };
  }
}

// Helper to refund / compensate payment
async function compensatePayment({ payment_method, order_id, amount, authHeader }) {
  if (payment_method === 'CASH') {
    // CASH payments at POS are voided upon rollback
    return { success: true, payment_method: 'CASH', status: 'VOIDED', message: 'Cash receipt voided at POS' };
  }

  if (payment_method === 'UPI') {
    if (!order_id) return { success: false, message: 'Missing order_id for UPI refund' };
    try {
      const refundRes = await callService(`${PAYMENT_SERVICE_URL}/api/payments/cashfree/refund`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader || `Bearer ${generateInternalToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          order_id: order_id,
          refund_amount: amount,
          refund_note: 'Distributed Sales Saga rollback'
        })
      });
      const refundData = await refundRes.json().catch(() => ({}));
      if (refundRes.ok && refundData.success) {
        return { success: true, refundData };
      }
      return { success: false, message: refundData.message || 'Payment Service refund failed' };
    } catch (err) {
      console.error(`[Sales Saga] Payment refund error for order ${order_id}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  return { success: false, message: `Unsupported payment method for compensation: ${payment_method}` };
}

// =========================================================================
// 1. RECOVERY & ORPHAN PAYMENT ENDPOINTS (MUST BE DECLARED BEFORE /:id)
// =========================================================================

// GET /api/sales/orphan-payments - Detect payments without completed sales
app.get('/api/sales/orphan-payments', authenticateToken, authorizeRole('ADMIN', 'OWNER'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.saga_id, s.reservation_group_id, s.merchant_id, m.shop_name,
              s.saga_status, s.current_step, s.payload, s.error_log, s.created_at, s.updated_at
       FROM saga_instances s
       LEFT JOIN merchants m ON m.merchant_id = s.merchant_id
       WHERE (s.saga_status IN ('PAID', 'FAILED') OR s.current_step LIKE '%PAYMENT%')
         AND s.saga_status != 'COMPLETED'
       ORDER BY s.created_at DESC`
    );

    const orphanList = [];
    for (const row of rows) {
      let payload = {};
      try {
        payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload || {};
      } catch (e) {}

      // Check if a completed sale exists
      let hasCompletedSale = false;
      if (payload.sale_id) {
        const [saleRows] = await pool.query('SELECT sale_id FROM sales WHERE sale_id = ?', [payload.sale_id]);
        hasCompletedSale = saleRows.length > 0;
      }

      if (!hasCompletedSale) {
        orphanList.push({
          saga_id: row.saga_id,
          reservation_group_id: row.reservation_group_id,
          merchant_id: row.merchant_id,
          shop_name: row.shop_name,
          saga_status: row.saga_status,
          current_step: row.current_step,
          order_id: payload.order_id || payload.activeOrderId || null,
          payment_method: payload.payment_method || null,
          total_amount: payload.total_amount || null,
          error_log: row.error_log || null,
          created_at: row.created_at,
          updated_at: row.updated_at
        });
      }
    }

    res.json({
      success: true,
      count: orphanList.length,
      orphan_payments: orphanList
    });
  } catch (err) {
    console.error('[Sales Service] getOrphanPayments error:', err);
    res.status(500).json({ message: 'Failed to query orphan payments' });
  }
});

let isRecoveryRunning = false;

async function recoverPendingSagas() {
  if (isRecoveryRunning) return { skipped: true, reason: 'Recovery already in progress' };
  isRecoveryRunning = true;

  const summary = { processed: 0, recovered: 0, compensated: 0, errors: [] };

  try {
    const [sagas] = await pool.query(
      `SELECT * FROM saga_instances
       WHERE saga_status IN ('STARTED', 'RESERVED', 'PAID')
       ORDER BY created_at ASC`
    );

    const internalToken = `Bearer ${generateInternalToken()}`;

    for (const saga of sagas) {
      summary.processed++;
      const { saga_id, reservation_group_id, merchant_id, saga_status, current_step } = saga;
      let payload = {};
      try {
        payload = typeof saga.payload === 'string' ? JSON.parse(saga.payload) : saga.payload || {};
      } catch (e) {}

      try {
        // CASE A: STARTED with no reservation (or stale validating)
        if (saga_status === 'STARTED') {
          await pool.query(
            'UPDATE saga_instances SET saga_status = "FAILED", current_step = "STALE_STARTED_ABORTED" WHERE saga_id = ?',
            [saga_id]
          );
          summary.compensated++;
          continue;
        }

        // CASE B: RESERVED with no payment initiated or definite payment failure
        if (saga_status === 'RESERVED' && current_step === 'RESERVED' && !payload.order_id && payload.payment_method === 'CASH') {
          await releaseReservation(reservation_group_id, internalToken);
          await pool.query(
            'UPDATE saga_instances SET saga_status = "COMPENSATED", current_step = "RELEASED" WHERE saga_id = ?',
            [saga_id]
          );
          summary.compensated++;
          continue;
        }

        // CASE C: RESERVED / PAYING with uncertain UPI payment status -> Query Payment Service
        if (payload.payment_method === 'UPI' && payload.order_id && (saga_status === 'RESERVED' || current_step === 'PAYING')) {
          let verified = false;
          let verifyData = null;
          try {
            const verifyRes = await callService(`${PAYMENT_SERVICE_URL}/api/payments/cashfree/verify-order`, {
              method: 'POST',
              headers: { 'Authorization': internalToken, 'Content-Type': 'application/json' },
              body: JSON.stringify({ order_id: payload.order_id })
            });
            verifyData = await verifyRes.json();
            verified = verifyRes.ok && verifyData.success && verifyData.payment_status === 'SUCCESS';
          } catch (vErr) {
            console.warn(`[Recovery Worker] Unable to verify order ${payload.order_id}:`, vErr.message);
          }

          if (verified) {
            await pool.query(
              'UPDATE saga_instances SET saga_status = "PAID", current_step = "PAID" WHERE saga_id = ?',
              [saga_id]
            );
            saga.saga_status = 'PAID';
            saga.current_step = 'PAID';
          } else {
            await releaseReservation(reservation_group_id, internalToken);
            await pool.query(
              'UPDATE saga_instances SET saga_status = "COMPENSATED", current_step = "PAYMENT_UNCONFIRMED_RELEASED" WHERE saga_id = ?',
              [saga_id]
            );
            summary.compensated++;
            continue;
          }
        }

        // CASE D & E: PAID state recovery -> Ensure sale created & reservation committed
        if (saga.saga_status === 'PAID') {
          let existingSaleId = payload.sale_id || null;
          if (existingSaleId) {
            const [sCheck] = await pool.query('SELECT sale_id FROM sales WHERE sale_id = ?', [existingSaleId]);
            if (!sCheck.length) existingSaleId = null;
          }

          // Also check by transaction reference if a payment row already exists
          if (!existingSaleId) {
            const txnRef = payload.transaction_ref || (payload.order_id ? `CF-UPI-${payload.order_id}` : null);
            if (txnRef) {
              const [pRows] = await pool.query('SELECT sale_id FROM payments WHERE transaction_ref = ?', [txnRef]);
              if (pRows.length > 0 && pRows[0].sale_id) {
                existingSaleId = pRows[0].sale_id;
                payload.sale_id = existingSaleId;
              }
            }
          }

          if (!existingSaleId && payload.validatedItems && payload.total_amount) {
            const conn = await pool.getConnection();
            try {
              await conn.beginTransaction();

              const invoiceNumber = `INV-${Date.now()}_${Math.floor(Math.random() * 1000)}`;
              const [invRes] = await conn.query(
                'INSERT INTO invoices (merchant_id, invoice_number, invoice_date, total_amount) VALUES (?, ?, CURDATE(), ?)',
                [merchant_id, invoiceNumber, payload.total_amount]
              );
              const invoiceId = invRes.insertId;

              const [saleRes] = await conn.query(
                'INSERT INTO sales (merchant_id, invoice_id, subtotal, tax, discount, total_amount, sale_status) VALUES (?, ?, ?, ?, ?, ?, "COMPLETED")',
                [merchant_id, invoiceId, payload.subtotal || payload.total_amount, payload.tax || 0, payload.discount || 0, payload.total_amount]
              );
              existingSaleId = saleRes.insertId;

              for (const item of payload.validatedItems) {
                await conn.query(
                  'INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
                  [existingSaleId, item.product_id, item.quantity, item.unit_price]
                );
              }

              const txnRef = payload.transaction_ref || (payload.order_id ? `CF-UPI-${payload.order_id}` : `CASH-${Date.now()}`);
              await conn.query(
                'INSERT INTO payments (sale_id, payment_method, amount, transaction_ref, payment_status) VALUES (?, ?, ?, ?, "SUCCESS")',
                [existingSaleId, payload.payment_method || 'CASH', payload.total_amount, txnRef]
              );

              await conn.commit();
              payload.sale_id = existingSaleId;
              payload.invoice_id = invoiceId;
              payload.invoice_number = invoiceNumber;
            } catch (dbErr) {
              await conn.rollback();
              console.error(`[Recovery Worker] Sale creation failed for saga ${saga_id}:`, dbErr.message);

              const compRes = await compensatePayment({
                payment_method: payload.payment_method,
                order_id: payload.order_id,
                amount: payload.total_amount,
                authHeader: internalToken
              });

              await releaseReservation(reservation_group_id, internalToken);

              if (compRes.success) {
                await pool.query(
                  'UPDATE saga_instances SET saga_status = "COMPENSATED", current_step = "COMPENSATED", payload = ? WHERE saga_id = ?',
                  [JSON.stringify({ ...payload, compensated: true }), saga_id]
                );
                summary.compensated++;
              } else {
                await pool.query(
                  'UPDATE saga_instances SET saga_status = "FAILED", current_step = "PAYMENT_COMPENSATION_PENDING", error_log = ? WHERE saga_id = ?',
                  [`Payment captured but local sale creation and automated refund failed: ${compRes.message || compRes.error}`, saga_id]
                );
                summary.errors.push(`Orphan payment recorded for saga ${saga_id}`);
              }
              continue;
            } finally {
              conn.release();
            }
          }

          if (existingSaleId && reservation_group_id) {
            try {
              await callService(`${INVENTORY_SERVICE_URL}/api/inventory/reservations/${reservation_group_id}/commit`, {
                method: 'POST',
                headers: { 'Authorization': internalToken, 'Content-Type': 'application/json' },
                body: JSON.stringify({ sale_id: existingSaleId, merchant_id: merchant_id })
              });
            } catch (cErr) {
              console.warn(`[Recovery Worker] Commit warning for reservation ${reservation_group_id}:`, cErr.message);
            }

            await pool.query(
              'UPDATE saga_instances SET saga_status = "COMPLETED", current_step = "COMPLETED", payload = ? WHERE saga_id = ?',
              [JSON.stringify(payload), saga_id]
            );
            summary.recovered++;
          }
        }
      } catch (itemErr) {
        console.error(`[Recovery Worker] Error processing saga ${saga_id}:`, itemErr);
        summary.errors.push(`Saga ${saga_id}: ${itemErr.message}`);
      }
    }
  } catch (err) {
    console.error('[Recovery Worker] Global error in recoverPendingSagas:', err);
    summary.errors.push(err.message);
  } finally {
    isRecoveryRunning = false;
  }

  return summary;
}

// POST /api/sales/recovery-sweep - Trigger manual / automated recovery sweep
app.post('/api/sales/recovery-sweep', authenticateToken, authorizeRole('ADMIN', 'OWNER'), async (req, res) => {
  const result = await recoverPendingSagas();
  res.json({ success: true, result });
});

// Periodic background worker: runs every 30 seconds
setInterval(() => {
  recoverPendingSagas().catch(err => console.error('[Sales Service] Periodic recovery error:', err));
}, 30000);

// =========================================================================
// 2. SALES & INVOICE QUERY ENDPOINTS
// =========================================================================

// GET /api/sales - List sales
app.get('/api/sales', authenticateToken, async (req, res) => {
  try {
    let query = `SELECT s.sale_id, s.merchant_id, m.shop_name, s.sale_date, s.subtotal, s.tax,
                        s.discount, s.total_amount, s.sale_status, s.invoice_id
                 FROM sales s JOIN merchants m ON m.merchant_id = s.merchant_id`;
    const params = [];
    if (req.user.role === 'MERCHANT') {
      query += ' WHERE s.merchant_id = (SELECT merchant_id FROM merchants WHERE user_id = ?)';
      params.push(req.user.user_id);
    }
    query += ' ORDER BY s.sale_date DESC, s.sale_id DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('[Sales Service] getAllSales error:', err);
    res.status(500).json({ message: 'Failed to fetch sales' });
  }
});

// GET /api/sales/:id - Get single sale details
app.get('/api/sales/:id', authenticateToken, async (req, res) => {
  try {
    let query = 'SELECT * FROM sales WHERE sale_id = ?';
    const params = [req.params.id];
    if (req.user.role === 'MERCHANT') {
      query += ' AND merchant_id = (SELECT merchant_id FROM merchants WHERE user_id = ?)';
      params.push(req.user.user_id);
    }
    const [sale] = await pool.query(query, params);
    if (!sale.length) return res.status(404).json({ message: 'Sale not found' });

    const [items] = await pool.query(
      `SELECT si.*, p.product_name FROM sale_items si
       JOIN products p ON p.product_id = si.product_id WHERE si.sale_id = ?`,
      [req.params.id]
    );
    const [payment] = await pool.query('SELECT * FROM payments WHERE sale_id = ?', [req.params.id]);
    res.json({ ...sale[0], items, payment: payment[0] || null });
  } catch (err) {
    console.error('[Sales Service] getSaleById error:', err);
    res.status(500).json({ message: 'Failed to fetch sale' });
  }
});

// GET /api/invoices - List invoices
app.get('/api/invoices', authenticateToken, async (req, res) => {
  try {
    let query = `SELECT i.*, m.shop_name FROM invoices i JOIN merchants m ON m.merchant_id = i.merchant_id`;
    const params = [];
    if (req.user.role === 'MERCHANT') {
      query += ' WHERE i.merchant_id = (SELECT merchant_id FROM merchants WHERE user_id = ?)';
      params.push(req.user.user_id);
    }
    query += ' ORDER BY i.invoice_date DESC, i.invoice_id DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('[Sales Service] getAllInvoices error:', err);
    res.status(500).json({ message: 'Failed to fetch invoices' });
  }
});

// GET /api/invoices/:id - Get single invoice details
app.get('/api/invoices/:id', authenticateToken, async (req, res) => {
  try {
    let query = `SELECT i.*, m.shop_name FROM invoices i JOIN merchants m ON m.merchant_id = i.merchant_id WHERE i.invoice_id = ?`;
    const params = [req.params.id];
    if (req.user.role === 'MERCHANT') {
      query += ' AND i.merchant_id = (SELECT merchant_id FROM merchants WHERE user_id = ?)';
      params.push(req.user.user_id);
    }
    const [rows] = await pool.query(query, params);
    if (!rows.length) return res.status(404).json({ message: 'Invoice not found' });
    const [sale] = await pool.query('SELECT * FROM sales WHERE invoice_id = ?', [req.params.id]);
    res.json({ ...rows[0], sale: sale[0] || null });
  } catch (err) {
    console.error('[Sales Service] getInvoiceById error:', err);
    res.status(500).json({ message: 'Failed to fetch invoice' });
  }
});

// =========================================================================
// 3. DISTRIBUTED SALES SAGA CHECKOUT
// =========================================================================

// POST /api/sales - Distributed Saga Checkout
app.post('/api/sales', authenticateToken, authorizeRole('MERCHANT', 'ADMIN', 'OWNER'), async (req, res) => {
  const { items, tax = 0, discount = 0, payment_method, order_id, cashfree_order_id } = req.body;
  const rawAuthHeader = req.headers.authorization;

  // --------------------------------------------------
  // STEP B: VALIDATE REQUEST STRUCTURE
  // --------------------------------------------------
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'At least one sale item is required' });
  }
  if (!payment_method || !['CASH', 'UPI', 'CARD', 'ONLINE'].includes(payment_method)) {
    return res.status(400).json({ message: 'Valid payment_method is required (CASH or UPI)' });
  }

  const numTax = Number(tax);
  const numDiscount = Number(discount);
  if (isNaN(numTax) || numTax < 0) {
    return res.status(400).json({ message: 'Tax must be a valid non-negative number' });
  }
  if (isNaN(numDiscount) || numDiscount < 0) {
    return res.status(400).json({ message: 'Discount must be a valid non-negative number' });
  }

  // Explicit Idempotency key from headers or body
  const explicitIdempotencyKey = (
    req.headers['idempotency-key'] ||
    req.headers['x-idempotency-key'] ||
    req.body.idempotency_key ||
    ''
  ).trim();

  let merchantId = null;
  let reservationGroupId = null;

  try {
    // --------------------------------------------------
    // STEP A: RESOLVE AUTHENTICATED MERCHANT
    // --------------------------------------------------
    const [mCheck] = await pool.query(
      req.user.role === 'MERCHANT'
        ? 'SELECT merchant_id FROM merchants WHERE user_id = ?'
        : 'SELECT merchant_id FROM merchants WHERE merchant_id = ? OR 1=1 LIMIT 1',
      req.user.role === 'MERCHANT' ? [req.user.user_id] : [req.body.merchant_id || 1]
    );

    if (!mCheck.length) {
      return res.status(400).json({ message: 'Merchant profile not found' });
    }
    merchantId = mCheck[0].merchant_id;

    // --------------------------------------------------
    // IDEMPOTENCY CHECK (Explicit Idempotency Key)
    // --------------------------------------------------
    if (explicitIdempotencyKey) {
      const [existingSaga] = await pool.query(
        'SELECT * FROM saga_instances WHERE (saga_id = ? OR JSON_UNQUOTE(JSON_EXTRACT(payload, "$.idempotency_key")) = ?) AND merchant_id = ?',
        [`saga_${explicitIdempotencyKey}`, explicitIdempotencyKey, merchantId]
      );

      if (existingSaga.length > 0) {
        const s = existingSaga[0];
        if (s.saga_status === 'COMPLETED' && s.payload) {
          const payload = typeof s.payload === 'string' ? JSON.parse(s.payload) : s.payload;
          return res.status(200).json({
            message: 'Sale already recorded (idempotent response)',
            ...payload
          });
        }
        if (['STARTED', 'RESERVED', 'PAID'].includes(s.saga_status)) {
          return res.status(409).json({
            message: 'Sale processing is currently in progress for this request'
          });
        }
      }
    }

    // --------------------------------------------------
    // REPLAY / DUPLICATE PAYMENT CHECK (UPI / Cashfree)
    // --------------------------------------------------
    if (payment_method === 'UPI') {
      const activeOrderId = (order_id || cashfree_order_id || '').trim();
      if (!activeOrderId) {
        return res.status(400).json({ message: 'Cashfree order_id is required for UPI payments' });
      }

      const [existingTxn] = await pool.query(
        'SELECT payment_id, sale_id FROM payments WHERE transaction_ref = ? OR transaction_ref LIKE ? OR transaction_ref = ?',
        [`CF-UPI-${activeOrderId}`, `%${activeOrderId}%`, `CF-UPI-${activeOrderId.slice(-8)}`]
      );
      if (existingTxn.length > 0) {
        return res.status(409).json({
          message: `This Cashfree order (${activeOrderId}) has already been processed for Sale #${existingTxn[0].sale_id}`
        });
      }
    }

    // --------------------------------------------------
    // STEP C: PRODUCT SERVICE PRICE LOOKUP
    // --------------------------------------------------
    let subtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const productId = Number(item.product_id);
      const quantity = Number(item.quantity);

      if (!productId || isNaN(productId) || productId <= 0 || isNaN(quantity) || quantity <= 0) {
        return res.status(400).json({ message: 'Each item must have a valid product_id and positive quantity' });
      }

      // Authoritative call to Product Service
      let prodRes;
      try {
        prodRes = await callService(`${PRODUCT_SERVICE_URL}/api/products/${productId}`, {
          method: 'GET',
          headers: {
            'Authorization': rawAuthHeader,
            'Content-Type': 'application/json'
          }
        });
      } catch (svcErr) {
        console.error(`[Sales Saga] Product Service unreachable for product ${productId}:`, svcErr.message);
        return res.status(503).json({ message: 'Product Service is currently unavailable' });
      }

      if (!prodRes.ok) {
        return res.status(400).json({ message: `Product ${productId} not found or is discontinued` });
      }

      const prodData = await prodRes.json();
      if (!prodData || prodData.status !== 'ACTIVE') {
        return res.status(400).json({ message: `Product ${productId} not found or is discontinued` });
      }

      const authoritativePrice = Number(prodData.selling_price);
      subtotal += quantity * authoritativePrice;

      validatedItems.push({
        product_id: productId,
        product_name: prodData.product_name,
        quantity: quantity,
        unit_price: authoritativePrice
      });
    }

    // Financial calculations
    if (numDiscount > subtotal) {
      return res.status(400).json({
        message: `Discount (₹${numDiscount.toFixed(2)}) cannot exceed subtotal (₹${subtotal.toFixed(2)})`
      });
    }

    const total_amount = Number((subtotal + numTax - numDiscount).toFixed(2));
    if (total_amount <= 0) {
      return res.status(400).json({ message: 'Total bill amount must be greater than ₹0.00' });
    }

    // --------------------------------------------------
    // STEP D: CREATE INVENTORY RESERVATION
    // --------------------------------------------------
    let reserveRes;
    try {
      reserveRes = await callService(`${INVENTORY_SERVICE_URL}/api/inventory/reservations`, {
        method: 'POST',
        headers: {
          'Authorization': rawAuthHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          items: validatedItems.map(i => ({ product_id: i.product_id, quantity: i.quantity })),
          ttl_seconds: 300,
          merchant_id: merchantId
        })
      });
    } catch (invErr) {
      console.error('[Sales Saga] Inventory Service unreachable for reservation:', invErr.message);
      return res.status(503).json({ message: 'Inventory Service is currently unavailable' });
    }

    const reserveData = await reserveRes.json();
    if (!reserveRes.ok || !reserveData.reservation_group_id) {
      console.error('[Sales Saga] Inventory reservation failed:', reserveData);
      return res.status(reserveRes.status || 400).json({
        message: reserveData.message || 'Failed to reserve inventory'
      });
    }

    reservationGroupId = reserveData.reservation_group_id;

    // Attach custom saga_id or idempotency_key if provided
    const basePayload = {
      idempotency_key: explicitIdempotencyKey || null,
      order_id: (order_id || cashfree_order_id || '').trim(),
      payment_method,
      validatedItems,
      subtotal,
      tax: numTax,
      discount: numDiscount,
      total_amount
    };

    if (explicitIdempotencyKey) {
      await pool.query(
        'UPDATE saga_instances SET saga_id = ?, payload = ? WHERE reservation_group_id = ?',
        [
          `saga_${explicitIdempotencyKey}`,
          JSON.stringify(basePayload),
          reservationGroupId
        ]
      ).catch(() => {});
    } else {
      await pool.query(
        'UPDATE saga_instances SET payload = ? WHERE reservation_group_id = ?',
        [JSON.stringify(basePayload), reservationGroupId]
      ).catch(() => {});
    }

    // --------------------------------------------------
    // STEP E: PAYMENT PROCESSING
    // --------------------------------------------------
    await pool.query(
      'UPDATE saga_instances SET current_step = "PAYING" WHERE reservation_group_id = ?',
      [reservationGroupId]
    );

    let finalPaymentStatus = 'PENDING';
    let finalTxnRef = null;

    if (payment_method === 'UPI') {
      const activeOrderId = (order_id || cashfree_order_id || '').trim();

      // Verify payment with Payment Service
      let cfRes;
      try {
        cfRes = await callService(`${PAYMENT_SERVICE_URL}/api/payments/cashfree/verify-order`, {
          method: 'POST',
          headers: {
            'Authorization': rawAuthHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ order_id: activeOrderId })
        });
      } catch (payErr) {
        console.error('[Sales Saga] Payment Service unreachable for verify-order:', payErr.message);
        await releaseReservation(reservationGroupId, rawAuthHeader);
        await pool.query(
          'UPDATE saga_instances SET saga_status = "COMPENSATED", current_step = "PAYMENT_SERVICE_UNAVAILABLE", error_log = ? WHERE reservation_group_id = ?',
          [payErr.message, reservationGroupId]
        );
        return res.status(503).json({ message: 'Payment Service is currently unavailable' });
      }

      const cfData = await cfRes.json();
      if (!cfRes.ok || !cfData.success || cfData.payment_status !== 'SUCCESS') {
        await releaseReservation(reservationGroupId, rawAuthHeader);
        await pool.query(
          'UPDATE saga_instances SET saga_status = "COMPENSATED", current_step = "PAYMENT_VERIFY_FAILED", error_log = ? WHERE reservation_group_id = ?',
          [cfData.message || 'Payment not confirmed', reservationGroupId]
        );
        return res.status(400).json({
          message: `Cashfree payment verification failed: ${cfData.message || 'Payment not confirmed'}`
        });
      }

      // Parity check if amount is present
      if (cfData.order_amount && Math.abs(Number(cfData.order_amount) - total_amount) > 0.05) {
        await releaseReservation(reservationGroupId, rawAuthHeader);
        await pool.query(
          'UPDATE saga_instances SET saga_status = "COMPENSATED", current_step = "AMOUNT_MISMATCH_RELEASED" WHERE reservation_group_id = ?',
          [reservationGroupId]
        );
        return res.status(400).json({
          message: `Payment amount mismatch: Cashfree order is ₹${Number(cfData.order_amount).toFixed(2)}, but calculated total is ₹${total_amount.toFixed(2)}`
        });
      }

      finalPaymentStatus = 'SUCCESS';
      finalTxnRef = `CF-UPI-${activeOrderId}`;
    } else if (payment_method === 'CASH') {
      // CASH payment at POS
      finalPaymentStatus = 'SUCCESS';
      finalTxnRef = `CASH-${Date.now()}`;
    }

    // Mark Saga as PAID
    await pool.query(
      'UPDATE saga_instances SET saga_status = "PAID", current_step = "PAID" WHERE reservation_group_id = ?',
      [reservationGroupId]
    );

    // --------------------------------------------------
    // STEP F: LOCAL SALES TRANSACTION (ACID)
    // --------------------------------------------------
    await pool.query(
      'UPDATE saga_instances SET current_step = "CREATING_SALE" WHERE reservation_group_id = ?',
      [reservationGroupId]
    );

    const conn = await pool.getConnection();
    let saleId = null;
    let invoiceId = null;
    const invoiceNumber = `INV-${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    try {
      await conn.beginTransaction();

      // 1. Insert invoice
      const [invResult] = await conn.query(
        'INSERT INTO invoices (merchant_id, invoice_number, invoice_date, total_amount) VALUES (?, ?, CURDATE(), ?)',
        [merchantId, invoiceNumber, total_amount]
      );
      invoiceId = invResult.insertId;

      // 2. Insert sale
      const [saleResult] = await conn.query(
        'INSERT INTO sales (merchant_id, invoice_id, subtotal, tax, discount, total_amount, sale_status) VALUES (?, ?, ?, ?, ?, ?, "COMPLETED")',
        [merchantId, invoiceId, subtotal, numTax, numDiscount, total_amount]
      );
      saleId = saleResult.insertId;

      // 3. Insert sale_items
      for (const item of validatedItems) {
        await conn.query(
          'INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
          [saleId, item.product_id, item.quantity, item.unit_price]
        );
      }

      // 4. Insert payment
      await conn.query(
        'INSERT INTO payments (sale_id, payment_method, amount, transaction_ref, payment_status) VALUES (?, ?, ?, ?, ?)',
        [saleId, payment_method, total_amount, finalTxnRef, finalPaymentStatus]
      );

      await conn.commit();
    } catch (dbErr) {
      await conn.rollback();
      console.error('[Sales Saga] Local Sales MySQL Transaction Failed:', dbErr);

      // Attempt payment compensation (refund / POS void)
      const compRes = await compensatePayment({
        payment_method,
        order_id: (order_id || cashfree_order_id || '').trim(),
        amount: total_amount,
        authHeader: rawAuthHeader
      });

      // Compensate inventory reservation release
      await releaseReservation(reservationGroupId, rawAuthHeader);

      if (compRes.success) {
        await pool.query(
          'UPDATE saga_instances SET saga_status = "COMPENSATED", current_step = "COMPENSATED", payload = ? WHERE reservation_group_id = ?',
          [JSON.stringify({ ...basePayload, compensated: true, reason: dbErr.message }), reservationGroupId]
        );
      } else {
        await pool.query(
          'UPDATE saga_instances SET saga_status = "FAILED", current_step = "PAYMENT_COMPENSATION_PENDING", error_log = ? WHERE reservation_group_id = ?',
          [`Payment captured but local sale creation and automated refund failed: ${compRes.message || compRes.error}`, reservationGroupId]
        );
      }

      return res.status(500).json({ message: 'Failed to record sale — transaction rolled back' });
    } finally {
      conn.release();
    }

    // --------------------------------------------------
    // STEP G: COMMIT INVENTORY RESERVATION (IDEMPOTENT)
    // --------------------------------------------------
    await pool.query(
      'UPDATE saga_instances SET current_step = "COMMITTING_INVENTORY" WHERE reservation_group_id = ?',
      [reservationGroupId]
    );

    // Call commit on Inventory Service with retry resilience
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const commitRes = await callService(
          `${INVENTORY_SERVICE_URL}/api/inventory/reservations/${reservationGroupId}/commit`,
          {
            method: 'POST',
            headers: {
              'Authorization': rawAuthHeader,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sale_id: saleId, merchant_id: merchantId })
          }
        );
        if (commitRes.ok) {
          break;
        }
      } catch (cErr) {
        console.warn(`[Sales Saga] Commit attempt ${attempt} failed:`, cErr.message);
      }
    }

    // --------------------------------------------------
    // STEP H: COMPLETE SAGA & RESPOND
    // --------------------------------------------------
    const finalPayload = {
      sale_id: saleId,
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      total_amount,
      payment_status: finalPaymentStatus,
      transaction_ref: finalTxnRef,
      reservation_group_id: reservationGroupId
    };

    await pool.query(
      'UPDATE saga_instances SET saga_status = "COMPLETED", current_step = "COMPLETED", payload = ? WHERE reservation_group_id = ?',
      [JSON.stringify(finalPayload), reservationGroupId]
    );

    return res.status(201).json({
      message: 'Sale recorded successfully',
      ...finalPayload
    });
  } catch (err) {
    console.error('[Sales Saga] Unhandled error during saga execution:', err);
    if (reservationGroupId) {
      await releaseReservation(reservationGroupId, rawAuthHeader).catch(() => {});
      await pool.query(
        'UPDATE saga_instances SET saga_status = "FAILED", current_step = "UNHANDLED_ERROR", error_log = ? WHERE reservation_group_id = ?',
        [err.message, reservationGroupId]
      ).catch(() => {});
    }

    return res.status(err.status || 500).json({ message: err.message || 'Internal server error during sale orchestration' });
  }
});

app.listen(PORT, () => {
  console.log(`[Sales Service] Running on port ${PORT}`);
});
