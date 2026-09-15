/**
 * Agrège le statut build Windows d'une marque (hook JSON + feed + process).
 * Port générique de `desktop-build-status.mjs` kit.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  resolveArtifactFileName,
  resolveManifest,
} from "@creezio/brand-config";
import { fetchFeedSnapshot } from "./fetch-feed.js";
import { parseLatestYml } from "./parse-latest-yml.js";
import {
  parseBrandArg,
  resolvePublishConfig,
} from "./resolve-publish-config.js";

const STATES = new Set([
  "idle",
  "sync",
  "building",
  "pulling",
  "publishing",
  "ok",
  "failed",
]);

function readJsonSafe(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function codeVersion(appRoot: string): string | null {
  const pkg = readJsonSafe(path.join(appRoot, "package.json"));
  return pkg?.version ? String(pkg.version) : null;
}

function listExes(
  dir: string,
  productPrefix: string,
): Array<{
  version: string;
  name: string;
  size: number;
  mtime: string;
  sha256: string | null;
  dir: string;
}> {
  if (!fs.existsSync(dir)) return [];
  const re = new RegExp(
    `^${escapeRegExp(productPrefix)}-(\\d+\\.\\d+\\.\\d+)\\.exe$`,
  );
  const out: Array<{
    version: string;
    name: string;
    size: number;
    mtime: string;
    sha256: string | null;
    dir: string;
  }> = [];
  for (const name of fs.readdirSync(dir)) {
    const m = name.match(re);
    if (!m || !m[1]) continue;
    if (m[1] === "0.1.0" && name.includes("-0.1.0.")) continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    let sha256: string | null = null;
    const shaFile = `${full}.sha256`;
    if (fs.existsSync(shaFile)) {
      try {
        sha256 = fs.readFileSync(shaFile, "utf8").trim().split(/\s+/)[0] || null;
      } catch {
        sha256 = null;
      }
    }
    out.push({
      version: m[1],
      name,
      size: st.size,
      mtime: st.mtime.toISOString(),
      sha256,
      dir,
    });
  }
  out.sort((a, b) => cmpSemverDesc(a.version, b.version));
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cmpSemverDesc(a: string, b: string): number {
  const av = a.split(".").map(Number);
  const bv = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((av[i] || 0) !== (bv[i] || 0)) return (bv[i] || 0) - (av[i] || 0);
  }
  return 0;
}

function findLatestLog(prefix: string, versionHint: string | null): string | null {
  const preferred = versionHint
    ? `/tmp/${prefix}-${versionHint}.log`
    : null;
  if (preferred && fs.existsSync(preferred)) return preferred;
  try {
    const names = fs
      .readdirSync("/tmp")
      .filter((n) => n.startsWith(prefix) && n.endsWith(".log"));
    let best: string | null = null;
    let bestM = 0;
    for (const n of names) {
      const p = path.join("/tmp", n);
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs >= bestM) {
          bestM = st.mtimeMs;
          best = p;
        }
      } catch {
        /* skip */
      }
    }
    return best;
  } catch {
    return preferred && fs.existsSync(preferred) ? preferred : null;
  }
}

function readLogTail(logPath: string | null, maxLines = 40) {
  if (!logPath || !fs.existsSync(logPath)) {
    return {
      path: logPath,
      mtime: null as string | null,
      lines: [] as string[],
      phase: null as string | null,
      stateHint: null as string | null,
      errors: [] as string[],
    };
  }
  const st = fs.statSync(logPath);
  const raw = fs.readFileSync(logPath, "utf8");
  const all = raw.split(/\r?\n/);
  const lines = all.slice(-maxLines);
  const errors = all
    .filter((l) => /ERROR:|Error:|failed|ELIFECYCLE/i.test(l))
    .slice(-12);
  const joined = lines.slice(-80).join("\n");
  let stateHint: string | null = null;
  if (/ERROR:/.test(joined) && !/Terminé — build distant/.test(joined)) {
    stateHint = "failed";
  } else if (/Publish feed|electron:publish|→ Publication/.test(joined)) {
    stateHint = /OK — feed|Terminé — build distant/.test(joined)
      ? "ok"
      : "publishing";
  } else if (/rsync artefacts|Artefacts prêts/.test(joined)) {
    stateHint = /Terminé — build distant/.test(joined) ? "ok" : "pulling";
  } else if (
    /next build|electron:server|electron:compile|electron:build:win|building\s+target=nsis|▸ build distant OK|npm ci/.test(
      joined,
    )
  ) {
    stateHint = "building";
  } else if (/rsync code|Prépare workdir|SSH BatchMode/.test(joined)) {
    stateHint = "sync";
  } else if (/Terminé — build distant/.test(joined)) {
    stateHint = "ok";
  }
  let phase: string | null = null;
  const recent = lines.slice(-40).join("\n");
  if (/Terminé — build distant/i.test(recent)) phase = "done";
  else if (/ERROR:/i.test(recent)) phase = "error";
  else if (/Publication |electron:publish|OK — feed/i.test(recent))
    phase = "publish";
  else if (/rsync artefacts|Artefacts prêts/i.test(recent))
    phase = "pull-artifacts";
  else if (/building\s+target=nsis|building block map/i.test(recent))
    phase = "nsis";
  else if (/electron:build:win|afterPack|win-unpacked/i.test(recent))
    phase = "electron-builder";
  else if (/electron:compile/i.test(recent)) phase = "electron-compile";
  else if (/electron:server/i.test(recent)) phase = "electron-server";
  else if (/next build|Creating an optimized production build/i.test(recent))
    phase = "next-build";
  else if (/npm ci|npm install/i.test(recent)) phase = "npm-ci";
  else if (/rsync code/i.test(recent)) phase = "rsync";
  return {
    path: logPath,
    mtime: st.mtime.toISOString(),
    lines,
    phase,
    stateHint,
    errors,
  };
}

function localProcesses() {
  try {
    const out = execFileSync(
      "pgrep",
      [
        "-af",
        "remote-build-win\\.sh|npm run electron:build:win|node_modules/.bin/electron-builder|electron-builder --win",
      ],
      { encoding: "utf8" },
    ).trim();
    const lines = out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter(
        (l) =>
          !/desktop-build-status|serve-build-status|electron:build-status|pgrep|snap=\$\(command cat/.test(
            l,
          ),
      );
    const pids = lines
      .map((l) => Number((l.match(/^(\d+)/) || [])[1]))
      .filter((n) => Number.isFinite(n));
    return { running: lines.length > 0, pids, lines };
  } catch {
    return { running: false, pids: [] as number[], lines: [] as string[] };
  }
}

function deriveState(input: {
  hook: Record<string, unknown> | null;
  proc: { running: boolean };
  log: { stateHint: string | null };
  codeVer: string | null;
  builtVer: string | null;
  feedVer: string | null;
}): string {
  const { hook, proc, log, codeVer, builtVer, feedVer } = input;
  if (proc.running) {
    const hs = hook?.state ? String(hook.state) : null;
    if (hs && STATES.has(hs) && hs !== "ok" && hs !== "idle") return hs;
    if (
      log.stateHint &&
      ["sync", "building", "pulling", "publishing"].includes(log.stateHint)
    ) {
      return log.stateHint;
    }
    return "building";
  }
  if (hook?.state && STATES.has(String(hook.state))) return String(hook.state);
  if (log.stateHint === "failed") return "failed";
  if (log.stateHint === "ok") return "ok";
  if (
    log.stateHint &&
    ["sync", "building", "pulling", "publishing"].includes(log.stateHint)
  ) {
    return "failed";
  }
  if (codeVer && feedVer && builtVer && codeVer === builtVer && codeVer === feedVer) {
    return "ok";
  }
  return "idle";
}

export type CollectDesktopBuildStatusOptions = {
  brandId: string;
  appRoot?: string;
  remote?: boolean;
};

export function collectDesktopBuildStatus(
  opts: CollectDesktopBuildStatusOptions,
) {
  const cfg = resolvePublishConfig({
    brandId: opts.brandId,
    kind: "client",
    appRoot: opts.appRoot,
  });
  const manifest = resolveManifest(opts.brandId, { appRoot: opts.appRoot });
  const appRoot = cfg.appRoot;
  const dist = path.join(appRoot, "dist-electron");
  const codeVer = codeVersion(appRoot);
  const localYmlPath = path.join(dist, "latest.yml");
  const localYml = fs.existsSync(localYmlPath)
    ? parseLatestYml(fs.readFileSync(localYmlPath, "utf8"))
    : null;
  // "TempoFlow-Setup-${version}.${ext}" → préfixe "TempoFlow-Setup"
  const setupPrefix = resolveArtifactFileName(manifest.client, "0.0.0").replace(
    /-0\.0\.0\.exe$/,
    "",
  );
  const exes = listExes(dist, setupPrefix);
  const builtVer = localYml?.version || (exes[0] ? exes[0].version : null);
  const hook =
    readJsonSafe(cfg.statusFile) || readJsonSafe(cfg.statusDist);
  const logPath = findLatestLog(
    cfg.remoteLogPrefix,
    (hook?.version as string) || codeVer || builtVer,
  );
  const log = readLogTail(logPath);
  const proc = localProcesses();
  const feed = fetchFeedSnapshot(opts.brandId, "client");
  const feedServer = fetchFeedSnapshot(opts.brandId, "server");

  let remote: { ok: boolean; error: string | null; lines: string[] } | null =
    null;
  if (opts.remote) {
    try {
      const res = spawnSync(
        "ssh",
        [
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=8",
          cfg.remoteBuildHost,
          `pgrep -af "electron-builder|electron:build|npm run build" || true; ls -1t ${cfg.remoteCrm}/dist-electron/*-Setup-*.exe 2>/dev/null | head -5`,
        ],
        { encoding: "utf8", timeout: 15000 },
      );
      if (res.status !== 0) {
        remote = {
          ok: false,
          error: (res.stderr || res.stdout || "ssh failed").trim().slice(0, 300),
          lines: [],
        };
      } else {
        remote = {
          ok: true,
          error: null,
          lines: (res.stdout || "")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 12),
        };
      }
    } catch (e) {
      remote = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        lines: [],
      };
    }
  }

  const state = deriveState({
    hook,
    proc,
    log,
    codeVer,
    builtVer,
    feedVer: feed.meta.version,
  });
  const phase =
    (hook?.phase as string) ||
    log.phase ||
    (state === "idle" ? "idle" : state === "ok" ? "done" : state);

  return {
    generatedAt: new Date().toISOString(),
    brandId: opts.brandId,
    codeVersion: codeVer,
    builtVersion: builtVer,
    publishedVersion: feed.meta.version || null,
    publishedServerVersion: feedServer.meta.version || null,
    aligned:
      Boolean(codeVer) &&
      codeVer === builtVer &&
      codeVer === (feed.meta.version || null),
    state,
    phase,
    message: (hook?.message as string) || null,
    hook: hook
      ? {
          version: (hook.version as string) || null,
          state: (hook.state as string) || null,
          phase: (hook.phase as string) || null,
          message: (hook.message as string) || null,
          updatedAt: (hook.updatedAt as string) || null,
          pid: (hook.pid as number) || null,
          logHint: (hook.logHint as string) || null,
          source: fs.existsSync(cfg.statusFile)
            ? cfg.statusFile
            : cfg.statusDist,
        }
      : null,
    process: {
      localRunning: proc.running,
      pids: proc.pids,
      lines: proc.lines.slice(0, 8),
    },
    remote,
    log: {
      path: log.path,
      mtime: log.mtime,
      phase: log.phase,
      lines: log.lines,
      errors: log.errors,
    },
    local: {
      distDir: dist,
      latestYml: localYml,
      exes,
    },
    feed: {
      baseUrl: cfg.feedUrl,
      latestYmlUrl: cfg.latestYmlUrl,
      ok: feed.ok,
      version: feed.meta.version,
      path: feed.meta.path,
      releaseDate: feed.meta.releaseDate,
      size: feed.meta.size,
      error: feed.error,
      downloadUrl: feed.downloadUrl,
    },
    feedServer: {
      baseUrl: feedServer.feedUrl,
      latestYmlUrl: feedServer.latestYmlUrl,
      ok: feedServer.ok,
      version: feedServer.meta.version,
      path: feedServer.meta.path,
      releaseDate: feedServer.meta.releaseDate,
      size: feedServer.meta.size,
      error: feedServer.error,
      downloadUrl: feedServer.downloadUrl,
    },
    links: {
      feedLatestYml: cfg.latestYmlUrl,
      feedExe: feed.downloadUrl,
      feedServerLatestYml: feedServer.latestYmlUrl,
      feedServerExe: feedServer.downloadUrl,
      logPath: log.path,
      statusJson: cfg.statusFile,
      statusDist: cfg.statusDist,
      rebuildCmd: `CREEZIO_BRAND=${opts.brandId} bash node_modules/@creezio/desktop-tooling/scripts/remote-build-win.sh --publish`,
      rebuildDryRun: `CREEZIO_BRAND=${opts.brandId} bash node_modules/@creezio/desktop-tooling/scripts/remote-build-win.sh --dry-run`,
      rebuildNoPublish: `CREEZIO_BRAND=${opts.brandId} bash node_modules/@creezio/desktop-tooling/scripts/remote-build-win.sh`,
      statusCmd: `CREEZIO_BRAND=${opts.brandId} node node_modules/@creezio/desktop-tooling/scripts/desktop-build-status.mjs`,
    },
  };
}

export function collectDesktopBuildStatusFromArgv(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  let brandRaw: string | undefined;
  let appRoot: string | undefined;
  for (const a of argv) {
    if (a.startsWith("--brand=")) brandRaw = a.slice("--brand=".length);
    if (a.startsWith("--app-root=")) appRoot = a.slice("--app-root=".length);
  }
  const brandId = parseBrandArg(brandRaw);
  return collectDesktopBuildStatus({
    brandId,
    appRoot,
    remote: args.has("--remote"),
  });
}
