const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config(); // Fallback

const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 4003;
const JWT_SECRET = process.env.JWT_SECRET || 'replace_with_a_long_random_secret';

app.use(cors());
app.use(express.json());

// Service Health Checks
app.get('/health', (req, res) => {
  res.json({ service: 'product-service', port: PORT, status: 'OK' });
});
app.get('/api/products/health', (req, res) => {
  res.json({ service: 'product-service', port: PORT, status: 'OK' });
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

// All /api/products routes require authentication
app.use('/api/products', authenticateToken);

// GET /api/products - Get all products
app.get('/api/products', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM products ORDER BY product_id');
    res.json(rows);
  } catch (err) {
    console.error('[Product Service] getAllProducts error:', err);
    res.status(500).json({ message: 'Failed to fetch products' });
  }
});

// GET /api/products/:id - Get single product by ID
app.get('/api/products/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM products WHERE product_id = ?', [req.params.id]);
    if (!rows.length) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('[Product Service] getProductById error:', err);
    res.status(500).json({ message: 'Failed to fetch product' });
  }
});

// POST /api/products - Create new product (ADMIN/OWNER only)
app.post('/api/products', authorizeRole('ADMIN'), async (req, res) => {
  const { product_name, category, unit, selling_price } = req.body;
  if (!product_name || !category || !unit || selling_price == null) {
    return res.status(400).json({ message: 'All product fields are required' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO products (product_name, category, unit, selling_price) VALUES (?,?,?,?)',
      [product_name, category, unit, selling_price]
    );
    res.status(201).json({ message: 'Product created', product_id: result.insertId });
  } catch (err) {
    console.error('[Product Service] createProduct error:', err);
    res.status(500).json({ message: 'Failed to create product' });
  }
});

// PUT /api/products/:id - Update product (ADMIN/OWNER only)
app.put('/api/products/:id', authorizeRole('ADMIN'), async (req, res) => {
  const { product_name, category, unit, selling_price, status } = req.body;
  try {
    const [existing] = await pool.query('SELECT * FROM products WHERE product_id = ?', [req.params.id]);
    if (!existing.length) {
      return res.status(404).json({ message: 'Product not found' });
    }

    await pool.query(
      'UPDATE products SET product_name=?, category=?, unit=?, selling_price=?, status=? WHERE product_id=?',
      [product_name, category, unit, selling_price, status, req.params.id]
    );
    res.json({ message: 'Product updated' });
  } catch (err) {
    console.error('[Product Service] updateProduct error:', err);
    res.status(500).json({ message: 'Failed to update product' });
  }
});

// DELETE /api/products/:id - Delete product (ADMIN/OWNER only)
app.delete('/api/products/:id', authorizeRole('ADMIN'), async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT * FROM products WHERE product_id = ?', [req.params.id]);
    if (!existing.length) {
      return res.status(404).json({ message: 'Product not found' });
    }

    await pool.query('DELETE FROM products WHERE product_id = ?', [req.params.id]);
    res.json({ message: 'Product deleted' });
  } catch (err) {
    console.error('[Product Service] deleteProduct error:', err);
    res.status(500).json({ message: 'Failed to delete product' });
  }
});

// GET /api/products/:id/quality - Get product quality records
app.get('/api/products/:id/quality', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM product_quality WHERE product_id = ? ORDER BY tested_date DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[Product Service] getProductQuality error:', err);
    res.status(500).json({ message: 'Failed to fetch quality records' });
  }
});

// POST /api/products/:id/quality - Add product quality record (ADMIN/OWNER only)
app.post('/api/products/:id/quality', authorizeRole('ADMIN'), async (req, res) => {
  const { fat_percent, snf_percent, grade, tested_date } = req.body;
  if (!grade || !tested_date) {
    return res.status(400).json({ message: 'grade and tested_date are required' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO product_quality (product_id, fat_percent, snf_percent, grade, tested_date) VALUES (?,?,?,?,?)',
      [req.params.id, fat_percent, snf_percent, grade, tested_date]
    );
    res.status(201).json({ message: 'Quality record added', quality_id: result.insertId });
  } catch (err) {
    console.error('[Product Service] addProductQuality error:', err);
    res.status(500).json({ message: 'Failed to add quality record' });
  }
});

app.listen(PORT, () => {
  console.log(`[Product Service] Running on port ${PORT}`);
});
