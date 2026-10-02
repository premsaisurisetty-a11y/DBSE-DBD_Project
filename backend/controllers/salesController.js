const pool = require('../config/db');
const { verifyCashfreePaymentServerSide } = require('./cashfreeController');

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
    let query = 'SELECT * FROM sales WHERE sale_id = ?';
    const params = [req.params.id];
    if (req.user.role === 'MERCHANT') {
      query += ' AND merchant_id = (SELECT merchant_id FROM merchants WHERE user_id = ?)';
      params.push(req.user.user_id);
    }
    const [sale] = await pool.query(query, params);
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
// Secure sale recording with server-side pricing, discount validation, and Cashfree verification
async function createSale(req, res) {
  const { items, tax = 0, discount = 0, payment_method, order_id, cashfree_order_id } = req.body;

  // 1. Basic structure validations
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'At least one sale item is required' });
  }
  if (!payment_method || !['CASH', 'UPI', 'CARD', 'ONLINE'].includes(payment_method)) {
    return res.status(400).json({ message: 'Valid payment_method is required (CASH or UPI)' });
  }

  // 2. Strict tax & discount validation
  const numTax = Number(tax);
  const numDiscount = Number(discount);
  if (isNaN(numTax) || numTax < 0) {
    return res.status(400).json({ message: 'Tax must be a valid non-negative number' });
  }
  if (isNaN(numDiscount) || numDiscount < 0) {
    return res.status(400).json({ message: 'Discount must be a valid non-negative number' });
  }

  const conn = await pool.getConnection();
  try {
    // 3. Resolve merchant strictly from authenticated user JWT
    const [mRows] = await conn.query('SELECT merchant_id FROM merchants WHERE user_id = ?', [req.user.user_id]);
    if (!mRows.length) {
      return res.status(400).json({ message: 'Merchant profile not found' });
    }
    const merchant_id = mRows[0].merchant_id;

    // 4. Validate products & compute subtotal entirely from database selling_price
    let subtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const productId = Number(item.product_id);
      const quantity = Number(item.quantity);

      if (!productId || isNaN(productId) || isNaN(quantity) || quantity <= 0) {
        return res.status(400).json({ message: 'Each item must have a valid product_id and positive quantity' });
      }

      // Fetch authentic product details directly from database (ignoring any client item.unit_price)
      const [prodRows] = await conn.query(
        'SELECT product_id, product_name, selling_price, status FROM products WHERE product_id = ?',
        [productId]
      );
      if (!prodRows.length || prodRows[0].status !== 'ACTIVE') {
        return res.status(400).json({ message: `Product ${productId} not found or is discontinued` });
      }

      const dbUnitPrice = Number(prodRows[0].selling_price);
      subtotal += quantity * dbUnitPrice;

      validatedItems.push({
        product_id: productId,
        product_name: prodRows[0].product_name,
        quantity: quantity,
        unit_price: dbUnitPrice
      });
    }

    // 5. Enforce discount bounds against subtotal
    if (numDiscount > subtotal) {
      return res.status(400).json({
        message: `Discount (₹${numDiscount.toFixed(2)}) cannot exceed subtotal (₹${subtotal.toFixed(2)})`
      });
    }

    // Final total calculation (server-side only)
    const total_amount = Number((subtotal + numTax - numDiscount).toFixed(2));
    if (total_amount <= 0) {
      return res.status(400).json({ message: 'Total bill amount must be greater than ₹0.00' });
    }

    // 6. Payment method verification & Double-payment check
    let finalPaymentStatus = 'PENDING';
    let finalTxnRef = null;

    if (payment_method === 'UPI') {
      const activeOrderId = (order_id || cashfree_order_id || '').trim();
      if (!activeOrderId) {
        return res.status(400).json({ message: 'Cashfree order_id is required for UPI payments' });
      }

      // Prevent duplicate order processing / replay attack
      const [existingTxn] = await conn.query(
        'SELECT payment_id, sale_id FROM payments WHERE transaction_ref = ? OR transaction_ref LIKE ?',
        [`CF-UPI-${activeOrderId.slice(-8)}`, `%${activeOrderId}%`]
      );
      if (existingTxn.length > 0) {
        return res.status(409).json({
          message: `This Cashfree order (${activeOrderId}) has already been processed for Sale #${existingTxn[0].sale_id}`
        });
      }

      // Verify Cashfree order server-side
      const cfVerification = await verifyCashfreePaymentServerSide(activeOrderId);
      if (!cfVerification.success || cfVerification.payment_status !== 'SUCCESS') {
        return res.status(400).json({
          message: `Cashfree payment verification failed: ${cfVerification.message || 'Payment not confirmed'}`
        });
      }

      // Verify amount matches backend-calculated total
      if (Math.abs(Number(cfVerification.order_amount) - total_amount) > 0.05) {
        return res.status(400).json({
          message: `Payment amount mismatch: Cashfree order is ₹${cfVerification.order_amount.toFixed(2)}, but calculated total is ₹${total_amount.toFixed(2)}`
        });
      }

      finalPaymentStatus = 'SUCCESS';
      finalTxnRef = cfVerification.transaction_ref || `CF-UPI-${activeOrderId.slice(-8)}`;
    } else if (payment_method === 'CASH') {
      // Cash payment recorded at POS terminal by authenticated merchant operator
      finalPaymentStatus = 'SUCCESS';
      finalTxnRef = `CASH-${Date.now()}`;
    }

    // 7. Atomic ACID Transaction execution
    await conn.beginTransaction();

    // Lock and check inventory
    for (const item of validatedItems) {
      const [inv] = await conn.query(
        'SELECT quantity_available FROM inventory WHERE merchant_id = ? AND product_id = ? FOR UPDATE',
        [merchant_id, item.product_id]
      );
      const available = inv.length ? Number(inv[0].quantity_available) : 0;
      if (available < item.quantity) {
        throw {
          status: 400,
          message: `Insufficient inventory for ${item.product_name} (available: ${available}, requested: ${item.quantity})`
        };
      }
    }

    // A. Create invoice record
    const invoice_number = `INV-${Date.now()}`;
    const [invResult] = await conn.query(
      'INSERT INTO invoices (merchant_id, invoice_number, invoice_date, total_amount) VALUES (?,?,CURDATE(),?)',
      [merchant_id, invoice_number, total_amount]
    );
    const invoice_id = invResult.insertId;

    // B. Create sales record
    const [saleResult] = await conn.query(
      'INSERT INTO sales (merchant_id, invoice_id, subtotal, tax, discount, total_amount, sale_status) VALUES (?,?,?,?,?,?,?)',
      [merchant_id, invoice_id, subtotal, numTax, numDiscount, total_amount, 'COMPLETED']
    );
    const sale_id = saleResult.insertId;

    // C. Create sale_items and update inventory
    for (const item of validatedItems) {
      await conn.query(
        'INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?,?,?,?)',
        [sale_id, item.product_id, item.quantity, item.unit_price]
      );
      await conn.query(
        'UPDATE inventory SET quantity_available = quantity_available - ? WHERE merchant_id = ? AND product_id = ?',
        [item.quantity, merchant_id, item.product_id]
      );
    }

    // D. Create payment record
    await conn.query(
      'INSERT INTO payments (sale_id, payment_method, amount, transaction_ref, payment_status) VALUES (?,?,?,?,?)',
      [sale_id, payment_method, total_amount, finalTxnRef, finalPaymentStatus]
    );

    // Commit transaction
    await conn.commit();
    res.status(201).json({
      message: 'Sale recorded successfully',
      sale_id,
      invoice_id,
      invoice_number,
      total_amount,
      payment_status: finalPaymentStatus,
      transaction_ref: finalTxnRef
    });
  } catch (err) {
    await conn.rollback();
    console.error('Sale execution error:', err);
    res.status(err.status || 500).json({ message: err.message || 'Failed to record sale — transaction rolled back' });
  } finally {
    conn.release();
  }
}

module.exports = { getAllSales, getSaleById, createSale };
