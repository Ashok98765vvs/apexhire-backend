const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// Allow ALL origins (simplest fix)
app.use(cors());
app.use(express.json());

// In-memory storage (no database needed for testing)
const users = [];
const tokens = [];

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here';

// Register
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  
  if (users.find(u => u.email === email)) {
    return res.status(400).json({ error: 'Email already exists' });
  }
  
  const user = {
    id: Date.now().toString(),
    email,
    password: hashedPassword,
    name,
    plan: 'basic'
  };
  
  users.push(user);
  
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ user: { id: user.id, email, name, plan: 'basic' }, token });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  const user = users.find(u => u.email === email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ 
    user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
    token 
  });
});

// Get jobs (demo data - no database needed)
app.get('/api/jobs/fresh', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  
  res.json({ 
    jobs: [
      {
        id: '1',
        title: 'Senior Software Engineer',
        company: 'Google',
        location: 'Mountain View, CA',
        description: 'Join our core infrastructure team building scalable systems that serve billions of users.',
        salary_min: 180000,
        salary_max: 250000,
        url: 'https://careers.google.com',
        posted_date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        saved: false,
        source: 'adzuna'
      },
      {
        id: '2',
        title: 'Full Stack Developer',
        company: 'Stripe',
        location: 'San Francisco, CA (Remote)',
        description: 'Build the future of internet commerce. We are looking for experienced full-stack engineers.',
        salary_min: 160000,
        salary_max: 220000,
        url: 'https://stripe.com/jobs',
        posted_date: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
        saved: false,
        source: 'jsearch'
      },
      {
        id: '3',
        title: 'React Native Engineer',
        company: 'Airbnb',
        location: 'New York, NY',
        description: 'Help us build the next generation of our mobile experience.',
        salary_min: 140000,
        salary_max: 190000,
        url: 'https://careers.airbnb.com',
        posted_date: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        saved: false,
        source: 'adzuna'
      }
    ],
    total: 3,
    limit: 25,
    viewed_today: 3,
    remaining: 22,
    sources: ['adzuna', 'jsearch']
  });
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'ApexHire API is running' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
