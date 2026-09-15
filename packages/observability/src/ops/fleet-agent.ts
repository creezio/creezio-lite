/**
 * Agent télémétrie flotte — heartbeat + sync opt-in.
 * Agent flotte (R4) — endpoint / consent / IDs = hooks.
 * Best-effort : jamais de throw vers le boot.
 */

import os from "node:os";
import {
  currentBootSummary,
  drainPendingOpsEvents,
} from "./journal.js";

export type FleetHealthSnapshot = {
  next?: string;
  meili?: string;
  n8n?: string;
  hermes?: string;
  tunnel?: string;
};

export type FleetTelemetrySnapshot = {
  enabled: boolean;
  scopes: Record<string, boolean> | string[] | unknown;
  consentAt?: string | null;
  consentVersion?: number | string | null;
};

export type FleetAgentRuntimeHooks = {
  /** Kind d'app packagée (server / legacy unpackaged). */
  appKind?: "server" | "client" | "legacy";
  getHealth: () => FleetHealthSnapshot | Promise<FleetHealthSnapshot>;
  getPluginsSummary?: () =>
    | Array<{ id: string; name: string; version: string; enabled: boolean }>
    | Promise<Array<{ id: string; name: string; version: string; enabled: boolean }>>;
  getUsersSummary?: () =>
    | Array<{
        id: string;
        username?: string;
        email?: string;
        role?: string;
        kind?: string;
        active?: boolean;
      }>
    | Promise<
        Array<{
          id: string;
          username?: string;
          email?: string;
          role?: string;
          kind?: string;
          active?: boolean;
        }>
      >;
  getSessionsSummary?: () =>
    | Array<{ userId: string; username?: string; lastSeen?: string }>
    | Promise<Array<{ userId: string; username?: string; lastSeen?: string }>>;
  getHermesStats?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  getRequestLogsSample?: () =>
    | Array<Record<string, unknown>>
    | Promise<Array<Record<string, unknown>>>;
  getHermesChatsSample?: () =>
    | Array<Record<string, unknown>>
    | Promise<Array<Record<string, unknown>>>;
  getAssistantChatsSample?: () =>
    | Array<Record<string, unknown>>
    | Promise<Array<Record<string, unknown>>>;
  getActionsSample?: () =>
    | Array<Record<string, unknown>>
    | Promise<Array<Record<string, unknown>>>;
  /**
   * Champs métier marque à fusionner dans le heartbeat (ex. stats dossier)
   * — best-effort, scope heartbeat.
   */
  getHeartbeatExtras?: () =>
    | Record<string, unknown>
    | null
    | Promise<Record<string, unknown> | null>;
  executeRemoteCommand?: (
    cmd: string,
    args?: Record<string, unknown>,
  ) => Promise<{ ok: boolean; detail: string }>;
};

export type CreateFleetAgentOptions = {
  /** Base URL flotte (sans slash final). */
  baseUrl: string;
  getConfig: () => FleetTelemetrySnapshot;
  isScopeActive: (cfg: FleetTelemetrySnapshot, scope: string) => boolean;
  getInstallId: () => string;
  getAppVersion: () => string;
  getTunnelInfo?: () => { slug?: string | null; hostname?: string | null } | null;
  log?: (scope: string, line: string) => void;
  logFileTail?: (maxBytes: number) => string | null;
  heartbeatMs?: number;
  commandPollMs?: number;
};

const DEFAULT_HEARTBEAT_MS = 60_000;
const DEFAULT_COMMAND_POLL_MS = 45_000;

export type FleetAgent = {
  startFleetAgent: (h: FleetAgentRuntimeHooks) => void;
  stopFleetAgent: () => void;
  notifyFleetConfigChanged: () => void;
  sendFleetHeartbeat: () => Promise<boolean>;
  sendFleetCrash: (report: Record<string, unknown>) => void;
  uploadFleetDiagnostics: (
    reason: string,
  ) => Promise<{ ok: boolean; detail: string }>;
  fleetEndpointBase: () => string;
};

export function createFleetAgent(opts: CreateFleetAgentOptions): FleetAgent {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  // Endpoint sentinelle « désactivé » (défaut compose-brand-os sans
  // CREEZIO_FLEET_ENDPOINT) — même motif que crash-reporter /crash-disabled/ :
  // aucun POST/GET réseau, pas de spam DNS/timeout dans les logs.
  const ingestDisabled = /ingest-disabled/i.test(baseUrl);
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const commandPollMs = opts.commandPollMs ?? DEFAULT_COMMAND_POLL_MS;
  const log = opts.log || ((scope, line) => console.log(`[${scope}] ${line}`));

  let hooks: FleetAgentRuntimeHooks | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let commandTimer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let lastSentLogTailHash = "";

  function cfg(): FleetTelemetrySnapshot {
    return opts.getConfig();
  }

  function scopeOn(scope: string): boolean {
    return opts.isScopeActive(cfg(), scope);
  }

  async function postJson(
    pathSuffix: string,
    body: unknown,
  ): Promise<{ ok: boolean; status: number; json?: unknown }> {
    try {
      const res = await fetch(`${baseUrl}${pathSuffix}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      });
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = undefined;
      }
      return { ok: res.ok, status: res.status, json };
    } catch (e) {
      log(
        "fleet",
        `POST ${pathSuffix} failed: ${e instanceof Error ? e.message : e}`,
      );
      return { ok: false, status: 0 };
    }
  }

  async function getJson(
    pathSuffix: string,
  ): Promise<{ ok: boolean; status: number; json?: unknown }> {
    try {
      const res = await fetch(`${baseUrl}${pathSuffix}`, {
        method: "GET",
        signal: AbortSignal.timeout(12_000),
      });
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = undefined;
      }
      return { ok: res.ok, status: res.status, json };
    } catch {
      return { ok: false, status: 0 };
    }
  }

  async function buildHeartbeatPayload(): Promise<Record<string, unknown>> {
    const c = cfg();
    const tunnel = opts.getTunnelInfo?.() ?? null;
    const payload: Record<string, unknown> = {
      installId: opts.getInstallId(),
      appVersion: opts.getAppVersion(),
      appKind: hooks?.appKind ?? null,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      hostname: os.hostname().slice(0, 80),
      timestamp: new Date().toISOString(),
      consent: {
        enabled: c.enabled,
        scopes: c.scopes,
        consentAt: c.consentAt,
        consentVersion: c.consentVersion,
      },
      tunnelSlug: tunnel?.slug ?? null,
      tunnelHostname: tunnel?.hostname ?? null,
    };

    if (scopeOn("heartbeat") && hooks) {
      payload.health = await hooks.getHealth();
      if (hooks.getHeartbeatExtras) {
        try {
          const extras = await hooks.getHeartbeatExtras();
          if (extras && typeof extras === "object") {
            Object.assign(payload, extras);
          }
        } catch {
          /* best-effort */
        }
      }
    }
    if (scopeOn("plugins") && hooks?.getPluginsSummary) {
      payload.plugins = await hooks.getPluginsSummary();
    }
    if (scopeOn("users") && hooks?.getUsersSummary) {
      payload.users = await hooks.getUsersSummary();
    }
    if (scopeOn("sessions") && hooks?.getSessionsSummary) {
      payload.sessions = await hooks.getSessionsSummary();
    }
    if (scopeOn("hermes_stats") && hooks?.getHermesStats) {
      payload.hermesStats = await hooks.getHermesStats();
    }
    if (scopeOn("ops")) {
      try {
        payload.lastBootSummary = currentBootSummary();
      } catch {
        /* best-effort */
      }
    }
    return payload;
  }

  async function sendFleetHeartbeat(): Promise<boolean> {
    if (ingestDisabled) return false;
    if (!scopeOn("heartbeat")) return false;
    const body = await buildHeartbeatPayload();
    const r = await postJson("/heartbeat", body);
    if (r.ok) log("fleet", "heartbeat ok");
    return r.ok;
  }

  function sendFleetCrash(report: Record<string, unknown>): void {
    if (ingestDisabled) return;
    if (!scopeOn("crashes")) return;
    void postJson("/crash", {
      ...report,
      installId: report.installId || opts.getInstallId(),
      receivedVia: "desktop-agent",
    });
  }

  async function sendMainLogTailBundle(
    installId: string,
    maxBytes: number,
  ): Promise<void> {
    try {
      const tail = opts.logFileTail?.(maxBytes) ?? null;
      if (!tail) return;
      const digest = `${tail.length}:${tail.slice(-200)}`;
      if (digest === lastSentLogTailHash) return;
      lastSentLogTailHash = digest;
      await postJson("/bundle", {
        installId,
        kind: "main_logs",
        appVersion: opts.getAppVersion(),
        tail,
        timestamp: new Date().toISOString(),
      });
    } catch {
      /* best-effort */
    }
  }

  async function syncScopedBundles(): Promise<void> {
    if (!hooks) return;
    const installId = opts.getInstallId();
    if (scopeOn("request_logs") && hooks.getRequestLogsSample) {
      const sample = await hooks.getRequestLogsSample();
      if (sample?.length) {
        await postJson("/bundle", {
          installId,
          kind: "request_logs",
          items: sample.slice(0, 50),
          timestamp: new Date().toISOString(),
        });
      }
    }
    if (scopeOn("hermes_chats") && hooks.getHermesChatsSample) {
      const sample = await hooks.getHermesChatsSample();
      if (sample?.length) {
        await postJson("/bundle", {
          installId,
          kind: "hermes_chats",
          items: sample.slice(0, 30),
          timestamp: new Date().toISOString(),
        });
      }
    }
    if (scopeOn("assistant_chats") && hooks.getAssistantChatsSample) {
      const sample = await hooks.getAssistantChatsSample();
      if (sample?.length) {
        await postJson("/bundle", {
          installId,
          kind: "assistant_chats",
          items: sample.slice(0, 30),
          timestamp: new Date().toISOString(),
        });
      }
    }
    if (scopeOn("actions") && hooks.getActionsSample) {
      const sample = await hooks.getActionsSample();
      if (sample?.length) {
        await postJson("/bundle", {
          installId,
          kind: "actions",
          items: sample.slice(0, 100),
          timestamp: new Date().toISOString(),
        });
      }
    }
    if (scopeOn("ops")) {
      const events = drainPendingOpsEvents(100);
      if (events.length) {
        await postJson("/bundle", {
          installId,
          kind: "ops_events",
          items: events,
          timestamp: new Date().toISOString(),
        });
      }
      await sendMainLogTailBundle(installId, 64_000);
    }
  }

  async function uploadFleetDiagnostics(
    reason: string,
  ): Promise<{ ok: boolean; detail: string }> {
    if (ingestDisabled) {
      return {
        ok: false,
        detail: "télémétrie flotte désactivée (endpoint /ingest-disabled)",
      };
    }
    let bootSummary: unknown = null;
    try {
      bootSummary = currentBootSummary();
    } catch {
      /* best-effort */
    }
    const r = await postJson("/bundle", {
      installId: opts.getInstallId(),
      kind: "diagnostics",
      reason,
      appVersion: opts.getAppVersion(),
      platform: process.platform,
      bootSummary,
      tail: opts.logFileTail?.(160_000) || "",
      timestamp: new Date().toISOString(),
    });
    return {
      ok: r.ok,
      detail: r.ok
        ? "diagnostics envoyés"
        : `envoi diagnostics échoué (HTTP ${r.status})`,
    };
  }

  async function pollRemoteCommands(): Promise<void> {
    if (!scopeOn("remote_commands") || !hooks?.executeRemoteCommand) return;
    const installId = opts.getInstallId();
    const r = await getJson(
      `/commands?installId=${encodeURIComponent(installId)}`,
    );
    if (!r.ok || !r.json || typeof r.json !== "object") return;
    const cmds = (r.json as { commands?: unknown }).commands;
    if (!Array.isArray(cmds)) return;
    for (const raw of cmds) {
      if (!raw || typeof raw !== "object") continue;
      const c = raw as {
        id?: string;
        command?: string;
        args?: Record<string, unknown>;
      };
      if (!c.id || !c.command) continue;
      let result: { ok: boolean; detail: string };
      try {
        result = await hooks.executeRemoteCommand(c.command, c.args);
      } catch (e) {
        result = {
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        };
      }
      await postJson("/commands/ack", {
        installId,
        commandId: c.id,
        ok: result.ok,
        detail: String(result.detail || "").slice(0, 500),
        timestamp: new Date().toISOString(),
      });
    }
  }

  function notifyFleetConfigChanged(): void {
    if (!started) return;
    if (scopeOn("heartbeat")) void sendFleetHeartbeat();
  }

  function startFleetAgent(h: FleetAgentRuntimeHooks): void {
    if (started) {
      hooks = h;
      log("fleet", "hooks agent mis à jour (boot complet)");
      return;
    }
    started = true;
    hooks = h;
    if (ingestDisabled) {
      log(
        "fleet",
        `télémétrie désactivée (endpoint sentinelle ${baseUrl}) — aucun envoi`,
      );
      return;
    }
    log("fleet", `agent start endpoint=${baseUrl}`);

    const tick = () => {
      void (async () => {
        if (!cfg().enabled) return;
        if (scopeOn("heartbeat")) await sendFleetHeartbeat();
        await syncScopedBundles();
      })();
    };

    setTimeout(tick, 3_000);
    heartbeatTimer = setInterval(tick, heartbeatMs);
    commandTimer = setInterval(() => {
      void pollRemoteCommands();
    }, commandPollMs);
  }

  function stopFleetAgent(): void {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (commandTimer) clearInterval(commandTimer);
    heartbeatTimer = null;
    commandTimer = null;
    started = false;
    hooks = null;
  }

  return {
    startFleetAgent,
    stopFleetAgent,
    notifyFleetConfigChanged,
    sendFleetHeartbeat,
    sendFleetCrash,
    uploadFleetDiagnostics,
    fleetEndpointBase: () => baseUrl,
  };
}
