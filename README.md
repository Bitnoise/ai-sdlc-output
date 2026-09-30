# htn-login

A TypeScript + Express web application providing secure user authentication with login, registration, and session management. User data is persisted in PostgreSQL with session state stored server-side.

## Features

- **User Registration** — Create new accounts with email validation and password strength enforcement (minimum 8 characters)
- **Secure Login** — Passwords are hashed with bcryptjs; session tokens are regenerated on login to prevent fixation attacks
- **Session Management** — Sessions stored in PostgreSQL with automatic cleanup and configurable expiration (7 days by default)
- **Protected Routes** — Home page and logout require authentication; login/register pages redirect authenticated users
- **Security Hardening** — HTTP-only cookies, SameSite protection, HTTPS-only in production, configurable SSL for remote databases
- **Health Check** — `/health` endpoint for monitoring and load balancer checks

## Tech Stack

- **Runtime**: Node.js ≥20 (TypeScript compiled to JavaScript)
- **Framework**: Express 5.x
- **Database**: PostgreSQL 17 (with automatic schema migration)
- **Authentication**: bcryptjs for password hashing, express-session with PostgreSQL store
- **Code Quality**: TypeScript, ESLint, Jest for testing
- **Deployment**: Docker, Docker Compose, Render.com

## Prerequisites

### For Docker setup:
- Docker and Docker Compose

### For local Node setup:
- Node.js ≥20
- PostgreSQL ≥12
- npm ≥10

## Quick Start

### With Docker (recommended)

```bash
docker compose up --build
```

Then open http://localhost:3000. The app and PostgreSQL database will start automatically.

### Local Node.js Setup

Requires a running PostgreSQL server:

```bash
cp .env.example .env
# Edit .env and set DATABASE_URL to your Postgres connection string
npm install
npm run dev
```

Open http://localhost:3000.

**Example local DATABASE_URL**:
```
postgres://username:password@localhost:5432/app
```

## Development

### Available scripts

```bash
npm run dev        # Start dev server with hot reload
npm run build      # Compile TypeScript to dist/
npm start          # Run compiled production build
npm run typecheck  # Check types without emitting (tsc --noEmit)
npm run lint       # Run ESLint
npm test           # Run Jest tests
```

### Code quality

All three checks are required before merging:

```bash
npm run lint       # ESLint — code style
npm run typecheck  # TypeScript — type safety
npm test           # Jest — functionality
```

GitHub Actions (`.github/workflows/ci.yml`) runs all checks, tests, and a Docker build on every push and pull request.

## Testing

Tests run with Jest and use an isolated test database to avoid affecting development data.

```bash
npm test
```

**Important**: Tests delete all rows in the test database. They use the `TEST_DATABASE_URL` environment variable (defaults to `postgres://app:app@localhost:5432/app_test`), never the production `DATABASE_URL`.

### Testing with Docker Compose

Create the test database once:

```bash
docker compose exec db createdb -U app app_test
```

Then run `npm test` locally (not inside the container).

## Deployment

### Deploy on Render

`render.yaml` is a Render Blueprint: **New > Blueprint > select this repo** creates the PostgreSQL database and the web service, and sets `DATABASE_URL` and `SESSION_SECRET`. The app runs database migrations on startup.

Auto-deploy is off (`autoDeployTrigger: "off"`). Production deploys only from `.github/workflows/deploy.yml`:

1. A pull request is merged into `main`.
2. Someone (the ai-sdlc agent, or a human) adds the label `ready_for_deployment` to the merged pull request.
3. The workflow calls the Render deploy hook with the merge commit (`ref=<merge commit>`).
4. It polls `GET /version` on https://htn-login.onrender.com until `commit` is the merge commit, for at most 20 minutes. The run fails if the commit does not go live.

The label on an open (not merged) pull request does nothing.

One-time setup: copy the deploy hook URL from **Render > htn-login > Settings > Deploy Hook** into the repository secret `RENDER_DEPLOY_HOOK_URL`.

`GET /version` returns `{"commit": "<sha>"}` from Render's `RENDER_GIT_COMMIT`, and `null` outside Render.

### Deploy elsewhere

Ensure these environment variables are set where you deploy:

| Variable | Required | Default | Example |
|----------|----------|---------|---------|
| `DATABASE_URL` | Yes | — | `postgres://user:pass@host:5432/app` |
| `SESSION_SECRET` | Yes | — | A 32+ character random string (use `openssl rand -hex 32`) |
| `PORT` | No | `3000` | `8080` |
| `NODE_ENV` | No | `development` | Set to `production` for secure cookies over HTTPS |
| `DATABASE_SSL` | No | `false` | Set to `true` if using Neon, Supabase, or external Render URL |

Build and run:

```bash
npm run build
NODE_ENV=production npm start
```

## Environment Variables Reference

| Variable | Purpose | Required | Example |
|----------|---------|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Yes | `postgres://app:app@localhost:5432/app` |
| `SESSION_SECRET` | Secret key for signing session cookies (use a strong random value) | Yes | `my-super-secret-key-...` |
| `PORT` | HTTP server port | No | `3000` (default) |
| `NODE_ENV` | Environment mode (`development`, `production`) | No | `production` enables secure cookies |
| `DATABASE_SSL` | Enable SSL for database (for external providers) | No | `true` for Neon/Supabase, `false` for local |
| `TEST_DATABASE_URL` | Test database connection (for Jest) | No | `postgres://app:app@localhost:5432/app_test` |

## Troubleshooting

### "DATABASE_URL is not set"

Ensure `.env` file exists with a valid `DATABASE_URL`, or set the environment variable before running:

```bash
export DATABASE_URL="postgres://user:password@localhost:5432/app"
npm run dev
```

### "SESSION_SECRET is not set"

Set a strong random secret:

```bash
export SESSION_SECRET=$(openssl rand -hex 32)
npm run dev
```

### Docker Compose fails with "cannot assign requested address"

Ensure port 3000 and 5432 are not in use:

```bash
# Check what's using the ports
lsof -i :3000
lsof -i :5432
```

### Tests fail with "relation \"users\" does not exist"

The test database exists but migrations didn't run. Manually create tables:

```bash
docker compose exec db psql -U app app_test < /dev/stdin << 'EOF'
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);
EOF
```

### "HTTPS-only cookie" errors in browser console

This happens when `NODE_ENV` is set to `production` but the app runs over HTTP (localhost). Either:

1. Set `NODE_ENV=development` for local testing
2. Use HTTPS (required for production)

## Project Structure

```
.
├── src/
│   ├── app.ts          # Express routes and middleware
│   ├── server.ts       # Server entry point
│   ├── db.ts           # Database and migrations
│   └── views.ts        # HTML templates
├── test/               # Jest tests
├── Dockerfile          # Production Docker image
├── docker-compose.yml  # Local development with Docker
├── render.yaml         # Render.com deployment config
├── package.json        # Dependencies and scripts
└── README.md           # This file
```
