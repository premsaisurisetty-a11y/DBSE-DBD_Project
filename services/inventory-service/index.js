const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config(); // Fallback

const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 4004;
const JWT_SECRET = process.env.JWT_SECRET || 'replace_with_a_long_random_secret';

app.use(cors());
app.use(express.json());

// Service Health Checks
app.get('/health', (req, res) => {
  res.json({ service: 'inventory-service', port: PORT, status: 'OK' });
});
app.get('/api/inventory/health', (req, res) => {
  res.json({ service: 'inventory-service', port: PORT, status: 'OK' });
});

// Active Auto-Expiry Sweeper Function
async function expireStaleReservations() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [staleRows] = await conn.query(
      'SELECT * FROM inventory_reservations WHERE status = "RESERVED" AND expires_at <= NOW() FOR UPDATE'
    );

    if (staleRows.length > 0) {
      for (const row of staleRows) {
        // Restore stock
        await conn.query(
          'UPDATE inventory SET quantity_available = quantity_available + ? WHERE merchant_id = ? AND product_id = ?',
          [row.quantity_reserved, row.merchant_id, row.product_id]
        );

        await conn.query(
          'UPDATE inventory_reservations SET status = "EXPIRED" WHERE reservation_id = ?',
          [row.reservation_id]
        );
      }

      const expiredGroupIds = [...new Set(staleRows.map(r => r.reservation_group_id))];
      for (const gid of expiredGroupIds) {
        await conn.query(
          'UPDATE saga_instances SET saga_status = "FAILED", current_step = "EXPIRED" WHERE reservation_group_id = ?',
          [gid]
        );
      }
    }

    await conn.commit();
    return staleRows.length;
  } catch (err) {
    await conn.rollback();
    console.error('[Inventory Service] Expiration Sweep Error:', err);
    return 0;
  } finally {
    conn.release();
  }
}

// Public / Internal endpoint for manual trigger / test suite
app.post('/api/inventory/reservations-sweep', async (req, res) => {
  const count = await expireStaleReservations();
  res.json({ success: true, expired_count: count });
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

// Helper to resolve merchant_id strictly
async function resolveMerchantId(conn, req) {
  if (req.user.role === 'ADMIN' || req.user.role === 'OWNER') {
    if (req.body.merchant_id || req.query.merchant_id) {
      const id = Number(req.body.merchant_id || req.query.merchant_id);
      if (!isNaN(id) && id > 0) return id;
    }
    return 1; // Default admin context
  }
  const [mRows] = await conn.query('SELECT merchant_id FROM merchants WHERE user_id = ?', [req.user.user_id]);
  if (!mRows.length) throw { status: 400, message: 'Merchant profile not found for authenticated user' };
  return mRows[0].merchant_id;
}

// All /api/inventory routes below require authentication
app.use('/api/inventory', authenticateToken);

// ==========================================
// 1. EXISTING INVENTORY ENDPOINTS
// ==========================================

// GET /api/inventory - Admin/Owner sees all merchants, merchant sees own
app.get('/api/inventory', async (req, res) => {
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
    console.error('[Inventory Service] getInventory error:', err);
    res.status(500).json({ message: 'Failed to fetch inventory' });
  }
});

// GET /api/inventory/low-stock - Low stock alert report
app.get('/api/inventory/low-stock', async (req, res) => {
  const threshold = Number(req.query.threshold) || 20;
  try {
    let query = `SELECT m.shop_name, p.product_name, i.quantity_available
                 FROM inventory i
                 JOIN merchants m ON m.merchant_id = i.merchant_id
                 JOIN products p ON p.product_id = i.product_id
                 WHERE i.quantity_available < ?`;
    const params = [threshold];
    if (req.user.role === 'MERCHANT') {
      query += ' AND i.merchant_id = (SELECT merchant_id FROM merchants WHERE user_id = ?)';
      params.push(req.user.user_id);
    }
    query += ' ORDER BY i.quantity_available ASC';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('[Inventory Service] getLowStock error:', err);
    res.status(500).json({ message: 'Failed to fetch low stock report' });
  }
});

// POST /api/inventory/stock - Record incoming stock and upsert inventory (ACID transaction)
app.post('/api/inventory/stock', async (req, res) => {
  const { product_id, quantity, cost_per_unit, entry_date } = req.body;
  
  if (!product_id || quantity === undefined || cost_per_unit === undefined || !entry_date) {
    return res.status(400).json({ message: 'product_id, quantity, cost_per_unit, entry_date are required' });
  }

  const numQty = Number(quantity);
  const numCost = Number(cost_per_unit);
  const numProductId = Number(product_id);

  if (isNaN(numProductId) || numProductId <= 0) {
    return res.status(400).json({ message: 'Valid product_id is required' });
  }
  if (isNaN(numQty) || numQty <= 0) {
    return res.status(400).json({ message: 'Quantity must be a positive number' });
  }
  if (isNaN(numCost) || numCost < 0) {
    return res.status(400).json({ message: 'Cost per unit must be non-negative' });
  }

  const conn = await pool.getConnection();
  try {
    const [prodRows] = await conn.query('SELECT product_id FROM products WHERE product_id = ?', [numProductId]);
    if (!prodRows.length) {
      return res.status(400).json({ message: 'Product not found' });
    }

    let merchant_id;
    if (req.user.role === 'ADMIN' || req.user.role === 'OWNER') {
      if (!req.body.merchant_id) {
        return res.status(400).json({ message: 'merchant_id is required for Admin stock entry' });
      }
      const numMerchId = Number(req.body.merchant_id);
      if (isNaN(numMerchId) || numMerchId <= 0) {
        return res.status(400).json({ message: 'Valid merchant_id is required' });
      }
      const [merchCheck] = await conn.query('SELECT merchant_id FROM merchants WHERE merchant_id = ?', [numMerchId]);
      if (!merchCheck.length) {
        return res.status(400).json({ message: 'Merchant not found' });
      }
      merchant_id = numMerchId;
    } else {
      const [mRows] = await conn.query('SELECT merchant_id FROM merchants WHERE user_id = ?', [req.user.user_id]);
      if (!mRows.length) {
        return res.status(400).json({ message: 'Merchant profile not found for this user' });
      }
      merchant_id = mRows[0].merchant_id;
    }

    await conn.beginTransaction();

    await conn.query(
      'INSERT INTO stock_entries (merchant_id, product_id, quantity, cost_per_unit, entry_date) VALUES (?,?,?,?,?)',
      [merchant_id, numProductId, numQty, numCost, entry_date]
    );

    await conn.query(
      `INSERT INTO inventory (merchant_id, product_id, quantity_available)
       VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE quantity_available = quantity_available + VALUES(quantity_available)`,
      [merchant_id, numProductId, numQty]
    );

    await conn.commit();
    res.status(201).json({ message: 'Stock entry recorded and inventory updated' });
  } catch (err) {
    await conn.rollback();
    console.error('[Inventory Service] addStock error:', err);
    res.status(500).json({ message: err.message || 'Failed to record stock entry' });
  } finally {
    conn.release();
  }
});

// ==========================================
// 2. INVENTORY RESERVATION ENDPOINTS (STEP 8)
// ==========================================

// POST /api/inventory/reservations - Atomic Multi-Item Stock Reservation
app.post('/api/inventory/reservations', async (req, res) => {
  const { items, ttl_seconds = 300 } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'items array must contain at least one product reservation' });
  }

  const validatedItems = [];
  for (const item of items) {
    const pid = Number(item.product_id);
    const qty = Number(item.quantity);

    if (!pid || isNaN(pid) || pid <= 0) {
      return res.status(400).json({ message: 'Valid product_id is required for all items' });
    }
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ message: 'Quantity must be a positive number greater than 0' });
    }
    validatedItems.push({ product_id: pid, quantity: qty });
  }

  const conn = await pool.getConnection();
  try {
    const merchant_id = await resolveMerchantId(conn, req);
    const reservation_group_id = `res_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const expires_at = new Date(Date.now() + ttl_seconds * 1000);

    await conn.beginTransaction();

    const reservedRecords = [];

    // Atomic check & reserve with row locking
    for (const item of validatedItems) {
      const [invRows] = await conn.query(
        'SELECT quantity_available FROM inventory WHERE merchant_id = ? AND product_id = ? FOR UPDATE',
        [merchant_id, item.product_id]
      );

      const available = invRows.length ? Number(invRows[0].quantity_available) : 0;
      if (available < item.quantity) {
        throw {
          status: 400,
          message: `Insufficient inventory for product_id ${item.product_id} (Available: ${available}, Requested: ${item.quantity})`
        };
      }

      // Deduct immediately to prevent overselling
      await conn.query(
        'UPDATE inventory SET quantity_available = quantity_available - ? WHERE merchant_id = ? AND product_id = ?',
        [item.quantity, merchant_id, item.product_id]
      );

      const [insertRes] = await conn.query(
        `INSERT INTO inventory_reservations (reservation_group_id, merchant_id, product_id, quantity_reserved, status, expires_at)
         VALUES (?, ?, ?, ?, 'RESERVED', ?)`,
        [reservation_group_id, merchant_id, item.product_id, item.quantity, expires_at]
      );

      reservedRecords.push({
        reservation_id: insertRes.insertId,
        product_id: item.product_id,
        quantity_reserved: item.quantity
      });
    }

    // Record Saga Instance for orchestrator recovery
    await conn.query(
      `INSERT INTO saga_instances (saga_id, reservation_group_id, merchant_id, current_step, saga_status, payload)
       VALUES (?, ?, ?, 'RESERVED', 'RESERVED', ?)`,
      [
        `saga_${reservation_group_id}`,
        reservation_group_id,
        merchant_id,
        JSON.stringify({ items: validatedItems, expires_at })
      ]
    );

    await conn.commit();

    res.status(201).json({
      success: true,
      reservation_group_id,
      merchant_id,
      status: 'RESERVED',
      expires_at: expires_at.toISOString(),
      items: reservedRecords
    });
  } catch (err) {
    await conn.rollback();
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error('[Inventory Service] Reservation Error:', err);
    res.status(500).json({ message: err.message || 'Failed to create inventory reservation' });
  } finally {
    conn.release();
  }
});

// GET /api/inventory/reservations/:groupId - View Reservation Status
app.get('/api/inventory/reservations/:groupId', async (req, res) => {
  const { groupId } = req.params;
  const conn = await pool.getConnection();
  try {
    const merchant_id = await resolveMerchantId(conn, req);
    let query = 'SELECT * FROM inventory_reservations WHERE reservation_group_id = ?';
    const params = [groupId];

    if (req.user.role === 'MERCHANT') {
      query += ' AND merchant_id = ?';
      params.push(merchant_id);
    }

    const [rows] = await conn.query(query, params);
    if (!rows.length) {
      return res.status(404).json({ message: 'Reservation not found or access denied' });
    }

    res.json({
      reservation_group_id: groupId,
      merchant_id: rows[0].merchant_id,
      status: rows[0].status,
      expires_at: rows[0].expires_at,
      items: rows.map(r => ({
        reservation_id: r.reservation_id,
        product_id: r.product_id,
        quantity_reserved: r.quantity_reserved,
        status: r.status,
        sale_id: r.sale_id
      }))
    });
  } catch (err) {
    console.error('[Inventory Service] getReservation error:', err);
    res.status(err.status || 500).json({ message: err.message || 'Failed to fetch reservation' });
  } finally {
    conn.release();
  }
});

// POST /api/inventory/reservations/:groupId/commit - Idempotent Commit
app.post('/api/inventory/reservations/:groupId/commit', async (req, res) => {
  const { groupId } = req.params;
  const { sale_id } = req.body;

  const conn = await pool.getConnection();
  try {
    const merchant_id = await resolveMerchantId(conn, req);

    await conn.beginTransaction();

    let query = 'SELECT * FROM inventory_reservations WHERE reservation_group_id = ?';
    const params = [groupId];
    if (req.user.role === 'MERCHANT') {
      query += ' AND merchant_id = ?';
      params.push(merchant_id);
    }
    query += ' FOR UPDATE';

    const [rows] = await conn.query(query, params);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ message: 'Reservation group not found or access denied' });
    }

    // Idempotency: If already COMMITTED, return success immediately without double-deduction
    const allCommitted = rows.every(r => r.status === 'COMMITTED');
    if (allCommitted) {
      await conn.commit();
      return res.json({
        success: true,
        reservation_group_id: groupId,
        status: 'COMMITTED',
        sale_id: rows[0].sale_id || sale_id || null,
        message: 'Reservation already committed (idempotent response)'
      });
    }

    // Cannot commit released or expired reservations
    const anyInvalid = rows.some(r => r.status === 'RELEASED' || r.status === 'EXPIRED');
    if (anyInvalid) {
      await conn.rollback();
      return res.status(400).json({
        message: `Cannot commit reservation: group status is ${rows[0].status}`
      });
    }

    // Verify sale_id validity if provided
    let validSaleId = null;
    if (sale_id) {
      const [sRows] = await conn.query('SELECT sale_id FROM sales WHERE sale_id = ?', [sale_id]);
      if (sRows.length) validSaleId = sRows[0].sale_id;
    }

    // Transition status to COMMITTED
    await conn.query(
      'UPDATE inventory_reservations SET status = "COMMITTED", sale_id = ? WHERE reservation_group_id = ?',
      [validSaleId, groupId]
    );

    await conn.query(
      'UPDATE saga_instances SET saga_status = "COMPLETED", current_step = "COMMITTED" WHERE reservation_group_id = ?',
      [groupId]
    );

    await conn.commit();

    res.json({
      success: true,
      reservation_group_id: groupId,
      status: 'COMMITTED',
      sale_id: validSaleId,
      message: 'Reservation committed successfully'
    });
  } catch (err) {
    await conn.rollback();
    console.error('[Inventory Service] Commit Error:', err);
    res.status(err.status || 500).json({ message: err.message || 'Failed to commit reservation' });
  } finally {
    conn.release();
  }
});

// POST /api/inventory/reservations/:groupId/release - Idempotent Release & Stock Restoration
app.post('/api/inventory/reservations/:groupId/release', async (req, res) => {
  const { groupId } = req.params;

  const conn = await pool.getConnection();
  try {
    const merchant_id = await resolveMerchantId(conn, req);

    await conn.beginTransaction();

    let query = 'SELECT * FROM inventory_reservations WHERE reservation_group_id = ?';
    const params = [groupId];
    if (req.user.role === 'MERCHANT') {
      query += ' AND merchant_id = ?';
      params.push(merchant_id);
    }
    query += ' FOR UPDATE';

    const [rows] = await conn.query(query, params);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ message: 'Reservation group not found or access denied' });
    }

    // Idempotency: If already RELEASED or EXPIRED, return success without double restoration
    const allReleased = rows.every(r => r.status === 'RELEASED' || r.status === 'EXPIRED');
    if (allReleased) {
      await conn.commit();
      return res.json({
        success: true,
        reservation_group_id: groupId,
        status: rows[0].status,
        message: 'Reservation already released (idempotent response)'
      });
    }

    // Cannot release already COMMITTED reservations
    const anyCommitted = rows.some(r => r.status === 'COMMITTED');
    if (anyCommitted) {
      await conn.rollback();
      return res.status(400).json({
        message: 'Cannot release an already committed reservation'
      });
    }

    // Restore stock and transition to RELEASED
    for (const row of rows) {
      if (row.status === 'RESERVED') {
        await conn.query(
          'UPDATE inventory SET quantity_available = quantity_available + ? WHERE merchant_id = ? AND product_id = ?',
          [row.quantity_reserved, row.merchant_id, row.product_id]
        );
      }
    }

    await conn.query(
      'UPDATE inventory_reservations SET status = "RELEASED" WHERE reservation_group_id = ?',
      [groupId]
    );

    await conn.query(
      'UPDATE saga_instances SET saga_status = "COMPENSATED", current_step = "RELEASED" WHERE reservation_group_id = ?',
      [groupId]
    );

    await conn.commit();

    res.json({
      success: true,
      reservation_group_id: groupId,
      status: 'RELEASED',
      message: 'Reservation released and inventory restored successfully'
    });
  } catch (err) {
    await conn.rollback();
    console.error('[Inventory Service] Release Error:', err);
    res.status(err.status || 500).json({ message: err.message || 'Failed to release reservation' });
  } finally {
    conn.release();
  }
});

// Background TTL sweeper (every 10 seconds)
setInterval(expireStaleReservations, 10000);

app.listen(PORT, () => {
  console.log(`[Inventory Service] Running on port ${PORT}`);
});
