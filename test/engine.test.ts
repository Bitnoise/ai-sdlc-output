import * as fs from "fs";
import * as path from "path";
import * as Papa from "papaparse";
import {
  cleanTrips,
  calculateVanMetrics,
  percentile,
  leaseExitFee,
  analyzeFleet,
  generateShortlistCsv,
  generateSummaryCsv,
  formatCsvValue,
  DEFAULT_PARAMS,
  AnalysisParams,
  Van,
} from "../src/engine";

const REFRIGERATED = ["P-03", "P-07", "P-19", "P-23", "P-34", "P-35"];
const ALIASES = new Map([["P-17", "P-17B"]]);

function params(overrides: Partial<AnalysisParams> = {}): AnalysisParams {
  return { ...DEFAULT_PARAMS, analysisDate: "2026-09-30", exportWeeks: 13, ...overrides };
}

function loadFixture(name: string): Array<Record<string, unknown>> {
  const content = fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
  return (Papa.parse(content, { header: true, skipEmptyLines: true }).data as Array<Record<string, unknown>>);
}

function toVans(rows: Array<Record<string, unknown>>): Van[] {
  return rows.map((row) => ({
    vanId: String(row.van_id).trim(),
    dieselModel: String(row.diesel_model).trim(),
    depot: String(row.depot) as "North" | "South",
    ownedOrLeased: String(row.owned_or_leased) as "owned" | "leased",
    leaseEndDate: row.lease_end ? String(row.lease_end) : undefined,
    monthlyLeasePln: row.monthly_lease_pln ? Number(row.monthly_lease_pln) : undefined,
    refrigerated: row.refrigerated === "yes",
  }));
}

function van(vanId: string, overrides: Partial<Van> = {}): Van {
  return { vanId, dieselModel: "Brona D35", depot: "North", ownedOrLeased: "owned", refrigerated: false, ...overrides };
}

function trip(vanId: string, date: string, km: number | string, load = 800, gps: number | string = ""): Record<string, unknown> {
  return { date, van_id: vanId, odometer_km: String(km), gps_km: String(gps), max_load_kg: String(load) };
}

/** One week of daily routes; with exportWeeks = 1, annual km = 52 x weekly km. */
function week(vanId: string, kmPerDay: number, load = 800): Array<Record<string, unknown>> {
  return [1, 2, 3, 4, 5, 6, 7].map((d) => trip(vanId, `2026-07-0${d}`, kmPerDay, load));
}

function runSynthetic(vans: Van[], rows: Array<Record<string, unknown>>, overrides: Partial<AnalysisParams> = {}) {
  const cleaning = cleanTrips(rows, new Set(vans.map((v) => v.vanId)), new Map());
  return analyzeFleet(vans, cleaning, params({ exportWeeks: 1, ...overrides }));
}

describe("engine with the sample fixtures", () => {
  const vans = toVans(loadFixture("vans.csv"));
  const rawTrips = loadFixture("trips.csv");
  const vanIds = new Set(vans.map((v) => v.vanId));
  const cleaning = cleanTrips(rawTrips, vanIds, ALIASES);
  const result = analyzeFleet(vans, cleaning, params());
  // The acceptance figures apply to the full sample export (2777 trips + 222 duplicates).
  const itFullSample = rawTrips.length === 2999 ? it : it.skip;

  itFullSample("matches the acceptance check figures", () => {
    expect(cleaning.rowsRead).toBe(2999);
    expect(cleaning.exactDuplicatesRemoved).toBe(222);
    expect(result.checkFigures).toEqual({ vansAssessed: 38, tripsCounted: 2777, totalKm: 344952 });
  });

  it("assesses all 38 vans in the register", () => {
    expect(result.checkFigures.vansAssessed).toBe(38);
    expect(result.evaluations).toHaveLength(38);
    expect(result.checkFigures.tripsCounted).toBe(cleaning.trips.length);
    expect(result.checkFigures.totalKm).toBe(Math.round(cleaning.trips.reduce((s, t) => s + t.distanceKm, 0)));
  });

  it("removes exact duplicates", () => {
    expect(cleaning.exactDuplicatesRemoved).toBeGreaterThan(0);
    expect(cleaning.rowsRead).toBe(rawTrips.length);
  });

  it("repairs the negative odometer row with its GPS distance", () => {
    expect(cleaning.odometerRepairs).toBe(1);
    expect(cleaning.repairs[0]).toMatchObject({ odometerRaw: "-208.6", gpsKm: 90.3 });
    expect(cleaning.trips.some((t) => t.distanceKm === 90.3)).toBe(true);
  });

  it("evaluates every EV model for every van", () => {
    for (const e of result.evaluations) {
      expect(e.models.map((m) => m.evModel)).toEqual(["Volta Cargo S", "Volta Cargo L"]);
      expect(e.status === "shortlisted" || e.exclusionCode !== undefined).toBe(true);
    }
  });

  it("excludes refrigerated vans and never shortlists them", () => {
    for (const id of REFRIGERATED) {
      const e = result.evaluations.find((x) => x.van.vanId === id)!;
      expect(e.exclusionCode).toBe("refrigerated");
      expect(e.status).toBe("excluded");
    }
    expect(result.shortlist.some((s) => REFRIGERATED.includes(s.vanId))).toBe(false);
  });

  it("does not code fridge vans as refrigerated when the toggle is off", () => {
    const r = analyzeFleet(vans, cleaning, params({ excludeRefrigerated: false }));
    for (const id of REFRIGERATED) {
      expect(r.evaluations.find((x) => x.van.vanId === id)!.exclusionCode).not.toBe("refrigerated");
    }
  });

  it("respects the grant and South caps", () => {
    expect(result.shortlist.length).toBeLessThanOrEqual(10);
    const southRegister = result.shortlist.filter((s) => vans.find((v) => v.vanId === s.vanId)!.depot === "South");
    expect(southRegister.length).toBeLessThanOrEqual(3);
    expect(result.shortlist.every((s) => s.evDepot === "North")).toBe(true);
  });

  it("picks the eligible model with the highest saving", () => {
    for (const e of result.evaluations.filter((x) => x.bestModel)) {
      const savings = e.models.filter((m) => m.eligible).map((m) => m.savingPln!);
      expect(e.bestModel!.savingPln).toBe(Math.max(...savings));
    }
  });

  it("ranks the shortlist by saving and writes the reason sentence", () => {
    result.shortlist.forEach((s, i) => {
      expect(s.rank).toBe(i + 1);
      if (i > 0) expect(s.savingPln).toBeLessThanOrEqual(result.shortlist[i - 1].savingPln);
      expect(s.reason).toContain("60%");
      expect(s.reason).toContain(s.evModel);
      expect(s.reason).toContain("over 5 years");
    });
  });
});

describe("cleanTrips", () => {
  const ids = new Set(["P-01", "P-17B"]);

  it("removes only rows where all columns are identical", () => {
    const rows = [trip("P-01", "2026-07-01", 100), trip("P-01", "2026-07-01", 100), trip("P-01", "2026-07-01", 100), trip("P-01", "2026-07-01", 101)];
    const r = cleanTrips(rows, ids, new Map());
    expect(r.exactDuplicatesRemoved).toBe(2);
    expect(r.trips).toHaveLength(2);
  });

  it("remaps aliased van IDs to the register ID", () => {
    const r = cleanTrips([trip("P-17", "2026-08-01", 80), trip("P-17B", "2026-08-02", 90)], ids, ALIASES);
    expect(r.aliasRemaps).toBe(1);
    expect(r.trips.map((t) => t.vanId)).toEqual(["P-17B", "P-17B"]);
    expect(r.unknownVanIds).toEqual([]);
  });

  it("keeps the original ID when the alias target is not in the register", () => {
    const r = cleanTrips([trip("P-17", "2026-08-01", 80)], new Set(["P-17"]), ALIASES);
    expect(r.trips[0].vanId).toBe("P-17");
    expect(r.aliasRemaps).toBe(0);
  });

  it("falls back to GPS for a missing, zero or negative odometer and drops rows without a distance", () => {
    const rows = [
      trip("P-01", "2026-07-01", -208.6, 800, 90.3),
      trip("P-01", "2026-07-02", "", 800, 50),
      trip("P-01", "2026-07-03", 0, 800, 40),
      trip("P-01", "2026-07-04", "abc", 800, ""),
      trip("P-01", "2026-07-05", 120, 800, ""),
    ];
    const r = cleanTrips(rows, ids, new Map());
    expect(r.trips.map((t) => t.distanceKm)).toEqual([90.3, 50, 40, 120]);
    expect(r.odometerRepairs).toBe(3);
    expect(r.invalidRowsRemoved).toBe(1);
    expect(r.dropped[0]).toMatchObject({ line: 5, reason: "both odometer_km and gps_km unusable" });
    expect(r.blankGps).toBe(2);
  });

  it("logs unknown van IDs", () => {
    const r = cleanTrips([trip("P-99", "2026-07-01", 100)], ids, new Map());
    expect(r.unknownVanIds).toEqual(["P-99"]);
    expect(r.trips).toHaveLength(0);
  });
});

describe("percentile", () => {
  it("interpolates linearly like PERCENTILE.INC", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBeCloseTo(9.55, 10);
    expect(percentile([50, 15, 40, 35, 20], 40)).toBeCloseTo(29, 10);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 95)).toBe(0);
  });
});

describe("calculateVanMetrics", () => {
  it("sums two routes on one date into one day", () => {
    const rows = [trip("P-01", "2026-07-01", 90, 700), trip("P-01", "2026-07-01", 70, 950), trip("P-01", "2026-07-02", 100, 600)];
    const cleaning = cleanTrips(rows, new Set(["P-01"]), new Map());
    const m = calculateVanMetrics([van("P-01")], cleaning.trips, 13).get("P-01")!;
    expect(m.dayCount).toBe(2);
    expect(m.maxDayKm).toBe(160);
    expect(m.maxRouteKm).toBe(100);
    expect(m.p95DayKm).toBe(157); // 100 + 0.95 * 60
    expect(m.maxLoadKg).toBe(950);
    expect(m.annualKm).toBe(Math.round((260 / 13) * 52));
  });
});

describe("leaseExitFee", () => {
  const leased = van("P-02", { ownedOrLeased: "leased", leaseEndDate: "2027-09-30", monthlyLeasePln: 2500 });

  it("is 0 for owned vans", () => {
    expect(leaseExitFee(van("P-01"), "2026-09-30", 12, 3)).toBe(0);
  });

  it("is 0 when the lease ends within the window (boundary included)", () => {
    expect(leaseExitFee(leased, "2026-09-30", 12, 3)).toBe(0);
    expect(leaseExitFee({ ...leased, leaseEndDate: "2026-12-01" }, "2026-09-30", 12, 3)).toBe(0);
  });

  it("is multiplier x monthly lease when the lease ends later", () => {
    expect(leaseExitFee({ ...leased, leaseEndDate: "2027-10-01" }, "2026-09-30", 12, 3)).toBe(7500);
    expect(leaseExitFee({ ...leased, leaseEndDate: "2027-04-01" }, "2026-09-30", 6, 2)).toBe(5000);
    expect(leaseExitFee({ ...leased, leaseEndDate: "2027-03-30" }, "2026-09-30", 6, 2)).toBe(0);
  });

  it("is subtracted from the saving", () => {
    const vans = [van("P-01"), van("P-02", { ownedOrLeased: "leased", leaseEndDate: "2029-01-01", monthlyLeasePln: 2500 })];
    const r = runSynthetic(vans, [...week("P-01", 120), ...week("P-02", 120)]);
    const [owned, lease] = r.evaluations;
    expect(owned.bestModel!.savingPln! - lease.bestModel!.savingPln!).toBe(7500);
    expect(lease.bestModel!.leaseExitFeePln).toBe(7500);
  });
});

describe("exclusion reasons", () => {
  it("codes range, payload, negative saving and unknown diesel model", () => {
    const vans = [
      van("RANGE"),
      van("PAYLOAD"),
      van("LOWKM"),
      van("UNKNOWN", { dieselModel: "Mystery" }),
      van("NOTRIPS"),
    ];
    const rows = [...week("RANGE", 240), ...week("PAYLOAD", 120, 1200), trip("LOWKM", "2026-07-01", 50), ...week("UNKNOWN", 120)];
    const r = runSynthetic(vans, rows);
    const code = (id: string) => r.evaluations.find((e) => e.van.vanId === id)!.exclusionCode;
    expect(code("RANGE")).toBe("range");
    expect(code("PAYLOAD")).toBe("payload");
    expect(code("LOWKM")).toBe("negative_saving");
    expect(code("UNKNOWN")).toBe("unknown_diesel_model");
    expect(code("NOTRIPS")).toBe("no_trips");
    const low = r.evaluations.find((e) => e.van.vanId === "LOWKM")!;
    expect(low.bestModel).not.toBeNull();
    expect(low.exclusionReason).toContain("not positive");
    expect(r.shortlist).toHaveLength(0);
  });

  it("checks range per route when midday top-up is on", () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].flatMap((d) => [
      trip("P-01", `2026-07-0${d}`, 130, 800),
      trip("P-01", `2026-07-0${d}`, 130, 800, 129),
    ]);
    const off = runSynthetic([van("P-01")], rows);
    expect(off.rangeBasis).toBe("day");
    expect(off.evaluations[0].exclusionCode).toBe("range");
    expect(off.evaluations[0].models[0].rangeCheckKm).toBe(260);

    const on = runSynthetic([van("P-01")], rows, { middayTopup: true });
    expect(on.rangeBasis).toBe("route");
    expect(on.evaluations[0].models[0].rangeCheckKm).toBe(130);
    expect(on.evaluations[0].status).toBe("shortlisted");
    expect(on.shortlist[0].reason).toContain("P95 route 130 km");
  });
});

describe("cap enforcement", () => {
  const northFleet = [van("N1"), van("N2"), van("N3"), van("N4")];
  const northTrips = [...week("N1", 150), ...week("N2", 140), ...week("N3", 130), ...week("N4", 120)];

  it("skips vans beyond the grant cap", () => {
    const r = runSynthetic(northFleet, northTrips, { grantCap: 2 });
    expect(r.shortlist.map((s) => s.vanId)).toEqual(["N1", "N2"]);
    expect(r.evaluations.slice(2).map((e) => e.exclusionCode)).toEqual(["grant_cap", "grant_cap"]);
  });

  it("skips vans beyond the charging points", () => {
    const r = runSynthetic(northFleet, northTrips, { chargingPointsNorth: 3 });
    expect(r.shortlist).toHaveLength(3);
    expect(r.evaluations[3].exclusionCode).toBe("charger_cap");
  });

  it("re-bases South vans at North up to the South cap", () => {
    const fleet = [van("S1", { depot: "South" }), van("S2", { depot: "South" }), van("N1")];
    const rows = [...week("S1", 150), ...week("S2", 140), ...week("N1", 120)];
    const r = runSynthetic(fleet, rows, { southRebaseCap: 1 });
    expect(r.shortlist.map((s) => [s.vanId, s.evDepot])).toEqual([["S1", "North"], ["N1", "North"]]);
    expect(r.evaluations[1].exclusionCode).toBe("south_cap");
    expect(r.shortlist[0].reason).toContain("South van re-based to North");
  });

  it("breaks saving ties by annual km, then van ID", () => {
    const r = runSynthetic([van("B"), van("A")], [...week("B", 120), ...week("A", 120)]);
    expect(r.shortlist.map((s) => s.vanId)).toEqual(["A", "B"]);
  });
});

describe("CSV formatting", () => {
  const entry = {
    rank: 1,
    vanId: "P-01",
    evModel: "Volta Cargo S",
    evDepot: "North" as const,
    rangeCheckKm: 145,
    annualKm: 12000,
    annualFuelSavingPln: 4320,
    savingPln: 21710,
    reason: "Owned North van, P95 day 145 km fits 60% of Volta Cargo S range, saves 21,710 PLN over 5 years",
  };

  it("writes shortlist columns in order with dot decimals and no thousands separators", () => {
    const [header, row] = generateShortlistCsv([entry]).split("\n");
    expect(header).toBe("rank,van_id,ev_model,ev_depot,range_check_km,annual_km,annual_fuel_saving_pln,saving_pln,reason");
    expect(row).toBe(`1,P-01,Volta Cargo S,North,145.0,12000,4320,21710,"${entry.reason}"`);
  });

  it("quotes commas, quotes and newlines", () => {
    expect(formatCsvValue("a,b")).toBe('"a,b"');
    expect(formatCsvValue('say "hi"')).toBe('"say ""hi"""');
    expect(formatCsvValue("plain")).toBe("plain");
    expect(formatCsvValue(12.5)).toBe("12.5");
  });

  it("writes summary rows in order", () => {
    const lines = generateSummaryCsv(38, 2777, 344952, 10, 50000, 200000).split("\n");
    expect(lines.map((l) => l.split(",")[0])).toEqual([
      "figure",
      "vans_assessed",
      "trips_counted",
      "total_km",
      "recommended_count",
      "annual_fuel_saving_pln",
      "saving_pln",
      "saving_basis",
    ]);
    expect(lines[3]).toBe("total_km,344952");
  });
});
