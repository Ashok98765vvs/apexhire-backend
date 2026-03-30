const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

// Test route
app.get('/', (req, res) => {
  res.send('ApexHire API is running 🚀');
});

// Fetch jobs (last 24h)
app.get('/api/jobs', async (req, res) => {
  try {
    const { role = 'software engineer', location = 'united states' } = req.query;

    const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${process.env.ADZUNA_APP_ID}&app_key=${process.env.ADZUNA_APP_KEY}&what=${role}&where=${location}&max_days_old=1&sort_by=date`;

    const response = await fetch(url);
    const data = await response.json();

    const jobs = data.results.map(job => ({
      title: job.title,
      company: job.company.display_name,
      location: job.location.display_name,
      url: job.redirect_url,
      created: job.created
    }));

    res.json(jobs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
