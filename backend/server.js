const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const merchantRoutes = require('./routes/merchantRoutes');
const productRoutes = require('./routes/productRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const salesRoutes = require('./routes/salesRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const discrepancyRoutes = require('./routes/discrepancyRoutes');
const auditRoutes = require('./routes/auditRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'OK', service: 'dairy-merchant-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/merchants', merchantRoutes);
app.use('/api/products', productRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/discrepancies', discrepancyRoutes);
app.use('/api/audit-logs', auditRoutes);

// Fallback 404
app.use((req, res) => res.status(404).json({ message: 'Route not found' }));

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Unexpected server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Dairy Merchant backend running on port ${PORT}`));
