const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'backend', '.env') });
require('dotenv').config(); // Fallback

const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 4007;
const JWT_SECRET = process.env.JWT_SECRET || 'replace_with_a_long_random_secret';

app.use(cors());
app.use(express.json());

// Service Health Checks
app.get('/health', (req, res) => {
  res.json({ service: 'reporting-service', port: PORT, status: 'OK' });
});
app.get('/api/discrepancies/health', (req, res) => {
  res.json({ service: 'reporting-service', port: PORT, status: 'OK' });
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
    // OWNER has full master admin access to all ADMIN/OWNER routes
    if (req.user.role === 'OWNER' && (allowedRoles.includes('ADMIN') || allowedRoles.includes('OWNER'))) {
      return next();
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied for this role' });
    }
    next();
  };
}

// Read-Only Enforcement: Reject non-GET requests on reporting endpoints
function enforceReadOnly(req, res, next) {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return res.status(405).json({ message: 'Method Not Allowed: Reporting service is strictly read-only' });
  }
  next();
}

app.use('/api/discrepancies', enforceReadOnly);
app.use('/api/discrepancies', authenticateToken);

// Helper function to resolve merchant_id for a user
async function resolveMerchantId(userId) {
  const [rows] = await pool.query('SELECT merchant_id FROM merchants WHERE user_id = ?', [userId]);
  return rows.length > 0 ? rows[0].merchant_id : null;
}

// 1. GET /api/discrepancies/payment - Payment discrepancies per merchant (ADMIN / OWNER)
app.get('/api/discrepancies/payment', authorizeRole('ADMIN', 'OWNER'), async (req, res) => {
  try {
    const { merchant_id } = req.query;
    let query = `
      SELECT m.shop_name, d.merchant_id, d.total_sales, d.total_successful_payments, d.discrepancy
      FROM vw_payment_discrepancy d
      JOIN merchants m ON m.merchant_id = d.merchant_id
      WHERE d.discrepancy <> 0
    `;
    const params = [];

    if (merchant_id !== undefined) {
      const parsedId = parseInt(merchant_id, 10);
      if (isNaN(parsedId) || String(parsedId) !== String(merchant_id).trim()) {
        return res.status(400).json({ message: 'Invalid merchant_id query parameter' });
      }
      query += ` AND d.merchant_id = ?`;
      params.push(parsedId);
    }

    query += ` ORDER BY ABS(d.discrepancy) DESC`;

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('[Reporting Service] getPaymentDiscrepancies error:', err);
    res.status(500).json({ message: 'Failed to compute payment discrepancies' });
  }
});

// 2. GET /api/discrepancies/stock - Stock discrepancies per merchant & product (ADMIN / OWNER)
app.get('/api/discrepancies/stock', authorizeRole('ADMIN', 'OWNER'), async (req, res) => {
  try {
    const { merchant_id } = req.query;
    let query = `
      SELECT m.shop_name, d.*
      FROM vw_stock_discrepancy d
      JOIN merchants m ON m.merchant_id = d.merchant_id
      WHERE d.discrepancy <> 0
    `;
    const params = [];

    if (merchant_id !== undefined) {
      const parsedId = parseInt(merchant_id, 10);
      if (isNaN(parsedId) || String(parsedId) !== String(merchant_id).trim()) {
        return res.status(400).json({ message: 'Invalid merchant_id query parameter' });
      }
      query += ` AND d.merchant_id = ?`;
      params.push(parsedId);
    }

    query += ` ORDER BY ABS(d.discrepancy) DESC`;

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('[Reporting Service] getStockDiscrepancies error:', err);
    res.status(500).json({ message: 'Failed to compute stock discrepancies' });
  }
});

// 3. GET /api/discrepancies/summary/admin - Admin dashboard summary metrics (ADMIN / OWNER)
app.get('/api/discrepancies/summary/admin', authorizeRole('ADMIN', 'OWNER'), async (req, res) => {
  try {
    const [[merchantCount]] = await pool.query('SELECT COUNT(*) AS total FROM merchants');
    const [[salesTotal]] = await pool.query("SELECT COALESCE(SUM(total_amount),0) AS total FROM sales WHERE sale_status='COMPLETED'");
    const [[revenueTotal]] = await pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE payment_status='SUCCESS'");
    const [[paymentDiscCount]] = await pool.query('SELECT COUNT(*) AS total FROM vw_payment_discrepancy WHERE discrepancy <> 0');
    const [[stockDiscCount]] = await pool.query('SELECT COUNT(*) AS total FROM vw_stock_discrepancy WHERE discrepancy <> 0');

    res.json({
      total_merchants: merchantCount.total,
      total_sales: salesTotal.total,
      total_revenue: revenueTotal.total,
      payment_discrepancies: paymentDiscCount.total,
      stock_discrepancies: stockDiscCount.total
    });
  } catch (err) {
    console.error('[Reporting Service] getAdminSummary error:', err);
    res.status(500).json({ message: 'Failed to build admin summary' });
  }
});

// 4. GET /api/discrepancies/summary/merchant - Merchant dashboard summary metrics (MERCHANT)
app.get('/api/discrepancies/summary/merchant', authorizeRole('MERCHANT'), async (req, res) => {
  try {
    const merchantId = await resolveMerchantId(req.user.user_id);
    if (!merchantId) {
      return res.status(404).json({ message: 'Merchant profile not found' });
    }

    const [[todaySales]] = await pool.query(
      "SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*) AS cnt FROM sales WHERE merchant_id=? AND DATE(sale_date)=CURDATE() AND sale_status='COMPLETED'",
      [merchantId]
    );
    const [[pendingPayments]] = await pool.query(
      `SELECT COALESCE(SUM(pay.amount),0) AS total FROM payments pay
       JOIN sales s ON s.sale_id = pay.sale_id
       WHERE s.merchant_id=? AND pay.payment_status='PENDING'`,
      [merchantId]
    );
    const [recentSales] = await pool.query(
      'SELECT sale_id, sale_date, total_amount, sale_status FROM sales WHERE merchant_id=? ORDER BY sale_date DESC LIMIT 5',
      [merchantId]
    );
    const [inventoryRows] = await pool.query(
      `SELECT p.product_name, i.quantity_available FROM inventory i
       JOIN products p ON p.product_id = i.product_id WHERE i.merchant_id=?`,
      [merchantId]
    );

    res.json({
      todays_sales: todaySales.total,
      todays_sale_count: todaySales.cnt,
      pending_payments: pendingPayments.total,
      recent_sales: recentSales,
      inventory: inventoryRows
    });
  } catch (err) {
    console.error('[Reporting Service] getMerchantSummary error:', err);
    res.status(500).json({ message: 'Failed to build merchant summary' });
  }
});

// 5. GET /api/discrepancies/revenue - Merchant Revenue Report via vw_merchant_revenue (ADMIN, OWNER, MERCHANT)
app.get('/api/discrepancies/revenue', authorizeRole('ADMIN', 'OWNER', 'MERCHANT'), async (req, res) => {
  try {
    if (req.user.role === 'MERCHANT') {
      const merchantId = await resolveMerchantId(req.user.user_id);
      if (!merchantId) {
        return res.status(404).json({ message: 'Merchant profile not found' });
      }
      const [rows] = await pool.query(
        'SELECT * FROM vw_merchant_revenue WHERE merchant_id = ?',
        [merchantId]
      );
      return res.json(rows);
    }

    // ADMIN or OWNER
    const { merchant_id } = req.query;
    if (merchant_id !== undefined) {
      const parsedId = parseInt(merchant_id, 10);
      if (isNaN(parsedId) || String(parsedId) !== String(merchant_id).trim()) {
        return res.status(400).json({ message: 'Invalid merchant_id query parameter' });
      }
      const [rows] = await pool.query(
        'SELECT * FROM vw_merchant_revenue WHERE merchant_id = ?',
        [parsedId]
      );
      return res.json(rows);
    }

    const [rows] = await pool.query('SELECT * FROM vw_merchant_revenue ORDER BY merchant_id');
    res.json(rows);
  } catch (err) {
    console.error('[Reporting Service] getMerchantRevenue error:', err);
    res.status(500).json({ message: 'Failed to fetch merchant revenue report' });
  }
});

// Fallback 404
app.use((req, res) => res.status(404).json({ message: 'Route not found' }));

// Central error handler
app.use((err, req, res, next) => {
  console.error('[Reporting Service] Unhandled error:', err);
  res.status(500).json({ message: 'Unexpected server error' });
});

app.listen(PORT, () => {
  console.log(`[Reporting Service] Running on port ${PORT}`);
});

module.exports = app;
