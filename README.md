# TypeScript Login Application

A secure user authentication system built with Express.js and PostgreSQL. Provides user registration, login, session management, and password hashing with bcryptjs.

## Overview

This application demonstrates a complete authentication flow with:
- User registration with email validation
- Secure login with bcryptjs password hashing
- Session management using PostgreSQL
- Protected routes requiring authentication
- Logout with session cleanup
- Health check endpoint for monitoring

## Tech Stack

- **Backend**: Node.js 20+ with Express.js 5.x
- **Language**: TypeScript 6.x
- **Database**: PostgreSQL 17
- **Session Storage**: PostgreSQL with connect-pg-simple
- **Password Hashing**: bcryptjs (12 salt rounds)
- **Testing**: Jest with Supertest
- **Development**: tsx with hot reload
- **Containerization**: Docker with multi-stage builds

## Prerequisites

- **Node.js**: 20.0.0 or higher
- **PostgreSQL**: 17 (or Docker with Docker Compose)
- **npm**: Included with Node.js

## Quick Start

### With Docker Compose (Recommended)

```bash
git clone <repository-url>
cd htn-login
docker-compose up
```

Open http://localhost:3000. The app and database start automatically.

### Without Docker (local PostgreSQL required)

```bash
git clone <repository-url>
cd htn-login
cp .env.example .env          # Configure DATABASE_URL
npm install
npm run dev
```

Open http://localhost:3000.

## Installation & Configuration

### 1. Environment Setup

Copy the example configuration:

```bash
cp .env.example .env
```

Configure these variables in `.env`:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://app:app@localhost:5432/app` |
| `SESSION_SECRET` | Session encryption key (32+ chars recommended) | `your-long-random-string-here` |
| `PORT` | Server port (default: 3000) | `3000` |
| `NODE_ENV` | Environment (development/production) | `development` |
| `DATABASE_SSL` | Enable SSL for database (required for some hosts) | `false` |

### 2. Database Setup

For local PostgreSQL, create the database:

```bash
psql -U postgres
CREATE DATABASE app;
CREATE USER app WITH PASSWORD 'app';
GRANT ALL PRIVILEGES ON DATABASE app TO app;
```

For Docker Compose, the database is created automatically.

### 3. Install Dependencies

```bash
npm install
```

## Running the Application

### Development Mode (with hot reload)

```bash
npm run dev
```

Changes to TypeScript files automatically restart the server.

### Production Build

```bash
npm run build
npm start
```

### Docker Compose

```bash
docker-compose up              # Start app and database
docker-compose up --build      # Rebuild after code changes
docker-compose down            # Stop and remove containers
```

Database data persists in the `pgdata` volume between restarts.

## API Endpoints

### Authentication Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---|
| GET | `/login` | Display login form | No |
| POST | `/login` | Authenticate user (email/password) | No |
| GET | `/register` | Display registration form | No |
| POST | `/register` | Create new account | No |
| POST | `/logout` | Destroy session and logout | Yes |

### Application Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---|
| GET | `/` | Home page (shows authenticated user email) | Yes |
| GET | `/health` | Health check (for monitoring) | No |

### Form Parameters

**Login & Register**: Submit as URL-encoded form data
- `email`: User email address
- `password`: User password (min 8 characters for registration)

### Validation Rules

- **Email**: Valid email format (pattern: `^[^\s@]+@[^\s@]+\.[^\s@]+$`), case-insensitive
- **Password**: Minimum 8 characters, hashed with bcryptjs (12 salt rounds)
- **Existing email**: Registration returns 409 error if email already exists

### Response Codes

- `200`: Success
- `400`: Invalid input (email format, password too short)
- `401`: Authentication failed (wrong credentials)
- `409`: Conflict (email already registered)
- `500`: Server error

## Testing

Run the complete test suite:

```bash
npm test                  # Run all tests (Jest)
```

Test database setup (with Docker Compose running):

```bash
docker-compose exec db createdb -U app app_test
```

Tests use `TEST_DATABASE_URL` (default: `postgres://app:app@localhost:5432/app_test`) and clean up test data after each run.

## Code Quality

```bash
npm run lint              # Run ESLint
npm run typecheck         # Type check without building
npm run build             # Build TypeScript
```

GitHub Actions (`.github/workflows/ci.yml`) automatically:
- Runs lint checks
- Type checks TypeScript
- Runs Jest test suite
- Builds Docker image
- Runs on every push to main and pull request

## Session Management

- **Duration**: 7 days
- **Storage**: PostgreSQL (persists across restarts)
- **Security**: 
  - Regenerated on login (prevents session fixation)
  - HttpOnly cookies (prevents JavaScript access)
  - SameSite=Lax (CSRF protection)
  - Secure flag enabled in production (HTTPS-only)
- **Cleanup**: Automatic pruning of expired sessions (every 15 minutes)

## Deployment

### Prerequisites

1. PostgreSQL database (create via platform or external service)
2. Environment variables set on hosting platform
3. Git repository pushed to GitHub

### Deployment to Render

1. Push repository to GitHub
2. Go to https://render.com and click **New > Blueprint**
3. Select your repository
4. Render reads `render.yaml` and creates:
   - PostgreSQL database
   - Web service
   - Automatic environment variables (`DATABASE_URL`, `SESSION_SECRET`)

The app creates tables automatically on startup.

### Deployment to Railway or Fly.io

1. Configure environment variables in platform dashboard:
   - `DATABASE_URL`: PostgreSQL connection string
   - `SESSION_SECRET`: Long random string (32+ characters)
   - `NODE_ENV`: Set to `production`
   - `DATABASE_SSL`: Set to `true` if needed

2. Deploy from GitHub (platform will build Docker image and run)

3. Access health check: `GET https://your-app.com/health`

### Production Security Checklist

- [ ] `SESSION_SECRET` is a long random string (32+ characters)
- [ ] `NODE_ENV` is set to `production`
- [ ] `DATABASE_URL` uses SSL/TLS
- [ ] No `.env` files committed to git
- [ ] Database credentials stored in platform secrets
- [ ] HTTPS enabled on hosting platform
- [ ] Monitoring configured for `/health` endpoint

## Security Features

- **Password Hashing**: bcryptjs with 12 salt rounds (resistant to brute force)
- **Session Security**: Server-side storage, only session ID in cookies
- **CSRF Protection**: SameSite cookies prevent cross-site request forgery
- **Session Fixation**: Session ID regenerated on login
- **Input Validation**: Email format and password strength validation
- **Error Messages**: Generic messages to prevent email enumeration
- **HTTPS**: Enforced via secure cookies in production
- **SQL Injection**: Parameterized queries via pg library

## File Structure

```
.
├── src/
│   ├── app.ts           # Express app and route handlers
│   ├── server.ts        # Server startup
│   ├── db.ts            # Database connection and queries
│   └── views.ts         # HTML page templates
├── test/
│   ├── auth.test.ts     # Authentication tests
│   ├── views.test.ts    # View rendering tests
│   └── setup-env.ts     # Test environment setup
├── Dockerfile           # Multi-stage Docker build
├── docker-compose.yml   # Local development setup
├── .env.example         # Environment variable template
├── package.json         # Dependencies and scripts
└── tsconfig.json        # TypeScript configuration
```

## Troubleshooting

### "SESSION_SECRET is not set" error
```bash
# Ensure .env file has SESSION_SECRET
echo "SESSION_SECRET=your-long-random-string" >> .env
```

### Database connection errors
```bash
# Test database connection
psql $DATABASE_URL

# Check Docker database
docker-compose logs db
docker-compose ps
```

### Port 3000 already in use
```bash
# Kill process using port 3000
lsof -ti:3000 | xargs kill -9

# Or use different port
PORT=3001 npm run dev
```

### Tests failing due to missing test database
```bash
# Create test database (with Docker Compose)
docker-compose exec db createdb -U app app_test
npm test
```

## License

Proprietary - Bitnoise
