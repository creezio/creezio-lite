/**
 * Client typé du backend flotte (server-admin) — SoT du contrat côté
 * consommateur (T4).
 *
 * Avant T4, `@creezio/admin` re-déclarait à la main dans ses modules
 * (`fleet-registry`, `fleet-releases`) les endpoints du backend flotte,
 * la résolution env du Basic et les formats de réponse — un « hop HTTP
 * interne » anonyme, sans types partagés. Le contrat client vit désormais
 * ICI, à côté du serveur qui l'expose (`server-admin.ts`), et l'app admin
 * l'importe directement (`import { … } from "@creezio/fleet"`).
 *
 * Le transport reste HTTP Basic loopback (`CREEZIO_FLEET_BACKEND_URL`,
 * défaut http://127.0.0.1:18800) : en prod l'app admin et le backend flotte
 * sont deux containers distincts du même VPS — seul le backend monte le
 * socket Docker et lit `fleet-hosts.json`/`servers.json`. Le serveur HTTP
 * server-admin reste donc intact (host-agents distants, enrôlement, proxy
 * registre) ; cette surface Basic admin ne porte PAS le header
 * `x-creezio-fleet-protocol` (protocole v1 réservé aux échanges
 * agent↔backend — inchangé).
 *
 * Node pur, zéro dépendance (frontière @creezio/fleet).
 */

import type { CollectedServer } from "./types.js";

/** URL par défaut du backend flotte (loopback VPS). */
export const FLEET_BACKEND_DEFAULT_URL = "http://127.0.0.1:18800";

export type FleetBackendClientOptions = {
  /** URL du backend flotte. Défaut env CREEZIO_FLEET_BACKEND_URL puis http://127.0.0.1:18800. */
  backendUrl?: string;
  /** Credentials Basic `user:pass`. Défaut env CREEZIO_FLEET_BACKEND_BASIC. */
  basic?: string;
};

/** Résolution de l'URL backend (option > env > défaut loopback). */
export function resolveFleetBackendUrl(
  opts?: FleetBackendClientOptions,
): string {
  return (
    opts?.backendUrl ||
    (process.env.CREEZIO_FLEET_BACKEND_URL || "").trim() ||
    FLEET_BACKEND_DEFAULT_URL
  ).replace(/\/$/, "");
}

/** Résolution du Basic backend (option > env — jamais exposé au client). */
export function resolveFleetBackendBasic(
  opts?: FleetBackendClientOptions,
): string {
  return (
    opts?.basic || (process.env.CREEZIO_FLEET_BACKEND_BASIC || "").trim()
  );
}

/**
 * Appel authentifié (Basic) vers le backend flotte.
 *
 * - Basic absent → `{status: 503, json: {ok:false, error:"fleet_basic_missing"}}`
 *   SANS appel réseau ;
 * - réponse non JSON → `json: null` ;
 * - erreur réseau / timeout → throw (aux consommateurs de décider).
 */
export async function fleetBackendFetch(
  opts: FleetBackendClientOptions | undefined,
  method: string,
  subPath: string,
  body?: unknown,
  timeoutMs = 8000,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const base = resolveFleetBackendUrl(opts);
  const basic = resolveFleetBackendBasic(opts);
  if (!basic) {
    return { status: 503, json: { ok: false, error: "fleet_basic_missing" } };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${subPath}`, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Basic ${Buffer.from(basic).toString("base64")}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* non JSON */
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/** Ligne de la vue consolidée servie par `GET /admin/api/servers`. */
export type FleetBackendServer = CollectedServer & {
  hostId: string;
  hostLabel: string;
};

export type FleetBackendServersResult = {
  /** Statut HTTP du backend (503 local si Basic manquant). */
  status: number;
  /** true ⇔ 200 et body.ok. */
  ok: boolean;
  /** Champ `error` renvoyé par le backend, si présent. */
  error?: string;
  /** Vue consolidée locale + hôtes enrôlés (vide si !ok). */
  servers: FleetBackendServer[];
};

/**
 * `GET /admin/api/servers` typé — vue consolidée de la flotte (serveurs
 * locaux du VPS + hôtes distants enrôlés), servie depuis le snapshot poller
 * du backend. Throw sur erreur réseau (comme `fleetBackendFetch`).
 */
export async function fetchFleetBackendServers(
  opts?: FleetBackendClientOptions,
): Promise<FleetBackendServersResult> {
  const r = await fleetBackendFetch(opts, "GET", "/admin/api/servers");
  const ok = r.status === 200 && r.json?.ok === true;
  const error = r.json?.error;
  const servers = r.json?.servers;
  return {
    status: r.status,
    ok,
    error: typeof error === "string" ? error : undefined,
    servers:
      ok && Array.isArray(servers) ? (servers as FleetBackendServer[]) : [],
  };
}

/**
 * `POST /admin/api/hosts/verify` typé — vérifie un credential flotte
 * `hostId:agentToken` auprès du backend (fleet-hosts.json reste la SoT,
 * comparaison temps constant côté backend, jamais de token restitué).
 * Throw sur erreur réseau / timeout — aux consommateurs de fail-closed.
 */
export async function verifyFleetHostCredential(
  opts: FleetBackendClientOptions | undefined,
  hostId: string,
  token: string,
): Promise<boolean> {
  const r = await fleetBackendFetch(opts, "POST", "/admin/api/hosts/verify", {
    hostId,
    token,
  });
  return r.status === 200 && r.json?.ok === true && r.json?.valid === true;
}

/**
 * `POST /admin/api/hosts/agent-url` — l'hôte pousse l'URL dédiée
 * (auth agentToken, pas de Basic). Utilisé par `agent up` après
 * provision/migration du tunnel. Throw sur erreur réseau / timeout.
 */
export async function pushFleetHostAgentUrl(opts: {
  adminUrl: string;
  hostId: string;
  agentUrl: string;
  agentToken: string;
  timeoutMs?: number;
}): Promise<{ status: number; ok: boolean; changed?: boolean; error?: string }> {
  const base = String(opts.adminUrl || "").trim().replace(/\/+$/, "");
  if (!base) {
    return { status: 400, ok: false, error: "adminUrl manquante" };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${base}/admin/api/hosts/agent-url`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hostId: opts.hostId,
        agentUrl: opts.agentUrl,
        agentToken: opts.agentToken,
      }),
    });
    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* non JSON */
    }
    return {
      status: res.status,
      ok: res.status === 200 && json?.ok === true,
      changed: json?.changed === true,
      error: typeof json?.error === "string" ? json.error : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}
