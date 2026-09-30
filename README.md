# Which Vans Go Electric?

A single-page, browser-only web app for analyzing which delivery vans in a fleet should be replaced with electric vehicles.

## How the application works

The application is a single-page, browser-only web app for analyzing which delivery vans in a fleet should be replaced with electric vehicles.

**Serving:** the deployed service is a small static server. `GET /` returns the built single-page app (`dist/client/index.html`, titled "Which Vans Go Electric?") and its assets; `/health` and `/version` exist only for the deploy workflow. The page shows the "Which Vans Go Electric?" heading straight from the server HTML; the browser script then renders Screen 1. The server never receives uploaded files or results.

**User Workflow:**
1. User opens the app and sees Screen 1 — a parameters form with all fields pre-filled with documented defaults (e.g. diesel price 5.20 PLN/L, Volta Cargo S and Volta Cargo L rows) and the `vans.csv` / `trips.csv` upload inputs, with Run disabled
2. User uploads van register (`vans.csv`) and trip history (`trips.csv`); the app validates CSV headers and shows clear errors if columns are missing or data is unparseable
3. Run button is enabled only when both files are valid and uploaded
4. User clicks Run, which:
   - Parses CSVs with PapaParse (header: true, skipEmptyLines: true)
   - Applies van ID alias table to remap trip van_ids before validation (e.g., P-17 → P-17B)
   - Cleans trip data: deduplicates exact row matches, repairs distances (uses odometer_km if valid, falls back to gps_km, drops row if both invalid)
   - Calls the calculation engine (analyzeFleet) with all parameters from the form
   - Navigates to Screen 2 with results
5. User can modify parameters and re-run analysis, or download results and assumptions

**Screen 1 — Parameters Form** pre-fills all fields with documented defaults from business rules:
- **Diesel Models** table: Model names, fuel consumption (L/100 km), payload (kg); default diesel price 5.20 PLN/L and maintenance 0.34 PLN/km.
- **EV Models** table: Model names, WLTP range (km), payload (kg), energy consumption (kWh/100 km), purchase price, monthly lease, lease term (months); defaults Volta Cargo S and L.
- **Costs & Tariffs**: EV maintenance (0.14 PLN/km), night tariff (0.58 PLN/kWh), day tariff (0.92 PLN/kWh).
- **Charging Infrastructure**: North charging points (10), South charging points (0), max South vans re-based to North (3).
- **Range Rule**: 95th percentile, usable WLTP share 60%, midday top-up off by default.
- **Financing**: 5-year evaluation horizon, grant 30% of purchase (max 10 EVs), lease exit fee 3 months, "lease ends soon" 12-month window, analysis date (today by default).
- **Exclusions & Data Cleaning**: Toggle to exclude refrigerated vans, export length in weeks (auto-derived, default 13), van ID alias table for remapping (default P-17 → P-17B).
- **File Uploads**: Validate `vans.csv` and `trips.csv` headers and types; show clear errors for missing columns, unparseable numbers, and unknown van IDs in trips. Run button disabled until both files valid.
- **Settings**: Save all parameters as JSON; load JSON to restore parameters for next quarter's analysis.

**Screen 2 — Results** displays the analysis output:
- **Data Quality Report**: Shows rows read, exact duplicates removed, IDs remapped by alias, distances repaired (odometer → GPS fallbacks), invalid rows removed, and unknown van IDs encountered.
- **Check Figures**: Vans assessed, trips counted (after deduplication and cleaning), total kilometers traveled.
- **Per-Van Analysis Table**: All vans with metrics (depot, refrigerated flag, owned/leased, lease end date, P95 daily km, max single day, max load carried, annualized km), EV model eligibility (Yes/No for each model), best EV model, and status (shortlisted with rank / excluded with reason).
- **Shortlist Table**: Ranked recommendations (1 to N) showing van ID, EV model, EV depot (North or South after any re-basing), P95 daily km, annual km, annual fuel saving in PLN, 5-year total saving in PLN, and one-line reason (e.g., "Owned North van, P95 145 km fits 60% of Volta Cargo S range, saves 21,710 PLN").
- **Assumptions List**: Human-readable summary of all parameters and business rules applied to the analysis (diesel price, EV models, maintenance costs, electricity tariffs, grant cap, charging infrastructure, range rule, financing horizon, lease exit fees, exclusions, analysis date, annualization method, odometer preference).
- **Downloads**: Buttons to download `shortlist.csv` (CSV with correct formatting: UTF-8, comma delimiter, dot decimals, no thousands separators), `summary.csv` (figure/value pairs), `assumptions.md`, `settings.json` (parameters for next quarter), and optional `per-van.csv` (all vans with metrics).
- **Back to Parameters**: Button to return to Screen 1, preserving parameters and allowing re-runs with different data or settings.

**Calculation Engine** (all client-side, no backend calls):
The engine implements all business rules in pure TypeScript: trip data cleaning (deduplication, alias remapping, odometer repair with GPS fallback), van metrics (P95 percentile daily km from summed multi-route days, max load, annualized km), eligibility checks (refrigeration exclusion, range fit, payload fit, depot constraints), financial analysis (5-year operating saving minus EV net cost minus diesel lease exit fee), and shortlist optimization enforcing caps (10 grant, 10 charging points, 3 South rebasing).

**Data Privacy**: No network requests; all parsing and computation happens client-side, and uploaded data never leaves the browser.

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
- **Render (current production)**: the `Dockerfile` builds the app (`tsc` + `vite build`) and runs `node dist/server.js`, an Express server that serves `dist/client` at `/` plus `/health` and `/version` for the deploy workflow. Set `CLIENT_DIR` to serve the client from another directory.
- **Any CDN or web server**: Copy contents of `dist/client/` to your static host

No backend logic is needed — the server only hands out static files; the app runs entirely in the browser.
