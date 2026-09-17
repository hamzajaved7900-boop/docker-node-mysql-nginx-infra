const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 5000;

const dbConfig = {
  host: process.env.DB_HOST || 'db',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// Database connectivity check endpoint
app.get('/api/data', async (req, res) => {
  try {
    const pool = mysql.createPool(dbConfig);
    const [rows] = await pool.query('SELECT 1 + 1 AS solution');
    res.json({ message: 'Connected to Database via Docker Network!', result: rows[0].solution });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on port ${PORT}`);
});