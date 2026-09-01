const pool = require('../config/db');

// Payment discrepancy: SUM(sales.total_amount) vs SUM(successful payments.amount), per merchant
async function getPaymentDiscrepancies(req, res) {
  try {
    const [rows] = await pool.query(`
      SELECT m.shop_name, d.merchant_id, d.total_sales, d.total_successful_payments, d.discrepancy
      FROM vw_payment_discrepancy d
      JOIN merchants m ON m.merchant_id = d.merchant_id
      WHERE d.discrepancy <> 0
      ORDER BY ABS(d.discrepancy) DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to compute payment discrepancies' });
  }
}

// Stock discrepancy: expected stock (incoming - sold) vs actual inventory
async function getStockDiscrepancies(req, res) {
  try {
    const [rows] = await pool.query(`
      SELECT m.shop_name, d.*
      FROM vw_stock_discrepancy d
      JOIN merchants m ON m.merchant_id = d.merchant_id
      WHERE d.discrepancy <> 0
      ORDER BY ABS(d.discrepancy) DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to compute stock discrepancies' });
  }
}

// Admin dashboard summary cards
async function getAdminSummary(req, res) {
  try {
    const [[merchantCount]] = await pool.query('SELECT COUNT(*) AS total FROM merchants');
    const [[salesTotal]] = await pool.query("SELECT COALESCE(SUM(total_amount),0) AS total FROM sales WHERE sale_status='COMPLETED'");
    const [[revenueTotal]] = await pool.query("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE payment_status='SUCCESS'");
    const [[paymentDiscCount]] = await pool.query('SELECT COUNT(*) AS total FROM vw_payment_discrepancy WHERE discrepancy <> 0');
    const [[stockDiscCount]] = await pool.query('SELECT COUNT(*) AS total FROM vw_stock_discrepancy WHERE discrepancy <> 0');

    res.json({
      total_merchants: merchantCount.total,
      total_sales: salesTotal.total,
      total_revenue: revenueTotal.total,
      payment_discrepancies: paymentDiscCount.total,
      stock_discrepancies: stockDiscCount.total
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to build admin summary' });
  }
}

// Merchant dashboard summary
async function getMerchantSummary(req, res) {
  try {
    const [mRows] = await pool.query('SELECT merchant_id FROM merchants WHERE user_id = ?', [req.user.user_id]);
    if (!mRows.length) return res.status(404).json({ message: 'Merchant profile not found' });
    const merchant_id = mRows[0].merchant_id;

    const [[todaySales]] = await pool.query(
      "SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*) AS cnt FROM sales WHERE merchant_id=? AND DATE(sale_date)=CURDATE() AND sale_status='COMPLETED'",
      [merchant_id]
    );
    const [[pendingPayments]] = await pool.query(
      `SELECT COALESCE(SUM(pay.amount),0) AS total FROM payments pay
       JOIN sales s ON s.sale_id = pay.sale_id
       WHERE s.merchant_id=? AND pay.payment_status='PENDING'`,
      [merchant_id]
    );
    const [recentSales] = await pool.query(
      'SELECT sale_id, sale_date, total_amount, sale_status FROM sales WHERE merchant_id=? ORDER BY sale_date DESC LIMIT 5',
      [merchant_id]
    );
    const [inventoryRows] = await pool.query(
      `SELECT p.product_name, i.quantity_available FROM inventory i
       JOIN products p ON p.product_id = i.product_id WHERE i.merchant_id=?`,
      [merchant_id]
    );

    res.json({
      todays_sales: todaySales.total,
      todays_sale_count: todaySales.cnt,
      pending_payments: pendingPayments.total,
      recent_sales: recentSales,
      inventory: inventoryRows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to build merchant summary' });
  }
}

module.exports = { getPaymentDiscrepancies, getStockDiscrepancies, getAdminSummary, getMerchantSummary };
