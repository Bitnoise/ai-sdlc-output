import { analyzeFleet, cleanTrips, deriveExportWeeks, formatCsvValue, generateAssumptions, generateAssumptionsMd, rangeCheckKm, usableKm, type AnalysisParams, type RangeRule, type DieselModel, type EVModel, type AnalysisResult, type CleaningResult, type Van, generateShortlistCsv, generateSummaryCsv } from './engine';
import { combineTripFiles, findUnknownVanIds, missingColumns, normalizedTripsCsv, normalizedVansCsv, normalizeHeaders, REQUIRED_TRIP_COLUMNS, REQUIRED_VAN_COLUMNS, TRIP_HEADER_ALIASES, tripDateSpan, VAN_HEADER_ALIASES, type HeaderRename, type TripSource } from './ingest';
import { classifyImpact, defaultLunchCutoff, generateImpactCsv, parsePreviousShortlist, runImpactScenarios, type ImpactRow } from './impact';
import Papa from 'papaparse';

interface AppState {
  dieselModels: DieselModel[];
  evModels: EVModel[];
  dieselPricePln: number;
  dieselMaintenancePln: number;
  evMaintenancePln: number;
  nightTariffPln: number;
  dayTariffPln: number;
  grantPercentage: number;
  grantMaxCount: number;
  chargingPointsNorth: number;
  chargingPointsSouth: number;
  maxSouthRebase: number;
  rangeRule: RangeRule;
  rangePercentile: number;
  usableWltpShare: number;
  midDayTopup: boolean;
  evaluationYears: number;
  leaseExitFeeMonths: number;
  leaseWindowMonths: number;
  analysisDate: string;
  excludeRefrigerated: boolean;
  aliasList: Array<{ from: string; to: string }>;
  exportWeeks: number;
  analysisResult: AnalysisResult | null;
  cleaningResult: CleaningResult | null;
  lastParams: AnalysisParams | null;
  lastSettings: ReturnType<typeof buildSettings> | null;
}

interface UploadError {
  file: string;
  error: string;
}

interface ParsedRow {
  [key: string]: unknown;
}

/** One uploaded CSV after header mapping; parseError is set when PapaParse failed. */
interface UploadedCsv {
  name: string;
  rows: ParsedRow[];
  renamed: HeaderRename[];
  parseError?: string;
}

/** What Screen 2 needs from the uploads used for the run. */
interface RunInputs {
  vans: UploadedCsv;
  tripFiles: UploadedCsv[];
  combinedTrips: ParsedRow[];
  sources: TripSource[];
  vanList: Van[];
  vanIds: Set<string>;
  aliasMap: Map<string, string>;
}

const DEFAULT_STATE: AppState = {
  dieselModels: [
    { name: 'Brona D35', fuelUseLper100km: 9.6, payloadKg: 1150 },
    { name: 'Brona D35 Long', fuelUseLper100km: 10.9, payloadKg: 1050 },
    { name: 'Kestrel Cargo 3.5', fuelUseLper100km: 11.8, payloadKg: 1300 },
  ],
  evModels: [
    { name: 'Volta Cargo S', wltpRangeKm: 260, payloadKg: 1050, energyKwhPer100km: 24, purchasePricePln: 150000, monthlyLeasePln: 2900, leaseMonths: 60 },
    { name: 'Volta Cargo L', wltpRangeKm: 380, payloadKg: 880, energyKwhPer100km: 27, purchasePricePln: 195000, monthlyLeasePln: 3770, leaseMonths: 60 },
  ],
  dieselPricePln: 5.2,
  dieselMaintenancePln: 0.34,
  evMaintenancePln: 0.14,
  nightTariffPln: 0.58,
  dayTariffPln: 0.92,
  grantPercentage: 30,
  grantMaxCount: 10,
  chargingPointsNorth: 10,
  chargingPointsSouth: 0,
  maxSouthRebase: 3,
  rangeRule: 'worst_day',
  rangePercentile: 95,
  usableWltpShare: 60,
  midDayTopup: false,
  evaluationYears: 5,
  leaseExitFeeMonths: 3,
  leaseWindowMonths: 12,
  analysisDate: new Date().toISOString().split('T')[0],
  excludeRefrigerated: true,
  aliasList: [{ from: 'P-17', to: 'P-17B' }],
  exportWeeks: 13,
  analysisResult: null,
  cleaningResult: null,
  lastParams: null,
  lastSettings: null,
};

const appState: AppState = JSON.parse(JSON.stringify(DEFAULT_STATE));
let uploadErrors: UploadError[] = [];
// The latest van register replaces earlier ones; trip files accumulate and are combined.
let vansUpload: UploadedCsv | null = null;
let tripFiles: UploadedCsv[] = [];
let lastRunInputs: RunInputs | null = null;
let exportWeeksAutoDerived = false;
let settingsError = '';
// The lunch shortlist to compare against; kept across reruns and Back.
let previousShortlist: { name: string; vanIds: string[] } | null = null;
let impactCutoff = '';
let impactCutoffEdited = false;
let impactError = '';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Engine parameters from the form (percent fields become 0-1 shares). */
function buildParams(): AnalysisParams {
  return {
    dieselModels: appState.dieselModels.map((m) => ({ ...m })),
    evModels: appState.evModels.map((m) => ({ ...m })),
    dieselPricePln: appState.dieselPricePln,
    dieselMaintenancePln: appState.dieselMaintenancePln,
    evMaintenancePln: appState.evMaintenancePln,
    nightTariffPln: appState.nightTariffPln,
    grantShare: appState.grantPercentage / 100,
    grantCap: appState.grantMaxCount,
    chargingPointsNorth: appState.chargingPointsNorth,
    chargingPointsSouth: appState.chargingPointsSouth,
    southRebaseCap: appState.maxSouthRebase,
    rangeRule: appState.rangeRule,
    rangePercentile: appState.rangePercentile,
    usableWltpShare: appState.usableWltpShare / 100,
    middayTopup: appState.midDayTopup,
    evaluationYears: appState.evaluationYears,
    leaseExitFeeMonths: appState.leaseExitFeeMonths,
    leaseWindowMonths: appState.leaseWindowMonths,
    analysisDate: appState.analysisDate,
    excludeRefrigerated: appState.excludeRefrigerated,
    exportWeeks: appState.exportWeeks,
    aliasList: appState.aliasList.map((a) => ({ ...a })),
  };
}

/** The settings.json document: every form field, in form units. */
function buildSettings() {
  return {
    dieselModels: appState.dieselModels.map((m) => ({ ...m })),
    evModels: appState.evModels.map((m) => ({ ...m })),
    dieselPricePln: appState.dieselPricePln,
    dieselMaintenancePln: appState.dieselMaintenancePln,
    evMaintenancePln: appState.evMaintenancePln,
    nightTariffPln: appState.nightTariffPln,
    dayTariffPln: appState.dayTariffPln,
    grantPercentage: appState.grantPercentage,
    grantMaxCount: appState.grantMaxCount,
    chargingPointsNorth: appState.chargingPointsNorth,
    chargingPointsSouth: appState.chargingPointsSouth,
    maxSouthRebase: appState.maxSouthRebase,
    rangeRule: appState.rangeRule,
    rangePercentile: appState.rangePercentile,
    usableWltpShare: appState.usableWltpShare,
    midDayTopup: appState.midDayTopup,
    evaluationYears: appState.evaluationYears,
    leaseExitFeeMonths: appState.leaseExitFeeMonths,
    leaseWindowMonths: appState.leaseWindowMonths,
    analysisDate: appState.analysisDate,
    excludeRefrigerated: appState.excludeRefrigerated,
    aliasList: appState.aliasList.map((a) => ({ ...a })),
    exportWeeks: appState.exportWeeks,
  };
}

/** Parses a CSV and maps vendor headers to the form's column names before any check. */
function parseCsv(file: File, aliases: Record<string, string>): Promise<UploadedCsv> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: { data: ParsedRow[] }) => {
        const { rows, renamed } = normalizeHeaders(results.data, aliases);
        resolve({ name: file.name, rows, renamed });
      },
      error: (error: { message: string }) => {
        resolve({ name: file.name, rows: [], renamed: [], parseError: error.message });
      },
    });
  });
}

function aliasMapFromForm(): Map<string, string> {
  return new Map(appState.aliasList.map((a) => [a.from.trim(), a.to.trim()]));
}

function registerVanIds(vans: UploadedCsv): Set<string> {
  return new Set(vans.rows.map((v) => String(v.van_id ?? '').trim()));
}

/**
 * Rebuilds the upload errors: van columns first, then trip columns per file, then distances.
 * Unknown van IDs are checked only once the register loaded with all its columns.
 */
function validateUploads(): void {
  const errors: UploadError[] = [];

  let vanIds: Set<string> | null = null;
  if (vansUpload) {
    const problems = vansUpload.parseError
      ? [vansUpload.parseError]
      : vansUpload.rows.length === 0
        ? ['No data rows found']
        : missingColumns(vansUpload.rows, REQUIRED_VAN_COLUMNS).map((c) => `Missing column: ${c}`);
    if (problems.length > 0) {
      errors.push({ file: vansUpload.name, error: problems.join('; ') });
    } else {
      vanIds = registerVanIds(vansUpload);
    }
  }

  const aliasMap = aliasMapFromForm();
  for (const tripFile of tripFiles) {
    const problems: string[] = [];
    if (tripFile.parseError) {
      problems.push(tripFile.parseError);
    } else if (tripFile.rows.length === 0) {
      problems.push('No data rows found');
    } else {
      problems.push(...missingColumns(tripFile.rows, REQUIRED_TRIP_COLUMNS).map((c) => `Missing column: ${c}`));
      if (problems.length === 0) {
        // Same rule as the engine: odometer if > 0, else GPS as fallback.
        tripFile.rows.forEach((row, i) => {
          if (usableKm(row.odometer_km) === null && usableKm(row.gps_km) === null) {
            problems.push(`Row ${i + 2}: both odometer_km and gps_km are invalid or missing`);
          }
        });
        if (vanIds) {
          const unknown = findUnknownVanIds(tripFile.rows, vanIds, aliasMap);
          if (unknown.length > 0) problems.push(`Unknown van IDs in trips: ${unknown.join(', ')}`);
        }
      }
    }
    if (problems.length > 0) errors.push({ file: tripFile.name, error: problems.join('; ') });
  }

  uploadErrors = errors;
}

/** Export weeks follow the combined date span of all trip files. */
function deriveWeeksFromTripFiles(): void {
  const weeks = deriveExportWeeks(tripFiles.flatMap((f) => f.rows));
  if (weeks > 0) {
    appState.exportWeeks = weeks;
    exportWeeksAutoDerived = true;
  }
}

/** The lunch cutoff follows the trip files until the user edits it. */
function updateImpactCutoff(): void {
  if (!impactCutoffEdited) impactCutoff = defaultLunchCutoff(tripFiles);
}

function areFilesValid(): boolean {
  return vansUpload !== null && tripFiles.length > 0 && uploadErrors.length === 0;
}

function renderForm(): void {
  const app = document.getElementById('app');
  if (!app) return;

  const errorsHtml = uploadErrors.map(e => `<div class="error-message">${escapeHtml(e.file)}: ${escapeHtml(e.error)}</div>`).join('');

  app.innerHTML = `
    <div class="container">
      <div class="header">
        <h1>Which Vans Go Electric?</h1>
        <p class="subtitle">EV fleet analysis</p>
      </div>

      <form id="parametersForm" class="form">
        <!-- Diesel Models Section -->
        <section class="form-section">
          <h2>Diesel Models</h2>
          <div class="subsection">
            <label>Diesel price (PLN/L):</label>
            <input type="number" id="dieselPrice" step="0.01" value="${appState.dieselPricePln}" />
          </div>
          <div class="subsection">
            <label>Maintenance (PLN/km):</label>
            <input type="number" id="dieselMaintenance" step="0.01" value="${appState.dieselMaintenancePln}" />
          </div>
          <div class="table-container">
            <table id="dieselModelsTable" class="editable-table">
              <thead>
                <tr><th>Model Name</th><th>Fuel Use (L/100km)</th><th>Payload (kg)</th><th></th></tr>
              </thead>
              <tbody>
                ${appState.dieselModels.map((m, i) => `
                  <tr>
                    <td><input type="text" class="diesel-name" value="${m.name}" /></td>
                    <td><input type="number" class="diesel-fuel" step="0.1" value="${m.fuelUseLper100km}" /></td>
                    <td><input type="number" class="diesel-payload" step="1" value="${m.payloadKg}" /></td>
                    <td><button type="button" class="btn-remove" data-index="${i}">✕</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <button type="button" class="btn-secondary" id="addDieselBtn">Add Diesel Model</button>
        </section>

        <!-- EV Models Section -->
        <section class="form-section">
          <h2>EV Models</h2>
          <div class="table-container">
            <table id="evModelsTable" class="editable-table">
              <thead>
                <tr><th>Model Name</th><th>WLTP Range (km)</th><th>Payload (kg)</th><th>Energy (kWh/100km)</th><th>Purchase (PLN)</th><th>Monthly Lease (PLN)</th><th>Lease Months</th><th></th></tr>
              </thead>
              <tbody>
                ${appState.evModels.map((m, i) => `
                  <tr>
                    <td><input type="text" class="ev-name" value="${m.name}" /></td>
                    <td><input type="number" class="ev-range" step="1" value="${m.wltpRangeKm}" /></td>
                    <td><input type="number" class="ev-payload" step="1" value="${m.payloadKg}" /></td>
                    <td><input type="number" class="ev-energy" step="0.1" value="${m.energyKwhPer100km}" /></td>
                    <td><input type="number" class="ev-price" step="1" value="${m.purchasePricePln}" /></td>
                    <td><input type="number" class="ev-lease" step="1" value="${m.monthlyLeasePln}" /></td>
                    <td><input type="number" class="ev-months" step="1" value="${m.leaseMonths}" /></td>
                    <td><button type="button" class="btn-remove" data-index="${i}">✕</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <button type="button" class="btn-secondary" id="addEvBtn">Add EV Model</button>
        </section>

        <!-- Costs Section -->
        <section class="form-section">
          <h2>Costs & Tariffs</h2>
          <div class="form-row">
            <div class="form-col">
              <label>EV Maintenance (PLN/km):</label>
              <input type="number" id="evMaintenance" step="0.01" value="${appState.evMaintenancePln}" />
            </div>
            <div class="form-col">
              <label>Night Tariff (PLN/kWh):</label>
              <input type="number" id="nightTariff" step="0.01" value="${appState.nightTariffPln}" />
            </div>
            <div class="form-col">
              <label>Day Tariff (PLN/kWh):</label>
              <input type="number" id="dayTariff" step="0.01" value="${appState.dayTariffPln}" />
            </div>
          </div>
        </section>

        <!-- Charging Section -->
        <section class="form-section">
          <h2>Charging Infrastructure</h2>
          <div class="form-row">
            <div class="form-col">
              <label>North Charging Points:</label>
              <input type="number" id="chargingNorth" step="1" value="${appState.chargingPointsNorth}" />
            </div>
            <div class="form-col">
              <label>South Charging Points:</label>
              <input type="number" id="chargingSouth" step="1" value="${appState.chargingPointsSouth}" />
            </div>
            <div class="form-col">
              <label>Max South Vans Re-based to North:</label>
              <input type="number" id="maxSouthRebase" step="1" value="${appState.maxSouthRebase}" />
            </div>
          </div>
        </section>

        <!-- Range Rule Section -->
        <section class="form-section">
          <h2>Range Rule</h2>
          <p class="range-basis-note">Default: worst day in the data within 60% of WLTP range</p>
          <div class="form-row">
            <div class="form-col">
              <label>Range check:</label>
              <select id="rangeRule">
                <option value="worst_day" ${appState.rangeRule === 'worst_day' ? 'selected' : ''}>Worst day (Ops rule)</option>
                <option value="percentile" ${appState.rangeRule === 'percentile' ? 'selected' : ''}>Percentile (old rule)</option>
              </select>
            </div>
            <div class="form-col">
              <label>Percentile:</label>
              <input type="number" id="rangePercentile" step="1" value="${appState.rangePercentile}" ${appState.rangeRule === 'percentile' ? '' : 'disabled'} />
            </div>
            <div class="form-col">
              <label>Usable WLTP Share (%):</label>
              <input type="number" id="usableWltpShare" step="1" value="${appState.usableWltpShare}" />
            </div>
            <div class="form-col">
              <label>
                <input type="checkbox" id="midDayTopup" ${appState.midDayTopup ? 'checked' : ''} />
                Midday Top-up Allowed
              </label>
            </div>
          </div>
        </section>

        <!-- Financing Section -->
        <section class="form-section">
          <h2>Financing</h2>
          <div class="form-row">
            <div class="form-col">
              <label>Evaluation Horizon (years):</label>
              <input type="number" id="evaluationYears" step="1" value="${appState.evaluationYears}" />
            </div>
            <div class="form-col">
              <label>Grant (% of purchase):</label>
              <input type="number" id="grantPercentage" step="1" value="${appState.grantPercentage}" />
            </div>
            <div class="form-col">
              <label>Grant Max (count):</label>
              <input type="number" id="grantMaxCount" step="1" value="${appState.grantMaxCount}" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-col">
              <label>Lease Exit Fee Multiplier (months):</label>
              <input type="number" id="leaseExitFeeMonths" step="1" value="${appState.leaseExitFeeMonths}" />
            </div>
            <div class="form-col">
              <label>"Lease Ends Soon" Window (months):</label>
              <input type="number" id="leaseWindowMonths" step="1" value="${appState.leaseWindowMonths}" />
            </div>
            <div class="form-col">
              <label>Analysis Date:</label>
              <input type="date" id="analysisDate" value="${appState.analysisDate}" />
            </div>
          </div>
        </section>

        <!-- Exclusions & Settings Section -->
        <section class="form-section">
          <h2>Exclusions & Data Cleaning</h2>
          <div class="form-row">
            <div class="form-col">
              <label>
                <input type="checkbox" id="excludeRefrigerated" ${appState.excludeRefrigerated ? 'checked' : ''} />
                Exclude Refrigerated Vans
              </label>
            </div>
            <div class="form-col">
              <label>Export Length (weeks):</label>
              <input type="number" id="exportWeeks" step="1" value="${appState.exportWeeks}" />
              ${exportWeeksAutoDerived ? '<span class="field-hint">auto-derived from trip dates</span>' : ''}
            </div>
          </div>
          <div class="subsection">
            <h3>Van ID Aliases</h3>
            <div class="table-container">
              <table id="aliasTable" class="editable-table">
                <thead>
                  <tr><th>From</th><th>To</th><th></th></tr>
                </thead>
                <tbody>
                  ${appState.aliasList.map((a, i) => `
                    <tr>
                      <td><input type="text" class="alias-from" value="${a.from}" /></td>
                      <td><input type="text" class="alias-to" value="${a.to}" /></td>
                      <td><button type="button" class="btn-remove" data-index="${i}">✕</button></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            <button type="button" class="btn-secondary" id="addAliasBtn">Add Alias</button>
          </div>
        </section>

        <!-- File Upload Section -->
        <section class="form-section">
          <h2>Data Files</h2>
          <div class="form-row">
            <div class="form-col">
              <label>Upload vans.csv (van register):</label>
              <input type="file" id="vansUpload" accept=".csv" />
              ${vansUpload ? `<span class="file-ok">✓ ${escapeHtml(vansUpload.name)} (${vansUpload.rows.length} vans)</span>` : ''}
            </div>
            <div class="form-col">
              <label>Upload trips CSV(s):</label>
              <input type="file" id="tripsUpload" accept=".csv" multiple />
              ${tripFiles.map((f) => `<span class="file-ok">✓ ${escapeHtml(f.name)} (${f.rows.length} rows)</span>`).join('')}
              ${tripFiles.length > 0 ? '<button type="button" class="btn-secondary" id="clearTripsBtn">Clear trip files</button>' : ''}
            </div>
          </div>
          ${errorsHtml ? `<div class="errors">${errorsHtml}</div>` : ''}
        </section>

        <!-- Action Buttons -->
        <section class="form-section">
          ${settingsError ? `<div class="errors"><div class="error-message">${escapeHtml(settingsError)}</div></div>` : ''}
          <div class="button-group">
            <button type="button" class="btn-secondary" id="saveSettingsBtn">Save Settings</button>
            <button type="button" class="btn-secondary" id="loadSettingsBtn">Load Settings</button>
            <button type="submit" id="runBtn" class="btn-primary" ${!areFilesValid() ? 'disabled' : ''}>Run Analysis</button>
          </div>
        </section>
      </form>
    </div>
  `;

  attachEventListeners();
}

function attachEventListeners(): void {
  // Diesel price & maintenance
  document.getElementById('dieselPrice')?.addEventListener('change', (e) => {
    appState.dieselPricePln = parseFloat((e.target as HTMLInputElement).value);
  });
  document.getElementById('dieselMaintenance')?.addEventListener('change', (e) => {
    appState.dieselMaintenancePln = parseFloat((e.target as HTMLInputElement).value);
  });

  // EV maintenance & tariffs
  document.getElementById('evMaintenance')?.addEventListener('change', (e) => {
    appState.evMaintenancePln = parseFloat((e.target as HTMLInputElement).value);
  });
  document.getElementById('nightTariff')?.addEventListener('change', (e) => {
    appState.nightTariffPln = parseFloat((e.target as HTMLInputElement).value);
  });
  document.getElementById('dayTariff')?.addEventListener('change', (e) => {
    appState.dayTariffPln = parseFloat((e.target as HTMLInputElement).value);
  });

  // Charging
  document.getElementById('chargingNorth')?.addEventListener('change', (e) => {
    appState.chargingPointsNorth = parseInt((e.target as HTMLInputElement).value, 10);
  });
  document.getElementById('chargingSouth')?.addEventListener('change', (e) => {
    appState.chargingPointsSouth = parseInt((e.target as HTMLInputElement).value, 10);
  });
  document.getElementById('maxSouthRebase')?.addEventListener('change', (e) => {
    appState.maxSouthRebase = parseInt((e.target as HTMLInputElement).value, 10);
  });

  // Range rule
  document.getElementById('rangeRule')?.addEventListener('change', (e) => {
    appState.rangeRule = (e.target as HTMLSelectElement).value === 'percentile' ? 'percentile' : 'worst_day';
    const percentileInput = document.getElementById('rangePercentile') as HTMLInputElement | null;
    if (percentileInput) percentileInput.disabled = appState.rangeRule !== 'percentile';
  });
  document.getElementById('rangePercentile')?.addEventListener('change', (e) => {
    appState.rangePercentile = parseInt((e.target as HTMLInputElement).value, 10);
  });
  document.getElementById('usableWltpShare')?.addEventListener('change', (e) => {
    appState.usableWltpShare = parseInt((e.target as HTMLInputElement).value, 10);
  });
  document.getElementById('midDayTopup')?.addEventListener('change', (e) => {
    appState.midDayTopup = (e.target as HTMLInputElement).checked;
  });

  // Financing
  document.getElementById('evaluationYears')?.addEventListener('change', (e) => {
    appState.evaluationYears = parseInt((e.target as HTMLInputElement).value, 10);
  });
  document.getElementById('grantPercentage')?.addEventListener('change', (e) => {
    appState.grantPercentage = parseInt((e.target as HTMLInputElement).value, 10);
  });
  document.getElementById('grantMaxCount')?.addEventListener('change', (e) => {
    appState.grantMaxCount = parseInt((e.target as HTMLInputElement).value, 10);
  });
  document.getElementById('leaseExitFeeMonths')?.addEventListener('change', (e) => {
    appState.leaseExitFeeMonths = parseInt((e.target as HTMLInputElement).value, 10);
  });
  document.getElementById('leaseWindowMonths')?.addEventListener('change', (e) => {
    appState.leaseWindowMonths = parseInt((e.target as HTMLInputElement).value, 10);
  });
  document.getElementById('analysisDate')?.addEventListener('change', (e) => {
    appState.analysisDate = (e.target as HTMLInputElement).value;
  });

  // Exclusions
  document.getElementById('excludeRefrigerated')?.addEventListener('change', (e) => {
    appState.excludeRefrigerated = (e.target as HTMLInputElement).checked;
  });
  document.getElementById('exportWeeks')?.addEventListener('change', (e) => {
    appState.exportWeeks = parseInt((e.target as HTMLInputElement).value, 10);
    exportWeeksAutoDerived = false;
  });

  // Diesel models table
  const dieselTable = document.getElementById('dieselModelsTable');
  if (dieselTable) {
    const rows = dieselTable.querySelectorAll('tbody tr');
    rows.forEach((row, i) => {
      const nameInput = row.querySelector('.diesel-name') as HTMLInputElement;
      const fuelInput = row.querySelector('.diesel-fuel') as HTMLInputElement;
      const payloadInput = row.querySelector('.diesel-payload') as HTMLInputElement;
      const removeBtn = row.querySelector('.btn-remove') as HTMLButtonElement;

      nameInput?.addEventListener('change', (e) => {
        if (appState.dieselModels[i]) {
          appState.dieselModels[i].name = (e.target as HTMLInputElement).value;
        }
      });
      fuelInput?.addEventListener('change', (e) => {
        if (appState.dieselModels[i]) {
          appState.dieselModels[i].fuelUseLper100km = parseFloat((e.target as HTMLInputElement).value);
        }
      });
      payloadInput?.addEventListener('change', (e) => {
        if (appState.dieselModels[i]) {
          appState.dieselModels[i].payloadKg = parseInt((e.target as HTMLInputElement).value, 10);
        }
      });
      removeBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        appState.dieselModels.splice(i, 1);
        renderForm();
      });
    });
  }

  // EV models table
  const evTable = document.getElementById('evModelsTable');
  if (evTable) {
    const rows = evTable.querySelectorAll('tbody tr');
    rows.forEach((row, i) => {
      const nameInput = row.querySelector('.ev-name') as HTMLInputElement;
      const rangeInput = row.querySelector('.ev-range') as HTMLInputElement;
      const payloadInput = row.querySelector('.ev-payload') as HTMLInputElement;
      const energyInput = row.querySelector('.ev-energy') as HTMLInputElement;
      const priceInput = row.querySelector('.ev-price') as HTMLInputElement;
      const leaseInput = row.querySelector('.ev-lease') as HTMLInputElement;
      const monthsInput = row.querySelector('.ev-months') as HTMLInputElement;
      const removeBtn = row.querySelector('.btn-remove') as HTMLButtonElement;

      nameInput?.addEventListener('change', (e) => {
        if (appState.evModels[i]) {
          appState.evModels[i].name = (e.target as HTMLInputElement).value;
        }
      });
      rangeInput?.addEventListener('change', (e) => {
        if (appState.evModels[i]) {
          appState.evModels[i].wltpRangeKm = parseInt((e.target as HTMLInputElement).value, 10);
        }
      });
      payloadInput?.addEventListener('change', (e) => {
        if (appState.evModels[i]) {
          appState.evModels[i].payloadKg = parseInt((e.target as HTMLInputElement).value, 10);
        }
      });
      energyInput?.addEventListener('change', (e) => {
        if (appState.evModels[i]) {
          appState.evModels[i].energyKwhPer100km = parseFloat((e.target as HTMLInputElement).value);
        }
      });
      priceInput?.addEventListener('change', (e) => {
        if (appState.evModels[i]) {
          appState.evModels[i].purchasePricePln = parseInt((e.target as HTMLInputElement).value, 10);
        }
      });
      leaseInput?.addEventListener('change', (e) => {
        if (appState.evModels[i]) {
          appState.evModels[i].monthlyLeasePln = parseInt((e.target as HTMLInputElement).value, 10);
        }
      });
      monthsInput?.addEventListener('change', (e) => {
        if (appState.evModels[i]) {
          appState.evModels[i].leaseMonths = parseInt((e.target as HTMLInputElement).value, 10);
        }
      });
      removeBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        appState.evModels.splice(i, 1);
        renderForm();
      });
    });
  }

  // Alias table
  const aliasTable = document.getElementById('aliasTable');
  if (aliasTable) {
    const rows = aliasTable.querySelectorAll('tbody tr');
    rows.forEach((row, i) => {
      const fromInput = row.querySelector('.alias-from') as HTMLInputElement;
      const toInput = row.querySelector('.alias-to') as HTMLInputElement;
      const removeBtn = row.querySelector('.btn-remove') as HTMLButtonElement;

      // Aliases decide which trip van IDs are known, so the uploads are re-checked.
      fromInput?.addEventListener('change', (e) => {
        if (appState.aliasList[i]) {
          appState.aliasList[i].from = (e.target as HTMLInputElement).value;
          validateUploads();
          renderForm();
        }
      });
      toInput?.addEventListener('change', (e) => {
        if (appState.aliasList[i]) {
          appState.aliasList[i].to = (e.target as HTMLInputElement).value;
          validateUploads();
          renderForm();
        }
      });
      removeBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        appState.aliasList.splice(i, 1);
        validateUploads();
        renderForm();
      });
    });
  }

  // Add buttons
  document.getElementById('addDieselBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    appState.dieselModels.push({ name: 'New Model', fuelUseLper100km: 10, payloadKg: 1000 });
    renderForm();
  });

  document.getElementById('addEvBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    appState.evModels.push({ name: 'New EV', wltpRangeKm: 300, payloadKg: 1000, energyKwhPer100km: 25, purchasePricePln: 150000, monthlyLeasePln: 2900, leaseMonths: 60 });
    renderForm();
  });

  document.getElementById('addAliasBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    appState.aliasList.push({ from: '', to: '' });
    renderForm();
  });

  // File uploads
  document.getElementById('vansUpload')?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      vansUpload = await parseCsv(file, VAN_HEADER_ALIASES);
      validateUploads();
      renderForm();
    }
  });

  document.getElementById('tripsUpload')?.addEventListener('change', async (e) => {
    const files = Array.from((e.target as HTMLInputElement).files ?? []);
    if (files.length > 0) {
      for (const file of files) {
        const parsed = await parseCsv(file, TRIP_HEADER_ALIASES);
        // Re-selecting a file with the same name replaces it instead of adding it twice.
        const existing = tripFiles.findIndex((f) => f.name === parsed.name);
        if (existing >= 0) tripFiles[existing] = parsed;
        else tripFiles.push(parsed);
      }
      deriveWeeksFromTripFiles();
      updateImpactCutoff();
      validateUploads();
      renderForm();
    }
  });

  document.getElementById('clearTripsBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    tripFiles = [];
    exportWeeksAutoDerived = false;
    updateImpactCutoff();
    validateUploads();
    renderForm();
  });

  // Settings
  document.getElementById('saveSettingsBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    downloadFile(JSON.stringify(buildSettings(), null, 2), 'settings.json', 'application/json;charset=utf-8');
  });

  document.getElementById('loadSettingsBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) {
        const text = await file.text();
        let data;
        try {
          data = JSON.parse(text);
          if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('not a settings object');
        } catch (err) {
          settingsError = `Could not load ${file.name}: ${err instanceof Error ? err.message : String(err)}`;
          renderForm();
          return;
        }
        settingsError = '';
        exportWeeksAutoDerived = false;
        appState.dieselModels = data.dieselModels || DEFAULT_STATE.dieselModels;
        appState.evModels = data.evModels || DEFAULT_STATE.evModels;
        appState.dieselPricePln = data.dieselPricePln ?? DEFAULT_STATE.dieselPricePln;
        appState.dieselMaintenancePln = data.dieselMaintenancePln ?? DEFAULT_STATE.dieselMaintenancePln;
        appState.evMaintenancePln = data.evMaintenancePln ?? DEFAULT_STATE.evMaintenancePln;
        appState.nightTariffPln = data.nightTariffPln ?? DEFAULT_STATE.nightTariffPln;
        appState.dayTariffPln = data.dayTariffPln ?? DEFAULT_STATE.dayTariffPln;
        appState.grantPercentage = data.grantPercentage ?? DEFAULT_STATE.grantPercentage;
        appState.grantMaxCount = data.grantMaxCount ?? DEFAULT_STATE.grantMaxCount;
        appState.chargingPointsNorth = data.chargingPointsNorth ?? DEFAULT_STATE.chargingPointsNorth;
        appState.chargingPointsSouth = data.chargingPointsSouth ?? DEFAULT_STATE.chargingPointsSouth;
        appState.maxSouthRebase = data.maxSouthRebase ?? DEFAULT_STATE.maxSouthRebase;
        // Older settings files have no rangeRule; they get the Ops worst-day rule.
        appState.rangeRule = data.rangeRule === 'percentile' ? 'percentile' : 'worst_day';
        appState.rangePercentile = data.rangePercentile ?? DEFAULT_STATE.rangePercentile;
        appState.usableWltpShare = data.usableWltpShare ?? DEFAULT_STATE.usableWltpShare;
        appState.midDayTopup = data.midDayTopup ?? DEFAULT_STATE.midDayTopup;
        appState.evaluationYears = data.evaluationYears ?? DEFAULT_STATE.evaluationYears;
        appState.leaseExitFeeMonths = data.leaseExitFeeMonths ?? DEFAULT_STATE.leaseExitFeeMonths;
        appState.leaseWindowMonths = data.leaseWindowMonths ?? DEFAULT_STATE.leaseWindowMonths;
        appState.analysisDate = data.analysisDate ?? DEFAULT_STATE.analysisDate;
        appState.excludeRefrigerated = data.excludeRefrigerated ?? DEFAULT_STATE.excludeRefrigerated;
        appState.aliasList = data.aliasList || DEFAULT_STATE.aliasList;
        appState.exportWeeks = data.exportWeeks ?? DEFAULT_STATE.exportWeeks;
        validateUploads();
        renderForm();
      }
    };
    input.click();
  });

  // Form submit
  document.getElementById('parametersForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (areFilesValid()) {
      await runAnalysis();
    }
  });
}

async function runAnalysis(): Promise<void> {
  if (!vansUpload) return;
  // Parse vans from CSV
  const vans: Van[] = vansUpload.rows.map((row) => ({
    vanId: String(row.van_id).trim(),
    dieselModel: String(row.diesel_model).trim(),
    depot: (row.depot === 'North' ? 'North' : 'South') as 'North' | 'South',
    ownedOrLeased: (row.owned_or_leased === 'owned' ? 'owned' : 'leased') as 'owned' | 'leased',
    leaseEndDate: row.lease_end ? String(row.lease_end) : undefined,
    monthlyLeasePln: row.monthly_lease_pln ? parseFloat(String(row.monthly_lease_pln)) : undefined,
    refrigerated: row.refrigerated === 'yes' || row.refrigerated === 'true' || row.refrigerated === '1',
  }));

  // Create alias map and van ID set
  const aliasMap = aliasMapFromForm();
  const vanIds = new Set(vans.map(v => v.vanId));

  // Combine all trip files into one history, then clean it
  const combined = combineTripFiles(tripFiles);
  const cleaningResult = cleanTrips(combined.rows, vanIds, aliasMap, combined.sources);
  appState.cleaningResult = cleaningResult;
  lastRunInputs = { vans: vansUpload, tripFiles: [...tripFiles], combinedTrips: combined.rows, sources: combined.sources, vanList: vans, vanIds, aliasMap };

  // Downloads reflect the parameters of this run, not later form edits.
  const params = buildParams();
  appState.lastParams = params;
  appState.lastSettings = buildSettings();
  appState.analysisResult = analyzeFleet(vans, cleaningResult, params);

  renderResults();
}

function downloadFile(content: string, filename: string, mimeType: string = 'text/plain'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Vans that entered or left against the previous shortlist, or null before one is uploaded. */
function computeImpact(inputs: RunInputs, result: AnalysisResult, params: AnalysisParams): ImpactRow[] | null {
  if (!previousShortlist) return null;
  const scenarios = runImpactScenarios({
    vans: inputs.vanList,
    combinedRows: inputs.combinedTrips,
    sources: inputs.sources,
    vanIds: inputs.vanIds,
    aliasMap: inputs.aliasMap,
    params,
    cutoff: impactCutoff,
  });
  return classifyImpact(previousShortlist.vanIds, result, scenarios);
}

function renderResults(): void {
  const app = document.getElementById('app');
  if (!app || !appState.analysisResult || !appState.cleaningResult || !appState.lastParams || !lastRunInputs) return;
  const inputs = lastRunInputs;

  const result = appState.analysisResult;
  const cleaning = appState.cleaningResult;
  const params = appState.lastParams;
  const settings = appState.lastSettings;
  const assumptions = generateAssumptions(params);

  const aliasPairs = params.aliasList.filter((a) => a.from.trim() && a.to.trim());
  const where = (r: { file?: string; line: number }): string => `${r.file ? `${escapeHtml(r.file)} ` : ''}line ${r.line}`;
  const repairsList = cleaning.repairs.length > 0
    ? `<ul class="quality-list">${cleaning.repairs.map((r) => `<li>${where(r)}, ${escapeHtml(r.vanId)}, ${escapeHtml(r.date)}: odometer "${escapeHtml(r.odometerRaw)}" → GPS ${r.gpsKm} km</li>`).join('')}</ul>`
    : '';
  const droppedList = cleaning.dropped.length > 0
    ? `<ul class="quality-list">${cleaning.dropped.map((d) => `<li>${where(d)}, ${escapeHtml(d.vanId || '—')}, ${escapeHtml(d.date || '—')}: ${escapeHtml(d.reason)}</li>`).join('')}</ul>`
    : '';
  const tripFilesText = inputs.tripFiles.map((f) => `${escapeHtml(f.name)} (${f.rows.length} rows)`).join(', ');
  const renames = [inputs.vans, ...inputs.tripFiles]
    .filter((f) => f.renamed.length > 0)
    .map((f) => `${escapeHtml(f.name)}: ${f.renamed.map((r) => `${escapeHtml(r.from)} → ${escapeHtml(r.to)}`).join(', ')}`);
  const span = tripDateSpan(inputs.combinedTrips);
  const spanText = span ? ` (${span.first} to ${span.last})` : '';

  // Build per-van table rows (all vans)
  const yesNo = (ok: boolean): string => (ok ? 'Yes' : 'No');
  const vanRows = result.evaluations.map((e) => {
    const { van, metrics } = e;
    const statusBadge = e.status === 'shortlisted'
      ? `<span class="status-shortlisted">Shortlisted #${e.rank}</span>`
      : `<span class="status-excluded">Excluded</span>`;

    return `
      <tr>
        <td>${escapeHtml(van.vanId)}</td>
        <td>${van.depot}</td>
        <td>${van.refrigerated ? 'Yes' : 'No'}</td>
        <td>${van.ownedOrLeased}</td>
        <td>${escapeHtml(van.leaseEndDate || '—')}</td>
        <td>${metrics.p95DayKm.toFixed(1)}</td>
        <td>${metrics.maxDayKm.toFixed(1)}</td>
        <td>${rangeCheckKm(metrics, params).toFixed(1)}</td>
        <td>${metrics.maxLoadKg}</td>
        <td>${metrics.annualKm}</td>
        ${e.models.map(m => `<td>${yesNo(m.rangeOk)}</td><td>${yesNo(m.payloadOk)}</td><td>${m.savingPln ?? '—'}</td>`).join('')}
        <td>${escapeHtml(e.bestModel?.evModel ?? '—')}</td>
        <td>${statusBadge}</td>
        <td>${escapeHtml(e.exclusionReason ?? '')}</td>
      </tr>
    `;
  }).join('');

  // Build shortlist table rows
  const shortlistRows = result.shortlist.map(entry => `
    <tr>
      <td>${entry.rank}</td>
      <td>${escapeHtml(entry.vanId)}</td>
      <td>${escapeHtml(entry.evModel)}</td>
      <td>${entry.evDepot}</td>
      <td>${entry.rangeCheckKm.toFixed(1)}</td>
      <td>${entry.annualKm}</td>
      <td>${entry.annualFuelSavingPln}</td>
      <td>${entry.savingPln}</td>
      <td>${escapeHtml(entry.reason)}</td>
    </tr>
  `).join('');
  const shortlistBody = shortlistRows || '<tr><td colspan="9">No van qualifies</td></tr>';

  const evModelHeaders = params.evModels
    .map(m => `<th>${escapeHtml(m.name)} range OK</th><th>${escapeHtml(m.name)} payload OK</th><th>${escapeHtml(m.name)} ${params.evaluationYears}-yr saving (PLN)</th>`)
    .join('');
  const impact = computeImpact(inputs, result, params);
  const impactRows = impact?.map((r) => `
    <tr>
      <td>${escapeHtml(r.vanId)}</td>
      <td>${r.change}</td>
      <td>${r.cause}</td>
      <td>${escapeHtml(r.note)}</td>
    </tr>
  `).join('');
  const impactHtml = impact && previousShortlist
    ? `
          <div class="quality-item"><strong>Previous shortlist:</strong> ${escapeHtml(previousShortlist.name)} (${previousShortlist.vanIds.length} vans)</div>
          <div class="table-container">
            <table class="results-table">
              <thead>
                <tr><th>Van ID</th><th>Change</th><th>Cause</th><th>Note</th></tr>
              </thead>
              <tbody>
                ${impactRows || '<tr><td colspan="4">No vans entered or left</td></tr>'}
              </tbody>
            </table>
          </div>
          <div class="button-group">
            <button class="btn-secondary" id="downloadImpact">Download impact.csv</button>
          </div>`
    : '';

  const rangeBasisNote = result.rangeBasis === 'route'
    ? '<p class="range-basis-note">Midday top-up on: range checked per route, not per day</p>'
    : '';

  app.innerHTML = `
    <div class="container">
      <div class="header">
        <h1>Which Vans Go Electric?</h1>
        <p class="subtitle">Analysis Results</p>
      </div>

      <div class="results-content">
        <!-- Data Quality Report -->
        <section class="results-section">
          <h2>Data Quality Report</h2>
          <div class="quality-report">
            <div class="quality-item"><strong>Van register:</strong> ${escapeHtml(inputs.vans.name)} (${inputs.vans.rows.length} vans)</div>
            <div class="quality-item"><strong>Trip files:</strong> ${tripFilesText}</div>
            <div class="quality-item"><strong>Columns renamed:</strong> ${renames.length > 0 ? renames.join('; ') : 'none'}</div>
            <div class="quality-item"><strong>Rows read:</strong> ${cleaning.rowsRead}</div>
            <div class="quality-item"><strong>Exact duplicates removed:</strong> ${cleaning.exactDuplicatesRemoved}</div>
            <div class="quality-item"><strong>IDs remapped by alias:</strong> ${cleaning.aliasRemaps} (${aliasPairs.length > 0 ? aliasPairs.map((a) => `${escapeHtml(a.from)} → ${escapeHtml(a.to)}`).join(', ') : 'no aliases'})</div>
            <div class="quality-item"><strong>Distances repaired:</strong> ${cleaning.odometerRepairs} (GPS used instead of odometer)${repairsList}</div>
            <div class="quality-item"><strong>Blank gps_km (rows kept):</strong> ${cleaning.blankGps}</div>
            <div class="quality-item"><strong>Rows dropped:</strong> ${cleaning.invalidRowsRemoved}${droppedList}</div>
            <div class="quality-item"><strong>Unknown van IDs found:</strong> ${cleaning.unknownVanIds.length > 0 ? cleaning.unknownVanIds.map(escapeHtml).join(', ') : 'none'}</div>
            <div class="quality-item"><strong>Export length:</strong> ${params.exportWeeks} weeks${spanText}</div>
          </div>
        </section>

        <!-- Check Figures -->
        <section class="results-section">
          <h2>Check Figures</h2>
          <div class="check-figures">
            <div class="check-item">
              <span class="check-label">Vans assessed:</span>
              <span class="check-value">${result.checkFigures.vansAssessed}</span>
            </div>
            <div class="check-item">
              <span class="check-label">Trips counted:</span>
              <span class="check-value">${result.checkFigures.tripsCounted}</span>
            </div>
            <div class="check-item">
              <span class="check-label">Total km:</span>
              <span class="check-value">${result.checkFigures.totalKm}</span>
            </div>
          </div>
        </section>

        <!-- Per-Van Metrics Table -->
        <section class="results-section">
          <h2>Per-Van Analysis</h2>
          ${rangeBasisNote}
          <div class="table-container">
            <table class="results-table">
              <thead>
                <tr>
                  <th>Van ID</th>
                  <th>Depot</th>
                  <th>Fridge</th>
                  <th>Own/Lease</th>
                  <th>Lease End</th>
                  <th>P95 Day km</th>
                  <th>Max Day km</th>
                  <th>Range check km</th>
                  <th>Max Load</th>
                  <th>Annual km</th>
                  ${evModelHeaders}
                  <th>Best EV</th>
                  <th>Status</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                ${vanRows}
              </tbody>
            </table>
          </div>
        </section>

        <!-- Shortlist Table -->
        <section class="results-section">
          <h2>Shortlist (${result.shortlist.length} vans recommended)</h2>
          <div class="table-container">
            <table class="results-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Van ID</th>
                  <th>EV Model</th>
                  <th>EV Depot</th>
                  <th>Range check km</th>
                  <th>Annual km</th>
                  <th>Annual Fuel Saving (PLN)</th>
                  <th>${params.evaluationYears}-Year Saving (PLN)</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                ${shortlistBody}
              </tbody>
              <tfoot>
                <tr class="totals-row">
                  <td colspan="6">Total: ${result.summary.recommendedCount} vans</td>
                  <td>${result.summary.annualFuelSavingPln}</td>
                  <td>${result.summary.savingPln}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <!-- Impact vs previous shortlist -->
        <section class="results-section">
          <h2>Impact vs previous shortlist</h2>
          <div class="form-row">
            <div class="form-col">
              <label>Upload previous shortlist.csv:</label>
              <input type="file" id="previousShortlistUpload" accept=".csv" />
            </div>
            <div class="form-col">
              <label>Lunch data ends on:</label>
              <input type="date" id="impactCutoff" value="${escapeHtml(impactCutoff)}" />
            </div>
          </div>
          ${impactError ? `<div class="errors"><div class="error-message">${escapeHtml(impactError)}</div></div>` : ''}
          ${impactHtml}
        </section>

        <!-- Assumptions -->
        <section class="results-section">
          <h2>Analysis Assumptions</h2>
          <div class="assumptions-box">
            ${assumptions.map((line) => `<div class="assumption-item">${escapeHtml(line)}</div>`).join('')}
          </div>
        </section>

        <!-- Downloads -->
        <section class="results-section">
          <h2>Downloads</h2>
          <div class="button-group">
            <button class="btn-secondary" id="downloadShortlist">Download shortlist.csv</button>
            <button class="btn-secondary" id="downloadSummary">Download summary.csv</button>
            <button class="btn-secondary" id="downloadAssumptions">Download assumptions.md</button>
            <button class="btn-secondary" id="downloadSettings">Download settings.json</button>
            <button class="btn-secondary" id="downloadPerVan">Download per-van.csv</button>
            <button class="btn-secondary" id="downloadNormalizedVans">Download normalized vans.csv</button>
            <button class="btn-secondary" id="downloadNormalizedTrips">Download normalized trips.csv</button>
          </div>
        </section>

        <!-- Back Button -->
        <section class="results-section">
          <button class="btn-primary" id="backBtn">Back to Parameters</button>
        </section>
      </div>
    </div>
  `;

  // Attach download listeners
  document.getElementById('downloadShortlist')?.addEventListener('click', () => {
    const csv = generateShortlistCsv(result.shortlist);
    downloadFile(csv, 'shortlist.csv', 'text/csv;charset=utf-8');
  });

  document.getElementById('downloadSummary')?.addEventListener('click', () => {
    downloadFile(generateSummaryCsv(result, params), 'summary.csv', 'text/csv;charset=utf-8');
  });

  document.getElementById('downloadAssumptions')?.addEventListener('click', () => {
    downloadFile(generateAssumptionsMd(assumptions), 'assumptions.md', 'text/markdown;charset=utf-8');
  });

  document.getElementById('downloadSettings')?.addEventListener('click', () => {
    downloadFile(JSON.stringify(settings ?? buildSettings(), null, 2), 'settings.json', 'application/json;charset=utf-8');
  });

  document.getElementById('downloadPerVan')?.addEventListener('click', () => {
    const modelHeaders = params.evModels.flatMap(m => [`${m.name} range_ok`, `${m.name} payload_ok`, `${m.name} saving_pln`]);
    const header = ['van_id', 'depot', 'refrigerated', 'owned_or_leased', 'lease_end', 'p95_day_km', 'max_day_km', 'max_load_kg', 'annual_km', ...modelHeaders, 'best_ev_model', 'status', 'rank', 'exclusion_code', 'reason'];
    const lines = [header.map(formatCsvValue).join(',')];
    for (const e of result.evaluations) {
      const { van, metrics } = e;
      lines.push([
        van.vanId,
        van.depot,
        van.refrigerated ? 'yes' : 'no',
        van.ownedOrLeased,
        van.leaseEndDate ?? '',
        metrics.p95DayKm.toFixed(1),
        metrics.maxDayKm.toFixed(1),
        metrics.maxLoadKg,
        metrics.annualKm,
        ...e.models.flatMap(m => [m.rangeOk ? 'yes' : 'no', m.payloadOk ? 'yes' : 'no', m.savingPln ?? '']),
        e.bestModel?.evModel ?? '',
        e.status,
        e.rank ?? '',
        e.exclusionCode ?? '',
        e.exclusionReason ?? '',
      ].map(formatCsvValue).join(','));
    }
    downloadFile(lines.join('\n'), 'per-van.csv', 'text/csv;charset=utf-8');
  });

  document.getElementById('downloadNormalizedVans')?.addEventListener('click', () => {
    downloadFile(normalizedVansCsv(inputs.vans.rows), 'vans.csv', 'text/csv;charset=utf-8');
  });

  document.getElementById('downloadNormalizedTrips')?.addEventListener('click', () => {
    downloadFile(normalizedTripsCsv(inputs.combinedTrips, inputs.vanIds, inputs.aliasMap), 'trips.csv', 'text/csv;charset=utf-8');
  });

  document.getElementById('previousShortlistUpload')?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: { data: ParsedRow[] }) => {
        const parsed = parsePreviousShortlist(results.data);
        impactError = parsed.error ? `${file.name}: ${parsed.error}` : '';
        previousShortlist = parsed.error ? null : { name: file.name, vanIds: parsed.vanIds };
        renderResults();
      },
      error: (error: { message: string }) => {
        impactError = `${file.name}: ${error.message}`;
        previousShortlist = null;
        renderResults();
      },
    });
  });

  document.getElementById('impactCutoff')?.addEventListener('change', (e) => {
    impactCutoff = (e.target as HTMLInputElement).value;
    impactCutoffEdited = true;
    renderResults();
  });

  document.getElementById('downloadImpact')?.addEventListener('click', () => {
    if (impact) downloadFile(generateImpactCsv(impact), 'impact.csv', 'text/csv;charset=utf-8');
  });

  document.getElementById('backBtn')?.addEventListener('click', () => {
    renderForm();
  });
}

function initApp(): void {
  renderForm();
}

document.addEventListener('DOMContentLoaded', initApp);

export { analyzeFleet, type DieselModel, type EVModel, type AnalysisParams };
