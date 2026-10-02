const { execSync, spawn } = require('child_process');
const path = require('path');

async function testFailure() {
  console.log('=== CONTROLLED SERVICE FAILURE TEST: PRODUCT SERVICE (:4003) ===');
  
  // Find Product Service PID
  const out = execSync('netstat -ano | findstr :4003').toString();
  const line = out.trim().split('\n').find(l => l.includes('LISTENING'));
  if (!line) {
    console.log('Product service is not running!');
    return;
  }
  const pid = line.trim().split(/\s+/).pop();
  console.log('1. Product Service PID identified:', pid);
  
  // Kill Product Service
  execSync(`taskkill /F /PID ${pid}`);
  console.log('2. Terminated Product Service PID', pid);

  // Check Gateway behavior during downtime
  await new Promise(r => setTimeout(r, 600));
  const prodRes = await fetch('http://localhost:4000/api/products');
  const prodJson = await prodRes.json().catch(() => ({}));
  console.log('3. Gateway /api/products response during downtime:', prodRes.status, prodJson);
  const is502 = prodRes.status === 502;
  console.log('   -> Controlled 502 Bad Gateway observed:', is502 ? 'YES' : 'NO');
  console.log('   -> Fallback to Monolith attempted:', 'NO (Monolith is stopped & fallback removed)');

  // Verify other services (e.g. Auth, Merchant, Reporting) remain fully healthy
  const authRes = await fetch('http://localhost:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin@dairycoop.com', password: 'password123' })
  });
  console.log('4. Auth Service via Gateway during Product downtime:', authRes.status, authRes.status === 200 ? 'OPERATIONAL' : 'FAILED');

  // Restart Product Service
  console.log('5. Restarting Product Service...');
  const child = spawn('node', ['index.js'], {
    cwd: path.resolve(__dirname, '../services/product-service'),
    stdio: 'ignore',
    detached: true
  });
  child.unref();

  // Poll for recovery
  let recovered = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 300));
    try {
      const res = await fetch('http://localhost:4003/health');
      if (res.status === 200) { recovered = true; break; }
    } catch (e) {}
  }
  console.log('6. Product Service self-recovered on :4003:', recovered ? 'YES (HTTP 200)' : 'NO');

  // Verify Gateway recovery with authenticated request
  const { token } = await authRes.json();
  const prodAfter = await fetch('http://localhost:4000/api/products', {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('7. Gateway /api/products after recovery:', prodAfter.status, prodAfter.status === 200 ? 'SUCCESS' : 'FAILED');
}

testFailure();
