/**
 * Scopes des clés API publiques (`api_keys.scopes`).
 *
 * - `full` : accès intégration complet (Hermes, clés UI)
 * - `crm:read` : GET/HEAD/OPTIONS uniquement
 * - `crm:write` : lectures + mutations (implique read)
 *
 * Stockage : chaîne CSV (`crm:read,crm:write`) ou `full`.
 */

export const API_SCOPE_FULL = "full";
export const API_SCOPE_CRM_READ = "crm:read";
export const API_SCOPE_CRM_WRITE = "crm:write";
/** Lancer / suivre des tâches de collaborateurs IA (/api/v1/tasks). */
export const API_SCOPE_TASKS_RUN = "tasks:run";

const KNOWN = new Set([
  API_SCOPE_FULL,
  API_SCOPE_CRM_READ,
  API_SCOPE_CRM_WRITE,
  API_SCOPE_TASKS_RUN,
]);

/** Normalise vers CSV canonique (write ⇒ read ; full gagne). */
export function normalizeApiScopes(
  scopes: string | string[] | undefined | null,
): string {
  if (scopes == null || scopes === "") return API_SCOPE_FULL;
  const list = Array.isArray(scopes)
    ? scopes.map(String)
    : String(scopes)
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  if (list.includes(API_SCOPE_FULL) || list.includes("*")) {
    return API_SCOPE_FULL;
  }
  const out = new Set<string>();
  for (const s of list) {
    if (KNOWN.has(s) && s !== API_SCOPE_FULL) out.add(s);
  }
  if (out.has(API_SCOPE_CRM_WRITE)) out.add(API_SCOPE_CRM_READ);
  if (!out.size) return API_SCOPE_FULL;
  return Array.from(out).sort().join(",");
}

export function parseApiKeyScopes(scopes: string): Set<string> {
  const n = normalizeApiScopes(scopes);
  if (n === API_SCOPE_FULL) return new Set([API_SCOPE_FULL]);
  return new Set(n.split(",").filter(Boolean));
}

/** true si la clé peut exécuter la méthode HTTP sur les routes d’intégration. */
export function apiKeyAllowsMethod(scopes: string, method: string): boolean {
  const s = parseApiKeyScopes(scopes);
  if (s.has(API_SCOPE_FULL)) return true;
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") {
    return s.has(API_SCOPE_CRM_READ) || s.has(API_SCOPE_CRM_WRITE);
  }
  return s.has(API_SCOPE_CRM_WRITE);
}

/** true si la clé peut lancer / suivre des tâches IA (/api/v1/tasks). */
export function apiKeyAllowsTasks(scopes: string): boolean {
  const s = parseApiKeyScopes(scopes);
  return s.has(API_SCOPE_FULL) || s.has(API_SCOPE_TASKS_RUN);
}

/** Dérive les scopes DB depuis les permissions manifest plugin. */
export function scopesFromPluginPermissions(permissions: string[]): string | null {
  const perms = new Set(permissions.map(String));
  if (perms.has("crm:write")) {
    return normalizeApiScopes([API_SCOPE_CRM_READ, API_SCOPE_CRM_WRITE]);
  }
  if (perms.has("crm:read")) {
    return API_SCOPE_CRM_READ;
  }
  return null;
}
