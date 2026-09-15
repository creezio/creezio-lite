/**
 * Versioning Git local par plugin — port TF gold plugin-git.ts (N1).
 * Injection marque : gitBinary / userDataDir / isPackaged / applyOsSandboxEnv / identité git.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { PLUGIN_MANIFEST_FILE } from "@creezio/platform-core";
import {
  getPluginHostBindings,
  pluginCrmKeyFileName,
  pluginGitIdentity,
  resolveApplyOsSandboxEnv,
  type PluginHostBindings,
} from "./brand-bindings.js";

const execFileAsync = promisify(execFile);

export type PluginGitCommit = {
  sha: string;
  shortSha: string;
  subject: string;
  date: string;
};

export type PluginGitStatus = {
  ok: boolean;
  available: boolean;
  head: string | null;
  shortHead: string | null;
  dirty: boolean;
  commits: number;
  error?: string;
};

function pluginGitignore(bindings: PluginHostBindings): string {
  const keyFile = pluginCrmKeyFileName(bindings);
  return `# ${bindings.productName} plugin — ne pas versionner secrets / runtime
.enabled
${keyFile}
os-home/
node_modules/
*.log
.DS_Store
`;
}

let gitBinCache: string | null | undefined;

/** Invalide le cache (tests). */
export function resetGitBinaryCache(): void {
  gitBinCache = undefined;
}

function forceEmbeddedGitEnvKey(bindings: PluginHostBindings): string {
  if (bindings.forceEmbeddedGitEnvKey) return bindings.forceEmbeddedGitEnvKey;
  return `${bindings.envPrefix}_FORCE_EMBEDDED_GIT`;
}

/**
 * Résout le binaire git — SANDBOX UNIQUEMENT (même règles TF gold).
 */
export async function resolveGitBinary(): Promise<string | null> {
  if (gitBinCache !== undefined) return gitBinCache;
  const bindings = getPluginHostBindings();

  const embedded = bindings.gitBinary();
  if (embedded) {
    if (
      process.platform === "win32" ||
      process.env[forceEmbeddedGitEnvKey(bindings)] === "1" ||
      !embedded.endsWith(".exe")
    ) {
      gitBinCache = embedded;
      return gitBinCache;
    }
  }

  if (bindings.isPackaged()) {
    gitBinCache = null;
    return gitBinCache;
  }

  const devCandidates =
    process.platform === "win32"
      ? []
      : ["/usr/bin/git", "/usr/local/bin/git", "/bin/git"];
  gitBinCache = devCandidates.find((p) => fs.existsSync(p)) || null;
  return gitBinCache;
}

function mingitProcessEnv(bin: string): NodeJS.ProcessEnv {
  const bindings = getPluginHostBindings();
  const identity = pluginGitIdentity(bindings);
  let env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  };
  const norm = bin.replace(/\\/g, "/");
  const toolDirs: string[] = [path.dirname(bin)];
  if (norm.endsWith("/cmd/git.exe") || norm.endsWith("/cmd/git")) {
    const root = path.dirname(path.dirname(bin));
    toolDirs.push(
      ...[
        path.join(root, "cmd"),
        path.join(root, "mingw64", "bin"),
        path.join(root, "usr", "bin"),
      ].filter((p) => fs.existsSync(p)),
    );
  }
  try {
    const apply = resolveApplyOsSandboxEnv(bindings);
    env = apply({
      env,
      profileHome: path.join(bindings.userDataDir(), "plugins", ".git-home"),
      userData: bindings.userDataDir(),
      toolDirs,
    });
  } catch {
    /* hors app Electron (tests) : env non confiné acceptable */
  }
  return env;
}

async function git(
  cwd: string,
  args: string[],
  opts?: { allowFail?: boolean },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const bin = await resolveGitBinary();
  if (!bin) {
    return { code: 127, stdout: "", stderr: "git introuvable" };
  }
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd,
      timeout: 30_000,
      windowsHide: true,
      env: mingitProcessEnv(bin),
      maxBuffer: 2 * 1024 * 1024,
    });
    return {
      code: 0,
      stdout: String(stdout || ""),
      stderr: String(stderr || ""),
    };
  } catch (e) {
    const err = e as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (opts?.allowFail) {
      return {
        code: typeof err.code === "number" ? err.code : 1,
        stdout: String(err.stdout || ""),
        stderr: String(err.stderr || err.message || ""),
      };
    }
    throw new Error(
      String(err.stderr || err.message || "git failed").trim() || "git failed",
    );
  }
}

export function isPluginGitRepo(pluginDir: string): boolean {
  return fs.existsSync(path.join(pluginDir, ".git"));
}

function ensureGitignore(pluginDir: string): void {
  const bindings = getPluginHostBindings();
  const p = path.join(pluginDir, ".gitignore");
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, pluginGitignore(bindings), "utf8");
  }
}

/** Bump patch du manifest.version (0.1.0 → 0.1.1). */
export function bumpPluginManifestPatch(pluginDir: string): string | null {
  const mfPath = path.join(pluginDir, PLUGIN_MANIFEST_FILE);
  try {
    const raw = JSON.parse(fs.readFileSync(mfPath, "utf8")) as {
      version?: string;
    };
    const cur = String(raw.version || "0.1.0").trim();
    const m = cur.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
    let next: string;
    if (m) {
      next = `${m[1]}.${m[2]}.${Number(m[3]) + 1}${m[4] || ""}`;
    } else {
      next = `${cur}.1`;
    }
    raw.version = next;
    fs.writeFileSync(mfPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    return next;
  } catch {
    return null;
  }
}

export async function ensurePluginGitRepo(
  pluginDir: string,
  opts?: { message?: string },
): Promise<{ ok: boolean; detail: string }> {
  const bindings = getPluginHostBindings();
  const identity = pluginGitIdentity(bindings);
  const bin = await resolveGitBinary();
  if (!bin) {
    return { ok: false, detail: "git introuvable sur le PATH" };
  }
  ensureGitignore(pluginDir);
  if (!isPluginGitRepo(pluginDir)) {
    await git(pluginDir, ["init", "-b", "main"]);
    await git(pluginDir, ["config", "user.name", identity.name]);
    await git(pluginDir, ["config", "user.email", identity.email]);
  }
  await git(pluginDir, ["add", "-A"]);
  const st = await git(pluginDir, ["status", "--porcelain"], { allowFail: true });
  if (!st.stdout.trim()) {
    const log = await git(pluginDir, ["rev-parse", "HEAD"], { allowFail: true });
    if (log.code !== 0) {
      await git(pluginDir, [
        "commit",
        "--allow-empty",
        "-m",
        opts?.message || "chore: init plugin",
      ]);
      return { ok: true, detail: "init + commit vide" };
    }
    return { ok: true, detail: "déjà à jour" };
  }
  await git(pluginDir, [
    "commit",
    "-m",
    opts?.message || "chore: init plugin",
  ]);
  return { ok: true, detail: "init + commit" };
}

export async function commitPluginChanges(
  pluginDir: string,
  message: string,
  opts?: { bumpVersion?: boolean },
): Promise<{
  ok: boolean;
  sha: string | null;
  version: string | null;
  detail: string;
}> {
  const bin = await resolveGitBinary();
  if (!bin) {
    return {
      ok: false,
      sha: null,
      version: null,
      detail: "git introuvable",
    };
  }
  ensureGitignore(pluginDir);
  if (!isPluginGitRepo(pluginDir)) {
    await ensurePluginGitRepo(pluginDir, { message: "chore: init plugin" });
  }
  let version: string | null = null;
  if (opts?.bumpVersion !== false) {
    version = bumpPluginManifestPatch(pluginDir);
  }
  await git(pluginDir, ["add", "-A"]);
  const st = await git(pluginDir, ["status", "--porcelain"], { allowFail: true });
  if (!st.stdout.trim()) {
    const head = await git(pluginDir, ["rev-parse", "HEAD"], { allowFail: true });
    return {
      ok: true,
      sha: head.code === 0 ? head.stdout.trim() : null,
      version,
      detail: "aucun changement",
    };
  }
  const msg = String(message || "update").trim() || "update";
  const verSuffix = version ? ` (v${version})` : "";
  await git(pluginDir, ["commit", "-m", `${msg}${verSuffix}`]);
  const head = await git(pluginDir, ["rev-parse", "HEAD"]);
  return {
    ok: true,
    sha: head.stdout.trim(),
    version,
    detail: "committed",
  };
}

export async function listPluginVersions(
  pluginDir: string,
  limit = 40,
): Promise<{
  ok: boolean;
  available: boolean;
  commits: PluginGitCommit[];
  head: string | null;
  error?: string;
}> {
  const bin = await resolveGitBinary();
  if (!bin) {
    return {
      ok: false,
      available: false,
      commits: [],
      head: null,
      error: "git introuvable",
    };
  }
  if (!isPluginGitRepo(pluginDir)) {
    return { ok: true, available: true, commits: [], head: null };
  }
  const headR = await git(pluginDir, ["rev-parse", "HEAD"], { allowFail: true });
  const head = headR.code === 0 ? headR.stdout.trim() : null;
  const log = await git(
    pluginDir,
    [
      "log",
      `-n${Math.min(100, Math.max(1, limit))}`,
      "--format=%H%x09%h%x09%cI%x09%s",
    ],
    { allowFail: true },
  );
  if (log.code !== 0) {
    return {
      ok: false,
      available: true,
      commits: [],
      head,
      error: log.stderr || "git log failed",
    };
  }
  const commits: PluginGitCommit[] = [];
  for (const line of log.stdout.split("\n")) {
    if (!line.trim()) continue;
    const [sha, shortSha, date, ...rest] = line.split("\t");
    if (!sha || !shortSha || !date) continue;
    commits.push({
      sha,
      shortSha,
      date,
      subject: rest.join("\t"),
    });
  }
  return { ok: true, available: true, commits, head };
}

export async function restorePluginVersion(
  pluginDir: string,
  ref: string,
): Promise<{ ok: boolean; sha: string | null; detail: string }> {
  const bin = await resolveGitBinary();
  if (!bin) {
    return { ok: false, sha: null, detail: "git introuvable" };
  }
  if (!isPluginGitRepo(pluginDir)) {
    return { ok: false, sha: null, detail: "pas de dépôt git" };
  }
  const target = String(ref || "").trim();
  if (!/^[a-zA-Z0-9_./~^-]+$/.test(target) || target.includes("..")) {
    return { ok: false, sha: null, detail: "ref invalide" };
  }
  const rev = await git(pluginDir, ["rev-parse", "--verify", target], {
    allowFail: true,
  });
  if (rev.code !== 0) {
    return { ok: false, sha: null, detail: `commit inconnu: ${target}` };
  }
  const sha = rev.stdout.trim();
  await git(pluginDir, ["checkout", sha, "--", "."]);
  await git(pluginDir, ["clean", "-fd"], { allowFail: true });
  await git(pluginDir, ["add", "-A"]);
  const st = await git(pluginDir, ["status", "--porcelain"], { allowFail: true });
  if (st.stdout.trim()) {
    await git(pluginDir, [
      "commit",
      "-m",
      `revert: restore ${sha.slice(0, 7)}`,
    ]);
  }
  const head = await git(pluginDir, ["rev-parse", "HEAD"]);
  return {
    ok: true,
    sha: head.stdout.trim(),
    detail: `restauré depuis ${sha.slice(0, 7)}`,
  };
}

export async function getPluginGitStatus(
  pluginDir: string,
): Promise<PluginGitStatus> {
  const bin = await resolveGitBinary();
  if (!bin) {
    return {
      ok: false,
      available: false,
      head: null,
      shortHead: null,
      dirty: false,
      commits: 0,
      error: "git introuvable",
    };
  }
  if (!isPluginGitRepo(pluginDir)) {
    return {
      ok: true,
      available: true,
      head: null,
      shortHead: null,
      dirty: false,
      commits: 0,
    };
  }
  const headR = await git(pluginDir, ["rev-parse", "HEAD"], { allowFail: true });
  const head = headR.code === 0 ? headR.stdout.trim() : null;
  const short = head ? head.slice(0, 7) : null;
  const st = await git(pluginDir, ["status", "--porcelain"], { allowFail: true });
  const countR = await git(pluginDir, ["rev-list", "--count", "HEAD"], {
    allowFail: true,
  });
  const commits =
    countR.code === 0 ? Number(countR.stdout.trim()) || 0 : 0;
  return {
    ok: true,
    available: true,
    head,
    shortHead: short,
    dirty: Boolean(st.stdout.trim()),
    commits,
  };
}
