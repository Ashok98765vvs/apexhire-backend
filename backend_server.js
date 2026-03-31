const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();

// CORS - Allow all origins for now (fix later)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Database setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Initialize database
const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        plan VARCHAR(50) DEFAULT 'basic',
        jobs_per_day INTEGER DEFAULT 10,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE TABLE IF NOT EXISTS jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        company VARCHAR(255) NOT NULL,
        location VARCHAR(255),
        description TEXT,
        salary_min INTEGER,
        salary_max INTEGER,
        url VARCHAR(500) NOT NULL,
        source VARCHAR(50),
        posted_date TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(company, title, posted_date)
      );
      
      CREATE TABLE IF NOT EXISTS user_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        job_id UUID REFERENCES jobs(id),
        status VARCHAR(50) DEFAULT 'saved',
        saved_at TIMESTAMP DEFAULT NOW(),
        applied_at TIMESTAMP,
        notes TEXT,
        UNIQUE(user_id, job_id)
      );
      
      CREATE TABLE IF NOT EXISTS daily_job_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        date DATE DEFAULT CURRENT_DATE,
        jobs_viewed INTEGER DEFAULT 0,
        jobs_saved INTEGER DEFAULT 0,
        jobs_applied INTEGER DEFAULT 0,
        UNIQUE(user_id, date)
      );
    `);
    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Database init error:', err.message);
  }
};

initDB();

// JWT middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  
  try {
    const result = await pool.query(
      'INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email, hashedPassword, name]
    );
    
    const token = jwt.sign({ userId: result.rows[0].id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ user: result.rows[0], token });
  } catch (err) {
    res.status(400).json({ error: 'Email already exists' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
  
  const valid = await bcrypt.compare(password, result.rows[0].password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  
  const token = jwt.sign({ userId: result.rows[0].id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ 
    user: { id: result.rows[0].id, email: result.rows[0].email, name: result.rows[0].name, plan: result.rows[0].plan },
    token 
  });
});

// Jobs route
app.get('/api/jobs/fresh', authMiddleware, async (req, res) => {
  res.json({ 
    jobs: [
      {
        id: '1',
        title: 'Senior Software Engineer',
        company: 'Google',
        location: 'Mountain View, CA',
        description: 'Join our core infrastructure team building scalable systems...',
        salary_min: 180000,
        salary_max: 250000,
        url: 'https://careers.google.com',
        posted_date: new Date().toISOString(),
        saved: false,
        source: 'demo'
      },
      {
        id: '2',
        title: 'Full Stack Developer',
        company: 'Stripe',
        location: 'San Francisco, CA',
        description: 'Build the future of internet commerce...',
        salary_min: 160000,
        salary_max: 220000,
        url: 'https://stripe.com/jobs',
        posted_date: new Date().toISOString(),
        saved: false,
        source: 'demo'
      }
    ],
    total: 2,
    limit: 25,
    viewed_today: 2,
    remaining: 23,
    sources: ['demo']
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
