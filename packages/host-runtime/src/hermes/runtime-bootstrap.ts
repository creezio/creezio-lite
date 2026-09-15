/**
 * Bootstrap runtime Hermes (agent CLI + WebUI) — download-on-first-run.
 *
 * Le full Python/venv n’est PAS dans l’exe (taille / remote-build). Au premier
 * Héberger sans CLI, on lance l’installeur officiel NousResearch, puis on
 * récupère l’archive WebUI pinée (checksum SHA-256) sous userData.
 * Chemins injectés via HostRuntimeContext (SoT kit — jumeau marque interdit).
 */

import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import type { HostRuntimeContext } from "../context.js";
import { hostLog, hostProductName } from "../context.js";
import { kitOsVendorDir } from "@creezio/platform-core";
import { applyOsSandboxEnv, setSandboxEnvVar } from "../sandbox/embed-sandbox.js";
import { resolveSystemBinary } from "../sandbox/os-sandbox.js";
import { resolveDesktopNodeBinary } from "../node-runtime.js";

/**
 * Browser tools Hermes (Playwright) opt-in : CREEZIO_HERMES_BROWSER=1 retire
 * `--skip-browser` de l'installeur (≈ +400 Mo Chromium Playwright + deps —
 * dimensionner le disque en conséquence). Défaut : skip (desktop léger ; le
 * pilotage web IA passe par le sidecar browser-host côté serveur).
 */
export function hermesBrowserToolsEnabled(): boolean {
  return process.env.CREEZIO_HERMES_BROWSER === "1";
}

export type BootstrapPhase =
  | "idle"
  | "checking"
  | "installing-agent"
  | "installing-webui"
  | "ready"
  | "error";

export type RuntimeManifest = {
  hermesAgentPin: string;
  decision: string;
  webui: {
    repo: string;
    ref: string;
    archiveUrl: string;
    sha256: string;
    license?: string;
  };
  agentInstall: {
    /** Commit hermes-agent épinglé (install reproductible, checkout exact). */
    commitPin?: string;
    windows: {
      scriptUrl: string;
      scriptSha256?: string;
      args: string[];
      /**
       * Stages install.ps1 exécutés UN PAR UN (stage protocol officiel).
       * Tout stage absent de la liste n'est JAMAIS exécuté — c'est ainsi
       * qu'on exclut `system-packages` (winget machine-wide) et `path`
       * (PATH registre utilisateur) du périmètre OS desktop.
       */
      stages?: string[];
    };
    posix: { scriptUrl: string; scriptSha256?: string; args: string[] };
  };
};

let phase: BootstrapPhase = "idle";
let lastBootstrapError: string | null = null;

export function getBootstrapPhase(): BootstrapPhase {
  return phase;
}

export function getBootstrapError(): string | null {
  return lastBootstrapError;
}

function setPhase(p: BootstrapPhase): void {
  phase = p;
}

export function hermesVendorDir(ctx: HostRuntimeContext): string {
  // Marque d’abord (packaged resourcesPath/vendor), sinon kit OS Creezio.
  const candidates = [
    path.join(ctx.resourcesRoot, "vendor", "hermes-agent"),
    path.join(ctx.resourcesRoot, "resources", "vendor", "hermes-agent"),
    kitOsVendorDir("hermes-agent"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, "runtime-manifest.json"))) return p;
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0]!;
}

export function loadRuntimeManifest(ctx: HostRuntimeContext): RuntimeManifest {
  const candidates = [
    path.join(hermesVendorDir(ctx), "runtime-manifest.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8")) as RuntimeManifest;
    }
  }
  throw new Error("vendor/hermes-agent/runtime-manifest.json introuvable");
}

/**
 * Script d'install Hermes VENDORISÉ (embarqué dans les ressources).
 * Plus aucun téléchargement au first-run : un changement du script upstream
 * ne peut plus casser les installs (le checksum du manifest reste vérifié
 * comme garde d'intégrité du fichier packagé).
 */
export function vendoredInstallScriptPath(
  ctx: HostRuntimeContext,
  name: string,
): string | null {
  const candidates = [path.join(hermesVendorDir(ctx), name)];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Racine userData sans espaces pour les scripts shell tiers (install.sh).
 * Ex. `…/Acme Server` → `…/Acme-Server` — sinon `$UV_CMD --version`
 * non quoté dans l’installeur officiel sort en exit 126.
 */
export function hermesSpaceSafeUserDataRoot(userDataDir: string): string {
  if (!/\s/.test(userDataDir)) return userDataDir;
  const parent = path.dirname(userDataDir);
  const base = path.basename(userDataDir).replace(/\s+/g, "-");
  return path.join(parent, base);
}

export function hermesRuntimeCacheDir(ctx: HostRuntimeContext): string {
  // Install/bootstrap Hermes : jamais d’espace dans le chemin (install.sh).
  const root = hermesSpaceSafeUserDataRoot(ctx.userDataDir);
  const dir = path.join(root, "hermes-runtime");
  fs.mkdirSync(dir, { recursive: true });
  // Compat : garder un lien/miroir sous l’ancien chemin à espaces si différent.
  try {
    const legacy = path.join(ctx.userDataDir, "hermes-runtime");
    if (legacy !== dir && !fs.existsSync(legacy)) {
      try {
        fs.symlinkSync(
          dir,
          legacy,
          process.platform === "win32" ? "junction" : "dir",
        );
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* ignore */
  }
  return dir;
}

/**
 * Verrou layout d'install Hermes : l'install.sh amont récent bascule en
 * layout FHS quand il tourne en root Linux (containers server-docker) —
 * code sous `/usr/local/lib/hermes-agent`, commande `/usr/local/bin/hermes`
 * — hors du sandbox où le launcher cherche le binaire (« CLI toujours
 * introuvable après install », vécu instance demo). `HERMES_INSTALL_DIR`
 * est honoré par l'installeur et force le layout sandbox historique.
 */
export function hermesInstallLayoutEnv(
  profile: string,
  platform: NodeJS.Platform,
): { HERMES_HOME: string; HERMES_INSTALL_DIR?: string } {
  if (platform === "win32") {
    return {
      HERMES_HOME: path.join(profile, "AppData", "Local", "hermes"),
    };
  }
  const home = path.join(profile, ".hermes");
  return {
    HERMES_HOME: home,
    HERMES_INSTALL_DIR: path.join(home, "hermes-agent"),
  };
}

/**
 * Dossiers fallback FHS pour retrouver un CLI Hermes installé AVANT le
 * verrou `HERMES_INSTALL_DIR` (install root Linux → /usr/local). Réservé
 * aux processus root Linux (containers) — jamais sur un desktop utilisateur
 * (sandbox only).
 */
export function hermesFhsFallbackDirs(
  platform: NodeJS.Platform,
  uid: number | null,
): string[] {
  if (platform !== "linux" || uid !== 0) return [];
  return ["/usr/local/bin", "/usr/local/lib/hermes-agent"];
}

/** Corrige les invocations non quotées de $UV_CMD dans install.sh (espaces). */
export function patchHermesInstallShForSpaces(scriptPath: string): void {
  if (!fs.existsSync(scriptPath)) return;
  const raw = fs.readFileSync(scriptPath, "utf8");
  const patched = raw
    .replace(
      /UV_VERSION=\$\(\$UV_CMD --version 2>\/dev\/null\)/g,
      'UV_VERSION=$("$UV_CMD" --version 2>/dev/null)',
    )
    .replace(
      /UV_VERSION=\$\(\$UV_CMD --version\)/g,
      'UV_VERSION=$("$UV_CMD" --version)',
    );
  if (patched !== raw) {
    fs.writeFileSync(scriptPath, patched, "utf8");
  }
}

/**
 * Profil OS faux pour l’installeur Hermes officiel.
 * Sous Windows l’install écrit typiquement `%USERPROFILE%\.hermes` /
 * `%LOCALAPPDATA%\hermes` — on pointe USERPROFILE + LOCALAPPDATA ici
 * pour rester dans le sandbox desktop.
 */
export function hermesInstallOsProfileDir(ctx: HostRuntimeContext): string {
  const dir = path.join(hermesRuntimeCacheDir(ctx), "os-profile");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "AppData", "Local"), { recursive: true });
  fs.mkdirSync(path.join(dir, "AppData", "Roaming"), { recursive: true });
  return dir;
}

export function hermesWebuiInstallDir(ctx: HostRuntimeContext): string {
  return path.join(hermesRuntimeCacheDir(ctx), "webui");
}

/** Répertoires candidats pour le checkout hermes-agent (sandbox d’abord). */
export function hermesAgentDirCandidates(ctx: HostRuntimeContext): string[] {
  const profile = hermesInstallOsProfileDir(ctx);
  const local = path.join(profile, "AppData", "Local");
  return [
    path.join(hermesRuntimeCacheDir(ctx), "hermes-agent"),
    path.join(profile, ".hermes", "hermes-agent"),
    path.join(local, "hermes", "hermes-agent"),
    path.join(ctx.userDataDir, "hermes-home", "hermes-agent"),
    // Install FHS root Linux antérieure au verrou HERMES_INSTALL_DIR
    // (containers uniquement — voir hermesFhsFallbackDirs).
    ...(hermesFhsFallbackDirs(
      process.platform,
      typeof process.getuid === "function" ? process.getuid() : null,
    ).includes("/usr/local/lib/hermes-agent")
      ? ["/usr/local/lib/hermes-agent"]
      : []),
  ].filter(Boolean);
}

export function resolveHermesAgentDir(
  ctx: HostRuntimeContext,
  existsSync = fs.existsSync,
): string | null {
  for (const dir of hermesAgentDirCandidates(ctx)) {
    const marker = path.join(dir, "cli.py");
    const marker2 = path.join(dir, "pyproject.toml");
    if (existsSync(marker) || existsSync(marker2)) return dir;
  }
  return null;
}

/** Python du venv Hermes (pour spawner WebUI). */
export function resolveHermesPython(
  agentDir?: string | null,
): string | null {
  if (!agentDir) return null;
  const candidates =
    process.platform === "win32"
      ? [
          path.join(agentDir, "venv", "Scripts", "python.exe"),
          path.join(agentDir, ".venv", "Scripts", "python.exe"),
        ]
      : [
          path.join(agentDir, "venv", "bin", "python"),
          path.join(agentDir, ".venv", "bin", "python"),
          path.join(agentDir, "venv", "bin", "python3"),
        ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function downloadToFile(
  url: string,
  dest: string,
  onLog: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.part`;
    const file = fs.createWriteStream(tmp);
    const get = url.startsWith("https:") ? https.get : http.get;
    onLog(`download ${url}`);
    const req = get(url, { timeout: 120_000 }, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        file.close();
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* ignore */
        }
        downloadToFile(res.headers.location, dest, onLog).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${res.statusCode} pour ${url}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => {
        file.close(() => {
          fs.renameSync(tmp, dest);
          resolve();
        });
      });
    });
    req.on("error", (e) => {
      try {
        file.close();
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      reject(e);
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("download timeout"));
    });
  });
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

/**
 * Supply-chain : le script d'install distant doit correspondre au pin sha256
 * du manifest. Mismatch = throw (jamais d'exécution d'un script inattendu).
 */
function verifyInstallScriptChecksum(
  scriptPath: string,
  expectedSha256: string | undefined,
  onLog: (line: string) => void,
): void {
  const digest = sha256File(scriptPath);
  if (!expectedSha256) {
    throw new Error(
      `script d'install sans pin sha256 dans le manifest (observé ${digest}) — exécution refusée`,
    );
  }
  if (digest !== expectedSha256.toLowerCase()) {
    throw new Error(
      `checksum script d'install invalide (got ${digest}, want ${expectedSha256}) — exécution refusée`,
    );
  }
  onLog(`checksum script install OK ${digest.slice(0, 12)}…`);
}

/** Marker écrit après pip OK / imports OK — skip pip aux boots suivants. */
export const WEBUI_DEPS_MARKER = ".desktop-webui-deps";
const WEBUI_PIN_FILE = ".desktop-webui-pin";

export function webuiDepsMarkerPath(webuiDir: string): string {
  return path.join(webuiDir, WEBUI_DEPS_MARKER);
}

export function readWebuiDepsMarker(webuiDir: string): string | null {
  const p = path.join(webuiDir, WEBUI_DEPS_MARKER);
  try {
    if (!fs.existsSync(p)) return null;
    const v = fs.readFileSync(p, "utf8").trim();
    return v || null;
  } catch {
    return null;
  }
}

export function writeWebuiDepsMarker(webuiDir: string, digest: string): void {
  fs.writeFileSync(webuiDepsMarkerPath(webuiDir), `${digest}\n`, "utf8");
}

/**
 * true si le marker correspond au hash de requirements.txt
 * (deps déjà validées pour ce pin WebUI).
 */
export function isWebuiDepsMarkerCurrent(
  webuiDir: string,
  requirementsPath: string,
  existsSync = fs.existsSync,
): boolean {
  if (!existsSync(requirementsPath)) return false;
  const digest = sha256File(requirementsPath);
  return readWebuiDepsMarker(webuiDir) === digest;
}

/**
 * Check rapide (~ms) : imports WebUI requis.
 * Évite `pip install -r` à chaque Héberger quand le venv est déjà prêt.
 */
export async function webuiPythonDepsReady(
  pythonPath: string,
  opts?: { onLog?: (line: string) => void; timeoutMs?: number },
): Promise<boolean> {
  const silent = opts?.onLog || (() => undefined);
  try {
    const r = await runCommand(
      pythonPath,
      ["-c", "import yaml, cryptography"],
      {
        onLog: silent,
        timeoutMs: opts?.timeoutMs ?? 15_000,
      },
    );
    return r.code === 0;
  } catch {
    return false;
  }
}

function runCommand(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    onLog: (line: string) => void;
    timeoutMs: number;
  },
): Promise<{ code: number | null }> {
  return new Promise((resolve, reject) => {
    opts.onLog(`$ ${cmd} ${args.join(" ")}`);
    const child: ChildProcess = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    const onData = (buf: Buffer) => {
      buf
        .toString("utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((l) => opts.onLog(l.slice(0, 400)));
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error(`timeout ${opts.timeoutMs}ms: ${cmd}`));
    }, opts.timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code });
    });
  });
}

/**
 * Installe Hermes Agent via l’installeur officiel (réseau requis).
 * Idempotent si le CLI est déjà présent ailleurs — le caller vérifie d’abord.
 */
export async function installHermesAgent(
  ctx: HostRuntimeContext,
  opts: {
    onLog: (line: string) => void;
    timeoutMs?: number;
  },
): Promise<{ ok: boolean; detail: string }> {
  const manifest = loadRuntimeManifest(ctx);
  const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;
  setPhase("installing-agent");
  lastBootstrapError = null;
  const cache = hermesRuntimeCacheDir(ctx);
  const scriptsDir = path.join(cache, "install-scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  const product = hostProductName(ctx);

  try {
    const profile = hermesInstallOsProfileDir(ctx);
    // Node desktop visible dans le PATH confiné : le stage `node` de
    // l'installeur le détecte et n'installe RIEN (ni zip portable, ni winget
    // machine-wide en fallback).
    const desktopNode = resolveDesktopNodeBinary(ctx);
    const installToolDirs = path.isAbsolute(desktopNode)
      ? [path.dirname(desktopNode)]
      : [];
    const installEnv = applyOsSandboxEnv({
      env: {
        ...process.env,
        LOCALAPPDATA: path.join(profile, "AppData", "Local"),
        APPDATA: path.join(profile, "AppData", "Roaming"),
      },
      profileHome: profile,
      userData: ctx.userDataDir,
      // PATH confiné : Node desktop + System32, rien du PC hôte.
      toolDirs: installToolDirs,
    });
    setSandboxEnvVar(
      installEnv,
      "LOCALAPPDATA",
      path.join(profile, "AppData", "Local"),
    );
    setSandboxEnvVar(
      installEnv,
      "APPDATA",
      path.join(profile, "AppData", "Roaming"),
    );
    // Verrou définitif : install.ps1/install.sh donnent à HERMES_HOME la
    // priorité sur %LOCALAPPDATA% / $HOME pour choisir HermesHome, et
    // HERMES_INSTALL_DIR neutralise le layout FHS root Linux (/usr/local)
    // de l'installeur récent — le launcher ne cherche que le sandbox.
    const layout = hermesInstallLayoutEnv(profile, process.platform);
    setSandboxEnvVar(installEnv, "HERMES_HOME", layout.HERMES_HOME);
    if (layout.HERMES_INSTALL_DIR) {
      setSandboxEnvVar(installEnv, "HERMES_INSTALL_DIR", layout.HERMES_INSTALL_DIR);
    }
    opts.onLog(
      `install Hermes dans sandbox ${product} (USERPROFILE=${profile}, HERMES_HOME=${installEnv.HERMES_HOME}${layout.HERMES_INSTALL_DIR ? `, HERMES_INSTALL_DIR=${layout.HERMES_INSTALL_DIR}` : ""})`,
    );

    // Purge des checkouts mis de côté par install.ps1 après un échec
    // (« hermes-agent.broken-<ts> ») — sinon chaque retry laisse des
    // centaines de Mo morts dans le sandbox.
    try {
      const hermesHome = installEnv.HERMES_HOME as string;
      if (fs.existsSync(hermesHome)) {
        for (const entry of fs.readdirSync(hermesHome)) {
          if (entry.startsWith("hermes-agent.broken-")) {
            opts.onLog(`purge checkout cassé: ${entry}`);
            fs.rmSync(path.join(hermesHome, entry), {
              recursive: true,
              force: true,
            });
          }
        }
      }
    } catch {
      /* best-effort */
    }

    const commitPin = manifest.agentInstall.commitPin;
    if (process.platform === "win32") {
      const win = manifest.agentInstall.windows;
      const ps1 = path.join(scriptsDir, "install.ps1");
      const vendored = vendoredInstallScriptPath(ctx, "install.ps1");
      if (vendored) {
        fs.copyFileSync(vendored, ps1);
        opts.onLog("script install vendorisé (embarqué, aucun téléchargement)");
      } else {
        await downloadToFile(win.scriptUrl, ps1, opts.onLog);
      }
      verifyInstallScriptChecksum(ps1, win.scriptSha256, opts.onLog);
      const powershell = resolveSystemBinary("powershell");
      if (!powershell) {
        lastBootstrapError = "PowerShell système introuvable (System32)";
        setPhase("error");
        return { ok: false, detail: lastBootstrapError };
      }
      const baseArgs = [...win.args].filter(
        (a) => !(hermesBrowserToolsEnabled() && a === "-SkipBrowser"),
      );
      if (commitPin) baseArgs.push("-Commit", commitPin);
      if (win.stages && win.stages.length > 0) {
        for (const stage of win.stages) {
          opts.onLog(`install stage « ${stage} »…`);
          const r = await runCommand(
            powershell,
            [
              "-NoProfile",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              ps1,
              "-Stage",
              stage,
              ...baseArgs,
            ],
            { onLog: opts.onLog, timeoutMs, env: installEnv },
          );
          if (r.code !== 0) {
            lastBootstrapError = `install.ps1 stage ${stage} exit ${r.code}`;
            setPhase("error");
            return { ok: false, detail: lastBootstrapError };
          }
        }
      } else {
        const result = await runCommand(
          powershell,
          ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, ...baseArgs],
          { onLog: opts.onLog, timeoutMs, env: installEnv },
        );
        if (result.code !== 0) {
          lastBootstrapError = `install.ps1 exit ${result.code}`;
          setPhase("error");
          return { ok: false, detail: lastBootstrapError };
        }
      }
    } else {
      const posix = manifest.agentInstall.posix;
      const sh = path.join(scriptsDir, "install.sh");
      const vendored = vendoredInstallScriptPath(ctx, "install.sh");
      if (vendored) {
        fs.copyFileSync(vendored, sh);
        opts.onLog("script install vendorisé (embarqué, aucun téléchargement)");
      } else {
        await downloadToFile(posix.scriptUrl, sh, opts.onLog);
      }
      // Checksum AVANT patch local (le patch quote $UV_CMD — hors amont).
      verifyInstallScriptChecksum(sh, posix.scriptSha256, opts.onLog);
      patchHermesInstallShForSpaces(sh);
      fs.chmodSync(sh, 0o755);
      const bash = resolveSystemBinary("bash");
      if (!bash) {
        lastBootstrapError = "bash système introuvable (/bin, /usr/bin)";
        setPhase("error");
        return { ok: false, detail: lastBootstrapError };
      }
      const posixArgs = [...posix.args].filter(
        (a) => !(hermesBrowserToolsEnabled() && a === "--skip-browser"),
      );
      if (commitPin) posixArgs.push("--commit", commitPin);
      const result = await runCommand(bash, [sh, ...posixArgs], {
        onLog: opts.onLog,
        timeoutMs,
        env: installEnv,
      });
      if (result.code !== 0) {
        lastBootstrapError = `install.sh exit ${result.code}`;
        setPhase("error");
        return { ok: false, detail: lastBootstrapError };
      }
    }
    setPhase("ready");
    return { ok: true, detail: "Hermes Agent installé" };
  } catch (e) {
    lastBootstrapError = e instanceof Error ? e.message : String(e);
    setPhase("error");
    return { ok: false, detail: lastBootstrapError };
  }
}

async function extractTarGz(
  ctx: HostRuntimeContext,
  archive: string,
  destParent: string,
  onLog: (line: string) => void,
): Promise<string> {
  fs.mkdirSync(destParent, { recursive: true });
  const staging = path.join(destParent, "_extract");
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  const tarBin = resolveSystemBinary("tar");
  if (!tarBin) {
    throw new Error("tar système introuvable (System32 / /usr/bin)");
  }
  {
    const r = await runCommand(tarBin, ["-xzf", archive, "-C", staging], {
      onLog,
      timeoutMs: 120_000,
    });
    if (r.code !== 0) throw new Error(`tar extraction failed (${tarBin})`);
  }

  const entries = fs.readdirSync(staging).filter((n) => !n.startsWith("."));
  if (entries.length !== 1) {
    throw new Error(`archive layout inattendu: ${entries.join(",")}`);
  }
  const extracted = path.join(staging, entries[0]!);
  const finalDir = hermesWebuiInstallDir(ctx);
  fs.rmSync(finalDir, { recursive: true, force: true });
  fs.renameSync(extracted, finalDir);
  fs.rmSync(staging, { recursive: true, force: true });
  return finalDir;
}

function readWebuiPin(webuiDir: string): string | null {
  const p = path.join(webuiDir, WEBUI_PIN_FILE);
  try {
    if (!fs.existsSync(p)) return null;
    const v = fs.readFileSync(p, "utf8").trim();
    return v || null;
  } catch {
    return null;
  }
}

/**
 * Télécharge + vérifie + extrait hermes-webui (pin + sha256 du manifest).
 * Installe les deps Python légères dans le venv Hermes **uniquement** si
 * absentes (premier run / repair). Boots suivants : marker ou import check.
 */
export async function ensureHermesWebuiTree(
  ctx: HostRuntimeContext,
  opts?: {
    onLog?: (line: string) => void;
    pythonPath?: string;
  },
): Promise<{ ok: boolean; dir: string | null; detail: string }> {
  const log = opts?.onLog || ((l) => hostLog(ctx, "hermes-bootstrap", l));
  setPhase("checking");
  lastBootstrapError = null;
  try {
    const manifest = loadRuntimeManifest(ctx);
    const finalDir = hermesWebuiInstallDir(ctx);
    const marker = path.join(finalDir, "server.py");
    const pinRef = readWebuiPin(finalDir);
    const needDownload =
      !fs.existsSync(marker) ||
      !pinRef ||
      pinRef !== manifest.webui.ref;

    if (needDownload) {
      setPhase("installing-webui");
      const cache = path.join(hermesRuntimeCacheDir(ctx), "downloads");
      fs.mkdirSync(cache, { recursive: true });
      const archive = path.join(
        cache,
        `hermes-webui-${manifest.webui.ref}.tar.gz`,
      );
      if (
        !fs.existsSync(archive) ||
        sha256File(archive) !== manifest.webui.sha256
      ) {
        await downloadToFile(manifest.webui.archiveUrl, archive, log);
      }
      const digest = sha256File(archive);
      if (digest !== manifest.webui.sha256) {
        throw new Error(
          `checksum WebUI invalide (got ${digest}, want ${manifest.webui.sha256})`,
        );
      }
      log(`checksum OK ${digest.slice(0, 12)}…`);
      await extractTarGz(ctx, archive, hermesRuntimeCacheDir(ctx), log);
      fs.writeFileSync(
        path.join(finalDir, WEBUI_PIN_FILE),
        `${manifest.webui.ref}\n`,
        "utf8",
      );
    }

    const pythonPath =
      opts?.pythonPath ||
      resolveHermesPython(resolveHermesAgentDir(ctx));
    const req = path.join(finalDir, "requirements.txt");
    if (fs.existsSync(req) && pythonPath) {
      if (isWebuiDepsMarkerCurrent(finalDir, req)) {
        log("démarrage…");
      } else {
        const already = await webuiPythonDepsReady(pythonPath);
        const reqDigest = sha256File(req);
        if (already) {
          writeWebuiDepsMarker(finalDir, reqDigest);
          log("démarrage…");
        } else {
          setPhase("installing-webui");
          log("pip install WebUI deps (pyyaml, cryptography)…");
          const pipEnv = applyOsSandboxEnv({
            env: { ...process.env },
            profileHome: hermesInstallOsProfileDir(ctx),
            userData: ctx.userDataDir,
            toolDirs: [path.dirname(pythonPath)],
          });
          const pip = await runCommand(
            pythonPath,
            ["-m", "pip", "install", "--disable-pip-version-check", "-r", req],
            { onLog: log, timeoutMs: 180_000, cwd: finalDir, env: pipEnv },
          );
          if (pip.code === 0) {
            writeWebuiDepsMarker(finalDir, reqDigest);
          } else {
            const recovered = await webuiPythonDepsReady(pythonPath);
            if (recovered) {
              writeWebuiDepsMarker(finalDir, reqDigest);
              log("démarrage…");
            } else {
              log(
                "deps WebUI manquantes après pip — WebUI peut échouer au spawn",
              );
            }
          }
        }
      }
    } else if (!needDownload) {
      log("démarrage…");
    }

    setPhase("ready");
    return { ok: true, dir: finalDir, detail: "WebUI prêt" };
  } catch (e) {
    lastBootstrapError = e instanceof Error ? e.message : String(e);
    setPhase("error");
    return { ok: false, dir: null, detail: lastBootstrapError };
  }
}

/**
 * Si CLI absente → install agent. Puis assure l’arbre WebUI.
 * Appelé au boot Héberger (embedded) ou depuis l’UI « Installer runtime ».
 */
export async function ensureHermesRuntime(
  ctx: HostRuntimeContext,
  opts?: {
    onLog?: (line: string) => void;
    onPhase?: (p: BootstrapPhase) => void;
    searchDirs?: string[];
    findBinary?: () => string | null;
    timeoutMs?: number;
    /** Si false, n’installe pas l’agent (seulement WebUI si python dispo). */
    installAgentIfMissing?: boolean;
  },
): Promise<{
  ok: boolean;
  binary: string | null;
  binaryPath: string | null;
  agentDir: string | null;
  webuiDir: string | null;
  detail: string;
}> {
  const log = opts?.onLog || ((l) => hostLog(ctx, "hermes-bootstrap", l));
  const report = (p: BootstrapPhase) => {
    setPhase(p);
    opts?.onPhase?.(p);
  };
  report("checking");
  lastBootstrapError = null;

  const { resolveHermesBinary } = await import("@creezio/platform-core");
  const profile = hermesInstallOsProfileDir(ctx);
  const defaultSearchDirs = [
    hermesRuntimeCacheDir(ctx),
    path.join(hermesRuntimeCacheDir(ctx), "bin"),
    path.join(profile, "AppData", "Local", "hermes", "bin"),
    path.join(profile, ".hermes", "bin"),
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
      : path.join(profile, ".hermes", "hermes-agent", "venv", "bin"),
    ...hermesAgentDirCandidates(ctx),
    path.join(ctx.userDataDir, "hermes-home", "bin"),
  ];
  const searchDirs = opts?.searchDirs || defaultSearchDirs;
  const findBinary =
    opts?.findBinary ||
    (() =>
      resolveHermesBinary({
        platform: process.platform,
        env: process.env,
        searchDirs,
        allowEnvOverride: !ctx.isPackaged,
        envPrefix: ctx.manifest.envPrefix,
        existsSync: fs.existsSync,
      }));

  let binary = findBinary();

  if (!binary && opts?.installAgentIfMissing !== false) {
    log("CLI Hermes absente — bootstrap download-on-first-run…");
    const inst = await installHermesAgent(ctx, {
      onLog: log,
      timeoutMs: opts?.timeoutMs,
    });
    if (!inst.ok) {
      return {
        ok: false,
        binary: null,
        binaryPath: null,
        agentDir: null,
        webuiDir: null,
        detail: inst.detail,
      };
    }
    binary = findBinary();
  }

  if (!binary) {
    lastBootstrapError = "CLI toujours introuvable après install";
    report("error");
    return {
      ok: false,
      binary: null,
      binaryPath: null,
      agentDir: null,
      webuiDir: null,
      detail: lastBootstrapError,
    };
  }

  const agentDir = resolveHermesAgentDir(ctx);
  const python = resolveHermesPython(agentDir);
  if (!python) {
    lastBootstrapError = "Python venv Hermes introuvable (WebUI impossible)";
    report("error");
    return {
      ok: false,
      binary,
      binaryPath: binary,
      agentDir,
      webuiDir: null,
      detail: lastBootstrapError,
    };
  }

  const webui = await ensureHermesWebuiTree(ctx, {
    onLog: log,
    pythonPath: python,
  });
  report(webui.ok ? "ready" : "error");
  return {
    ok: Boolean(binary) && webui.ok,
    binary,
    binaryPath: binary,
    agentDir,
    webuiDir: webui.dir,
    detail: webui.ok ? "Runtime Hermes + WebUI prêts" : webui.detail,
  };
}

export function __resetBootstrapStateForTests(): void {
  phase = "idle";
  lastBootstrapError = null;
}
