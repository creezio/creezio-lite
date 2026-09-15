/**
 * Sidecar n8n — factory brand-agnostic.
 * SoT extrait historique n8n-launcher.ts (R3.3) — chemins gold intacts.
 * Clés API / agent = hooks verticaux (onN8nReady, getN8nNextEnvExtra, n8nAgentKeys).
 */

import { spawn, type ChildProcess, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  buildNextN8nEnv,
  buildN8nSpawnEnv,
  describeN8nSpawnKind,
  EMBED_TOOL_SITE_IDS,
  N8N_DESKTOP_PORT,
  normalizeN8nPublicBaseUrl,
  n8nHomeLooksWarm as n8nHomeLooksWarmPure,
  n8nPublicStatus,
  resolveN8nEntry,
  sanitizeN8nEmbedConfig,
  shouldSpawnEmbeddedN8n,
  type N8nEmbedConfig,
  type N8nRuntimeStatus,
} from "@creezio/platform-core";
import type { HostRuntimeContext } from "../context.js";
import { hostLog, hostProductName } from "../context.js";
import type { LocalConfigStore } from "../local-config.js";
import { resolveSystemBinary } from "../sandbox/os-sandbox.js";
import {
  buildIsolatedNodeEnv,
  DESKTOP_NODE_MIN_FOR_EMBEDS,
  ensureDesktopNode,
  resolveDesktopNodeBinary,
} from "../node-runtime.js";
import { findFreePort } from "../server-env.js";
import {
  ensureN8nRuntime,
  getN8nBootstrapError,
  getN8nBootstrapPhase,
  n8nEntryPath,
  n8nRuntimeCacheDir,
  type N8nBootstrapPhase,
} from "./runtime-bootstrap.js";
import {
  cookieHeaderFromSetCookie,
  n8nLoginSucceeded,
  n8nNeedsOwnerSetup,
} from "./api-key.js";

export type RunningN8n = {
  uiUrl: string;
  homeDir: string;
  publicBaseUrl: string;
  child: ChildProcess;
  stop: () => void;
};

export type StartN8nOptions = {
  connectionMode: "local" | "remote";
  n8nConfig?: N8nEmbedConfig;
  onLog?: (line: string) => void;
  autoBootstrap?: boolean;
  publicBaseUrl?: string | null;
  forceRestart?: boolean;
};

export type N8nAgentKeysHooks = {
  provision: (opts: {
    uiUrl: string;
    homeDir: string;
    email: string;
    password: string;
    aiUserId: string;
    log: (line: string) => void;
    forceNew?: boolean;
  }) => Promise<{ ok: boolean; apiKey: string | null; detail: string }>;
  revoke: (opts: {
    uiUrl: string;
    homeDir: string;
    email: string;
    password: string;
    aiUserId: string;
    log: (line: string) => void;
  }) => Promise<{ ok: boolean; detail: string }>;
  readStored: (homeDir: string) => Record<string, unknown>;
  writeStored: (homeDir: string, keys: Record<string, unknown>) => void;
};

export type N8nStatusPayload = {
  status: N8nRuntimeStatus;
  mode: ReturnType<typeof sanitizeN8nEmbedConfig>["mode"];
  uiUrl: string | null;
  entryFound: boolean;
  entryPath: string | null;
  version: string | null;
  detail: string;
  homeDir: string | null;
  bootstrapPhase: N8nBootstrapPhase;
  bootstrapError: string | null;
  installing: boolean;
  ownerReady: boolean;
  logs: string[];
  /** URL locale loopback (onglet desktop). */
  localUiUrl: string | null;
  /** WEBHOOK_URL / EDITOR_BASE_URL actifs (tunnel si configuré). */
  publicWebhookUrl: string | null;
  listenHost: string;
  listenPort: number;
};

export type N8nHost = {
  startN8n: (opts: StartN8nOptions) => Promise<RunningN8n | null>;
  stopN8n: () => void;
  getRunningN8n: () => RunningN8n | null;
  getN8nStatusPayload: (
    connectionMode: "local" | "remote",
    opts?: { remoteCrmOrigin?: string | null },
  ) => N8nStatusPayload;
  getN8nNextEnv: (connectionMode: "local" | "remote") => Record<string, string>;
  getN8nLogs: () => string[];
  ensureN8nRuntimeFromUi: (opts?: {
    onLog?: (line: string) => void;
  }) => Promise<{
    ok: boolean;
    detail: string;
    entryPath: string | null;
    runtimeDir: string | null;
    phase: N8nBootstrapPhase;
  }>;
  findN8nEntry: () => string | null;
  applyN8nPublicBaseUrl: (opts: {
    publicBaseUrl: string | null;
    connectionMode?: "local" | "remote";
    onLog?: (line: string) => void;
  }) => Promise<RunningN8n | null>;
  n8nHomeLooksWarm: (homeDir?: string) => boolean;
  getN8nLastStartPath: () => "bootstrap" | "reuse" | null;
  prepareN8nUiSession: () => Promise<{
    ok: boolean;
    detail: string;
    uiUrl: string | null;
  }>;
  provisionN8nAgentApiKey: (
    aiUserId: string,
    opts?: { forceNew?: boolean },
  ) => Promise<{ ok: boolean; apiKey: string | null; detail: string }>;
  revokeN8nAgentKey: (
    aiUserId: string,
  ) => Promise<{ ok: boolean; detail: string }>;
  getN8nBridgeEnvForHermes: () => Record<string, string>;
  n8nHomeDir: () => string;
  __resetForTests: () => void;
};

export function createN8nHost(opts: {
  ctx: HostRuntimeContext;
  store: LocalConfigStore;
  agentKeys?: N8nAgentKeysHooks;
}): N8nHost {
  const { ctx, store, agentKeys } = opts;
  const homeDirPath = () => path.join(ctx.userDataDir, "n8n-home");
  const homeDirEnsure = () => {
    const d = homeDirPath();
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const product = () => hostProductName(ctx);
  const secretPrefix = () => ctx.secretFilePrefix || "desktop";
  function n8nHomeDir(): string {
    return homeDirEnsure();
  }


type OwnerCreds = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
};

type N8nState = {
  running: RunningN8n | null;
  lastError: string | null;
  version: string | null;
  logs: string[];
  entryPath: string | null;
  installing: boolean;
  ownerReady: boolean;
  /** Dernière URL publique demandée au spawn. */
  publicBaseUrl: string | null;
  /** Dernier chemin de démarrage : install runtime vs runtime réutilisé. */
  lastStartPath: "bootstrap" | "reuse" | null;
};

const state: N8nState = {
  running: null,
  lastError: null,
  version: null,
  logs: [],
  entryPath: null,
  installing: false,
  ownerReady: false,
  publicBaseUrl: null,
  lastStartPath: null,
};

/** "bootstrap" = runtime n8n installé pendant ce boot ; "reuse" = déjà présent. */
function getN8nLastStartPath(): "bootstrap" | "reuse" | null {
  return state.lastStartPath;
}

const LOG_MAX = 200;

function pushLog(line: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  state.logs.push("[" + ts + "] " + line);
  if (state.logs.length > LOG_MAX) state.logs.shift();
  hostLog(ctx, "n8n", line);
}

function findN8nEntry(): string | null {
  const runtime = n8nRuntimeCacheDir(ctx);
  // Jamais `which n8n` : sous Windows → %AppData%\Roaming\npm\n8n (shim bash)
  // que `node <shim> start` exécute comme JS → SyntaxError immédiat.
  const resolved = resolveN8nEntry({
    platform: process.platform,
    env: process.env,
    runtimeDir: runtime,
    // Overrides env honorés uniquement hors build packagé (dev/tests).
    allowEnvOverride: !ctx.isPackaged,
    envPrefix: ctx.manifest.envPrefix,
    existsSync: (p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    },
    readFileSync: (p, enc) => fs.readFileSync(p, enc),
  });
  state.entryPath = resolved || n8nEntryPath(ctx);
  return state.entryPath;
}

function ensureEncryptionKey(home: string): string {
  const prefix = secretPrefix();
  const keyFile = path.join(home, `.${prefix}-n8n-encryption-key`);
  /** Ancien layout : `.${prefix}-encryption-key` sans `-n8n-`. */
  const brandLegacy = path.join(home, `.${prefix}-encryption-key`);
  const desktop = path.join(home, ".desktop-n8n-encryption-key");
  for (const f of [keyFile, brandLegacy, desktop]) {
    try {
      const existing = fs.readFileSync(f, "utf8").trim();
      if (existing.length >= 16) {
        if (f !== keyFile) fs.writeFileSync(keyFile, existing, { mode: 0o600 });
        return existing;
      }
    } catch { /* */ }
  }
  const key = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(keyFile, key, { mode: 0o600 });
  return key;
}
/**
 * Superadmin uniforme flotte : posé par l'opérateur au niveau du VPS/serveur
 * (env `CREEZIO_SUPERADMIN_EMAIL` / `CREEZIO_SUPERADMIN_PASSWORD`, jamais
 * commité). Prioritaire sur les creds owner générés — permet de se loguer sur
 * le n8n de TOUTES les instances avec le même compte.
 */
function superadminEnvCreds(): OwnerCreds | null {
  const email = (process.env.CREEZIO_SUPERADMIN_EMAIL || "").trim();
  const password = (process.env.CREEZIO_SUPERADMIN_PASSWORD || "").trim();
  if (!email || !email.includes("@") || password.length < 12) return null;
  return { email, password, firstName: "Creezio", lastName: "Superadmin" };
}

function ownerCredsFile(home: string): string {
  return path.join(home, `.${secretPrefix()}-n8n-owner.json`);
}

function writeOwnerCreds(home: string, creds: OwnerCreds): void {
  fs.writeFileSync(
    ownerCredsFile(home),
    JSON.stringify(creds, null, 2) + "\n",
    { mode: 0o600 },
  );
}

/** Creds owner persistés (fichier home) — sans l'override env superadmin. */
function readFileOwnerCreds(home: string): OwnerCreds | null {
  const keyFile = ownerCredsFile(home);
  /** Ancien layout : `.${prefix}-owner.json`. */
  const brandLegacy = path.join(home, `.${secretPrefix()}-owner.json`);
  for (const f of [keyFile, brandLegacy]) {
    try {
      const raw = JSON.parse(fs.readFileSync(f, "utf8")) as OwnerCreds;
      if (raw && typeof raw.email === "string" && typeof raw.password === "string" && raw.password.length >= 12) {
        if (f !== keyFile) fs.writeFileSync(keyFile, JSON.stringify(raw, null, 2) + "\n", { mode: 0o600 });
        return {
          email: raw.email,
          password: raw.password,
          firstName: raw.firstName || product(),
          lastName: raw.lastName || "Desktop",
        };
      }
    } catch { /* */ }
  }
  return null;
}

function ensureOwnerCreds(home: string): OwnerCreds {
  // Superadmin flotte prioritaire — le fichier n'est mis à jour qu'après un
  // login/setup RÉUSSI (ensureOwnerSilent), pour garder les anciens creds en
  // fallback si l'instance a déjà été initialisée avec eux.
  const env = superadminEnvCreds();
  if (env) return env;
  const stored = readFileOwnerCreds(home);
  if (stored) return stored;
  const creds: OwnerCreds = {
    email: secretPrefix() + "-desktop@localhost.local",
    password: crypto.randomBytes(24).toString("base64url"),
    firstName: product(),
    lastName: "Desktop",
  };
  writeOwnerCreds(home, creds);
  return creds;
}
function httpJson(
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
        timeout: 15000,
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
      reject(new Error("timeout HTTP n8n"));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * n8n 2.x (Node) est lourd au boot Windows : chargement modules + SQLite + AV.
 * Warm = DB déjà là — souvent 30–90s ; cold (1er boot) 5–10 min possibles.
 */
const N8N_HEALTH_TIMEOUT_COLD_MS = 600_000;
const N8N_HEALTH_TIMEOUT_WARM_MS = 180_000;
const N8N_HEALTH_GRACE_COLD_MS = 180_000;
const N8N_HEALTH_GRACE_WARM_MS = 90_000;

/** Signaux stdout/stderr qui indiquent que l’UI est joignable (avant healthz). */
function isN8nReadyLogLine(line: string): boolean {
  return /Editor is now accessible|n8n ready on|Editor UI available|Server is listening/i.test(
    line,
  );
}

/** Chemins absolus utilitaires réseau (hors allowlist resolveSystemBinary). */
function resolvePortTool(name: "lsof" | "fuser"): string | null {
  const candidates =
    name === "lsof"
      ? ["/usr/bin/lsof", "/bin/lsof", "/usr/sbin/lsof"]
      : ["/usr/bin/fuser", "/bin/fuser", "/usr/sbin/fuser"];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** PIDs écouteurs TCP (Linux/mac) — lsof d’abord (fuser souvent absent en CI). */
function listenerPidsOnPort(port: number): number[] {
  const pids = new Set<number>();
  const push = (raw: string) => {
    for (const line of raw.split(/\r?\n/)) {
      const n = Number(line.trim());
      if (Number.isInteger(n) && n > 0) pids.add(n);
    }
  };
  try {
    const lsof = resolvePortTool("lsof");
    if (lsof) {
      const out = execFileSync(
        lsof,
        ["-tiTCP:" + String(port), "-sTCP:LISTEN"],
        { timeout: 5000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      push(out);
    }
  } catch {
    /* aucun listener / lsof KO */
  }
  try {
    const fuser = resolvePortTool("fuser");
    if (fuser) {
      const out = execFileSync(fuser, [`${port}/tcp`], {
        timeout: 5000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      for (const m of out.matchAll(/\b(\d+)\b/g)) {
        const n = Number(m[1]);
        if (n > 0) pids.add(n);
      }
    }
  } catch {
    /* */
  }
  return [...pids];
}

/** Best-effort : libérer le port desktop (zombie après crash / retry). */
function killListenerOnPort(port: number): void {
  try {
    if (process.platform === "win32") {
      const powershell = resolveSystemBinary("powershell");
      if (!powershell) return;
      execFileSync(
        powershell,
        [
          "-NoProfile",
          "-Command",
          `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`,
        ],
        { timeout: 8000, windowsHide: true, stdio: "ignore" },
      );
      return;
    }
    for (const pid of listenerPidsOnPort(port)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* déjà mort / permission */
      }
    }
    // Fallback shell si lsof/fuser absents du PATH sandbox.
    const bash = resolveSystemBinary("bash");
    if (bash && listenerPidsOnPort(port).length > 0) {
      execFileSync(
        bash,
        [
          "-lc",
          `fuser -k ${port}/tcp >/dev/null 2>&1 || true; ` +
            `command -v lsof >/dev/null && lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null | while read p; do kill -9 "$p" 2>/dev/null || true; done`,
        ],
        { timeout: 8000, stdio: "ignore" },
      );
    }
  } catch {
    /* best-effort */
  }
}

/** Kill + attendre que le port desktop soit réellement libre. */
async function ensureN8nDesktopPortFree(
  log: (line: string) => void,
  attempts = 4,
): Promise<boolean> {
  for (let i = 1; i <= attempts; i++) {
    const probe = await findFreePort(N8N_DESKTOP_PORT);
    if (probe === N8N_DESKTOP_PORT) return true;
    log(
      `port ${N8N_DESKTOP_PORT} occupé — free attempt ${i}/${attempts}`,
    );
    killListenerOnPort(N8N_DESKTOP_PORT);
    await new Promise((r) => setTimeout(r, 400 * i));
  }
  return (await findFreePort(N8N_DESKTOP_PORT)) === N8N_DESKTOP_PORT;
}

/** DB déjà présente → pas de 1er install / grosses migrations. */
function n8nHomeLooksWarm(homeDir?: string): boolean {
  return n8nHomeLooksWarmPure(homeDir || homeDirPath(), (p) => fs.existsSync(p));
}

function waitForN8nHealth(
  uiUrl: string,
  timeoutMs = N8N_HEALTH_TIMEOUT_COLD_MS,
  /** Si true → sortir tôt (ex. log « Editor is now accessible »). */
  earlyOk?: () => boolean,
  /** Si true → abandonner tout de suite (process mort). */
  earlyFail?: () => string | null,
): Promise<{ ok: boolean; detail?: string; version?: string | null }> {
  const deadline = Date.now() + timeoutMs;
  const base = uiUrl.replace(/\/$/, "");
  const started = Date.now();
  let lastTickLog = 0;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const failReason = earlyFail?.();
      if (failReason) {
        resolve({ ok: false, detail: failReason });
        return;
      }
      if (earlyOk?.()) {
        resolve({ ok: true, version: null });
        return;
      }
      const elapsed = Date.now() - started;
      if (elapsed - lastTickLog >= 15_000) {
        lastTickLog = elapsed;
        pushLog(
          `attente n8n… ${Math.round(elapsed / 1000)}s (chargement modules / SQLite)`,
        );
      }
      const req = http.get(`${base}/healthz`, { timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve({ ok: true, version: null });
        } else {
          next();
        }
      });
      req.on("error", next);
      req.on("timeout", () => {
        req.destroy();
        next();
      });
    };
    const next = () => {
      const failReason = earlyFail?.();
      if (failReason) {
        resolve({ ok: false, detail: failReason });
        return;
      }
      if (earlyOk?.()) {
        resolve({ ok: true, version: null });
        return;
      }
      if (Date.now() > deadline) {
        resolve({
          ok: false,
          detail: `n8n healthz timeout après ${Math.round(timeoutMs / 1000)}s`,
        });
      } else {
        setTimeout(tryOnce, 400);
      }
    };
    tryOnce();
  });
}

/**
 * Attend que le routeur REST n8n soit RÉELLEMENT prêt : `/rest/settings`
 * doit répondre 2xx avec `data.userManagement.showSetupOnFirstLoad` présent.
 * Deux pièges vécus (2.31.5) :
 * - healthz répond AVANT le montage des routes `/rest/*` (setup part en 404) ;
 * - les routes répondent AVANT la fin de l'init DB : un POST /rest/owner/setup
 *   dans cette fenêtre renvoie 200 mais l'écriture est PERDUE (le shell user
 *   n'existe pas encore — vécu : setup « OK » à +7 s du spawn, owner absent,
 *   login 401 ensuite). Le flag userManagement n'apparaît qu'une fois la DB
 *   initialisée — c'est le signal fiable.
 */
async function waitForN8nRestReady(
  base: string,
  timeoutMs: number,
  log: (l: string) => void,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let waited = false;
  for (;;) {
    try {
      const res = await httpJson("GET", `${base}/rest/settings`);
      if (
        res.status >= 200 &&
        res.status < 300 &&
        n8nNeedsOwnerSetup(res.json) !== null
      ) {
        if (waited) log("owner: routeur REST n8n prêt (settings complets)");
        return true;
      }
    } catch {
      /* n8n pas encore joignable */
    }
    if (Date.now() > deadline) {
      log("owner: routeur REST n8n toujours indisponible (timeout)");
      return false;
    }
    if (!waited) {
      waited = true;
      log("owner: attente du routeur REST n8n (init DB / settings incomplets)…");
    }
    await new Promise((r) => setTimeout(r, 800));
  }
}

/**
 * Provisionne l’owner si besoin + vérifie login (sans UI password).
 * Retourne les creds RÉELLEMENT valides (env superadmin, ou fallback fichier
 * si l'instance a été initialisée avec d'anciens creds), null si échec.
 */
async function ensureOwnerSilent(
  uiUrl: string,
  creds: OwnerCreds,
  log: (l: string) => void,
  fallback?: OwnerCreds | null,
): Promise<OwnerCreds | null> {
  const base = uiUrl.replace(/\/$/, "");
  const home = state.running?.homeDir || n8nHomeDir();
  // Faux positif connu : n8n vierge répond 200 à /rest/login (shell user)
  // SANS cookie de session → n8nLoginSucceeded exige le cookie n8n-auth.
  const tryLogin = async (c: OwnerCreds): Promise<boolean> => {
    const res = await httpJson("POST", `${base}/rest/login`, {
      emailOrLdapLoginId: c.email,
      password: c.password,
    });
    return n8nLoginSucceeded(res.status, res.headers["set-cookie"]);
  };
  try {
    await waitForN8nRestReady(base, 90_000, log);

    // État réel de l'instance : /rest/settings → showSetupOnFirstLoad.
    let needsSetup: boolean | null = null;
    try {
      const settings = await httpJson("GET", `${base}/rest/settings`);
      needsSetup = n8nNeedsOwnerSetup(settings.json);
    } catch {
      /* signal indisponible — on retombe sur login puis setup */
    }
    if (needsSetup === true) {
      log("owner: instance vierge détectée (showSetupOnFirstLoad) — setup…");
    } else if (await tryLogin(creds)) {
      state.ownerReady = true;
      log("owner: login OK (session silencieuse)");
      writeOwnerCreds(home, creds);
      return creds;
    }

    // Setup avec VÉRIFICATION : un 2xx sur /rest/owner/setup pendant l'init
    // DB peut être perdu (vécu : owner « créé » mais DB vierge, login 401).
    // Seul un login réel (cookie n8n-auth) prouve que l'owner existe.
    const doSetup = () =>
      httpJson("POST", `${base}/rest/owner/setup`, {
        email: creds.email,
        password: creds.password,
        firstName: creds.firstName,
        lastName: creds.lastName,
      });
    let setup = await doSetup();
    for (let attempt = 0; attempt < 4; attempt++) {
      if (setup.status >= 200 && setup.status < 300) {
        if (await tryLogin(creds)) {
          state.ownerReady = true;
          log("owner: setup silencieux OK (login vérifié)");
          writeOwnerCreds(home, creds);
          return creds;
        }
        log(
          "owner: setup 2xx mais login non vérifié (init DB en cours ?) — retry…",
        );
      } else if (setup.status !== 404) {
        // 400 « already set up » ou autre erreur définitive — sortir du retry.
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
      setup = await doSetup();
    }
    if (setup.status >= 200 && setup.status < 300 && (await tryLogin(creds))) {
      state.ownerReady = true;
      log("owner: setup silencieux OK (login vérifié)");
      writeOwnerCreds(home, creds);
      return creds;
    }

    // Instance déjà initialisée avec les creds fichier (ex. avant l'arrivée
    // du superadmin flotte) : login fallback, puis rotation best-effort du
    // mot de passe vers le superadmin pour converger.
    if (fallback && fallback.password !== creds.password) {
      const loginRes = await httpJson("POST", `${base}/rest/login`, {
        emailOrLdapLoginId: fallback.email,
        password: fallback.password,
      });
      if (n8nLoginSucceeded(loginRes.status, loginRes.headers["set-cookie"])) {
        state.ownerReady = true;
        log("owner: login OK via creds locaux (instance pré-superadmin)");
        const cookie = cookieHeaderFromSetCookie(loginRes.headers["set-cookie"]);
        if (cookie && superadminEnvCreds()) {
          for (const method of ["PATCH", "POST"]) {
            const rot = await httpJson(
              method,
              `${base}/rest/me/password`,
              { currentPassword: fallback.password, newPassword: creds.password },
              { Cookie: cookie },
            );
            if (rot.status >= 200 && rot.status < 300) {
              log("owner: mot de passe aligné sur le superadmin flotte");
              writeOwnerCreds(home, { ...fallback, password: creds.password });
              return { ...fallback, password: creds.password };
            }
          }
          log("owner: rotation superadmin refusée — creds locaux conservés");
        }
        return fallback;
      }
    }

    // Instance déjà initialisée avec d’autres creds — on log sans bloquer.
    log(
      `owner: setup/login non conclusif (setup=${setup.status}) — UI pourra demander un login`,
    );
    state.ownerReady = false;
    return null;
  } catch (e) {
    log(`owner: ${e instanceof Error ? e.message : String(e)}`);
    state.ownerReady = false;
    return null;
  }
}

function parseSetCookie(headers: http.IncomingHttpHeaders): string[] {
  const raw = headers["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * Login REST + injecte le cookie `n8n-auth` dans la partition onglet.
 * Évite l’écran password à l’ouverture (équivalent fix Hermes 0.1.47).
 */
async function prepareN8nUiSession(): Promise<{
  ok: boolean;
  detail: string;
  uiUrl: string | null;
}> {
  const config = sanitizeN8nEmbedConfig(store.getN8nEmbedConfig());
  const uiUrl =
    state.running?.uiUrl ||
    (config.mode === "remote" ? config.remoteUiUrl || null : null);
  if (!uiUrl) {
    return {
      ok: false,
      detail: "URL n8n absente — démarrez le mode embarqué ou configurez Distant.",
      uiUrl: null,
    };
  }
  if (config.mode === "remote" && !state.running) {
    // Remote : pas de credentials kit — l’utilisateur gère l’auth distante.
    return {
      ok: true,
      detail: "Mode distant — pas d’injection cookie locale.",
      uiUrl,
    };
  }

  const home = state.running?.homeDir || n8nHomeDir();
  const creds = ensureOwnerCreds(home);
  const base = uiUrl.replace(/\/$/, "");
  try {
    let res = await httpJson("POST", `${base}/rest/login`, {
      emailOrLdapLoginId: creds.email,
      password: creds.password,
    });
    if (!n8nLoginSucceeded(res.status, res.headers["set-cookie"])) {
      // 200-sans-cookie inclus (instance vierge) : provisionner puis re-login.
      const working =
        (await ensureOwnerSilent(
          uiUrl,
          creds,
          pushLog,
          readFileOwnerCreds(home),
        )) || creds;
      res = await httpJson("POST", `${base}/rest/login`, {
        emailOrLdapLoginId: working.email,
        password: working.password,
      });
    }
    if (!(res.status >= 200 && res.status < 300)) {
      return {
        ok: false,
        detail: `Login n8n échoué (HTTP ${res.status})`,
        uiUrl,
      };
    }

    const cookies = parseSetCookie(res.headers);
    if (!cookies.length) {
      return {
        ok: false,
        detail: "Login n8n OK mais aucun Set-Cookie — session non injectée",
        uiUrl,
      };
    }
    let electronSession: typeof import("electron").session;
    try {
      electronSession = (await import("electron")).session;
    } catch {
      return { ok: false, detail: "electron session indisponible", uiUrl };
    }
    type CookiesSetDetails = {
      url: string;
      name: string;
      value: string;
      path?: string;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
      domain?: string;
    };
    const ses = electronSession.fromPartition(
      `persist:extsite-${EMBED_TOOL_SITE_IDS.n8nUi}`,
    ) as unknown as {
      cookies: {
        set: (details: CookiesSetDetails) => Promise<void>;
        flushStore: () => Promise<void>;
      };
    };
    const u = new URL(base);
    // Chromium refuse souvent `domain` sur une IP (127.0.0.1) — url seul.
    const hostIsIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname);
    let injected = 0;
    for (const line of cookies) {
      const nameVal = line.split(";")[0] || "";
      const eq = nameVal.indexOf("=");
      if (eq <= 0) continue;
      const name = nameVal.slice(0, eq).trim();
      const value = nameVal.slice(eq + 1).trim();
      if (!name) continue;
      const payload: CookiesSetDetails = {
        url: base,
        name,
        value,
        path: "/",
        httpOnly: /httponly/i.test(line),
        secure: u.protocol === "https:",
        sameSite: "lax",
      };
      if (!hostIsIp) payload.domain = u.hostname;
      await ses.cookies.set(payload);
      injected += 1;
    }
    try {
      await ses.cookies.flushStore();
    } catch {
      /* best-effort */
    }
    pushLog(`session: ${injected} cookie(s) injecté(s) → partition extsite-${EMBED_TOOL_SITE_IDS.n8nUi}`);
    return {
      ok: injected > 0,
      detail:
        injected > 0
          ? "Session n8n préparée (login silencieux)"
          : "Aucun cookie injecté",
      uiUrl,
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, detail, uiUrl };
  }
}

async function startN8n(
  opts: StartN8nOptions,
): Promise<RunningN8n | null> {
  const n8nConfig = sanitizeN8nEmbedConfig(
    opts.n8nConfig ?? store.getN8nEmbedConfig(),
  );
  const desiredPublic = normalizeN8nPublicBaseUrl(opts.publicBaseUrl);

  if (
    !shouldSpawnEmbeddedN8n({
      connectionMode: opts.connectionMode,
      n8n: n8nConfig,
    })
  ) {
    pushLog(
      opts.connectionMode === "remote"
        ? "skip spawn (client distant)"
        : `skip spawn (mode=${n8nConfig.mode})`,
    );
    return null;
  }

  const log = (line: string) => {
    pushLog(line);
    opts.onLog?.(line);
  };

  // Idempotent sauf si URL publique changée ou forceRestart.
  if (state.running) {
    const publicMatches =
      desiredPublic == null
        ? state.running.publicBaseUrl.startsWith("http://127.0.0.1")
        : state.running.publicBaseUrl === desiredPublic;
    if (!opts.forceRestart && publicMatches) {
      log(
        `déjà prêt ${state.running.uiUrl} (webhooks=${state.running.publicBaseUrl})`,
      );
      return state.running;
    }
    log(
      `restart n8n — webhooks ${state.running.publicBaseUrl} → ${desiredPublic || "loopback"}`,
    );
    stopN8n();
  }

  const nodeReady = await ensureDesktopNode(ctx, {
      minVersion: DESKTOP_NODE_MIN_FOR_EMBEDS,
    });
    if (!nodeReady.ok) {
    state.lastError = nodeReady.detail;
    log(state.lastError);
    return null;
  }
  const node = nodeReady.node;

  let entry = findN8nEntry();
  // Honnêteté splash + télémétrie : install réelle vs runtime réutilisé.
  state.lastStartPath = entry ? "reuse" : "bootstrap";
  if (!entry && opts.autoBootstrap !== false) {
    state.installing = true;
    log("runtime n8n manquant — bootstrap npm (Node TempoFlow)…");
    try {
      const boot = await ensureN8nRuntime(ctx, { onLog: log });
      log(boot.detail);
      entry = boot.entry || findN8nEntry();
      if (!boot.ok && !entry) {
        state.lastError = boot.detail;
        state.installing = false;
        return null;
      }
    } finally {
      state.installing = false;
    }
  }

  if (!entry) {
    state.lastError = "Entry n8n introuvable (bootstrap / TF2_N8N_BIN)";
    log(state.lastError);
    return null;
  }

  try {
    const home = n8nHomeDir();
    // Warm AVANT d’écrire les marqueurs kit (sinon faux « warm » au 1er boot).
    const warm = n8nHomeLooksWarm(home);
    const encryptionKey = ensureEncryptionKey(home);
    const creds = ensureOwnerCreds(home);

    // Réutiliser une instance déjà saine sur le port desktop (retry / zombie).
    // Évite un 2ᵉ spawn sur un autre port partageant la même DB.
    const existingUrl = `http://127.0.0.1:${N8N_DESKTOP_PORT}`;
    const existing = await waitForN8nHealth(existingUrl, 2500);
    // Si on a une URL tunnel à injecter, il faut re-spawner (env au boot).
    if (existing.ok && !desiredPublic && !opts.forceRestart) {
      log(`réutilise n8n déjà prêt sur ${existingUrl} (pas de re-spawn)`);
      state.lastError = null;
      const working = await ensureOwnerSilent(
        existingUrl,
        creds,
        log,
        readFileOwnerCreds(home),
      );
      if (working && ctx.onN8nReady) {
        try {
          await ctx.onN8nReady({
            uiUrl: existingUrl,
            homeDir: home,
            email: working.email,
            password: working.password,
            log,
          });
        } catch (e) {
          log("api-key: " + (e instanceof Error ? e.message : e));
        }
      }
      const publicBase = `${existingUrl.replace(/\/$/, "")}/`;
      const running: RunningN8n = {
        uiUrl: existingUrl,
        homeDir: home,
        publicBaseUrl: publicBase,
        child: { kill: () => undefined } as unknown as ChildProcess,
        stop: () => killListenerOnPort(N8N_DESKTOP_PORT),
      };
      state.running = running;
      state.publicBaseUrl = publicBase;
      return running;
    }

    // Port occupé mais healthz KO (zombie après crash / Réessayer) : libérer
    // avant findFreePort, sinon n8n démarre sur :15679 avec la même DB → crash.
    if (existing.ok) {
      log(
        `n8n déjà sur ${existingUrl} — stop pour appliquer WEBHOOK_URL=${desiredPublic || "loopback"}`,
      );
    } else {
      log(
        `port ${N8N_DESKTOP_PORT} non prêt — kill éventuel zombie avant spawn`,
      );
    }
    const portFree = await ensureN8nDesktopPortFree(log);
    if (!portFree) {
      state.lastError = `port n8n ${N8N_DESKTOP_PORT} occupé par un autre process — fermez-le puis réessayez`;
      log(state.lastError);
      return null;
    }
    const boundPort = N8N_DESKTOP_PORT;
    const uiUrl = `http://127.0.0.1:${boundPort}`;
    const publicBase =
      desiredPublic || `${uiUrl.replace(/\/$/, "")}/`;
    const healthTimeout = warm
      ? N8N_HEALTH_TIMEOUT_WARM_MS
      : N8N_HEALTH_TIMEOUT_COLD_MS;

    log(
      describeN8nSpawnKind({
        warm,
        node,
        entry,
        home,
        uiUrl,
        healthTimeoutSec: Math.round(healthTimeout / 1000),
      }),
    );
    log(`WEBHOOK_URL / N8N_EDITOR_BASE_URL = ${publicBase}`);

    const osHome = path.join(home, "os-home");
    const childEnv = buildIsolatedNodeEnv({
      nodeBin: node,
      baseEnv: buildN8nSpawnEnv({
        port: boundPort,
        userFolder: home,
        encryptionKey,
        publicBaseUrl: desiredPublic,
        userEnv: store.getEmbedUserEnv("n8n"),
        baseEnv: process.env,
      }),
      sandbox: { profileHome: osHome, userData: ctx.userDataDir },
    });

    const child = spawn(node, [entry, "start"], {
      cwd: home,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const errTail: string[] = [];
    let readyFromLog = false;
    const onLine = (l: string, asStderr = false) => {
      if (asStderr) {
        errTail.push(l);
        if (errTail.length > 30) errTail.shift();
        log(`stderr: ${l}`);
      } else {
        log(l);
      }
      if (isN8nReadyLogLine(l)) {
        readyFromLog = true;
        log("signal prêt (log n8n) — UI accessible");
      }
    };
    child.stdout?.on("data", (d: Buffer) =>
      d
        .toString()
        .split("\n")
        .filter(Boolean)
        .forEach((l) => onLine(l, false)),
    );
    child.stderr?.on("data", (d: Buffer) =>
      d
        .toString()
        .split("\n")
        .filter(Boolean)
        .forEach((l) => onLine(l, true)),
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

    const childDeadReason = (): string | null => {
      if (spawnErr.current) return `spawn n8n: ${spawnErr.current.message}`;
      if (child.exitCode !== null || child.killed) {
        const interesting =
          errTail.find((l) => /SyntaxError|Error:|Cannot find module/i.test(l)) ||
          errTail.slice(-3).join(" | ");
        const tail = interesting ? ` — ${interesting}` : "";
        return `process n8n arrêté (code=${child.exitCode}, signal=${child.signalCode})${tail}`;
      }
      return null;
    };

    // Attente combinée : healthz OU log « Editor is now accessible ».
    const bootStarted = Date.now();
    let health = await waitForN8nHealth(
      uiUrl,
      healthTimeout,
      () => readyFromLog,
      childDeadReason,
    );
    if (!health.ok && readyFromLog && !childDeadReason()) {
      // Petite fenêtre pour que healthz suive le log.
      health = await waitForN8nHealth(uiUrl, 15_000, undefined, childDeadReason);
      if (!health.ok && !childDeadReason()) {
        log("UI signalée prête par log — on continue (healthz encore en retard)");
        health = { ok: true };
      }
    }
    const childAlive = !childDeadReason();
    if (!health.ok) {
      if (!childAlive) {
        state.lastError =
          health.detail ||
          spawnErr.current?.message ||
          (errTail.length
            ? errTail.slice(-5).join(" | ")
            : "démarrage n8n échoué");
        log(`échec health: ${state.lastError}`);
        return null;
      }
      const elapsedSec = Math.round((Date.now() - bootStarted) / 1000);
      log(
        `n8n charge encore ses modules (${elapsedSec}s, process vivant) — poursuite…`,
      );
      const health2 = await waitForN8nHealth(
        uiUrl,
        warm ? N8N_HEALTH_GRACE_WARM_MS : N8N_HEALTH_GRACE_COLD_MS,
        () => readyFromLog,
        childDeadReason,
      );
      if (!health2.ok && childDeadReason()) {
        state.lastError = health2.detail || childDeadReason() || "démarrage n8n échoué";
        log(`échec health: ${state.lastError}`);
        return null;
      }
      if (!health2.ok && readyFromLog) {
        log("signal prêt (log) après attente prolongée");
      } else if (!health2.ok) {
        log(
          `healthz encore KO après ${Math.round((Date.now() - bootStarted) / 1000)}s — URL ${uiUrl} (process vivant, pas de kill)`,
        );
      }
    }

    const workingCreds = await ensureOwnerSilent(
      uiUrl,
      creds,
      log,
      readFileOwnerCreds(home),
    );
    if (workingCreds && ctx.onN8nReady) {
      try {
        await ctx.onN8nReady({
          uiUrl,
          homeDir: home,
          email: workingCreds.email,
          password: workingCreds.password,
          log,
        });
      } catch (e) {
        log("api-key: " + (e instanceof Error ? e.message : String(e)));
      }
    }

    // Version best-effort depuis package installé
    try {
      const pkg = path.join(n8nRuntimeCacheDir(ctx),
        "node_modules",
        "n8n",
        "package.json",
      );
      if (fs.existsSync(pkg)) {
        const v = JSON.parse(fs.readFileSync(pkg, "utf8")) as { version?: string };
        state.version = v.version || null;
      }
    } catch {
      state.version = null;
    }

    state.lastError = null;
    const running: RunningN8n = {
      uiUrl,
      homeDir: home,
      publicBaseUrl: publicBase,
      child,
      stop: () => {
        try {
          child.kill();
        } catch {
          /* already dead */
        }
      },
    };
    state.running = running;
    state.publicBaseUrl = publicBase;
    log(
      `ready ${uiUrl}${state.version ? ` v${state.version}` : ""} · webhooks ${publicBase}`,
    );
    return running;
  } catch (e) {
    state.lastError = e instanceof Error ? e.message : String(e);
    log(`exception: ${state.lastError}`);
    return null;
  }
}

/**
 * Applique l’URL tunnel aux webhooks n8n (restart si nécessaire).
 * Appelé après syncTunnelIngress / réserve slug.
 */
async function applyN8nPublicBaseUrl(opts: {
  publicBaseUrl: string | null;
  connectionMode?: "local" | "remote";
  onLog?: (line: string) => void;
}): Promise<RunningN8n | null> {
  const desired = normalizeN8nPublicBaseUrl(opts.publicBaseUrl);
  if (!desired) return state.running;
  if (state.running?.publicBaseUrl === desired) {
    opts.onLog?.(`n8n webhooks déjà sur ${desired}`);
    return state.running;
  }
  return startN8n({
    connectionMode: opts.connectionMode || "local",
    publicBaseUrl: desired,
    forceRestart: true,
    onLog: opts.onLog,
    autoBootstrap: true,
  });
}

function stopN8n(): void {
  if (state.running) {
    pushLog("stop");
    state.running.stop();
    state.running = null;
  }
  state.ownerReady = false;
  state.publicBaseUrl = null;
}

function getRunningN8n(): RunningN8n | null {
  return state.running;
}

/**
 * Q2 (étanchéité par agent) : API key n8n DÉDIÉE à un collaborateur IA,
 * créée via le login owner silencieux du n8n embarqué. Idempotent.
 * n8n non démarré → échec doux (l'appelant journalise, jamais bloquant).
 */
async function provisionN8nAgentApiKey(
  aiUserId: string,
  opts?: { forceNew?: boolean },
): Promise<{ ok: boolean; apiKey: string | null; detail: string }> {
  const running = state.running;
  if (!running) {
    return { ok: false, apiKey: null, detail: "n8n embarqué non démarré" };
  }
  const creds = ensureOwnerCreds(running.homeDir);
  if (!agentKeys) return { ok: false, apiKey: null, detail: "n8nAgentKeys hook absent" };
  return agentKeys.provision({
    uiUrl: running.uiUrl,
    homeDir: running.homeDir,
    email: creds.email,
    password: creds.password,
    aiUserId,
    log: pushLog,
    forceNew: opts?.forceNew,
  });
}

/** Révocation de la clé n8n d'un agent (vraie fermeture / suppression). */
async function revokeN8nAgentKey(
  aiUserId: string,
): Promise<{ ok: boolean; detail: string }> {
  const running = state.running;
  if (!running) {
    // Sans n8n actif on retire quand même l'entrée locale (fichier home).
    const home = n8nHomeDir();
    if (agentKeys) {
      const keys = agentKeys.readStored(home) as Record<string, unknown>;
      if (keys[aiUserId]) {
        delete keys[aiUserId];
        agentKeys.writeStored(home, keys);
      }
    }
    return { ok: true, detail: "n8n non démarré — clé retirée localement" };
  }
  const creds = ensureOwnerCreds(running.homeDir);
  if (!agentKeys) return { ok: false, detail: "n8nAgentKeys hook absent" };
  return agentKeys.revoke({
    uiUrl: running.uiUrl,
    homeDir: running.homeDir,
    email: creds.email,
    password: creds.password,
    aiUserId,
    log: pushLog,
  });
}

function getN8nNextEnv(
  connectionMode: "local" | "remote",
): Record<string, string> {
  if (connectionMode !== "local") return {};
  const config = sanitizeN8nEmbedConfig(store.getN8nEmbedConfig());
  if (state.running) {
    // Le serveur Next a besoin de l'API n8n complète (clé incluse) pour
    // l'onglet n8n du Product Hub (n8nConfig() exige N8N_API_URL+N8N_API_KEY).
    // La clé est provisionnée pendant le boot n8n (avant Next) ; si elle
    // apparaît plus tard, restartNextServer ré-évalue cet env.
    return {
      ...buildNextN8nEnv({ uiUrl: state.running.uiUrl }),
      ...(ctx.getN8nNextEnvExtra?.({
        connectionMode,
        homeDir: state.running.homeDir,
        localUiUrl: state.running.uiUrl,
      }) || {}),
    };
  }
  if (config.mode === "remote" && config.remoteUiUrl) {
    return buildNextN8nEnv({ uiUrl: config.remoteUiUrl });
  }
  return {};
}

function getN8nStatusPayload(
  connectionMode: "local" | "remote",
  opts?: { remoteCrmOrigin?: string | null },
): N8nStatusPayload {
  const config = sanitizeN8nEmbedConfig(store.getN8nEmbedConfig());
  const entry = state.entryPath || findN8nEntry();
  let pub = n8nPublicStatus({
    connectionMode,
    config,
    entryFound: Boolean(entry),
    running: Boolean(state.running),
    uiUrl: state.running?.uiUrl || config.remoteUiUrl || null,
    lastError: state.lastError,
    version: state.version,
    installing: state.installing,
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
      detail: `Installation runtime en cours (${getN8nBootstrapPhase()})…`,
    };
  }
  const localUiUrl = state.running?.uiUrl || null;
  const publicWebhookUrl =
    state.running?.publicBaseUrl || state.publicBaseUrl || null;
  let listenPort = N8N_DESKTOP_PORT;
  try {
    if (localUiUrl) listenPort = Number(new URL(localUiUrl).port) || N8N_DESKTOP_PORT;
  } catch {
    /* keep default */
  }
  return {
    ...pub,
    entryPath: entry,
    // Chemin pur : un simple status ne doit pas créer n8n-home (client léger).
    homeDir: state.running?.homeDir || homeDirPath(),
    bootstrapPhase: getN8nBootstrapPhase(),
    bootstrapError: getN8nBootstrapError() || state.lastError,
    installing: state.installing,
    ownerReady: state.ownerReady,
    logs: state.logs.slice(-80),
    localUiUrl,
    publicWebhookUrl,
    listenHost: "127.0.0.1",
    listenPort,
  };
}

function getN8nLogs(): string[] {
  return state.logs.slice(-80);
}

/** Env bridge n8n → Hermes (lecture fichier + URL locale). */
function getN8nBridgeEnvForHermes(): Record<string, string> {
  const home = state.running?.homeDir || n8nHomeDir();
  const localUiUrl =
    state.running?.uiUrl || `http://127.0.0.1:${N8N_DESKTOP_PORT}`;
  return (
    ctx.getN8nNextEnvExtra?.({
      connectionMode: "local",
      homeDir: home,
      localUiUrl,
    }) || {}
  );
}

async function ensureN8nRuntimeFromUi(opts?: {
  onLog?: (line: string) => void;
}): Promise<{
  ok: boolean;
  detail: string;
  entryPath: string | null;
  runtimeDir: string | null;
}> {
  state.installing = true;
  const log = (line: string) => {
    pushLog(line);
    opts?.onLog?.(line);
  };
  try {
    const r = await ensureN8nRuntime(ctx, { onLog: log });
    if (r.entry) state.entryPath = r.entry;
    return {
      ok: r.ok,
      detail: r.detail,
      entryPath: r.entry,
      runtimeDir: n8nRuntimeCacheDir(ctx),
    };
  } finally {
    state.installing = false;
  }
}

/** Exposé pour tests. */
function __resetN8nStateForTests(): void {
  state.running = null;
  state.lastError = null;
  state.version = null;
  state.logs = [];
  state.entryPath = null;
  state.installing = false;
  state.ownerReady = false;
}


  return {
    startN8n,
    stopN8n,
    getRunningN8n,
    getN8nStatusPayload,
    getN8nNextEnv,
    getN8nLogs,
    ensureN8nRuntimeFromUi: async (uiOpts) => {
      const r = await ensureN8nRuntimeFromUi(uiOpts);
      return { ...r, phase: getN8nBootstrapPhase() };
    },
    findN8nEntry,
    applyN8nPublicBaseUrl,
    n8nHomeLooksWarm,
    getN8nLastStartPath,
    prepareN8nUiSession,
    provisionN8nAgentApiKey,
    revokeN8nAgentKey,
    getN8nBridgeEnvForHermes,
    n8nHomeDir,
    __resetForTests: __resetN8nStateForTests,
  };
}
