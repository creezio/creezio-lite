/**
 * Runtime Node propriété de la marque — port brand-agnostic kit node-runtime.ts.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { envKey } from "@creezio/brand-config";
import { envForNodeScriptSpawn } from "@creezio/platform-core";
import type { HostRuntimeContext } from "./context.js";
import { hostLog, hostProductName } from "./context.js";
import { applyOsSandboxEnv } from "./sandbox/embed-sandbox.js";

export const DESKTOP_NODE_PIN = "22.22.2";
export const DESKTOP_NODE_MIN_FOR_EMBEDS = "22.22.0";

export type NodeVersionTriple = [number, number, number];

export function parseNodeVersion(raw: string): NodeVersionTriple | null {
  const m = String(raw || "")
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareNodeVersions(a: string, b: string): number {
  const pa = parseNodeVersion(a);
  const pb = parseNodeVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! - pb[i]!;
  }
  return 0;
}

export function nodeSatisfiesMin(version: string, minVersion: string): boolean {
  return compareNodeVersions(version, minVersion) >= 0;
}

export function nodeUserDir(ctx: HostRuntimeContext): string {
  const dir = path.join(ctx.userDataDir, `${ctx.manifest.brandId}-node`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function nodeUserBinary(ctx: HostRuntimeContext): string {
  return path.join(
    nodeUserDir(ctx),
    process.platform === "win32" ? "node.exe" : "node",
  );
}

export function packagedNodeBinary(ctx: HostRuntimeContext): string {
  return path.join(
    ctx.resourcesRoot,
    "node",
    process.platform === "win32" ? "node.exe" : "node",
  );
}

export function resolveDesktopNodeBinary(ctx: HostRuntimeContext): string {
  if (!ctx.isPackaged) {
    const override = (process.env[envKey(ctx.manifest, "NODE_BINARY")] || "").trim();
    if (override && fs.existsSync(override)) return override;
  }
  const userBin = nodeUserBinary(ctx);
  if (fs.existsSync(userBin)) return userBin;
  const packaged = packagedNodeBinary(ctx);
  if (fs.existsSync(packaged)) return packaged;
  return "node";
}

export function probeNodeVersion(nodeBin: string): string | null {
  try {
    const r = spawnSync(nodeBin, ["-p", "process.versions.node"], {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
    if (r.status !== 0) return null;
    const v = String(r.stdout || "").trim();
    return parseNodeVersion(v) ? v.replace(/^v/i, "") : null;
  } catch {
    return null;
  }
}

export function buildIsolatedNodeEnv(opts: {
  nodeBin: string;
  baseEnv?: NodeJS.ProcessEnv;
  sandbox?: { profileHome: string; userData: string };
}): NodeJS.ProcessEnv {
  let env: NodeJS.ProcessEnv = envForNodeScriptSpawn(
    opts.nodeBin,
    opts.baseEnv || process.env,
  );

  const resolved =
    opts.nodeBin === "node" ? process.execPath : path.resolve(opts.nodeBin);
  const nodeDir = path.dirname(resolved);
  const sep = path.delimiter;
  const prev = env.PATH || env.Path || "";
  const next =
    prev.startsWith(nodeDir + sep) || prev === nodeDir
      ? prev
      : `${nodeDir}${sep}${prev}`;
  env.PATH = next;
  if (process.platform === "win32") env.Path = next;

  if (opts.sandbox) {
    fs.mkdirSync(opts.sandbox.profileHome, { recursive: true });
    fs.mkdirSync(path.join(opts.sandbox.userData, "tmp"), { recursive: true });
    fs.mkdirSync(
      path.join(opts.sandbox.userData, "desktop-npm", "cache"),
      { recursive: true },
    );
    fs.mkdirSync(
      path.join(opts.sandbox.userData, "tempoflow-npm", "cache"),
      { recursive: true },
    );
    env = applyOsSandboxEnv({
      env,
      profileHome: opts.sandbox.profileHome,
      userData: opts.sandbox.userData,
      toolDirs: [nodeDir],
    });
  }
  return env;
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
    const req = get(url, { timeout: 180_000 }, (res) => {
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

function officialNodeBinaryUrl(
  pin: string,
  platform: NodeJS.Platform,
): string | null {
  if (platform === "win32") {
    return `https://nodejs.org/dist/v${pin}/win-x64/node.exe`;
  }
  return null;
}

export type EnsureDesktopNodeResult =
  | { ok: true; node: string; version: string; source: string }
  | { ok: false; detail: string };

export async function ensureDesktopNode(
  ctx: HostRuntimeContext,
  opts?: {
    minVersion?: string;
    pin?: string;
    platform?: NodeJS.Platform;
  },
): Promise<EnsureDesktopNodeResult> {
  const product = hostProductName(ctx);
  const log = (line: string) => hostLog(ctx, "node", line);
  const min = opts?.minVersion || DESKTOP_NODE_MIN_FOR_EMBEDS;
  const pin = opts?.pin || DESKTOP_NODE_PIN;
  const platform = opts?.platform || process.platform;

  const current = resolveDesktopNodeBinary(ctx);
  const version = probeNodeVersion(current);
  if (version && nodeSatisfiesMin(version, min)) {
    log(`Node ${product} OK v${version} (${current})`);
    return { ok: true, node: current, version, source: "resolved" };
  }

  if (version) {
    log(`Node v${version} < ${min} — mise à jour vers ${pin}…`);
  } else {
    log(`Node introuvable — installation ${pin}…`);
  }

  const url = officialNodeBinaryUrl(pin, platform);
  if (!url) {
    return {
      ok: false,
      detail: `Auto-heal Node ${pin} non supporté sur ${platform}`,
    };
  }

  const dest = nodeUserBinary(ctx);
  const cache = path.join(nodeUserDir(ctx), "downloads");
  fs.mkdirSync(cache, { recursive: true });
  const staged = path.join(
    cache,
    `node-${pin}${platform === "win32" ? ".exe" : ""}`,
  );

  try {
    if (!fs.existsSync(staged)) {
      await downloadToFile(url, staged, log);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(staged, dest);
    if (platform !== "win32") {
      try {
        fs.chmodSync(dest, 0o755);
      } catch {
        /* ignore */
      }
    }
    fs.writeFileSync(path.join(nodeUserDir(ctx), "VERSION"), `${pin}\n`, "utf8");
    const v2 = probeNodeVersion(dest);
    if (!v2 || !nodeSatisfiesMin(v2, min)) {
      return {
        ok: false,
        detail: `Node téléchargé invalide (got ${v2 || "?"}, need ≥${min})`,
      };
    }
    log(`Node v${v2} prêt (${dest})`);
    return { ok: true, node: dest, version: v2, source: "downloaded" };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: `Impossible d'obtenir Node: ${detail}` };
  }
}

/** Déplacé vers @creezio/platform-core (P1.b) — ré-exporté ici pour compat. */
export { envForNodeScriptSpawn } from "@creezio/platform-core";
