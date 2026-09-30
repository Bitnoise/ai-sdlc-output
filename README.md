# htn-login

A simple TypeScript + Express web application.

## Features

- **Home Page** — Welcome page served on `/`
- **Health Check** — `/health` endpoint for monitoring

## Tech Stack

- **Runtime**: Node.js ≥20 (TypeScript compiled to JavaScript)
- **Framework**: Express 5.x
- **Code Quality**: TypeScript, ESLint, Jest for testing

## Prerequisites

- Node.js ≥20
- npm ≥10

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000.

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

GitHub Actions (`.github/workflows/ci.yml`) runs all checks and a Docker build on every push and pull request.

## Build and Run

```bash
npm run build
npm start
```

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
