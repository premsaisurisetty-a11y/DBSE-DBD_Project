const pool = require('../config/db');

// GET /api/inventory  — admin sees all merchants, merchant sees own (?merchant_id enforced by route)
async function getInventory(req, res) {
  try {
    let query = `SELECT i.inventory_id, i.merchant_id, m.shop_name, i.product_id, p.product_name,
                        i.quantity_available, i.last_updated
                 FROM inventory i
                 JOIN merchants m ON m.merchant_id = i.merchant_id
                 JOIN products p ON p.product_id = i.product_id`;
    const params = [];
    if (req.user.role === 'MERCHANT') {
      query += ' WHERE i.merchant_id = (SELECT merchant_id FROM merchants WHERE user_id = ?)';
      params.push(req.user.user_id);
    }
    query += ' ORDER BY i.merchant_id, p.product_name';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch inventory' });
  }
}

async function getLowStock(req, res) {
  const threshold = Number(req.query.threshold) || 20;
  try {
    const [rows] = await pool.query(
      `SELECT m.shop_name, p.product_name, i.quantity_available
       FROM inventory i
       JOIN merchants m ON m.merchant_id = i.merchant_id
       JOIN products p ON p.product_id = i.product_id
       WHERE i.quantity_available < ?
       ORDER BY i.quantity_available ASC`,
      [threshold]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch low stock report' });
  }
}

// POST /api/stock  — record incoming stock and upsert inventory (transaction)
async function addStock(req, res) {
  const { product_id, quantity, cost_per_unit, entry_date } = req.body;
  if (!product_id || !quantity || cost_per_unit == null || !entry_date) {
    return res.status(400).json({ message: 'product_id, quantity, cost_per_unit, entry_date are required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [mRows] = await conn.query('SELECT merchant_id FROM merchants WHERE user_id = ?', [req.user.user_id]);
    if (!mRows.length) throw new Error('Merchant profile not found for this user');
    const merchant_id = (req.user.role === 'ADMIN' || req.user.role === 'OWNER') && req.body.merchant_id ? req.body.merchant_id : mRows[0].merchant_id;

    await conn.query(
      'INSERT INTO stock_entries (merchant_id, product_id, quantity, cost_per_unit, entry_date) VALUES (?,?,?,?,?)',
      [merchant_id, product_id, quantity, cost_per_unit, entry_date]
    );

    await conn.query(
      `INSERT INTO inventory (merchant_id, product_id, quantity_available)
       VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE quantity_available = quantity_available + VALUES(quantity_available)`,
      [merchant_id, product_id, quantity]
    );

    await conn.query(
      'INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value) VALUES (?,?,?,?,?,?)',
      [req.user.user_id, 'INSERT', 'stock_entries', product_id, null, JSON.stringify(req.body)]
    );

    await conn.commit();
    res.status(201).json({ message: 'Stock entry recorded and inventory updated' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: err.message || 'Failed to record stock entry' });
  } finally {
    conn.release();
  }
}

module.exports = { getInventory, getLowStock, addStock };
