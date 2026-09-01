const pool = require('../config/db');

async function getAuditLogs(req, res) {
  try {
    let query = `SELECT a.*, u.name AS user_name, u.role FROM audit_logs a
                 LEFT JOIN users u ON u.user_id = a.user_id`;
    const params = [];
    if (req.user.role === 'MERCHANT') {
      query += ' WHERE a.user_id = ?';
      params.push(req.user.user_id);
    }
    query += ' ORDER BY a.action_time DESC LIMIT 200';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch audit logs' });
  }
}

module.exports = { getAuditLogs };
