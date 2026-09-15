/**
 * Listener HTTP mince sur api-kernel — même façade que le harness Node.
 * Utilisé par Electron main (SPA) et smokes sans Electron GUI.
 */
import http from "node:http";
import { findFreePort } from "@creezio/platform-core";

export type BrandKernelHttpHandle = {
  port: number;
  baseUrl: string;
  server: http.Server;
  close: () => Promise<void>;
};

export type BrandKernelLike = {
  handle(req: {
    method: string;
    path: string;
    body?: unknown;
    query?: Record<string, string | string[] | undefined>;
    headers?: Record<string, string | string[] | undefined>;
  }): Promise<{
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
  }>;
};

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function resolveKernelHttpHost(explicit?: string): string {
  const raw = String(
    explicit ||
      process.env.CREEZIO_HTTP_HOST ||
      process.env.METIER_HOST ||
      "127.0.0.1",
  ).trim();
  if (raw === "0.0.0.0" || raw === "*" || raw === "::") return "0.0.0.0";
  return raw || "127.0.0.1";
}

function advertiseBaseUrl(host: string, port: number): string {
  const advertise = host === "0.0.0.0" ? "127.0.0.1" : host;
  return `http://${advertise}:${port}`;
}

/**
 * Ouvre un serveur HTTP qui délègue à `api.handle`.
 * Bind Docker : `CREEZIO_HTTP_HOST=0.0.0.0`.
 */
export async function listenBrandKernelHttp(opts: {
  api: BrandKernelLike;
  port?: number;
  host?: string;
}): Promise<BrandKernelHttpHandle> {
  const host = resolveKernelHttpHost(opts.host);
  const port = opts.port && opts.port > 0 ? opts.port : await findFreePort();

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "access-control-allow-headers": "content-type",
        });
        res.end();
        return;
      }
      const url = new URL(req.url || "/", `http://${host}:${port}`);
      const query = Object.fromEntries(url.searchParams.entries());
      const body = ["POST", "PUT", "PATCH"].includes(req.method || "")
        ? await readBody(req)
        : undefined;
      const result = await opts.api.handle({
        method: req.method || "GET",
        path: url.pathname,
        body,
        query,
        headers: req.headers as Record<string, string | string[] | undefined>,
      });
      const payload = JSON.stringify(result.body ?? {});
      res.writeHead(result.status || 200, {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
        ...(result.headers || {}),
      });
      res.end(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  return {
    port,
    baseUrl: advertiseBaseUrl(host, port),
    server,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
