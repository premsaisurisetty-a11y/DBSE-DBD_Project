const pool = require('../config/db');

async function getAllPayments(req, res) {
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
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch payments' });
  }
}

// Manual payment record (e.g. retry / offline reconciliation)
async function createPayment(req, res) {
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
    console.error(err);
    res.status(500).json({ message: 'Failed to record payment' });
  }
}

module.exports = { getAllPayments, createPayment };
