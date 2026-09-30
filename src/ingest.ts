import { formatCsvValue, resolveVanId } from "./engine";

export type CsvRow = Record<string, unknown>;

export interface HeaderRename {
  from: string;
  to: string;
}

/** Vendor column names mapped to the names the form expects. Values are never changed. */
export const VAN_HEADER_ALIASES: Record<string, string> = {
  model: "diesel_model",
  ownership: "owned_or_leased",
};

export const TRIP_HEADER_ALIASES: Record<string, string> = {
  odo_km: "odometer_km",
};

export const REQUIRED_VAN_COLUMNS = ["van_id", "diesel_model", "depot", "owned_or_leased", "lease_end", "monthly_lease_pln", "refrigerated"];
export const REQUIRED_TRIP_COLUMNS = ["date", "van_id", "odometer_km", "gps_km", "max_load_kg"];

function columnsOf(rows: CsvRow[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

/** Renames aliased columns (keeping column order and values) when the target column is absent. */
export function normalizeHeaders(rows: CsvRow[], aliases: Record<string, string>): { rows: CsvRow[]; renamed: HeaderRename[] } {
  const columns = columnsOf(rows);
  const present = new Set(columns);
  const renamed: HeaderRename[] = [];
  const mapping = new Map<string, string>();
  for (const column of columns) {
    const target = aliases[column];
    if (target && !present.has(target)) {
      mapping.set(column, target);
      renamed.push({ from: column, to: target });
    }
  }
  if (mapping.size === 0) return { rows, renamed };

  const out = rows.map((row) => {
    const next: CsvRow = {};
    for (const key of Object.keys(row)) next[mapping.get(key) ?? key] = row[key];
    return next;
  });
  return { rows: out, renamed };
}

export function missingColumns(rows: CsvRow[], required: string[]): string[] {
  const present = new Set(columnsOf(rows));
  return required.filter((column) => !present.has(column));
}

export interface TripSource {
  file: string;
  line: number;
}

/** Stacks several trip files into one history with one column order; sources[i] tells where row i came from. */
export function combineTripFiles(files: Array<{ name: string; rows: CsvRow[] }>): { rows: CsvRow[]; sources: TripSource[]; columns: string[] } {
  const columns = columnsOf(files.flatMap((f) => f.rows));
  const rows: CsvRow[] = [];
  const sources: TripSource[] = [];
  for (const file of files) {
    file.rows.forEach((row, index) => {
      const next: CsvRow = {};
      for (const column of columns) next[column] = row[column] ?? "";
      rows.push(next);
      sources.push({ file: file.name, line: index + 2 }); // header is line 1
    });
  }
  return { rows, sources, columns };
}

/** Trip van IDs that are neither in the register nor mapped by an alias to a register ID. */
export function findUnknownVanIds(tripRows: CsvRow[], vanIds: Set<string>, aliasMap: Map<string, string>): string[] {
  const unknown = new Set<string>();
  for (const row of tripRows) {
    const vanId = String(row.van_id ?? "").trim();
    if (!vanIds.has(resolveVanId(vanId, aliasMap, vanIds))) unknown.add(vanId);
  }
  return Array.from(unknown);
}

/** First and last valid YYYY-MM-DD trip date, or null when there is none. */
export function tripDateSpan(rows: CsvRow[]): { first: string; last: string } | null {
  let first = "";
  let last = "";
  for (const row of rows) {
    const text = String(row.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(`${text}T00:00:00Z`))) continue;
    if (!first || text < first) first = text;
    if (!last || text > last) last = text;
  }
  return first ? { first, last } : null;
}

function toCsv(rows: CsvRow[], columns: string[]): string {
  const lines = [columns.map(formatCsvValue).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => formatCsvValue(row[column] === undefined ? "" : String(row[column]))).join(","));
  }
  return lines.join("\n");
}

/** Van register with the target column names (rename first), values unchanged. */
export function normalizedVansCsv(rows: CsvRow[]): string {
  const normalized = normalizeHeaders(rows, VAN_HEADER_ALIASES).rows;
  return toCsv(normalized, columnsOf(normalized));
}

/** Combined trips with the target column names; van_id is written alias-resolved (e.g. P-17 -> P-17B), other values unchanged. */
export function normalizedTripsCsv(rows: CsvRow[], vanIds: Set<string>, aliasMap: Map<string, string>): string {
  const normalized = normalizeHeaders(rows, TRIP_HEADER_ALIASES).rows.map((row) => ({
    ...row,
    van_id: resolveVanId(String(row.van_id ?? "").trim(), aliasMap, vanIds),
  }));
  return toCsv(normalized, columnsOf(normalized));
}
