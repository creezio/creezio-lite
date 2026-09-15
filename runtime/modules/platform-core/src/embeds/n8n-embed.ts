/**
 * Logique pure n8n — port brand-agnostic kit n8n-embed.ts.
 */

import path from "node:path";
import type { AppManifest } from "@lite/brand-config";
import { envKey } from "@lite/brand-config";
import { deriveTunnelServiceUrl } from "../tunnel-urls.js";
import {
  normalizeEmbedHttpOrigin,
  shouldSpawnHostOnlyEmbed,
  type EmbedToolMode,
} from "./embed-stack-hooks.js";
import { mergeEmbedUserEnv } from "./embed-env-catalog.js";

export type N8nEmbedMode = EmbedToolMode;

export type N8nEmbedConfig = {
  mode: N8nEmbedMode;
  remoteUiUrl?: string;
  chosen?: boolean;
};

export type N8nRuntimeStatus =
  | "running"
  | "stopped"
  | "missing"
  | "error"
  | "installing"
  | "skipped-remote-client"
  | "remote";

export const N8N_DEFAULT_PORT = 5678;
export const N8N_DESKTOP_PORT = 15678;
export const N8N_EXE_BUNDLE_CEILING_MB = 400;

export const N8N_AUDIT = {
  npmUnpackedPackageMb: 27,
  typicalInstallTreeMb: "300-600+",
  requiresDocker: false,
  requiresNode: ">=22.22",
  verdict: "download-on-first-run-npm" as const,
};

export function sanitizeN8nEmbedConfig(
  _raw?: Partial<N8nEmbedConfig> | null,
): N8nEmbedConfig {
  return { mode: "embedded", chosen: true };
}

export function shouldSpawnEmbeddedN8n(opts: {
  connectionMode: "local" | "remote";
  n8n: N8nEmbedConfig;
}): boolean {
  const n = sanitizeN8nEmbedConfig(opts.n8n);
  return shouldSpawnHostOnlyEmbed({
    connectionMode: opts.connectionMode,
    toolMode: n.mode,
  });
}

export function n8nEntryCandidates(
  runtimeDir: string,
  platform: NodeJS.Platform,
): string[] {
  const sep = platform === "win32" ? "\\" : "/";
  const base = runtimeDir.replace(/[/\\]+$/, "");
  return [
    `${base}${sep}node_modules${sep}n8n${sep}bin${sep}n8n.js`,
    `${base}${sep}node_modules${sep}n8n${sep}bin${sep}n8n`,
  ];
}

export function isNodeSpawnableN8nEntry(
  filePath: string,
  opts?: {
    existsSync?: (p: string) => boolean;
    readFileSync?: (p: string, encoding: "utf8") => string;
  },
): boolean {
  const exists = opts?.existsSync || (() => false);
  if (!filePath || !exists(filePath)) return false;
  const norm = filePath.replace(/\\/g, "/");
  const lower = norm.toLowerCase();
  if (/\.(cmd|bat|ps1)$/.test(lower)) return false;
  if (/\/npm\/n8n(\.cmd)?$/i.test(norm)) return false;
  if (lower.endsWith(".js")) return true;

  const read = opts?.readFileSync;
  if (!read) return false;
  try {
    const head = read(filePath, "utf8").slice(0, 500);
    if (/basedir=\$\(dirname/i.test(head) || /@ECHO\s+OFF/i.test(head)) {
      return false;
    }
    if (/^#!\s*\/bin\/(ba)?sh\b/m.test(head)) return false;
    return (
      /^#!\s*\/usr\/bin\/env\s+node\b/m.test(head) ||
      /^#!\s*\/usr\/bin\/node\b/m.test(head)
    );
  } catch {
    return false;
  }
}

export function n8nBinEnvKey(manifest: AppManifest): string {
  return envKey(manifest, "N8N_BIN");
}

export function resolveN8nEntry(opts: {
  platform: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  runtimeDir?: string | null;
  whichPath?: string | null;
  allowEnvOverride?: boolean;
  envPrefix?: string;
  existsSync?: (p: string) => boolean;
  readFileSync?: (p: string, encoding: "utf8") => string;
}): string | null {
  const env: Record<string, string | undefined> = opts.env || {};
  const exists = opts.existsSync || (() => false);
  const accept = (p: string) =>
    isNodeSpawnableN8nEntry(p, {
      existsSync: exists,
      readFileSync: opts.readFileSync,
    });

  if (opts.allowEnvOverride !== false) {
    const brandKey = opts.envPrefix ? `${opts.envPrefix}_N8N_BIN` : "";
    const override = (
      (brandKey && env[brandKey]) ||
      env.N8N_BIN ||
      ""
    ).trim();
    if (override && accept(override)) return override;
  }

  if (opts.runtimeDir) {
    for (const candidate of n8nEntryCandidates(
      opts.runtimeDir,
      opts.platform,
    )) {
      if (accept(candidate)) return candidate;
    }
  }
  return null;
}

export function n8nHomeLooksWarm(
  homeDir: string,
  existsSync: (p: string) => boolean,
): boolean {
  const candidates = [
    path.join(homeDir, ".n8n", "database.sqlite"),
    path.join(homeDir, "database.sqlite"),
  ];
  return candidates.some((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  });
}

export function describeN8nSpawnKind(opts: {
  warm: boolean;
  node: string;
  entry: string;
  home: string;
  uiUrl: string;
  healthTimeoutSec: number;
}): string {
  const base = `${opts.node}\n${opts.entry}\nstart (home=${opts.home}, ui=${opts.uiUrl}, health≤${opts.healthTimeoutSec}s)`;
  if (opts.warm) {
    return `redémarrage n8n — données déjà présentes\n${base}`;
  }
  return `première initialisation n8n — migrations\n${base}`;
}

export function buildNextN8nEnv(opts: {
  uiUrl: string | null;
}): Record<string, string> {
  if (!opts.uiUrl) return {};
  const base = opts.uiUrl.replace(/\/$/, "");
  return {
    N8N_BASE_URL: base,
    N8N_UI_URL: base,
  };
}

export function normalizeN8nPublicBaseUrl(raw?: string | null): string | null {
  const s = String(raw || "")
    .trim()
    .replace(/\/+$/, "");
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.origin}/`;
  } catch {
    return null;
  }
}

export function buildN8nSpawnEnv(opts: {
  port: number;
  userFolder: string;
  encryptionKey: string;
  host?: string;
  publicBaseUrl?: string | null;
  baseEnv?: Record<string, string | undefined>;
  userEnv?: Record<string, string> | null;
}): Record<string, string | undefined> {
  const host = opts.host || "127.0.0.1";
  const localBase = `http://${host}:${opts.port}/`;
  const publicBase = normalizeN8nPublicBaseUrl(opts.publicBaseUrl) || localBase;
  const product: Record<string, string | undefined> = {
    N8N_USER_FOLDER: opts.userFolder,
    N8N_HOST: host,
    N8N_PORT: String(opts.port),
    N8N_PROTOCOL: "http",
    N8N_LISTEN_ADDRESS: host,
    N8N_EDITOR_BASE_URL: publicBase,
    WEBHOOK_URL: publicBase,
    N8N_ENCRYPTION_KEY: opts.encryptionKey,
    N8N_SECURE_COOKIE: publicBase.startsWith("https:") ? "true" : "false",
    N8N_SAMESITE_COOKIE: "lax",
    N8N_MFA_ENABLED: "false",
    N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: "false",
    N8N_HIRING_BANNER_ENABLED: "false",
    N8N_MCP_MANAGED_BY_ENV: "true",
    N8N_MCP_ACCESS_ENABLED: "true",
    N8N_VERIFIED_PACKAGES_ENABLED: "false",
  };
  if (publicBase.startsWith("https:")) {
    product.N8N_PROXY_HOPS = "1";
  }
  const merged = mergeEmbedUserEnv({
    service: "n8n",
    systemEnv: product,
    userOverlay: opts.userEnv,
  });
  const out: Record<string, string | undefined> = {
    ...(opts.baseEnv || {}),
    ...merged,
    ...product,
  };
  delete out.N8N_BASIC_AUTH_ACTIVE;
  delete out.N8N_BASIC_AUTH_USER;
  delete out.N8N_BASIC_AUTH_PASSWORD;
  delete out.N8N_DISABLED_MODULES;
  out.N8N_MCP_MANAGED_BY_ENV = "true";
  out.N8N_MCP_ACCESS_ENABLED = "true";
  return out;
}

export function n8nPublicStatus(opts: {
  connectionMode: "local" | "remote";
  config: N8nEmbedConfig;
  entryFound: boolean;
  running: boolean;
  uiUrl: string | null;
  lastError: string | null;
  version: string | null;
  installing?: boolean;
  remoteCrmOrigin?: string | null;
  tunnelRootDomain: string;
  /** nested | flat — défaut via env / nested. */
  tunnelHostMode?: "nested" | "flat";
  productName?: string;
}): {
  status: N8nRuntimeStatus;
  mode: N8nEmbedMode;
  uiUrl: string | null;
  entryFound: boolean;
  version: string | null;
  detail: string;
} {
  const config = sanitizeN8nEmbedConfig(opts.config);
  const product = opts.productName || "le desktop";
  if (opts.connectionMode === "remote") {
    const derived = opts.remoteCrmOrigin
      ? deriveTunnelServiceUrl(
          opts.remoteCrmOrigin,
          "n8n",
          opts.tunnelRootDomain,
          opts.tunnelHostMode,
        )
      : null;
    const uiUrl = (config.remoteUiUrl || derived || "").trim() || null;
    return {
      status: uiUrl ? "remote" : "skipped-remote-client",
      mode: config.mode,
      uiUrl,
      entryFound: opts.entryFound,
      version: null,
      detail: uiUrl
        ? `Client distant — UI n8n via tunnel (${uiUrl}).`
        : "Client distant — n8n tourne sur le serveur hôte (pas de spawn local).",
    };
  }
  if (config.mode === "remote") {
    return {
      status: "remote",
      mode: "remote",
      uiUrl: config.remoteUiUrl || null,
      entryFound: opts.entryFound,
      version: null,
      detail: config.remoteUiUrl
        ? "Mode distant : UI n8n via URL configurée (pas de process local)."
        : "Mode distant : renseignez l'URL n8n.",
    };
  }
  if (config.mode === "off") {
    return {
      status: "stopped",
      mode: "off",
      uiUrl: null,
      entryFound: opts.entryFound,
      version: null,
      detail: "n8n désactivé dans la configuration.",
    };
  }
  if (opts.installing) {
    return {
      status: "installing",
      mode: "embedded",
      uiUrl: null,
      entryFound: opts.entryFound,
      version: null,
      detail: "Installation runtime n8n (npm) en cours…",
    };
  }
  if (!opts.entryFound) {
    return {
      status: "missing",
      mode: "embedded",
      uiUrl: null,
      entryFound: false,
      version: null,
      detail: `Runtime n8n introuvable. Installation au boot Héberger via Node ${product} (~300–600 Mo).`,
    };
  }
  if (opts.lastError && !opts.running) {
    return {
      status: "error",
      mode: "embedded",
      uiUrl: opts.uiUrl,
      entryFound: true,
      version: opts.version,
      detail: opts.lastError,
    };
  }
  if (opts.running) {
    return {
      status: "running",
      mode: "embedded",
      uiUrl: opts.uiUrl,
      entryFound: true,
      version: opts.version,
      detail: `n8n local ${opts.uiUrl || ""}`.trim(),
    };
  }
  return {
    status: "stopped",
    mode: "embedded",
    uiUrl: opts.uiUrl,
    entryFound: true,
    version: opts.version,
    detail: "n8n arrêté.",
  };
}

export { normalizeEmbedHttpOrigin as normalizeHttpOrigin };
