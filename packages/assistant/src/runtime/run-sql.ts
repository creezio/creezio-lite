import Database from "better-sqlite3";
import { getDbPath } from "../brand/db-shim.js";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const TIMEOUT_MS = 4000;
const MAX_ROWS_PAYLOAD = 80;
const MAX_JSON_CHARS = 14000;

export type RunSqlResult = {
  ok: boolean;
  error?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  /** Limite SQL effective (explicite ou injectée) ; null sans LIMIT. */
  limit?: number | null;
  truncated?: boolean;
  appliedLimit?: number;
  mayBeTruncated?: boolean;
  /** Nombre exact de lignes métier (liste) ou de groupes (GROUP BY). */
  totalMatching?: number;
  /**
   * Contrat machine-lisible : ne jamais interpréter rowCount comme un total
   * métier. totalMatching est toujours le total de référence lorsqu'il existe.
   */
  metadata?: {
    queryKind: "list" | "aggregate";
    totalMatchingScope: "rows" | "groups";
    /** null signifie que le COUNT compagnon a échoué : aucun total ne doit être annoncé. */
    totalMatching: number | null;
    returnedRows: number;
    resultComplete: boolean;
    limitPolicy: "none" | "requested" | "implicit";
    /**
     * Somme exacte des colonnes COUNT(...) d'un GROUP BY, calculée sans son
     * LIMIT final. Utile pour lire un top sans confondre ses N lignes avec le
     * total des enregistrements source.
     */
    groupedCountSums?: Record<string, number>;
  };
  sql?: string;
};

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Détecte toute requête de synthèse, y compris si l'agrégat est dans une CTE
 * ou une sous-requête. Ces requêtes ne doivent jamais recevoir de LIMIT
 * implicite : un COUNT dans une sous-requête doit rester exact lui aussi.
 */
function isAggregateQuery(sql: string): boolean {
  const normalized = stripSqlComments(sql)
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""');
  return (
    /\b(COUNT|SUM|AVG|MIN|MAX|GROUP_CONCAT|TOTAL)\s*\(/i.test(normalized) ||
    /\bGROUP\s+BY\b/i.test(normalized) ||
    /\bHAVING\b/i.test(normalized)
  );
}

function removeTrailingLimit(sql: string): string {
  return sql.replace(/\s+LIMIT\s+\d+\s*(?:OFFSET\s+\d+\s*)?$/i, "").trim();
}

function countMatchingRows(db: Database.Database, sqlWithoutLimit: string): number | undefined {
  try {
    const row = db
      .prepare(`SELECT COUNT(*) AS total_matching FROM (${sqlWithoutLimit}) AS _assistant_count`)
      .get() as { total_matching?: unknown } | undefined;
    const total = Number(row?.total_matching);
    return Number.isFinite(total) ? total : undefined;
  } catch {
    // La liste reste exploitable ; le prompt impose alors de ne pas déduire un total.
    return undefined;
  }
}

function countAliases(sql: string): string[] {
  const aliases = new Set<string>();
  const normalized = stripSqlComments(sql);
  const aliasPattern =
    /\bCOUNT\s*\([^)]*\)\s+AS\s+(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))/gi;
  let match: RegExpExecArray | null;
  while ((match = aliasPattern.exec(normalized)) !== null) {
    const alias = match[1] || match[2] || match[3] || match[4];
    if (alias) aliases.add(alias);
  }
  // SQLite donne ce nom de colonne lorsqu'un COUNT(*) n'a pas d'alias.
  if (aliases.size === 0 && /\bCOUNT\s*\(\s*\*\s*\)/i.test(normalized)) {
    aliases.add("COUNT(*)");
  }
  return Array.from(aliases);
}

function groupedCountSums(
  db: Database.Database,
  sqlWithoutLimit: string,
  aliases: string[],
): Record<string, number> | undefined {
  if (!aliases.length) return undefined;
  try {
    const select = aliases
      .map((alias, index) => `SUM(CAST("${alias.replace(/"/g, '""')}" AS REAL)) AS _sum_${index}`)
      .join(", ");
    const row = db
      .prepare(`SELECT ${select} FROM (${sqlWithoutLimit}) AS _assistant_group_sums`)
      .get() as Record<string, unknown> | undefined;
    const sums: Record<string, number> = {};
    for (let index = 0; index < aliases.length; index++) {
      const alias = aliases[index];
      const value = Number(row?.[`_sum_${index}`]);
      if (Number.isFinite(value)) sums[alias] = value;
    }
    return Object.keys(sums).length ? sums : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Exécute une requête SQL lecture seule (SELECT / WITH uniquement).
 * DB ouverte en readonly + query_only ; multi-statements rejetés.
 * Les listes sont plafonnées, mais jamais les COUNT/agrégats/sous-requêtes
 * de totaux. Toute réponse réussie porte un contrat metadata machine-lisible.
 */
export function runSql(sqlRaw: string): RunSqlResult {
  const sql = String(sqlRaw || "").trim().replace(/;+\s*$/, "");
  if (!sql) return { ok: false, error: "SQL vide" };

  if (sql.includes(";")) {
    return { ok: false, error: "Multi-statements interdits (un seul SELECT/WITH)" };
  }

  // Retirer commentaires simples pour le check
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();
  const upper = stripped.toUpperCase();

  if (!(upper.startsWith("SELECT") || upper.startsWith("WITH"))) {
    return { ok: false, error: "Seuls SELECT et WITH (CTE) sont autorisés" };
  }

  // REPLACE() SQLite (normalisation plaques) est autorisé ; seul REPLACE INTO (écriture) est bloqué.
  const forbidden =
    /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|GRANT|REVOKE|TRUNCATE|INTO\s+OUTFILE|LOAD\s+DATA)\b/i;
  if (forbidden.test(stripped) || /\bREPLACE\s+INTO\b/i.test(stripped)) {
    return { ok: false, error: "Mot-clé SQL non autorisé (écriture / DDL)" };
  }

  const aggregate = isAggregateQuery(sql);
  const sqlWithoutLimit = removeTrailingLimit(sql);
  let finalSql = sql;
  let appliedLimit: number | undefined;
  const limitMatch = /\bLIMIT\s+(\d+)(\s+OFFSET\s+\d+)?\s*$/i.exec(sql);
  const requestedLimit = limitMatch ? Number(limitMatch[1]) : undefined;
  if (!aggregate && limitMatch) {
    appliedLimit = Math.min(Number(limitMatch[1]) || DEFAULT_LIMIT, MAX_LIMIT);
    finalSql = sql.replace(
      /\bLIMIT\s+\d+(\s+OFFSET\s+\d+)?\s*$/i,
      `LIMIT ${appliedLimit}${limitMatch[2] || ""}`,
    );
  } else if (!aggregate) {
    appliedLimit = DEFAULT_LIMIT;
    finalSql = `${sql}\nLIMIT ${DEFAULT_LIMIT}`;
  }

  const dbPath = getDbPath();
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      db.pragma("query_only = ON");
    } catch {
      /* ignore */
    }
    // better-sqlite3 n'a pas de timeout requête natif portable : on borne via busy_timeout court
    db.pragma(`busy_timeout = ${TIMEOUT_MS}`);

    const started = Date.now();
    const stmt = db.prepare(finalSql);
    const rawRows = stmt.all() as Record<string, unknown>[];
    if (Date.now() - started > TIMEOUT_MS) {
      return { ok: false, error: `Timeout (>${TIMEOUT_MS}ms)`, sql: finalSql };
    }

    const columns =
      rawRows.length > 0
        ? Object.keys(rawRows[0]).filter((k) => !k.startsWith("_") && !k.endsWith("_json"))
        : [];

    const slimRows = rawRows.slice(0, MAX_ROWS_PAYLOAD).map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        if (k.startsWith("_") || k.endsWith("_json") || k === "payload1" || k === "payload2") {
          continue;
        }
        if (typeof v === "string" && v.length > 400) {
          out[k] = `${v.slice(0, 400)}…`;
        } else {
          out[k] = v;
        }
      }
      return out;
    });

    // Toujours fournir le dénominateur des listes. Pour un GROUP BY limité,
    // le dénominateur est le nombre total de groupes (pas la somme d'un COUNT
    // affiché) : le modèle doit demander un COUNT métier séparé pour un total
    // de lignes source.
    const totalMatching =
      aggregate && requestedLimit === undefined
        ? rawRows.length
        : countMatchingRows(db, sqlWithoutLimit);
    const groupCountSums =
      aggregate && /\bGROUP\s+BY\b/i.test(stripSqlComments(sql))
        ? groupedCountSums(db, sqlWithoutLimit, countAliases(sql))
        : undefined;
    const mayBeTruncated =
      totalMatching === undefined
        ? rawRows.length > MAX_ROWS_PAYLOAD
        : totalMatching > rawRows.length || rawRows.length > MAX_ROWS_PAYLOAD;
    const limitPolicy: "none" | "requested" | "implicit" =
      requestedLimit !== undefined ? "requested" : appliedLimit !== undefined ? "implicit" : "none";
    const makeMetadata = (returnedRows: number, resultComplete: boolean) => ({
      queryKind: aggregate ? ("aggregate" as const) : ("list" as const),
      totalMatchingScope: aggregate && /\bGROUP\s+BY\b/i.test(stripSqlComments(sql))
        ? ("groups" as const)
        : ("rows" as const),
      totalMatching: totalMatching ?? null,
      returnedRows,
      resultComplete,
      limitPolicy,
      ...(groupCountSums ? { groupedCountSums: groupCountSums } : {}),
    });

    let payload: RunSqlResult = {
      ok: true,
      columns,
      rows: slimRows,
      rowCount: rawRows.length,
      limit: appliedLimit ?? requestedLimit ?? null,
      // appliedLimit : conservé pour compat clients existants (champ dupliqué
      // de `limit`) — retrait tracké au BACKLOG (docs/BACKLOG.md, « Divers »).
      ...(appliedLimit !== undefined ? { appliedLimit } : {}),
      ...(totalMatching !== undefined ? { totalMatching } : {}),
      truncated: rawRows.length > MAX_ROWS_PAYLOAD || mayBeTruncated,
      mayBeTruncated,
      metadata: makeMetadata(
        slimRows.length,
        totalMatching !== undefined && slimRows.length === rawRows.length && !mayBeTruncated,
      ),
      sql: finalSql,
    };

    let json = JSON.stringify(payload);
    if (json.length > MAX_JSON_CHARS) {
      const cut = Math.max(5, Math.floor(slimRows.length / 2));
      payload = {
        ...payload,
        rows: slimRows.slice(0, cut),
        truncated: true,
        metadata: makeMetadata(cut, false),
      };
      json = JSON.stringify(payload);
      if (json.length > MAX_JSON_CHARS) {
        payload = {
          ok: true,
          columns,
          rows: slimRows.slice(0, 3),
          rowCount: rawRows.length,
          limit: appliedLimit ?? requestedLimit ?? null,
          ...(appliedLimit !== undefined ? { appliedLimit } : {}),
          ...(totalMatching !== undefined ? { totalMatching } : {}),
          truncated: true,
          mayBeTruncated,
          metadata: makeMetadata(3, false),
          sql: finalSql,
          error: "Résultat tronqué (trop volumineux)",
        };
      }
    }

    return payload;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur SQL";
    return { ok: false, error: message, sql: finalSql };
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

export {
  collectSourcesFromSqlRows,
  sourceLinkMatchers,
  type AssistantSource,
  type AssistantSourceType,
} from "../brand/sources-shim.js";
