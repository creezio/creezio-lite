/**
 * Étanchéité par collaborateur IA (Q2 multi-profils) — gold kit paramétré.
 */

import fs from "node:fs";
import path from "node:path";
import {
  cookieHeaderFromSetCookie,
  n8nHttpJson,
  extractRawN8nApiKey,
  fetchN8nApiKeyScopes,
} from "./api-key.js";
import { hermesSandboxPaths } from "../sandbox/embed-sandbox.js";

export type N8nAgentIsolationBrand = {
  /** Fichier sous n8n-home, ex. `.tempoflow-n8n-agent-keys.json`. */
  keysFileName: string;
  /** Label API key : `{labelPrefix} {segment}`. */
  labelPrefix: string;
  /** Tag workflows : `{tagPrefix}:{segment}`. */
  tagPrefix: string;
  /** Nom produit pour README workspace. */
  productName: string;
};

export type N8nAgentKeyStored = {
  id?: string;
  label: string;
  apiKey: string;
  createdAt: string;
};

export type N8nAgentKeysFile = Record<string, N8nAgentKeyStored>;

export function agentIdSegment(aiUserId: string): string {
  const cleaned = String(aiUserId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.slice(0, 64) || "agent";
}

export function n8nAgentKeyLabel(
  brand: N8nAgentIsolationBrand,
  aiUserId: string,
): string {
  return `${brand.labelPrefix} ${agentIdSegment(aiUserId)}`;
}

export function n8nAgentTag(
  brand: N8nAgentIsolationBrand,
  aiUserId: string,
): string {
  return `${brand.tagPrefix}:${agentIdSegment(aiUserId)}`;
}

export function n8nAgentKeysPath(
  homeDir: string,
  brand: N8nAgentIsolationBrand,
): string {
  return path.join(homeDir, brand.keysFileName);
}

export function readStoredN8nAgentKeys(
  homeDir: string,
  brand: N8nAgentIsolationBrand,
): N8nAgentKeysFile {
  try {
    const raw = JSON.parse(
      fs.readFileSync(n8nAgentKeysPath(homeDir, brand), "utf8"),
    ) as N8nAgentKeysFile;
    if (raw && typeof raw === "object") {
      const out: N8nAgentKeysFile = {};
      for (const [userId, entry] of Object.entries(raw)) {
        if (
          entry &&
          typeof entry.apiKey === "string" &&
          entry.apiKey.length >= 16
        ) {
          out[userId] = entry;
        }
      }
      return out;
    }
  } catch {
    /* absent */
  }
  return {};
}

export function writeStoredN8nAgentKeys(
  homeDir: string,
  brand: N8nAgentIsolationBrand,
  keys: N8nAgentKeysFile,
): void {
  fs.mkdirSync(homeDir, { recursive: true });
  fs.writeFileSync(
    n8nAgentKeysPath(homeDir, brand),
    `${JSON.stringify(keys, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export async function ensureN8nAgentApiKey(opts: {
  uiUrl: string;
  homeDir: string;
  email: string;
  password: string;
  aiUserId: string;
  brand: N8nAgentIsolationBrand;
  log?: (line: string) => void;
  forceNew?: boolean;
}): Promise<{ ok: boolean; apiKey: string | null; detail: string }> {
  const log = opts.log || (() => {});
  const keys = readStoredN8nAgentKeys(opts.homeDir, opts.brand);
  const existing = keys[opts.aiUserId];
  if (existing && !opts.forceNew) {
    return {
      ok: true,
      apiKey: existing.apiKey,
      detail: "clé n8n agent déjà provisionnée",
    };
  }

  const base = opts.uiUrl.replace(/\/$/, "");
  const label = n8nAgentKeyLabel(opts.brand, opts.aiUserId);
  try {
    const login = await n8nHttpJson("POST", `${base}/rest/login`, {
      emailOrLdapLoginId: opts.email,
      password: opts.password,
    });
    if (!(login.status >= 200 && login.status < 300)) {
      return { ok: false, apiKey: null, detail: `login n8n HTTP ${login.status}` };
    }
    const cookie = cookieHeaderFromSetCookie(login.headers["set-cookie"]);
    if (!cookie) {
      return { ok: false, apiKey: null, detail: "login OK sans cookie" };
    }

    const scopes = await fetchN8nApiKeyScopes(base, cookie);
    const create = await n8nHttpJson(
      "POST",
      `${base}/rest/api-keys`,
      { label, expiresAt: null, scopes },
      { Cookie: cookie },
    );
    if (!(create.status >= 200 && create.status < 300)) {
      return {
        ok: false,
        apiKey: null,
        detail: `création API key agent HTTP ${create.status}: ${create.raw.slice(0, 200)}`,
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
    keys[opts.aiUserId] = {
      id: parsed.id,
      label,
      apiKey: parsed.apiKey,
      createdAt: new Date().toISOString(),
    };
    writeStoredN8nAgentKeys(opts.homeDir, opts.brand, keys);
    log(`api-key agent: provisionnée (${label})`);
    return { ok: true, apiKey: parsed.apiKey, detail: "clé n8n agent créée" };
  } catch (e) {
    return {
      ok: false,
      apiKey: null,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function revokeN8nAgentApiKey(opts: {
  uiUrl: string;
  homeDir: string;
  email: string;
  password: string;
  aiUserId: string;
  brand: N8nAgentIsolationBrand;
  log?: (line: string) => void;
}): Promise<{ ok: boolean; detail: string }> {
  const keys = readStoredN8nAgentKeys(opts.homeDir, opts.brand);
  const existing = keys[opts.aiUserId];
  if (!existing) return { ok: true, detail: "aucune clé agent à révoquer" };

  delete keys[opts.aiUserId];
  writeStoredN8nAgentKeys(opts.homeDir, opts.brand, keys);

  if (!existing.id) {
    return { ok: true, detail: "clé retirée du fichier (id n8n inconnu)" };
  }
  const base = opts.uiUrl.replace(/\/$/, "");
  try {
    const login = await n8nHttpJson("POST", `${base}/rest/login`, {
      emailOrLdapLoginId: opts.email,
      password: opts.password,
    });
    const cookie = cookieHeaderFromSetCookie(login.headers["set-cookie"]);
    if (!cookie) return { ok: false, detail: "login n8n sans cookie" };
    const del = await n8nHttpJson(
      "DELETE",
      `${base}/rest/api-keys/${encodeURIComponent(existing.id)}`,
      undefined,
      { Cookie: cookie },
    );
    if (del.status >= 200 && del.status < 300) {
      opts.log?.(`api-key agent: révoquée (${existing.label})`);
      return { ok: true, detail: "clé n8n agent révoquée" };
    }
    return { ok: false, detail: `révocation HTTP ${del.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export function hermesAgentWorkspaceDir(
  hermesHome: string,
  aiUserId: string,
): string {
  const { workspace } = hermesSandboxPaths(hermesHome);
  return path.join(workspace, "agents", agentIdSegment(aiUserId));
}

export function ensureHermesAgentWorkspace(
  hermesHome: string,
  aiUserId: string,
  brand: Pick<N8nAgentIsolationBrand, "productName">,
): string {
  const dir = hermesAgentWorkspaceDir(hermesHome, aiUserId);
  fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, "README-AGENT.txt");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      [
        `${brand.productName} — workspace de l'agent ${agentIdSegment(aiUserId)}`,
        "",
        "Espace de travail cloisonné de ce collaborateur IA (fichiers, brouillons).",
        "Ne pas y stocker de secrets — voir la politique multi-profils (Q2).",
        "",
      ].join("\n"),
      "utf8",
    );
  }
  return dir;
}
