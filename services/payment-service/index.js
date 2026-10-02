const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config(); // Fallback

const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 4006;
const JWT_SECRET = process.env.JWT_SECRET || 'replace_with_a_long_random_secret';

const CASHFREE_APP_ID = process.env.CASHFREE_APP_ID || '';
const CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || '';
const CASHFREE_ENV = process.env.CASHFREE_ENV || 'TEST';

const CASHFREE_BASE_URL = CASHFREE_ENV === 'PROD'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';

app.use(cors());
app.use(express.json());

// Service Health Checks
app.get('/health', (req, res) => {
  res.json({ service: 'payment-service', port: PORT, status: 'OK' });
});
app.get('/api/payments/health', (req, res) => {
  res.json({ service: 'payment-service', port: PORT, status: 'OK' });
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

// All /api/payments routes require authentication
app.use('/api/payments', authenticateToken);

// GET /api/payments - List payments (scoped by merchant for MERCHANT role)
app.get('/api/payments', async (req, res) => {
  try {
    let query = `SELECT pay.*, s.merchant_id, m.shop_name
                 FROM payments pay
                 JOIN sales s ON s.sale_id = pay.sale_id
                 JOIN merchants m ON m.merchant_id = s.merchant_id`;
    const params = [];
    if (req.user.role === 'MERCHANT') {
      query += ' WHERE s.merchant_id = (SELECT merchant_id FROM merchants WHERE user_id = ?)';
      params.push(req.user.user_id);
    }
    query += ' ORDER BY pay.payment_date DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('[Payment Service] getAllPayments error:', err);
    res.status(500).json({ message: 'Failed to fetch payments' });
  }
});

// POST /api/payments - Manual payment record (ADMIN/OWNER only)
app.post('/api/payments', authorizeRole('ADMIN'), async (req, res) => {
  const { sale_id, payment_method, amount, transaction_ref, payment_status } = req.body;
  if (!sale_id || !payment_method || amount == null) {
    return res.status(400).json({ message: 'sale_id, payment_method and amount are required' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO payments (sale_id, payment_method, amount, transaction_ref, payment_status) VALUES (?,?,?,?,?)',
      [sale_id, payment_method, amount, transaction_ref || null, payment_status || 'PENDING']
    );
    res.status(201).json({ message: 'Payment recorded', payment_id: result.insertId });
  } catch (err) {
    console.error('[Payment Service] createPayment error:', err);
    res.status(500).json({ message: 'Failed to record payment' });
  }
});

// POST /api/payments/cashfree/create-order - Create Cashfree Order & Dynamic UPI QR Code
app.post('/api/payments/cashfree/create-order', async (req, res) => {
  try {
    const { amount, customer_phone, customer_name } = req.body;
    const numAmount = Number(amount);

    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({ message: 'Valid payment amount is required' });
    }

    const orderId = `order_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // Call Cashfree Orders API
    const orderResponse = await fetch(`${CASHFREE_BASE_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': '2023-08-01',
        'x-client-id': CASHFREE_APP_ID,
        'x-client-secret': CASHFREE_SECRET_KEY
      },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: numAmount,
        order_currency: 'INR',
        customer_details: {
          customer_id: `cust_${Date.now()}`,
          customer_name: customer_name || 'Walk-in Customer',
          customer_phone: customer_phone || '9999999999'
        },
        order_meta: {
          return_url: 'http://localhost:5173/merchant/sales'
        }
      })
    });

    const orderData = await orderResponse.json();

    if (!orderResponse.ok || !orderData.payment_session_id) {
      console.error('[Payment Service] Cashfree Create Order Error:', orderData);
      return res.status(500).json({
        message: orderData.message || 'Failed to create order on Cashfree server'
      });
    }

    // Request Dynamic UPI QR Code session
    const payResponse = await fetch(`${CASHFREE_BASE_URL}/orders/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': '2023-08-01',
        'x-client-id': CASHFREE_APP_ID,
        'x-client-secret': CASHFREE_SECRET_KEY
      },
      body: JSON.stringify({
        payment_session_id: orderData.payment_session_id,
        payment_method: {
          upi: {
            channel: 'qrcode'
          }
        }
      })
    });

    const payData = await payResponse.json();
    const qrCodeDataUrl = payData?.data?.payload?.qrcode || null;
    const cfPaymentId = payData?.cf_payment_id || null;

    return res.json({
      success: true,
      provider: 'Cashfree Payments',
      environment: CASHFREE_ENV,
      order_id: orderData.order_id,
      cf_order_id: orderData.cf_order_id,
      cf_payment_id: cfPaymentId,
      payment_session_id: orderData.payment_session_id,
      order_amount: numAmount.toFixed(2),
      order_currency: 'INR',
      qr_image: qrCodeDataUrl,
      upi_link: `upi://pay?pa=cashfree.dairyhub@icici&pn=DairyHub&am=${numAmount.toFixed(2)}&tr=${orderData.order_id}&cu=INR`,
      vpa: 'cashfree.dairyhub@icici',
      merchant_name: 'DairyHub Cooperative',
      created_at: orderData.created_at || new Date().toISOString()
    });
  } catch (err) {
    console.error('[Payment Service] createCashfreeOrder error:', err);
    res.status(500).json({ message: 'Failed to create Cashfree order: ' + err.message });
  }
});

// POST /api/payments/cashfree/verify-order - Verify Cashfree Order status
app.post('/api/payments/cashfree/verify-order', async (req, res) => {
  try {
    const { order_id } = req.body;
    if (!order_id) {
      return res.status(400).json({ message: 'order_id is required' });
    }

    const response = await fetch(`${CASHFREE_BASE_URL}/orders/${order_id}/payments`, {
      headers: {
        'x-api-version': '2023-08-01',
        'x-client-id': CASHFREE_APP_ID,
        'x-client-secret': CASHFREE_SECRET_KEY
      }
    });

    const payments = await response.json().catch(() => []);
    if (Array.isArray(payments) && payments.length > 0) {
      const successfulPayment = payments.find(p => p.payment_status === 'SUCCESS');
      if (successfulPayment) {
        return res.json({
          success: true,
          order_id,
          cf_payment_id: String(successfulPayment.cf_payment_id || `cf_pay_${Date.now()}`),
          payment_status: 'SUCCESS',
          payment_method: 'UPI',
          payment_group: 'cashfree_upi',
          transaction_ref: `CF-UPI-${successfulPayment.cf_payment_id || Date.now().toString().slice(-8)}`,
          bank_reference: successfulPayment.bank_reference || `UPI/${Date.now().toString().slice(-10)}`,
          payment_message: 'Payment verified with Cashfree Live Gateway'
        });
      }
    }

    // Test Sandbox fallback simulation
    if (CASHFREE_ENV === 'TEST') {
      const cfPaymentId = `cf_pay_${Date.now()}`;
      const txnRef = `CF-UPI-${Date.now().toString().slice(-8)}`;

      return res.json({
        success: true,
        order_id,
        cf_payment_id: cfPaymentId,
        payment_status: 'SUCCESS',
        payment_method: 'UPI',
        payment_group: 'cashfree_upi',
        transaction_ref: txnRef,
        bank_reference: `UPI/${Date.now().toString().slice(-10)}`,
        payment_message: 'Payment simulated via Cashfree Test Sandbox'
      });
    }

    return res.status(400).json({
      success: false,
      order_id,
      payment_status: 'PENDING',
      message: 'No completed payment recorded on Cashfree gateway yet'
    });
  } catch (err) {
    console.error('[Payment Service] verifyCashfreeOrder error:', err);
    res.status(500).json({ message: 'Failed to verify Cashfree payment: ' + err.message });
  }
});

// POST /api/payments/cashfree/refund - Refund / Compensate Cashfree UPI Order
app.post('/api/payments/cashfree/refund', async (req, res) => {
  try {
    const { order_id, refund_amount, refund_id, refund_note } = req.body;
    if (!order_id) {
      return res.status(400).json({ message: 'order_id is required for refund' });
    }

    const refId = refund_id || `ref_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    if (CASHFREE_ENV === 'PROD') {
      const response = await fetch(`${CASHFREE_BASE_URL}/orders/${order_id}/refunds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-version': '2023-08-01',
          'x-client-id': CASHFREE_APP_ID,
          'x-client-secret': CASHFREE_SECRET_KEY
        },
        body: JSON.stringify({
          refund_id: refId,
          refund_amount: Number(refund_amount || 0),
          refund_note: refund_note || 'Saga compensation rollback'
        })
      });

      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status || 400).json({
          success: false,
          order_id,
          refund_id: refId,
          message: data.message || 'Refund request rejected by Cashfree live gateway'
        });
      }

      return res.json({
        success: true,
        order_id,
        cf_refund_id: data.cf_refund_id || refId,
        refund_id: refId,
        refund_status: data.refund_status || 'SUCCESS',
        refund_amount: data.refund_amount,
        message: 'Refund processed with Cashfree Live Gateway'
      });
    }

    // Test Sandbox fallback simulation
    return res.json({
      success: true,
      order_id,
      cf_refund_id: `cf_ref_${Date.now()}`,
      refund_id: refId,
      refund_status: 'SUCCESS',
      refund_amount: Number(refund_amount || 0),
      message: 'Refund simulated successfully via Cashfree Test Sandbox'
    });
  } catch (err) {
    console.error('[Payment Service] refund error:', err);
    res.status(500).json({ message: 'Failed to process refund: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Payment Service] Running on port ${PORT}`);
});
