const mysql = require('mysql2/promise');
require('dotenv').config();

// Connection pool — never connect directly from React, always through this layer.
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true
});

module.exports = pool;
