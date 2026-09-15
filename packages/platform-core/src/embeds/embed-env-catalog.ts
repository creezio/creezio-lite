/**
 * Catalogue env embeds (n8n / Hermes) — port brand-agnostic desktop 0.10.26.
 * Les libellés UI restent génériques ; le productName est injecté à l'affichage.
 */

export type EmbedEnvService = "n8n" | "hermes";

export type EmbedEnvVarDef = {
  key: string;
  label: string;
  hint?: string;
  locked: boolean;
  defaultValue?: string;
  kind?: "string" | "boolean" | "number";
};

export const OS_SANDBOX_LOCKED_KEYS = [
  "APPDATA",
  "LOCALAPPDATA",
  "PIP_CACHE_DIR",
  "PYTHONUSERBASE",
  "UV_CACHE_DIR",
  "UV_PYTHON_INSTALL_DIR",
  "UV_TOOL_DIR",
  "UV_TOOL_BIN_DIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "NPM_CONFIG_USERCONFIG",
  "NPM_CONFIG_GLOBALCONFIG",
  "PATH",
] as const;

export const N8N_LOCKED_KEYS = [
  "N8N_USER_FOLDER",
  "N8N_HOST",
  "N8N_PORT",
  "N8N_PROTOCOL",
  "N8N_LISTEN_ADDRESS",
  "N8N_EDITOR_BASE_URL",
  "WEBHOOK_URL",
  "N8N_ENCRYPTION_KEY",
  "N8N_SECURE_COOKIE",
  "N8N_PROXY_HOPS",
  "N8N_DISABLED_MODULES",
  "N8N_MCP_MANAGED_BY_ENV",
  "N8N_MCP_ACCESS_ENABLED",
  "N8N_VERIFIED_PACKAGES_ENABLED",
  "N8N_BASIC_AUTH_ACTIVE",
  "N8N_API_KEY",
  "N8N_BASE_URL",
  "N8N_API_URL",
  "N8N_BASIC_AUTH_USER",
  "N8N_BASIC_AUTH_PASSWORD",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "TEMP",
  "TMP",
  "TMPDIR",
  "npm_config_cache",
  "NPM_CONFIG_CACHE",
  "HERMES_REAL_HOME",
] as const;

/** Clés CRM brandées (`{PREFIX}_API_*`) ajoutées dynamiquement via lockedBrandKeys. */
export const HERMES_LOCKED_KEYS = [
  "HERMES_HOME",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "TEMP",
  "TMP",
  "TMPDIR",
  "API_SERVER_ENABLED",
  "API_SERVER_KEY",
  "API_SERVER_PORT",
  "API_SERVER_HOST",
  "TERMINAL_CWD",
  "HERMES_REAL_HOME",
  "HERMES_WEBUI_HOST",
  "HERMES_WEBUI_PORT",
  "HERMES_WEBUI_GATEWAY_BASE_URL",
  "HERMES_WEBUI_GATEWAY_API_KEY",
  "HERMES_WEBUI_STATE_DIR",
  "HERMES_WEBUI_AGENT_DIR",
  "HERMES_WEBUI_DISABLE_SELF_UPDATE",
  "HERMES_WEBUI_PASSWORD",
  "N8N_BASE_URL",
  "N8N_API_URL",
  "N8N_API_KEY",
  "CRM_API_URL",
  "CRM_API_KEY",
  "PLUGINS_API_URL",
  "PLUGINS_API_TOKEN",
  "PLUGINS_DIR",
] as const;

export const N8N_ENV_CATALOG: EmbedEnvVarDef[] = [
  {
    key: "WEBHOOK_URL",
    label: "URL publique webhooks",
    hint: "Imposée par le tunnel.",
    locked: true,
  },
  {
    key: "N8N_EDITOR_BASE_URL",
    label: "URL éditeur / base",
    hint: "Alignée sur le tunnel.",
    locked: true,
  },
  {
    key: "N8N_LISTEN_ADDRESS",
    label: "Écoute",
    hint: "Toujours 127.0.0.1.",
    locked: true,
    defaultValue: "127.0.0.1",
  },
  {
    key: "N8N_PORT",
    label: "Port local",
    locked: true,
    defaultValue: "15678",
  },
  {
    key: "N8N_USER_FOLDER",
    label: "Dossier données",
    locked: true,
  },
  {
    key: "N8N_ENCRYPTION_KEY",
    label: "Clé chiffrement",
    hint: "Gérée par le desktop (secrète).",
    locked: true,
  },
  {
    key: "N8N_MCP_ACCESS_ENABLED",
    label: "MCP instance n8n",
    hint: "Activé pour Hermes / clients MCP.",
    locked: true,
    defaultValue: "true",
  },
  {
    key: "N8N_MCP_MANAGED_BY_ENV",
    label: "MCP géré par l'OS desktop",
    locked: true,
    defaultValue: "true",
  },
  {
    key: "GENERIC_TIMEZONE",
    label: "Fuseau horaire",
    hint: "Ex. Europe/Paris",
    locked: false,
    defaultValue: "Europe/Paris",
  },
  {
    key: "TZ",
    label: "TZ (process)",
    locked: false,
    defaultValue: "Europe/Paris",
  },
  {
    key: "N8N_LOG_LEVEL",
    label: "Niveau de logs",
    hint: "info | warn | error | debug",
    locked: false,
    defaultValue: "info",
  },
  {
    key: "EXECUTIONS_DATA_PRUNE",
    label: "Purge des exécutions",
    locked: false,
    defaultValue: "true",
    kind: "boolean",
  },
  {
    key: "EXECUTIONS_DATA_PRUNE_MAX_AGE",
    label: "Rétention exécutions (heures)",
    locked: false,
    defaultValue: "168",
    kind: "number",
  },
  {
    key: "DB_SQLITE_POOL_SIZE",
    label: "SQLite pool (WAL)",
    hint: ">0 active le mode WAL (recommandé).",
    locked: false,
    defaultValue: "2",
    kind: "number",
  },
  {
    key: "DB_SQLITE_VACUUM_ON_STARTUP",
    label: "VACUUM au démarrage",
    hint: "Laisser false — ralentit fortement le boot.",
    locked: false,
    defaultValue: "false",
    kind: "boolean",
  },
  {
    key: "N8N_PAYLOAD_SIZE_MAX",
    label: "Taille max payload (Mo)",
    locked: false,
    defaultValue: "16",
    kind: "number",
  },
  {
    key: "N8N_METRICS",
    label: "Métriques Prometheus",
    locked: false,
    defaultValue: "false",
    kind: "boolean",
  },
  {
    key: "N8N_DIAGNOSTICS_ENABLED",
    label: "Diagnostics n8n",
    locked: false,
    defaultValue: "false",
    kind: "boolean",
  },
  {
    key: "N8N_TEMPLATES_ENABLED",
    label: "Templates n8n",
    locked: false,
    defaultValue: "false",
    kind: "boolean",
  },
  {
    key: "N8N_PERSONALIZATION_ENABLED",
    label: "Personnalisation UI",
    locked: false,
    defaultValue: "false",
    kind: "boolean",
  },
  {
    key: "N8N_VERSION_NOTIFICATIONS_ENABLED",
    label: "Notifs de version",
    locked: false,
    defaultValue: "false",
    kind: "boolean",
  },
];

export const HERMES_ENV_CATALOG: EmbedEnvVarDef[] = [
  { key: "HERMES_HOME", label: "HERMES_HOME", locked: true },
  {
    key: "API_SERVER_HOST",
    label: "API host",
    locked: true,
    defaultValue: "127.0.0.1",
  },
  { key: "API_SERVER_PORT", label: "API port", locked: true },
  {
    key: "API_SERVER_KEY",
    label: "API key (Bearer)",
    hint: "Générée par le desktop.",
    locked: true,
  },
  { key: "TERMINAL_CWD", label: "Workspace agent", locked: true },
  {
    key: "N8N_BASE_URL",
    label: "URL n8n (bridge)",
    hint: "Injectée pour le skill n8n.",
    locked: true,
  },
  {
    key: "N8N_API_KEY",
    label: "API key n8n",
    hint: "Clé silencieuse Hermes ↔ n8n.",
    locked: true,
  },
  {
    key: "API_SERVER_MODEL_NAME",
    label: "Nom modèle API",
    locked: false,
    defaultValue: "hermes-agent",
  },
  {
    key: "GATEWAY_ALLOW_ALL_USERS",
    label: "Autoriser tous les users gateway",
    hint: "Desktop local : true recommandé.",
    locked: false,
    defaultValue: "true",
    kind: "boolean",
  },
  {
    key: "HERMES_ACCEPT_HOOKS",
    label: "Accepter les hooks",
    locked: false,
    defaultValue: "1",
  },
];

export function catalogFor(service: EmbedEnvService): EmbedEnvVarDef[] {
  switch (service) {
    case "n8n":
      return N8N_ENV_CATALOG;
    case "hermes":
      return HERMES_ENV_CATALOG;
    default:
      return [];
  }
}

export function lockedKeySet(
  service: EmbedEnvService,
  extraBrandKeys: string[] = [],
): Set<string> {
  const list = service === "n8n" ? N8N_LOCKED_KEYS : HERMES_LOCKED_KEYS;
  return new Set(
    [...list, ...OS_SANDBOX_LOCKED_KEYS, ...extraBrandKeys].map((k) =>
      k.toUpperCase(),
    ),
  );
}

export function sanitizeUserEnvOverlay(
  service: EmbedEnvService,
  raw: Record<string, string> | null | undefined,
  extraBrandKeys: string[] = [],
): Record<string, string> {
  const locked = lockedKeySet(service, extraBrandKeys);
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k0, v0] of Object.entries(raw)) {
    const key = String(k0 || "").trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (locked.has(key.toUpperCase())) continue;
    const val = String(v0 ?? "").trim();
    if (val === "") continue;
    if (/[\r\n\0]/.test(val)) continue;
    out[key] = val;
  }
  return out;
}

export function mergeEmbedUserEnv(opts: {
  service: EmbedEnvService;
  systemEnv: Record<string, string | undefined>;
  userOverlay?: Record<string, string> | null;
  extraBrandKeys?: string[];
}): Record<string, string | undefined> {
  const catalog = catalogFor(opts.service);
  const locked = lockedKeySet(opts.service, opts.extraBrandKeys);
  const defaults: Record<string, string> = {};
  for (const d of catalog) {
    if (!d.locked && d.defaultValue != null && d.defaultValue !== "") {
      defaults[d.key] = d.defaultValue;
    }
  }
  const user = sanitizeUserEnvOverlay(
    opts.service,
    opts.userOverlay,
    opts.extraBrandKeys,
  );
  const out: Record<string, string | undefined> = {
    ...defaults,
    ...user,
    ...opts.systemEnv,
  };
  for (const [k, v] of Object.entries(opts.systemEnv)) {
    if (v == null) continue;
    if (locked.has(k.toUpperCase())) out[k] = v;
  }
  return out;
}

export function isEmbedEnvService(s: string): s is EmbedEnvService {
  return s === "n8n" || s === "hermes";
}

export type EmbedEnvPanelVar = {
  key: string;
  label: string;
  hint?: string;
  locked: boolean;
  value: string;
  kind?: "string" | "boolean" | "number";
  custom?: boolean;
};

export type EmbedEnvPanel = {
  service: EmbedEnvService;
  vars: EmbedEnvPanelVar[];
};

export function buildEmbedEnvPanel(opts: {
  service: EmbedEnvService;
  userOverlay?: Record<string, string> | null;
  lockedValues?: Record<string, string | null | undefined>;
  extraBrandKeys?: string[];
}): EmbedEnvPanel {
  const catalog = catalogFor(opts.service);
  const user = sanitizeUserEnvOverlay(
    opts.service,
    opts.userOverlay,
    opts.extraBrandKeys,
  );
  const vars: EmbedEnvPanelVar[] = [];
  const seen = new Set<string>();
  for (const d of catalog) {
    seen.add(d.key.toUpperCase());
    const lockedVal = opts.lockedValues?.[d.key];
    const value = d.locked
      ? String(lockedVal ?? d.defaultValue ?? "")
      : user[d.key] != null
        ? user[d.key]!
        : (d.defaultValue ?? "");
    vars.push({
      key: d.key,
      label: d.label,
      hint: d.hint,
      locked: d.locked,
      value,
      kind: d.kind,
      custom: false,
    });
  }
  for (const [k, v] of Object.entries(user)) {
    if (seen.has(k.toUpperCase())) continue;
    vars.push({
      key: k,
      label: k,
      locked: false,
      value: v,
      kind: "string",
      custom: true,
    });
  }
  return { service: opts.service, vars };
}
