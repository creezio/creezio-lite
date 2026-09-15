/**
 * Découverte tools MCP plugins (P2 plugins natifs) — pour chaque plugin
 * RUNNING, expose :
 *   - `plugin.<id>.status` — état + health loopback ;
 *   - `plugin.<id>.call`   — proxy HTTP générique (path whitelisté) ;
 *   - les tools déclarés `manifest.mcpTools` (proxy méthode/path fixes).
 *
 * Namespace obligatoire `plugin.<id>.*` avec `ownerId` = id plugin
 * (contrat mcp-facade/namespace). Fail-closed côté façade : ACL Product Hub
 * via `createDenyUnauthorizedPluginToolPolicy` + `filterPluginToolsForActor`.
 */
import type { McpRegisteredTool } from "@creezio/mcp-facade";
import type {
  DiscoveredPlugin,
  PluginMcpToolSpec,
} from "@creezio/platform-core";

export type PluginToolsHostLike = {
  listPlugins: () => DiscoveredPlugin[];
  getRunningPlugins: () => Array<{
    id: string;
    port: number | null;
  }>;
};

export type CreatePluginToolsDiscoveryOptions = {
  /** Getter lazy — le host plugins n'existe qu'après compose OS. */
  pluginsHost: () => PluginToolsHostLike | null;
  /** Timeout des proxys loopback (défaut 8000 ms, health 2000 ms). */
  fetchTimeoutMs?: number;
};

/** Whitelist proxy générique `plugin.<id>.call` : /health + /api/*. */
function isWhitelistedCallPath(p: string): boolean {
  if (typeof p !== "string" || !p.startsWith("/")) return false;
  if (p.includes("..") || p.includes("://") || /\s/.test(p)) return false;
  const clean = p.split("?")[0] || "/";
  return clean === "/health" || clean === "/api" || clean.startsWith("/api/");
}

async function proxyLoopback(opts: {
  port: number;
  method: string;
  path: string;
  body?: unknown;
  timeoutMs: number;
}): Promise<{ ok: boolean; content?: unknown; error?: string }> {
  try {
    const hasBody =
      opts.body !== undefined &&
      opts.method !== "GET" &&
      opts.method !== "HEAD";
    const res = await fetch(`http://127.0.0.1:${opts.port}${opts.path}`, {
      method: opts.method,
      ...(hasBody
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(opts.body ?? {}),
          }
        : {}),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* réponse non-JSON (panel HTML…) — renvoyée brute */
    }
    return {
      ok: res.ok,
      content: { status: res.status, body: parsed },
      ...(res.ok ? {} : { error: `plugin_http_${res.status}` }),
    };
  } catch (err) {
    return {
      ok: false,
      error: `plugin_unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function declaredTools(
  pluginId: string,
  specs: PluginMcpToolSpec[],
  getPort: () => number | null,
  timeoutMs: number,
): McpRegisteredTool[] {
  return specs.map((spec) => ({
    name: `plugin.${pluginId}.${spec.name}`,
    description:
      spec.description ||
      `Tool ${spec.name} du plugin ${pluginId} (${spec.method} ${spec.path})`,
    space: "plugin" as const,
    ownerId: pluginId,
    ...(spec.inputSchema ? { inputSchema: spec.inputSchema } : {}),
    handler: async (args: Record<string, unknown>) => {
      const port = getPort();
      if (!port) return { ok: false, error: "plugin_not_running" };
      // GET : args → query string ; sinon args = corps JSON.
      let targetPath = spec.path;
      if (spec.method === "GET" && args && Object.keys(args).length > 0) {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(args)) {
          if (v !== undefined && v !== null) qs.set(k, String(v));
        }
        targetPath += (targetPath.includes("?") ? "&" : "?") + qs.toString();
      }
      return proxyLoopback({
        port,
        method: spec.method,
        path: targetPath,
        ...(spec.method !== "GET" ? { body: args } : {}),
        timeoutMs,
      });
    },
  }));
}

/**
 * Fabrique le discoverer `plugin` de la façade MCP. Appelé à chaque
 * listTools/callTool — reflète l'état runtime (plugins stoppés ⇒ tools
 * retirés de la surface).
 */
export function createPluginToolsDiscovery(
  opts: CreatePluginToolsDiscoveryOptions,
): () => McpRegisteredTool[] {
  const timeoutMs = opts.fetchTimeoutMs ?? 8000;

  return () => {
    let host: PluginToolsHostLike | null = null;
    try {
      host = opts.pluginsHost();
    } catch {
      return [];
    }
    if (!host) return [];

    let plugins: DiscoveredPlugin[] = [];
    let running: Array<{ id: string; port: number | null }> = [];
    try {
      plugins = host.listPlugins();
      running = host.getRunningPlugins();
    } catch {
      return [];
    }
    const runningById = new Map(running.map((r) => [r.id, r]));

    const out: McpRegisteredTool[] = [];
    for (const plugin of plugins) {
      // Manifest invalide (mcpTools compris) ⇒ rejeté à la découverte.
      if (plugin.error) continue;
      const id = plugin.manifest.id;
      const run = runningById.get(id);
      if (!run) continue;
      const getPort = () => host!.getRunningPlugins().find((r) => r.id === id)?.port ?? null;

      out.push({
        name: `plugin.${id}.status`,
        description: `État / health du plugin ${id}`,
        space: "plugin",
        ownerId: id,
        handler: async () => {
          const port = getPort();
          let health: unknown = null;
          if (port) {
            const h = await proxyLoopback({
              port,
              method: "GET",
              path: "/health",
              timeoutMs: Math.min(timeoutMs, 2000),
            });
            health = h.ok ? h.content : { error: h.error };
          }
          return {
            ok: true,
            content: {
              id,
              name: plugin.manifest.name,
              version: plugin.manifest.version,
              running: Boolean(port),
              port,
              permissions: plugin.manifest.permissions || [],
              health,
            },
          };
        },
      });

      out.push({
        name: `plugin.${id}.call`,
        description: `Proxy HTTP loopback vers le plugin ${id} (paths whitelistés /health, /api/*)`,
        space: "plugin",
        ownerId: id,
        inputSchema: {
          type: "object",
          properties: {
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
            path: { type: "string", description: "/health ou /api/..." },
            body: { type: "object" },
          },
          required: ["path"],
        },
        handler: async (args: Record<string, unknown>) => {
          const port = getPort();
          if (!port) return { ok: false, error: "plugin_not_running" };
          const method = String(args.method || "GET").toUpperCase();
          if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
            return { ok: false, error: "plugin_call_method_invalid" };
          }
          const targetPath = String(args.path || "");
          if (!isWhitelistedCallPath(targetPath)) {
            return { ok: false, error: "plugin_call_path_denied" };
          }
          return proxyLoopback({
            port,
            method,
            path: targetPath,
            ...(args.body !== undefined ? { body: args.body } : {}),
            timeoutMs,
          });
        },
      });

      if (plugin.manifest.mcpTools?.length) {
        out.push(
          ...declaredTools(id, plugin.manifest.mcpTools, getPort, timeoutMs),
        );
      }
    }
    return out;
  };
}
