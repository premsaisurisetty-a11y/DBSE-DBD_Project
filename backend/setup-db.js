const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question) {
  return new Promise(resolve => {
    rl.question(question, resolve);
  });
}

async function setupDatabase() {
  // Try different password combinations
  const passwords = ['', 'root', 'password', 'password123', 'mysql'];
  
  for (const password of passwords) {
    try {
      console.log(`Trying to connect with password: '${password}' ...`);
      
      const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: password,
        multipleStatements: true
      });

      console.log('✓ Connected to MySQL!');
      rl.close();

      // Read the schema file
      const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');

      // Execute the schema
      console.log('Running schema.sql...');
      await connection.query(schema);
      console.log('✓ Database setup complete!');

      await connection.end();
      
      // Update .env with the correct password
      const envPath = path.join(__dirname, '.env');
      let envContent = fs.readFileSync(envPath, 'utf8');
      envContent = envContent.replace(/DB_PASSWORD=.*/, `DB_PASSWORD=${password}`);
      fs.writeFileSync(envPath, envContent);
      console.log(`✓ Updated .env with password: '${password}'`);
      
      console.log('\n✅ Database setup complete! You can now login with:');
      console.log('   Email: admin@dairycoop.com');
      console.log('   Password: password123');
      
      process.exit(0);
    } catch (error) {
      console.log(`✗ Failed with password '${password}': ${error.message}`);
    }
  }

  console.error('\n❌ Could not connect to MySQL with default passwords.');
  const userPassword = await prompt('\nPlease enter your MySQL root password: ');
  rl.close();
  
  try {
    console.log('Attempting connection with provided password...');
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: userPassword,
      multipleStatements: true
    });

    console.log('✓ Connected to MySQL!');

    // Read the schema file
    const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Execute the schema
    console.log('Running schema.sql...');
    await connection.query(schema);
    console.log('✓ Database setup complete!');

    await connection.end();
    
    // Update .env with the correct password
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    envContent = envContent.replace(/DB_PASSWORD=.*/, `DB_PASSWORD=${userPassword}`);
    fs.writeFileSync(envPath, envContent);
    console.log(`✓ Updated .env with your password`);
    
    console.log('\n✅ Database setup complete! You can now login with:');
    console.log('   Email: admin@dairycoop.com');
    console.log('   Password: password123');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Failed to connect with provided password:', error.message);
    process.exit(1);
  }
}

setupDatabase();
