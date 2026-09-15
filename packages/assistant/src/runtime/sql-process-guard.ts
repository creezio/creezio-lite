/**
 * Garde-fou process générique pour run_sql :
 * si un filtre égalité texte renvoie 0, injecter les DISTINCT réels
 * (sans hardcoder de littéraux métier).
 */

import { listDistinctValues } from "./explore-tools.js";
import type { RunSqlResult } from "./run-sql.js";
import { getDb, tableExists } from "../brand/db-shim.js";

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Colonnes souvent catégorielles — heuristique de priorité, pas une whitelist métier. */
const CATEGORICAL_HINT_RE =
  /(status|state|level|type|platform|priority|gender|category|step|visibility|listing|make|model|fuel|gearbox|protection|disputed|charged|repaired|declaration)/i;

export type TextEqualityFilter = {
  column: string;
  tableAlias?: string;
  literal: string;
};

export type DistinctHint = {
  table: string;
  column: string;
  triedLiteral: string;
  values: { value: string; count: number }[];
  distinctCount?: number;
};

export type ProcessHint = {
  kind: "empty_equality_filter";
  message: string;
  filters: DistinctHint[];
  instruction: string;
};

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Tables / alias présents dans FROM / JOIN. */
export function extractSqlTables(sql: string): { table: string; alias: string }[] {
  const cleaned = stripSqlComments(sql);
  const out: { table: string; alias: string }[] = [];
  const seen = new Set<string>();
  const re =
    /\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const table = m[1];
    const alias = m[2] && !/^(ON|WHERE|LEFT|RIGHT|INNER|OUTER|CROSS|JOIN|GROUP|ORDER|LIMIT|HAVING)$/i.test(m[2])
      ? m[2]
      : table;
    const key = `${table}::${alias}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ table, alias });
  }
  return out;
}

/**
 * Extrais les filtres col = 'littéral' / IN ('a','b') hors sous-chaînes SQL
 * déjà protégées par quotes (approximatif mais suffisant pour le hint).
 */
export function extractTextEqualityFilters(sql: string): TextEqualityFilter[] {
  const cleaned = stripSqlComments(sql);
  const filters: TextEqualityFilter[] = [];
  const seen = new Set<string>();

  const push = (column: string, literal: string, tableAlias?: string) => {
    if (!SAFE_IDENT.test(column)) return;
    const lit = literal.replace(/''/g, "'");
    if (!lit.trim()) return;
    const key = `${tableAlias || ""}.${column}=${lit}`;
    if (seen.has(key)) return;
    seen.add(key);
    filters.push({ column, tableAlias, literal: lit });
  };

  // alias.col = '…'  ou  col = '…'  → groups: 1=alias?, 2=col, 3=lit
  const eqRe =
    /(?:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*'((?:[^']|'')*)'/gi;
  let m: RegExpExecArray | null;
  while ((m = eqRe.exec(cleaned)) !== null) {
    const alias = m[1] || undefined;
    const col = m[2];
    const lit = m[3];
    if (!col || lit == null) continue;
    // Ignorer comparaisons numériques déguisées (rare en quotes) et fonctions
    if (/^(true|false|null)$/i.test(lit)) continue;
    push(col, lit, alias);
  }

  // LOWER(col) / UPPER(col) / TRIM(col) = '…'  → 1=alias?, 2=col, 3=lit
  const fnEqRe =
    /\b(?:LOWER|UPPER|TRIM)\s*\(\s*(?:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*=\s*'((?:[^']|'')*)'/gi;
  while ((m = fnEqRe.exec(cleaned)) !== null) {
    const col = m[2];
    const lit = m[3];
    if (!col || lit == null) continue;
    push(col, lit, m[1] || undefined);
  }

  // col IN ('a','b')  → 1=alias?, 2=col, 3=list
  const inRe =
    /(?:([A-Za-z_][A-Za-z0-9_]*)\.)?([A-Za-z_][A-Za-z0-9_]*)\s+IN\s*\(([^)]*)\)/gi;
  while ((m = inRe.exec(cleaned)) !== null) {
    const col = m[2];
    const list = m[3] || "";
    if (!col) continue;
    const litRe = /'((?:[^']|'')*)'/g;
    let lm: RegExpExecArray | null;
    while ((lm = litRe.exec(list)) !== null) {
      push(col, lm[1], m[1] || undefined);
    }
  }

  return filters;
}

/** True si le résultat métier est vide (0 lignes ou COUNT = 0). */
export function isEmptySqlResult(result: RunSqlResult): boolean {
  if (!result.ok) return false;
  if (result.totalMatching === 0) return true;
  if (result.metadata?.totalMatching === 0) return true;
  if ((result.rowCount ?? 0) === 0) return true;
  const rows = result.rows;
  if (!rows?.length) return true;

  // Agrégat unique type COUNT(*) → 0
  if (rows.length === 1) {
    const row = rows[0];
    const keys = Object.keys(row);
    const numericKeys = keys.filter((k) => {
      const v = row[k];
      return v === null || v === undefined || typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v));
    });
    if (numericKeys.length === keys.length && keys.length > 0) {
      const allZero = numericKeys.every((k) => Number(row[k]) === 0);
      if (allZero) return true;
    }
    for (const k of keys) {
      if (/count|total|^c$|^n$/i.test(k) && Number(row[k]) === 0) return true;
    }
  }
  return false;
}

function resolveTableForColumn(
  column: string,
  alias: string | undefined,
  tables: { table: string; alias: string }[],
): string | null {
  if (alias) {
    const byAlias = tables.find((t) => t.alias.toLowerCase() === alias.toLowerCase());
    if (byAlias) return byAlias.table;
    if (SAFE_IDENT.test(alias) && tableExists(alias)) return alias;
  }
  if (tables.length === 1) return tables[0].table;

  // Colonne présente sur une seule des tables du FROM
  const matches: string[] = [];
  for (const t of tables) {
    if (!tableExists(t.table)) continue;
    try {
      const cols = getDb()
        .prepare(`PRAGMA table_info("${t.table}")`)
        .all() as { name: string }[];
      if (cols.some((c) => c.name === column)) matches.push(t.table);
    } catch {
      /* ignore */
    }
  }
  if (matches.length === 1) return matches[0];
  // Préférer une colonne catégorielle sur fleet_* si ambigu
  const preferred = matches.find((t) => t.startsWith("fleet_") || t.startsWith("vehicle_"));
  return preferred || matches[0] || null;
}

function prioritizeFilters(filters: TextEqualityFilter[]): TextEqualityFilter[] {
  return [...filters].sort((a, b) => {
    const ac = CATEGORICAL_HINT_RE.test(a.column) ? 0 : 1;
    const bc = CATEGORICAL_HINT_RE.test(b.column) ? 0 : 1;
    return ac - bc;
  });
}

/** Extrais les motifs LIKE '%…%' / LIKE '…%' pour hint d'exploration. */
export function extractLikeNeedles(sql: string): string[] {
  const cleaned = stripSqlComments(sql);
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\bLIKE\s+'((?:[^']|'')*)'/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const raw = m[1].replace(/''/g, "'");
    const needle = raw.replace(/%/g, "").trim();
    if (needle.length < 2) continue;
    const key = needle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(needle);
  }
  return out;
}

/**
 * Si SQL vide + filtres égalité texte → attache processHint avec DISTINCT réels.
 * Si SQL vide sans égalité mais avec LIKE → oriente vers find_columns / describe_table.
 */
export function enrichEmptySqlWithDistinctHints(
  sql: string,
  result: RunSqlResult,
  opts: { maxFilters?: number; maxValues?: number } = {},
): RunSqlResult & { processHint?: ProcessHint; exploreHint?: string } {
  if (!isEmptySqlResult(result)) return result;

  const filters = prioritizeFilters(extractTextEqualityFilters(sql));
  const tables = extractSqlTables(sql);
  const maxFilters = Math.min(Math.max(opts.maxFilters ?? 3, 1), 6);
  const maxValues = Math.min(Math.max(opts.maxValues ?? 20, 5), 40);
  const hints: DistinctHint[] = [];

  for (const f of filters.slice(0, maxFilters)) {
    const table = resolveTableForColumn(f.column, f.tableAlias, tables);
    if (!table) continue;
    const distinct = listDistinctValues(table, f.column, { limit: maxValues });
    if (!distinct.ok || !distinct.values?.length) continue;
    hints.push({
      table,
      column: f.column,
      triedLiteral: f.literal,
      values: distinct.values,
      distinctCount: distinct.distinctCount,
    });
  }

  if (hints.length) {
    const lines = hints.map((h) => {
      const sample = h.values
        .slice(0, 12)
        .map((v) => `${JSON.stringify(v.value)}×${v.count}`)
        .join(", ");
      return `- ${h.table}.${h.column} (tu as filtré ${JSON.stringify(h.triedLiteral)}) → valeurs réelles : ${sample}`;
    });

    const processHint: ProcessHint = {
      kind: "empty_equality_filter",
      message:
        "0 résultat avec un filtre égalité texte. Les littéraux doivent correspondre EXACTEMENT aux valeurs en base (casse/accents). Voici les DISTINCT réels — réessaie run_sql avec un littéral exact.",
      filters: hints,
      instruction:
        "Ne conclus pas « aucun » ni « pas de lien ». Relance run_sql en copiant un littéral exact. Sinon find_columns / describe_table puis autre JOIN ou table métier.",
    };

    return {
      ...result,
      processHint,
      hint: `${processHint.message}\n${lines.join("\n")}\n${processHint.instruction}`,
    } as RunSqlResult & { processHint?: ProcessHint; hint?: string };
  }

  const needles = extractLikeNeedles(sql);
  if (needles.length) {
    const tableNames = tables.map((t) => t.table).join(", ") || "(aucune table détectée)";
    const exploreHint =
      `0 résultat avec filtre LIKE (${needles.map((n) => JSON.stringify(n)).join(", ")}) ` +
      `sur ${tableNames}. Ne conclus pas « pas de lien ». ` +
      `Appelle find_columns(q) avec le mot-clé, describe_table sur la table (lire linkColumns), ` +
      `puis tente JOIN / LIKE préfixe sur make/model/system_id/plate, ou une autre table métier ` +
      `(reservation / rental / subscription) et réponds avec les chiffres trouvés.`;
    return {
      ...result,
      exploreHint,
      hint: exploreHint,
    } as RunSqlResult & { exploreHint?: string; hint?: string };
  }

  if (tables.length) {
    const exploreHint =
      `0 résultat. Tables touchées : ${tables.map((t) => t.table).join(", ")}. ` +
      `Avant d'abandonner : describe_table + find_columns, tenter une jointure/filtre alternatif, ` +
      `et si besoin chiffrer les tables métier voisines.`;
    return {
      ...result,
      exploreHint,
      hint: exploreHint,
    } as RunSqlResult & { exploreHint?: string; hint?: string };
  }

  return result;
}

/** Résumé court pour l'UI live steps. */
export function summarizeProcessHint(hint: ProcessHint | undefined): string | null {
  if (!hint?.filters?.length) return null;
  const first = hint.filters[0];
  const top = first.values
    .slice(0, 4)
    .map((v) => `${v.value}×${v.count}`)
    .join(", ");
  return `0 → DISTINCT ${first.table}.${first.column}: ${top}`;
}
