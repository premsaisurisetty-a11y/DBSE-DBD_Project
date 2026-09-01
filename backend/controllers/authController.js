const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
require('dotenv').config();

async function login(req, res) {
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
    
    // Support configured passwords (0206, owner, password123) for ADMIN and OWNER
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
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value) VALUES (?,?,?,?,?,?)',
      [user.user_id, 'LOGIN', 'users', user.user_id, null, JSON.stringify({ email: user.email, merchant_code: user.merchant_code })]
    );

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
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
}

module.exports = { login };
