/**
 * Logique pure Hermes Agent — port brand-agnostic kit hermes-embed.ts.
 * Aucun import Electron : testable depuis Node.
 */

import type { AppManifest } from "@lite/brand-config";
import { envKey } from "@lite/brand-config";
import { deriveTunnelServiceUrl } from "../tunnel-urls.js";
import { mergeEmbedUserEnv } from "./embed-env-catalog.js";

export type HermesEmbedMode = "embedded" | "remote" | "off";

export type HermesEmbedConfig = {
  mode: HermesEmbedMode;
  remoteApiUrl?: string;
  remoteWebuiUrl?: string;
  chosen?: boolean;
};

export type HermesRuntimeStatus =
  | "running"
  | "starting"
  | "stopped"
  | "missing"
  | "error"
  | "installing"
  | "skipped-remote-client"
  | "remote";

export type HermesWebuiStatus =
  | "running"
  | "stopped"
  | "missing"
  | "error"
  | "skipped";

export const HERMES_DEFAULT_API_PORT = 8642;
export const HERMES_DEFAULT_WEBUI_PORT = 8797;
export const HERMES_DESKTOP_API_PORT = 18642;
export const HERMES_DESKTOP_WEBUI_PORT = 18797;
export const HERMES_EXE_BUNDLE_CEILING_MB = 400;

export function sanitizeHermesEmbedConfig(
  _raw?: Partial<HermesEmbedConfig> | null,
): HermesEmbedConfig {
  return { mode: "embedded", chosen: true };
}

export function normalizeHttpOrigin(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) throw new Error("URL requise");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("URL doit être http(s)");
  }
  if (!u.hostname) throw new Error("Hôte manquant");
  return u.origin;
}

export function shouldSpawnEmbeddedHermes(opts: {
  connectionMode: "local" | "remote";
  hermes: HermesEmbedConfig;
}): boolean {
  if (opts.connectionMode !== "local") return false;
  const h = sanitizeHermesEmbedConfig(opts.hermes);
  return h.mode === "embedded";
}

export function hermesBinaryCandidates(platform: NodeJS.Platform): string[] {
  return platform === "win32"
    ? ["hermes.exe", "hermes.cmd", "hermes"]
    : ["hermes"];
}

export function resolveHermesBinary(opts: {
  platform: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  searchDirs?: string[];
  allowEnvOverride?: boolean;
  /** Prefixe env marque (ex. TF2) — override `{PREFIX}_HERMES_BIN`. */
  envPrefix?: string;
  existsSync?: (p: string) => boolean;
}): string | null {
  const env: Record<string, string | undefined> = opts.env || {};
  const exists = opts.existsSync || (() => false);
  if (opts.allowEnvOverride) {
    const brandKey = opts.envPrefix
      ? `${opts.envPrefix}_HERMES_BIN`
      : "";
    const override = (
      (brandKey && env[brandKey]) ||
      env.HERMES_BIN ||
      ""
    ).trim();
    if (override && exists(override)) return override;
  }
  for (const dir of opts.searchDirs || []) {
    for (const name of hermesBinaryCandidates(opts.platform)) {
      const candidate = joinPath(dir, name, opts.platform);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function joinPath(dir: string, name: string, platform: NodeJS.Platform): string {
  const sep = platform === "win32" ? "\\" : "/";
  const base = dir.replace(/[/\\]+$/, "");
  return `${base}${sep}${name}`;
}

export function hermesBinEnvKey(manifest: AppManifest): string {
  return envKey(manifest, "HERMES_BIN");
}

export function buildNextHermesEnv(opts: {
  apiUrl: string;
  apiKey: string;
  webuiUrl?: string | null;
  webuiPassword?: string | null;
  model?: string;
}): Record<string, string> {
  const out: Record<string, string> = {
    HERMES_API_URL: opts.apiUrl.replace(/\/$/, ""),
    HERMES_GATEWAY_URL: opts.apiUrl.replace(/\/$/, ""),
    HERMES_API_SERVER_KEY: opts.apiKey,
    HERMES_MODEL: opts.model || "hermes-agent",
  };
  if (opts.webuiUrl) {
    out.HERMES_WEBUI_URL = opts.webuiUrl.replace(/\/$/, "");
    out.HERMES_KANBAN_URL = opts.webuiUrl.replace(/\/$/, "");
  }
  if (opts.webuiPassword) {
    out.HERMES_WEBUI_PASSWORD = opts.webuiPassword;
  }
  return out;
}

export function buildHermesHomeEnvFile(opts: {
  apiKey: string;
  apiPort: number;
  apiHost?: string;
  openaiKey?: string | null;
  anthropicKey?: string | null;
  webuiPassword?: string | null;
  userEnv?: Record<string, string> | null;
  bridgeEnv?: Record<string, string> | null;
  productName?: string;
}): string {
  const product: Record<string, string> = {
    API_SERVER_ENABLED: "true",
    API_SERVER_KEY: opts.apiKey,
    API_SERVER_PORT: String(opts.apiPort),
    API_SERVER_HOST: opts.apiHost || "127.0.0.1",
  };
  if (opts.bridgeEnv) {
    for (const [k, v] of Object.entries(opts.bridgeEnv)) {
      if (v != null && String(v) !== "") product[k] = String(v);
    }
  }
  const merged = mergeEmbedUserEnv({
    service: "hermes",
    systemEnv: product,
    userOverlay: opts.userEnv,
  });
  const ordered: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (v != null && String(v) !== "") ordered[k] = String(v);
  }
  Object.assign(ordered, product);
  if (opts.openaiKey) ordered.OPENAI_API_KEY = opts.openaiKey;
  if (opts.anthropicKey) ordered.ANTHROPIC_API_KEY = opts.anthropicKey;
  if (opts.webuiPassword) {
    ordered.HERMES_WEBUI_PASSWORD = opts.webuiPassword;
  }
  const name = opts.productName || "Desktop";
  const lines = [
    `# Généré par ${name} — ne pas committer`,
    `# Clés OS + variables éditables (Configuration → Hermes)`,
  ];
  for (const [k, v] of Object.entries(ordered)) {
    lines.push(`${k}=${v}`);
  }
  return `${lines.join("\n")}\n`;
}

export function hermesPublicStatus(opts: {
  connectionMode: "local" | "remote";
  config: HermesEmbedConfig;
  binaryFound: boolean;
  running: boolean;
  apiUrl: string | null;
  lastError: string | null;
  version: string | null;
  remoteCrmOrigin?: string | null;
  tunnelRootDomain: string;
  /** nested | flat — défaut via env / nested. */
  tunnelHostMode?: "nested" | "flat";
  productName?: string;
}): {
  status: HermesRuntimeStatus;
  mode: HermesEmbedMode;
  apiUrl: string | null;
  webuiUrl: string | null;
  binaryFound: boolean;
  version: string | null;
  detail: string;
} {
  const config = sanitizeHermesEmbedConfig(opts.config);
  const product = opts.productName || "le desktop";
  if (opts.connectionMode === "remote") {
    const derivedWebui = opts.remoteCrmOrigin
      ? deriveTunnelServiceUrl(
          opts.remoteCrmOrigin,
          "hermes",
          opts.tunnelRootDomain,
          opts.tunnelHostMode,
        )
      : null;
    const webuiUrl =
      (config.remoteWebuiUrl || derivedWebui || "").trim() || null;
    const apiUrl = (config.remoteApiUrl || "").trim() || null;
    return {
      status: webuiUrl || apiUrl ? "remote" : "skipped-remote-client",
      mode: config.mode,
      apiUrl,
      webuiUrl,
      binaryFound: opts.binaryFound,
      version: null,
      detail: webuiUrl
        ? `Client distant — WebUI Hermes via tunnel (${webuiUrl}).`
        : "Client distant — Hermes tourne sur le serveur hôte (pas de spawn local).",
    };
  }
  if (config.mode === "remote") {
    return {
      status: "remote",
      mode: "remote",
      apiUrl: config.remoteApiUrl || null,
      webuiUrl: config.remoteWebuiUrl || null,
      binaryFound: opts.binaryFound,
      version: null,
      detail: "Mode avancé : Hermes distant (pas de process local).",
    };
  }
  if (config.mode === "off") {
    return {
      status: "stopped",
      mode: "off",
      apiUrl: null,
      webuiUrl: null,
      binaryFound: opts.binaryFound,
      version: null,
      detail: "Hermes désactivé dans la configuration.",
    };
  }
  if (!opts.binaryFound) {
    return {
      status: "missing",
      mode: "embedded",
      apiUrl: null,
      webuiUrl: null,
      binaryFound: false,
      version: null,
      detail: `CLI Hermes introuvable. Au prochain démarrage Héberger, ${product} tente un download-on-first-run automatique.`,
    };
  }
  if (opts.lastError && !opts.running) {
    return {
      status: "error",
      mode: "embedded",
      apiUrl: opts.apiUrl,
      webuiUrl: null,
      binaryFound: true,
      version: opts.version,
      detail: opts.lastError,
    };
  }
  if (opts.running) {
    return {
      status: "running",
      mode: "embedded",
      apiUrl: opts.apiUrl,
      webuiUrl: null,
      binaryFound: true,
      version: opts.version,
      detail: `Gateway local ${opts.apiUrl || ""}`.trim(),
    };
  }
  return {
    status: "stopped",
    mode: "embedded",
    apiUrl: opts.apiUrl,
    webuiUrl: null,
    binaryFound: true,
    version: opts.version,
    detail: "Hermes arrêté.",
  };
}
