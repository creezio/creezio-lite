/**
 * Host plugins runtime — spawn sidecars minimal (boots C7 sans bindings).
 *
 * Runtime riche TF (scaffold / git / control-extras / accept-check…) →
 * `host/plugins/{runtime,launcher,git,control-extras,...}` + `configurePluginHost`
 * (Phase N1). Product Hub → `@creezio/product-hub` + `startHostPluginControlPlane`.
 *
 * Vertical restant après N1 (cutover N1p / UI N6) :
 * - wiring marque (`configurePluginHost`, barrels ≤40 LOC)
 * - UI Admin Plugins / MCP analytics
 */

import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  discoverPlugins,
  findFreePort,
  hasPluginPermission,
  pluginsRootDir,
  setPluginEnabled,
  writePluginRuntimeState,
  type DiscoveredPlugin,
} from "@creezio/platform-core";
import type { HostRuntimeContext } from "../context.js";
import { hostLog } from "../context.js";
import {
  buildIsolatedNodeEnv,
  resolveDesktopNodeBinary,
} from "../node-runtime.js";
import { ensurePluginControlToken } from "./control-token.js";

export type RunningPlugin = {
  id: string;
  dir: string;
  port: number | null;
  child: ChildProcess;
  stop: () => void;
};

export type PluginsHost = {
  listPlugins: () => DiscoveredPlugin[];
  startEnabledPlugins: (opts?: {
    crmPort?: number | null;
  }) => Promise<RunningPlugin[]>;
  stopAllPlugins: () => void;
  enablePlugin: (id: string, enabled: boolean) => DiscoveredPlugin | null;
  getRunningPlugins: () => Array<{
    id: string;
    port: number | null;
    pid: number | undefined;
  }>;
  pluginsStatusPayload: () => {
    plugins: DiscoveredPlugin[];
    running: Array<{ id: string; port: number | null }>;
  };
  getPluginLogs: () => string[];
};

/** Clé API générique kit persistée par plugin (host minimal). */
const PLUGIN_API_KEY_FILE = ".creezio-plugin-api-key.json";

function pluginApiScopes(plugin: DiscoveredPlugin): string | null {
  if (hasPluginPermission(plugin.manifest, "crm:write")) {
    return "crm:read,crm:write";
  }
  if (hasPluginPermission(plugin.manifest, "crm:read")) return "crm:read";
  return null;
}

/**
 * Clé API scopée par plugin — persistée dans le dossier plugin (0600).
 * Générique kit : l'upsert DB côté marque reste le vertical du launcher
 * complet (`ensurePluginCrmApiKey` + bindings).
 */
function ensurePluginApiKeyFile(
  plugin: DiscoveredPlugin,
  scopes: string,
): { apiKey: string; scopes: string } {
  const file = path.join(plugin.dir, PLUGIN_API_KEY_FILE);
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      apiKey?: string;
      scopes?: string;
    };
    if (raw && typeof raw.apiKey === "string" && raw.scopes === scopes) {
      return { apiKey: raw.apiKey, scopes };
    }
  } catch {
    /* absent / invalide → régénérer */
  }
  const apiKey = `czp_${crypto.randomBytes(24).toString("base64url")}`;
  fs.writeFileSync(
    file,
    `${JSON.stringify({ apiKey, scopes, createdAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return { apiKey, scopes };
}

export function createPluginsHost(opts: {
  ctx: HostRuntimeContext;
  /**
   * Hooks lifecycle — registerPluginApi / unregisterPluginApi côté
   * app-runtime (P3). `onPluginStopped` couvre exit ET stopAllPlugins.
   */
  onPluginStarted?: (plugin: {
    id: string;
    dir: string;
    port: number | null;
  }) => void;
  onPluginStopped?: (id: string) => void;
  /** Clés LLM à injecter si permission `llm:use` (défaut process.env). */
  getLlmKeys?: () => { openai?: string | null; anthropic?: string | null };
}): PluginsHost {
  const { ctx } = opts;
  const root = () => pluginsRootDir(ctx.userDataDir);
  const running = new Map<string, RunningPlugin>();
  const logs: string[] = [];
  const push = (line: string) => {
    logs.push(line);
    if (logs.length > 300) logs.shift();
    hostLog(ctx, "plugins", line);
  };

  function listPlugins(): DiscoveredPlugin[] {
    return discoverPlugins(root());
  }

  function stopAllPlugins(): void {
    const ids = [...running.keys()];
    for (const p of running.values()) {
      try {
        p.stop();
      } catch {
        /* */
      }
    }
    running.clear();
    writePluginRuntimeState(root(), []);
    for (const id of ids) {
      try {
        opts.onPluginStopped?.(id);
      } catch {
        /* hook marque non bloquant */
      }
    }
  }

  function enablePlugin(
    id: string,
    enabled: boolean,
  ): DiscoveredPlugin | null {
    const found = listPlugins().find((p) => p.manifest.id === id);
    if (!found) return null;
    setPluginEnabled(found.dir, enabled);
    return listPlugins().find((p) => p.manifest.id === id) || null;
  }

  async function startEnabledPlugins(startOpts?: {
    crmPort?: number | null;
  }): Promise<RunningPlugin[]> {
    ensurePluginControlToken(ctx);
    const node = resolveDesktopNodeBinary(ctx);
    const started: RunningPlugin[] = [];
    const runtimeEntries: Array<{
      id: string;
      port: number | null;
      hooks: string[];
      permissions: string[];
      panel: boolean;
    }> = [];

    for (const plugin of listPlugins().filter((p) => p.enabled && !p.error)) {
      if (running.has(plugin.manifest.id)) {
        started.push(running.get(plugin.manifest.id)!);
        continue;
      }
      const entry = path.join(plugin.dir, plugin.manifest.main);
      if (!fs.existsSync(entry)) {
        push(`${plugin.manifest.id}: entry manquant ${entry}`);
        continue;
      }
      let port: number | null = plugin.manifest.port ?? null;
      if (port == null) {
        // Port loopback systématique : panel, tools MCP proxy et mount API
        // kernel en dépendent (le sidecar peut aussi annoncer {event:"ready"}).
        port = await findFreePort();
      }

      const baseEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PLUGIN_ID: plugin.manifest.id,
        PLUGIN_DIR: plugin.dir,
        ...(port ? { PORT: String(port) } : {}),
        ...(startOpts?.crmPort
          ? { CRM_PORT: String(startOpts.crmPort) }
          : {}),
      };

      // API loopback + clé scopée — uniquement avec permission crm:*.
      const scopes = pluginApiScopes(plugin);
      if (scopes && startOpts?.crmPort) {
        baseEnv.API_URL = `http://127.0.0.1:${startOpts.crmPort}`;
        try {
          const key = ensurePluginApiKeyFile(plugin, scopes);
          baseEnv.API_KEY = key.apiKey;
          baseEnv.API_SCOPES = key.scopes;
        } catch (e) {
          push(
            `${plugin.manifest.id}: clé API plugin non générée (${e instanceof Error ? e.message : e})`,
          );
        }
      } else {
        delete baseEnv.API_KEY;
        delete baseEnv.API_SCOPES;
      }

      // Sécurité : JAMAIS de clé LLM sans permission llm:use (parité
      // launcher complet — le delete est volontaire, ne pas régresser).
      if (hasPluginPermission(plugin.manifest, "llm:use")) {
        const llm = opts.getLlmKeys?.() ?? {
          openai: process.env.OPENAI_API_KEY || null,
          anthropic: process.env.ANTHROPIC_API_KEY || null,
        };
        if (llm.openai) baseEnv.OPENAI_API_KEY = llm.openai;
        else delete baseEnv.OPENAI_API_KEY;
        if (llm.anthropic) baseEnv.ANTHROPIC_API_KEY = llm.anthropic;
        else delete baseEnv.ANTHROPIC_API_KEY;
      } else {
        delete baseEnv.OPENAI_API_KEY;
        delete baseEnv.ANTHROPIC_API_KEY;
        delete baseEnv.OPENAI_API_BASE;
      }

      const env = buildIsolatedNodeEnv({
        nodeBin: node,
        baseEnv,
        sandbox: {
          profileHome: path.join(plugin.dir, "home"),
          userData: ctx.userDataDir,
        },
      });
      push(`spawn plugin ${plugin.manifest.id}`);
      const child = spawn(node, [entry], {
        cwd: plugin.dir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stdout?.on("data", (d: Buffer) =>
        d
          .toString()
          .split("\n")
          .filter(Boolean)
          .forEach((l) => {
            push(`[${plugin.manifest.id}] ${l}`);
            // Annonce de port sidecar `{event:"ready",port}` (parité launcher).
            try {
              const j = JSON.parse(l) as { event?: string; port?: number };
              if (j.event === "ready" && typeof j.port === "number") {
                const cur = running.get(plugin.manifest.id);
                // Ne maj que si c'est encore CE process (course au restart).
                if (cur?.child === child) {
                  cur.port = j.port;
                }
              }
            } catch {
              /* log brut */
            }
          }),
      );
      const handle: RunningPlugin = {
        id: plugin.manifest.id,
        dir: plugin.dir,
        port,
        child,
        stop: () => {
          try {
            child.kill();
          } catch {
            /* */
          }
        },
      };
      running.set(plugin.manifest.id, handle);
      started.push(handle);
      runtimeEntries.push({
        id: plugin.manifest.id,
        port,
        hooks: plugin.manifest.hooks || [],
        permissions: plugin.manifest.permissions || [],
        panel: Boolean(plugin.manifest.panel),
      });
      try {
        opts.onPluginStarted?.({
          id: plugin.manifest.id,
          dir: plugin.dir,
          port,
        });
      } catch {
        /* hook non bloquant */
      }
      child.on("exit", () => {
        const cur = running.get(plugin.manifest.id);
        if (cur?.child === child) {
          running.delete(plugin.manifest.id);
          try {
            opts.onPluginStopped?.(plugin.manifest.id);
          } catch {
            /* hook non bloquant */
          }
        }
      });
    }
    writePluginRuntimeState(root(), runtimeEntries);
    return started;
  }

  return {
    listPlugins,
    startEnabledPlugins,
    stopAllPlugins,
    enablePlugin,
    getRunningPlugins: () =>
      [...running.values()].map((p) => ({
        id: p.id,
        port: p.port,
        pid: p.child.pid,
      })),
    pluginsStatusPayload: () => ({
      plugins: listPlugins(),
      running: [...running.values()].map((p) => ({
        id: p.id,
        port: p.port,
      })),
    }),
    getPluginLogs: () => [...logs],
  };
}

/**
 * Vertical documenté après N1 (reste app marque / phases suivantes) :
 * - configurePluginHost bindings + barrels control-api / hub-store (N1p)
 * - UI Admin Plugins / MCP analytics (N6)
 * Runtime spawn/git/scaffold/extras → kit `host/plugins/*`.
 */
export const PLUGIN_VERTICAL_REMAINING = [
  "brand-plugin-host-bindings",
  "plugin-control-api-barrel",
  "admin-plugins-ui",
] as const;
