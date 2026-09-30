import * as fs from "fs";
import * as path from "path";
import * as Papa from "papaparse";
import { analyzeFleet, cleanTrips, deriveExportWeeks, generateAssumptions, DEFAULT_PARAMS, Van } from "../src/engine";
import {
  combineTripFiles,
  findUnknownVanIds,
  missingColumns,
  normalizedTripsCsv,
  normalizedVansCsv,
  normalizeHeaders,
  REQUIRED_TRIP_COLUMNS,
  REQUIRED_VAN_COLUMNS,
  TRIP_HEADER_ALIASES,
  tripDateSpan,
  VAN_HEADER_ALIASES,
} from "../src/ingest";

const ALIASES = new Map([["P-17", "P-17B"]]);

function loadFixture(name: string): Array<Record<string, unknown>> {
  const content = fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
  return Papa.parse(content, { header: true, skipEmptyLines: true }).data as Array<Record<string, unknown>>;
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

const rawVansLatest = loadFixture("vans_latest.csv");
const vansLatest = normalizeHeaders(rawVansLatest, VAN_HEADER_ALIASES);
const trips = normalizeHeaders(loadFixture("trips.csv"), TRIP_HEADER_ALIASES);
const tripsLatest = normalizeHeaders(loadFixture("trips_latest.csv"), TRIP_HEADER_ALIASES);
const vanIds = new Set(vansLatest.rows.map((r) => String(r.van_id)));
const combined = combineTripFiles([
  { name: "trips.csv", rows: trips.rows },
  { name: "trips_latest.csv", rows: tripsLatest.rows },
]);

describe("normalizeHeaders", () => {
  it("maps model and ownership to diesel_model and owned_or_leased, keeping values", () => {
    expect(vansLatest.renamed).toEqual([
      { from: "model", to: "diesel_model" },
      { from: "ownership", to: "owned_or_leased" },
    ]);
    const first = vansLatest.rows[1];
    expect(first).toEqual({
      van_id: "P-02",
      diesel_model: "Kestrel Cargo 3.5",
      depot: "North",
      owned_or_leased: "leased",
      lease_end: "2027-02-15",
      monthly_lease_pln: "2500",
      refrigerated: "no",
    });
    expect(Object.keys(first)).toEqual(REQUIRED_VAN_COLUMNS);
  });

  it("maps odo_km to odometer_km, keeping values", () => {
    expect(tripsLatest.renamed).toEqual([{ from: "odo_km", to: "odometer_km" }]);
    expect(tripsLatest.rows[0].odometer_km).toBe("132.4");
    expect(tripsLatest.rows[0]).not.toHaveProperty("odo_km");
  });

  it("leaves files that already use the target names alone", () => {
    expect(trips.renamed).toEqual([]);
    expect(normalizeHeaders([{ odo_km: "1", odometer_km: "2" }], TRIP_HEADER_ALIASES).renamed).toEqual([]);
  });

  it("reports the missing van columns before normalization and none after", () => {
    expect(missingColumns(rawVansLatest, REQUIRED_VAN_COLUMNS)).toEqual(["diesel_model", "owned_or_leased"]);
    expect(missingColumns(vansLatest.rows, REQUIRED_VAN_COLUMNS)).toEqual([]);
    expect(missingColumns(loadFixture("trips_latest.csv"), REQUIRED_TRIP_COLUMNS)).toEqual(["odometer_km"]);
    expect(missingColumns(tripsLatest.rows, REQUIRED_TRIP_COLUMNS)).toEqual([]);
    expect(missingColumns(trips.rows, REQUIRED_TRIP_COLUMNS)).toEqual([]);
  });
});

describe("combineTripFiles", () => {
  it("stacks both trip files with one column order and file/line sources", () => {
    expect(combined.rows).toHaveLength(trips.rows.length + tripsLatest.rows.length);
    expect(combined.columns).toEqual(Object.keys(trips.rows[0]));
    for (const row of combined.rows) expect(Object.keys(row)).toEqual(combined.columns);
    expect(combined.sources[0]).toEqual({ file: "trips.csv", line: 2 });
    expect(combined.sources[trips.rows.length]).toEqual({ file: "trips_latest.csv", line: 2 });
  });

  it("removes exact duplicates across files once and reports file and line", () => {
    const a = [{ date: "2026-09-13", van_id: "P-01", odometer_km: "100", gps_km: "", max_load_kg: "800" }];
    const b = [
      { date: "2026-09-13", van_id: "P-01", odo_km: "100", gps_km: "", max_load_kg: "800" },
      { date: "2026-09-14", van_id: "P-01", odo_km: "-5", gps_km: "60", max_load_kg: "800" },
    ];
    const both = combineTripFiles([
      { name: "trips.csv", rows: a },
      { name: "trips_latest.csv", rows: normalizeHeaders(b, TRIP_HEADER_ALIASES).rows },
    ]);
    const r = cleanTrips(both.rows, new Set(["P-01"]), new Map(), both.sources);
    expect(r.exactDuplicatesRemoved).toBe(1);
    expect(r.trips.map((t) => t.distanceKm)).toEqual([100, 60]);
    expect(r.repairs[0]).toMatchObject({ file: "trips_latest.csv", line: 3 });
  });
});

describe("van ID check", () => {
  it("finds no unknown IDs for vans_latest + trips + trips_latest with the P-17 -> P-17B alias", () => {
    expect(findUnknownVanIds(trips.rows, vanIds, ALIASES)).toEqual([]);
    expect(findUnknownVanIds(tripsLatest.rows, vanIds, ALIASES)).toEqual([]);
    expect(findUnknownVanIds(combined.rows, vanIds, ALIASES)).toEqual([]);
  });

  it("reports P-17 as unknown without the alias", () => {
    expect(findUnknownVanIds(trips.rows, vanIds, new Map())).toEqual(["P-17"]);
    expect(findUnknownVanIds(tripsLatest.rows, vanIds, new Map())).toEqual([]);
  });
});

describe("combined export", () => {
  it("spans 2026-06-15 to 2026-09-27, 15 export weeks", () => {
    expect(tripDateSpan(combined.rows)).toEqual({ first: "2026-06-15", last: "2026-09-27" });
    expect(deriveExportWeeks(combined.rows)).toBe(15);
  });

  it("assesses all 40 vans in the latest register, including P-17B, P-39 and P-40", () => {
    const vans = toVans(vansLatest.rows);
    const cleaning = cleanTrips(combined.rows, vanIds, ALIASES, combined.sources);
    const result = analyzeFleet(vans, cleaning, { ...DEFAULT_PARAMS, analysisDate: "2026-09-30", exportWeeks: 15 });
    expect(result.checkFigures.vansAssessed).toBe(40);
    expect(cleaning.unknownVanIds).toEqual([]);
    for (const id of ["P-17B", "P-39", "P-40"]) {
      expect(result.vanMetrics.get(id)!.tripCount).toBeGreaterThan(0);
    }
  });
});

describe("normalized CSV copies", () => {
  it("writes vans.csv with diesel_model and owned_or_leased", () => {
    const lines = normalizedVansCsv(rawVansLatest).split("\n");
    expect(lines[0]).toBe(REQUIRED_VAN_COLUMNS.join(","));
    expect(lines[2]).toBe("P-02,Kestrel Cargo 3.5,North,leased,2027-02-15,2500,no");
    expect(lines).toHaveLength(41);
  });

  it("writes trips.csv with odometer_km and P-17B instead of P-17", () => {
    const csv = normalizedTripsCsv(combined.rows, vanIds, ALIASES);
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true }).data as Array<Record<string, unknown>>;
    expect(csv.split("\n")[0]).toBe("date,van_id,driver,origin,destination,odometer_km,gps_km,max_load_kg,refrigerated");
    expect(parsed).toHaveLength(combined.rows.length);
    expect(parsed.some((r) => r.van_id === "P-17")).toBe(false);
    expect(parsed.some((r) => r.van_id === "P-17B")).toBe(true);
    expect(missingColumns(parsed, REQUIRED_TRIP_COLUMNS)).toEqual([]);
    expect(findUnknownVanIds(parsed, vanIds, new Map())).toEqual([]);
  });
});

describe("assumptions", () => {
  it("state the combined exports, the header mapping and the P-17 -> P-17B decision", () => {
    const all = generateAssumptions({ ...DEFAULT_PARAMS, analysisDate: "2026-09-30" }).join("\n");
    expect(all).toContain("Trip exports are combined into one history");
    expect(all).toContain("latest van register");
    expect(all).toContain("odo_km");
    expect(all).toContain("P-17 in the older trips export is the van registered as P-17B");
  });
});
