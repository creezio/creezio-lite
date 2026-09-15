/**
 * Résolution chemin `core.db` côté process Next/CRM (sans PathsContext Electron).
 *
 * Ordre :
 * 1. `CREEZIO_CORE_DB_PATH` (injecté par Electron server-launcher)
 * 2. voisin de `DB_PATH` → `{userData}/sqlite/core.db`
 * 3. `/data/sqlite/core.db` (cloud/docker)
 */

import fs from "node:fs";
import path from "node:path";

export function resolveCoreDbPathFromEnv(): string | null {
  const explicit = (process.env.CREEZIO_CORE_DB_PATH || "").trim();
  if (explicit) return explicit;

  const brandDb = (process.env.DB_PATH || "").trim();
  if (brandDb) {
    const userData = path.dirname(brandDb);
    return path.join(userData, "sqlite", "core.db");
  }

  if (fs.existsSync("/data")) {
    return path.join("/data", "sqlite", "core.db");
  }

  return null;
}

export function ensureCoreDbParent(coreDbPath: string): void {
  const dir = path.dirname(coreDbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Documents FS voisins du brand DB (chemin historique). */
export function resolvePluginDocumentsDirFromEnv(): string {
  const brandDb = (process.env.DB_PATH || "").trim();
  if (brandDb) return path.join(path.dirname(brandDb), "plugin-documents");
  const core = resolveCoreDbPathFromEnv();
  if (core) {
    return path.join(path.dirname(path.dirname(core)), "plugin-documents");
  }
  return path.resolve(process.cwd(), "../data/plugin-documents");
}
