/**
 * Bootstrap runtime n8n — download-on-first-run via npm (Node embarqué).
 *
 * L’arbre npm n’est PAS dans l’exe (taille). Au premier mode embedded sans
 * entry, on `npm install n8n@pin` sous userData/n8n-runtime.
 * Chemins injectés via HostRuntimeContext (SoT kit — jumeau marque interdit).
 */

import fs from "node:fs";
import path from "node:path";
import {
  cleanupN8nInstallArtifacts,
  diskSpacePreflightMessage,
  formatN8nDiskSpaceError,
  getFreeDiskBytes,
  isDiskSpaceError,
  isNodeSpawnableN8nEntry,
  n8nEntryCandidates,
} from "@creezio/platform-core";
import type { HostRuntimeContext } from "../context.js";
import { hostLog, hostProductName } from "../context.js";
import { kitOsVendorDir } from "@creezio/platform-core";
import { runNpmCli } from "../npm-cli.js";

export type N8nBootstrapPhase =
  | "idle"
  | "checking"
  | "installing"
  | "ready"
  | "error";

export type N8nRuntimeManifest = {
  n8nPin: string;
  decision: string;
  package: {
    name: string;
    version: string;
    installArgs: string[];
  };
  engines?: { node?: string };
  notes?: string;
};

let phase: N8nBootstrapPhase = "idle";
let lastBootstrapError: string | null = null;

export function getN8nBootstrapPhase(): N8nBootstrapPhase {
  return phase;
}

export function getN8nBootstrapError(): string | null {
  return lastBootstrapError;
}

function setPhase(p: N8nBootstrapPhase): void {
  phase = p;
}

export function n8nVendorDir(ctx: HostRuntimeContext): string {
  // Marque d’abord (packaged), sinon kit OS Creezio — jamais à inventer dans la marque.
  const candidates = [
    path.join(ctx.resourcesRoot, "vendor", "n8n"),
    path.join(ctx.resourcesRoot, "resources", "vendor", "n8n"),
    kitOsVendorDir("n8n"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(path.join(p, "runtime-manifest.json"))) return p;
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0]!;
}

export function loadN8nRuntimeManifest(
  ctx: HostRuntimeContext,
): N8nRuntimeManifest {
  const candidates = [
    path.join(n8nVendorDir(ctx), "runtime-manifest.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8")) as N8nRuntimeManifest;
    }
  }
  throw new Error("vendor/n8n/runtime-manifest.json introuvable");
}

export function n8nRuntimeCacheDir(ctx: HostRuntimeContext): string {
  const dir = path.join(ctx.userDataDir, "n8n-runtime");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function n8nPackageJsonPath(
  ctx: HostRuntimeContext,
  runtimeDir?: string,
): string {
  return path.join(runtimeDir || n8nRuntimeCacheDir(ctx), "package.json");
}

export function n8nEntryPath(
  ctx: HostRuntimeContext,
  runtimeDir?: string,
): string | null {
  const root = runtimeDir || n8nRuntimeCacheDir(ctx);
  // .js d’abord — le bin sans extension peut être un shim non exécutable via node.
  for (const c of n8nEntryCandidates(root, process.platform)) {
    if (
      isNodeSpawnableN8nEntry(c, {
        existsSync: fs.existsSync,
        readFileSync: (p, enc) => fs.readFileSync(p, enc),
      })
    ) {
      return c;
    }
  }
  return null;
}

function failDiskSpace(
  ctx: HostRuntimeContext,
  runtimeDir: string,
  detail: string,
  log: (line: string) => void,
): {
  ok: false;
  detail: string;
  entry: null;
  entryPath: null;
  runtimeDir: string;
} {
  const cleaned = cleanupN8nInstallArtifacts(ctx.userDataDir, {
    npmCacheSegment: ctx.npmUserDataSegment || "desktop-npm",
  });
  if (cleaned.length) {
    log(`nettoyage espace disque : ${cleaned.length} cible(s)`);
  }
  const freeBytes = getFreeDiskBytes(runtimeDir);
  const friendly = formatN8nDiskSpaceError(ctx.userDataDir, {
    freeBytes,
    cleaned,
    productName: hostProductName(ctx),
  });
  lastBootstrapError = friendly;
  setPhase("error");
  log(detail);
  return {
    ok: false,
    detail: friendly,
    entry: null,
    entryPath: null,
    runtimeDir,
  };
}

/**
 * Installe n8n@pin sous userData si absent.
 */
export async function ensureN8nRuntime(
  ctx: HostRuntimeContext,
  opts?: { onLog?: (line: string) => void; force?: boolean },
): Promise<{
  ok: boolean;
  detail: string;
  entry: string | null;
  entryPath: string | null;
  runtimeDir: string;
}> {
  const log = opts?.onLog || ((l) => hostLog(ctx, "n8n-bootstrap", l));
  setPhase("checking");
  lastBootstrapError = null;
  const runtimeDir = n8nRuntimeCacheDir(ctx);
  const existing = n8nEntryPath(ctx, runtimeDir);
  if (existing && !opts?.force) {
    setPhase("ready");
    return {
      ok: true,
      detail: `Runtime déjà présent (${existing})`,
      entry: existing,
      entryPath: existing,
      runtimeDir,
    };
  }

  let manifest: N8nRuntimeManifest;
  try {
    manifest = loadN8nRuntimeManifest(ctx);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    lastBootstrapError = detail;
    setPhase("error");
    return {
      ok: false,
      detail,
      entry: null,
      entryPath: null,
      runtimeDir,
    };
  }

  setPhase("installing");
  log(`npm install n8n@${manifest.n8nPin} → ${runtimeDir}`);

  const preflight = diskSpacePreflightMessage(
    ctx.userDataDir,
    getFreeDiskBytes(runtimeDir),
  );
  if (preflight) {
    return failDiskSpace(
      ctx,
      runtimeDir,
      "pré-vol espace disque insuffisant",
      log,
    );
  }

  const pkgPath = n8nPackageJsonPath(ctx, runtimeDir);
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(
      pkgPath,
      `${JSON.stringify(
        {
          name: "desktop-n8n-runtime",
          private: true,
          version: "0.0.0",
          description:
            "Runtime n8n téléchargé par le desktop — ne pas committer",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  const pin = `${manifest.package.name}@${manifest.package.version || manifest.n8nPin}`;
  const installArgs = manifest.package.installArgs?.length
    ? manifest.package.installArgs
    : ["install", "--omit=dev", "--no-fund", "--no-audit", pin];

  // Si installArgs du manifest ne commence pas par "install", préfixer.
  const npmArgs =
    installArgs[0] === "install" ? installArgs : ["install", ...installArgs];
  // Garantir le pin si le manifest ne l’a pas mis dans installArgs.
  if (!npmArgs.some((a) => a.includes("n8n@"))) {
    npmArgs.push(pin);
  }

  try {
    // Toujours node + npm-cli.js (Node embarqué) — jamais npm du PATH Windows.
    const result = await runNpmCli(ctx, npmArgs, {
      cwd: runtimeDir,
      onLog: log,
      timeoutMs: 30 * 60 * 1000,
      env: {
        ...process.env,
        npm_config_fund: "false",
        npm_config_audit: "false",
        NODE_ENV: "production",
      },
    });

    if (result.code !== 0) {
      const raw = `${result.stderr || ""}\n${result.stdout || ""}`.trim();
      if (isDiskSpaceError({ code: result.code, text: raw })) {
        return failDiskSpace(
          ctx,
          runtimeDir,
          `npm install échoué (code ${result.code}): ${raw.slice(-400)}`,
          log,
        );
      }
      const detail = `npm install échoué (code ${result.code}): ${raw.slice(-400)}`;
      lastBootstrapError = detail;
      setPhase("error");
      return {
        ok: false,
        detail,
        entry: null,
        entryPath: null,
        runtimeDir,
      };
    }

    const entry = n8nEntryPath(ctx, runtimeDir);
    if (!entry) {
      const detail =
        "npm install OK mais entry n8n introuvable sous node_modules/n8n/bin";
      lastBootstrapError = detail;
      setPhase("error");
      return {
        ok: false,
        detail,
        entry: null,
        entryPath: null,
        runtimeDir,
      };
    }

    setPhase("ready");
    log(`ready ${entry}`);
    return {
      ok: true,
      detail: `n8n@${manifest.n8nPin} installé`,
      entry,
      entryPath: entry,
      runtimeDir,
    };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    if (isDiskSpaceError({ text: raw })) {
      return failDiskSpace(ctx, runtimeDir, raw, log);
    }
    lastBootstrapError = raw;
    setPhase("error");
    return {
      ok: false,
      detail: raw,
      entry: null,
      entryPath: null,
      runtimeDir,
    };
  }
}

export function __resetN8nBootstrapStateForTests(): void {
  phase = "idle";
  lastBootstrapError = null;
}
