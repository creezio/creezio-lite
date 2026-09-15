import fs from "fs";
import path from "path";

let cached: string | null = null;
let cachedMtimeMs = 0;

export function getSchemaCatalogPath(): string {
  if (process.env.ASSISTANT_SCHEMA_CATALOG_PATH) {
    return process.env.ASSISTANT_SCHEMA_CATALOG_PATH;
  }
  if (fs.existsSync("/data/assistant_schema_catalog.md")) {
    return "/data/assistant_schema_catalog.md";
  }
  // Local: crm/ → ../data/
  return path.resolve(process.cwd(), "../data/assistant_schema_catalog.md");
}

function readCatalogRaw(): string {
  const p = getSchemaCatalogPath();
  try {
    if (!fs.existsSync(p)) {
      return "(Catalogue schéma absent — générer assistant_schema_catalog.md côté marque, ou utiliser list_tables / describe_table.)";
    }
    const st = fs.statSync(p);
    if (cached !== null && st.mtimeMs === cachedMtimeMs) {
      return cached;
    }
    cached = fs.readFileSync(p, "utf8");
    cachedMtimeMs = st.mtimeMs;
    return cached;
  } catch {
    return "(Impossible de lire le catalogue schéma. Utiliser list_tables / describe_table.)";
  }
}

/**
 * Catalogue injecté dans le system prompt.
 * Par défaut on injecte le fichier entier (~25k) : samples d'enums runtime
 * auto-générés + indices SQL génériques. Plafond configurable via env.
 *
 * ASSISTANT_SCHEMA_CATALOG_MAX_CHARS (défaut 32000).
 */
export function loadSchemaCatalog(maxChars?: number): string {
  const envMax = Number(process.env.ASSISTANT_SCHEMA_CATALOG_MAX_CHARS || "");
  const limit =
    typeof maxChars === "number" && maxChars > 0
      ? maxChars
      : Number.isFinite(envMax) && envMax > 0
        ? envMax
        : 32000;
  const raw = readCatalogRaw();
  if (raw.length <= limit) return raw;

  // Troncature intelligente : garder tables cœur + indices SQL (fin du fichier)
  const indicesIdx = raw.indexOf("## Indices SQL utiles");
  if (indicesIdx > 0) {
    const headBudget = Math.max(8000, limit - 3500);
    const head = raw.slice(0, headBudget);
    const indices = raw.slice(indicesIdx, indicesIdx + 3000);
    const note = `\n\n…[catalogue tronqué ${raw.length - limit} chars — utiliser list_tables / describe_table / list_distinct_values pour le détail]…\n\n`;
    return `${head}${note}${indices}`.slice(0, limit);
  }
  return `${raw.slice(0, limit - 120)}\n\n…[tronqué — utiliser describe_table / list_distinct_values]…`;
}

export function clearSchemaCatalogCache() {
  cached = null;
  cachedMtimeMs = 0;
}
