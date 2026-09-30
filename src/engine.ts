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

export interface CleaningResult {
  trips: Trip[];
  rowsRead: number;
  exactDuplicatesRemoved: number;
  odometerRepairs: number;
  invalidRowsRemoved: number;
  unknownVanIds: string[];
}

export interface VanMetrics {
  vanId: string;
  depot: "North" | "South";
  refrigerated: boolean;
  ownedOrLeased: "owned" | "leased";
  leaseEndDate?: string;
  p95DayKm: number;
  maxDayKm: number;
  maxLoadKg: number;
  annualKm: number;
}

export interface EligibilityResult {
  vanId: string;
  evModel: string;
  eligible: boolean;
  reason?: string;
  rangeFit?: boolean;
  payloadFit?: boolean;
}

export interface FinancialMetrics {
  vanId: string;
  evModel: string;
  dieselFuelCostPerKm: number;
  evChargingCostPerKm: number;
  annualFuelSavingPln: number;
  annualOperatingSavingPln: number;
  evNetCostPln: number;
  leaseExitFeePln: number;
  savingPln: number;
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

export function cleanTrips(
  rawTrips: any[],
  vanIds: Set<string>,
  aliasMap: Map<string, string>
): CleaningResult {
  const rowsRead = rawTrips.length;
  const seen = new Set<string>();
  let exactDuplicatesRemoved = 0;
  let odometerRepairs = 0;
  let invalidRowsRemoved = 0;
  const unknownVanIds = new Set<string>();
  const cleanedTrips: Trip[] = [];

  for (const row of rawTrips) {
    // Create a signature for duplicate detection
    const signature = JSON.stringify(row);
    if (seen.has(signature)) {
      exactDuplicatesRemoved++;
      continue;
    }
    seen.add(signature);

    // Remap van ID via alias
    let vanId = row.van_id?.toString().trim();
    if (!vanId) {
      invalidRowsRemoved++;
      continue;
    }

    const remappedId = aliasMap.get(vanId) || vanId;
    if (!vanIds.has(remappedId)) {
      unknownVanIds.add(vanId);
      invalidRowsRemoved++;
      continue;
    }

    // Determine distance: prefer odometer_km, fallback to gps_km
    let distanceKm: number | null = null;
    const odometerKm = parseFloat(row.odometer_km);
    const gpsKm = parseFloat(row.gps_km);

    if (!isNaN(odometerKm) && odometerKm > 0) {
      distanceKm = odometerKm;
    } else if (!isNaN(gpsKm) && gpsKm > 0) {
      distanceKm = gpsKm;
      odometerRepairs++;
    } else {
      invalidRowsRemoved++;
      continue;
    }

    const maxLoadKg = parseFloat(row.max_load_kg) || 0;

    cleanedTrips.push({
      date: row.date?.toString().trim(),
      vanId: remappedId,
      distanceKm,
      maxLoadKg,
    });
  }

  return {
    trips: cleanedTrips,
    rowsRead,
    exactDuplicatesRemoved,
    odometerRepairs,
    invalidRowsRemoved,
    unknownVanIds: Array.from(unknownVanIds),
  };
}

export function calculateVanMetrics(
  vans: Van[],
  cleanedTrips: Trip[],
  exportWeeks: number
): Map<string, VanMetrics> {
  const metrics = new Map<string, VanMetrics>();

  // Group trips by van
  const tripsByVan = new Map<string, Trip[]>();
  for (const trip of cleanedTrips) {
    if (!tripsByVan.has(trip.vanId)) {
      tripsByVan.set(trip.vanId, []);
    }
    tripsByVan.get(trip.vanId)!.push(trip);
  }

  for (const van of vans) {
    const trips = tripsByVan.get(van.vanId) || [];

    if (trips.length === 0) {
      metrics.set(van.vanId, {
        vanId: van.vanId,
        depot: van.depot,
        refrigerated: van.refrigerated,
        ownedOrLeased: van.ownedOrLeased,
        leaseEndDate: van.leaseEndDate,
        p95DayKm: 0,
        maxDayKm: 0,
        maxLoadKg: 0,
        annualKm: 0,
      });
      continue;
    }

    // Sum trips by date to get daily distances
    const dailyDistances = new Map<string, number>();
    let totalKm = 0;
    let maxLoadKg = 0;

    for (const trip of trips) {
      const current = dailyDistances.get(trip.date) || 0;
      dailyDistances.set(trip.date, current + trip.distanceKm);
      totalKm += trip.distanceKm;
      maxLoadKg = Math.max(maxLoadKg, trip.maxLoadKg);
    }

    const dailyValues = Array.from(dailyDistances.values()).sort((a, b) => a - b);
    const p95DayKm = percentile(dailyValues, 95);
    const maxDayKm = dailyValues.length > 0 ? dailyValues[dailyValues.length - 1] : 0;
    const annualKm = Math.round((totalKm / exportWeeks) * 52);

    metrics.set(van.vanId, {
      vanId: van.vanId,
      depot: van.depot,
      refrigerated: van.refrigerated,
      ownedOrLeased: van.ownedOrLeased,
      leaseEndDate: van.leaseEndDate,
      p95DayKm: Math.round(p95DayKm * 10) / 10,
      maxDayKm,
      maxLoadKg,
      annualKm,
    });
  }

  return metrics;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const h = ((p / 100) * (sorted.length - 1)) + 1;
  const hFloor = Math.floor(h);
  const hCeil = Math.ceil(h);

  if (hFloor === hCeil) {
    return sorted[hFloor - 1];
  }

  const lower = sorted[hFloor - 1];
  const upper = sorted[hCeil - 1];
  return lower + (h - hFloor) * (upper - lower);
}

export function checkEligibility(
  van: Van,
  vanMetrics: VanMetrics,
  evModel: EVModel,
  usableWltpShare: number
): EligibilityResult {
  // Refrigerated check
  if (van.refrigerated) {
    return {
      vanId: van.vanId,
      evModel: evModel.name,
      eligible: false,
      reason: "Refrigerated",
    };
  }

  // Range check
  const maxRangeKm = evModel.wltpRangeKm * usableWltpShare;
  const rangeFit = vanMetrics.p95DayKm <= maxRangeKm;
  if (!rangeFit) {
    return {
      vanId: van.vanId,
      evModel: evModel.name,
      eligible: false,
      reason: "Range",
      rangeFit: false,
    };
  }

  // Payload check
  const payloadFit = vanMetrics.maxLoadKg <= evModel.payloadKg;
  if (!payloadFit) {
    return {
      vanId: van.vanId,
      evModel: evModel.name,
      eligible: false,
      reason: "Payload",
      payloadFit: false,
    };
  }

  // Depot check - handled in shortlist building
  return {
    vanId: van.vanId,
    evModel: evModel.name,
    eligible: true,
    rangeFit: true,
    payloadFit: true,
  };
}

export function calculateFinancial(
  van: Van,
  vanMetrics: VanMetrics,
  evModel: EVModel,
  dieselModels: Map<string, DieselModel>,
  dieselPricePln: number,
  dieselMaintenancePln: number,
  evMaintenancePln: number,
  nightTariffPln: number,
  grantPercentage: number,
  evaluationYearsMonths: number,
  analysisDate: string,
  leaseExitFeeMonthlyMultiplier: number,
  leaseWindowMonths: number
): FinancialMetrics | null {
  const dieselModel = dieselModels.get(van.dieselModel);
  if (!dieselModel) {
    return null;
  }

  const dieselFuelCostPerKm = (dieselModel.fuelUseLper100km / 100) * dieselPricePln;
  const evChargingCostPerKm = (evModel.energyKwhPer100km / 100) * nightTariffPln;

  const annualFuelSavingPln = Math.round(
    vanMetrics.annualKm * (dieselFuelCostPerKm - evChargingCostPerKm)
  );

  const annualOperatingSavingPln =
    vanMetrics.annualKm *
    ((dieselFuelCostPerKm + dieselMaintenancePln) -
      (evChargingCostPerKm + evMaintenancePln));

  const evNetCostPln = evModel.purchasePricePln * (1 - grantPercentage);

  // Calculate diesel lease exit fee
  let leaseExitFeePln = 0;
  if (van.ownedOrLeased === "leased" && van.leaseEndDate && van.monthlyLeasePln) {
    const leaseEnd = new Date(van.leaseEndDate);
    const analysis = new Date(analysisDate);
    const monthsUntilEnd = (leaseEnd.getFullYear() - analysis.getFullYear()) * 12 +
      (leaseEnd.getMonth() - analysis.getMonth());

    if (monthsUntilEnd > leaseWindowMonths) {
      leaseExitFeePln = van.monthlyLeasePln * leaseExitFeeMonthlyMultiplier;
    }
  }

  const savingPln = Math.round(
    evaluationYearsMonths * annualOperatingSavingPln - evNetCostPln - leaseExitFeePln
  );

  return {
    vanId: van.vanId,
    evModel: evModel.name,
    dieselFuelCostPerKm,
    evChargingCostPerKm,
    annualFuelSavingPln,
    annualOperatingSavingPln,
    evNetCostPln,
    leaseExitFeePln,
    savingPln,
  };
}

export interface CapConfig {
  grantCap: number;
  chargingPointsNorth: number;
  southRebaseCap: number;
}

export function buildShortlist(
  eligibleVans: Array<{
    van: Van;
    metrics: VanMetrics;
    financials: FinancialMetrics;
    evModel: EVModel;
  }>,
  capConfig: CapConfig
): ShortlistEntry[] {
  // Filter to positive savings
  const candidates = eligibleVans
    .filter((item) => item.financials.savingPln > 0)
    .sort((a, b) => {
      if (b.financials.savingPln !== a.financials.savingPln) {
        return b.financials.savingPln - a.financials.savingPln;
      }
      if (b.metrics.annualKm !== a.metrics.annualKm) {
        return b.metrics.annualKm - a.metrics.annualKm;
      }
      return a.van.vanId.localeCompare(b.van.vanId);
    });

  const shortlist: ShortlistEntry[] = [];
  let grantCount = 0;
  let northChargingCount = 0;
  let southRebaseCount = 0;

  for (const item of candidates) {
    const isRebasedSouth = item.van.depot === "South";
    const wouldExceedGrantCap = grantCount >= capConfig.grantCap;
    const wouldExceedChargingCap = northChargingCount >= capConfig.chargingPointsNorth;
    const wouldExceedSouthRebaseCap = isRebasedSouth && southRebaseCount >= capConfig.southRebaseCap;

    if (wouldExceedGrantCap || wouldExceedChargingCap || wouldExceedSouthRebaseCap) {
      // Determine reason for skipping
      let skipReason = "Charger cap";
      if (wouldExceedGrantCap) skipReason = "Grant cap";
      if (wouldExceedSouthRebaseCap) skipReason = "South cap";

      // This van is skipped but we don't add it to results per spec
      continue;
    }

    const evDepot = isRebasedSouth ? "North" : item.van.depot;
    const reason = `${item.van.ownedOrLeased === "owned" ? "Owned" : "Leased"} ${evDepot} van, P95 day ${item.metrics.p95DayKm} km fits 60% of ${item.evModel.name} range, saves ${item.financials.savingPln.toLocaleString("en")} PLN over ${Math.round(item.financials.evNetCostPln / item.financials.annualOperatingSavingPln)} years`;

    shortlist.push({
      rank: shortlist.length + 1,
      vanId: item.van.vanId,
      evModel: item.evModel.name,
      evDepot,
      rangeCheckKm: item.metrics.p95DayKm,
      annualKm: item.metrics.annualKm,
      annualFuelSavingPln: item.financials.annualFuelSavingPln,
      savingPln: item.financials.savingPln,
      reason,
    });

    grantCount++;
    northChargingCount++;
    if (isRebasedSouth) {
      southRebaseCount++;
    }
  }

  return shortlist;
}

export function analyzeFleet(
  vans: Van[],
  cleanedTrips: Trip[],
  exportWeeks: number,
  dieselModels: Map<string, DieselModel>,
  dieselPricePln: number,
  dieselMaintenancePln: number,
  evModels: EVModel[],
  evMaintenancePln: number,
  nightTariffPln: number,
  grantPercentage: number,
  evaluationYears: number,
  analysisDate: string,
  capConfig: CapConfig,
  usableWltpShare: number
): AnalysisResult {
  const vanMetrics = calculateVanMetrics(vans, cleanedTrips, exportWeeks);

  // Calculate financial metrics for all van-EV combinations
  const eligibleVans: Array<{
    van: Van;
    metrics: VanMetrics;
    financials: FinancialMetrics;
    evModel: EVModel;
  }> = [];

  for (const van of vans) {
    const metrics = vanMetrics.get(van.vanId)!;
    let bestFinancial: FinancialMetrics | null = null;
    let bestEvModel: EVModel | null = null;

    for (const evModel of evModels) {
      const eligibility = checkEligibility(van, metrics, evModel, usableWltpShare);
      if (!eligibility.eligible) {
        continue;
      }

      const financial = calculateFinancial(
        van,
        metrics,
        evModel,
        dieselModels,
        dieselPricePln,
        dieselMaintenancePln,
        evMaintenancePln,
        nightTariffPln,
        grantPercentage,
        evaluationYears,
        analysisDate,
        3, // leaseExitFeeMonthlyMultiplier
        12 // leaseWindowMonths
      );

      if (financial && (!bestFinancial || financial.savingPln > bestFinancial.savingPln)) {
        bestFinancial = financial;
        bestEvModel = evModel;
      }
    }

    if (bestFinancial && bestEvModel) {
      eligibleVans.push({
        van,
        metrics,
        financials: bestFinancial,
        evModel: bestEvModel,
      });
    }
  }

  const shortlist = buildShortlist(eligibleVans, capConfig);

  // Calculate summary
  let totalAnnualFuelSavingPln = 0;
  let totalSavingPln = 0;
  for (const entry of shortlist) {
    totalAnnualFuelSavingPln += entry.annualFuelSavingPln;
    totalSavingPln += entry.savingPln;
  }

  return {
    cleaningResult: {
      trips: cleanedTrips,
      rowsRead: 0, // Will be set by caller
      exactDuplicatesRemoved: 0, // Will be set by caller
      odometerRepairs: 0, // Will be set by caller
      invalidRowsRemoved: 0, // Will be set by caller
      unknownVanIds: [],
    },
    vans,
    vanMetrics,
    checkFigures: {
      vansAssessed: vans.length,
      tripsCounted: cleanedTrips.length,
      totalKm: Math.round(cleanedTrips.reduce((sum, trip) => sum + trip.distanceKm, 0)),
    },
    shortlist,
    summary: {
      recommendedCount: shortlist.length,
      annualFuelSavingPln: totalAnnualFuelSavingPln,
      savingPln: totalSavingPln,
    },
  };
}

export function formatCsvValue(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (str.includes(",")) {
    return `"${str}"`;
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

export function generateSummaryCsv(
  vansAssessed: number,
  tripsCounted: number,
  totalKm: number,
  recommendedCount: number,
  annualFuelSavingPln: number,
  savingPln: number
): string {
  const basis =
    "5-year operating saving (diesel fuel + maintenance minus night-tariff charging + EV maintenance) minus EV purchase price net of 30% grant minus diesel lease exit fees; excludes diesel lease payments and resale";

  return [
    "figure,value",
    `vans_assessed,${vansAssessed}`,
    `trips_counted,${tripsCounted}`,
    `total_km,${totalKm}`,
    `recommended_count,${recommendedCount}`,
    `annual_fuel_saving_pln,${annualFuelSavingPln}`,
    `saving_pln,${savingPln}`,
    `saving_basis,"${basis}"`,
  ].join("\n");
}
