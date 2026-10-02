const fs = require('fs');
const path = require('path');

const services = [
  { name: 'Auth', dir: '../services/auth-service' },
  { name: 'Merchant', dir: '../services/merchant-service' },
  { name: 'Product', dir: '../services/product-service' },
  { name: 'Inventory', dir: '../services/inventory-service' },
  { name: 'Sales', dir: '../services/sales-service' },
  { name: 'Payment', dir: '../services/payment-service' },
  { name: 'Reporting', dir: '../services/reporting-service' },
  { name: 'Monolith', dir: '../backend' }
];

const tables = [
  'users', 'merchants', 'products', 'product_quality',
  'stock_entries', 'inventory', 'inventory_reservations',
  'invoices', 'sales', 'sale_items', 'payments', 'saga_instances',
  'vw_stock_discrepancy', 'vw_payment_discrepancy', 'vw_merchant_revenue'
];

function scanFiles(dir) {
  let res = [];
  const full = path.resolve(__dirname, dir);
  if (!fs.existsSync(full)) return res;
  fs.readdirSync(full).forEach(f => {
    const p = path.join(full, f);
    if (fs.statSync(p).isDirectory()) {
      if (f !== 'node_modules') res = res.concat(scanFiles(p));
    } else if (f.endsWith('.js')) {
      res.push(p);
    }
  });
  return res;
}

const matrix = {};
tables.forEach(t => { matrix[t] = {}; });

services.forEach(s => {
  const files = scanFiles(s.dir);
  const code = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  tables.forEach(t => {
    const reg = new RegExp(`\\b${t}\\b`, 'i');
    matrix[t][s.name] = reg.test(code) ? 'YES' : '-';
  });
});

console.table(matrix);
