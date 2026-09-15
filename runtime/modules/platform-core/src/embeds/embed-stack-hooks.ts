/**
 * Hooks partagés — stack d'outils embarqués (Hermes, n8n).
 * Port brand-agnostic de electron/embed-stack-hooks.ts (kit).
 */

export type EmbedToolMode = "embedded" | "remote" | "off";

export type EmbedHostGate = {
  connectionMode: "local" | "remote";
  toolMode: EmbedToolMode;
};

/** Spawn sidecar natif uniquement sur hôte Héberger + mode embedded. */
export function shouldSpawnHostOnlyEmbed(opts: EmbedHostGate): boolean {
  return opts.connectionMode === "local" && opts.toolMode === "embedded";
}

/** Normalise une URL http(s) vers son origin (sans path). */
export function normalizeEmbedHttpOrigin(raw: string): string {
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

/**
 * Site IDs Electron pour onglets outils (catalogue ≥ 900000).
 * 900095 / 900096 / 900098 libérés (Paperclip / Plane / Appsmith retirés).
 */
export const EMBED_TOOL_SITE_IDS = {
  hermesWebui: 900099,
  n8nUi: 900097,
} as const;

/** Panels plugins : plage 910000–919999. */
export const PLUGIN_SITE_ID_RANGE = {
  base: 910000,
  max: 919999,
} as const;

/** Noms IPC canoniques (convention `<outil>:<action>`). */
export const EMBED_IPC = {
  hermes: {
    status: "hermes:status",
    logs: "hermes:logs",
    getConfig: "hermes:get-config",
    setConfig: "hermes:set-config",
    ensureRuntime: "hermes:ensure-runtime",
  },
  n8n: {
    status: "n8n:status",
    logs: "n8n:logs",
    getConfig: "n8n:get-config",
    setConfig: "n8n:set-config",
    ensureRuntime: "n8n:ensure-runtime",
    prepareSession: "n8n:prepare-session",
  },
  embedEnv: {
    get: "embed-env:get",
    set: "embed-env:set",
  },
  tunnel: {
    status: "tunnel:status",
    checkSlug: "tunnel:check-slug",
    reserve: "tunnel:reserve",
    forget: "tunnel:forget",
  },
} as const;
