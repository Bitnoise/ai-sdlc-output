import * as fs from "fs";
import * as path from "path";
import * as Papa from "papaparse";
import { analyzeFleet, cleanTrips, generateShortlistCsv, DEFAULT_PARAMS, AnalysisParams, Van } from "../src/engine";
import { tripDateSpan } from "../src/ingest";
import {
  classifyImpact,
  defaultLunchCutoff,
  filterTripsUpTo,
  generateImpactCsv,
  parsePreviousShortlist,
  runImpactScenarios,
} from "../src/impact";

function loadFixture(name: string): Array<Record<string, unknown>> {
  const content = fs.readFileSync(path.join(__dirname, "fixtures", name), "utf-8");
  return Papa.parse(content, { header: true, skipEmptyLines: true }).data as Array<Record<string, unknown>>;
}

function van(vanId: string, overrides: Partial<Van> = {}): Van {
  return { vanId, dieselModel: "Brona D35", depot: "North", ownedOrLeased: "owned", refrigerated: false, ...overrides };
}

function trip(vanId: string, date: string, km: number): Record<string, unknown> {
  return { date, van_id: vanId, odometer_km: String(km), gps_km: "", max_load_kg: "800" };
}

const date = (day: number): string => `2026-07-${String(day).padStart(2, "0")}`;
const CUTOFF = date(14);

/** Old data = 1-14 Jul, new data = 15-21 Jul; kmFor(day) gives the van's km on that day. */
function days(vanId: string, from: number, to: number, kmFor: (day: number) => number): Array<Record<string, unknown>> {
  return Array.from({ length: to - from + 1 }, (_, i) => trip(vanId, date(from + i), kmFor(from + i)));
}

const params: AnalysisParams = { ...DEFAULT_PARAMS, analysisDate: "2026-09-30", exportWeeks: 1 };

const vans = [
  van("RULE"), // old data: P95 day fits, worst day (300 km) does not
  van("DATA"), // new data: a week of 300 km days
  van("BOTH"), // new data adds one 250 km day: over the worst-day limit, under the P95 limit
  van("NEWVAN"), // trips only after the cutoff
  van("FRIDGE", { refrigerated: true }),
  van("STEADY"),
  van("KEPT"),
];
const rows = [
  ...days("RULE", 1, 21, (d) => (d === 1 ? 300 : 150)),
  ...days("DATA", 1, 21, (d) => (d <= 14 ? 150 : 300)),
  ...days("BOTH", 1, 21, (d) => (d === 15 ? 250 : 150)),
  ...days("NEWVAN", 15, 21, () => 150),
  ...days("FRIDGE", 1, 21, () => 150),
  ...days("STEADY", 1, 21, () => 150),
  ...days("KEPT", 1, 21, () => 150),
];
const vanIds = new Set(vans.map((v) => v.vanId));
const current = analyzeFleet(vans, cleanTrips(rows, vanIds, new Map()), params);
const scenarios = runImpactScenarios({ vans, combinedRows: rows, vanIds, aliasMap: new Map(), params, cutoff: CUTOFF });
const previous = ["RULE", "DATA", "BOTH", "FRIDGE", "KEPT"];
const impact = classifyImpact(previous, current, scenarios);
const row = (id: string) => impact.find((r) => r.vanId === id);

describe("classifyImpact", () => {
  it("builds the lunch baseline from old data and the old P95 rule", () => {
    expect(scenarios.baseline.shortlist.map((s) => s.vanId).sort()).toEqual(["BOTH", "DATA", "KEPT", "RULE", "STEADY"]);
    expect(current.shortlist.map((s) => s.vanId).sort()).toEqual(["KEPT", "NEWVAN", "STEADY"]);
  });

  it("blames the new rule when the worst day alone excludes the van", () => {
    expect(row("RULE")).toMatchObject({ change: "left", cause: "new rule" });
    expect(row("RULE")!.note).toContain("worst day 300 km exceeds 60%");
  });

  it("blames the new data when the new trips alone exclude or add the van", () => {
    expect(row("DATA")).toMatchObject({ change: "left", cause: "new data" });
    expect(row("NEWVAN")).toMatchObject({ change: "entered", cause: "new data" });
    expect(row("NEWVAN")!.note).toMatch(/^now rank \d+ \(Volta Cargo S\); no trips in lunch data$/);
  });

  it("gives both when neither change alone reproduces it", () => {
    expect(row("BOTH")).toMatchObject({ change: "left", cause: "both" });
  });

  it("gives other when the lunch baseline already matches today", () => {
    expect(row("FRIDGE")).toMatchObject({ change: "left", cause: "other" });
    expect(row("FRIDGE")!.note).toContain("Refrigerated van");
    expect(row("STEADY")).toMatchObject({ change: "entered", cause: "other" });
    expect(row("STEADY")!.note).not.toContain("no trips in lunch data");
  });

  it("gives other for a grant-cap drop and a van no longer in the register", () => {
    const capped = analyzeFleet(vans, cleanTrips(rows, vanIds, new Map()), { ...params, grantCap: 1 });
    const capScenarios = runImpactScenarios({ vans, combinedRows: rows, vanIds, aliasMap: new Map(), params: { ...params, grantCap: 1 }, cutoff: CUTOFF });
    const dropped = classifyImpact(["KEPT", "STEADY", "GONE"], capped, capScenarios);
    const notFirst = ["KEPT", "STEADY"].find((id) => id !== capped.shortlist[0].vanId)!;
    expect(dropped.find((r) => r.vanId === notFirst)).toMatchObject({ change: "left", cause: "other" });
    expect(dropped.find((r) => r.vanId === "GONE")).toEqual({ vanId: "GONE", change: "left", cause: "other", note: "not in current register" });
  });

  it("leaves out vans that are in both shortlists and sorts left before entered", () => {
    expect(row("KEPT")).toBeUndefined();
    expect(impact.map((r) => r.vanId)).toEqual(["BOTH", "DATA", "FRIDGE", "RULE", "NEWVAN", "STEADY"]);
    expect(impact.every((r) => r.change === "entered" || r.change === "left")).toBe(true);
  });
});

describe("generateImpactCsv", () => {
  it("writes van_id,change,cause,note and quotes notes with commas", () => {
    const csv = generateImpactCsv([{ vanId: "P-01", change: "left", cause: "new rule", note: "worst day 240 km, too long" }]);
    expect(csv.split("\n")).toEqual(["van_id,change,cause,note", 'P-01,left,new rule,"worst day 240 km, too long"']);
    const parsed = Papa.parse(generateImpactCsv(impact), { header: true, skipEmptyLines: true }).data as Array<Record<string, string>>;
    expect(parsed.map((r) => r.van_id)).toEqual(impact.map((r) => r.vanId));
    expect(parsed.find((r) => r.van_id === "RULE")!.note).toBe(row("RULE")!.note);
  });
});

describe("parsePreviousShortlist", () => {
  it("reads the app's own shortlist.csv", () => {
    const parsed = Papa.parse(generateShortlistCsv(current.shortlist), { header: true, skipEmptyLines: true }).data as Array<Record<string, unknown>>;
    expect(parsePreviousShortlist(parsed)).toEqual({ vanIds: current.shortlist.map((s) => s.vanId) });
  });

  it("trims, drops blanks and duplicates", () => {
    expect(parsePreviousShortlist([{ van_id: " P-01 " }, { van_id: "" }, { van_id: "P-01" }, { van_id: "P-02" }])).toEqual({ vanIds: ["P-01", "P-02"] });
  });

  it("reports a missing van_id column", () => {
    expect(parsePreviousShortlist([{ rank: "1", vehicle: "P-01" }]).error).toBe("Missing column: van_id");
  });
});

describe("lunch cutoff", () => {
  const tripsRows = loadFixture("trips.csv");
  const latestRows = loadFixture("trips_latest.csv");

  it("defaults to the end of the earliest trip file", () => {
    const tripsEnd = tripDateSpan(tripsRows)!.last;
    expect(defaultLunchCutoff([{ rows: latestRows }, { rows: tripsRows }])).toBe(tripsEnd);
    expect(tripsEnd < tripDateSpan(latestRows)!.first).toBe(true);
    expect(defaultLunchCutoff([{ rows: latestRows }])).toBe(tripDateSpan(latestRows)!.last);
    expect(defaultLunchCutoff([])).toBe("");
  });

  it("keeps rows and sources up to the cutoff", () => {
    const sources = rows.map((_, i) => ({ file: "t.csv", line: i + 2 }));
    const kept = filterTripsUpTo(rows, sources, CUTOFF);
    expect(kept.rows.every((r) => String(r.date) <= CUTOFF)).toBe(true);
    expect(kept.rows.length).toBe(kept.sources!.length);
    expect(kept.rows.length).toBe(6 * 14);
  });
});
