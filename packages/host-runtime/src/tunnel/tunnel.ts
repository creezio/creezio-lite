/**
 * Cloudflare Tunnel — service brand-agnostic.
 *
 * Auto-provisioning par l'instance elle-même via l'API Cloudflare (client
 * `@creezio/platform-core` : tunnel-cf / tunnel-cf-client) — le provisioner
 * VPS et le sidecar cloudflared sont supprimés (0.10.0, D3) : cloudflared
 * tourne in-process, mode unique, **supervisé** (respawn borné si exit ≠ 0
 * ou mort inattendue ; même tunnel id persisté). Contrat d'env : `CREEZIO_CF_API_TOKEN` /
 * `CREEZIO_CF_ACCOUNT_ID` / `CREEZIO_CF_ZONE_ID` (+ variantes marque),
 * arrivant au conteneur via `cf.env` (chmod 600) généré par le CLI.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildTunnelPublicUrls,
  deriveTunnelServiceUrl,
  ensureCfTunnel,
  HERMES_DESKTOP_WEBUI_PORT,
  missingCfTunnelEnvKeys,
  N8N_DESKTOP_PORT,
  parseExtraHostnames,
  resolveCfTunnelEnv,
  resolveCfZoneName,
  resolveTunnelHostMode,
  slugCheckLocal,
  TUNNEL_UNIVERSAL_SSL_ENV,
  type TunnelEmbedService,
  type TunnelHostMode,
  type TunnelPublicUrls,
} from "@creezio/platform-core";
import type { HostRuntimeContext } from "../context.js";
import { hostLog, hostProductName } from "../context.js";
import { kitOsResourcesRoot } from "@creezio/platform-core";
import type { LocalConfigStore, TunnelConfig } from "../local-config.js";
import { applyOsSandboxEnv } from "../sandbox/embed-sandbox.js";
import {
  resolveCloudflaredRespawnPolicy,
  shouldRespawnCloudflared,
} from "./cloudflared-respawn.js";

export type TunnelRuntimeStatus = {
  configured: boolean;
  slug: string | null;
  hostname: string | null;
  publicUrl: string | null;
  publicUrls: TunnelPublicUrls | null;
  online: boolean;
  error: string | null;
  pcMustBeOn: true;
};

export type TunnelIngressPorts = {
  crmPort: number;
  n8nPort?: number | null;
  hermesPort?: number | null;
};

export type TunnelService = {
  getTunnelStatus: () => TunnelRuntimeStatus;
  checkTunnelSlug: (
    slug: string,
  ) => Promise<{ available: boolean; reason?: string; hostname?: string }>;
  reserveTunnel: (
    slug: string,
    localPort: number,
  ) => Promise<
    | { ok: true; hostname: string; publicUrl: string }
    | { ok: false; error: string }
  >;
  configureTunnelIngress: (ports: TunnelIngressPorts) => Promise<void>;
  /**
   * Surface publique locale (sans Cloudflare) — MCP = `{publicUrl}/mcp`.
   * Utilisé quand l'auto-provisioning CF n'est pas configuré / en harness.
   */
  enableLocalPublicSurface: (opts: {
    localPort: number;
    slug?: string;
  }) => { ok: true; publicUrl: string; publicMcp: string };
  /** CRM public URL + `/mcp` (tunnel réel ou surface locale). */
  publicMcpUrl: () => string | null;
  publicUrlForEmbedService: (service: TunnelEmbedService) => string | null;
  startCloudflared: () => Promise<void>;
  stopCloudflared: () => void;
  forgetTunnel: () => void;
  publicUrlForServer: () => string | null;
};

function cloudflaredBinary(
  ctx: HostRuntimeContext,
): string | null {
  const envKey = `${ctx.manifest.envPrefix}_CLOUDFLARED_BINARY`;
  if (!ctx.isPackaged) {
    // Override marque puis générique kit (image Docker : /opt/creezio/bin).
    for (const key of [envKey, "CREEZIO_CLOUDFLARED_BINARY"]) {
      const override = (process.env[key] || "").trim();
      if (override && fs.existsSync(override)) return override;
    }
  }
  const name =
    process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const candidates = [
    path.join(ctx.resourcesRoot, "bin", name),
    path.join(ctx.resourcesRoot, "resources", "bin", name),
    path.join(kitOsResourcesRoot(), "bin", name),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function createTunnelService(opts: {
  ctx: HostRuntimeContext;
  store: LocalConfigStore;
}): TunnelService {
  const { ctx, store } = opts;
  let child: ChildProcess | null = null;
  let lastError: string | null = null;
  let online = false;
  let stopping = false;
  let respawnTimer: ReturnType<typeof setTimeout> | null = null;
  let consecutiveFailures = 0;
  let startedAtMs: number | null = null;

  /** Contrat CF résolu depuis l'env (variante marque d'abord). */
  function cfEnv() {
    return resolveCfTunnelEnv(process.env, ctx.manifest.envPrefix);
  }

  function cfEnvError(): string {
    const missing = missingCfTunnelEnvKeys(
      process.env,
      ctx.manifest.envPrefix,
    ).join(", ");
    return `Auto-provisioning tunnel non configuré (${missing} requis — cf.env de l'instance)`;
  }

  /**
   * Mode de hostnames (D2, mécanique unique) : env
   * `CREEZIO_CF_UNIVERSAL_SSL` truthy → nested ; sinon flat (défaut).
   * `manifest.tunnelHostMode` reste le défaut marque quand l'env est absente.
   */
  function brandHostMode(): TunnelHostMode {
    const envRaw = String(process.env[TUNNEL_UNIVERSAL_SSL_ENV] || "").trim();
    if (envRaw) return resolveTunnelHostMode();
    return resolveTunnelHostMode(ctx.manifest.tunnelHostMode);
  }

  /** `CREEZIO_DOMAIN` (variante marque d'abord) — hostname complet custom. */
  function instanceDomain(): string {
    const prefix = ctx.manifest.envPrefix;
    return (
      String(process.env[`${prefix}_DOMAIN`] || "").trim() ||
      String(process.env.CREEZIO_DOMAIN || "").trim()
    ).toLowerCase();
  }

  /** D1 — hostnames supplémentaires sur le même tunnel (virgules). */
  function extraHostnames(): string[] {
    const prefix = ctx.manifest.envPrefix;
    return parseExtraHostnames(
      process.env[`${prefix}_TUNNEL_EXTRA_HOSTNAMES`] ||
        process.env.CREEZIO_TUNNEL_EXTRA_HOSTNAMES,
    );
  }

  function urlsForHostname(hostname: string): TunnelPublicUrls {
    return buildTunnelPublicUrls(hostname, brandHostMode());
  }

  function getTunnelStatus(): TunnelRuntimeStatus {
    const cfg = store.getTunnelConfig();
    const isLocalSurface =
      Boolean(cfg?.publicUrl?.startsWith("http://127.0.0.1")) ||
      cfg?.tunnelToken === "local" ||
      String(cfg?.tunnelId || "").startsWith("local-");
    const mode = brandHostMode();
    // Exiger hostMode aligné — sinon rebuild (migration nested↔flat).
    const storedOk =
      Boolean(cfg?.publicUrls?.n8n && cfg?.publicUrls?.hermes) &&
      cfg?.hostMode === mode;
    const publicUrls = isLocalSurface
      ? cfg?.publicUrls || {
          crm: cfg!.publicUrl,
          n8n: `http://127.0.0.1:${N8N_DESKTOP_PORT}`,
          hermes: `http://127.0.0.1:${HERMES_DESKTOP_WEBUI_PORT}`,
        }
      : storedOk
        ? cfg!.publicUrls!
        : cfg?.hostname
          ? urlsForHostname(cfg.hostname)
          : null;
    return {
      configured: Boolean(cfg),
      slug: cfg?.slug ?? null,
      hostname: cfg?.hostname ?? null,
      publicUrl: cfg?.publicUrl ?? null,
      publicUrls,
      online: isLocalSurface
        ? online
        : online && Boolean(child && !child.killed),
      error: lastError,
      pcMustBeOn: true,
    };
  }

  async function checkTunnelSlug(slug: string) {
    const mode = brandHostMode();
    const local = slugCheckLocal(slug, { hostMode: mode });
    if (!local.available) {
      return { available: false, reason: local.reason };
    }
    const env = cfEnv();
    let zone = "";
    if (env) {
      try {
        zone = await resolveCfZoneName(env);
      } catch (err) {
        return {
          available: false,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    } else {
      zone = (
        process.env.CREEZIO_CF_ZONE_NAME ||
        ctx.manifest.tunnelRootDomain ||
        ""
      ).trim();
    }
    return {
      available: true,
      hostname: `${slug}.${zone || "localhost"}`,
    };
  }

  async function reserveTunnel(slug: string, localPort: number) {
    const env = cfEnv();
    if (!env) {
      return { ok: false as const, error: cfEnvError() };
    }
    // Réutilisation du tunnel persisté uniquement pour le MÊME slug — un
    // changement de slug crée un tunnel neuf (l'ancien est nettoyé via
    // `server-docker rm` / forgetTunnel, comme avant).
    const existing = store.getTunnelConfig();
    const reusable =
      existing &&
      existing.slug === slug &&
      Boolean(existing.tunnelId) &&
      Boolean(existing.tunnelToken) &&
      existing.tunnelToken !== "local";
    try {
      const result = await ensureCfTunnel(env, {
        slug,
        domain: instanceDomain() || undefined,
        ports: {
          crmPort: localPort,
          n8nPort: N8N_DESKTOP_PORT,
          hermesPort: HERMES_DESKTOP_WEBUI_PORT,
        },
        hostMode: brandHostMode(),
        extraHostnames: extraHostnames(),
        stored: reusable
          ? { tunnelId: existing!.tunnelId, tunnelToken: existing!.tunnelToken }
          : null,
        log: (line) => hostLog(ctx, "tunnel", line),
      });
      const emailSecret = (
        process.env[`${ctx.manifest.envPrefix}_EMAIL_INBOUND_SECRET`] ||
        process.env.CREEZIO_EMAIL_INBOUND_SECRET ||
        process.env.EMAIL_INBOUND_SECRET ||
        ""
      ).trim();
      if (emailSecret) store.setEmailInboundSecret(emailSecret);
      const publicUrls =
        "n8n" in result.publicUrls
          ? result.publicUrls
          : urlsForHostname(result.hostname);
      store.setTunnelConfig({
        slug: result.slug,
        hostname: result.hostname,
        publicUrl: result.publicUrl,
        tunnelId: result.tunnelId,
        tunnelToken: result.tunnelToken,
        localPort,
        publicUrls,
        hostMode: result.hostMode,
        emailDomain:
          result.emailDomain ||
          `${result.slug}.mail.${ctx.manifest.tunnelRootDomain}`,
        servicePorts: {
          n8n: N8N_DESKTOP_PORT,
          hermes: HERMES_DESKTOP_WEBUI_PORT,
        },
      });
      return {
        ok: true as const,
        hostname: result.hostname,
        publicUrl: result.publicUrl,
      };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async function configureTunnelIngress(ports: TunnelIngressPorts) {
    const cfg = store.getTunnelConfig();
    if (!cfg) return;
    // Surface locale (harness / sans CF) : rien à configurer côté Cloudflare.
    if (!cfg.tunnelId || !cfg.tunnelToken || cfg.tunnelToken === "local") {
      return;
    }
    const env = cfEnv();
    if (!env) {
      throw new Error(cfEnvError());
    }
    const n8nPort = ports.n8nPort ?? cfg.servicePorts?.n8n ?? N8N_DESKTOP_PORT;
    const hermesPort =
      ports.hermesPort ??
      cfg.servicePorts?.hermes ??
      HERMES_DESKTOP_WEBUI_PORT;
    // ensureCfTunnel = PUT ingress (ports à jour, jamais de règle agent) +
    // DNS idempotent + self-healing si le tunnel a disparu côté CF.
    const result = await ensureCfTunnel(env, {
      slug: cfg.slug,
      domain: instanceDomain() || cfg.hostname,
      ports: { crmPort: ports.crmPort, n8nPort, hermesPort },
      hostMode: cfg.hostMode ?? brandHostMode(),
      extraHostnames: extraHostnames(),
      stored: { tunnelId: cfg.tunnelId, tunnelToken: cfg.tunnelToken },
      log: (line) => hostLog(ctx, "tunnel", line),
    });
    const publicUrls =
      "n8n" in result.publicUrls ? result.publicUrls : cfg.publicUrls;
    store.setTunnelConfig({
      ...cfg,
      hostname: result.hostname,
      publicUrl: result.publicUrl,
      tunnelId: result.tunnelId,
      tunnelToken: result.tunnelToken,
      localPort: ports.crmPort,
      servicePorts: { n8n: n8nPort, hermes: hermesPort },
      publicUrls,
      hostMode: result.hostMode,
      emailDomain: result.emailDomain || cfg.emailDomain,
    });
    hostLog(
      ctx,
      "tunnel",
      `ingress CRM:${ports.crmPort} n8n:${n8nPort} hermes:${hermesPort}`,
    );
  }

  function publicUrlForEmbedService(
    service: TunnelEmbedService,
  ): string | null {
    const cfg = store.getTunnelConfig();
    if (!cfg?.hostname) return null;
    // Surface locale : hostname = 127.0.0.1:port → publicUrl déjà canonique.
    if (cfg.publicUrl?.startsWith("http://127.0.0.1")) {
      if (service === "n8n") {
        return `http://127.0.0.1:${N8N_DESKTOP_PORT}`;
      }
      if (service === "hermes") {
        return `http://127.0.0.1:${HERMES_DESKTOP_WEBUI_PORT}`;
      }
    }
    const mode = brandHostMode();
    if (cfg.publicUrls?.[service] && cfg.hostMode === mode) {
      return cfg.publicUrls[service];
    }
    return urlsForHostname(cfg.hostname)[service] || null;
  }

  function publicMcpUrl(): string | null {
    const cfg = store.getTunnelConfig();
    if (!cfg?.publicUrl) return null;
    return `${String(cfg.publicUrl).replace(/\/$/, "")}/mcp`;
  }

  function enableLocalPublicSurface(opts: {
    localPort: number;
    slug?: string;
  }): { ok: true; publicUrl: string; publicMcp: string } {
    const slug = (opts.slug || ctx.manifest.brandId || "local")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-");
    const publicUrl = `http://127.0.0.1:${opts.localPort}`;
    const hostname = `127.0.0.1:${opts.localPort}`;
    store.setTunnelConfig({
      slug,
      hostname,
      publicUrl,
      tunnelId: `local-${slug}`,
      tunnelToken: "local",
      localPort: opts.localPort,
      publicUrls: {
        crm: publicUrl,
        n8n: `http://127.0.0.1:${N8N_DESKTOP_PORT}`,
        hermes: `http://127.0.0.1:${HERMES_DESKTOP_WEBUI_PORT}`,
      },
      emailDomain: `${slug}.mail.localhost`,
      servicePorts: {
        n8n: N8N_DESKTOP_PORT,
        hermes: HERMES_DESKTOP_WEBUI_PORT,
      },
    });
    online = true;
    lastError = null;
    hostLog(ctx, "tunnel", `surface locale MCP ${publicUrl}/mcp`);
    return { ok: true, publicUrl, publicMcp: `${publicUrl}/mcp` };
  }

  function clearRespawnTimer(): void {
    if (respawnTimer) {
      clearTimeout(respawnTimer);
      respawnTimer = null;
    }
  }

  /**
   * Spawn cloudflared avec le token persisté. Ne (re)crée jamais un tunnel
   * id — `ensureCfTunnel` / `reserveTunnel` restent les seuls chemins API.
   */
  function spawnCloudflaredProcess(): void {
    if (stopping) return;
    const cfg = store.getTunnelConfig();
    if (!cfg?.tunnelToken || cfg.tunnelToken === "local") {
      lastError = null;
      online = false;
      return;
    }
    const bin = cloudflaredBinary(ctx);
    if (!bin) {
      lastError = `Binaire cloudflared introuvable (resources/bin). Réinstallez ${hostProductName(ctx)}.`;
      online = false;
      throw new Error(lastError);
    }
    lastError = null;
    const tunnelId = cfg.tunnelId;
    hostLog(ctx, "tunnel", `spawn ${bin} tunnel run (id ${tunnelId})`);
    startedAtMs = Date.now();
    child = spawn(
      bin,
      ["tunnel", "--no-autoupdate", "run", "--token", cfg.tunnelToken],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: applyOsSandboxEnv({
          env: { ...process.env },
          profileHome: path.join(ctx.userDataDir, "tunnel-home"),
          userData: ctx.userDataDir,
          toolDirs: [],
        }),
      },
    );
    const onLine = (line: string) => {
      hostLog(ctx, "tunnel", line);
      if (/Registered tunnel connection|Connected to Cloudflare/i.test(line)) {
        online = true;
        lastError = null;
      }
      if (/error|failed/i.test(line) && !/0 error/i.test(line)) {
        lastError = line.slice(0, 300);
      }
    };
    child.stdout?.on("data", (d: Buffer) =>
      d.toString().split("\n").filter(Boolean).forEach(onLine),
    );
    child.stderr?.on("data", (d: Buffer) =>
      d.toString().split("\n").filter(Boolean).forEach(onLine),
    );
    child.on("error", (e) => {
      lastError = e.message;
      online = false;
      hostLog(ctx, "tunnel", `error: ${e.message}`);
    });
    child.on("exit", (code, signal) => {
      online = false;
      child = null;
      const decision = shouldRespawnCloudflared({
        stopping,
        consecutiveFailures,
        startedAtMs,
        exit: { code, signal },
        policy: resolveCloudflaredRespawnPolicy(),
      });
      if (decision.action === "ignore") return;
      consecutiveFailures = decision.attempt;
      if (decision.action === "give-up") {
        lastError = `cloudflared ${decision.reason} — abandon après ${decision.attempt} essai(s)`;
        hostLog(ctx, "tunnel", lastError);
        return;
      }
      lastError = `cloudflared ${decision.reason}`;
      hostLog(
        ctx,
        "tunnel",
        `${lastError} — respawn #${decision.attempt} dans ${decision.delayMs}ms (id ${tunnelId} réutilisé)`,
      );
      clearRespawnTimer();
      respawnTimer = setTimeout(() => {
        respawnTimer = null;
        if (stopping) return;
        try {
          spawnCloudflaredProcess();
          if (child && !child.killed) online = true;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          hostLog(ctx, "tunnel", `respawn failed: ${lastError}`);
        }
      }, decision.delayMs);
      respawnTimer.unref?.();
    });
  }

  async function startCloudflared(): Promise<void> {
    const cfg = store.getTunnelConfig();
    if (!cfg?.tunnelToken || cfg.tunnelToken === "local") {
      lastError = null;
      online = false;
      return;
    }
    if (child && !child.killed) {
      online = true;
      return;
    }
    stopping = false;
    consecutiveFailures = 0;
    clearRespawnTimer();
    spawnCloudflaredProcess();
    await new Promise((r) => setTimeout(r, 1500));
    if (child && !child.killed) online = true;
  }

  function stopCloudflared(): void {
    stopping = true;
    clearRespawnTimer();
    if (child) {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      child = null;
    }
    online = false;
    startedAtMs = null;
  }

  function forgetTunnel(): void {
    stopCloudflared();
    store.clearTunnelConfig();
    lastError = null;
  }

  function publicUrlForServer(): string | null {
    return store.getTunnelConfig()?.publicUrl ?? null;
  }

  return {
    getTunnelStatus,
    checkTunnelSlug,
    reserveTunnel,
    configureTunnelIngress,
    enableLocalPublicSurface,
    publicMcpUrl,
    publicUrlForEmbedService,
    startCloudflared,
    stopCloudflared,
    forgetTunnel,
    publicUrlForServer,
  };
}

export { buildTunnelPublicUrls, deriveTunnelServiceUrl };
export type { TunnelConfig };
