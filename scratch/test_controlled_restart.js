const { spawn, execSync } = require('child_process');
const path = require('path');

async function run() {
  console.log('=== CONTROLLED RESTART TEST: PRODUCT SERVICE (:4003) ===\n');
  
  // 1. BEFORE
  const b1 = await fetch('http://localhost:4003/health').then(r => r.status).catch(e => e.message);
  const b2 = await fetch('http://localhost:4000/api/products').then(r => r.status).catch(e => e.message);
  console.log('1. BEFORE RESTART:');
  console.log('   Direct :4003 /health HTTP:', b1);
  console.log('   Gateway /api/products HTTP:', b2);

  // Find PID of port 4003
  let pid;
  try {
    const out = execSync('netstat -ano | findstr :4003').toString();
    const line = out.trim().split('\n')[0];
    pid = line.trim().split(/\s+/).pop();
    console.log('\n   Identified Product Service PID:', pid);
  } catch (e) {
    console.log('   Could not find PID:', e.message);
  }

  if (pid) {
    // Stop process
    try {
      execSync(`taskkill /F /PID ${pid}`);
      console.log('   Killed process PID', pid);
    } catch (e) {
      console.log('   Error killing process:', e.message);
    }
  }
  await new Promise(r => setTimeout(r, 1000));

  // 2. DURING
  let d1, d2;
  try {
    d1 = await fetch('http://localhost:4003/health').then(r => r.status).catch(e => e.message);
  } catch (e) { d1 = e.message; }
  try {
    d2 = await fetch('http://localhost:4000/api/products').then(r => r.status).catch(e => e.message);
  } catch (e) { d2 = e.message; }

  console.log('\n2. DURING DOWNTIME:');
  console.log('   Direct :4003 /health:', d1);
  console.log('   Gateway /api/products HTTP:', d2, '(Expected 502 Bad Gateway)');

  // Start process back up
  const servicePath = path.resolve(__dirname, '../services/product-service');
  const child = spawn('node', ['index.js'], { cwd: servicePath, stdio: 'ignore', detached: true });
  child.unref();

  let recovered = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const res = await fetch('http://localhost:4003/health');
      if (res.status === 200) { recovered = true; break; }
    } catch(e) {}
  }

  // 3. AFTER
  const a1 = await fetch('http://localhost:4003/health').then(r => r.status).catch(e => e.message);
  const a2 = await fetch('http://localhost:4000/api/products').then(r => r.status).catch(e => e.message);
  console.log('\n3. AFTER RESTART & RECOVERY:');
  console.log('   Direct :4003 /health HTTP:', a1);
  console.log('   Gateway /api/products HTTP:', a2, '(Expected 200 OK)');
  console.log('   Automatic Reconnection Result:', (a1 === 200 && a2 === 200) ? 'SUCCESS' : 'FAILURE');
}

run();
