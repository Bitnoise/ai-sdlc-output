# Which Vans Go Electric?

A single-page, browser-only web app for analyzing which delivery vans in a fleet should be replaced with electric vehicles.

## How the application works

The application is a single-page, browser-only web app for analyzing which delivery vans in a fleet should be replaced with electric vehicles.

**Serving:** the deployed service is a small static server. `GET /` returns the built single-page app (`dist/client/index.html`, titled "Which Vans Go Electric?") and its assets; `/health` and `/version` exist only for the deploy workflow. The page shows the "Which Vans Go Electric?" heading and the footer line "Every van is checked against every EV model for range, payload and 5-year saving." straight from the server HTML; the browser script then renders Screen 1 above the footer. The server never receives uploaded files or results.

**User Workflow:**
1. User opens the app and sees Screen 1 — a parameters form with all fields pre-filled with documented defaults (e.g. diesel price 5.20 PLN/L, Volta Cargo S and Volta Cargo L rows) and the `vans.csv` / `trips.csv` upload inputs, with Run disabled
2. User uploads van register (`vans.csv`) and trip history (`trips.csv`); the app validates CSV headers and shows clear errors if columns are missing or data is unparseable
3. Run button is enabled only when both files are valid and uploaded
4. User clicks Run, which:
   - Parses CSVs with PapaParse (header: true, skipEmptyLines: true)
   - Applies van ID alias table to remap trip van_ids before validation (e.g., P-17 → P-17B); an alias applies only when its target is in the van register
   - Cleans trip data: deduplicates rows whose columns are all identical, uses odometer_km when it is a number above 0, otherwise falls back to gps_km (logged as a repair), and drops the row if both are unusable; a blank gps_km alone is fine
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
- **Data Quality Report**: Shows rows read, exact duplicates removed, number of rows remapped by alias, distances repaired (odometer → GPS fallbacks), invalid rows removed, and unknown van IDs encountered.
- **Check Figures**: Vans assessed, trips counted (after deduplication and cleaning), total kilometers traveled.
- **Per-Van Analysis Table**: All vans in register order with depot, refrigerated flag, owned/leased, lease end date, P95 daily km, max day km, max load carried and annualized km; then for each EV model three columns — "range OK", "payload OK" and "5-yr saving (PLN)"; then the best EV model, the status ("Shortlisted #rank" or "Excluded") and the exclusion reason. When midday top-up is on, a note above the table says "Midday top-up on: range checked per route, not per day".
- **Shortlist Table**: Ranked recommendations (1 to N) showing van ID, EV model, EV depot (North, including re-based South vans), range check km, annual km, annual fuel saving in PLN, 5-year total saving in PLN, and one-line reason (e.g., "Owned North van, P95 day 145 km fits 60% of Volta Cargo S range, saves 21,710 PLN over 5 years"; re-based vans read "South van re-based to North").
- **Assumptions List**: Human-readable summary of all parameters and business rules applied to the analysis (diesel price, EV models, maintenance costs, electricity tariffs, grant cap, charging infrastructure, range rule, financing horizon, lease exit fees, exclusions, analysis date, annualization method, odometer preference).
- **Downloads**: Buttons to download `shortlist.csv` (CSV with correct formatting: UTF-8, comma delimiter, dot decimals, no thousands separators), `summary.csv` (figure/value pairs), `assumptions.md`, `settings.json` (parameters for next quarter), and optional `per-van.csv` (all vans with metrics).
- **Back to Parameters**: Button to return to Screen 1, preserving parameters and allowing re-runs with different data or settings.

**Calculation Engine** (all client-side, no backend calls):
The engine (`src/engine.ts`) implements all business rules in pure TypeScript and takes one `AnalysisParams` object built from the form:
- **Metrics per van**: a day is the sum of all routes the van drove on that date; the range check uses the chosen percentile (default 95, linear interpolation like Excel PERCENTILE.INC) of daily km, 1 decimal. Annual km = total cleaned km ÷ export weeks × 52. Max load is the heaviest load in the export.
- **Every van × every EV model**: range OK when the range check km ≤ usable share (default 60%) × WLTP range; payload OK when max load ≤ the model's payload; 5-year saving = horizon × annual operating saving (diesel fuel + maintenance minus night-tariff charging + EV maintenance) − purchase price net of the grant − diesel lease exit fee. The best model is the one that passes range and payload with the highest saving.
- **Midday top-up**: off by default (both routes of a day must fit one overnight charge); when on, the range check uses the per-route percentile instead of the per-day one.
- **Lease exit fee**: 0 for owned vans and for leases ending within the "lease ends soon" window (default 12 months) after the analysis date; otherwise the multiplier (default 3) × the monthly diesel lease.
- **Status**: each van is either shortlisted with a rank or excluded with one reason — refrigerated (only when "Exclude refrigerated vans" is on), unknown diesel model, no trips, range (no model fits), payload (no model fitting the range carries the load), negative saving, or a cap (South cap, grant cap, charger cap).
- **Shortlist**: vans with a positive saving, sorted by saving (ties: higher annual km, then van ID), taken in order while caps allow: grant cap (10 EVs), charging points per depot (North 10), and South vans. While South has no charging points, South vans are re-based to North (they keep their routes) and at most 3 of them are taken.

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

The engine is fully unit-tested. Tests use the fixtures `test/fixtures/vans.csv` (38-van register) and `test/fixtures/trips.csv`, plus small synthetic fleets for single rules.

```bash
npm test
```

Tests verify: duplicate removal, alias remapping, odometer repair, summing two routes into one day, percentile calculation, midday top-up (per-route range check), lease exit fee window, exclusion codes, cap enforcement (grant, charger, South), and CSV formatting (no thousands separators, dot decimals, correct column order, quoting). The acceptance check figures for the full sample export (`vans_assessed=38`, `trips_counted=2777`, `total_km=344952`, 222 duplicates) are asserted when `test/fixtures/trips.csv` holds that full export (2999 data rows); the fixture committed now is a shorter excerpt, so that test is skipped. Refrigerated vans (P-03, P-07, P-19, P-23, P-34, P-35) are never shortlisted.

## Deployment

The static build (`npm run build` → `dist/client/`) can be hosted anywhere:

- **GitHub Pages**: Push `dist/client/` to `gh-pages` branch
- **Netlify**: Connect repo, set build command `npm run build`, publish directory `dist/client`
- **Vercel**: Connect repo, it auto-detects Vite
- **Render (current production)**: the `Dockerfile` builds the app (`tsc` + `vite build`) and runs `node dist/server.js`, an Express server that serves `dist/client` at `/` plus `/health` and `/version` for the deploy workflow. Set `CLIENT_DIR` to serve the client from another directory.
- **Any CDN or web server**: Copy contents of `dist/client/` to your static host

No backend logic is needed — the server only hands out static files; the app runs entirely in the browser.
