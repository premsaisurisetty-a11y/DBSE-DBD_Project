const { spawn } = require('child_process');
const path = require('path');

console.log('====================================================');
console.log('  DAIRY & MILK COOPERATIVE MANAGEMENT SYSTEM');
console.log('  Starting Microservices Cluster & Frontend Client');
console.log('====================================================\n');

const services = [
  { name: 'Auth Service      (:4001)', dir: 'services/auth-service' },
  { name: 'Merchant Service  (:4002)', dir: 'services/merchant-service' },
  { name: 'Product Service   (:4003)', dir: 'services/product-service' },
  { name: 'Inventory Service (:4004)', dir: 'services/inventory-service' },
  { name: 'Sales Service     (:4005)', dir: 'services/sales-service' },
  { name: 'Payment Service   (:4006)', dir: 'services/payment-service' },
  { name: 'Reporting Service (:4007)', dir: 'services/reporting-service' },
  { name: 'API Gateway       (:4000)', dir: 'services/api-gateway' }
];

const children = [];

// 1. Launch Microservices & Gateway
services.forEach(s => {
  console.log(`[STARTING] ${s.name}...`);
  const c = spawn('node', ['index.js'], {
    cwd: path.resolve(__dirname, s.dir),
    stdio: 'inherit'
  });
  children.push(c);
});

// 2. Launch Frontend Dev Server (:5173)
console.log('[STARTING] Frontend Client   (:5173)...');
const viteBin = path.resolve(__dirname, 'frontend/node_modules/vite/bin/vite.js');
const frontend = spawn('node', [viteBin], {
  cwd: path.resolve(__dirname, 'frontend'),
  stdio: 'inherit'
});
children.push(frontend);

console.log('\n----------------------------------------------------');
console.log('  All services initiated!');
console.log('  Frontend UI:   http://localhost:5173');
console.log('  API Gateway:   http://localhost:4000/health');
console.log('  Press Ctrl+C to stop all processes gracefully.');
console.log('----------------------------------------------------\n');

process.on('SIGINT', () => {
  console.log('\n[STOPPING] Shutting down all processes...');
  children.forEach(c => {
    try { c.kill(); } catch (e) {}
  });
  process.exit();
});

process.on('SIGTERM', () => {
  children.forEach(c => {
    try { c.kill(); } catch (e) {}
  });
  process.exit();
});
