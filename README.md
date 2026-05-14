# ApexHire Backend

> A Node.js/Express REST API backend powering the ApexHire job platform — uses Adzuna API for live job data, JWT authentication, and in-memory storage.

## Features

- **JWT Authentication** — secure register/login endpoints with bcryptjs password hashing
- **Adzuna API Integration** — real-time job listings from the Adzuna job search API
- **CORS Enabled** — ready to connect with any frontend
- **In-Memory Storage** — lightweight, no database needed for development/testing
- **RESTful API** — clean endpoint structure for job search and user management

## Tech Stack

| Technology | Purpose |
|---|---|
| Node.js | Runtime |
| Express.js | Web framework |
| bcryptjs | Password hashing |
| jsonwebtoken | JWT auth |
| CORS | Cross-origin support |
| Adzuna API | Job data source |

## Getting Started

### Prerequisites

```bash
npm install
```

### Environment Variables

Create a `.env` file:
```
JWT_SECRET=your_jwt_secret_here
ADZUNA_APP_ID=your_adzuna_app_id
ADZUNA_API_KEY=your_adzuna_api_key
```

### Run the server

```bash
node backend_server.js
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Login and get JWT token |
| GET | `/api/jobs` | Fetch job listings |

## Author

**Ashok Chowdary** — [LinkedIn](https://linkedin.com/in/ashok-chowdary) | [Portfolio](https://github.com/Ashok98765vvs/Portfolio)
