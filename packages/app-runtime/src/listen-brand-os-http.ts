/**
 * HTTP OS + métier — kernel api-kernel + MCP JSON + status hosts.
 * Un seul port loopback pour SPA / preuves / agents.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { kitBinaryPaths } from "@creezio/host-runtime";
import { kitOsVendorDir } from "@creezio/platform-core";
import {
  findFreePort,
  generateRecoveryKey,
  sanitizeConnectionProfile,
  testRemoteHealth,
  type ConnectionProfile,
} from "@creezio/platform-core";
import type { ApiKernel } from "@creezio/api-kernel";
import { migrateBrandCredentialsToKit } from "@creezio/auth";
import type { McpFacade } from "@creezio/mcp-facade";
import type { SqliteMailsStore } from "@creezio/mails";
import type { BrandOsComposition } from "./compose-brand-os.js";
import { applyStoredLlmEnv } from "./harness-server-phases.js";
import {
  handleMcpJsonRpcRequest,
  isJsonRpcBody,
} from "./mcp-jsonrpc.js";
import {
  emailSurfaceHandlesPath,
  mountBrandEmailSurface,
} from "./mount-brand-email-surface.js";
import {
  assertModuleMountSession,
  isAdminApiPath,
  type ModuleMachineKeyVerifier,
} from "./module-mount-auth.js";

/** Placeholder headless (fleet ops) — jamais exposé comme « clé réelle ». */
const SETUP_OPENAI_PLACEHOLDER = "sk-setup-placeholder";

function resolveSetupOpenaiKey(bodyKey: unknown): string {
  // Corps présent (y compris "") : priorité wizard HTTP — pas de placeholder silencieux.
  if (bodyKey !== undefined && bodyKey !== null) {
    return String(bodyKey).trim();
  }
  // Omis (curl fleet) : env opérateur, sinon placeholder pour ne pas bloquer le first-run.
  return (
    (process.env.OPENAI_API_KEY || "").trim() || SETUP_OPENAI_PLACEHOLDER
  );
}

export type BrandOsHttpHandle = {
  port: number;
  baseUrl: string;
  server: http.Server;
  close: () => Promise<void>;
};

function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJsonBody(raw: Buffer): unknown {
  const text = raw.toString("utf8");
  if (!text) return undefined;
  return JSON.parse(text);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  return parseJsonBody(await readRawBody(req));
}

/**
 * Contrat de composition api-kernel (voir @creezio/api-kernel src/hono.ts) :
 * un 404 kernel « not mounted / not found » laisse la main aux routes API
 * propres à la marque — ici servies par le plane UI Next (ex. app Hono
 * marque montée sous /api/v1 dans l'app Next, architecture kit).
 *
 * Attention : le next.config marque rewrite `/api/v1/*` → kernel. Sans garde,
 * un fallthrough kernel→Next→kernel boucle (CPU, ECONNRESET, pages Admin
 * MCP/API « crashées »). On marque le hop avec KERNEL_API_FALLTHROUGH_HEADER.
 */
const KERNEL_API_FALLTHROUGH_HEADER = "x-creezio-kernel-fallthrough";

function isKernelFallthrough404(res: {
  status?: number;
  body?: unknown;
}): boolean {
  if (res.status !== 404) return false;
  const err = (res.body as { error?: string } | undefined)?.error;
  return (
    err === "not_found" ||
    err === "platform_not_mounted" ||
    err === "module_not_mounted" ||
    err === "plugin_not_mounted" ||
    err === "core_route_not_found"
  );
}

function hasKernelFallthroughHop(
  headers: http.IncomingHttpHeaders,
): boolean {
  const raw = headers[KERNEL_API_FALLTHROUGH_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "1";
}

/** Garde process-local si Next ne renvoie pas le header de hop. */
const inflightApiFallthrough = new Set<string>();

function send(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) {
  const cors: Record<string, string> = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers":
      "content-type, authorization, x-creezio-user-id",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  };
  // Panels plugins (HTML) et autres corps déjà sérialisés : ne pas
  // re-JSON.stringifier — sinon le navigateur reçoit `"<!doctype…"` littéral.
  if (typeof body === "string" || Buffer.isBuffer(body)) {
    const contentType =
      headers?.["content-type"] ||
      headers?.["Content-Type"] ||
      (typeof body === "string"
        ? "text/plain; charset=utf-8"
        : "application/octet-stream");
    res.writeHead(status, {
      ...cors,
      ...(headers || {}),
      "content-type": contentType,
    });
    res.end(body);
    return;
  }
  const payload = JSON.stringify(body ?? {});
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...cors,
    ...(headers || {}),
  });
  res.end(payload);
}

/** Payload admin web — panelUrl = proxy même origine (tunnel OK), pas 127.0.0.1. */
function buildOsPluginsWebStatus(host: {
  listPlugins: () => Array<{
    dir: string;
    manifest: {
      id: string;
      name: string;
      version: string;
      permissions?: string[];
      panel?: { title?: string; path?: string };
    };
    enabled: boolean;
    error?: string;
  }>;
  pluginsStatusPayload?: () => {
    plugins: Array<{
      dir: string;
      manifest: {
        id: string;
        name: string;
        version: string;
        permissions?: string[];
        panel?: { title?: string; path?: string };
      };
      enabled: boolean;
      error?: string;
    }>;
    running: Array<{ id: string; port: number | null }>;
  };
  getPluginLogs?: () => string[];
}): {
  root: string;
  plugins: ReturnType<typeof host.listPlugins>;
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
  const payload = host.pluginsStatusPayload?.();
  const plugins = payload?.plugins ?? host.listPlugins();
  const runningRaw = payload?.running ?? [];
  const root =
    plugins[0]?.dir != null ? path.dirname(plugins[0].dir) : "…/plugins";
  const running = runningRaw.map((r) => {
    const plug = plugins.find((p) => p.manifest.id === r.id);
    const panelPath = plug?.manifest.panel?.path || "/";
    const pathPart = panelPath.startsWith("/") ? panelPath : `/${panelPath}`;
    const canPanel =
      Boolean(plug?.manifest.permissions?.includes("ui:panel")) &&
      Boolean(plug?.manifest.panel) &&
      r.port != null;
    return {
      id: r.id,
      port: r.port,
      version: plug?.manifest.version || "",
      siteId: 0,
      panelUrl: canPanel
        ? `/api/v1/plugins/${encodeURIComponent(r.id)}${pathPart}`
        : null,
      n8nWebhookUrl: null,
    };
  });
  return {
    root,
    plugins,
    running,
    logs: host.getPluginLogs?.() ?? [],
  };
}

/** Bind HTTP — Docker/headless : `CREEZIO_HTTP_HOST=0.0.0.0` (ou METIER_HOST). */
export function resolveBrandOsHttpHost(explicit?: string): string {
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

/** Proxy HTTP brut (stream) — UI Next standalone derrière le port unique. */
function proxyRawHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  targetBase: string,
  bufferedBody?: Buffer,
  extraHeaders?: Record<string, string>,
  onDone?: () => void,
): void {
  const target = new URL(targetBase);
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    onDone?.();
  };
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: req.url || "/",
      method: req.method || "GET",
      headers: {
        ...req.headers,
        host: `${target.hostname}:${target.port}`,
        // Host public d'origine (tunnel/reverse proxy) — permet le routage
        // par hostname côté Next (ex. lp.{zone} → /lp, ADR-module-natif-hybride).
        ...(req.headers["x-forwarded-host"] || req.headers.host
          ? {
              "x-forwarded-host": String(
                req.headers["x-forwarded-host"] || req.headers.host,
              ),
            }
          : {}),
        ...(extraHeaders || {}),
      },
    },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
      upRes.on("end", done);
      upRes.on("close", done);
    },
  );
  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(
      JSON.stringify({ ok: false, error: "ui_proxy_error", detail: err.message }),
    );
    done();
  });
  res.on("close", done);
  if (bufferedBody !== undefined) {
    // Rejeu après lecture du body (fallthrough kernel → plane UI).
    upstream.end(bufferedBody);
  } else {
    req.pipe(upstream);
  }
}

export async function listenBrandOsHttp(opts: {
  api: ApiKernel;
  mcp: McpFacade;
  os?: BrandOsComposition | null;
  port?: number;
  host?: string;
  /**
   * Surface OAuth/admin MCP (Hono) — chemins /.well-known, /oauth, /api/v1/admin/mcp.
   */
  mcpSurfaceFetch?: (request: Request) => Promise<Response>;
  mcpSurfaceHandlesPath?: (pathname: string) => boolean;
  /**
   * Surface plateforme (Hono) — auth/tasks/assistant/desktop/users
   * (mountBrandPlatformSurface). Streamée (SSE screencast/desktop-actions).
   */
  platformSurfaceFetch?: (request: Request) => Promise<Response>;
  platformSurfaceHandlesPath?: (pathname: string) => boolean;
  /**
   * Store mails kernel (sinon routes email via CREEZIO_CORE_DB_PATH).
   * Expose POST /api/v1/email/inbound (Worker Cloudflare).
   */
  getMailsStore?: () => SqliteMailsStore | null;
  /**
   * Handoff early-listen boot (listenBrandBootHttp) : reprend le même
   * http.Server déjà à l'écoute — zéro coupure de port pendant le boot.
   */
  existingServer?: http.Server;
  /**
   * Splash serveur : modèle boot exposé sur GET /api/v1/os/boot-status
   * (voir createBootProgressReporter).
   */
  getBootStatus?: () => unknown | null;
  /**
   * Reverse-proxy UI Next standalone (CRM navigateur) : les chemins non-API
   * sont proxifiés vers cette base (démarrée par startBrandUiPlane).
   * `null` tant que l'UI n'est pas prête → 503 ui_starting.
   */
  uiProxyTarget?: () => string | null;
  /**
   * Auth machine sur `/api/v1/modules/*` (clé API brand — Hermes, plugins,
   * n8n) en complément de la session plateforme. Voir
   * createBrandApiKeyModuleVerifier.
   */
  moduleMountMachineKey?: ModuleMachineKeyVerifier;
}): Promise<BrandOsHttpHandle> {
  const host = resolveBrandOsHttpHost(opts.host);
  const existingAddr = opts.existingServer?.address();
  const port =
    typeof existingAddr === "object" && existingAddr?.port
      ? existingAddr.port
      : opts.port && opts.port > 0
        ? opts.port
        : await findFreePort();
  const emailSurface = mountBrandEmailSurface(
    opts.getMailsStore ? { getStore: opts.getMailsStore } : undefined,
  );

  async function proxyHono(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    fetchFn: (request: Request) => Promise<Response>,
    fallbackTarget?: () => string | null,
  ): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const bodyBuf = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v == null) continue;
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else headers.set(k, v);
    }
    const request = new Request(url.toString(), {
      method: req.method || "GET",
      headers,
      body:
        ["GET", "HEAD"].includes(req.method || "GET") || bodyBuf.length === 0
          ? undefined
          : bodyBuf,
    });
    const response = await fetchFn(request);
    // Sous-route inconnue d'un préfixe plateforme (marqueur posé par le
    // notFound de mountBrandPlatformSurface) : la marque peut servir cette
    // route in-plane (ex. /api/v1/desktop/heartbeat TF2) — rejeu vers le
    // plane UI, même contrat que le fallthrough kernel → plane.
    if (
      response.status === 404 &&
      fallbackTarget &&
      // Anti-boucle : si ce hop est D?J? un rejeu OS ? plane (header pos?
      // ci-dessous, m?me marqueur que le fallthrough kernel), ne jamais
      // rejouer. Un plane sans handler in-plane re-proxifie /api vers l'OS
      // (rewrite Next `/api/v1/:path*`) : sans ce garde la requ?te
      // rebondit OS ? UI ? l'infini ? temp?te CPU constat?e sur winhub
      // (POST /api/v1/desktop/heartbeat sans route m?tier in-plane).
      !hasKernelFallthroughHop(req.headers)
    ) {
      const target = fallbackTarget();
      if (target) {
        const probe = await response
          .clone()
          .json()
          .catch(() => null);
        if (
          (probe as { error?: string } | null)?.error ===
          "platform_route_not_found"
        ) {
          proxyRawHttp(req, res, target, bodyBuf, {
            [KERNEL_API_FALLTHROUGH_HEADER]: "1",
          });
          return;
        }
      }
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    // Stream (SSE screencast / desktop-actions) — pas de buffering intégral.
    if (response.body) {
      const nodeStream = Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream,
      );
      nodeStream.pipe(res);
      nodeStream.on("error", () => res.end());
      res.on("close", () => nodeStream.destroy());
    } else {
      res.end();
    }
  }

  const handleRequest = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => {
    try {
      if (req.method === "OPTIONS") {
        send(res, 204, {});
        return;
      }
      const url = new URL(req.url || "/", `http://${host}:${port}`);
      const pathname = url.pathname;

      // Inbox Worker path — avant api-kernel (sinon 404 platform_not_mounted).
      if (emailSurfaceHandlesPath(pathname)) {
        await proxyHono(req, res, url, async (request) =>
          emailSurface.app.fetch(request),
        );
        return;
      }

      // Default-deny `/api/v1/admin/*` AVANT le proxy Hono MCP — sinon
      // status/dbs/tables/endpoints restent publics (foove2#78). OAuth
      // `/.well-known` + `/oauth/*` ne matchent pas `isAdminApiPath`.
      if (isAdminApiPath(pathname)) {
        const adminAuth = await assertModuleMountSession({
          method: req.method || "GET",
          pathname,
          headers: req.headers,
        });
        if (!adminAuth.ok) {
          send(res, adminAuth.status, adminAuth.body);
          return;
        }
      }

      // Proxy Hono OAuth / admin MCP (avant handlers JSON OS).
      if (
        opts.mcpSurfaceFetch &&
        opts.mcpSurfaceHandlesPath?.(pathname)
      ) {
        await proxyHono(req, res, url, opts.mcpSurfaceFetch);
        return;
      }

      // Surface plateforme auth/tasks/assistant (avant api-kernel).
      if (
        opts.platformSurfaceFetch &&
        opts.platformSurfaceHandlesPath?.(pathname)
      ) {
        await proxyHono(
          req,
          res,
          url,
          opts.platformSurfaceFetch,
          opts.uiProxyTarget,
        );
        return;
      }

      // Health racine — sonde testRemoteHealth du client thin (Héberger/Rejoindre).
      if (pathname === "/health" && req.method === "GET") {
        send(res, 200, { ok: true, service: "creezio-server" });
        return;
      }

      // Splash serveur — même modèle que le desktop, en JSON (boot terminé).
      if (pathname === "/api/v1/os/boot-status" && req.method === "GET") {
        const model = opts.getBootStatus?.() ?? null;
        if (!model) {
          send(res, 404, { ok: false, error: "boot_status_unavailable" });
          return;
        }
        send(res, 200, { ok: true, booting: false, ...(model as object) });
        return;
      }

      if (pathname === "/api/v1/os/status" && req.method === "GET") {
        if (!opts.os) {
          send(res, 503, { ok: false, error: "os_not_composed" });
          return;
        }
        send(res, 200, opts.os.status());
        return;
      }

      // Agrégat prêt-à-l'emploi — une seule sonde pour preuves P&P multi-marques.
      if (pathname === "/api/v1/os/ready" && req.method === "GET") {
        if (!opts.os) {
          send(res, 503, {
            ok: false,
            ready: false,
            error: "os_not_composed",
          });
          return;
        }
        const bins = kitBinaryPaths();
        const hermes = opts.os.hostRuntime.hermesHost() as unknown as {
          findHermesBinary: () => string | null;
          getHermesStatusPayload: (mode: "local" | "remote") => {
            status?: string;
          };
        };
        const n8n = opts.os.hostRuntime.n8nHost() as unknown as {
          findN8nEntry: () => string | null;
          getN8nStatusPayload: (mode: "local" | "remote") => {
            status?: string;
          };
        };
        const tunnel = opts.os.hostRuntime.tunnelService() as unknown as {
          getTunnelStatus?: () => {
            publicUrl?: string | null;
            configured?: boolean;
          };
          publicMcpUrl?: () => string | null;
          enableLocalPublicSurface?: (o: {
            localPort: number;
          }) => { publicMcp: string };
        };
        if (
          process.env.CREEZIO_TUNNEL_LOCAL !== "0" &&
          typeof tunnel.enableLocalPublicSurface === "function" &&
          !tunnel.publicMcpUrl?.()
        ) {
          tunnel.enableLocalPublicSurface({ localPort: port });
        }
        const hermesBinary = hermes.findHermesBinary();
        const n8nEntry = n8n.findN8nEntry();
        const n8nVendorManifest = path.join(
          kitOsVendorDir("n8n"),
          "runtime-manifest.json",
        );
        const hermesVendorManifest = path.join(
          kitOsVendorDir("hermes-agent"),
          "runtime-manifest.json",
        );
        const publicMcp = tunnel.publicMcpUrl?.() ?? null;
        const mcpTools = await opts.mcp.listTools();
        const mounts = opts.api.listMounts();
        // Docker/headless : binaires posés dans l'image (MEILI_BINARY) —
        // pas de vendors kit sur disque. CREEZIO_SKIP_KIT_BINARIES=1 assouplit
        // les checks vendors (soft) sans affaiblir le mode desktop.
        const skipKitBinaries =
          process.env.CREEZIO_SKIP_KIT_BINARIES === "1";
        const envMeili = String(process.env.MEILI_BINARY || "").trim();
        const meiliAvailable =
          Boolean(bins.meili) || Boolean(envMeili && fs.existsSync(envMeili));
        const checks = {
          osComposed: true,
          kitMeili: meiliAvailable,
          kitCloudflared: Boolean(bins.cloudflared),
          kitN8nVendor: fs.existsSync(n8nVendorManifest),
          kitHermesVendor: fs.existsSync(hermesVendorManifest),
          n8nEntry: Boolean(n8nEntry),
          hermesBinary: Boolean(hermesBinary),
          tunnelMcpSurface: Boolean(publicMcp),
          mcpTools: mcpTools.tools.length > 0,
          apiMounts: mounts.length > 0,
        };
        // Ready P&P = composition + vendors/binaires kit + surface MCP + mounts.
        // Entry/binary installés = soft (ensure first-run peut les poser).
        // En mode Docker (skipKitBinaries), vendors n8n/Hermes = soft.
        const ready =
          checks.osComposed &&
          checks.kitMeili &&
          (skipKitBinaries ||
            (checks.kitN8nVendor && checks.kitHermesVendor)) &&
          checks.tunnelMcpSurface &&
          checks.mcpTools &&
          checks.apiMounts;
        send(res, ready ? 200 : 503, {
          ok: ready,
          ready,
          checks,
          mode: skipKitBinaries ? "docker" : "desktop",
          publicMcp,
          hermesBinary,
          n8nEntry,
          hermesStatus: hermes.getHermesStatusPayload("local")?.status ?? null,
          n8nStatus: n8n.getN8nStatusPayload("local")?.status ?? null,
          mcpToolCount: mcpTools.tools.length,
          apiMountCount: mounts.length,
          soft: {
            n8nEntry: checks.n8nEntry,
            hermesBinary: checks.hermesBinary,
            kitCloudflared: checks.kitCloudflared,
            ...(skipKitBinaries
              ? {
                  kitN8nVendor: checks.kitN8nVendor,
                  kitHermesVendor: checks.kitHermesVendor,
                }
              : {}),
          },
        });
        return;
      }

      if (pathname === "/api/v1/os/hosts" && req.method === "GET") {
        if (!opts.os) {
          send(res, 503, { ok: false, error: "os_not_composed" });
          return;
        }
        const st = opts.os.status();
        // Instanciation lazy pour prouver que les factories kit existent
        const hermes = opts.os.hostRuntime.hermesHost();
        const n8n = opts.os.hostRuntime.n8nHost();
        const tunnel = opts.os.hostRuntime.tunnelService();
        send(res, 200, {
          ok: true,
          ...st.hosts,
          constructed: {
            hermes: Boolean(hermes),
            n8n: Boolean(n8n),
            tunnel: Boolean(tunnel),
            hermesMethods: Object.keys(hermes || {}).slice(0, 12),
            n8nMethods: Object.keys(n8n || {}).slice(0, 12),
            tunnelMethods: Object.keys(tunnel || {}).slice(0, 12),
          },
        });
        return;
      }

      if (pathname === "/api/v1/os/hermes/status" && req.method === "GET") {
        if (!opts.os) {
          send(res, 503, { ok: false, error: "os_not_composed" });
          return;
        }
        const hermes = opts.os.hostRuntime.hermesHost() as unknown as {
          getHermesStatusPayload: (
            mode: "local" | "remote",
          ) => unknown;
          findHermesBinary: () => string | null;
        };
        const binary = hermes.findHermesBinary();
        send(res, 200, {
          ok: true,
          status: hermes.getHermesStatusPayload("local"),
          binary,
          nativeReady: Boolean(binary),
        });
        return;
      }

      if (pathname === "/api/v1/os/hermes/ensure" && req.method === "POST") {
        if (!opts.os) {
          send(res, 503, { ok: false, error: "os_not_composed" });
          return;
        }
        const hermes = opts.os.hostRuntime.hermesHost() as unknown as {
          ensureHermesRuntimeFromUi: (opts?: {
            onLog?: (line: string) => void;
          }) => Promise<{
            ok: boolean;
            detail?: string;
            binary?: string | null;
            phase?: string;
          }>;
          findHermesBinary: () => string | null;
        };
        const logs: string[] = [];
        const result = await hermes.ensureHermesRuntimeFromUi({
          onLog: (line) => {
            logs.push(line);
            if (logs.length > 80) logs.shift();
          },
        });
        send(res, result.ok ? 200 : 500, {
          ok: result.ok,
          detail: result.detail,
          phase: result.phase,
          binary: result.binary ?? hermes.findHermesBinary(),
          logs: logs.slice(-20),
        });
        return;
      }

      if (pathname === "/api/v1/os/hermes/start" && req.method === "POST") {
        if (!opts.os) {
          send(res, 503, { ok: false, error: "os_not_composed" });
          return;
        }
        const hermes = opts.os.hostRuntime.hermesHost() as unknown as {
          startHermes: (opts: {
            connectionMode: "local" | "remote";
            autoBootstrap?: boolean;
          }) => Promise<unknown>;
          getHermesStatusPayload: (mode: "local" | "remote") => unknown;
          findHermesBinary: () => string | null;
        };
        const running = await hermes.startHermes({
          connectionMode: "local",
          autoBootstrap: true,
        });
        const status = hermes.getHermesStatusPayload("local") as {
          detail?: string;
          status?: string;
          logs?: string[];
        };
        send(res, running ? 200 : 500, {
          ok: Boolean(running),
          running: Boolean(running),
          binary: hermes.findHermesBinary(),
          status,
          detail: status?.detail || null,
        });
        return;
      }

      if (pathname === "/api/v1/os/n8n/status" && req.method === "GET") {
        if (!opts.os) {
          send(res, 503, { ok: false, error: "os_not_composed" });
          return;
        }
        const n8n = opts.os.hostRuntime.n8nHost() as unknown as {
          getN8nStatusPayload: (mode: "local" | "remote") => unknown;
          findN8nEntry: () => string | null;
        };
        const entry = n8n.findN8nEntry();
        send(res, 200, {
          ok: true,
          status: n8n.getN8nStatusPayload("local"),
          entry,
          nativeReady: Boolean(entry),
        });
        return;
      }

      if (pathname === "/api/v1/os/n8n/ensure" && req.method === "POST") {
        if (!opts.os) {
          send(res, 503, { ok: false, error: "os_not_composed" });
          return;
        }
        const n8n = opts.os.hostRuntime.n8nHost() as unknown as {
          ensureN8nRuntimeFromUi: (opts?: {
            onLog?: (line: string) => void;
          }) => Promise<{
            ok: boolean;
            detail?: string;
            entryPath?: string | null;
            phase?: string;
          }>;
          findN8nEntry: () => string | null;
        };
        const logs: string[] = [];
        const result = await n8n.ensureN8nRuntimeFromUi({
          onLog: (line) => {
            logs.push(line);
            if (logs.length > 80) logs.shift();
          },
        });
        send(res, result.ok ? 200 : 500, {
          ok: result.ok,
          detail: result.detail,
          phase: result.phase,
          entry: result.entryPath ?? n8n.findN8nEntry(),
          logs: logs.slice(-20),
        });
        return;
      }

      if (pathname === "/api/v1/os/n8n/start" && req.method === "POST") {
        if (!opts.os) {
          send(res, 503, { ok: false, error: "os_not_composed" });
          return;
        }
        const n8n = opts.os.hostRuntime.n8nHost() as unknown as {
          startN8n: (opts: {
            connectionMode: "local" | "remote";
            autoBootstrap?: boolean;
          }) => Promise<unknown>;
          getN8nStatusPayload: (mode: "local" | "remote") => unknown;
          findN8nEntry: () => string | null;
        };
        const running = await n8n.startN8n({
          connectionMode: "local",
          autoBootstrap: true,
        });
        send(res, running ? 200 : 500, {
          ok: Boolean(running),
          running: Boolean(running),
          entry: n8n.findN8nEntry(),
          status: n8n.getN8nStatusPayload("local"),
        });
        return;
      }

      if (pathname === "/api/v1/os/tunnel/status" && req.method === "GET") {
        if (!opts.os) {
          send(res, 503, { ok: false, error: "os_not_composed" });
          return;
        }
        const tunnel = opts.os.hostRuntime.tunnelService() as unknown as {
          getTunnelStatus?: () => {
            publicUrl?: string | null;
            online?: boolean;
            configured?: boolean;
          };
          publicMcpUrl?: () => string | null;
          publicUrlForEmbedService?: (s: string) => string | null;
          enableLocalPublicSurface?: (o: {
            localPort: number;
          }) => { publicMcp: string };
        };
        let status = tunnel.getTunnelStatus?.() ?? null;
        // Fullstack ready : surface MCP locale dès le premier status si non configuré.
        if (
          process.env.CREEZIO_TUNNEL_LOCAL !== "0" &&
          !status?.configured &&
          typeof tunnel.enableLocalPublicSurface === "function"
        ) {
          tunnel.enableLocalPublicSurface({ localPort: port });
          status = tunnel.getTunnelStatus?.() ?? status;
        }
        const publicMcp =
          tunnel.publicMcpUrl?.() ??
          (status?.publicUrl
            ? `${String(status.publicUrl).replace(/\/$/, "")}/mcp`
            : null);
        send(res, 200, {
          ok: true,
          status,
          publicMcp,
          publicN8n: tunnel.publicUrlForEmbedService?.("n8n") ?? null,
          publicHermes: tunnel.publicUrlForEmbedService?.("hermes") ?? null,
        });
        return;
      }

      // Profil connexion Héberger / Rejoindre (store local-config).
      if (pathname === "/api/v1/os/connection" && req.method === "GET") {
        if (!opts.os) {
          send(res, 503, { ok: false, error: "os_not_composed" });
          return;
        }
        const profile = opts.os.store.getConnectionProfile();
        send(res, 200, {
          ok: true,
          profile,
          public: {
            mode: profile.mode,
            remoteUrl: profile.remoteUrl ?? null,
            localBind: profile.localBind ?? "127.0.0.1",
            chosen: profile.chosen === true,
            activeBaseUrl:
              profile.mode === "remote"
                ? profile.remoteUrl ?? null
                : `http://127.0.0.1:${port}`,
            serverPort: port,
          },
        });
        return;
      }

      if (pathname === "/api/v1/os/connection" && req.method === "POST") {
        if (!opts.os) {
          send(res, 503, { ok: false, error: "os_not_composed" });
          return;
        }
        const body = (await readBody(req)) as Partial<ConnectionProfile>;
        try {
          const ready = sanitizeConnectionProfile(body);
          if (ready.mode === "remote" && !ready.remoteUrl) {
            send(res, 400, { ok: false, error: "remote_url_required" });
            return;
          }
          const saved = opts.os.store.setConnectionProfile(ready);
          send(res, 200, { ok: true, profile: saved });
        } catch (err) {
          send(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (pathname === "/api/v1/os/connection/test" && req.method === "POST") {
        const body = (await readBody(req)) as { remoteUrl?: string };
        const result = await testRemoteHealth(String(body?.remoteUrl || ""));
        send(res, result.ok ? 200 : 400, result);
        return;
      }

      // First-run setup (équivalent SetupWizard sans IPC Electron).
      if (pathname === "/api/v1/os/setup" && req.method === "GET") {
        if (!opts.os) {
          send(res, 503, { ok: false, error: "os_not_composed" });
          return;
        }
        const store = opts.os.store;
        const keys = store.getLlmKeys?.() ?? {};
        const auth = store.getLocalAuth?.();
        const openai = String(keys.openai || "").trim();
        send(res, 200, {
          ok: true,
          setupComplete: store.isSetupComplete(),
          hasOpenai: Boolean(openai && openai !== SETUP_OPENAI_PLACEHOLDER),
          username: auth?.authUser ?? null,
          recoveryHint: store.isSetupComplete()
            ? "recovery key déjà enregistrée"
            : null,
        });
        return;
      }

      if (pathname === "/api/v1/os/setup" && req.method === "POST") {
        if (!opts.os) {
          send(res, 503, { ok: false, error: "os_not_composed" });
          return;
        }
        const body = (await readBody(req)) as {
          username?: string;
          password?: string;
          openaiKey?: string;
          recoveryKey?: string;
          stayLoggedIn?: boolean;
        };
        try {
          const recoveryKey =
            String(body.recoveryKey || "").trim() || generateRecoveryKey();
          const openaiKey = resolveSetupOpenaiKey(body.openaiKey);
          // Parité Electron setup:complete — clé vide refusée (applyFirstRunSetup aussi).
          if (!openaiKey) {
            send(res, 400, { ok: false, error: "Clé OpenAI requise" });
            return;
          }
          const username = String(body.username || "").trim();
          const password = String(body.password || "");
          opts.os.store.applyFirstRunSetup({
            username,
            password,
            openaiKey,
            recoveryKey,
            stayLoggedIn: body.stayLoggedIn !== false,
          });
          // Assistant Hono lit process.env — injecter tout de suite (Docker/HTTP).
          applyStoredLlmEnv(opts.os, {
            force: true,
            log: (line) => console.log(`[os-setup] ${line}`),
          });
          // Login CRM kit-first : sans creezio_users, /auth/login → 401 et le
          // chat « mange » le message. Parité geste fleet-ops (étape b).
          const cred = await migrateBrandCredentialsToKit({
            username,
            password,
            displayName: username,
          });
          if (!cred.ok && !cred.skipped) {
            console.warn(
              `[os-setup] migrateBrandCredentialsToKit: ${cred.error}`,
            );
          }
          send(res, 200, {
            ok: true,
            setupComplete: true,
            recoveryKey,
            username,
          });
        } catch (err) {
          send(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (pathname === "/api/v1/os/plugins" && req.method === "GET") {
        if (!opts.os) {
          send(res, 503, { ok: false, error: "os_not_composed" });
          return;
        }
        const mode = opts.os.status().hosts.plugins;
        if (mode === "feature-off") {
          send(res, 200, {
            ok: true,
            mode: "feature-off",
            plugins: [],
            hint: "plugins désactivés (features.plugins=false ou kill-switch CREEZIO_PLUGINS=0) — actifs par défaut sinon",
          });
          return;
        }
        try {
          const host = opts.os.hostStack.hostPlugins() as Parameters<
            typeof buildOsPluginsWebStatus
          >[0];
          const status = buildOsPluginsWebStatus(host);
          send(res, 200, {
            ok: true,
            mode: "enabled",
            root: status.root,
            plugins: status.plugins,
            count: status.plugins.length,
            status,
          });
        } catch (err) {
          send(res, 500, {
            ok: false,
            mode: "enabled",
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (pathname === "/api/v1/os/tunnel/local" && req.method === "POST") {
        if (!opts.os) {
          send(res, 503, { ok: false, error: "os_not_composed" });
          return;
        }
        const tunnel = opts.os.hostRuntime.tunnelService() as unknown as {
          enableLocalPublicSurface: (o: {
            localPort: number;
            slug?: string;
          }) => { ok: true; publicUrl: string; publicMcp: string };
          getTunnelStatus: () => unknown;
        };
        const body = (await readBody(req)) as {
          localPort?: number;
          slug?: string;
        };
        const localPort =
          Number(body?.localPort) > 0 ? Number(body.localPort) : port;
        const enabled = tunnel.enableLocalPublicSurface({
          localPort,
          slug: body?.slug,
        });
        send(res, 200, {
          ...enabled,
          status: tunnel.getTunnelStatus(),
        });
        return;
      }

      if (pathname === "/api/v1/os/tunnel/start" && req.method === "POST") {
        if (!opts.os) {
          send(res, 503, { ok: false, error: "os_not_composed" });
          return;
        }
        const tunnel = opts.os.hostRuntime.tunnelService() as unknown as {
          startCloudflared: () => Promise<void>;
          getTunnelStatus: () => { online?: boolean; error?: string | null };
          publicMcpUrl: () => string | null;
          enableLocalPublicSurface: (o: {
            localPort: number;
          }) => { ok: true; publicUrl: string; publicMcp: string };
        };
        try {
          await tunnel.startCloudflared();
          let status = tunnel.getTunnelStatus();
          // Sans token/bin cloudflared → surface locale MCP (fullstack ready).
          if (!status.online && !tunnel.publicMcpUrl()) {
            tunnel.enableLocalPublicSurface({ localPort: port });
            status = tunnel.getTunnelStatus();
          }
          send(res, 200, {
            ok: true,
            status,
            publicMcp: tunnel.publicMcpUrl(),
          });
        } catch (err) {
          tunnel.enableLocalPublicSurface({ localPort: port });
          send(res, 200, {
            ok: true,
            fallback: "local",
            detail: err instanceof Error ? err.message : String(err),
            status: tunnel.getTunnelStatus(),
            publicMcp: tunnel.publicMcpUrl(),
          });
        }
        return;
      }

      if (
        (pathname === "/mcp" || pathname === "/api/v1/mcp") &&
        (req.method === "GET" || req.method === "POST")
      ) {
        // ACL plugins (H5) : le Bearer est transmis à la façade — un JWT
        // signé MCP_JWT_SECRET porte sub/orgId/isOwner pour decidePluginAccess.
        const bearerToken =
          (Array.isArray(req.headers.authorization)
            ? req.headers.authorization[0]
            : req.headers.authorization) || null;
        if (req.method === "GET") {
          const listed = await opts.mcp.listTools({ bearerToken });
          send(res, 200, {
            ok: true,
            transport: "json",
            tools: listed.tools,
          });
          return;
        }
        const rawBody = (await readBody(req)) as unknown;
        // H1 — client MCP natif (Hermes, SDK officiels) : JSON-RPC 2.0
        // stateless. Les corps sans `jsonrpc` gardent le transport historique.
        if (isJsonRpcBody(rawBody)) {
          const rpc = await handleMcpJsonRpcRequest({
            mcp: opts.mcp,
            body: rawBody,
            bearerToken,
          });
          if (rpc.body === null) {
            res.writeHead(rpc.status, { "content-length": "0" });
            res.end();
            return;
          }
          send(res, rpc.status, rpc.body);
          return;
        }
        const body = rawBody as {
          method?: string;
          params?: { name?: string; arguments?: Record<string, unknown> };
          name?: string;
          arguments?: Record<string, unknown>;
        } | null;
        const method = body?.method || "tools/call";
        if (method === "tools/list") {
          const listed = await opts.mcp.listTools({ bearerToken });
          send(res, 200, { ok: true, tools: listed.tools });
          return;
        }
        const name = body?.params?.name || body?.name;
        const args = body?.params?.arguments || body?.arguments || {};
        if (!name) {
          send(res, 400, { ok: false, error: "tool_name_required" });
          return;
        }
        const result = await opts.mcp.callTool(name, args, { bearerToken });
        send(res, result.ok ? 200 : 400, result);
        return;
      }

      // CRM navigateur : chemins non-API → UI Next standalone (proxy stream).
      if (
        opts.uiProxyTarget &&
        !pathname.startsWith("/api/") &&
        pathname !== "/mcp"
      ) {
        const target = opts.uiProxyTarget();
        if (!target) {
          send(res, 503, {
            ok: false,
            error: "ui_starting",
            hint: "UI Next en cours de démarrage — réessayer dans quelques secondes",
          });
          return;
        }
        proxyRawHttp(req, res, target);
        return;
      }

      const query = Object.fromEntries(url.searchParams.entries());
      const hasBody = ["POST", "PUT", "PATCH", "DELETE"].includes(
        req.method || "",
      );
      const rawBody = hasBody ? await readRawBody(req) : Buffer.alloc(0);
      let body: unknown;
      try {
        body = hasBody ? parseJsonBody(rawBody) : undefined;
      } catch {
        // Body non-JSON (multipart / texte) : le kernel n'en veut pas, mais
        // le plane UI marque (fallthrough) peut le consommer tel quel.
        body = undefined;
      }
      // F3 / DASH-5 — mounts `/api/v1/modules/*` : session obligatoire sauf
      // allowlist (webhooks, register/heartbeat, agent releases, LP public).
      const moduleAuth = await assertModuleMountSession({
        method: req.method || "GET",
        pathname,
        headers: req.headers,
        ...(opts.moduleMountMachineKey
          ? { verifyMachineKey: opts.moduleMountMachineKey }
          : {}),
      });
      if (!moduleAuth.ok) {
        send(res, moduleAuth.status, moduleAuth.body);
        return;
      }
      const result = await opts.api.handle({
        method: req.method || "GET",
        path: pathname,
        body,
        ...(hasBody && rawBody.length
          ? { rawBody: rawBody.toString("utf8") }
          : {}),
        query,
        headers: req.headers as Record<
          string,
          string | string[] | undefined
        >,
      });
      // Routes API propres à la marque servies par le plane UI Next
      // (contrat de composition kernel — voir isKernelFallthrough404).
      // Coupe-circuit boucle kernel→Next→kernel (rewrite next.config).
      //
      // EXCEPTION `/api/v1/modules/*` : un 404 `{ error: "not_found" }` est
      // souvent une réponse métier / tenancy (anti-fuite d'existence). Le
      // rejouer vers Next (rewrite figé sur METIER_BASE_URL au build, ex.
      // :18791) peut frapper un harness stale et renvoyer 401 unauthorized
      // — le client croit alors à un bug de session. Servir le 404 module
      // tel quel.
      if (
        isKernelFallthrough404(result) &&
        opts.uiProxyTarget &&
        !pathname.startsWith("/api/v1/modules/")
      ) {
        const fallthroughKey = `${req.method || "GET"} ${pathname}`;
        if (
          hasKernelFallthroughHop(req.headers) ||
          inflightApiFallthrough.has(fallthroughKey)
        ) {
          send(res, result.status || 404, result.body, result.headers);
          return;
        }
        const target = opts.uiProxyTarget();
        if (target) {
          inflightApiFallthrough.add(fallthroughKey);
          proxyRawHttp(
            req,
            res,
            target,
            rawBody,
            { [KERNEL_API_FALLTHROUGH_HEADER]: "1" },
            () => {
              inflightApiFallthrough.delete(fallthroughKey);
            },
          );
          return;
        }
      }
      send(res, result.status || 200, result.body, result.headers);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send(res, 500, { error: message });
    }
  };

  let server: http.Server;
  if (opts.existingServer) {
    // Handoff early-listen : même socket, nouveau handler.
    server = opts.existingServer;
    server.removeAllListeners("request");
    server.on("request", handleRequest);
  } else {
    server = http.createServer(handleRequest);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => resolve());
    });
  }

  return {
    port,
    baseUrl: advertiseBaseUrl(host, port),
    server,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        // server.close() attend la fin des connexions keep-alive — sans
        // closeIdleConnections(), un client silencieux (SSE, fetch agent
        // keep-alive) bloque l'arrêt jusqu'au SIGKILL (budget docker stop
        // ~10 s) et laisse un WAL chaud. On ferme les idles tout de suite,
        // et on détruit les actives après 2 s de grâce.
        server.closeIdleConnections?.();
        const killer = setTimeout(() => {
          server.closeAllConnections?.();
        }, 2000);
        killer.unref?.();
      }),
  };
}
