import { analyzeFleet, cleanTrips, deriveExportWeeks, formatCsvValue, type AnalysisParams, type AnalysisResult, type Van } from "./engine.js";
import { tripDateSpan, type CsvRow, type TripSource } from "./ingest.js";

export type ImpactCause = "new data" | "new rule" | "both" | "other";

export interface ImpactRow {
  vanId: string;
  change: "entered" | "left";
  cause: ImpactCause;
  note: string;
}

/** Counterfactual runs: A = old data + old rule, B = all data + old rule, C = old data + new rule. */
export interface ImpactScenarios {
  baseline: AnalysisResult;
  newDataOldRule: AnalysisResult;
  oldDataNewRule: AnalysisResult;
}

/** Van IDs of a previous shortlist.csv (trimmed, blanks and duplicates dropped); needs a van_id column. */
export function parsePreviousShortlist(rows: CsvRow[]): { vanIds: string[]; error?: string } {
  if (rows.length > 0 && !rows.some((row) => Object.prototype.hasOwnProperty.call(row, "van_id"))) {
    return { vanIds: [], error: "Missing column: van_id" };
  }
  const vanIds: string[] = [];
  for (const row of rows) {
    const id = String(row.van_id ?? "").trim();
    if (id && !vanIds.includes(id)) vanIds.push(id);
  }
  return { vanIds };
}

/** The lunch data ends where the earliest trip file ends; with one file, at its last date. */
export function defaultLunchCutoff(files: Array<{ rows: CsvRow[] }>): string {
  const lasts = files.map((f) => tripDateSpan(f.rows)?.last).filter((d): d is string => Boolean(d));
  if (lasts.length === 0) return "";
  const sorted = [...lasts].sort();
  return files.length >= 2 ? sorted[0] : sorted[sorted.length - 1];
}

/** Trip rows dated on or before the cutoff (ISO dates compare as strings), with their sources. */
export function filterTripsUpTo(rows: CsvRow[], sources: TripSource[] | undefined, cutoff: string): { rows: CsvRow[]; sources?: TripSource[] } {
  const keptRows: CsvRow[] = [];
  const keptSources: TripSource[] = [];
  rows.forEach((row, index) => {
    if (String(row.date ?? "").trim() <= cutoff) {
      keptRows.push(row);
      if (sources?.[index]) keptSources.push(sources[index]);
    }
  });
  return { rows: keptRows, sources: sources ? keptSources : undefined };
}

export function runImpactScenarios(input: {
  vans: Van[];
  combinedRows: CsvRow[];
  sources?: TripSource[];
  vanIds: Set<string>;
  aliasMap: Map<string, string>;
  params: AnalysisParams;
  cutoff: string;
}): ImpactScenarios {
  const { vans, combinedRows, sources, vanIds, aliasMap, params, cutoff } = input;
  const oldRule: AnalysisParams = { ...params, rangeRule: "percentile" };
  const old = filterTripsUpTo(combinedRows, sources, cutoff);
  const oldWeeks = deriveExportWeeks(old.rows) || params.exportWeeks;
  const oldCleaning = cleanTrips(old.rows, vanIds, aliasMap, old.sources);
  const allCleaning = cleanTrips(combinedRows, vanIds, aliasMap, sources);

  return {
    baseline: analyzeFleet(vans, oldCleaning, { ...oldRule, exportWeeks: oldWeeks }),
    newDataOldRule: analyzeFleet(vans, allCleaning, oldRule),
    oldDataNewRule: analyzeFleet(vans, oldCleaning, { ...params, exportWeeks: oldWeeks }),
  };
}

const isShortlisted = (result: AnalysisResult, vanId: string): boolean => result.shortlist.some((s) => s.vanId === vanId);

/**
 * Vans that entered or left against the previous shortlist. "other" when the lunch baseline already
 * matches today; otherwise the single change (data or rule) that alone reproduces it, else "both".
 */
export function classifyImpact(previousIds: string[], current: AnalysisResult, scenarios: ImpactScenarios): ImpactRow[] {
  const previous = new Set(previousIds);
  const currentIds = current.shortlist.map((s) => s.vanId);
  const changed = [
    ...previousIds.filter((id) => !currentIds.includes(id)).map((id) => ({ vanId: id, change: "left" as const })),
    ...currentIds.filter((id) => !previous.has(id)).map((id) => ({ vanId: id, change: "entered" as const })),
  ];

  const rows = changed.map(({ vanId, change }): ImpactRow => {
    const now = isShortlisted(current, vanId);
    const before = isShortlisted(scenarios.baseline, vanId);
    let cause: ImpactCause;
    if (before === now) {
      cause = "other";
    } else {
      const byData = isShortlisted(scenarios.newDataOldRule, vanId) !== before;
      const byRule = isShortlisted(scenarios.oldDataNewRule, vanId) !== before;
      cause = byData && !byRule ? "new data" : byRule && !byData ? "new rule" : "both";
    }

    let note: string;
    if (change === "left") {
      const evaluation = current.evaluations.find((e) => e.van.vanId === vanId);
      note = evaluation ? evaluation.exclusionReason ?? "not shortlisted" : "not in current register";
    } else {
      const entry = current.shortlist.find((s) => s.vanId === vanId)!;
      const lunchTrips = scenarios.baseline.vanMetrics.get(vanId)?.tripCount ?? 0;
      note = `now rank ${entry.rank} (${entry.evModel})${lunchTrips === 0 ? "; no trips in lunch data" : ""}`;
    }
    return { vanId, change, cause, note };
  });

  return rows.sort((a, b) => (a.change === b.change ? a.vanId.localeCompare(b.vanId) : a.change === "left" ? -1 : 1));
}

export function generateImpactCsv(rows: ImpactRow[]): string {
  return [
    "van_id,change,cause,note",
    ...rows.map((r) => [formatCsvValue(r.vanId), r.change, r.cause, formatCsvValue(r.note)].join(",")),
  ].join("\n");
}
