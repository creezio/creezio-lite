/**
 * Outils d'exploration schéma pour l'assistant agentique.
 * Process générique : list_distinct_values / describe_table / find_columns
 * avant tout filtre égalité sur colonne texte — jamais inventer un littéral.
 */

import { getDb, queryAll, queryOne, tableExists } from "../brand/db-shim.js";

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdent(name: string, label: string): string {
  const n = String(name || "").trim();
  if (!SAFE_IDENT.test(n)) {
    throw new Error(`${label} invalide (identifiant SQL attendu)`);
  }
  return n;
}

/** Heuristique : colonnes catégorielles à sampler automatiquement. */
const CATEGORICAL_RE =
  /(status|state|level|type|platform|priority|gender|category|step|visibility|listing|make|model|fuel|gearbox|protection|disputed|charged|repaired)/i;

/** Colonnes susceptibles de lier une entité à un véhicule / marque / modèle. */
const LINK_COL_RE =
  /(vehicle|model|make|item|plate|listing|system_id|car_|brand|serial|vin|subscription)/i;

export type TableListItem = {
  name: string;
  rowCount: number;
  columns: number;
};

export function listTables(opts: { limit?: number; q?: string } = {}): {
  tables: TableListItem[];
  totalTables: number;
} {
  const limit = Math.min(Math.max(Number(opts.limit) || 80, 1), 200);
  const q = String(opts.q || "")
    .trim()
    .toLowerCase();
  const rows = queryAll<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type='table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name`,
  );
  let names = rows.map((r) => r.name);
  if (q) {
    names = names.filter((n) => n.toLowerCase().includes(q));
  }
  const totalTables = names.length;
  const sliced = names.slice(0, limit);
  const tables: TableListItem[] = sliced.map((name) => {
    const cols = queryAll<{ name: string }>(`PRAGMA table_info("${name}")`);
    let rowCount = 0;
    try {
      rowCount = queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM "${name}"`)?.c ?? 0;
    } catch {
      rowCount = -1;
    }
    return { name, rowCount, columns: cols.length };
  });
  return { tables, totalTables };
}

export type ColumnInfo = {
  name: string;
  type: string;
  notnull: boolean;
  pk: boolean;
};

export type DistinctSample = {
  column: string;
  values: { value: string; count: number }[];
  distinctApprox: number;
};

export type ForeignKeyInfo = {
  id: number;
  table: string;
  from: string;
  to: string;
};

export type LinkColumnSample = {
  column: string;
  values: { value: string; count: number }[];
  distinctApprox: number;
  role: "link_candidate";
};

function listChildTables(table: string): string[] {
  return queryAll<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type='table' AND name LIKE ?
     ORDER BY name`,
    [`${table}__%`],
  ).map((r) => r.name);
}

function listForeignKeys(table: string): ForeignKeyInfo[] {
  try {
    const rows = getDb()
      .prepare(`PRAGMA foreign_key_list("${table}")`)
      .all() as {
      id: number;
      table: string;
      from: string;
      to: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      table: r.table,
      from: r.from,
      to: r.to,
    }));
  } catch {
    return [];
  }
}

export function describeTable(
  tableRaw: string,
  opts: { sampleDistinct?: boolean; maxEnumCols?: number } = {},
): {
  ok: boolean;
  error?: string;
  table?: string;
  rowCount?: number;
  columns?: ColumnInfo[];
  distinctSamples?: DistinctSample[];
  linkColumns?: LinkColumnSample[];
  childTables?: string[];
  foreignKeys?: ForeignKeyInfo[];
  hint?: string;
} {
  let table: string;
  try {
    table = assertIdent(tableRaw, "table");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "table invalide" };
  }
  if (!tableExists(table)) {
    return { ok: false, error: `table introuvable: ${table}` };
  }

  const pragma = getDb().prepare(`PRAGMA table_info("${table}")`).all() as {
    name: string;
    type: string;
    notnull: number;
    pk: number;
  }[];
  const columns: ColumnInfo[] = pragma
    .filter((c) => !c.name.startsWith("_") && c.name !== "payload1" && c.name !== "payload2")
    .map((c) => ({
      name: c.name,
      type: c.type || "TEXT",
      notnull: Boolean(c.notnull),
      pk: Boolean(c.pk),
    }));

  const rowCount =
    queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM "${table}"`)?.c ?? 0;

  const sampleDistinct = opts.sampleDistinct !== false;
  const maxEnumCols = Math.min(Math.max(Number(opts.maxEnumCols) || 6, 0), 12);
  const distinctSamples: DistinctSample[] = [];
  const linkColumns: LinkColumnSample[] = [];

  if (sampleDistinct && maxEnumCols > 0) {
    const candidates = columns.filter((c) => CATEGORICAL_RE.test(c.name)).slice(0, maxEnumCols);
    // Toujours inclure internal_vehicle_status si présent
    const force = columns.find((c) => c.name === "internal_vehicle_status");
    const toSample = [
      ...(force && !candidates.some((c) => c.name === force.name) ? [force] : []),
      ...candidates,
    ].slice(0, maxEnumCols);

    for (const col of toSample) {
      try {
        const sample = listDistinctValues(table, col.name, { limit: 15 });
        if (sample.ok && sample.values) {
          distinctSamples.push({
            column: col.name,
            values: sample.values,
            distinctApprox: sample.distinctNonNullCount ?? sample.distinctCount ?? sample.values.length,
          });
        }
      } catch {
        /* ignore colonne */
      }
    }

    // Colonnes lien véhicule / marque / modèle : toujours exposer un échantillon
    // (ex. system_id = libellé « Make Model… » sur les réservations).
    const linkCandidates = columns
      .filter((c) => LINK_COL_RE.test(c.name))
      .filter((c) => !toSample.some((s) => s.name === c.name))
      .slice(0, 8);
    for (const col of linkCandidates) {
      try {
        const sample = listDistinctValues(table, col.name, { limit: 10 });
        if (sample.ok && sample.values?.length) {
          // Ignorer colonnes quasi-uniques (ids) sans signal métier
          const top = sample.values[0];
          const mostlyUnique =
            (sample.distinctNonNullCount ?? 0) > Math.min(rowCount * 0.8, 200) &&
            (top?.count ?? 0) <= 2;
          if (mostlyUnique && !/make|model|system_id|listing|plate/i.test(col.name)) {
            continue;
          }
          linkColumns.push({
            column: col.name,
            values: sample.values,
            distinctApprox:
              sample.distinctNonNullCount ?? sample.distinctCount ?? sample.values.length,
            role: "link_candidate",
          });
        }
      } catch {
        /* ignore */
      }
    }
  }

  const childTables = listChildTables(table);
  const foreignKeys = listForeignKeys(table);

  const hintParts = [
    "Pour filtrer une colonne statut/type : utiliser EXACTEMENT une valeur listée dans distinctSamples (casse et accents inclus).",
    "Si un lien véhicule/marque n'est pas une FK explicite, inspecter linkColumns (libellés make/model/system_id/plate) et tenter JOIN ou LIKE préfixe.",
    "Child tables listées dans childTables (souvent parent_frappe_name).",
    "Ne jamais conclure « pas de lien » sans avoir tenté au moins une jointure / filtre sur une colonne link candidate.",
  ];

  return {
    ok: true,
    table,
    rowCount,
    columns,
    distinctSamples,
    ...(linkColumns.length ? { linkColumns } : {}),
    ...(childTables.length ? { childTables } : {}),
    ...(foreignKeys.length ? { foreignKeys } : {}),
    hint: hintParts.join(" "),
  };
}

export function listDistinctValues(
  tableRaw: string,
  columnRaw: string,
  opts: { limit?: number } = {},
): {
  ok: boolean;
  error?: string;
  table?: string;
  column?: string;
  values?: { value: string; count: number }[];
  /** COUNT(DISTINCT col) — exclut NULL (comportement SQLite). */
  distinctCount?: number;
  /** Nombre de valeurs non NULL distinctes (identique à distinctCount SQLite). */
  distinctNonNullCount?: number;
  nullCount?: number;
  emptyCount?: number;
  /** Groupes GROUP BY incluant NULL (= distinctNonNull + 1 si nullCount>0). */
  groupByBucketCount?: number;
  hint?: string;
} {
  let table: string;
  let column: string;
  try {
    table = assertIdent(tableRaw, "table");
    column = assertIdent(columnRaw, "column");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "identifiant invalide" };
  }
  if (!tableExists(table)) {
    return { ok: false, error: `table introuvable: ${table}` };
  }
  const cols = queryAll<{ name: string }>(`PRAGMA table_info("${table}")`).map((c) => c.name);
  if (!cols.includes(column)) {
    return {
      ok: false,
      error: `colonne introuvable: ${column}`,
      table,
      hint: `Colonnes disponibles: ${cols.slice(0, 40).join(", ")}`,
    };
  }

  const limit = Math.min(Math.max(Number(opts.limit) || 30, 1), 100);
  try {
    const rows = queryAll<{ v: string | null; n: number }>(
      `SELECT COALESCE(CAST("${column}" AS TEXT), '(NULL)') AS v, COUNT(*) AS n
       FROM "${table}"
       GROUP BY "${column}"
       ORDER BY n DESC
       LIMIT ?`,
      [limit],
    );
    const distinctRow = queryOne<{ c: number }>(
      `SELECT COUNT(DISTINCT "${column}") AS c FROM "${table}"`,
    );
    const nullRow = queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM "${table}" WHERE "${column}" IS NULL`,
    );
    const emptyRow = queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM "${table}"
       WHERE "${column}" IS NOT NULL AND TRIM(CAST("${column}" AS TEXT)) = ''`,
    );
    const groupBuckets = queryOne<{ c: number }>(
      `SELECT COUNT(*) AS c FROM (SELECT 1 FROM "${table}" GROUP BY "${column}")`,
    );
    const distinctNonNullCount = distinctRow?.c ?? rows.length;
    const nullCount = nullRow?.c ?? 0;
    const emptyCount = emptyRow?.c ?? 0;
    const groupByBucketCount = groupBuckets?.c ?? distinctNonNullCount + (nullCount > 0 ? 1 : 0);

    return {
      ok: true,
      table,
      column,
      values: rows.map((r) => ({ value: String(r.v), count: Number(r.n) || 0 })),
      distinctCount: distinctNonNullCount,
      distinctNonNullCount,
      nullCount,
      emptyCount,
      groupByBucketCount,
      hint:
        "Utiliser ces littéraux EXACTS dans le SQL (casse et accents). " +
        "COUNT(DISTINCT) / distinctNonNullCount exclut NULL ; " +
        "GROUP BY compte aussi le seau NULL (groupByBucketCount). " +
        "Pour annoncer « N valeurs distinctes », utiliser distinctNonNullCount " +
        "et mentionner nullCount/emptyCount s'ils sont > 0. " +
        "Si 0 résultat après filtre, revérifier ici avant de conclure.",
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "échec DISTINCT",
      table,
      column,
    };
  }
}

export type FindColumnsHit = {
  table: string;
  column: string;
  match: "column_name" | "table_name" | "value";
  sampleValues?: { value: string; count: number }[];
  rowCount?: number;
};

/**
 * Recherche générique dans le schéma : noms de tables/colonnes, et valeurs
 * DISTINCT des colonnes catégorielles / lien contenant le mot-clé.
 */
export function findColumns(opts: {
  q: string;
  limit?: number;
  scope?: "columns" | "values" | "both";
}): {
  ok: boolean;
  error?: string;
  q?: string;
  hits?: FindColumnsHit[];
  hint?: string;
} {
  const q = String(opts.q || "").trim();
  if (!q || q.length < 2) {
    return { ok: false, error: "q trop court (min 2 caractères)" };
  }
  const qLower = q.toLowerCase();
  const limit = Math.min(Math.max(Number(opts.limit) || 40, 1), 80);
  const scope = opts.scope || "both";
  const hits: FindColumnsHit[] = [];

  const tables = queryAll<{ name: string }>(
    `SELECT name FROM sqlite_master
     WHERE type='table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name`,
  ).map((r) => r.name);

  for (const table of tables) {
    if (hits.length >= limit) break;
    let cols: { name: string }[] = [];
    try {
      cols = queryAll<{ name: string }>(`PRAGMA table_info("${table}")`);
    } catch {
      continue;
    }
    const visible = cols.filter(
      (c) => !c.name.startsWith("_") && c.name !== "payload1" && c.name !== "payload2",
    );

    if (scope === "columns" || scope === "both") {
      if (table.toLowerCase().includes(qLower)) {
        hits.push({
          table,
          column: "(table)",
          match: "table_name",
          rowCount: queryOne<{ c: number }>(`SELECT COUNT(*) AS c FROM "${table}"`)?.c,
        });
      }
      for (const col of visible) {
        if (hits.length >= limit) break;
        if (col.name.toLowerCase().includes(qLower)) {
          hits.push({ table, column: col.name, match: "column_name" });
        }
      }
    }

    if (scope === "values" || scope === "both") {
      const valueCandidates = visible.filter(
        (c) => CATEGORICAL_RE.test(c.name) || LINK_COL_RE.test(c.name),
      );
      for (const col of valueCandidates) {
        if (hits.length >= limit) break;
        // Déjà listé comme column_name exact — on peut encore ajouter un hit value
        try {
          const rows = queryAll<{ v: string; n: number }>(
            `SELECT CAST("${col.name}" AS TEXT) AS v, COUNT(*) AS n
             FROM "${table}"
             WHERE "${col.name}" IS NOT NULL
               AND LOWER(CAST("${col.name}" AS TEXT)) LIKE ?
             GROUP BY "${col.name}"
             ORDER BY n DESC
             LIMIT 5`,
            [`%${qLower}%`],
          );
          if (rows.length) {
            hits.push({
              table,
              column: col.name,
              match: "value",
              sampleValues: rows.map((r) => ({
                value: String(r.v),
                count: Number(r.n) || 0,
              })),
            });
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  return {
    ok: true,
    q,
    hits,
    hint:
      hits.length === 0
        ? "Aucun hit. Essayer un synonyme (make/model/vehicle/plate/reservation/rental) ou list_tables."
        : "Utiliser describe_table sur les tables hit, puis run_sql avec les littéraux exacts des sampleValues. " +
          "Si plusieurs tables métier matchent (reservation / rental / subscription), chiffrer chacune et préciser la table.",
  };
}

/** Résumé condensé pour l'UI / SSE (pas le JSON complet). */
export function summarizeExploreResult(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
): string {
  const r = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
  if (toolName === "list_tables" && r && Array.isArray(r.tables)) {
    const n = r.tables.length;
    const total = r.totalTables ?? n;
    const names = (r.tables as { name?: string }[])
      .slice(0, 8)
      .map((t) => t.name)
      .filter(Boolean)
      .join(", ");
    return `${n}/${total} tables${names ? ` · ${names}` : ""}`;
  }
  if (toolName === "describe_table" && r) {
    if (r.ok === false) return String(r.error || "erreur");
    const samples = Array.isArray(r.distinctSamples) ? r.distinctSamples.length : 0;
    const links = Array.isArray(r.linkColumns) ? r.linkColumns.length : 0;
    const children = Array.isArray(r.childTables) ? r.childTables.length : 0;
    return `${r.table}: ${r.rowCount ?? "?"} lignes, ${(r.columns as unknown[])?.length ?? "?"} cols, ${samples} enums, ${links} liens, ${children} child`;
  }
  if (toolName === "list_distinct_values" && r) {
    if (r.ok === false) return String(r.error || "erreur");
    const vals = Array.isArray(r.values)
      ? (r.values as { value: string; count: number }[])
          .slice(0, 5)
          .map((v) => `${v.value}×${v.count}`)
          .join(", ")
      : "";
    const nn = r.distinctNonNullCount ?? r.distinctCount;
    const nullPart =
      typeof r.nullCount === "number" && r.nullCount > 0 ? ` · null=${r.nullCount}` : "";
    return `${r.table}.${r.column}: ${nn ?? "?"} distincts${nullPart}${vals ? ` · ${vals}` : ""}`;
  }
  if (toolName === "find_columns" && r) {
    if (r.ok === false) return String(r.error || "erreur");
    const hits = Array.isArray(r.hits) ? (r.hits as FindColumnsHit[]) : [];
    const preview = hits
      .slice(0, 5)
      .map((h) => `${h.table}.${h.column}(${h.match})`)
      .join(", ");
    return `${hits.length} hits${preview ? ` · ${preview}` : ""}`;
  }
  if (toolName === "run_sql" && r) {
    if (r.ok === false) return String(r.error || "SQL erreur");
    const processHint =
      r.processHint && typeof r.processHint === "object"
        ? (r.processHint as {
            filters?: {
              table?: string;
              column?: string;
              values?: { value: string; count: number }[];
            }[];
          })
        : null;
    if (processHint?.filters?.length) {
      const f = processHint.filters[0];
      const top = (f.values || [])
        .slice(0, 4)
        .map((v) => `${v.value}×${v.count}`)
        .join(", ");
      return `0 → DISTINCT ${f.table}.${f.column}: ${top || "—"}`;
    }
    const meta =
      r.metadata && typeof r.metadata === "object"
        ? (r.metadata as Record<string, unknown>)
        : null;
    const total = r.totalMatching ?? meta?.totalMatching;
    if (total != null) return `totalMatching=${total}`;
    return `${r.rowCount ?? 0} lignes`;
  }
  if (toolName === "search_knowledge" && r) {
    return `${r.hitCount ?? 0} hits (${r.mode || "?"})`;
  }
  if (toolName === "get_entity" && r) {
    return r.entity ? `${args.kind || "entity"} trouvé` : "introuvable";
  }
  return "ok";
}
