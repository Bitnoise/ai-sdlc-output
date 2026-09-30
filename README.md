# Which Vans Go Electric?

A single-page, browser-only web app for analyzing which delivery vans in a fleet should be replaced with electric vehicles.

## How the application works

The application is a single-page, browser-only web app for analyzing which delivery vans in a fleet should be replaced with electric vehicles. Users upload van register (vans.csv) and trip history (trips.csv), configure analysis parameters (diesel models, EV options, financing, charging infrastructure, range requirements), and the app computes a prioritized shortlist recommending which vans to electrify. The calculation engine implements detailed business rules: trip data cleaning (deduplication, distance repair, ID remapping, daily summation), per-van metrics (P95 percentile daily km, max load, annualized distance), eligibility checks (refrigeration exclusion, range/payload fit, depot constraints), financial analysis (fuel vs. charging costs, EV purchase vs. diesel lease exit, 5-year total cost), and shortlist optimization with grant/charging/re-basing caps. Results include per-van detailed analysis, prioritized shortlist, and exportable summary for finance and operations teams. No network requests; all computation happens client-side.

## Tech Stack

- **Runtime**: Node.js ≥20 (TypeScript compiled to JavaScript)
- **Framework**: Express 5.x
- **Code Quality**: TypeScript, ESLint, Jest with supertest
- **Deployment**: Docker, Render.com

## Quick Start

### With Docker

```bash
docker compose up --build
```

Then open http://localhost:3000.

### With Node.js

```bash
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:3000.

## Development

```bash
npm run dev        # Start dev server with hot reload
npm run build      # Compile TypeScript to dist/
npm start          # Run compiled production build
npm run typecheck  # Check types without emitting (tsc --noEmit)
npm run lint       # Run ESLint
npm test           # Run Jest tests
```

All three checks are required before merging: `npm run lint`, `npm run typecheck`, `npm test`. GitHub Actions (`.github/workflows/ci.yml`) runs them and a Docker build on every pull request and every push to `main`.

## Deployment

### Deploy on Render

`render.yaml` is a Render Blueprint: **New > Blueprint > select this repo** creates the web service.

Auto-deploy is off (`autoDeployTrigger: "off"`). Production deploys only from `.github/workflows/deploy.yml`:

1. A pull request is merged into `main`.
2. Someone (the ai-sdlc agent, or a human) adds the label `ready_for_deployment` to the merged pull request.
3. The workflow calls the Render deploy hook with the merge commit (`ref=<merge commit>`).
4. It polls `GET /version` on https://htn-login.onrender.com until `commit` is the merge commit, for at most 20 minutes. The run fails if the commit does not go live.

The label on an open (not merged) pull request does nothing.

One-time setup: copy the deploy hook URL from **Render > htn-login > Settings > Deploy Hook** into the repository secret `RENDER_DEPLOY_HOOK_URL`.

### Deploy elsewhere

| Variable | Required | Default | Example |
|----------|----------|---------|---------|
| `PORT` | No | `3000` | `8080` |
| `NODE_ENV` | No | `development` | `production` |

```bash
npm run build
NODE_ENV=production npm start
```
