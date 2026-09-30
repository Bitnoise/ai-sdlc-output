# Which Vans Go Electric?

A single-page, browser-only web app for analyzing which delivery vans in a fleet should be replaced with electric vehicles.

## How the application works

The application is a single-page, browser-only web app for analyzing which delivery vans in a fleet should be replaced with electric vehicles.

**Serving:** the deployed service is a small static server. `GET /` returns the built single-page app (`dist/client/index.html`, titled "Which Vans Go Electric?") and its assets; `/health` and `/version` exist only for the deploy workflow. The page shows the "Which Vans Go Electric?" heading and two footer lines — "Every van is checked against every EV model for range, payload and 5-year saving." and "Results include a data quality report, check figures, the shortlist, assumptions and CSV downloads." — straight from the server HTML; the browser script then renders Screen 1 above the footer. The server never receives uploaded files or results.

**User Workflow:**
1. User opens the app and sees Screen 1 — a parameters form with all fields pre-filled with documented defaults (e.g. diesel price 5.20 PLN/L, Volta Cargo S and Volta Cargo L rows) and the `vans.csv` / `trips.csv` upload inputs, with Run disabled
2. User uploads van register (`vans.csv`) and trip history (`trips.csv`); the app validates CSV headers and shows clear errors if columns are missing or data is unparseable. After `trips.csv` is accepted, the export length in weeks is auto-derived from the first and last trip date, rounded up to whole weeks (13 for the sample export), with the hint "auto-derived from trip dates"; the user can still edit it
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
- **Settings**: Save all parameters as `settings.json`; load it to restore parameters for next quarter's analysis. A file that is not valid settings JSON shows an error and leaves the form unchanged.

**Screen 2 — Results** displays the analysis output. Everything on it, and every download, uses the parameters in effect when Run was clicked:
- **Data Quality Report**: rows read, exact duplicates removed, rows remapped by alias (with the alias pairs), distances repaired (count plus line / van / date / raw odometer → GPS km for each), blank `gps_km` (rows kept), rows dropped (count plus line and reason for each), unknown van IDs, and the export length in weeks.
- **Check Figures**: Vans assessed, trips counted (after deduplication and cleaning), total km — plain integers without thousands separators (38 / 2777 / 344952 for the full sample export).
- **Per-Van Analysis Table**: All vans in register order with depot, refrigerated flag, owned/leased, lease end date, P95 daily km, max day km, max load carried and annualized km; then for each EV model three columns — "range OK", "payload OK" and "5-yr saving (PLN)"; then the best EV model, the status ("Shortlisted #rank" or "Excluded") and the exclusion reason. When midday top-up is on, a note above the table says "Midday top-up on: range checked per route, not per day".
- **Shortlist Table**: Ranked recommendations (1 to N) showing van ID, EV model, EV depot (North, including re-based South vans), range check km, annual km, annual fuel saving in PLN, 5-year total saving in PLN, and one-line reason (e.g., "Owned North van, P95 day 145 km fits 60% of Volta Cargo S range, saves 21,710 PLN over 5 years"; re-based vans read "South van re-based to North"). A totals row gives the number of recommended vans, the summed annual fuel saving and the summed horizon saving; an empty shortlist reads "No van qualifies".
- **Assumptions List**: one human-readable line per business rule, generated from the run's parameters (cleaning, alias pairs, odometer/GPS rule, what a day is or "Midday top-up allowed: range checked per route, not per day", percentile, annualisation weeks, refrigerated toggle, usable WLTP share, depot and charging caps, costs and tariffs, grant share and cap, lease exit fee and window with the analysis date, horizon, shortlist order), plus the extra assumptions (grant for re-based South vans, leased EVs never proposed, double-route days summed, odometer over GPS, summer export 15 Jun–13 Sep with no seasonal uplift, vans keep their routes) and the open questions for Ewa.
- **Downloads**: `shortlist.csv` (UTF-8, comma delimiter, dot decimals, no thousands separators, text with commas quoted), `summary.csv` (`figure,value` rows in order vans_assessed, trips_counted, total_km, recommended_count, annual_fuel_saving_pln, saving_pln, saving_basis; saving_basis states the horizon and grant %), `assumptions.md` (the assumptions list as `# Assumptions` bullets), `settings.json` (parameters of the run, loadable next quarter) and `per-van.csv` (all vans with metrics, per-model checks, status and reason).
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

## Analyst guide

### Run or build the app

- Local: `npm install`, then `npm run dev` and open http://localhost:3000.
- Static build: `npm run build`, then host the contents of `dist/client/` on any static host (or open the production URL). No data is sent anywhere.

### Rerun next quarter

1. Open the app and click **Load Settings**; pick the `settings.json` saved from the last run.
2. Upload the new `vans.csv` and `trips.csv` (same columns as the sample files). Fix any upload errors — missing columns, unusable distances, or van IDs that are neither in the register nor covered by an alias. A renamed plate needs a new row in the **Van ID Aliases** table.
3. Check **Export Length (weeks)**: it is re-derived from the new trip dates; correct it if the export has gaps at the start or end.
4. Check the **Analysis Date** (loaded settings keep the old date) and any changed prices or offers.
5. Click **Run Analysis**. Read the data quality report first (duplicates, alias remaps, repaired distances, dropped rows, unknown IDs), then the check figures.
6. Download `shortlist.csv`, `summary.csv`, `assumptions.md`, `settings.json` (and `per-van.csv` if needed).

### Parameters

| Parameter | Meaning | Default |
|---|---|---|
| Diesel price | PLN per litre of diesel | 5.20 |
| Diesel models | fuel use L/100 km and rated payload per diesel model in `vans.csv` | Brona D35 9.6/1150, Brona D35 Long 10.9/1050, Kestrel Cargo 3.5 11.8/1300 |
| Maintenance (diesel / EV) | PLN per km | 0.34 / 0.14 |
| EV models | WLTP range, payload, energy kWh/100 km, purchase price, monthly lease, lease months | Volta Cargo S 260/1050/24/150000/2900/60, Volta Cargo L 380/880/27/195000/3770/60 |
| Night / day tariff | PLN per kWh; charging is overnight at the night tariff | 0.58 / 0.92 |
| North / South charging points | one EV per point, overnight only | 10 / 0 |
| Max South vans re-based to North | South vans may go electric only by re-basing at North | 3 |
| Percentile | percentile of daily km used as the range check | 95 |
| Usable WLTP share | share of WLTP range the range check must fit in | 60% |
| Midday top-up | when on, each route is checked instead of the day total | off |
| Evaluation horizon | years of operating saving counted | 5 |
| Grant % / grant max | grant on the EV purchase price; max number of EVs with a grant | 30% / 10 |
| Lease exit fee multiplier | months of diesel lease paid to leave a lease early | 3 |
| "Lease ends soon" window | leases ending within this many months after the analysis date pay no exit fee | 12 |
| Analysis date | reference date for the lease window | today |
| Exclude refrigerated vans | fridge vans are out for year 1 | on |
| Export length (weeks) | used to annualise km (total km / weeks × 52) | derived from trip dates (13 for the sample) |
| Van ID aliases | trip van IDs remapped to register IDs | P-17 → P-17B |

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

Tests verify: duplicate removal, alias remapping, odometer repair, summing two routes into one day, percentile calculation, midday top-up (per-route range check), lease exit fee window, exclusion codes, cap enforcement (grant, charger, South), CSV formatting (no thousands separators, dot decimals, correct column order, quoting, summary row order and saving_basis), export weeks derivation, and assumptions generated from changed parameters. The acceptance check figures for the full sample export (`vans_assessed=38`, `trips_counted=2777`, `total_km=344952`, 222 duplicates, 13 export weeks) are asserted when `test/fixtures/trips.csv` holds that full export (2999 data rows); the fixture committed now is a shorter excerpt (124 rows), so those two tests are skipped. Refrigerated vans (P-03, P-07, P-19, P-23, P-34, P-35) are never shortlisted.

## Deployment

The static build (`npm run build` → `dist/client/`) can be hosted anywhere:

- **GitHub Pages**: Push `dist/client/` to `gh-pages` branch
- **Netlify**: Connect repo, set build command `npm run build`, publish directory `dist/client`
- **Vercel**: Connect repo, it auto-detects Vite
- **Render (current production)**: the `Dockerfile` builds the app (`tsc` + `vite build`) and runs `node dist/server.js`, an Express server that serves `dist/client` at `/` plus `/health` and `/version` for the deploy workflow. Set `CLIENT_DIR` to serve the client from another directory.
- **Any CDN or web server**: Copy contents of `dist/client/` to your static host

No backend logic is needed — the server only hands out static files; the app runs entirely in the browser.
