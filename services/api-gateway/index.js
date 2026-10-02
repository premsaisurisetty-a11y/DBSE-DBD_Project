const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config(); // Fallback

const app = express();
const PORT = process.env.PORT || 4000;

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:4001';
const MERCHANT_SERVICE_URL = process.env.MERCHANT_SERVICE_URL || 'http://localhost:4002';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:4003';
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:4004';
const SALES_SERVICE_URL = process.env.SALES_SERVICE_URL || 'http://localhost:4005';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:4006';
const REPORTING_SERVICE_URL = process.env.REPORTING_SERVICE_URL || 'http://localhost:4007';

app.use(cors());
app.use(express.json());

// Gateway health check
app.get('/health', (req, res) => {
  res.json({
    service: 'api-gateway',
    port: PORT,
    status: 'OK',
    routes: {
      auth: AUTH_SERVICE_URL,
      merchants: MERCHANT_SERVICE_URL,
      products: PRODUCT_SERVICE_URL,
      inventory: INVENTORY_SERVICE_URL,
      sales: SALES_SERVICE_URL,
      payments: PAYMENT_SERVICE_URL,
      reporting: REPORTING_SERVICE_URL
    }
  });
});

// Proxy forwarder helper
async function proxyRequest(targetBaseUrl, req, res) {
  const targetUrl = `${targetBaseUrl}${req.originalUrl}`;
  const headers = { ...req.headers };
  delete headers['host'];
  delete headers['content-length'];

  const options = {
    method: req.method,
    headers: headers
  };

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
    options.body = JSON.stringify(req.body);
    options.headers['content-type'] = 'application/json';
  }

  try {
    const downstreamRes = await fetch(targetUrl, options);
    const contentType = downstreamRes.headers.get('content-type') || '';
    
    res.status(downstreamRes.status);
    downstreamRes.headers.forEach((val, key) => {
      if (!['transfer-encoding', 'connection', 'content-length'].includes(key.toLowerCase())) {
        res.setHeader(key, val);
      }
    });

    if (contentType.includes('application/json')) {
      const data = await downstreamRes.json();
      return res.json(data);
    } else {
      const text = await downstreamRes.text();
      return res.send(text);
    }
  } catch (err) {
    console.error(`[API Gateway] Error proxying ${req.method} ${req.originalUrl} to ${targetBaseUrl}:`, err.message);
    if (err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED') {
      return res.status(502).json({
        message: 'Bad Gateway: Downstream service is currently unreachable'
      });
    }
    return res.status(500).json({
      message: 'Gateway proxy error'
    });
  }
}

// 1. Route /api/auth/* to Auth Service (Port 4001)
app.use('/api/auth', (req, res) => {
  proxyRequest(AUTH_SERVICE_URL, req, res);
});

// 2. Route /api/merchants/* to Merchant Service (Port 4002)
app.use('/api/merchants', (req, res) => {
  proxyRequest(MERCHANT_SERVICE_URL, req, res);
});

// 3. Route /api/products/* to Product Service (Port 4003)
app.use('/api/products', (req, res) => {
  proxyRequest(PRODUCT_SERVICE_URL, req, res);
});

// 4. Route /api/inventory/* to Inventory Service (Port 4004)
app.use('/api/inventory', (req, res) => {
  proxyRequest(INVENTORY_SERVICE_URL, req, res);
});

// 5. Route /api/sales/* to Sales Service (Port 4005)
app.use('/api/sales', (req, res) => {
  proxyRequest(SALES_SERVICE_URL, req, res);
});

// 6. Route /api/invoices/* to Sales Service (Port 4005)
app.use('/api/invoices', (req, res) => {
  proxyRequest(SALES_SERVICE_URL, req, res);
});

// 7. Route /api/payments/* to Payment Service (Port 4006)
app.use('/api/payments', (req, res) => {
  proxyRequest(PAYMENT_SERVICE_URL, req, res);
});

// 8. Route /api/discrepancies/* to Reporting Service (Port 4007)
app.use('/api/discrepancies', (req, res) => {
  proxyRequest(REPORTING_SERVICE_URL, req, res);
});

// 404 for all unmapped routes (monolith fallback decommissioned)
app.use((req, res) => {
  res.status(404).json({ message: 'Gateway route not found' });
});

app.listen(PORT, () => {
  console.log(`[API Gateway] Running on port ${PORT}`);
  console.log(`  -> /api/auth/* proxying to ${AUTH_SERVICE_URL}`);
  console.log(`  -> /api/merchants/* proxying to ${MERCHANT_SERVICE_URL}`);
  console.log(`  -> /api/products/* proxying to ${PRODUCT_SERVICE_URL}`);
  console.log(`  -> /api/inventory/* proxying to ${INVENTORY_SERVICE_URL}`);
  console.log(`  -> /api/sales/* proxying to ${SALES_SERVICE_URL}`);
  console.log(`  -> /api/invoices/* proxying to ${SALES_SERVICE_URL}`);
  console.log(`  -> /api/payments/* proxying to ${PAYMENT_SERVICE_URL}`);
  console.log(`  -> /api/discrepancies/* proxying to ${REPORTING_SERVICE_URL}`);
  console.log(`  -> Unmapped routes return 404 Not Found (Monolith Fallback Retired)`);
});
