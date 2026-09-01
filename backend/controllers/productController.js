const pool = require('../config/db');

async function getAllProducts(req, res) {
  try {
    const [rows] = await pool.query('SELECT * FROM products ORDER BY product_id');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch products' });
  }
}

async function createProduct(req, res) {
  const { product_name, category, unit, selling_price } = req.body;
  if (!product_name || !category || !unit || selling_price == null) {
    return res.status(400).json({ message: 'All product fields are required' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO products (product_name, category, unit, selling_price) VALUES (?,?,?,?)',
      [product_name, category, unit, selling_price]
    );
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value) VALUES (?,?,?,?,?,?)',
      [req.user.user_id, 'INSERT', 'products', result.insertId, null, JSON.stringify(req.body)]
    );
    res.status(201).json({ message: 'Product created', product_id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create product' });
  }
}

async function updateProduct(req, res) {
  const { product_name, category, unit, selling_price, status } = req.body;
  try {
    const [existing] = await pool.query('SELECT * FROM products WHERE product_id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ message: 'Product not found' });

    await pool.query(
      'UPDATE products SET product_name=?, category=?, unit=?, selling_price=?, status=? WHERE product_id=?',
      [product_name, category, unit, selling_price, status, req.params.id]
    );
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value) VALUES (?,?,?,?,?,?)',
      [req.user.user_id, 'UPDATE', 'products', req.params.id, JSON.stringify(existing[0]), JSON.stringify(req.body)]
    );
    res.json({ message: 'Product updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update product' });
  }
}

async function deleteProduct(req, res) {
  try {
    const [existing] = await pool.query('SELECT * FROM products WHERE product_id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ message: 'Product not found' });

    await pool.query('DELETE FROM products WHERE product_id = ?', [req.params.id]);
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value) VALUES (?,?,?,?,?,?)',
      [req.user.user_id, 'DELETE', 'products', req.params.id, JSON.stringify(existing[0]), null]
    );
    res.json({ message: 'Product deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to delete product' });
  }
}

async function getProductQuality(req, res) {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM product_quality WHERE product_id = ? ORDER BY tested_date DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch quality records' });
  }
}

async function addProductQuality(req, res) {
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
    console.error(err);
    res.status(500).json({ message: 'Failed to add quality record' });
  }
}

module.exports = {
  getAllProducts, createProduct, updateProduct, deleteProduct,
  getProductQuality, addProductQuality
};
