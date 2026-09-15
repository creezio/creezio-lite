/**
 * Cohérence `meiliIndexes.table` ↔ migrations (dette T6).
 *
 * Le doctor construit l'ensemble des tables CREATE de **toute** l'app
 * (tous modules + migrations historiques `fromprd_brand_*` dans
 * `brand-migrations.ts`) — un check textuel *par module* produirait des
 * faux positifs interdits (table créée par un autre module ou par le
 * schéma from-prd).
 *
 * Parse `CREATE TABLE` robuste, pas un parseur SQL complet :
 * `IF NOT EXISTS`, quotes `"`, `` ` ``, `[]`, identifiant nu, qualifier
 * `schema.table`. Tables TEMP ignorées.
 *
 * Échappatoire : `tableProvisionedBy` sur la spec d'index (table créée à
 * l'exécution). Pas d'env de bypass.
 */
import fs from "node:fs";
import path from "node:path";
import type { BrandSpecIssue } from "./types.js";

const SQL_IDENT = String.raw`(?:"[^"]+"|` + "`[^`]+`" + String.raw`|\[[^\]]+\]|[A-Za-z_][\w]*)`;

const CREATE_TABLE_RE = new RegExp(
  String.raw`CREATE\s+(TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:${SQL_IDENT}\s*\.\s*)?(${SQL_IDENT})`,
  "gi",
);

const ELECTRON_RELS = ["server/src/electron", "src/electron"] as const;

function skipQuoted(src: string, i: number): number {
  const q = src[i];
  if (q !== '"' && q !== "'" && q !== "`") return i + 1;
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === "\\") {
      j++;
      continue;
    }
    if (src[j] === q) return j + 1;
  }
  return src.length;
}

/** Retire commentaires bloc / ligne TS + `--` SQL, en respectant les chaînes. */
export function stripSqlAndTsComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  let out = "";
  for (let i = 0; i < noBlock.length; i++) {
    const c = noBlock[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const next = skipQuoted(noBlock, i);
      out += noBlock.slice(i, next);
      i = next - 1;
      continue;
    }
    if (c === "/" && noBlock[i + 1] === "/") {
      while (i < noBlock.length && noBlock[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "-" && noBlock[i + 1] === "-") {
      while (i < noBlock.length && noBlock[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += c;
  }
  return out;
}

export function unquoteSqlIdent(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2) {
    const a = t[0];
    const b = t[t.length - 1];
    if ((a === '"' && b === '"') || (a === "`" && b === "`") || (a === "[" && b === "]")) {
      return t.slice(1, -1);
    }
  }
  return t;
}

/**
 * Noms de tables créées par des `CREATE TABLE` (hors TEMP).
 * Comparaison insensible à la casse (SQLite).
 */
export function collectCreatedTablesFromSql(sql: string): string[] {
  const cleaned = stripSqlAndTsComments(sql);
  const out: string[] = [];
  CREATE_TABLE_RE.lastIndex = 0;
  for (const m of cleaned.matchAll(CREATE_TABLE_RE)) {
    if (m[1]) continue;
    const name = unquoteSqlIdent(m[2] ?? "");
    if (name) out.push(name);
  }
  return out;
}

function resolveAppElectronDir(specRoot: string): string | null {
  const appRoot = path.dirname(specRoot);
  for (const rel of ELECTRON_RELS) {
    const dir = path.join(appRoot, rel);
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

function walkMigrationSources(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist" || ent.name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkMigrationSources(full, acc);
      continue;
    }
    if (/\.(ts|sql)$/.test(ent.name) && !ent.name.endsWith(".d.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

export type AppMigrationTables = {
  /** Noms normalisés (minuscules) → nom tel que lu. */
  tables: Map<string, string>;
  /** Chemins relatifs au spec root effectivement lus. */
  searched: string[];
};

/** Ensemble cross-module : tous modules + historiques `fromprd_brand_*`. */
export function collectAppMigrationTables(specRoot: string): AppMigrationTables {
  const tables = new Map<string, string>();
  const searched: string[] = [];
  const electronDir = resolveAppElectronDir(specRoot);
  if (!electronDir) return { tables, searched };

  for (const filePath of walkMigrationSources(electronDir)) {
    searched.push(path.relative(specRoot, filePath));
    let src = "";
    try {
      src = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    for (const name of collectCreatedTablesFromSql(src)) {
      const key = name.toLowerCase();
      if (!tables.has(key)) tables.set(key, name);
    }
  }
  return { tables, searched };
}

function extractFieldArrayBody(src: string, field: string): string | null {
  const re = new RegExp(`\\b${field}\\s*:\\s*\\[`);
  const m = re.exec(src);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i = skipQuoted(src, i) - 1;
      continue;
    }
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

function extractTopLevelObjects(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i = skipQuoted(body, i) - 1;
      continue;
    }
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(body.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

function extractQuotedProp(obj: string, field: string): string | null {
  const m = obj.match(
    new RegExp(`\\b${field}\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1).)*)\\1`),
  );
  return m?.[2] ?? null;
}

export type DeclaredMeiliTable = {
  table: string;
  tableProvisionedBy: string | null;
};

export function extractDeclaredMeiliTables(src: string): DeclaredMeiliTable[] {
  const cleaned = stripSqlAndTsComments(src);
  const body = extractFieldArrayBody(cleaned, "meiliIndexes");
  if (!body) return [];
  const out: DeclaredMeiliTable[] = [];
  for (const obj of extractTopLevelObjects(body)) {
    const table = extractQuotedProp(obj, "table");
    if (!table) continue;
    const provisioned = extractQuotedProp(obj, "tableProvisionedBy");
    out.push({
      table,
      tableProvisionedBy: provisioned && provisioned.trim() ? provisioned.trim() : null,
    });
  }
  return out;
}

function formatSearched(searched: string[]): string {
  if (searched.length === 0) {
    return "aucun fichier sous server/src/electron/ ni src/electron/";
  }
  const shown = searched.slice(0, 8);
  const more =
    searched.length > shown.length ? ` (+${searched.length - shown.length} autres)` : "";
  return `${shown.join(", ")}${more}`;
}

function isModuleHelperName(name: string): boolean {
  if (
    name === "index.ts" ||
    name === "types.ts" ||
    name === "shared.ts" ||
    name === "mcp-shared.ts" ||
    name === "meili-shared.ts"
  ) {
    return true;
  }
  return name === "_lib.ts" || name.startsWith("_lib.") || name.startsWith("_");
}

/**
 * `MODULE_MEILI_TABLE_UNKNOWN` : chaque `meiliIndexes[].table` (string
 * littérale, sans `tableProvisionedBy`) doit exister dans le plan de
 * données cross-module. Toujours **error** (pas de pin / pas d'env).
 */
export function doctorBrandModuleMeiliTables(
  specRoot: string,
  issues: BrandSpecIssue[],
): void {
  const electronDir = resolveAppElectronDir(specRoot);
  if (!electronDir) return;
  const modulesDir = path.join(electronDir, "modules");
  if (!fs.existsSync(modulesDir)) return;

  const { tables, searched } = collectAppMigrationTables(specRoot);
  const searchedHint = formatSearched(searched);

  const files = fs
    .readdirSync(modulesDir)
    .filter((f) => f.endsWith(".ts") && !isModuleHelperName(f))
    .sort();
  for (const file of files) {
    const id = file.replace(/\.ts$/, "");
    const filePath = path.join(modulesDir, file);
    let src = "";
    try {
      src = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(specRoot, filePath);
    for (const decl of extractDeclaredMeiliTables(src)) {
      if (decl.tableProvisionedBy) continue;
      if (tables.has(decl.table.toLowerCase())) continue;
      issues.push({
        level: "error",
        code: "MODULE_MEILI_TABLE_UNKNOWN",
        message:
          `module ${id}: meiliIndexes.table "${decl.table}" introuvable dans les migrations de l'app ` +
          `(résolution cross-module : tous modules + historiques fromprd_brand_* ; cherché : ${searchedHint}). ` +
          `Créer la table dans une migration, ou déclarer tableProvisionedBy si elle est provisionnée à l'exécution.`,
        path: rel,
      });
    }
  }
}
