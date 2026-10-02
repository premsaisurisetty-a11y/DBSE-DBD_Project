const { spawn } = require('child_process');
const path = require('path');

async function testRestart() {
  console.log('--- RESTART / RECOVERY SMOKE TEST ---');

  // Step 1: Pre-restart check
  console.log('1. BEFORE RESTART:');
  const preHealth = await fetch('http://localhost:4003/health').then(r => r.status).catch(e => e.message);
  const preGw = await fetch('http://localhost:4000/api/products').then(r => r.status).catch(e => e.message);
  console.log(`   Product Service :4003 Health: ${preHealth}`);
  console.log(`   Gateway -> Product Service: ${preGw}`);

  // Note: We don't need to kill the main running process if we want to test transient failover or restart in isolation,
  // but let's test a simulated or actual restart of a child process if safe.
}

testRestart();
