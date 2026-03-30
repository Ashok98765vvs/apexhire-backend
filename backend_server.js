const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Database setup (PostgreSQL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Initialize database tables
const initDB = async () => {
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
    
    CREATE TABLE IF NOT EXISTS user_hidden_jobs (
      user_id UUID REFERENCES users(id),
      job_id UUID REFERENCES jobs(id),
      hidden_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, job_id)
    );
  `);
  console.log('Database initialized');
};

initDB();

// Middleware to verify JWT
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

// Fetch from Adzuna API (FREE - 1000 calls/day)
const fetchAdzunaJobs = async (role, location, page = 1) => {
  try {
    const url = `https://api.adzuna.com/v1/api/jobs/us/search/${page}?` +
      `app_id=${process.env.ADZUNA_APP_ID}&` +
      `app_key=${process.env.ADZUNA_APP_KEY}&` +
      `what=${encodeURIComponent(role)}&` +
      `where=${encodeURIComponent(location)}&` +
      `max_days_old=1&` +
      `sort_by=date&` +
      `results_per_page=20&` +
      `content-type=application/json`;
    
    const response = await axios.get(url, { timeout: 10000 });
    
    return response.data.results.map(job => ({
      title: job.title,
      company: job.company?.display_name || 'Unknown',
      location: job.location?.display_name || location,
      description: job.description?.substring(0, 500) + '...',
      salary_min: job.salary_min,
      salary_max: job.salary_max,
      url: job.redirect_url,
      source: 'adzuna',
      posted_date: new Date(job.created),
      external_id: job.id
    }));
  } catch (error) {
    console.error('Adzuna error:', error.message);
    return [];
  }
};

// Fetch from JSearch RapidAPI (includes LinkedIn data)
const fetchJSearchJobs = async (query, location) => {
  try {
    const options = {
      method: 'GET',
      url: 'https://jsearch.p.rapidapi.com/search',
      params: {
        query: `${query} in ${location}`,
        page: '1',
        num_pages: '2',
        date_posted: 'today',
        remote_jobs_only: 'false',
        employment_types: 'FULLTIME,CONTRACTOR'
      },
      headers: {
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
      },
      timeout: 10000
    };
    
    const response = await axios.request(options);
    
    return response.data.data.map(job => ({
      title: job.job_title,
      company: job.employer_name,
      location: `${job.job_city}, ${job.job_state}`,
      description: job.job_description?.substring(0, 500) + '...',
      salary_min: job.job_min_salary,
      salary_max: job.job_max_salary,
      url: job.job_apply_link || job.job_google_link,
      source: 'jsearch',
      posted_date: new Date(job.job_posted_at_datetime_utc),
      external_id: job.job_id
    }));
  } catch (error) {
    console.error('JSearch error:', error.message);
    return [];
  }
};

// Combine and deduplicate jobs
const fetchAllJobs = async (role, location) => {
  const [adzunaJobs, jsearchJobs] = await Promise.all([
    fetchAdzunaJobs(role, location),
    fetchJSearchJobs(role, location)
  ]);
  
  const allJobs = [...adzunaJobs, ...jsearchJobs];
  const seen = new Set();
  const uniqueJobs = allJobs.filter(job => {
    const key = `${job.company}-${job.title}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  return uniqueJobs.sort((a, b) => b.posted_date - a.posted_date).slice(0, 25);
};

// Store jobs in database
const storeJobs = async (jobs) => {
  for (const job of jobs) {
    try {
      await pool.query(
        `INSERT INTO jobs (title, company, location, description, salary_min, salary_max, url, source, posted_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (company, title, posted_date) DO NOTHING`,
        [job.title, job.company, job.location, job.description, job.salary_min, job.salary_max, job.url, job.source, job.posted_date]
      );
    } catch (err) {
      console.error('Error storing job:', err.message);
    }
  }
};

// =====================
// API ROUTES
// =====================

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

// Get fresh jobs (last 24 hours)
app.get('/api/jobs/fresh', authMiddleware, async (req, res) => {
  const { role = 'software engineer', location = 'united states' } = req.query;
  const userId = req.user.userId;
  
  try {
    const userResult = await pool.query('SELECT plan, jobs_per_day FROM users WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    const limit = user?.jobs_per_day || 10;
    
    const todayCount = await pool.query(
      'SELECT jobs_viewed FROM daily_job_logs WHERE user_id = $1 AND date = CURRENT_DATE',
      [userId]
    );
    const viewedToday = todayCount.rows[0]?.jobs_viewed || 0;
    
    if (viewedToday >= limit) {
      return res.status(429).json({ 
        error: 'Daily limit reached', 
        limit,
        viewed: viewedToday,
        upgrade: true 
      });
    }
    
    const freshJobs = await fetchAllJobs(role, location);
    await storeJobs(freshJobs);
    
    const result = await pool.query(`
      SELECT j.*, 
        CASE WHEN uj.job_id IS NOT NULL THEN true ELSE false END as saved,
        uj.status
      FROM jobs j
      LEFT JOIN user_jobs uj ON j.id = uj.job_id AND uj.user_id = $1
      WHERE j.posted_date >= NOW() - INTERVAL '24 hours'
      AND j.id NOT IN (
        SELECT job_id FROM user_hidden_jobs WHERE user_id = $1
      )
      ORDER BY j.posted_date DESC
      LIMIT $2
    `, [userId, limit - viewedToday]);
    
    await pool.query(`
      INSERT INTO daily_job_logs (user_id, date, jobs_viewed)
      VALUES ($1, CURRENT_DATE, $2)
      ON CONFLICT (user_id, date)
      DO UPDATE SET jobs_viewed = daily_job_logs.jobs_viewed + $2
    `, [userId, result.rows.length]);
    
    res.json({
      jobs: result.rows,
      total: result.rows.length,
      limit,
      viewed_today: viewedToday + result.rows.length,
      remaining: limit - (viewedToday + result.rows.length),
      sources: ['adzuna', 'jsearch']
    });
    
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// Save a job
app.post('/api/jobs/save', authMiddleware, async (req, res) => {
  const { jobId } = req.body;
  const userId = req.user.userId;
  
  try {
    await pool.query(
      'INSERT INTO user_jobs (user_id, job_id, status) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [userId, jobId, 'saved']
    );
    
    await pool.query(`
      INSERT INTO daily_job_logs (user_id, date, jobs_saved)
      VALUES ($1, CURRENT_DATE, 1)
      ON CONFLICT (user_id, date)
      DO UPDATE SET jobs_saved = daily_job_logs.jobs_saved + 1
    `, [userId]);
    
    res.json({ success: true, message: 'Job saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update job status
app.patch('/api/jobs/:jobId/status', authMiddleware, async (req, res) => {
  const { jobId } = req.params;
  const { status } = req.body;
  const userId = req.user.userId;
  
  const validStatuses = ['saved', 'applied', 'interview', 'offer', 'rejected'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  
  try {
    const updateFields = ['status = $1'];
    const values = [status, userId, jobId];
    
    if (status === 'applied') {
      updateFields.push('applied_at = NOW()');
      
      await pool.query(`
        INSERT INTO daily_job_logs (user_id, date, jobs_applied)
        VALUES ($1, CURRENT_DATE, 1)
        ON CONFLICT (user_id, date)
        DO UPDATE SET jobs_applied = daily_job_logs.jobs_applied + 1
      `, [userId]);
    }
    
    await pool.query(
      `UPDATE user_jobs SET ${updateFields.join(', ')} WHERE user_id = $2 AND job_id = $3`,
      values
    );
    
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get user's pipeline
app.get('/api/jobs/my-pipeline', authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  
  const result = await pool.query(`
    SELECT j.*, uj.status, uj.saved_at, uj.applied_at, uj.notes
    FROM jobs j
    JOIN user_jobs uj ON j.id = uj.job_id
    WHERE uj.user_id = $1
    ORDER BY uj.saved_at DESC
  `, [userId]);
  
  const pipeline = {
    saved: result.rows.filter(j => j.status === 'saved'),
    applied: result.rows.filter(j => j.status === 'applied'),
    interview: result.rows.filter(j => j.status === 'interview'),
    offer: result.rows.filter(j => j.status === 'offer'),
    rejected: result.rows.filter(j => j.status === 'rejected')
  };
  
  res.json(pipeline);
});

// Get daily stats
app.get('/api/stats/today', authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  
  const result = await pool.query(`
    SELECT * FROM daily_job_logs 
    WHERE user_id = $1 AND date = CURRENT_DATE
  `, [userId]);
  
  const user = await pool.query('SELECT jobs_per_day FROM users WHERE id = $1', [userId]);
  const dailyGoal = user.rows[0]?.jobs_per_day || 25;
  
  const stats = result.rows[0] || { jobs_viewed: 0, jobs_saved: 0, jobs_applied: 0 };
  
  res.json({
    goal: dailyGoal,
    viewed: stats.jobs_viewed,
    saved: stats.jobs_saved,
    applied: stats.jobs_applied,
    progress_percent: Math.round((stats.jobs_applied / dailyGoal) * 100),
    remaining: dailyGoal - stats.jobs_applied
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
