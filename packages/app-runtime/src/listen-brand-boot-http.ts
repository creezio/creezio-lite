/**
 * Early-listen boot HTTP — répond dès le début du boot serveur, avant
 * migrations/Meili/embeds. Sert `GET /api/v1/os/boot-status` (SplashViewModel
 * JSON), puis le vrai `listenBrandOsHttp` reprend le même `http.Server`
 * (option `existingServer`) sans coupure de port.
 */
import http from "node:http";
import type { SplashViewModel } from "@creezio/electron-shell";
import { resolveBrandOsHttpHost } from "./listen-brand-os-http.js";

export type BrandBootHttpHandle = {
  server: http.Server;
  port: number;
  host: string;
  close: () => Promise<void>;
};

export async function listenBrandBootHttp(opts: {
  brandId: string;
  port: number;
  host?: string;
  getBootStatus: () => SplashViewModel | null;
}): Promise<BrandBootHttpHandle> {
  const host = resolveBrandOsHttpHost(opts.host);

  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify(body ?? {}));
    };
    try {
      const url = new URL(req.url || "/", `http://${host}:${opts.port}`);
      if (url.pathname === "/api/v1/os/boot-status") {
        const model = opts.getBootStatus();
        if (!model) {
          send(503, { ok: false, error: "boot_status_pending" });
          return;
        }
        send(200, { ok: true, booting: true, ...model });
        return;
      }
      // Tout le reste : 503 explicite avec progression (health inclus —
      // le healthcheck Docker passe au vert après le handoff).
      const model = opts.getBootStatus();
      send(503, {
        ok: false,
        booting: true,
        brandId: opts.brandId,
        error: "server_booting",
        overallPercent: model ? Math.round(model.overallPercent) : 0,
        headline: model?.headline ?? "Démarrage…",
      });
    } catch (err) {
      send(500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, host, () => resolve());
  });

  return {
    server,
    port: opts.port,
    host,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
