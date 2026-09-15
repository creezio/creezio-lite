/**
 * Helpers ports / health — purs Node (utilisés par launchers hôte).
 * Extrait de electron/server-launcher.ts (kit).
 */

import http from "node:http";
import net from "node:net";

export type BindHost = "127.0.0.1" | "0.0.0.0";

/**
 * Port TCP libre.
 * Probe sur `127.0.0.1` ; le serveur peut ensuite binder `0.0.0.0`.
 */
export function findFreePort(
  preferred?: number,
  _bindHost?: BindHost,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", (err) => {
      if (preferred != null) {
        findFreePort(undefined, _bindHost).then(resolve).catch(reject);
        return;
      }
      reject(err);
    });
    srv.listen(preferred ?? 0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() =>
        port ? resolve(port) : reject(new Error("port introuvable")),
      );
    });
  });
}

export function httpGetStatus(
  url: string,
  timeoutMs: number,
): Promise<number> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(0);
    });
    req.on("error", () => resolve(0));
  });
}

/**
 * Poll GET /health jusqu'à réponse HTTP (200 ok, 503 degraded = serveur up).
 */
export async function waitForHealth(
  baseUrl: string,
  timeoutMs = 120000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await httpGetStatus(`${baseUrl}/health`, 2000);
    if (status === 200 || status === 503) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `Serveur injoignable après ${timeoutMs / 1000}s (${baseUrl}/health)`,
  );
}

/** Poll GET /health Meili jusqu'à 200. */
export async function waitForMeiliHealth(
  host: string,
  timeoutMs = 90000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await httpGetStatus(`${host}/health`, 1500);
    if (status === 200) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("Meilisearch injoignable");
}
