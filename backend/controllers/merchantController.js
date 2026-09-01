const pool = require('../config/db');

async function getAllMerchants(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT m.merchant_id, m.merchant_code, m.shop_name, m.shift, m.phone, m.address, u.name as merchant_name, u.email, u.status
       FROM merchants m JOIN users u ON u.user_id = m.user_id
       ORDER BY m.merchant_id`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch merchants' });
  }
}

async function getMerchantById(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT m.merchant_id, m.merchant_code, m.shop_name, m.shift, m.phone, m.address, u.name as merchant_name, u.email, u.status
       FROM merchants m JOIN users u ON u.user_id = m.user_id
       WHERE m.merchant_id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Merchant not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch merchant' });
  }
}

async function setMerchantStatus(req, res) {
  const { status } = req.body; // ACTIVE / INACTIVE
  if (!['ACTIVE', 'INACTIVE'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status value' });
  }
  try {
    const [mRows] = await pool.query('SELECT user_id FROM merchants WHERE merchant_id = ?', [req.params.id]);
    if (!mRows.length) return res.status(404).json({ message: 'Merchant not found' });

    await pool.query('UPDATE users SET status = ? WHERE user_id = ?', [status, mRows[0].user_id]);
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, table_name, record_id, old_value, new_value) VALUES (?,?,?,?,?,?)',
      [req.user.user_id, 'UPDATE', 'users', mRows[0].user_id, null, JSON.stringify({ status })]
    );
    res.json({ message: `Merchant ${status === 'ACTIVE' ? 'activated' : 'deactivated'} successfully` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update merchant status' });
  }
}

module.exports = { getAllMerchants, getMerchantById, setMerchantStatus };
