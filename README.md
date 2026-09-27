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
