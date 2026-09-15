/**
 * Mount api-kernel proxy vers un sidecar plugin (P3 plugins natifs).
 * `/api/v1/plugins/<id>/<subPath>` → `http://127.0.0.1:<port>/<subPath>`.
 *
 * Enregistré au démarrage du sidecar (`api.registerPluginApi`), retiré à
 * l'arrêt (`api.unregisterPluginApi`) — après stop, le kernel répond
 * `plugin_not_mounted` (404). L'ACL Product Hub s'applique AVANT ce mount
 * via `authorizePluginAccess` (createApiKernel).
 */
import type { ApiMount } from "@creezio/api-kernel";

export function createPluginProxyMount(opts: {
  pluginId: string;
  /** Port loopback résolu à CHAQUE requête (restart / ready async). */
  getPort: () => number | null;
  timeoutMs?: number;
}): ApiMount {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return {
    dbLayer: "plugin",
    handle: async ({ req, subPath }) => {
      const port = opts.getPort();
      if (!port) {
        return {
          status: 503,
          body: { ok: false, error: "plugin_not_running", pluginId: opts.pluginId },
        };
      }
      const method = req.method.toUpperCase();
      let target = `/${subPath}`;
      const query = req.query || {};
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        for (const item of Array.isArray(v) ? v : [v]) qs.append(k, item);
      }
      const qsStr = qs.toString();
      if (qsStr) target += `?${qsStr}`;

      try {
        const hasBody =
          req.body !== undefined && method !== "GET" && method !== "HEAD";
        const res = await fetch(`http://127.0.0.1:${port}${target}`, {
          method,
          ...(hasBody
            ? {
                headers: { "content-type": "application/json" },
                body:
                  typeof req.rawBody === "string"
                    ? req.rawBody
                    : JSON.stringify(req.body ?? {}),
              }
            : {}),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          /* réponse non-JSON (panel HTML) — brute */
        }
        return {
          status: res.status,
          ...(typeof body === "string"
            ? {
                headers: {
                  "content-type":
                    res.headers.get("content-type") || "text/plain",
                },
              }
            : {}),
          body,
        };
      } catch (err) {
        return {
          status: 502,
          body: {
            ok: false,
            error: "plugin_proxy_failed",
            pluginId: opts.pluginId,
            detail: err instanceof Error ? err.message : String(err),
          },
        };
      }
    },
  };
}
