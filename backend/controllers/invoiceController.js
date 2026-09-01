const pool = require('../config/db');

async function getAllInvoices(req, res) {
  try {
    let query = `SELECT i.*, m.shop_name FROM invoices i JOIN merchants m ON m.merchant_id = i.merchant_id`;
    const params = [];
    if (req.user.role === 'MERCHANT') {
      query += ' WHERE i.merchant_id = (SELECT merchant_id FROM merchants WHERE user_id = ?)';
      params.push(req.user.user_id);
    }
    query += ' ORDER BY i.invoice_date DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch invoices' });
  }
}

async function getInvoiceById(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT i.*, m.shop_name FROM invoices i JOIN merchants m ON m.merchant_id = i.merchant_id WHERE i.invoice_id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Invoice not found' });
    const [sale] = await pool.query('SELECT * FROM sales WHERE invoice_id = ?', [req.params.id]);
    res.json({ ...rows[0], sale: sale[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch invoice' });
  }
}

module.exports = { getAllInvoices, getInvoiceById };
