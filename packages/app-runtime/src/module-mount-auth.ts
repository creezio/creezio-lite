/**
 * Garde session HTTP pour `/api/v1/modules/*` (BACKLOG F3 / DASH-5)
 * et `/api/v1/admin/*` (supervision MCP / database / analytics).
 *
 * Default-deny à la bordure `listenBrandOsHttp` — le kernel reste
 * framework-agnostique. Allowlist explicite des chemins machine/public
 * (webhooks signés, register/heartbeat Bearer, agent releases, LP public).
 * La surface admin n'a **pas** d'allowlist : session cookie/Bearer JWT
 * obligatoire (AUTH_DISABLED = owner virtuel hors production seulement).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { IncomingHttpHeaders } from "node:http";
import {
  getAuthConfig,
  isAuthDisabled,
  verifySessionToken,
  type SessionPayload,
} from "@creezio/auth";

export type PublicModulePathRule = {
  /** Méthode HTTP ; omit = toutes. */
  method?: string;
  match: (pathname: string) => boolean;
};

/**
 * Chemins volontairement joignables sans session plateforme.
 * L'auth machine (HMAC / Bearer secret) reste dans le mount.
 */
export const PUBLIC_MODULE_PATHS: readonly PublicModulePathRule[] = [
  {
    method: "POST",
    match: (p) => p === "/api/v1/modules/billing-webhook/stripe",
  },
  {
    method: "POST",
    match: (p) => p === "/api/v1/modules/fleet-registry/register",
  },
  {
    method: "POST",
    match: (p) => p === "/api/v1/modules/fleet-registry/heartbeat",
  },
  {
    method: "GET",
    match: (p) => p === "/api/v1/modules/fleet-releases/next",
  },
  {
    method: "POST",
    match: (p) => p === "/api/v1/modules/fleet-releases/slots",
  },
  {
    method: "DELETE",
    match: (p) => /^\/api\/v1\/modules\/fleet-releases\/slots\//.test(p),
  },
  {
    method: "POST",
    match: (p) => p === "/api/v1/modules/fleet-releases/report",
  },
  {
    method: "POST",
    match: (p) => p === "/api/v1/modules/fleet-releases/maintenance",
  },
  {
    method: "GET",
    match: (p) => p === "/api/v1/modules/landing/public",
  },
];

/**
 * Header boot catalogue marque — porte le **secret interne par processus**
 * (`CREEZIO_CATALOG_INTERNAL_SECRET`), jamais une constante. Posé uniquement
 * par le host de boot / harness / scripts ops (même process ou parent qui a
 * injecté le secret dans l'env de l'enfant) — jamais un client UI.
 */
export const CATALOG_INTERNAL_HEADER = "x-creezio-catalog-internal";

/**
 * Env portant le secret machine du boot catalogue. Généré aléatoirement par
 * processus via `ensureCatalogInternalSecret()` — un client HTTP externe ne
 * peut pas le deviner (fix P0 : l'ancienne valeur constante `1` était un
 * bypass anonyme d'`ensure`/`import`).
 */
export const CATALOG_INTERNAL_SECRET_ENV = "CREEZIO_CATALOG_INTERNAL_SECRET";

const CATALOG_INTERNAL_SECRET_MIN_LENGTH = 16;

/**
 * Retourne le secret interne catalogue du processus, en le générant
 * (32 octets aléatoires hex) s'il est absent ou trop court. À appeler côté
 * émetteur (host de boot / harness) AVANT l'appel HTTP ensure/import.
 */
export function ensureCatalogInternalSecret(): string {
  const current = (process.env[CATALOG_INTERNAL_SECRET_ENV] || "").trim();
  if (current.length >= CATALOG_INTERNAL_SECRET_MIN_LENGTH) return current;
  const generated = randomBytes(32).toString("hex");
  process.env[CATALOG_INTERNAL_SECRET_ENV] = generated;
  return generated;
}

/** Compare header interne ↔ secret env (fail-closed, temps constant). */
export function catalogInternalHeaderAllows(
  headers: IncomingHttpHeaders,
): boolean {
  const raw = headers[CATALOG_INTERNAL_HEADER];
  const value = String(Array.isArray(raw) ? raw[0] || "" : raw || "").trim();
  if (!value) return false;
  const secret = (process.env[CATALOG_INTERNAL_SECRET_ENV] || "").trim();
  if (secret.length < CATALOG_INTERNAL_SECRET_MIN_LENGTH) return false;
  return sameKey(value, secret);
}

/**
 * Chemins ensure/import catalogue joignables sans JWT **si** le header
 * interne porte le secret du processus. Le mount marque revérifie le même
 * secret (403 sinon) — la garde ne fait que laisser passer le boot headless.
 */
export function isCatalogInternalBootPath(
  method: string,
  pathname: string,
  headers: IncomingHttpHeaders,
): boolean {
  if (!catalogInternalHeaderAllows(headers)) return false;
  const m = (method || "GET").toUpperCase();
  if (pathname === "/api/v1/modules/catalog/ensure" && m === "POST") {
    return true;
  }
  if (
    pathname === "/api/v1/modules/catalog/import" &&
    (m === "POST" || m === "GET")
  ) {
    return true;
  }
  return false;
}

export function isModuleApiPath(pathname: string): boolean {
  return (
    pathname === "/api/v1/modules" || pathname.startsWith("/api/v1/modules/")
  );
}

/** Surface supervision OS (MCP, database, analytics, endpoints, logs). */
export function isAdminApiPath(pathname: string): boolean {
  return pathname === "/api/v1/admin" || pathname.startsWith("/api/v1/admin/");
}

export function isPublicModulePath(method: string, pathname: string): boolean {
  const m = (method || "GET").toUpperCase();
  return PUBLIC_MODULE_PATHS.some(
    (r) => (!r.method || r.method === m) && r.match(pathname),
  );
}

function cookieValue(
  header: string | string[] | undefined,
  name: string,
): string {
  if (!name || !header) return "";
  const raw = Array.isArray(header) ? header.join("; ") : header;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return part.slice(idx + 1).trim();
    }
  }
  return "";
}

function bearerToken(header: string | string[] | undefined): string {
  const authz = Array.isArray(header) ? header[0] || "" : header || "";
  if (!authz.toLowerCase().startsWith("bearer ")) return "";
  return authz.slice(7).trim();
}

/** JWT session (3 segments) — ignore les Bearer opaques (API keys / agent). */
function looksLikeJwt(token: string): boolean {
  return token.split(".").length === 3;
}

/**
 * Session plateforme depuis headers Node (cookie configuré ou Bearer JWT).
 * `AUTH_DISABLED` → session owner virtuelle (harness / sandbox).
 */
export async function sessionFromNodeHeaders(
  headers: IncomingHttpHeaders,
): Promise<SessionPayload | null> {
  if (isAuthDisabled()) {
    return {
      sub: "auth-disabled",
      email: "auth-disabled",
      role: "owner",
      permissions: [],
    };
  }
  const cookieName = getAuthConfig().cookieName;
  let token = cookieName
    ? cookieValue(headers.cookie, cookieName)
    : "";
  if (!token) token = bearerToken(headers.authorization);
  if (!token || !looksLikeJwt(token)) return null;
  return verifySessionToken(token);
}

export type ModuleMountAuthDecision =
  | { ok: true; public?: boolean; session?: SessionPayload; machine?: boolean }
  | { ok: false; status: 401; body: Record<string, unknown> };

/** Handle brand.db minimal (SqliteHandle kernel) pour vérifier `api_keys`. */
export type ModuleMountBrandDb = {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => unknown;
  };
};

/**
 * Vérifie une clé machine (Bearer opaque / `x-api-key`) contre la table
 * `api_keys` de brand.db — même contrat que la clé service Hermes/plugins
 * (`crm:read` requis en lecture, `crm:write` en mutation, `full` = tout).
 */
export type ModuleMachineKeyVerifier = (input: {
  method: string;
  headers: IncomingHttpHeaders;
}) => boolean | Promise<boolean>;

function opaqueMachineKey(headers: IncomingHttpHeaders): string {
  const xKeyRaw = headers["x-api-key"];
  const xKey = Array.isArray(xKeyRaw) ? xKeyRaw[0] || "" : xKeyRaw || "";
  const raw = xKey.trim() || bearerToken(headers.authorization);
  if (!raw || looksLikeJwt(raw)) return "";
  return raw;
}

export function createBrandApiKeyModuleVerifier(
  getBrandDb: () => ModuleMountBrandDb | null,
): ModuleMachineKeyVerifier {
  return ({ method, headers }) => {
    const raw = opaqueMachineKey(headers);
    if (!raw) return false;
    const db = getBrandDb();
    if (!db) return false;
    try {
      const hash = createHash("sha256").update(raw, "utf8").digest("hex");
      const row = db
        .prepare(
          `SELECT scopes FROM api_keys
            WHERE key_hash = ? AND revoked_at IS NULL`,
        )
        .get(hash) as { scopes?: string } | undefined;
      if (!row) return false;
      return scopeAllows(String(row.scopes || ""), method);
    } catch {
      return false; // table api_keys absente (marque sans clés machine)
    }
  };
}

function scopeAllows(scopes: string, method: string): boolean {
  if (scopes === "full") return true;
  const list = scopes.split(",").map((s) => s.trim());
  const m = (method || "GET").toUpperCase();
  const needed = m === "GET" || m === "HEAD" ? "crm:read" : "crm:write";
  return list.includes(needed);
}

function sameKey(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Vérifie une clé machine contre les clés service des plugins installés
 * (fichiers `.*plugin-api-key.json` écrits par le host plugins du kit) —
 * couvre les marques sans table `api_keys` (sandbox / factory nues).
 */
export function createPluginDiskKeyModuleVerifier(
  getPluginsRoot: () => string | null,
): ModuleMachineKeyVerifier {
  return ({ method, headers }) => {
    const raw = opaqueMachineKey(headers);
    if (!raw) return false;
    const root = getPluginsRoot();
    if (!root || !fs.existsSync(root)) return false;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      return false;
    }
    for (const entry of entries) {
      const dir = path.join(root, entry);
      let files: string[] = [];
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
        files = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!/plugin-api-key\.json$/.test(f)) continue;
        try {
          const stored = JSON.parse(
            fs.readFileSync(path.join(dir, f), "utf8"),
          ) as { apiKey?: string; scopes?: string };
          if (
            stored.apiKey &&
            sameKey(raw, stored.apiKey) &&
            scopeAllows(String(stored.scopes || ""), method)
          ) {
            return true;
          }
        } catch {
          // fichier clé illisible — on continue (fail-closed)
        }
      }
    }
    return false;
  };
}

/** Combine des vérificateurs machine — premier qui accepte gagne. */
export function anyModuleMachineKeyVerifier(
  ...verifiers: ModuleMachineKeyVerifier[]
): ModuleMachineKeyVerifier {
  return async (input) => {
    for (const v of verifiers) {
      if (await v(input)) return true;
    }
    return false;
  };
}

/**
 * Décision garde mounts modules + admin — à appeler à la bordure HTTP
 * (avant `api.handle` **et** avant le proxy Hono `/api/v1/admin/*`).
 * Les appels in-process (`api.handle` / `app.request` Hono) ne passent pas ici.
 */
export async function assertModuleMountSession(input: {
  method: string;
  pathname: string;
  headers: IncomingHttpHeaders;
  /** Auth machine (clé API brand) en plus de la session plateforme. */
  verifyMachineKey?: ModuleMachineKeyVerifier;
}): Promise<ModuleMountAuthDecision> {
  // Admin : session uniquement — une clé machine métier ne déverrouille pas
  // database/MCP/analytics (pas d'owner virtuel hors AUTH_DISABLED harness).
  if (isAdminApiPath(input.pathname)) {
    const session = await sessionFromNodeHeaders(input.headers);
    if (!session) {
      return {
        ok: false,
        status: 401,
        body: {
          ok: false,
          error: "unauthorized",
          hint: "session cookie or Bearer JWT required",
        },
      };
    }
    return { ok: true, session };
  }
  if (!isModuleApiPath(input.pathname)) return { ok: true };
  if (isPublicModulePath(input.method, input.pathname)) {
    return { ok: true, public: true };
  }
  if (
    isCatalogInternalBootPath(input.method, input.pathname, input.headers)
  ) {
    return { ok: true, public: true };
  }
  const session = await sessionFromNodeHeaders(input.headers);
  if (!session && input.verifyMachineKey) {
    const machine = await input.verifyMachineKey({
      method: input.method,
      headers: input.headers,
    });
    if (machine) return { ok: true, machine: true };
  }
  if (!session) {
    return {
      ok: false,
      status: 401,
      body: {
        ok: false,
        error: "unauthorized",
        hint: "session cookie or Bearer JWT required",
      },
    };
  }
  return { ok: true, session };
}
