# htn-login

A small TypeScript + Express app with a login page and account creation. Data is kept in PostgreSQL.

## Run locally

With Docker (app and database):

    docker compose up --build

Without Docker (you need a running Postgres):

    cp .env.example .env    # then set DATABASE_URL
    npm install
    npm run dev

Open http://localhost:3000.

## Lint and tests

    npm run lint         # ESLint
    npm run typecheck    # TypeScript
    npm test             # Jest

The tests delete all rows in the test database. They use `TEST_DATABASE_URL`
(default: `postgres://app:app@localhost:5432/app_test`), never `DATABASE_URL`.
With Docker Compose running, make the test database once:

    docker compose exec db createdb -U app app_test

GitHub Actions (`.github/workflows/ci.yml`) runs lint, type check, tests (with a
Postgres service) and a Docker build on each push to `master` and on each pull request.

## Deploy on Render

1. Push this folder to a GitHub repository.
2. On https://render.com, click **New > Blueprint** and select the repository.
3. Render reads `render.yaml`. It creates the Postgres database and the web app, and it sets `DATABASE_URL` and `SESSION_SECRET`.

The app creates its tables when it starts.

## Environment variables

| Name | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | Long random string that signs the session cookie |
| `PORT` | HTTP port (default 3000) |
| `NODE_ENV` | Set to `production` for secure (HTTPS-only) cookies |
| `DATABASE_SSL` | Set to `true` if your database needs SSL (Neon, Supabase, external Render URL) |
