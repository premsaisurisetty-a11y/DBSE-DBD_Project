const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config(); // Fallback

const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 4002;
const JWT_SECRET = process.env.JWT_SECRET || 'replace_with_a_long_random_secret';

app.use(cors());
app.use(express.json());

// Service Health Checks
app.get('/health', (req, res) => {
  res.json({ service: 'merchant-service', port: PORT, status: 'OK' });
});
app.get('/api/merchants/health', (req, res) => {
  res.json({ service: 'merchant-service', port: PORT, status: 'OK' });
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

// All /api/merchants routes require authentication
app.use('/api/merchants', authenticateToken);

// GET /api/merchants - Get all merchants (ADMIN/OWNER only)
app.get('/api/merchants', authorizeRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT m.merchant_id, m.merchant_code, m.shop_name, m.shift, m.phone, m.address, u.name as merchant_name, u.email, u.status
       FROM merchants m JOIN users u ON u.user_id = m.user_id
       ORDER BY m.merchant_id`
    );
    res.json(rows);
  } catch (err) {
    console.error('[Merchant Service] getAllMerchants error:', err);
    res.status(500).json({ message: 'Failed to fetch merchants' });
  }
});

// GET /api/merchants/:id - Get merchant by ID (ADMIN/OWNER only)
app.get('/api/merchants/:id', authorizeRole('ADMIN'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT m.merchant_id, m.merchant_code, m.shop_name, m.shift, m.phone, m.address, u.name as merchant_name, u.email, u.status
       FROM merchants m JOIN users u ON u.user_id = m.user_id
       WHERE m.merchant_id = ?`,
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(404).json({ message: 'Merchant not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('[Merchant Service] getMerchantById error:', err);
    res.status(500).json({ message: 'Failed to fetch merchant' });
  }
});

// PUT /api/merchants/:id/status - Update merchant status (ADMIN/OWNER only)
app.put('/api/merchants/:id/status', authorizeRole('ADMIN'), async (req, res) => {
  const { status } = req.body; // ACTIVE / INACTIVE
  if (!['ACTIVE', 'INACTIVE'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status value' });
  }
  try {
    const [mRows] = await pool.query('SELECT user_id FROM merchants WHERE merchant_id = ?', [req.params.id]);
    if (!mRows.length) {
      return res.status(404).json({ message: 'Merchant not found' });
    }

    await pool.query('UPDATE users SET status = ? WHERE user_id = ?', [status, mRows[0].user_id]);
    res.json({ message: `Merchant ${status === 'ACTIVE' ? 'activated' : 'deactivated'} successfully` });
  } catch (err) {
    console.error('[Merchant Service] setMerchantStatus error:', err);
    res.status(500).json({ message: 'Failed to update merchant status' });
  }
});

app.listen(PORT, () => {
  console.log(`[Merchant Service] Running on port ${PORT}`);
});
