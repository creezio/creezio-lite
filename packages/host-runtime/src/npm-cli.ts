/**
 * CLI npm sans PATH Windows — port brand-agnostic kit npm-cli.ts.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import type { HostRuntimeContext } from "./context.js";
import { hostLog } from "./context.js";
import {
  buildIsolatedNodeEnv,
  ensureDesktopNode,
  resolveDesktopNodeBinary,
} from "./node-runtime.js";
import { resolveSystemBinary } from "./sandbox/os-sandbox.js";

export const DESKTOP_NPM_PIN = "10.9.2";

export type EnsureNpmCliResult =
  | { ok: true; node: string; npmCli: string; source: string }
  | { ok: false; detail: string };

export function npmUserDataRoot(ctx: HostRuntimeContext): string {
  const segment =
    ctx.npmUserDataSegment ||
    `${ctx.manifest.brandId}-npm` ||
    "desktop-npm";
  // Dual-path legacy : tempoflow-npm / desktop-npm
  for (const cand of [
    segment,
    `${ctx.manifest.brandId}-npm`,
    "tempoflow-npm",
    "desktop-npm",
  ]) {
    const dir = path.join(ctx.userDataDir, cand);
    if (fs.existsSync(path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"))) {
      return dir;
    }
  }
  const dir = path.join(ctx.userDataDir, segment);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function npmCliCandidates(opts: {
  ctx: HostRuntimeContext;
  nodeBin?: string;
  platform?: NodeJS.Platform;
}): string[] {
  const node = opts.nodeBin || resolveDesktopNodeBinary(opts.ctx);
  const dir = path.dirname(
    path.resolve(node === "node" ? process.execPath : node),
  );
  const platform = opts.platform || process.platform;
  const ud = npmUserDataRoot(opts.ctx);
  const list: string[] = [
    path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(ud, "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  if (platform !== "win32" && !opts.ctx.isPackaged) {
    list.push(
      "/usr/lib/node_modules/npm/bin/npm-cli.js",
      "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
    );
  }
  return list;
}

export function resolveNpmCliPath(opts: {
  ctx: HostRuntimeContext;
  nodeBin?: string;
  platform?: NodeJS.Platform;
  existsSync?: (p: string) => boolean;
}): string | null {
  const exists = opts.existsSync || fs.existsSync;
  for (const p of npmCliCandidates(opts)) {
    if (exists(p)) return p;
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
        reject(new Error(`HTTP ${res.statusCode}`));
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
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("download timeout"));
    });
  });
}

export async function ensureNpmCli(
  ctx: HostRuntimeContext,
  opts?: { pin?: string },
): Promise<EnsureNpmCliResult> {
  const log = (line: string) => hostLog(ctx, "npm", line);
  const nodeRes = await ensureDesktopNode(ctx);
  if (!nodeRes.ok) return { ok: false, detail: nodeRes.detail };
  const existing = resolveNpmCliPath({ ctx, nodeBin: nodeRes.node });
  if (existing) {
    return {
      ok: true,
      node: nodeRes.node,
      npmCli: existing,
      source: "resolved",
    };
  }
  const pin = opts?.pin || DESKTOP_NPM_PIN;
  const ud = npmUserDataRoot(ctx);
  const tgz = path.join(ud, "downloads", `npm-${pin}.tgz`);
  const url = `https://registry.npmjs.org/npm/-/npm-${pin}.tgz`;
  try {
    if (!fs.existsSync(tgz)) {
      await downloadToFile(url, tgz, log);
    }
    const extractDir = path.join(ud, "extract");
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    const tarBin = resolveSystemBinary("tar") || "tar";
    await new Promise<void>((resolve, reject) => {
      const child = spawn(tarBin, ["-xzf", tgz, "-C", extractDir], {
        windowsHide: true,
      });
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`tar exit ${code}`)),
      );
    });
    const pkg = path.join(extractDir, "package");
    const dest = path.join(ud, "node_modules", "npm");
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(pkg, dest);
    const cli = path.join(dest, "bin", "npm-cli.js");
    if (!fs.existsSync(cli)) {
      return { ok: false, detail: "npm-cli.js absent après extract" };
    }
    log(`npm ${pin} prêt (${cli})`);
    return { ok: true, node: nodeRes.node, npmCli: cli, source: "downloaded" };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function runNpmCli(
  ctx: HostRuntimeContext,
  args: string[],
  opts?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    onLog?: (line: string) => void;
    /** Timeout kill (ex. bootstrap n8n 30 min). */
    timeoutMs?: number;
  },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const ensured = await ensureNpmCli(ctx);
  if (!ensured.ok) {
    throw new Error(ensured.detail);
  }
  const env = buildIsolatedNodeEnv({
    nodeBin: ensured.node,
    baseEnv: opts?.env,
    sandbox: {
      profileHome: path.join(ctx.userDataDir, "npm-home"),
      userData: ctx.userDataDir,
    },
  });
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(
      ensured.node,
      [ensured.npmCli, ...args],
      {
        cwd: opts?.cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    const onLog = opts?.onLog || ((l) => hostLog(ctx, "npm", l));
    child.stdout?.on("data", (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      s.split("\n")
        .filter(Boolean)
        .forEach((l) => onLog(l));
    });
    child.stderr?.on("data", (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      s.split("\n")
        .filter(Boolean)
        .forEach((l) => onLog(`stderr: ${l}`));
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (opts?.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        reject(new Error(`timeout npm (${opts.timeoutMs}ms)`));
      }, opts.timeoutMs);
    }
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
