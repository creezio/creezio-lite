/**
 * Proxy PULL-ONLY du registre d'images Docker de la flotte (F4).
 *
 * Exposé par le Creezio Server Admin sous `/v2/*` — l'ingress public
 * `registry.{zone}` (tunnel de l'instance admin, kind registry) pointe
 * dessus, ce qui rend les images versionnées résolubles depuis les VPS
 * distants (`docker pull registry.{zone}/creezio-server-<brand>:<tag>`).
 *
 * Garanties :
 *   - PULL uniquement : GET/HEAD sur `/v2/*` — toute autre méthode (push :
 *     POST/PUT/PATCH/DELETE) → 405. Le push reste loopback-only
 *     (`creezio server-docker publish` → 127.0.0.1:5000).
 *   - Auth par hôte : Basic `hostId:agentToken` vérifié contre le registre
 *     d'hôtes enrôlés (fleet-hosts.json runtime) — le credential flotte
 *     existe déjà (posé par `agent up`, échangé à l'enroll), AUCUN nouveau
 *     cycle de vie : création = enroll, révocation = DELETE
 *     /admin/api/hosts/<id>. Le Basic admin (CREEZIO_ADMIN_USER/PASS)
 *     fonctionne aussi (debug opérateur).
 *   - Streaming : les blobs d'images (Go) sont pipés, jamais bufferisés.
 */

import http from "node:http";
import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuditFn, FleetHost } from "./types.js";

function safeEqualStr(a: string, b: string): boolean {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) {
    crypto.timingSafeEqual(aa, aa);
    return false;
  }
  return crypto.timingSafeEqual(aa, bb);
}

function parseBasic(header: string): { user: string; pass: string } | null {
  if (!header || !header.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i < 0) return null;
    return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
  } catch {
    return null;
  }
}

/** Chemin registre Docker v2 (racine de handshake incluse). */
export function isRegistryPath(pathname: string): boolean {
  return pathname === "/v2" || pathname === "/v2/" || pathname.startsWith("/v2/");
}

/** Seul le pull est autorisé à travers l'ingress. */
export function isPullMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

export interface RegistryPullAuthContext {
  adminUser?: string;
  adminPass?: string;
  loadHosts?: () => Array<Pick<FleetHost, "hostId" | "agentToken">>;
}

/**
 * Décision d'auth pull : Basic `hostId:agentToken` (hôte enrôlé) ou Basic
 * admin. Retourne `{ ok, user }` — jamais les tokens.
 */
export function registryPullAuthDecision(
  header: string | undefined,
  ctx: RegistryPullAuthContext,
): { ok: boolean; user?: string } {
  const basic = parseBasic(header || "");
  if (!basic || !basic.user || !basic.pass) return { ok: false };
  if (
    ctx.adminUser &&
    ctx.adminPass &&
    safeEqualStr(basic.user, ctx.adminUser) &&
    safeEqualStr(basic.pass, ctx.adminPass)
  ) {
    return { ok: true, user: basic.user };
  }
  const hosts = typeof ctx.loadHosts === "function" ? ctx.loadHosts() : [];
  for (const h of hosts) {
    if (
      h &&
      h.hostId &&
      h.agentToken &&
      safeEqualStr(basic.user, h.hostId) &&
      safeEqualStr(basic.pass, h.agentToken)
    ) {
      return { ok: true, user: h.hostId };
    }
  }
  return { ok: false };
}

const UNAUTH_HEADERS = {
  "WWW-Authenticate": 'Basic realm="Creezio Registry (pull-only)", charset="UTF-8"',
  "Content-Type": "application/json; charset=utf-8",
  // Le client docker vérifie ce header pour parler l'API v2.
  "Docker-Distribution-Api-Version": "registry/2.0",
};

export interface RegistryPullProxyOptions {
  /** hôte:port du registre local (127.0.0.1:5000). */
  upstream: string;
  loadHosts: () => Array<Pick<FleetHost, "hostId" | "agentToken">>;
  adminUser?: string;
  adminPass?: string;
  audit?: AuditFn;
}

export type RegistryPullProxyHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) => boolean;

/**
 * Crée le handler `/v2/*` — retourne true si la requête a été prise en charge.
 */
export function createRegistryPullProxy(
  opts: RegistryPullProxyOptions,
): RegistryPullProxyHandler {
  const upstream = String(opts.upstream || "").trim();
  const audit = opts.audit || (() => {});
  return (req, res, url) => {
    if (!isRegistryPath(url.pathname)) return false;

    if (!upstream) {
      res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          ok: false,
          error: "registre non configuré (CREEZIO_REGISTRY requis)",
        }),
      );
      return true;
    }

    if (!isPullMethod(req.method || "")) {
      audit(`registry ${req.method} ${url.pathname} REFUSÉ (pull-only)`);
      res.writeHead(405, {
        "Content-Type": "application/json; charset=utf-8",
        Allow: "GET, HEAD",
      });
      res.end(
        JSON.stringify({
          ok: false,
          error:
            "push interdit via l'ingress — publish loopback-only sur le VPS admin",
        }),
      );
      return true;
    }

    const decision = registryPullAuthDecision(req.headers.authorization, {
      adminUser: opts.adminUser,
      adminPass: opts.adminPass,
      loadHosts: opts.loadHosts,
    });
    if (!decision.ok) {
      res.writeHead(401, UNAUTH_HEADERS);
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return true;
    }

    const [host, portRaw] = upstream.split(":");
    const upstreamReq = http.request(
      {
        host,
        port: Number(portRaw || 80),
        method: req.method,
        path: url.pathname + (url.search || ""),
        headers: {
          // Pass-through des en-têtes de négociation docker (Accept des
          // manifests OCI/v2, Range des blobs) — pas d'Authorization amont
          // (le registre local est loopback sans auth).
          ...pickHeaders(req.headers, [
            "accept",
            "accept-encoding",
            "range",
            "user-agent",
          ]),
          host: upstream,
        },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstreamReq.on("error", (e) => {
      audit(`registry proxy amont KO: ${e?.message || e}`);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "registre amont injoignable" }));
      } else {
        res.destroy();
      }
    });
    req.pipe(upstreamReq);
    if (url.pathname === "/v2" || url.pathname === "/v2/") {
      audit(`registry handshake pull (${decision.user})`);
    }
    return true;
  };
}

function pickHeaders(
  headers: http.IncomingHttpHeaders,
  names: string[],
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const n of names) {
    const v = headers[n];
    if (v !== undefined) out[n] = v;
  }
  return out;
}
