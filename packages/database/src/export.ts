import type { SqliteDatabase } from "./sqlite-driver.js";
import { browseTable, type BrowseOptions } from "./query.js";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function exportTable(
  db: SqliteDatabase,
  table: string,
  format: "json" | "csv",
  opts: BrowseOptions = {},
) {
  const result = browseTable(db, table, {
    ...opts,
    page: 1,
    pageSize: Math.min(5000, opts.pageSize ?? 1000),
  });

  if (format === "json") {
    return {
      contentType: "application/json; charset=utf-8",
      filename: `${table}.json`,
      body: JSON.stringify(
        { table, columns: result.columns, rows: result.rows },
        null,
        2,
      ),
    };
  }

  const header = result.columns.map(csvEscape).join(",");
  const lines = result.rows.map((row) =>
    result.columns.map((col) => csvEscape(row[col])).join(","),
  );
  return {
    contentType: "text/csv; charset=utf-8",
    filename: `${table}.csv`,
    body: [header, ...lines].join("\n"),
  };
}
