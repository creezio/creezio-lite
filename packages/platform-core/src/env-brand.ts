/**
 * Helpers env marque pour launchers (Next / Meili / Hermes / n8n).
 * Clés uniquement via `envKey(manifest, suffix)` — zéro dual-read historique.
 */

import type { AppManifest } from "@creezio/brand-config";
import { envKey } from "@creezio/brand-config";

/** Construit un objet env partiel avec préfixe marque. */
export function brandEnv(
  manifest: AppManifest,
  entries: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [suffix, value] of Object.entries(entries)) {
    if (value === undefined || value === "") continue;
    out[envKey(manifest, suffix)] = value;
  }
  return out;
}

/**
 * Env injecté dans le process Next standalone (noyau commun).
 * Les clés métier supplémentaires restent dans l'app verticale.
 */
export function buildNextHostEnv(opts: {
  manifest: AppManifest;
  port: number;
  hostname: string;
  dbPath: string;
  assistantDbPath: string;
  uploadsDir: string;
  meiliHost?: string | null;
  meiliMasterKey?: string | null;
  authSecret?: string;
  mcpJwtSecret?: string;
  extra?: Record<string, string>;
}): Record<string, string> {
  const m = opts.manifest;
  return {
    NODE_ENV: "production",
    PORT: String(opts.port),
    HOSTNAME: opts.hostname,
    DB_PATH: opts.dbPath,
    ASSISTANT_DB_PATH: opts.assistantDbPath,
    UPLOADS_DIR: opts.uploadsDir,
    ...(opts.meiliHost
      ? {
          MEILI_HOST: opts.meiliHost,
          ...(opts.meiliMasterKey
            ? { MEILI_MASTER_KEY: opts.meiliMasterKey }
            : {}),
        }
      : {}),
    ...(opts.authSecret ? { AUTH_SECRET: opts.authSecret } : {}),
    ...(opts.mcpJwtSecret ? { MCP_JWT_SECRET: opts.mcpJwtSecret } : {}),
    ...brandEnv(m, {
      DESKTOP: "1",
      BRAND_ID: m.brandId,
    }),
    ...(opts.extra ?? {}),
  };
}

/** Override binaire Node hors packagé (`{PREFIX}_NODE_BINARY`). */
export function nodeBinaryEnvKey(manifest: AppManifest): string {
  return envKey(manifest, "NODE_BINARY");
}
