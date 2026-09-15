/**
 * Serveur HTTP loopback control plane — factory brand-agnostic.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { createPluginControlPlaneHandler } from "./handler.js";
import type {
  PluginControlPlaneOptions,
  PluginControlPlaneState,
} from "./types.js";

export async function startPluginControlPlane(
  opts: PluginControlPlaneOptions & { port?: number; host?: string },
): Promise<PluginControlPlaneState> {
  const handler = createPluginControlPlaneHandler(opts);
  const server = http.createServer((req, res) => {
    void (async () => {
      if (opts.preHandle) {
        const done = await opts.preHandle(req, res);
        if (done) return;
      }
      await handler(req, res);
    })().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: msg }));
      } else {
        res.end();
      }
    });
  });

  const host = opts.host || "127.0.0.1";
  const port = opts.port ?? 0;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const addr = server.address() as AddressInfo;
  const url = `http://${host}:${addr.port}`;

  return {
    port: addr.port,
    url,
    token: opts.controlToken,
    pluginsDir: opts.pluginsDir,
    tokens: opts.tokens,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export { createPluginControlPlaneHandler };
