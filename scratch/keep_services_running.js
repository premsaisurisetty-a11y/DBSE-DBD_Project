const { spawn } = require('child_process');
const path = require('path');

const services = [
  { name: 'Auth', dir: 'services/auth-service' },
  { name: 'Merchant', dir: 'services/merchant-service' },
  { name: 'Product', dir: 'services/product-service' },
  { name: 'Inventory', dir: 'services/inventory-service' },
  { name: 'Sales', dir: 'services/sales-service' },
  { name: 'Payment', dir: 'services/payment-service' },
  { name: 'Reporting', dir: 'services/reporting-service' },
  { name: 'Gateway', dir: 'services/api-gateway' }
];

const children = [];

services.forEach(s => {
  console.log(`Starting ${s.name}...`);
  const c = spawn('node', ['index.js'], {
    cwd: path.resolve(__dirname, '..', s.dir),
    stdio: 'inherit'
  });
  children.push(c);
});

process.on('SIGINT', () => {
  children.forEach(c => c.kill());
  process.exit();
});

console.log('All microservices and Gateway started.');
setInterval(() => {}, 10000);
