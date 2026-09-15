/**
 * Provisionnement silencieux d’une API key n8n (REST public /api/v1).
 * Gold première marque — labels / fichier paramétrables par marque.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

/** Scopes minimaux pour piloter workflows (community / self-hosted). */
export const N8N_HERMES_API_SCOPES = [
  "workflow:create",
  "workflow:read",
  "workflow:update",
  "workflow:delete",
  "workflow:list",
  "workflow:move",
  "workflow:execute",
  "execution:read",
  "execution:list",
  "execution:delete",
  "tag:create",
  "tag:read",
  "tag:update",
  "tag:delete",
  "tag:list",
  "project:list",
  "project:read",
  "credential:create",
  "credential:read",
  "credential:update",
  "credential:delete",
  "credential:list",
  "variable:list",
  "variable:read",
] as const;

export type N8nApiKeyBrand = {
  /** Label n8n, ex. `{Produit} Hermes`. */
  label: string;
  /** Fichier sous n8n-home, ex. `.{brandId}-n8n-api-key.json`. */
  fileName: string;
};

export type N8nApiKeyStored = {
  id?: string;
  label: string;
  apiKey: string;
  createdAt: string;
};

export function n8nApiKeyPath(homeDir: string, brand: N8nApiKeyBrand): string {
  return path.join(homeDir, brand.fileName);
}

export function readStoredN8nApiKey(
  homeDir: string,
  brand: N8nApiKeyBrand,
): N8nApiKeyStored | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(n8nApiKeyPath(homeDir, brand), "utf8"),
    ) as N8nApiKeyStored;
    if (raw && typeof raw.apiKey === "string" && raw.apiKey.length >= 16) {
      return raw;
    }
  } catch {
    /* absent */
  }
  return null;
}

export function writeStoredN8nApiKey(
  homeDir: string,
  brand: N8nApiKeyBrand,
  data: N8nApiKeyStored,
): void {
  fs.mkdirSync(homeDir, { recursive: true });
  fs.writeFileSync(
    n8nApiKeyPath(homeDir, brand),
    `${JSON.stringify(data, null, 2)}\n`,
    { mode: 0o600 },
  );
}

/**
 * Instance n8n vierge ? Lit `/rest/settings` :
 * `data.userManagement.showSetupOnFirstLoad` (true = owner à créer).
 * null = signal indisponible (vieux n8n / réponse inattendue).
 */
export function n8nNeedsOwnerSetup(settingsJson: unknown): boolean | null {
  if (!settingsJson || typeof settingsJson !== "object") return null;
  const data = (settingsJson as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const um = (data as { userManagement?: unknown }).userManagement;
  if (!um || typeof um !== "object") return null;
  const flag = (um as { showSetupOnFirstLoad?: unknown }).showSetupOnFirstLoad;
  return typeof flag === "boolean" ? flag : null;
}

/**
 * Login n8n réellement authentifié = 2xx ET cookie de session `n8n-auth`.
 * Une instance vierge (pré-owner-setup) répond 200 à `/rest/login` avec le
 * shell user SANS cookie — un simple test de status crée un faux positif
 * (vécu : « owner: login OK » sur instance non initialisée, owner jamais
 * provisionné).
 */
export function n8nLoginSucceeded(
  status: number,
  setCookie: string[] | string | undefined,
): boolean {
  if (status < 200 || status >= 300) return false;
  return cookieHeaderFromSetCookie(setCookie).includes("n8n-auth=");
}

export function cookieHeaderFromSetCookie(
  setCookie: string[] | string | undefined,
): string {
  const lines = !setCookie
    ? []
    : Array.isArray(setCookie)
      ? setCookie
      : [setCookie];
  const parts: string[] = [];
  for (const line of lines) {
    const nameVal = String(line).split(";")[0] || "";
    if (nameVal.includes("=")) parts.push(nameVal.trim());
  }
  return parts.join("; ");
}

export function n8nHttpJson(
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{
  status: number;
  json: unknown;
  headers: http.IncomingHttpHeaders;
  raw: string;
}> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}${u.search}`,
        method,
        headers: {
          Accept: "application/json",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
        timeout: 20000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json: unknown = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          resolve({
            status: res.statusCode || 0,
            json,
            headers: res.headers,
            raw,
          });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("n8n api-key timeout"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

export function extractRawN8nApiKey(
  json: unknown,
): { id?: string; apiKey: string } | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const apiKey =
    (typeof o.rawApiKey === "string" && o.rawApiKey) ||
    (typeof o.apiKey === "string" && o.apiKey) ||
    (typeof o.data === "object" &&
    o.data &&
    typeof (o.data as { rawApiKey?: string }).rawApiKey === "string"
      ? (o.data as { rawApiKey: string }).rawApiKey
      : null);
  if (!apiKey || apiKey.length < 16) return null;
  const id =
    typeof o.id === "string"
      ? o.id
      : typeof o.id === "number"
        ? String(o.id)
        : undefined;
  return { id, apiKey };
}

export async function fetchN8nApiKeyScopes(
  base: string,
  cookie: string,
): Promise<string[]> {
  try {
    const res = await n8nHttpJson(
      "GET",
      `${base}/rest/api-keys/scopes`,
      undefined,
      { Cookie: cookie },
    );
    if (res.status >= 200 && res.status < 300) {
      const arr = Array.isArray(res.json)
        ? res.json
        : Array.isArray((res.json as { data?: unknown })?.data)
          ? (res.json as { data: unknown[] }).data
          : null;
      if (arr?.length) {
        return arr.map(String).filter((s) => /^[a-zA-Z]+:[a-zA-Z]+$/.test(s));
      }
    }
  } catch {
    /* fallback */
  }
  return [...N8N_HERMES_API_SCOPES];
}

export async function ensureN8nApiKey(opts: {
  uiUrl: string;
  homeDir: string;
  email: string;
  password: string;
  brand: N8nApiKeyBrand;
  log?: (line: string) => void;
  forceNew?: boolean;
}): Promise<{ ok: boolean; apiKey: string | null; detail: string }> {
  const log = opts.log || (() => {});
  const brand = opts.brand;
  const existing = readStoredN8nApiKey(opts.homeDir, brand);
  if (existing && !opts.forceNew) {
    log(`api-key: réutilise clé ${brand.label} (fichier local)`);
    return {
      ok: true,
      apiKey: existing.apiKey,
      detail: "clé n8n déjà provisionnée",
    };
  }

  const base = opts.uiUrl.replace(/\/$/, "");
  try {
    const login = await n8nHttpJson("POST", `${base}/rest/login`, {
      emailOrLdapLoginId: opts.email,
      password: opts.password,
    });
    if (!(login.status >= 200 && login.status < 300)) {
      return {
        ok: false,
        apiKey: null,
        detail: `login n8n HTTP ${login.status}`,
      };
    }
    const cookie = cookieHeaderFromSetCookie(login.headers["set-cookie"]);
    if (!cookie) {
      return { ok: false, apiKey: null, detail: "login OK sans cookie" };
    }

    const scopes = await fetchN8nApiKeyScopes(base, cookie);
    const create = await n8nHttpJson(
      "POST",
      `${base}/rest/api-keys`,
      {
        label: brand.label,
        expiresAt: null,
        scopes,
      },
      { Cookie: cookie },
    );

    if (!(create.status >= 200 && create.status < 300)) {
      const retry = await n8nHttpJson(
        "POST",
        `${base}/rest/api-keys`,
        {
          label: brand.label,
          expiresAt: null,
          scopes: [
            "workflow:create",
            "workflow:read",
            "workflow:update",
            "workflow:delete",
            "workflow:list",
            "execution:read",
            "execution:list",
          ],
        },
        { Cookie: cookie },
      );
      if (!(retry.status >= 200 && retry.status < 300)) {
        return {
          ok: false,
          apiKey: null,
          detail: `création API key HTTP ${create.status}/${retry.status}: ${retry.raw.slice(0, 200)}`,
        };
      }
      const parsedRetry = extractRawN8nApiKey(retry.json);
      if (!parsedRetry) {
        return {
          ok: false,
          apiKey: null,
          detail: "API key créée mais rawApiKey absent",
        };
      }
      writeStoredN8nApiKey(opts.homeDir, brand, {
        id: parsedRetry.id,
        label: brand.label,
        apiKey: parsedRetry.apiKey,
        createdAt: new Date().toISOString(),
      });
      log("api-key: provisionnée (scopes minimaux)");
      return {
        ok: true,
        apiKey: parsedRetry.apiKey,
        detail: "clé n8n créée",
      };
    }

    const parsed = extractRawN8nApiKey(create.json);
    if (!parsed) {
      return {
        ok: false,
        apiKey: null,
        detail: "API key créée mais rawApiKey absent",
      };
    }
    writeStoredN8nApiKey(opts.homeDir, brand, {
      id: parsed.id,
      label: brand.label,
      apiKey: parsed.apiKey,
      createdAt: new Date().toISOString(),
    });
    log("api-key: provisionnée pour Hermes");
    return { ok: true, apiKey: parsed.apiKey, detail: "clé n8n créée" };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, apiKey: null, detail };
  }
}

export function getN8nBridgeEnv(opts: {
  homeDir: string;
  localUiUrl: string;
  brand: N8nApiKeyBrand;
}): Record<string, string> {
  const stored = readStoredN8nApiKey(opts.homeDir, opts.brand);
  const base = opts.localUiUrl.replace(/\/$/, "");
  const out: Record<string, string> = {
    N8N_BASE_URL: base,
    N8N_API_URL: `${base}/api/v1`,
  };
  if (stored?.apiKey) {
    out.N8N_API_KEY = stored.apiKey;
  }
  return out;
}
