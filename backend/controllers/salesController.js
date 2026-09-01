const pool = require('../config/db');

async function getAllSales(req, res) {
  try {
    let query = `SELECT s.sale_id, s.merchant_id, m.shop_name, s.sale_date, s.subtotal, s.tax,
                        s.discount, s.total_amount, s.sale_status, s.invoice_id
                 FROM sales s JOIN merchants m ON m.merchant_id = s.merchant_id`;
    const params = [];
    if (req.user.role === 'MERCHANT') {
      query += ' WHERE s.merchant_id = (SELECT merchant_id FROM merchants WHERE user_id = ?)';
      params.push(req.user.user_id);
    }
    query += ' ORDER BY s.sale_date DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch sales' });
  }
}

async function getSaleById(req, res) {
  try {
    const [sale] = await pool.query('SELECT * FROM sales WHERE sale_id = ?', [req.params.id]);
    if (!sale.length) return res.status(404).json({ message: 'Sale not found' });
    const [items] = await pool.query(
      `SELECT si.*, p.product_name FROM sale_items si
       JOIN products p ON p.product_id = si.product_id WHERE si.sale_id = ?`,
      [req.params.id]
    );
    const [payment] = await pool.query('SELECT * FROM payments WHERE sale_id = ?', [req.params.id]);
    res.json({ ...sale[0], items, payment: payment[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch sale' });
  }
}

// POST /api/sales
// body: { items: [{product_id, quantity, unit_price}], tax, discount, payment_method, transaction_ref }
// Demonstrates: multi-table ACID transaction with rollback on any failure.
async function createSale(req, res) {
  const { items, tax = 0, discount = 0, payment_method, transaction_ref } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'At least one sale item is required' });
  }
  if (!payment_method) {
    return res.status(400).json({ message: 'payment_method is required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Resolve merchant
    const [mRows] = await conn.query('SELECT merchant_id FROM merchants WHERE user_id = ?', [req.user.user_id]);
    if (!mRows.length) throw { status: 400, message: 'Merchant profile not found' };
    const merchant_id = mRows[0].merchant_id;

    // 2. Validate products + check inventory
    let subtotal = 0;
    for (const item of items) {
      const [prod] = await conn.query('SELECT * FROM products WHERE product_id = ?', [item.product_id]);
      if (!prod.length) throw { status: 400, message: `Product ${item.product_id} not found` };

      const [inv] = await conn.query(
        'SELECT quantity_available FROM inventory WHERE merchant_id = ? AND product_id = ? FOR UPDATE',
        [merchant_id, item.product_id]
      );
      const available = inv.length ? Number(inv[0].quantity_available) : 0;
      if (available < item.quantity) {
        throw { status: 400, message: `Insufficient inventory for ${prod[0].product_name} (available ${available}, requested ${item.quantity})` };
      }
      subtotal += Number(item.quantity) * Number(item.unit_price);
    }

    const total_amount = subtotal + Number(tax) - Number(discount);

    // 3. Create invoice
    const invoice_number = `INV-${Date.now()}`;
    const [invResult] = await conn.query(
      'INSERT INTO invoices (merchant_id, invoice_number, invoice_date, total_amount) VALUES (?,?,CURDATE(),?)',
      [merchant_id, invoice_number, total_amount]
    );
    const invoice_id = invResult.insertId;

    // 4. Create sales record
    const [saleResult] = await conn.query(
      'INSERT INTO sales (merchant_id, invoice_id, subtotal, tax, discount, total_amount, sale_status) VALUES (?,?,?,?,?,?,?)',
      [merchant_id, invoice_id, subtotal, tax, discount, total_amount, 'COMPLETED']
    );
    const sale_id = saleResult.insertId;

    // 5. Create sale_items + 6. reduce inventory
    for (const item of items) {
      await conn.query(
        'INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?,?,?,?)',
        [sale_id, item.product_id, item.quantity, item.unit_price]
      );
      await conn.query(
        'UPDATE inventory SET quantity_available = quantity_available - ? WHERE merchant_id = ? AND product_id = ?',
        [item.quantity, merchant_id, item.product_id]
      );
    }

    // 7. Create payment record
    await conn.query(
      'INSERT INTO payments (sale_id, payment_method, amount, transaction_ref, payment_status) VALUES (?,?,?,?,?)',
      [sale_id, payment_method, total_amount, transaction_ref || null, 'SUCCESS']
    );

    // 9. Audit log
    await conn.query(
      'INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value) VALUES (?,?,?,?,?,?)',
      [req.user.user_id, 'INSERT', 'sales', sale_id, null, JSON.stringify({ total_amount, items })]
    );

    // 10. COMMIT
    await conn.commit();
    res.status(201).json({ message: 'Sale recorded successfully', sale_id, invoice_id, invoice_number, total_amount });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(err.status || 500).json({ message: err.message || 'Failed to record sale — transaction rolled back' });
  } finally {
    conn.release();
  }
}

module.exports = { getAllSales, getSaleById, createSale };
