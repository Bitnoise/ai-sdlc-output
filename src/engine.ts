export interface DieselModel {
  name: string;
  fuelUseLper100km: number;
  payloadKg: number;
}

export interface Van {
  vanId: string;
  dieselModel: string;
  depot: "North" | "South";
  ownedOrLeased: "owned" | "leased";
  leaseEndDate?: string; // YYYY-MM-DD
  monthlyLeasePln?: number;
  refrigerated: boolean;
}

export interface Trip {
  date: string; // YYYY-MM-DD
  vanId: string;
  distanceKm: number;
  maxLoadKg: number;
}

export interface EVModel {
  name: string;
  wltpRangeKm: number;
  payloadKg: number;
  energyKwhPer100km: number;
  purchasePricePln: number;
  monthlyLeasePln: number;
  leaseMonths: number;
}

export interface AnalysisParams {
  dieselModels: DieselModel[];
  evModels: EVModel[];
  dieselPricePln: number;
  dieselMaintenancePln: number;
  evMaintenancePln: number;
  nightTariffPln: number;
  grantShare: number; // 0-1
  grantCap: number;
  chargingPointsNorth: number;
  chargingPointsSouth: number;
  southRebaseCap: number;
  rangePercentile: number;
  usableWltpShare: number; // 0-1
  middayTopup: boolean;
  evaluationYears: number;
  leaseExitFeeMonths: number;
  leaseWindowMonths: number;
  analysisDate: string; // YYYY-MM-DD
  excludeRefrigerated: boolean;
  exportWeeks: number;
  aliasList: VanAlias[];
}

export interface VanAlias {
  from: string;
  to: string;
}

export const DEFAULT_PARAMS: AnalysisParams = {
  dieselModels: [
    { name: "Brona D35", fuelUseLper100km: 9.6, payloadKg: 1150 },
    { name: "Brona D35 Long", fuelUseLper100km: 10.9, payloadKg: 1050 },
    { name: "Kestrel Cargo 3.5", fuelUseLper100km: 11.8, payloadKg: 1300 },
  ],
  evModels: [
    { name: "Volta Cargo S", wltpRangeKm: 260, payloadKg: 1050, energyKwhPer100km: 24, purchasePricePln: 150000, monthlyLeasePln: 2900, leaseMonths: 60 },
    { name: "Volta Cargo L", wltpRangeKm: 380, payloadKg: 880, energyKwhPer100km: 27, purchasePricePln: 195000, monthlyLeasePln: 3770, leaseMonths: 60 },
  ],
  dieselPricePln: 5.2,
  dieselMaintenancePln: 0.34,
  evMaintenancePln: 0.14,
  nightTariffPln: 0.58,
  grantShare: 0.3,
  grantCap: 10,
  chargingPointsNorth: 10,
  chargingPointsSouth: 0,
  southRebaseCap: 3,
  rangePercentile: 95,
  usableWltpShare: 0.6,
  middayTopup: false,
  evaluationYears: 5,
  leaseExitFeeMonths: 3,
  leaseWindowMonths: 12,
  analysisDate: new Date().toISOString().slice(0, 10),
  excludeRefrigerated: true,
  exportWeeks: 13,
  aliasList: [{ from: "P-17", to: "P-17B" }],
};

export interface DistanceRepair {
  file?: string;
  line: number;
  vanId: string;
  date: string;
  odometerRaw: string;
  gpsKm: number;
}

export interface DroppedRow {
  file?: string;
  line: number;
  vanId: string;
  date: string;
  reason: string;
}

export interface CleaningResult {
  trips: Trip[];
  rowsRead: number;
  exactDuplicatesRemoved: number;
  aliasRemaps: number;
  odometerRepairs: number;
  blankGps: number;
  invalidRowsRemoved: number;
  unknownVanIds: string[];
  repairs: DistanceRepair[];
  dropped: DroppedRow[];
}

export interface VanMetrics {
  vanId: string;
  depot: "North" | "South";
  refrigerated: boolean;
  ownedOrLeased: "owned" | "leased";
  leaseEndDate?: string;
  tripCount: number;
  dayCount: number;
  totalKm: number;
  p95DayKm: number;
  maxDayKm: number;
  p95RouteKm: number;
  maxRouteKm: number;
  maxLoadKg: number;
  annualKm: number;
}

export interface ModelEvaluation {
  evModel: string;
  rangeCheckKm: number;
  usableRangeKm: number;
  rangeOk: boolean;
  payloadOk: boolean;
  // Money fields are null when the van's diesel model is not in the diesel models table.
  annualFuelSavingPln: number | null;
  annualOperatingSavingPln: number | null;
  evNetCostPln: number;
  leaseExitFeePln: number;
  savingPln: number | null;
  eligible: boolean;
}

export type ExclusionCode =
  | "refrigerated"
  | "range"
  | "payload"
  | "negative_saving"
  | "charger_cap"
  | "south_cap"
  | "grant_cap"
  | "unknown_diesel_model"
  | "no_trips";

export interface VanEvaluation {
  van: Van;
  metrics: VanMetrics;
  models: ModelEvaluation[];
  bestModel: ModelEvaluation | null;
  evDepot: "North" | "South";
  status: "shortlisted" | "excluded";
  rank?: number;
  exclusionCode?: ExclusionCode;
  exclusionReason?: string;
}

export interface ShortlistEntry {
  rank: number;
  vanId: string;
  evModel: string;
  evDepot: "North" | "South";
  rangeCheckKm: number;
  annualKm: number;
  annualFuelSavingPln: number;
  savingPln: number;
  reason: string;
}

export interface AnalysisResult {
  cleaningResult: CleaningResult;
  vans: Van[];
  vanMetrics: Map<string, VanMetrics>;
  evaluations: VanEvaluation[];
  rangeBasis: "day" | "route";
  checkFigures: {
    vansAssessed: number;
    tripsCounted: number;
    totalKm: number;
  };
  shortlist: ShortlistEntry[];
  summary: {
    recommendedCount: number;
    annualFuelSavingPln: number;
    savingPln: number;
  };
}

/** A distance is usable when it is a finite number above zero. */
export function usableKm(raw: unknown): number | null {
  const text = raw === null || raw === undefined ? "" : String(raw).trim();
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Alias targets apply only when the target is in the register; otherwise the original ID is kept. */
export function resolveVanId(vanId: string, aliasMap: Map<string, string>, vanIds: Set<string>): string {
  const target = aliasMap.get(vanId);
  return target && vanIds.has(target) ? target : vanId;
}

export function cleanTrips(
  rawTrips: Array<Record<string, unknown>>,
  vanIds: Set<string>,
  aliasMap: Map<string, string>,
  sources?: Array<{ file: string; line: number }>
): CleaningResult {
  const seen = new Set<string>();
  let exactDuplicatesRemoved = 0;
  let aliasRemaps = 0;
  let blankGps = 0;
  const unknownVanIds = new Set<string>();
  const repairs: DistanceRepair[] = [];
  const dropped: DroppedRow[] = [];
  const cleanedTrips: Trip[] = [];

  rawTrips.forEach((row, index) => {
    // Header is line 1; combined exports carry their own file and line.
    const line = sources?.[index]?.line ?? index + 2;
    const file = sources?.[index]?.file;
    const signature = Object.keys(row)
      .map((key) => String(row[key] ?? "").trim())
      .join("\u0001");
    if (seen.has(signature)) {
      exactDuplicatesRemoved++;
      return;
    }
    seen.add(signature);

    const rawId = String(row.van_id ?? "").trim();
    const date = String(row.date ?? "").trim();
    if (!rawId || !date) {
      dropped.push({ file, line, vanId: rawId, date, reason: "missing van_id or date" });
      return;
    }

    const vanId = resolveVanId(rawId, aliasMap, vanIds);
    if (vanId !== rawId) aliasRemaps++;
    if (!vanIds.has(vanId)) {
      unknownVanIds.add(rawId);
      dropped.push({ file, line, vanId: rawId, date, reason: "van_id not in the register" });
      return;
    }

    const gpsRaw = String(row.gps_km ?? "").trim();
    if (gpsRaw === "") blankGps++;

    // Odometer is authoritative; GPS is only a fallback.
    const odometerKm = usableKm(row.odometer_km);
    const gpsKm = usableKm(gpsRaw);
    let distanceKm: number;
    if (odometerKm !== null) {
      distanceKm = odometerKm;
    } else if (gpsKm !== null) {
      distanceKm = gpsKm;
      repairs.push({ file, line, vanId, date, odometerRaw: String(row.odometer_km ?? "").trim(), gpsKm });
    } else {
      dropped.push({ file, line, vanId, date, reason: "both odometer_km and gps_km unusable" });
      return;
    }

    cleanedTrips.push({
      date,
      vanId,
      distanceKm,
      maxLoadKg: parseFloat(String(row.max_load_kg)) || 0,
    });
  });

  return {
    trips: cleanedTrips,
    rowsRead: rawTrips.length,
    exactDuplicatesRemoved,
    aliasRemaps,
    odometerRepairs: repairs.length,
    blankGps,
    invalidRowsRemoved: dropped.length,
    unknownVanIds: Array.from(unknownVanIds),
    repairs,
    dropped,
  };
}

/** Percentile with linear interpolation (Excel PERCENTILE.INC / numpy default). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  return sorted[lower] + (pos - lower) * (sorted[upper] - sorted[lower]);
}

/** Export length in whole weeks from the first to the last valid trip date (both days included). */
export function deriveExportWeeks(rawTrips: Array<Record<string, unknown>>): number {
  let min = Infinity;
  let max = -Infinity;
  for (const row of rawTrips) {
    const text = String(row.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) continue;
    const time = Date.parse(`${text}T00:00:00Z`);
    if (!Number.isFinite(time)) continue;
    min = Math.min(min, time);
    max = Math.max(max, time);
  }
  if (!Number.isFinite(min)) return 0;
  const days = (max - min) / 86400000 + 1;
  return Math.ceil(days / 7);
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function calculateVanMetrics(
  vans: Van[],
  cleanedTrips: Trip[],
  exportWeeks: number,
  rangePercentile = 95
): Map<string, VanMetrics> {
  const metrics = new Map<string, VanMetrics>();

  const tripsByVan = new Map<string, Trip[]>();
  for (const trip of cleanedTrips) {
    if (!tripsByVan.has(trip.vanId)) {
      tripsByVan.set(trip.vanId, []);
    }
    tripsByVan.get(trip.vanId)!.push(trip);
  }

  for (const van of vans) {
    const trips = tripsByVan.get(van.vanId) || [];

    // A day is the sum of all routes the van drove on that date.
    const dailyDistances = new Map<string, number>();
    let totalKm = 0;
    let maxLoadKg = 0;
    for (const trip of trips) {
      dailyDistances.set(trip.date, (dailyDistances.get(trip.date) || 0) + trip.distanceKm);
      totalKm += trip.distanceKm;
      maxLoadKg = Math.max(maxLoadKg, trip.maxLoadKg);
    }

    const dayValues = Array.from(dailyDistances.values());
    const routeValues = trips.map((t) => t.distanceKm);

    metrics.set(van.vanId, {
      vanId: van.vanId,
      depot: van.depot,
      refrigerated: van.refrigerated,
      ownedOrLeased: van.ownedOrLeased,
      leaseEndDate: van.leaseEndDate,
      tripCount: trips.length,
      dayCount: dayValues.length,
      totalKm,
      p95DayKm: round1(percentile(dayValues, rangePercentile)),
      maxDayKm: round1(dayValues.length > 0 ? Math.max(...dayValues) : 0),
      p95RouteKm: round1(percentile(routeValues, rangePercentile)),
      maxRouteKm: round1(routeValues.length > 0 ? Math.max(...routeValues) : 0),
      maxLoadKg,
      annualKm: exportWeeks > 0 ? Math.round((totalKm / exportWeeks) * 52) : 0,
    });
  }

  return metrics;
}

function addMonthsUtc(isoDate: string, months: number): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay)));
}

/**
 * Fee for leaving a diesel lease early: 0 for owned vans and for leases that end
 * within the window after the analysis date; otherwise multiplier x monthly lease.
 * A leased van without a lease end date is charged the fee (conservative).
 */
export function leaseExitFee(van: Van, analysisDate: string, windowMonths: number, multiplier: number): number {
  if (van.ownedOrLeased !== "leased") return 0;
  if (van.leaseEndDate) {
    const leaseEnd = addMonthsUtc(van.leaseEndDate, 0);
    if (leaseEnd.getTime() <= addMonthsUtc(analysisDate, windowMonths).getTime()) return 0;
  }
  return multiplier * (van.monthlyLeasePln ?? 0);
}

export function evaluateModel(
  van: Van,
  metrics: VanMetrics,
  model: EVModel,
  params: AnalysisParams,
  dieselModel?: DieselModel
): ModelEvaluation {
  const rangeCheckKm = params.middayTopup ? metrics.p95RouteKm : metrics.p95DayKm;
  const usableRangeKm = params.usableWltpShare * model.wltpRangeKm;
  const rangeOk = rangeCheckKm <= usableRangeKm;
  const payloadOk = metrics.maxLoadKg <= model.payloadKg;
  const evNetCostPln = model.purchasePricePln * (1 - params.grantShare);
  const leaseExitFeePln = leaseExitFee(van, params.analysisDate, params.leaseWindowMonths, params.leaseExitFeeMonths);

  let annualFuelSavingPln: number | null = null;
  let annualOperatingSavingPln: number | null = null;
  let savingPln: number | null = null;
  if (dieselModel) {
    const dieselFuelPerKm = (dieselModel.fuelUseLper100km / 100) * params.dieselPricePln;
    const evChargingPerKm = (model.energyKwhPer100km / 100) * params.nightTariffPln;
    annualFuelSavingPln = Math.round(metrics.annualKm * (dieselFuelPerKm - evChargingPerKm));
    annualOperatingSavingPln =
      metrics.annualKm *
      (dieselFuelPerKm + params.dieselMaintenancePln - (evChargingPerKm + params.evMaintenancePln));
    savingPln = Math.round(params.evaluationYears * annualOperatingSavingPln - evNetCostPln - leaseExitFeePln);
  }

  return {
    evModel: model.name,
    rangeCheckKm,
    usableRangeKm,
    rangeOk,
    payloadOk,
    annualFuelSavingPln,
    annualOperatingSavingPln,
    evNetCostPln,
    leaseExitFeePln,
    savingPln,
    eligible: rangeOk && payloadOk && savingPln !== null,
  };
}

const pct = (share: number): number => Math.round(share * 10000) / 100;
const sharePct = (params: AnalysisParams): number => pct(params.usableWltpShare);
const rangeLabel = (params: AnalysisParams): string =>
  `P${params.rangePercentile} ${params.middayTopup ? "route" : "day"}`;

/** Evaluates one van against every EV model and applies the pre-shortlist exclusions. */
export function evaluateVan(van: Van, metrics: VanMetrics, params: AnalysisParams): VanEvaluation {
  const dieselModel = params.dieselModels.find((m) => m.name === van.dieselModel);
  const models = params.evModels.map((model) => evaluateModel(van, metrics, model, params, dieselModel));
  const evDepot = van.depot === "South" && params.chargingPointsSouth <= 0 ? "North" : van.depot;

  let bestModel: ModelEvaluation | null = null;
  for (const m of models) {
    if (m.eligible && (bestModel === null || m.savingPln! > bestModel.savingPln!)) {
      bestModel = m;
    }
  }

  const evaluation: VanEvaluation = { van, metrics, models, bestModel, evDepot, status: "excluded" };
  const exclude = (code: ExclusionCode, reason: string): VanEvaluation => ({
    ...evaluation,
    bestModel: code === "negative_saving" ? bestModel : null,
    exclusionCode: code,
    exclusionReason: reason,
  });

  if (params.excludeRefrigerated && van.refrigerated) {
    return exclude("refrigerated", "Refrigerated van: fridge vans are out for year 1");
  }
  if (!dieselModel) {
    return exclude("unknown_diesel_model", `Diesel model "${van.dieselModel}" is not in the diesel models table`);
  }
  if (metrics.tripCount === 0) {
    return exclude("no_trips", "No trips in the export");
  }
  const rangeCheckKm = params.middayTopup ? metrics.p95RouteKm : metrics.p95DayKm;
  if (!models.some((m) => m.rangeOk)) {
    const best = Math.max(0, ...models.map((m) => m.usableRangeKm));
    return exclude(
      "range",
      `${rangeLabel(params)} ${rangeCheckKm} km exceeds ${sharePct(params)}% of every EV model's range (max ${Math.round(best)} km)`
    );
  }
  if (bestModel === null) {
    return exclude("payload", `Max load ${metrics.maxLoadKg} kg exceeds the payload of every EV model that fits the range`);
  }
  if (bestModel.savingPln! <= 0) {
    return exclude(
      "negative_saving",
      `Best saving with ${bestModel.evModel} is ${bestModel.savingPln} PLN over ${params.evaluationYears} years (not positive)`
    );
  }
  return evaluation;
}

function shortlistReason(evaluation: VanEvaluation, params: AnalysisParams): string {
  const { van, bestModel, evDepot } = evaluation;
  const best = bestModel!;
  const ownership = van.ownedOrLeased === "owned" ? "Owned" : "Leased";
  const rebased = van.depot !== evDepot ? ` re-based to ${evDepot}` : "";
  return `${ownership} ${van.depot} van${rebased}, ${rangeLabel(params)} ${best.rangeCheckKm} km fits ${sharePct(params)}% of ${best.evModel} range, saves ${best.savingPln!.toLocaleString("en-US")} PLN over ${params.evaluationYears} years`;
}

/**
 * Walks the candidates (no exclusion code yet) by saving and applies the caps.
 * Updates status, rank and exclusion reason on the evaluations in place.
 */
export function buildShortlist(evaluations: VanEvaluation[], params: AnalysisParams): ShortlistEntry[] {
  const candidates = evaluations
    .filter((e) => e.exclusionCode === undefined && e.bestModel !== null && e.bestModel.savingPln! > 0)
    .sort((a, b) => {
      const diff = b.bestModel!.savingPln! - a.bestModel!.savingPln!;
      if (diff !== 0) return diff;
      if (b.metrics.annualKm !== a.metrics.annualKm) return b.metrics.annualKm - a.metrics.annualKm;
      return a.van.vanId.localeCompare(b.van.vanId);
    });

  const shortlist: ShortlistEntry[] = [];
  const pointsUsed = { North: 0, South: 0 };
  const pointsAvailable = { North: params.chargingPointsNorth, South: params.chargingPointsSouth };
  let rebased = 0;

  for (const e of candidates) {
    const needsRebase = e.van.depot !== e.evDepot;
    if (needsRebase && rebased >= params.southRebaseCap) {
      e.exclusionCode = "south_cap";
      e.exclusionReason = `Skipped: South re-base cap of ${params.southRebaseCap} vans reached`;
    } else if (shortlist.length >= params.grantCap) {
      e.exclusionCode = "grant_cap";
      e.exclusionReason = `Skipped: grant cap of ${params.grantCap} EVs reached`;
    } else if (pointsUsed[e.evDepot] >= pointsAvailable[e.evDepot]) {
      e.exclusionCode = "charger_cap";
      e.exclusionReason = `Skipped: all ${pointsAvailable[e.evDepot]} ${e.evDepot} charging points taken`;
    } else {
      pointsUsed[e.evDepot]++;
      if (needsRebase) rebased++;
      e.status = "shortlisted";
      e.rank = shortlist.length + 1;
      const best = e.bestModel!;
      shortlist.push({
        rank: e.rank,
        vanId: e.van.vanId,
        evModel: best.evModel,
        evDepot: e.evDepot,
        rangeCheckKm: best.rangeCheckKm,
        annualKm: e.metrics.annualKm,
        annualFuelSavingPln: best.annualFuelSavingPln!,
        savingPln: best.savingPln!,
        reason: shortlistReason(e, params),
      });
    }
  }

  return shortlist;
}

export function analyzeFleet(vans: Van[], cleaning: CleaningResult, params: AnalysisParams): AnalysisResult {
  const vanMetrics = calculateVanMetrics(vans, cleaning.trips, params.exportWeeks, params.rangePercentile);
  const evaluations = vans.map((van) => evaluateVan(van, vanMetrics.get(van.vanId)!, params));
  const shortlist = buildShortlist(evaluations, params);

  return {
    cleaningResult: cleaning,
    vans,
    vanMetrics,
    evaluations,
    rangeBasis: params.middayTopup ? "route" : "day",
    checkFigures: {
      vansAssessed: vans.length,
      tripsCounted: cleaning.trips.length,
      totalKm: Math.round(cleaning.trips.reduce((sum, trip) => sum + trip.distanceKm, 0)),
    },
    shortlist,
    summary: {
      recommendedCount: shortlist.length,
      annualFuelSavingPln: shortlist.reduce((sum, s) => sum + s.annualFuelSavingPln, 0),
      savingPln: shortlist.reduce((sum, s) => sum + s.savingPln, 0),
    },
  };
}

export function formatCsvValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateShortlistCsv(shortlist: ShortlistEntry[]): string {
  const lines = [
    "rank,van_id,ev_model,ev_depot,range_check_km,annual_km,annual_fuel_saving_pln,saving_pln,reason",
  ];

  for (const entry of shortlist) {
    lines.push(
      [
        entry.rank,
        formatCsvValue(entry.vanId),
        formatCsvValue(entry.evModel),
        entry.evDepot,
        entry.rangeCheckKm.toFixed(1),
        entry.annualKm,
        entry.annualFuelSavingPln,
        entry.savingPln,
        formatCsvValue(entry.reason),
      ].join(",")
    );
  }

  return lines.join("\n");
}

export function savingBasis(params: AnalysisParams): string {
  return `${params.evaluationYears}-year operating saving (diesel fuel + maintenance minus night-tariff charging + EV maintenance) minus EV purchase price net of ${pct(params.grantShare)}% grant minus diesel lease exit fees; excludes diesel lease payments and resale`;
}

export function generateSummaryCsv(result: AnalysisResult, params: AnalysisParams): string {
  const rows: Array<[string, string | number]> = [
    ["vans_assessed", result.checkFigures.vansAssessed],
    ["trips_counted", result.checkFigures.tripsCounted],
    ["total_km", result.checkFigures.totalKm],
    ["recommended_count", result.summary.recommendedCount],
    ["annual_fuel_saving_pln", result.summary.annualFuelSavingPln],
    ["saving_pln", result.summary.savingPln],
    ["saving_basis", savingBasis(params)],
  ];
  return ["figure,value", ...rows.map(([figure, value]) => `${figure},${formatCsvValue(value)}`)].join("\n");
}

/** One human-readable line per business rule, built from the parameters used for the run. */
export function generateAssumptions(params: AnalysisParams): string[] {
  const aliases = params.aliasList.filter((a) => a.from.trim() && a.to.trim());
  const aliasText = aliases.length > 0 ? aliases.map((a) => `${a.from} -> ${a.to}`).join(", ") : "none";
  const usable = sharePct(params);
  const grant = pct(params.grantShare);
  const years = params.evaluationYears;

  return [
    "Trip exports are combined into one history (e.g. trips.csv + trips_latest.csv); exact duplicate rows across files are removed once. The latest van register (e.g. vans_latest.csv) replaces earlier ones.",
    "Vendor headers model, ownership and odo_km are read as diesel_model, owned_or_leased and odometer_km; values are unchanged.",
    ...aliases.map((a) => `${a.from} in the older trips export is the van registered as ${a.to}; the normalized trips.csv writes ${a.to}.`),
    "Exact duplicate trip rows (all columns identical) are removed.",
    `Van IDs in trips are remapped by the alias table (${aliasText}); an alias applies only when its target is in the register.`,
    "Trip distance = odometer_km (authoritative); GPS is used only as a fallback when the odometer is missing, not a number or <= 0, and the row is dropped if both are unusable. A blank gps_km alone is fine.",
    "trips_counted = trip rows left after cleaning; total_km = sum of their distances, rounded to whole km.",
    params.middayTopup
      ? "Midday top-up allowed: range checked per route, not per day."
      : "A van's day is the sum of all its routes on that date (double-route days summed); no midday top-up between routes.",
    "Only dates on which the van actually drove count as days.",
    `Range check = P${params.rangePercentile} of the van's ${params.middayTopup ? "route" : "daily"} km (linear interpolation, like Excel PERCENTILE.INC), 1 decimal.`,
    "Max load = the heaviest max_load_kg the van carried in the export.",
    `Annual km = van's total cleaned km / ${params.exportWeeks} export weeks x 52, integer.`,
    params.excludeRefrigerated
      ? "Refrigerated vans are excluded in year 1 (the fridge unit drains the battery)."
      : "Refrigerated vans are included (the exclude-refrigerated toggle is off).",
    `Range OK when the range check km <= ${usable}% of the EV model's WLTP range.`,
    "Payload OK when the van's max load <= the EV model's payload.",
    `North vans stay at North; South vans are re-based to North (they keep their routes), at most ${params.southRebaseCap} of them.`,
    `Charging points: North ${params.chargingPointsNorth}, South ${params.chargingPointsSouth}; one EV per charging point, overnight only.`,
    `Diesel fuel cost/km = fuel use L/100 km / 100 x ${params.dieselPricePln} PLN/L (by the van's diesel model).`,
    `EV charging cost/km = energy kWh/100 km / 100 x night tariff ${params.nightTariffPln} PLN/kWh (overnight charging).`,
    `Maintenance: diesel ${params.dieselMaintenancePln} PLN/km, EV ${params.evMaintenancePln} PLN/km.`,
    "annual_fuel_saving_pln = annual km x (diesel fuel cost/km - EV charging cost/km), integer.",
    "Annual operating saving = annual km x [(diesel fuel + diesel maintenance)/km - (EV charging + EV maintenance)/km].",
    `EVs are bought, not leased: EV net cost = purchase price x (1 - ${grant}%); grant cap ${params.grantCap} EVs.`,
    `Diesel lease exit fee = ${params.leaseExitFeeMonths} x monthly lease, or 0 when the lease ends within ${params.leaseWindowMonths} months of ${params.analysisDate}; owned diesels pay no fee.`,
    `saving_pln = ${years} years x annual operating saving - EV net cost - lease exit fee, integer; excludes diesel lease payments and resale values.`,
    "Best model = the EV model that passes range and payload with the highest saving.",
    `Shortlist: vans with a positive saving, sorted by saving (ties: higher annual km, then van ID), taken while caps allow (grant ${params.grantCap}, North charging points ${params.chargingPointsNorth}, South re-base ${params.southRebaseCap}).`,
    "Grant: re-based South vans are assumed grant-eligible; fridge vans are excluded anyway. Leased EVs are never proposed.",
    "Double-route days summed, no midday top-up by default.",
    "Odometer preferred over GPS; GPS only as fallback.",
    "Annualisation from a summer export (15 Jun–13 Sep); no seasonal uplift; no Christmas load uplift beyond what the export shows. Route changes are not assumed (vans keep their routes).",
    "Open questions for Ewa next time: grant rules for South/fridge vans, real winter range, midday charging at North, fridge-unit energy use.",
  ];
}

export function generateAssumptionsMd(lines: string[]): string {
  return ["# Assumptions", "", ...lines.map((line) => `- ${line}`), ""].join("\n");
}
