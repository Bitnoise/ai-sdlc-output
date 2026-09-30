# Which Vans Go Electric?

A single-page, browser-only web app for analyzing which delivery vans in a fleet should be replaced with electric vehicles.

## How the application works

The application is a single-page, browser-only web app for analyzing which delivery vans in a fleet should be replaced with electric vehicles. Users upload van register (`vans.csv`) and trip history (`trips.csv`), configure analysis parameters, and the app computes a prioritized shortlist recommending which vans to electrify.

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

**Screen 2 — Results** (not yet implemented) will display data quality report, check figures, per-van metrics, shortlist, assumptions, and downloads.

The calculation engine implements all business rules: trip data cleaning (deduplication, alias remapping, odometer repair with GPS fallback), van metrics (P95 percentile daily km from summed multi-route days, max load, annualized km), eligibility checks (refrigeration exclusion, range fit, payload fit, depot constraints), financial analysis (5-year operating saving minus EV net cost minus diesel lease exit fee), and shortlist optimization enforcing caps (10 grant, 10 charging points, 3 South rebasing).

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
