import { analyzeFleet, type DieselModel, type EVModel, type CapConfig } from './engine';
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
  vansFile: File | null;
  tripsFile: File | null;
}

interface UploadError {
  file: string;
  error: string;
}

interface ParsedRow {
  [key: string]: unknown;
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
  vansFile: null,
  tripsFile: null,
};

const appState: AppState = JSON.parse(JSON.stringify(DEFAULT_STATE));
let uploadErrors: UploadError[] = [];
let parsedVans: ParsedRow[] = [];
let parsedTrips: ParsedRow[] = [];

function parseVansCsv(file: File): Promise<void> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: { data: ParsedRow[] }) => {
        const errors: string[] = [];
        const requiredHeaders = ['van_id', 'diesel_model', 'depot', 'owned_or_leased', 'lease_end', 'monthly_lease_pln', 'refrigerated'];

        if (results.data.length === 0) {
          errors.push('No data rows found');
        } else {
          const firstRow = results.data[0];
          for (const header of requiredHeaders) {
            if (!(header in firstRow)) {
              errors.push(`Missing column: ${header}`);
            }
          }
        }

        if (errors.length > 0) {
          uploadErrors.push({ file: file.name, error: errors.join('; ') });
        } else {
          parsedVans = results.data;
          appState.vansFile = file;
        }
        resolve();
      },
      error: (error: { message: string }) => {
        uploadErrors.push({ file: file.name, error: error.message });
        resolve();
      },
    });
  });
}

function parseTripsCsv(file: File): Promise<void> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: { data: ParsedRow[] }) => {
        const errors: string[] = [];
        const requiredHeaders = ['date', 'van_id', 'odometer_km', 'gps_km', 'max_load_kg'];

        if (results.data.length === 0) {
          errors.push('No data rows found');
        } else {
          const firstRow = results.data[0];
          for (const header of requiredHeaders) {
            if (!(header in firstRow)) {
              errors.push(`Missing column: ${header}`);
            }
          }
        }

        if (errors.length > 0) {
          uploadErrors.push({ file: file.name, error: errors.join('; ') });
        } else {
          // Validate numeric columns and van IDs
          const vanIds = new Set(parsedVans.map((v) => v.van_id?.toString().trim()));
          const aliasMap = new Map(appState.aliasList.map(a => [a.from, a.to]));
          const unknownVanIds = new Set<string>();

          for (let i = 0; i < results.data.length; i++) {
            const row = results.data[i];
            const vanId = row.van_id?.toString().trim();
            const remappedId = aliasMap.get(vanId) || vanId;

            if (!vanIds.has(remappedId)) {
              unknownVanIds.add(vanId ?? '');
            }

            const odometerKm = parseFloat(String(row.odometer_km));
            const gpsKm = parseFloat(String(row.gps_km));

            if (!isNaN(odometerKm) && odometerKm !== 0 && isFinite(odometerKm)) {
              // Valid odometer
            } else if (!isNaN(gpsKm) && gpsKm > 0 && isFinite(gpsKm)) {
              // Valid GPS
            } else {
              errors.push(`Row ${i + 2}: both odometer_km and gps_km are invalid or missing`);
            }
          }

          if (unknownVanIds.size > 0) {
            errors.push(`Unknown van IDs in trips: ${Array.from(unknownVanIds).join(', ')}`);
          }

          if (errors.length > 0) {
            uploadErrors.push({ file: file.name, error: errors.join('; ') });
          } else {
            parsedTrips = results.data;
            appState.tripsFile = file;
          }
        }
        resolve();
      },
      error: (error: { message: string }) => {
        uploadErrors.push({ file: file.name, error: error.message });
        resolve();
      },
    });
  });
}

function areFilesValid(): boolean {
  return appState.vansFile !== null && appState.tripsFile !== null && uploadErrors.length === 0;
}

function renderForm(): void {
  const app = document.getElementById('app');
  if (!app) return;

  const errorsHtml = uploadErrors.map(e => `<div class="error-message">${e.file}: ${e.error}</div>`).join('');

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
          <div class="form-row">
            <div class="form-col">
              <label>Percentile:</label>
              <input type="number" id="rangePercentile" step="1" value="${appState.rangePercentile}" />
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
              <label>Upload vans.csv:</label>
              <input type="file" id="vansUpload" accept=".csv" />
              ${appState.vansFile ? `<span class="file-ok">✓ ${appState.vansFile.name}</span>` : ''}
            </div>
            <div class="form-col">
              <label>Upload trips.csv:</label>
              <input type="file" id="tripsUpload" accept=".csv" />
              ${appState.tripsFile ? `<span class="file-ok">✓ ${appState.tripsFile.name}</span>` : ''}
            </div>
          </div>
          ${errorsHtml ? `<div class="errors">${errorsHtml}</div>` : ''}
        </section>

        <!-- Action Buttons -->
        <section class="form-section">
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

      fromInput?.addEventListener('change', (e) => {
        if (appState.aliasList[i]) {
          appState.aliasList[i].from = (e.target as HTMLInputElement).value;
        }
      });
      toInput?.addEventListener('change', (e) => {
        if (appState.aliasList[i]) {
          appState.aliasList[i].to = (e.target as HTMLInputElement).value;
        }
      });
      removeBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        appState.aliasList.splice(i, 1);
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
      uploadErrors = uploadErrors.filter(err => err.file !== 'vans.csv');
      await parseVansCsv(file);
      renderForm();
    }
  });

  document.getElementById('tripsUpload')?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      uploadErrors = uploadErrors.filter(err => err.file !== 'trips.csv');
      await parseTripsCsv(file);
      renderForm();
    }
  });

  // Settings
  document.getElementById('saveSettingsBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    const settingsData = {
      dieselModels: appState.dieselModels,
      evModels: appState.evModels,
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
      rangePercentile: appState.rangePercentile,
      usableWltpShare: appState.usableWltpShare,
      midDayTopup: appState.midDayTopup,
      evaluationYears: appState.evaluationYears,
      leaseExitFeeMonths: appState.leaseExitFeeMonths,
      leaseWindowMonths: appState.leaseWindowMonths,
      analysisDate: appState.analysisDate,
      excludeRefrigerated: appState.excludeRefrigerated,
      aliasList: appState.aliasList,
      exportWeeks: appState.exportWeeks,
    };
    const blob = new Blob([JSON.stringify(settingsData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'settings.json';
    a.click();
    URL.revokeObjectURL(url);
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
        const data = JSON.parse(text);
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
        renderForm();
      }
    };
    input.click();
  });

  // Form submit
  document.getElementById('parametersForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (areFilesValid()) {
      console.log('Form submitted with valid files');
      console.log('Vans:', parsedVans);
      console.log('Trips:', parsedTrips);
    }
  });
}

function initApp(): void {
  renderForm();
}

document.addEventListener('DOMContentLoaded', initApp);

export { analyzeFleet, type DieselModel, type EVModel, type CapConfig };
