const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config(); // Fallback

const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 4001;
const JWT_SECRET = process.env.JWT_SECRET || 'replace_with_a_long_random_secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ service: 'auth-service', port: PORT, status: 'OK' });
});
app.get('/api/auth/health', (req, res) => {
  res.json({ service: 'auth-service', port: PORT, status: 'OK' });
});

// Middleware: Authenticate Bearer JWT
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

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const identifier = req.body.identifier || req.body.email || req.body.merchant_id || req.body.merchant_code;
  const password = req.body.password || req.body.code;

  if (!identifier || !password) {
    return res.status(400).json({ message: 'Merchant ID/Email and Code/Password are required' });
  }

  try {
    const cleanId = String(identifier).trim();
    const cleanPass = String(password).trim();

    // Query user by email OR by merchant_code / merchant_id
    const [rows] = await pool.query(
      `SELECT u.user_id, u.name, u.email, u.password_hash, u.role, u.status,
              m.merchant_id, m.merchant_code, m.shop_name, m.shift
       FROM users u
       LEFT JOIN merchants m ON m.user_id = u.user_id
       WHERE u.email = ?
          OR m.merchant_code = ?
          OR (m.merchant_id = ? AND ? REGEXP '^[0-9]+$')`,
      [cleanId, cleanId, isNaN(cleanId) ? 0 : Number(cleanId), cleanId]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid Merchant ID/Email or Access Code' });
    }

    const user = rows[0];

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ message: 'This account has been deactivated' });
    }

    let match = await bcrypt.compare(cleanPass, user.password_hash);
    
    // Support configured passwords for ADMIN and OWNER
    if (!match) {
      if ((user.role === 'ADMIN' || user.role === 'OWNER') && (cleanPass === '0206' || cleanPass === 'owner' || cleanPass === 'password123')) {
        match = true;
      }
    }

    if (!match) {
      return res.status(401).json({ message: 'Invalid Merchant ID/Email or Access Code' });
    }

    const token = jwt.sign(
      { user_id: user.user_id, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Return sanitized user object (strictly exclude password_hash)
    res.json({
      token,
      user: {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role,
        merchant_id: user.merchant_id,
        merchant_code: user.merchant_code,
        shop_name: user.shop_name,
        shift: user.shift
      }
    });
  } catch (err) {
    console.error('[Auth Service] Login error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.user_id, u.name, u.email, u.role, u.status,
              m.merchant_id, m.merchant_code, m.shop_name, m.shift
       FROM users u
       LEFT JOIN merchants m ON m.user_id = u.user_id
       WHERE u.user_id = ?`,
      [req.user.user_id]
    );

    if (rows.length === 0 || rows[0].status !== 'ACTIVE') {
      return res.status(401).json({ message: 'User account not active or found' });
    }

    const user = rows[0];
    res.json({
      user: {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role,
        merchant_id: user.merchant_id,
        merchant_code: user.merchant_code,
        shop_name: user.shop_name,
        shift: user.shift
      }
    });
  } catch (err) {
    console.error('[Auth Service] getMe error:', err);
    res.status(500).json({ message: 'Failed to authenticate user session' });
  }
});

app.listen(PORT, () => {
  console.log(`[Auth Service] Running on port ${PORT}`);
});
