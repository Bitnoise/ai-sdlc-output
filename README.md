# Which Vans Go Electric?

A single-page, browser-only web app for analyzing which delivery vans in a fleet should be replaced with electric vehicles.

## How the application works

The application is a single-page, browser-only web app for analyzing which delivery vans in a fleet should be replaced with electric vehicles. Users upload van register (`vans.csv`) and trip history (`trips.csv`), configure analysis parameters (diesel models, EV options, financing, charging infrastructure, range requirements), and the app computes a prioritized shortlist recommending which vans to electrify.

**Screen 1 — Parameters Form** pre-fills all fields with documented defaults: diesel models (fuel use, payload), EV models (range, payload, price, lease terms), maintenance costs, electricity tariffs (night/day), grant settings (30% of purchase, max 10 EVs), charging infrastructure (North chargers, South re-basing cap), range rule (95th percentile, 60% usable WLTP, midday top-up optional), financing (5-year horizon, lease exit fee, 12-month window), and exclusions (refrigerated vans). The analyst can edit any parameter, upload cleaned CSV files, and save/load settings as JSON.

**Screen 2 — Results** displays a data quality report (rows read, duplicates removed, aliases remapped, distances repaired), check figures (vans assessed, trips counted, total km), a per-van table for all vans showing depot/ownership/lease end/P95 day km/max load/eligibility per EV model/best model/status/exclusion reason, a prioritized shortlist with rank/van/EV model/depot/savings, assumptions (human-readable rules), and download buttons for `shortlist.csv`, `summary.csv`, `assumptions.md`, `settings.json`.

The calculation engine implements all business rules: trip data cleaning (deduplication, alias remapping via ID table, odometer repair with GPS fallback), van metrics (P95 percentile daily km from summed multi-route days, max load, annual km annualized from export weeks), eligibility checks (refrigeration exclusion, range fit at 60% WLTP, payload fit, depot constraints with South re-basing to North), financial analysis (diesel fuel vs. night-tariff EV charging, 5-year total cost: savings minus EV purchase net of 30% grant minus diesel lease exit fee), and shortlist optimization enforcing caps (10 grant-eligible, 10 charging points, 3 South rebasing). All CSV output has no thousands separators, dot decimals, proper column order, and quoted text fields containing commas.

No network requests; all parsing and computation happens client-side, and uploaded data never leaves the browser.

## Tech Stack

- **Frontend**: Vite + TypeScript, browser-only (no backend, all client-side)
- **Build**: Static HTML/CSS/JavaScript output (dist/client)
- **CSV Parsing**: PapaParse 5.x
- **Testing**: Jest with TypeScript (ts-jest)
- **Code Quality**: TypeScript, ESLint
- **Deployment**: Static hosting (any CDN, GitHub Pages, Render, etc.)

## Quick Start

### Development

```bash
npm install
npm run dev
```

Open http://localhost:3000. The app runs entirely in the browser — there is no backend server.

### Production Build

```bash
npm run build
```

This produces static files in `dist/client/`. Deploy to any static host (GitHub Pages, Netlify, Vercel, S3, Render, etc.).

## Development

```bash
npm run dev        # Start Vite dev server at localhost:3000
npm run build      # Build static site to dist/client/
npm run preview    # Preview production build locally
npm run typecheck  # Check types without emitting (tsc --noEmit)
npm run lint       # Run ESLint
npm test           # Run Jest tests
```

All three checks are required before merging: `npm run lint`, `npm run typecheck`, `npm test`. GitHub Actions runs them on every pull request and every push to `main`.

### Running Tests

The engine is fully unit-tested. Tests use sample fixtures (`test/fixtures/vans.csv` and `test/fixtures/trips.csv` from the public reference repo).

```bash
npm test
```

Tests verify: duplicate removal, ID remapping, odometer repair, daily summation, percentile calculation, lease exit fee logic, cap enforcement, and CSV formatting (no thousands separators, dot decimals, correct column order). With sample data, check figures must be: `vans_assessed=38`, `trips_counted=2777`, `total_km=344952`. Refrigerated vans (P-03, P-07, P-19, P-23, P-34, P-35) must never be eligible.

## Deployment

The static build (`npm run build` → `dist/client/`) can be hosted anywhere:

- **GitHub Pages**: Push `dist/client/` to `gh-pages` branch
- **Netlify**: Connect repo, set build command `npm run build`, publish directory `dist/client`
- **Vercel**: Connect repo, it auto-detects Vite
- **Render**: Create Static Site service, build command `npm run build`, publish directory `dist/client`
- **Any CDN or web server**: Copy contents of `dist/client/` to your static host

No backend needed — the app runs entirely in the browser with no server-side dependencies.
