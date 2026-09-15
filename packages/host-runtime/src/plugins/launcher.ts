/**
 * Spawn / stop des plugins (sidecars Node) — port TF gold plugin-launcher.ts (N1).
 * Env brandés via `${envPrefix}_*` (+ aliases legacy TF2_*).
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  pluginN8nWebhookUrl,
  pluginSiteId,
  writePluginRuntimeState,
  type PluginRuntimeEntry,
} from "@creezio/platform-core";
import {
  assignPluginEnv,
  getPluginHostBindings,
  resolveBuildIsolatedNodeEnv,
} from "./brand-bindings.js";
import { ensurePluginCrmApiKey, readPluginCrmApiKey } from "./crm-key.js";
import {
  commitPluginChanges,
  ensurePluginGitRepo,
  getPluginGitStatus,
  listPluginVersions,
  restorePluginVersion,
  type PluginGitCommit,
  type PluginGitStatus,
} from "./git.js";
import {
  discoverPlugins,
  hasPluginPermission,
  pluginsRootDir,
  scaffoldPlugin,
  setPluginEnabled,
  type DiscoveredPlugin,
  type PluginManifest,
} from "./runtime.js";

export type RunningPlugin = {
  id: string;
  manifest: PluginManifest;
  port: number | null;
  child: ChildProcess;
  stop: () => void;
};

type PluginState = {
  running: Map<string, RunningPlugin>;
  logs: string[];
  lastError: string | null;
  crmPort: number | null;
};

const state: PluginState = {
  running: new Map(),
  logs: [],
  lastError: null,
  crmPort: null,
};

const LOG_MAX = 120;

function pushLog(line: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  state.logs.push(`[${ts}] ${line}`);
  if (state.logs.length > LOG_MAX) state.logs.shift();
}

function syncRuntimeState(): void {
  const entries: PluginRuntimeEntry[] = [];
  for (const p of discoverPlugins()) {
    if (!p.enabled || p.error) continue;
    const run = state.running.get(p.manifest.id);
    entries.push({
      id: p.manifest.id,
      port: run?.port ?? p.manifest.port ?? null,
      hooks: p.manifest.hooks || [],
      permissions: p.manifest.permissions || [],
      panel: hasPluginPermission(p.manifest, "ui:panel"),
    });
  }
  try {
    writePluginRuntimeState(pluginsRootDir(), entries);
  } catch {
    /* non bloquant */
  }
}

export function setPluginsCrmPort(port: number | null): void {
  state.crmPort = port;
}

export function getPluginsCrmPort(): number | null {
  return state.crmPort;
}

export function listPlugins(): DiscoveredPlugin[] {
  return discoverPlugins();
}

export function getPluginLogs(): string[] {
  return state.logs.slice(-80);
}

export function getRunningPlugins(): Array<{
  id: string;
  port: number | null;
  version: string;
  siteId: number;
  panelUrl: string | null;
  n8nWebhookUrl: string | null;
}> {
  return [...state.running.values()].map((r) => {
    const port = r.port;
    const panel =
      hasPluginPermission(r.manifest, "ui:panel") && port
        ? `http://127.0.0.1:${port}${r.manifest.panel?.path || "/"}`
        : null;
    return {
      id: r.id,
      port,
      version: r.manifest.version,
      siteId: pluginSiteId(r.id),
      panelUrl: panel,
      n8nWebhookUrl: port ? pluginN8nWebhookUrl(port) : null,
    };
  });
}

export async function startEnabledPlugins(opts?: {
  onLog?: (line: string) => void;
}): Promise<{ started: string[]; errors: string[] }> {
  const bindings = getPluginHostBindings();
  const log = (line: string) => {
    pushLog(line);
    opts?.onLog?.(line);
  };
  const started: string[] = [];
  const errors: string[] = [];
  const nodeReady = await bindings.ensureDesktopNode({
    minVersion: bindings.nodeMinForEmbeds,
    onLog: log,
  });
  if (!nodeReady.ok) {
    return {
      started,
      errors: [nodeReady.detail || `Node ${bindings.productName} introuvable`],
    };
  }

  for (const p of discoverPlugins()) {
    if (!p.enabled || p.error) continue;
    if (state.running.has(p.manifest.id)) {
      started.push(p.manifest.id);
      continue;
    }
    try {
      const running = await spawnOne(p, nodeReady.node, log);
      state.running.set(p.manifest.id, running);
      started.push(p.manifest.id);
      log(`plugin start ${p.manifest.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${p.manifest.id}: ${msg}`);
      log(`plugin error ${p.manifest.id}: ${msg}`);
    }
  }
  syncRuntimeState();
  return { started, errors };
}

async function spawnOne(
  p: DiscoveredPlugin,
  nodeBin: string,
  log: (l: string) => void,
): Promise<RunningPlugin> {
  const bindings = getPluginHostBindings();
  const entry = path.join(p.dir, p.manifest.main);
  const crmKey = await ensurePluginCrmApiKey({
    pluginId: p.manifest.id,
    pluginDir: p.dir,
    permissions: p.manifest.permissions || [],
    log,
  });

  const baseEnv: Record<string, string | undefined> = {
    ...process.env,
  };
  assignPluginEnv(baseEnv, bindings, "PLUGIN_ID", p.manifest.id);
  assignPluginEnv(
    baseEnv,
    bindings,
    "PLUGIN_PORT",
    p.manifest.port ? String(p.manifest.port) : "0",
  );

  if (
    state.crmPort &&
    crmKey &&
    (hasPluginPermission(p.manifest, "crm:read") ||
      hasPluginPermission(p.manifest, "crm:write"))
  ) {
    assignPluginEnv(
      baseEnv,
      bindings,
      "API_URL",
      `http://127.0.0.1:${state.crmPort}`,
    );
    assignPluginEnv(baseEnv, bindings, "API_KEY", crmKey.apiKey);
    assignPluginEnv(baseEnv, bindings, "API_SCOPES", crmKey.scopes);
  }

  if (
    hasPluginPermission(p.manifest, "n8n:read") ||
    hasPluginPermission(p.manifest, "n8n:write")
  ) {
    const n8n = bindings.getN8nBridgeEnv({
      homeDir: bindings.n8nHomeDir(),
      localUiUrl: `http://127.0.0.1:${bindings.n8nDesktopPort}`,
    });
    Object.assign(baseEnv, n8n);
  }

  if (hasPluginPermission(p.manifest, "llm:use")) {
    const llm = bindings.getLlmKeys();
    if (llm.openai) baseEnv.OPENAI_API_KEY = llm.openai;
    if (llm.anthropic) baseEnv.ANTHROPIC_API_KEY = llm.anthropic;
  } else {
    delete baseEnv.OPENAI_API_KEY;
    delete baseEnv.ANTHROPIC_API_KEY;
  }

  const buildEnv = resolveBuildIsolatedNodeEnv(bindings);
  const env = buildEnv({
    nodeBin,
    baseEnv,
    sandbox: {
      profileHome: path.join(p.dir, "os-home"),
      userData: bindings.userDataDir(),
    },
  });

  let detectedPort: number | null = p.manifest.port ?? null;
  const child = spawn(nodeBin, [entry], {
    cwd: p.dir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (!line) return;
    log(`${p.manifest.id}: ${line}`);
    try {
      const j = JSON.parse(line) as { event?: string; port?: number };
      if (j.event === "ready" && typeof j.port === "number") {
        detectedPort = j.port;
        const cur = state.running.get(p.manifest.id);
        // Ne maj que si c'est encore CE process (évite course au restart).
        if (cur?.child === child) {
          cur.port = j.port;
          syncRuntimeState();
        }
      }
    } catch {
      /* plain log */
    }
  });
  child.stderr?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line) log(`${p.manifest.id} stderr: ${line}`);
  });
  child.on("exit", (code) => {
    log(`${p.manifest.id}: exit ${code}`);
    // Critique : ne pas effacer un process plus récent après kill+restart.
    const cur = state.running.get(p.manifest.id);
    if (cur?.child === child) {
      state.running.delete(p.manifest.id);
      syncRuntimeState();
    }
  });

  return {
    id: p.manifest.id,
    manifest: p.manifest,
    port: detectedPort,
    child,
    stop: () => {
      try {
        child.kill();
      } catch {
        /* ok */
      }
    },
  };
}

export function stopAllPlugins(): void {
  for (const r of state.running.values()) {
    r.stop();
  }
  state.running.clear();
  syncRuntimeState();
}

export function enablePlugin(
  id: string,
  enabled: boolean,
): DiscoveredPlugin | null {
  const p = discoverPlugins().find((x) => x.manifest.id === id);
  if (!p || p.error) return null;
  setPluginEnabled(p.dir, enabled);
  if (!enabled) {
    const run = state.running.get(id);
    if (run) {
      run.stop();
      state.running.delete(id);
    }
  }
  syncRuntimeState();
  return discoverPlugins().find((x) => x.manifest.id === id) || null;
}

export function createPluginScaffold(opts: {
  id: string;
  name?: string;
  description?: string;
}): { ok: true; plugin: DiscoveredPlugin } | { ok: false; error: string } {
  try {
    scaffoldPlugin({ ...opts, source: "hermes" });
    const p = discoverPlugins().find((x) => x.manifest.id === opts.id);
    if (!p) return { ok: false, error: "scaffold OK mais découverte échouée" };
    return { ok: true, plugin: p };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function createPluginScaffoldWithGit(opts: {
  id: string;
  name?: string;
  description?: string;
}): Promise<
  | { ok: true; plugin: DiscoveredPlugin; git: { detail: string } }
  | { ok: false; error: string }
> {
  const r = createPluginScaffold(opts);
  if (!r.ok) return r;
  const git = await ensurePluginGitRepo(r.plugin.dir, {
    message: `feat: scaffold ${opts.id}`,
  });
  return { ok: true, plugin: r.plugin, git: { detail: git.detail } };
}

export function deletePlugin(
  id: string,
): { ok: true; deleted: string } | { ok: false; error: string } {
  const p = discoverPlugins().find((x) => x.manifest.id === id);
  if (!p) return { ok: false, error: `plugin inconnu: ${id}` };
  const run = state.running.get(id);
  if (run) {
    run.stop();
    state.running.delete(id);
  }
  try {
    readPluginCrmApiKey(p.dir);
  } catch {
    /* ok */
  }
  try {
    fs.rmSync(p.dir, { recursive: true, force: true });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  if (fs.existsSync(p.dir)) {
    return { ok: false, error: "suppression incomplète (dossier encore présent)" };
  }
  syncRuntimeState();
  return { ok: true, deleted: id };
}

const MAX_PLUGIN_FILE_BYTES = 512 * 1024;
const MAX_PLUGIN_FILES = 32;

export function writePluginFiles(
  id: string,
  files: Record<string, string>,
): { ok: true; written: string[] } | { ok: false; error: string } {
  const p = discoverPlugins().find((x) => x.manifest.id === id);
  if (!p || p.error) return { ok: false, error: `plugin inconnu: ${id}` };
  const entries = Object.entries(files || {});
  if (!entries.length) return { ok: false, error: "files vide" };
  if (entries.length > MAX_PLUGIN_FILES) {
    return { ok: false, error: `trop de fichiers (max ${MAX_PLUGIN_FILES})` };
  }
  const written: string[] = [];
  for (const [relRaw, content] of entries) {
    const rel = String(relRaw || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
    if (!rel || rel.includes("..") || path.isAbsolute(rel)) {
      return { ok: false, error: `chemin invalide: ${relRaw}` };
    }
    if (rel === ".enabled" || /(^|\/)\.enabled$/.test(rel)) {
      return { ok: false, error: "ne pas écrire .enabled via files" };
    }
    if (rel === ".git" || rel.startsWith(".git/")) {
      return { ok: false, error: "ne pas écrire dans .git" };
    }
    const body = String(content ?? "");
    if (Buffer.byteLength(body, "utf8") > MAX_PLUGIN_FILE_BYTES) {
      return { ok: false, error: `fichier trop gros: ${rel}` };
    }
    const dest = path.join(p.dir, rel);
    const resolved = path.resolve(dest);
    if (
      !resolved.startsWith(path.resolve(p.dir) + path.sep) &&
      resolved !== path.resolve(p.dir)
    ) {
      return { ok: false, error: `chemin hors plugin: ${rel}` };
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, body, "utf8");
    written.push(rel);
  }
  return { ok: true, written };
}

export async function writePluginFilesAndCommit(
  id: string,
  files: Record<string, string>,
  message?: string,
): Promise<
  | {
      ok: true;
      written: string[];
      git: { sha: string | null; version: string | null; detail: string };
    }
  | { ok: false; error: string }
> {
  const wr = writePluginFiles(id, files);
  if (!wr.ok) return wr;
  const p = discoverPlugins().find((x) => x.manifest.id === id);
  if (!p) return { ok: false, error: `plugin inconnu: ${id}` };
  const git = await commitPluginChanges(
    p.dir,
    message || `update: ${wr.written.join(", ")}`,
    { bumpVersion: true },
  );
  return {
    ok: true,
    written: wr.written,
    git: { sha: git.sha, version: git.version, detail: git.detail },
  };
}

export async function getPluginVersions(id: string): Promise<{
  ok: boolean;
  pluginId: string;
  available: boolean;
  commits: PluginGitCommit[];
  head: string | null;
  error?: string;
}> {
  const p = discoverPlugins().find((x) => x.manifest.id === id);
  if (!p || p.error) {
    return {
      ok: false,
      pluginId: id,
      available: false,
      commits: [],
      head: null,
      error: `plugin inconnu: ${id}`,
    };
  }
  const r = await listPluginVersions(p.dir);
  return { ...r, pluginId: id };
}

export async function restorePluginToVersion(
  id: string,
  ref: string,
): Promise<
  | {
      ok: true;
      sha: string | null;
      detail: string;
      running: ReturnType<typeof getRunningPlugins>[number] | null;
    }
  | { ok: false; error: string }
> {
  const p = discoverPlugins().find((x) => x.manifest.id === id);
  if (!p || p.error) return { ok: false, error: `plugin inconnu: ${id}` };
  const r = await restorePluginVersion(p.dir, ref);
  if (!r.ok) return { ok: false, error: r.detail };
  const restarted = await restartPlugin(id);
  return {
    ok: true,
    sha: r.sha,
    detail: r.detail,
    running: restarted.ok ? restarted.running : null,
  };
}

export async function restartPlugin(
  id: string,
): Promise<
  | {
      ok: true;
      running: ReturnType<typeof getRunningPlugins>[number] | null;
    }
  | { ok: false; error: string }
> {
  const p = discoverPlugins().find((x) => x.manifest.id === id);
  if (!p || p.error) return { ok: false, error: `plugin inconnu: ${id}` };
  setPluginEnabled(p.dir, true);
  const existing = state.running.get(id);
  if (existing) {
    const oldChild = existing.child;
    const exited = new Promise<void>((resolve) => {
      if (oldChild.exitCode !== null) {
        resolve();
        return;
      }
      const done = () => resolve();
      oldChild.once("exit", done);
      setTimeout(done, 2500);
    });
    existing.stop();
    await exited;
    const cur = state.running.get(id);
    if (cur?.child === oldChild) {
      state.running.delete(id);
    }
  }
  const started = await startEnabledPlugins();
  if (started.errors.some((e) => e.startsWith(`${id}:`))) {
    return {
      ok: false,
      error: started.errors.find((e) => e.startsWith(`${id}:`)) || "start failed",
    };
  }
  for (let i = 0; i < 40; i++) {
    const run = getRunningPlugins().find((r) => r.id === id);
    if (run?.port) {
      return { ok: true, running: run };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const run = getRunningPlugins().find((r) => r.id === id) || null;
  if (!run?.port) {
    return {
      ok: false,
      error: `plugin ${id} non démarré après restart`,
    };
  }
  return { ok: true, running: run };
}

export async function proxyPluginHealth(id: string): Promise<{
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
}> {
  const run = getRunningPlugins().find((r) => r.id === id);
  if (!run?.port) return { ok: false, error: "plugin non démarré" };
  try {
    const res = await fetch(`http://127.0.0.1:${run.port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function resolvePluginPanel(id: string):
  | {
      ok: true;
      url: string;
      siteId: number;
      title: string;
    }
  | { ok: false; error: string } {
  const p = discoverPlugins().find((x) => x.manifest.id === id);
  if (!p || p.error) return { ok: false, error: `plugin inconnu: ${id}` };
  if (!hasPluginPermission(p.manifest, "ui:panel")) {
    return { ok: false, error: "permission ui:panel absente" };
  }
  const run = state.running.get(id);
  const port = run?.port ?? null;
  if (!port) return { ok: false, error: "plugin non démarré (port inconnu)" };
  const panelPath = p.manifest.panel?.path || "/";
  const pathPart = panelPath.startsWith("/") ? panelPath : `/${panelPath}`;
  return {
    ok: true,
    url: `http://127.0.0.1:${port}${pathPart}`,
    siteId: pluginSiteId(id),
    title: p.manifest.panel?.title || p.manifest.name,
  };
}

export function pluginsStatusPayload(): {
  root: string;
  plugins: DiscoveredPlugin[];
  running: Array<{
    id: string;
    port: number | null;
    version: string;
    siteId: number;
    panelUrl: string | null;
    n8nWebhookUrl: string | null;
  }>;
  logs: string[];
} {
  return {
    root: pluginsRootDir(),
    plugins: listPlugins(),
    running: getRunningPlugins(),
    logs: getPluginLogs(),
  };
}

export async function pluginsStatusPayloadWithGit(): Promise<{
  root: string;
  plugins: Array<DiscoveredPlugin & { git?: PluginGitStatus }>;
  running: ReturnType<typeof getRunningPlugins>;
  logs: string[];
}> {
  const base = pluginsStatusPayload();
  const plugins = await Promise.all(
    base.plugins.map(async (p) => {
      if (p.error) return p;
      try {
        const git = await getPluginGitStatus(p.dir);
        return { ...p, git };
      } catch {
        return p;
      }
    }),
  );
  return { ...base, plugins };
}
