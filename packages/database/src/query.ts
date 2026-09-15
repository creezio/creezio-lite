import type { SqliteDatabase } from "./sqlite-driver.js";
import { isSafeIdentifier, quoteIdent } from "./identifiers.js";
import { getTableMeta } from "./catalog.js";

export type BrowseFilter = {
  column: string;
  op: "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte" | "empty" | "not_empty";
  value?: string;
};

export type BrowseOptions = {
  page?: number;
  pageSize?: number;
  sort?: string;
  sortDir?: "asc" | "desc";
  q?: string;
  columns?: string[];
  filters?: BrowseFilter[];
};

function jsonValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return {
      type: "blob",
      bytes: value.length,
      preview: value.subarray(0, 32).toString("hex"),
    };
  }
  if (value instanceof Uint8Array) {
    return {
      type: "blob",
      bytes: value.length,
      preview: Buffer.from(value.subarray(0, 32)).toString("hex"),
    };
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function jsonRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, jsonValue(value)]),
  );
}

export function browseTable(db: SqliteDatabase, table: string, opts: BrowseOptions = {}) {
  const meta = getTableMeta(db, table);
  if (!meta) throw new Error("Table introuvable");

  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, opts.pageSize ?? 50));
  const offset = (page - 1) * pageSize;
  const colNames = new Set(meta.columns.map((c) => c.name));

  const selectCols =
    opts.columns?.filter((c) => colNames.has(c) && isSafeIdentifier(c)) ??
    meta.columns.map((c) => c.name);
  if (!selectCols.length) throw new Error("Aucune colonne valide");

  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.q?.trim()) {
    const textCols = meta.columns
      .filter((c) => /TEXT|CHAR|CLOB/i.test(c.type) || !c.type)
      .map((c) => c.name)
      .slice(0, 12);
    if (textCols.length) {
      const like = `%${opts.q.trim()}%`;
      where.push(
        `(${textCols.map((c) => `${quoteIdent(c)} LIKE ?`).join(" OR ")})`,
      );
      for (let i = 0; i < textCols.length; i++) params.push(like);
    }
  }

  for (const filter of opts.filters ?? []) {
    if (!colNames.has(filter.column) || !isSafeIdentifier(filter.column)) continue;
    const col = quoteIdent(filter.column);
    switch (filter.op) {
      case "eq":
        where.push(`${col} = ?`);
        params.push(filter.value ?? null);
        break;
      case "neq":
        where.push(`${col} IS NOT ?`);
        params.push(filter.value ?? null);
        break;
      case "contains":
        where.push(`${col} LIKE ?`);
        params.push(`%${filter.value ?? ""}%`);
        break;
      case "gt":
        where.push(`${col} > ?`);
        params.push(filter.value);
        break;
      case "gte":
        where.push(`${col} >= ?`);
        params.push(filter.value);
        break;
      case "lt":
        where.push(`${col} < ?`);
        params.push(filter.value);
        break;
      case "lte":
        where.push(`${col} <= ?`);
        params.push(filter.value);
        break;
      case "empty":
        where.push(`(${col} IS NULL OR ${col} = '')`);
        break;
      case "not_empty":
        where.push(`(${col} IS NOT NULL AND ${col} != '')`);
        break;
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sortCol =
    opts.sort && colNames.has(opts.sort) && isSafeIdentifier(opts.sort)
      ? opts.sort
      : meta.columns.find((c) => c.pk)?.name || meta.columns[0]?.name;
  const sortDir = opts.sortDir === "desc" ? "DESC" : "ASC";
  const orderSql = sortCol
    ? `ORDER BY ${quoteIdent(sortCol)} ${sortDir}`
    : "";

  const identifier = quoteIdent(table);
  const selectSql = selectCols.map(quoteIdent).join(", ");
  // rowid pour ouvrir / éditer une ligne (indisponible sur certaines vues)
  const rowidPrefix = meta.kind === "table" ? "rowid AS __rowid__, " : "";

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM ${identifier} ${whereSql}`).get(...params) as {
      c: number;
    }
  ).c;

  let rows: Array<Record<string, unknown>>;
  try {
    rows = db
      .prepare(
        `SELECT ${rowidPrefix}${selectSql} FROM ${identifier} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset) as Array<Record<string, unknown>>;
  } catch {
    rows = db
      .prepare(
        `SELECT ${selectSql} FROM ${identifier} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset) as Array<Record<string, unknown>>;
  }

  return {
    table: meta,
    columns: selectCols,
    rows: rows.map(jsonRow),
    pagination: {
      page,
      pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    },
    sort: sortCol ?? null,
    sortDir: sortDir.toLowerCase() as "asc" | "desc",
  };
}

export function getRowByRowid(db: SqliteDatabase, table: string, rowid: number) {
  const row = db
    .prepare(`SELECT rowid AS __rowid__, * FROM ${quoteIdent(table)} WHERE rowid = ?`)
    .get(rowid) as Record<string, unknown> | undefined;
  return row ? jsonRow(row) : null;
}
