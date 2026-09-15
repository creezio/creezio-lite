/**
 * Sidecar Hermes Agent + WebUI — factory brand-agnostic.
 * SoT extrait du hermes-launcher gold de la première marque (R3.3) —
 * chemins gold intacts, identité dérivée du manifest (envPrefix/secretFilePrefix).
 */

import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  buildHermesHomeEnvFile,
  buildNextHermesEnv,
  HERMES_DESKTOP_API_PORT,
  HERMES_DESKTOP_WEBUI_PORT,
  hermesPublicStatus,
  mergeEmbedUserEnv,
  resolveHermesBinary,
  sanitizeHermesEmbedConfig,
  shouldSpawnEmbeddedHermes,
  type HermesEmbedConfig,
  type HermesRuntimeStatus,
  type HermesWebuiStatus,
} from "@creezio/platform-core";
import type { HostRuntimeContext } from "../context.js";
import { hostLog, hostProductName } from "../context.js";
import type { LocalConfigStore } from "../local-config.js";
import {
  applyOsSandboxEnv,
  hermesSandboxPaths,
  upsertHermesMcpConfig,
  upsertHermesSandboxConfig,
} from "../sandbox/embed-sandbox.js";
import { findFreePort } from "../server-env.js";
import { resolveDesktopNodeBinary } from "../node-runtime.js";
import {
  ensureHermesRuntime,
  ensureHermesWebuiTree,
  getBootstrapError,
  getBootstrapPhase,
  hermesRuntimeCacheDir,
  hermesVendorDir,
  hermesWebuiInstallDir,
  resolveHermesAgentDir,
  resolveHermesPython,
  type BootstrapPhase,
  hermesFhsFallbackDirs,
} from "./runtime-bootstrap.js";


export type RunningHermes = {
  apiUrl: string;
  apiKey: string;
  webuiUrl: string | null;
  webuiPassword: string | null;
  homeDir: string;
  child: ChildProcess;
  webuiChild: ChildProcess | null;
  stop: () => void;
};

export type StartHermesOptions = {
  connectionMode: "local" | "remote";
  hermesConfig?: HermesEmbedConfig;
  onLog?: (line: string) => void;
  autoBootstrap?: boolean;
  crmPort?: number | null;
};

export type HermesStatusPayload = {
  status: HermesRuntimeStatus;
  mode: ReturnType<typeof sanitizeHermesEmbedConfig>["mode"];
  apiUrl: string | null;
  webuiUrl: string | null;
  webuiStatus: HermesWebuiStatus;
  binaryFound: boolean;
  binaryPath: string | null;
  version: string | null;
  detail: string;
  homeDir: string | null;
  bootstrapPhase: BootstrapPhase;
  bootstrapError: string | null;
  installing: boolean;
  logs: string[];
};

export type HermesHost = {
  startHermes: (opts: StartHermesOptions) => Promise<RunningHermes | null>;
  stopHermes: () => void;
  stopHermesAndWait: (timeoutMs?: number) => Promise<void>;
  getRunningHermes: () => RunningHermes | null;
  getHermesStatusPayload: (
    connectionMode: "local" | "remote",
    opts?: { remoteCrmOrigin?: string | null },
  ) => HermesStatusPayload;
  getHermesNextEnv: (connectionMode: "local" | "remote") => Record<string, string>;
  getHermesLogs: () => string[];
  ensureHermesRuntimeFromUi: (opts?: {
    onLog?: (line: string) => void;
  }) => Promise<{
    ok: boolean;
    detail: string;
    binaryPath: string | null;
    webuiDir: string | null;
    phase: BootstrapPhase;
  }>;
  findHermesBinary: () => string | null;
  getHermesLastStartPath: () => "bootstrap" | "reuse" | null;
  reapplyHermesLlmKeys: (opts: {
    connectionMode: "local" | "remote";
    crmPort?: number | null;
    onLog?: (line: string) => void;
  }) => Promise<{ restarted: boolean; detail: string }>;
  reapplyHermesBridge: (opts: {
    connectionMode: "local" | "remote";
    crmPort?: number | null;
    forceRestart?: boolean;
    forceReason?: string;
    onLog?: (line: string) => void;
  }) => Promise<{ restarted: boolean; detail: string }>;
  __resetForTests: () => void;
};

/**
 * Password WebUI en mode serveur : `HERMES_WEBUI_PASSWORD` explicite, sinon
 * superadmin flotte (`CREEZIO_SUPERADMIN_PASSWORD`). null = desktop loopback
 * (auth off, contrat gold sans prompt).
 */
export function serverWebuiPassword(): string | null {
  const explicit = (process.env.HERMES_WEBUI_PASSWORD || "").trim();
  if (explicit) return explicit;
  const superadmin = (process.env.CREEZIO_SUPERADMIN_PASSWORD || "").trim();
  return superadmin.length >= 12 ? superadmin : null;
}

/** Clear legacy generated WebUI password (gold: no login prompt on loopback). */
export function clearGeneratedWebuiPassword(
  home: string,
  stateDir: string,
  secretPrefix?: string,
): void {
  // Fichiers password legacy : nom générique + nom dérivé du secretFilePrefix
  // marque (couvre les fichiers `.{marque}-webui-password` historiques).
  const files = [path.join(home, ".desktop-hermes-webui-password")];
  if (secretPrefix) {
    files.push(path.join(home, `.${secretPrefix}-webui-password`));
  }
  for (const f of files) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  const envPath = path.join(home, ".env");
  try {
    if (fs.existsSync(envPath)) {
      const body = fs.readFileSync(envPath, "utf8");
      const next = body
        .split(/\r?\n/)
        .filter((line) => !/^\s*HERMES_WEBUI_PASSWORD\s*=/.test(line))
        .join("\n");
      if (next !== body) fs.writeFileSync(envPath, next, { mode: 0o600 });
    }
  } catch {
    /* ignore */
  }
  const settingsPath = path.join(stateDir, "settings.json");
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<
        string,
        unknown
      >;
      if (raw && typeof raw === "object" && "password_hash" in raw) {
        delete raw.password_hash;
        fs.writeFileSync(settingsPath, JSON.stringify(raw, null, 2) + "\n", {
          mode: 0o600,
        });
      }
    }
  } catch {
    /* ignore */
  }
}

export function createHermesHost(opts: {
  ctx: HostRuntimeContext;
  store: LocalConfigStore;
}): HermesHost {
  const { ctx, store } = opts;
  const homeDir = () => path.join(ctx.userDataDir, "hermes-home");
  const product = () => hostProductName(ctx);

  // --- begin inlined TF gold (adapted) ---
type HermesState = {
  running: RunningHermes | null;
  starting: boolean;
  lastError: string | null;
  version: string | null;
  logs: string[];
  binaryPath: string | null;
  webuiStatus: HermesWebuiStatus;
  webuiError: string | null;
  installing: boolean;
  /** Dernier chemin de démarrage : install réelle vs runtime réutilisé. */
  lastStartPath: "bootstrap" | "reuse" | null;
};

const state: HermesState = {
  running: null,
  starting: false,
  lastError: null,
  version: null,
  logs: [],
  binaryPath: null,
  webuiStatus: "stopped",
  webuiError: null,
  installing: false,
  lastStartPath: null,
};

/** "bootstrap" = runtime installé pendant ce boot ; "reuse" = déjà présent. */
function getHermesLastStartPath(): "bootstrap" | "reuse" | null {
  return state.lastStartPath;
}

const LOG_MAX = 200;
let startInFlight: Promise<RunningHermes | null> | null = null;

function pushLog(line: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  state.logs.push("[" + ts + "] " + line);
  if (state.logs.length > LOG_MAX) state.logs.shift();
  hostLog(ctx, "hermes", line);
}

/**
 * Dossiers d'outils LÉGITIMES pour le PATH confiné des process Hermes :
 * venv Hermes, Node embarqué marque, MinGit embarqué. Rien du PC hôte.
 */
function hermesToolPathDirs(primaryDir: string): string[] {
  const dirs: string[] = [primaryDir];
  try {
    const node = resolveDesktopNodeBinary(ctx);
    if (node && path.isAbsolute(node)) dirs.push(path.dirname(node));
  } catch {
    /* app pas prête */
  }
  try {
    const git = ctx.getGitBinary?.() || null;
    if (git) dirs.push(path.dirname(git));
  } catch {
    /* absent */
  }
  return dirs;
}

function findHermesBinary(): string | null {
  // Même racine que le bootstrap (space-safe si userData a des espaces).
  const runtime = hermesRuntimeCacheDir(ctx);
  const profile = path.join(runtime, "os-profile");
  const localApp = path.join(runtime, "bin");
  const vendorBin = path.join(hermesVendorDir(ctx), "bin");
  // Sandbox OS marque d’abord — pas le profil Windows Admin.
  const sandLocalBin = path.join(profile, "AppData", "Local", "hermes", "bin");
  const sandHermesBin = path.join(profile, ".hermes", "bin");
  const sandAgentScripts =
    process.platform === "win32"
      ? path.join(
          profile,
          "AppData",
          "Local",
          "hermes",
          "hermes-agent",
          "venv",
          "Scripts",
        )
      : path.join(profile, ".hermes", "hermes-agent", "venv", "bin");
  // Legacy (userData à espaces) — migration / installs antérieures.
  const legacyRuntime = path.join(ctx.userDataDir, "hermes-runtime");
  const legacyProfile = path.join(legacyRuntime, "os-profile");
  const resolved = resolveHermesBinary({
    platform: process.platform,
    env: process.env,
    searchDirs: [
      localApp,
      vendorBin,
      sandLocalBin,
      sandHermesBin,
      sandAgentScripts,
      path.join(legacyRuntime, "bin"),
      path.join(legacyProfile, ".hermes", "bin"),
      path.join(legacyProfile, ".hermes", "hermes-agent", "venv", "bin"),
      // Containers root Linux : installs FHS antérieures au verrou
      // HERMES_INSTALL_DIR (/usr/local) — jamais consulté sur desktop.
      ...hermesFhsFallbackDirs(
        process.platform,
        typeof process.getuid === "function" ? process.getuid() : null,
      ),
    ].filter(Boolean),
    // OS marque : jamais de `which`/`where` — sandbox uniquement.
    // Overrides env autorisés seulement hors build packagé (dev/tests).
    allowEnvOverride: !ctx.isPackaged,
    envPrefix: ctx.manifest.envPrefix,
    existsSync: (p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    },
  });
  state.binaryPath = resolved;
  return resolved;
}

function ensureApiKey(home: string): string {
  fs.mkdirSync(home, { recursive: true });
  const prefix = ctx.secretFilePrefix || ctx.manifest.brandId || "desktop";
  /** Canon marque : `.{secretFilePrefix}-api-server-key` (dérivé du manifest). */
  const keyFile = path.join(home, `.${prefix}-api-server-key`);
  try {
    const existing = fs.readFileSync(keyFile, "utf8").trim();
    if (existing.length >= 16) return existing;
  } catch {
    /* absent */
  }
  const key = crypto.randomBytes(24).toString("base64url");
  fs.writeFileSync(keyFile, key, { mode: 0o600 });
  return key;
}
async function writeHermesHome(opts: {
  home: string;
  apiKey: string;
  apiPort: number;
  crmPort?: number | null;
}): Promise<{ profileHome: string; workspace: string }> {
  const paths = hermesSandboxPaths(opts.home);
  fs.mkdirSync(paths.home, { recursive: true });
  fs.mkdirSync(paths.profileHome, { recursive: true });
  fs.mkdirSync(paths.workspace, { recursive: true });
  // README pour l’utilisateur / support — le workspace OS est ICI, pas ~/workspace.
  const readme = path.join(paths.workspace, "README-WORKSPACE.txt");
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      [
        product() + " — workspace Hermes",
        "",
        "Workspace pour le Work général (brouillons, scripts, analyses).",
        "Il vit dans le profil desktop (userData), pas dans C:\\Users\\…\\workspace.",
        "",
        "Plugins : NE PAS installer ici.",
        "Utiliser PLUGINS_API_URL (control plane) → userData/plugins/.",
        "",
      ].join("\n"),
      "utf8",
    );
  }

  const llm = store.getLlmKeys();
  const bridgeEnv =
    ctx.getHermesBridgeEnv?.(
      opts.crmPort != null ? { crmPort: opts.crmPort } : undefined,
    ) || {};
  const envBody = buildHermesHomeEnvFile({
    apiKey: opts.apiKey,
    apiPort: opts.apiPort,
    openaiKey: llm.openai,
    anthropicKey: llm.anthropic,
    userEnv: store.getEmbedUserEnv("hermes"),
    bridgeEnv,
    // Pas de password WebUI : loopback + auth optionnelle (voir PLAN-HERMES).
  });
  fs.writeFileSync(path.join(opts.home, ".env"), envBody, { mode: 0o600 });

  if (ctx.seedHermesSkills) {
    try {
      await Promise.resolve(ctx.seedHermesSkills(opts.home));
    } catch (e) {
      pushLog("skills seed: " + (e instanceof Error ? e.message : e));
    }
  }

  const cfgPath = path.join(opts.home, "config.yaml");
  let existing = "";
  try {
    existing = fs.readFileSync(cfgPath, "utf8");
  } catch {
    existing = "";
  }
  // H1 — bloc mcp_servers (façade MCP CRM, Bearer clé Hermes) upserté après
  // le bloc sandbox, idempotent, sans toucher la config utilisateur.
  const mcpConfig =
    ctx.getHermesMcpServerConfig?.(
      opts.crmPort != null ? { crmPort: opts.crmPort } : undefined,
    ) || null;
  fs.writeFileSync(
    cfgPath,
    upsertHermesMcpConfig(
      upsertHermesSandboxConfig(existing, paths.workspace),
      mcpConfig,
    ),
    "utf8",
  );
  if (mcpConfig) {
    pushLog(`config: mcp_servers.${mcpConfig.serverName} → ${mcpConfig.url}`);
  }
  return { profileHome: paths.profileHome, workspace: paths.workspace };
}

function waitForHttpOk(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<{ ok: boolean; body: string; status: number | null }> {
  const deadline = Date.now() + (opts.timeoutMs ?? 90000);
  return new Promise((resolve) => {
    const tryOnce = () => {
      const req = http.get(
        url,
        { timeout: 2000, headers: opts.headers || {} },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
              resolve({ ok: res.statusCode < 400, body, status: res.statusCode });
              return;
            }
            next();
          });
        },
      );
      req.on("error", () => next());
      req.on("timeout", () => {
        req.destroy();
        next();
      });
    };
    const next = () => {
      if (Date.now() > deadline) {
        resolve({ ok: false, body: "", status: null });
      } else {
        setTimeout(tryOnce, 500);
      }
    };
    tryOnce();
  });
}

function waitForHermesHealth(
  apiUrl: string,
  apiKey: string,
  timeoutMs = 90000,
): Promise<{ ok: boolean; version: string | null; detail: string }> {
  return waitForHttpOk(`${apiUrl}/health`, {
    timeoutMs,
    headers: { Authorization: `Bearer ${apiKey}` },
  }).then((r) => {
    if (!r.ok) return { ok: false, version: null, detail: "health timeout" };
    let version: string | null = null;
    try {
      const j = JSON.parse(r.body) as { version?: string };
      version = j.version || null;
    } catch {
      /* ignore */
    }
    return { ok: true, version, detail: "ok" };
  });
}

async function spawnWebui(opts: {
  apiUrl: string;
  apiKey: string;
  home: string;
  log: (line: string) => void;
}): Promise<{ child: ChildProcess; webuiUrl: string } | null> {
  const agentDir = resolveHermesAgentDir(ctx);
  const python = resolveHermesPython(agentDir);
  const webuiDir = hermesWebuiInstallDir(ctx);
  const serverPy = path.join(webuiDir, "server.py");
  if (!python || !fs.existsSync(serverPy)) {
    state.webuiStatus = "missing";
    state.webuiError = "WebUI ou Python Hermes absent";
    opts.log(state.webuiError);
    return null;
  }

  const webuiPort = await findFreePort(HERMES_DESKTOP_WEBUI_PORT);
  const webuiUrl = `http://127.0.0.1:${webuiPort}`;
  const stateDir = path.join(ctx.userDataDir, "hermes-webui-state");
  fs.mkdirSync(stateDir, { recursive: true });
  // Mode serveur/flotte : le WebUI est exposé publiquement via le tunnel
  // (hermes.{slug}.{domaine}) → protection par le mécanisme natif Hermes
  // (HERMES_WEBUI_PASSWORD = superadmin flotte). Desktop loopback : auth off
  // (gold — pas de prompt).
  const webuiPassword = serverWebuiPassword();
  if (!webuiPassword) {
    clearGeneratedWebuiPassword(
      opts.home,
      stateDir,
      ctx.secretFilePrefix || ctx.manifest.brandId,
    ); // clear password WebUI généré (gold : loopback sans prompt)
  }

  opts.log(
    `spawn WebUI ${serverPy} → ${webuiUrl} (${webuiPassword ? "auth superadmin flotte ACTIVE" : "auth loopback désactivée"})`,
  );
  const sand = hermesSandboxPaths(opts.home);
  // Chat WebUI = runtime in-process (pas la gateway) → BYOK obligatoire ici aussi.
  const llm = store.getLlmKeys();
  const childEnv: NodeJS.ProcessEnv = applyOsSandboxEnv({
    env: {
      ...process.env,
      HERMES_HOME: opts.home,
      HERMES_WEBUI_HOST: "127.0.0.1",
      HERMES_WEBUI_PORT: String(webuiPort),
      HERMES_WEBUI_GATEWAY_BASE_URL: opts.apiUrl,
      HERMES_WEBUI_GATEWAY_API_KEY: opts.apiKey,
      HERMES_WEBUI_STATE_DIR: stateDir,
      HERMES_WEBUI_AGENT_DIR: agentDir || "",
      HERMES_WEBUI_DISABLE_SELF_UPDATE: "1",
      PYTHONUNBUFFERED: "1",
      TERMINAL_CWD: sand.workspace,
    },
    profileHome: sand.profileHome,
    userData: ctx.userDataDir,
    // PATH confiné : venv Python Hermes + System32 — pas le PATH utilisateur.
    toolDirs: hermesToolPathDirs(path.dirname(python)),
  });
  // Ne jamais propager un password hérité du process parent / anciens builds —
  // sauf protection serveur explicite (superadmin flotte).
  delete childEnv.HERMES_WEBUI_PASSWORD;
  if (webuiPassword) childEnv.HERMES_WEBUI_PASSWORD = webuiPassword;
  delete childEnv.OPENAI_API_KEY;
  delete childEnv.ANTHROPIC_API_KEY;
  if (llm.openai) childEnv.OPENAI_API_KEY = llm.openai;
  if (llm.anthropic) childEnv.ANTHROPIC_API_KEY = llm.anthropic;
  const child = spawn(python, [serverPy], {
    cwd: webuiDir,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (d: Buffer) =>
    d
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((l) => opts.log(`webui: ${l}`)),
  );
  child.stderr?.on("data", (d: Buffer) =>
    d
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((l) => opts.log(`webui stderr: ${l}`)),
  );
  child.on("exit", (code, signal) => {
    opts.log(`webui exit code=${code} signal=${signal}`);
    if (state.running?.webuiChild === child) {
      state.running.webuiChild = null;
      state.running.webuiUrl = null;
      state.webuiStatus = "stopped";
    }
  });

  // Login endpoint répond 401/400 sans cookie — prouve que le serveur écoute.
  const probe = await waitForHttpOk(`${webuiUrl}/api/auth/login`, {
    timeoutMs: 60000,
  });
  // POST would be needed for real login; GET often 405 — any TCP response = up
  const up = await waitForHttpOk(`${webuiUrl}/`, { timeoutMs: 30000 });
  if (!up.ok && !probe.status) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    state.webuiStatus = "error";
    state.webuiError = "WebUI health timeout";
    opts.log(state.webuiError);
    return null;
  }

  state.webuiStatus = "running";
  state.webuiError = null;
  opts.log(`WebUI ready ${webuiUrl}`);
  return { child, webuiUrl };
}

/**
 * Démarre Hermes si applicable. Retourne null sans throw si skip / missing / erreur.
 */
async function startHermesImpl(
  opts: StartHermesOptions,
): Promise<RunningHermes | null> {
  const hermesConfig = sanitizeHermesEmbedConfig(
    opts.hermesConfig ?? store.getHermesEmbedConfig(),
  );

  if (!shouldSpawnEmbeddedHermes({
    connectionMode: opts.connectionMode,
    hermes: hermesConfig,
  })) {
    pushLog(
      opts.connectionMode === "remote"
        ? "skip spawn (client distant)"
        : `skip spawn (mode=${hermesConfig.mode})`,
    );
    state.webuiStatus = "skipped";
    return null;
  }

  if (hermesConfig.mode === "remote") {
    pushLog(`mode remote → ${hermesConfig.remoteApiUrl || "(url manquante)"}`);
    state.webuiStatus = "skipped";
    return null;
  }

  const log = (line: string) => {
    pushLog(line);
    opts.onLog?.(line);
  };

  let bin = findHermesBinary();
  // Honnêteté splash + télémétrie : distinguer installation réelle vs runtime
  // déjà présent réutilisé (ex. userData non purgé par une désinstallation).
  state.lastStartPath = bin ? "reuse" : "bootstrap";
  if (!bin && opts.autoBootstrap !== false) {
    state.installing = true;
    log("runtime manquant — bootstrap automatique…");
    try {
      const boot = await ensureHermesRuntime(ctx, { onLog: log });
      log(boot.detail);
      bin = boot.binary || findHermesBinary();
      if (!boot.ok && !bin) {
        state.lastError = boot.detail;
        state.installing = false;
        return null;
      }
    } finally {
      state.installing = false;
    }
  } else if (bin && opts.autoBootstrap !== false) {
    // CLI déjà là : assurer quand même WebUI (léger si pin présent)
    const agentDir = resolveHermesAgentDir(ctx);
    const python = resolveHermesPython(agentDir);
    if (python) {
      state.installing = true;
      try {
        const w = await ensureHermesWebuiTree(ctx, { onLog: log });
        if (!w.ok) log(`WebUI bootstrap: ${w.detail}`);
      } finally {
        state.installing = false;
      }
    }
  }

  if (!bin) {
    state.lastError = "CLI Hermes introuvable (sandbox userData / bootstrap)";
    log(state.lastError);
    state.webuiStatus = "missing";
    return null;
  }

  try {
    const home = homeDir();
    const apiPort = await findFreePort(HERMES_DESKTOP_API_PORT);
    // Clé API gateway générée/silencieuse (Bearer Work) — jamais de prompt UI.
    const apiKey = ensureApiKey(home);
    clearGeneratedWebuiPassword(
      home,
      path.join(ctx.userDataDir, "hermes-webui-state"),
      ctx.secretFilePrefix || ctx.manifest.brandId,
    );
    const sand = await writeHermesHome({
      home,
      apiKey,
      apiPort,
      crmPort: opts.crmPort,
    });

    const apiUrl = `http://127.0.0.1:${apiPort}`;
    log(
      `spawn ${bin} gateway run (home=${home}, workspace=${sand.workspace}, api=${apiUrl})`,
    );

    const bridgeEnv =  (ctx.getHermesBridgeEnv?.(opts.crmPort != null ? { crmPort: opts.crmPort } : undefined,
    ) || {}) ;
    // BYOK marque → process Hermes (en plus du .env écrit par writeHermesHome).
    const llm = store.getLlmKeys();
    const productEnv: NodeJS.ProcessEnv = {
      HERMES_HOME: home,
      API_SERVER_ENABLED: "true",
      API_SERVER_KEY: apiKey,
      API_SERVER_PORT: String(apiPort),
      API_SERVER_HOST: "127.0.0.1",
      TERMINAL_CWD: sand.workspace,
      PYTHONUNBUFFERED: "1",
      ...bridgeEnv,
    };
    if (llm.openai) productEnv.OPENAI_API_KEY = llm.openai;
    if (llm.anthropic) productEnv.ANTHROPIC_API_KEY = llm.anthropic;
    const mergedUser = mergeEmbedUserEnv({
      service: "hermes",
      systemEnv: productEnv,
      userOverlay: store.getEmbedUserEnv("hermes"),
    });
    const gatewayEnv: NodeJS.ProcessEnv = applyOsSandboxEnv({
      env: {
        ...process.env,
        ...mergedUser,
        ...productEnv,
      },
      profileHome: sand.profileHome,
      userData: ctx.userDataDir,
      // PATH confiné : CLI Hermes (venv) + Node/git embarqués marque + System32.
      // Le terminal de l'agent ne résout AUCUN outil du PC hôte.
      toolDirs: hermesToolPathDirs(path.dirname(bin)),
    });
    delete gatewayEnv.HERMES_WEBUI_PASSWORD;
    // Ne jamais laisser une clé vide / héritée écraser le BYOK marque.
    delete gatewayEnv.OPENAI_API_KEY;
    delete gatewayEnv.ANTHROPIC_API_KEY;
    if (llm.openai) gatewayEnv.OPENAI_API_KEY = llm.openai;
    if (llm.anthropic) gatewayEnv.ANTHROPIC_API_KEY = llm.anthropic;
    const child = spawn(bin, ["gateway", "run", "--accept-hooks"], {
      cwd: sand.workspace,
      env: gatewayEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const errTail: string[] = [];
    child.stdout?.on("data", (d: Buffer) =>
      d
        .toString()
        .split("\n")
        .filter(Boolean)
        .forEach((l) => log(l)),
    );
    child.stderr?.on("data", (d: Buffer) =>
      d
        .toString()
        .split("\n")
        .filter(Boolean)
        .forEach((l) => {
          errTail.push(l);
          if (errTail.length > 30) errTail.shift();
          log(`stderr: ${l}`);
        }),
    );

    const spawnErr: { current: Error | null } = { current: null };
    child.on("error", (e) => {
      spawnErr.current = e;
      log(`spawn error: ${e.message}`);
    });
    child.on("exit", (code, signal) => {
      log(`exit code=${code} signal=${signal}`);
      if (state.running?.child === child) {
        state.running = null;
      }
    });

    const health = await waitForHermesHealth(apiUrl, apiKey);
    if (!health.ok) {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      state.lastError =
        spawnErr.current?.message ||
        health.detail ||
        (errTail.length ? errTail.slice(-5).join(" | ") : "démarrage Hermes échoué");
      log(`échec health: ${state.lastError}`);
      return null;
    }

    let webuiChild: ChildProcess | null = null;
    let webuiUrl: string | null = hermesConfig.remoteWebuiUrl || null;
    const webui = await spawnWebui({
      apiUrl,
      apiKey,
      home,
      log,
    });
    if (webui) {
      webuiChild = webui.child;
      webuiUrl = webui.webuiUrl;
    }

    state.version = health.version;
    state.lastError = null;
    const running: RunningHermes = {
      apiUrl,
      apiKey,
      webuiUrl,
      // Embedded loopback : pas de password WebUI (auth off) — évite le prompt.
      webuiPassword: null,
      homeDir: home,
      child,
      webuiChild,
      stop: () => {
        if (webuiChild) {
          try {
            webuiChild.kill();
          } catch {
            /* already dead */
          }
        }
        try {
          child.kill();
        } catch {
          /* already dead */
        }
      },
    };
    state.running = running;
    log(`ready v${health.version || "?"} ${apiUrl}${webuiUrl ? ` webui=${webuiUrl}` : ""}`);
    return running;
  } catch (e) {
    state.lastError = e instanceof Error ? e.message : String(e);
    log(`exception: ${state.lastError}`);
    return null;
  }
}

/**
 * Démarrage sérialisé : un clic UI ou une propagation de configuration ne
 * peuvent plus lancer deux gateways/WebUI en parallèle.
 */
function startHermes(
  opts: StartHermesOptions,
): Promise<RunningHermes | null> {
  if (state.running) return Promise.resolve(state.running);
  if (startInFlight) return startInFlight;

  state.starting = true;
  state.lastError = null;
  state.webuiError = null;
  const pending = startHermesImpl(opts).finally(() => {
    state.starting = false;
    if (startInFlight === pending) startInFlight = null;
  });
  startInFlight = pending;
  return pending;
}

function stopHermes(): void {
  if (state.running) {
    pushLog("stop");
    state.running.stop();
    state.running = null;
  }
  state.webuiStatus = state.webuiStatus === "skipped" ? "skipped" : "stopped";
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", done);
      child.removeListener("close", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    child.once("exit", done);
    child.once("close", done);
  });
}

/**
 * Arrêt utilisé avant un respawn. Attendre la libération des ports évite que
 * le second boot choisisse un autre port pendant que l'ancien process sort.
 */
async function stopHermesAndWait(timeoutMs = 5000): Promise<void> {
  const running = state.running;
  if (!running) return;
  const children = [running.webuiChild, running.child].filter(
    (child): child is ChildProcess => Boolean(child),
  );
  stopHermes();
  await Promise.all(children.map((child) => waitForChildExit(child, timeoutMs)));
}

/**
 * Propage les clés BYOK marque → Hermes (.env + process).
 * Appelé après Configuration → Clés IA (sinon seul Next redémarrait).
 */
async function reapplyHermesLlmKeys(opts: {
  connectionMode: "local" | "remote";
  crmPort?: number | null;
  onLog?: (line: string) => void;
}): Promise<{ restarted: boolean; detail: string }> {
  const log = (line: string) => {
    pushLog(line);
    opts.onLog?.(line);
  };
  if (opts.connectionMode !== "local") {
    return { restarted: false, detail: "client distant — pas de Hermes local" };
  }
  if (!state.running) {
    return {
      restarted: false,
      detail: "Hermes non démarré — clés prises au prochain boot",
    };
  }
  const llm = store.getLlmKeys();
  log(
    `BYOK → redémarrage Hermes (openai=${llm.openai ? "oui" : "non"}, anthropic=${llm.anthropic ? "oui" : "non"})`,
  );
  await stopHermesAndWait();
  const started = await startHermes({
    connectionMode: opts.connectionMode,
    autoBootstrap: false,
    crmPort: opts.crmPort,
    onLog: opts.onLog,
  });
  return {
    restarted: Boolean(started),
    detail: started
      ? "Hermes redémarré avec clés BYOK"
      : "échec restart Hermes après BYOK",
  };
}

/**
 * Réinjecte bridge n8n (+ CRM si crmPort) dans Hermes si manquant dans .env.
 * Warm boot / déjà injecté → no-op.
 */
async function reapplyHermesBridge(opts: {
  connectionMode: "local" | "remote";
  crmPort?: number | null;
  /** Force restart même si .env bridge déjà à jour (ex. MCP config.yaml). */
  forceRestart?: boolean;
  forceReason?: string;
  onLog?: (line: string) => void;
}): Promise<{ restarted: boolean; detail: string }> {
  const log = (line: string) => {
    pushLog(line);
    opts.onLog?.(line);
  };
  const bridge =  (ctx.getHermesBridgeEnv?.(opts.crmPort != null ? { crmPort: opts.crmPort } : undefined,
  ) || {}) ;
  if (!state.running) {
    return { restarted: false, detail: "Hermes non démarré" };
  }
  const envPath = path.join(homeDir(), ".env");
  let envBody = "";
  try {
    envBody = fs.readFileSync(envPath, "utf8");
  } catch {
    envBody = "";
  }
  // H7 — contrôle GÉNÉRIQUE : chaque clé du bridge (dérivée du manifest via
  // envPrefix : `{PREFIX}_API_KEY`, `{PREFIX}_PLUGINS_*`, N8N_*, aliases
  // legacy…) doit être présente avec sa valeur courante dans le .env Hermes.
  // Remplace l'ancienne liste en dur au vocabulaire de la première marque,
  // qui ratait silencieusement les préfixes des autres marques.
  const missing: string[] = [];
  for (const [key, value] of Object.entries(bridge)) {
    if (!value) continue;
    if (!envBody.includes(`${key}=${value}`)) missing.push(key);
  }
  // H1 — bloc mcp_servers attendu dans config.yaml (façade MCP CRM) : s'il
  // manque ou pointe ailleurs, un restart réécrit le home (writeHermesHome).
  const mcpCfg =
    ctx.getHermesMcpServerConfig?.(
      opts.crmPort != null ? { crmPort: opts.crmPort } : undefined,
    ) || null;
  if (mcpCfg) {
    let cfgBody = "";
    try {
      cfgBody = fs.readFileSync(path.join(homeDir(), "config.yaml"), "utf8");
    } catch {
      cfgBody = "";
    }
    if (
      !cfgBody.includes("mcp_servers") ||
      !cfgBody.includes(mcpCfg.url) ||
      !cfgBody.includes(mcpCfg.bearerToken)
    ) {
      missing.push("MCP_SERVERS");
    }
  }
  if (!missing.length && !opts.forceRestart) {
    return { restarted: false, detail: "bridge déjà injecté" };
  }
  const why = opts.forceRestart
    ? opts.forceReason || "force"
    : missing.join(", ");
  log(`bridge → redémarrage Hermes (${why})`);
  await stopHermesAndWait();
  const started = await startHermes({
    connectionMode: opts.connectionMode,
    autoBootstrap: false,
    crmPort: opts.crmPort,
    onLog: opts.onLog,
  });
  return {
    restarted: Boolean(started),
    detail: started
      ? `Hermes redémarré (${why})`
      : "échec restart Hermes après bridge",
  };
}

function getRunningHermes(): RunningHermes | null {
  return state.running;
}

/**
 * Env à fusionner dans startNextServer / restart.
 * Couvre embedded running + mode remote avancé (URL stockée).
 */
function getHermesNextEnv(connectionMode: "local" | "remote"): Record<string, string> {
  if (connectionMode !== "local") return {};

  const config = sanitizeHermesEmbedConfig(store.getHermesEmbedConfig());
  const running = state.running;

  if (running) {
    return buildNextHermesEnv({
      apiUrl: running.apiUrl,
      apiKey: running.apiKey,
      webuiUrl: running.webuiUrl,
      webuiPassword: running.webuiPassword,
    });
  }

  if (config.mode === "remote" && config.remoteApiUrl) {
    const key = (process.env.HERMES_API_SERVER_KEY || "").trim();
    if (!key) return {};
    return buildNextHermesEnv({
      apiUrl: config.remoteApiUrl,
      apiKey: key,
      webuiUrl: config.remoteWebuiUrl,
      webuiPassword: (process.env.HERMES_WEBUI_PASSWORD || "").trim() || null,
    });
  }

  return {
    HERMES_API_URL: `http://127.0.0.1:${HERMES_DESKTOP_API_PORT}`,
    HERMES_GATEWAY_URL: `http://127.0.0.1:${HERMES_DESKTOP_API_PORT}`,
    HERMES_WEBUI_URL: `http://127.0.0.1:${HERMES_DESKTOP_WEBUI_PORT}`,
    HERMES_KANBAN_URL: `http://127.0.0.1:${HERMES_DESKTOP_WEBUI_PORT}`,
  };
}

function getHermesStatusPayload(
  connectionMode: "local" | "remote",
  opts?: { remoteCrmOrigin?: string | null },
): HermesStatusPayload {
  const config = sanitizeHermesEmbedConfig(store.getHermesEmbedConfig());
  const binary = state.binaryPath || findHermesBinary();
  let pub = hermesPublicStatus({
    connectionMode,
    config,
    binaryFound: Boolean(binary),
    running: Boolean(state.running),
    apiUrl: state.running?.apiUrl || config.remoteApiUrl || null,
    lastError: state.lastError,
    version: state.version,
    remoteCrmOrigin: opts?.remoteCrmOrigin,
    tunnelRootDomain: ctx.manifest.tunnelRootDomain,
    tunnelHostMode: (() => {
      const env = String(process.env.CREEZIO_TUNNEL_FLAT_HOSTS || "").trim();
      if (env === "1" || /^true$/i.test(env)) return "flat" as const;
      if (env === "0" || /^false$/i.test(env)) return "nested" as const;
      return ctx.manifest.tunnelHostMode;
    })(),
    productName: product(),
  });
  if (state.installing && pub.status === "missing") {
    pub = {
      ...pub,
      status: "installing",
      detail: `Installation runtime en cours (${getBootstrapPhase()})…`,
    };
  }
  if (state.starting && pub.status !== "running") {
    pub = {
      ...pub,
      status: "starting",
      detail: "Démarrage du gateway et de la WebUI Hermes…",
    };
  }
  const webuiUrl =
    connectionMode === "remote"
      ? pub.webuiUrl
      : state.running?.webuiUrl || config.remoteWebuiUrl || null;
  return {
    ...pub,
    webuiUrl,
    webuiStatus:
      connectionMode === "remote"
        ? webuiUrl
          ? "running"
          : "skipped"
        : config.mode === "remote" || config.mode === "off"
          ? "skipped"
          : state.webuiStatus,
    binaryPath: binary,
    homeDir: state.running?.homeDir || null,
    bootstrapPhase: getBootstrapPhase(),
    bootstrapError: getBootstrapError() || state.webuiError,
    installing: state.installing,
    logs: state.logs.slice(-80),
  };
}

function getHermesLogs(): string[] {
  return state.logs.slice(-80);
}

/** Déclenché depuis l’UI Configuration (hôte local uniquement). */
async function ensureHermesRuntimeFromUi(opts?: {
  onLog?: (line: string) => void;
}): Promise<{
  ok: boolean;
  detail: string;
  binaryPath: string | null;
  webuiDir: string | null;
}> {
  state.installing = true;
  const log = (line: string) => {
    pushLog(line);
    opts?.onLog?.(line);
  };
  try {
    const r = await ensureHermesRuntime(ctx, { onLog: log });
    return {
      ok: r.ok,
      detail: r.detail,
      binaryPath: r.binary,
      webuiDir: r.webuiDir,
    };
  } finally {
    state.installing = false;
  }
}

/** Exposé pour tests. */
function __resetHermesStateForTests(): void {
  state.running = null;
  state.starting = false;
  state.lastError = null;
  state.version = null;
  state.logs = [];
  state.binaryPath = null;
  state.webuiStatus = "stopped";
  state.webuiError = null;
  state.installing = false;
  startInFlight = null;
}

  // --- end inlined ---

  return {
    startHermes,
    stopHermes,
    stopHermesAndWait,
    getRunningHermes,
    getHermesStatusPayload,
    getHermesNextEnv,
    getHermesLogs,
    ensureHermesRuntimeFromUi: async (uiOpts) => {
      const r = await ensureHermesRuntimeFromUi(uiOpts);
      return { ...r, phase: getBootstrapPhase() };
    },
    findHermesBinary,
    getHermesLastStartPath,
    reapplyHermesLlmKeys,
    reapplyHermesBridge,
    __resetForTests: __resetHermesStateForTests,
  };
}
