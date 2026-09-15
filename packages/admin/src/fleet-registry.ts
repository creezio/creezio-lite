/**
 * Module `fleet-registry` — DB centrale de la flotte (app admin de marque).
 *
 * La table `admin_fleet_servers` (brand.db de l'app admin) est une VUE
 * matérialisée de la flotte — les JSON (`servers.json`, `fleet-hosts.json`)
 * restent la SoT des gestes Docker (create/start/stop/update).
 *
 * Alimentation, trois sources (`source`) :
 *   - `sync`      : backfill manuel (`POST sync`, session admin) depuis le
 *                   backend flotte `/admin/api/servers` ;
 *   - `poller`    : poller de fond (`startFleetRegistryPoller`, 60-120 s) —
 *                   couvre serveurs arrêtés et instances legacy ;
 *   - `register`  : auto-inscription des serveurs marque au boot
 *                   (`POST register`, Bearer = secret partagé
 *                   CREEZIO_FLEET_REGISTER_SECRET) puis `POST heartbeat`
 *                   (Bearer = serverKey propre au serveur, stocké HASHÉ).
 *
 * Sécurité tokens :
 *   - `accessToken` (consultation de l'instance par l'admin) : chiffré au
 *     repos AES-256-GCM (secret-box @creezio/integrations, clé dérivée
 *     AUTH_SECRET) — reçu en clair UNE fois au register.
 *   - `serverKey` (auth heartbeat) : généré côté admin, restitué UNE fois,
 *     stocké en hash sha256 (comparaison temps constant).
 *   - Ré-inscription idempotente = rotation des deux tokens.
 */

import crypto from "node:crypto";
import type {
  ApiKernel,
  ApiMount,
  ApiRequest,
  ScopedDbAccess,
} from "@creezio/api-kernel";
// T4 : plus de fetch HTTP artisanal vers le backend flotte — le contrat
// client (endpoints, Basic, types) est importé directement de @creezio/fleet.
import {
  fetchFleetBackendServers,
  type FleetBackendServer,
} from "@creezio/fleet";
import {
  openIntegrationSecret,
  sealIntegrationSecret,
} from "@creezio/integrations";
import type { FleetAdminMountOptions } from "./index.js";

/* ------------------------------------------------------------- migration */

export const ADMIN_SCHEMA_004_SQL = `-- Registre flotte matérialisé (DB = vue, JSON = SoT des gestes)

CREATE TABLE IF NOT EXISTS admin_fleet_servers (
  id TEXT PRIMARY KEY,              -- "{host_id}/{brand_id}/{name}"
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- identité
  host_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  name TEXT NOT NULL,
  container_name TEXT,
  port INTEGER,
  tunnel_slug TEXT,
  server_url TEXT,
  variant TEXT,
  orphan INTEGER NOT NULL DEFAULT 0,
  -- statut matérialisé
  version TEXT,
  image TEXT,
  docker_state TEXT,
  health TEXT,
  boot_headline TEXT,
  disk_bytes INTEGER,
  last_heartbeat_at TEXT,
  last_polled_at TEXT,
  source TEXT NOT NULL DEFAULT 'poller',
  -- auto-inscription (F3)
  access_token_enc TEXT,
  server_key_hash TEXT,
  registered_at TEXT,
  -- pilotage rollout (F5/F6)
  pinned_image TEXT,
  hold INTEGER NOT NULL DEFAULT 0,
  channel TEXT NOT NULL DEFAULT 'stable',
  UNIQUE(host_id, brand_id, name)
);

CREATE TABLE IF NOT EXISTS admin_fleet_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  server_id TEXT,
  kind TEXT NOT NULL,               -- registered, rotated, heartbeat_lost, update_done, update_failed…
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_fleet_events_server
  ON admin_fleet_events (server_id, created_at);
`;

/**
 * Migration 006 (P3.b) — version kit dans le registre flotte : chaque
 * instance annonce au register/heartbeat la version lockstep
 * `@creezio/platform-core` installée (`kit_version`) et sa version
 * d'architecture (`architecture_version`, ex. H9). Champs ADDITIFS
 * (protocole flotte v1 dual-accept — les instances plus vieilles n'envoient
 * simplement rien). Le tableau « qui est à quelle version » de l'admin est
 * servi par `GET /api/v1/modules/fleet-registry/servers`.
 */
export const ADMIN_SCHEMA_006_SQL = `-- Version kit annoncée par les instances (P3.b)
ALTER TABLE admin_fleet_servers ADD COLUMN kit_version TEXT;
ALTER TABLE admin_fleet_servers ADD COLUMN architecture_version TEXT;
`;

/* ---------------------------------------------------------------- helpers */

function nowIso(): string {
  return new Date().toISOString();
}

function newEventId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function fleetServerId(
  hostId: string,
  brandId: string,
  name: string,
): string {
  return `${hostId}/${brandId}/${name}`;
}

function sha256Hex(s: string): string {
  return (
    "sha256:" + crypto.createHash("sha256").update(String(s)).digest("hex")
  );
}

function tokenMatchesHash(token: string, storedHash: string): boolean {
  const a = Buffer.from(sha256Hex(token));
  const b = Buffer.from(String(storedHash || ""));
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function bearerOf(req: ApiRequest): string {
  const raw = Array.isArray(req.headers?.authorization)
    ? req.headers?.authorization?.[0]
    : req.headers?.authorization;
  const m = String(raw || "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : "";
}

export function recordFleetEvent(
  db: ScopedDbAccess,
  serverId: string | null,
  kind: string,
  detail?: string,
): void {
  try {
    db.prepare(
      `INSERT INTO admin_fleet_events (id, created_at, server_id, kind, detail)
       VALUES (?,?,?,?,?)`,
    ).run(newEventId(), nowIso(), serverId, kind, detail ?? null);
  } catch {
    /* journal best-effort */
  }
}

/* ---------------------------------------------------------------- upsert */

export type FleetServerStatusInput = {
  hostId: string;
  brandId: string;
  name: string;
  containerName?: string | null;
  port?: number | null;
  tunnelSlug?: string | null;
  serverUrl?: string | null;
  variant?: string | null;
  orphan?: boolean;
  version?: string | null;
  /** Version lockstep @creezio/platform-core annoncée par l'instance (P3.b). */
  kitVersion?: string | null;
  /** Version d'architecture annoncée (ex. H9) — P3.b. */
  architectureVersion?: string | null;
  image?: string | null;
  dockerState?: string | null;
  health?: string | null;
  bootHeadline?: string | null;
  source: string;
};

type FleetServerRow = Record<string, unknown> & {
  id: string;
  host_id: string;
  brand_id: string;
  name: string;
};

/**
 * Upsert d'un statut serveur dans le registre.
 *
 * Dédup self-enroll (même règle que collectServersView du backend flotte) :
 * un hôte enrôlé peut être CE VPS — le même serveur `{brandId}/{name}` ne
 * doit exister qu'UNE fois, rattaché à l'hôte ENRÔLÉ (jamais dupliqué en
 * `local`). Si une row `local` existe et qu'un statut arrive pour un hôte
 * enrôlé, la row est MIGRÉE (l'identité registered/tokens est conservée) ;
 * si une row hôte-enrôlé existe et qu'un statut `local` arrive, il est
 * appliqué à la row enrôlée (statut seulement).
 */
export function upsertFleetServerStatus(
  db: ScopedDbAccess,
  s: FleetServerStatusInput,
): string {
  const ts = nowIso();
  const rows = db
    .prepare(
      `SELECT * FROM admin_fleet_servers WHERE brand_id = ? AND name = ?`,
    )
    .all(s.brandId, s.name) as FleetServerRow[];

  let target = rows.find((r) => r.host_id === s.hostId) || null;
  if (!target && rows.length) {
    if (s.hostId !== "local") {
      // Migration local → hôte enrôlé (dédup self-enroll).
      const localRow = rows.find((r) => r.host_id === "local");
      if (localRow) {
        const newId = fleetServerId(s.hostId, s.brandId, s.name);
        db.prepare(
          `UPDATE admin_fleet_servers SET id = ?, host_id = ?, updated_at = ? WHERE id = ?`,
        ).run(newId, s.hostId, ts, localRow.id);
        db.prepare(
          `UPDATE admin_fleet_events SET server_id = ? WHERE server_id = ?`,
        ).run(newId, localRow.id);
        target = { ...localRow, id: newId, host_id: s.hostId };
      }
    } else {
      // Statut `local` d'un serveur déjà rattaché à un hôte enrôlé :
      // privilégier l'hôte enrôlé (pas de doublon local).
      target = rows.find((r) => r.host_id !== "local") || null;
    }
  }

  const statusSets: Array<[string, unknown]> = [];
  const set = (col: string, v: unknown) => {
    if (v !== undefined) statusSets.push([col, v ?? null]);
  };
  set("container_name", s.containerName);
  set("port", s.port);
  set("tunnel_slug", s.tunnelSlug);
  set("server_url", s.serverUrl);
  set("variant", s.variant);
  set("orphan", s.orphan === undefined ? undefined : s.orphan ? 1 : 0);
  set("version", s.version);
  set("kit_version", s.kitVersion);
  set("architecture_version", s.architectureVersion);
  set("image", s.image);
  set("docker_state", s.dockerState);
  set("health", s.health);
  set("boot_headline", s.bootHeadline);

  if (target) {
    const sets = statusSets.map(([c]) => `${c} = ?`);
    const args = statusSets.map(([, v]) => v);
    db.prepare(
      `UPDATE admin_fleet_servers
       SET ${sets.length ? sets.join(", ") + "," : ""}
           last_polled_at = ?, source = ?, updated_at = ?
       WHERE id = ?`,
    ).run(...args, ts, s.source, ts, target.id);
    return target.id;
  }

  const id = fleetServerId(s.hostId, s.brandId, s.name);
  db.prepare(
    `INSERT INTO admin_fleet_servers
     (id, created_at, updated_at, host_id, brand_id, name,
      container_name, port, tunnel_slug, server_url, variant, orphan,
      version, kit_version, architecture_version,
      image, docker_state, health, boot_headline,
      last_polled_at, source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    ts,
    ts,
    s.hostId,
    s.brandId,
    s.name,
    s.containerName ?? null,
    s.port ?? null,
    s.tunnelSlug ?? null,
    s.serverUrl ?? null,
    s.variant ?? null,
    s.orphan ? 1 : 0,
    s.version ?? null,
    s.kitVersion ?? null,
    s.architectureVersion ?? null,
    s.image ?? null,
    s.dockerState ?? null,
    s.health ?? null,
    s.bootHeadline ?? null,
    ts,
    s.source,
  );
  return id;
}

/* ------------------------------------------------------- statut online */

/**
 * Statut online DÉRIVÉ (jamais stocké) :
 *   - heartbeat frais (< 3× intervalle heartbeat) → online ;
 *   - sinon poll frais (< 3× intervalle poller) ET docker `running` → online
 *     (un serveur arrêté vu par le poller n'est pas « online »).
 */
export function deriveFleetOnline(
  row: {
    last_heartbeat_at?: string | null;
    last_polled_at?: string | null;
    docker_state?: string | null;
  },
  opts?: {
    nowMs?: number;
    heartbeatIntervalSeconds?: number;
    pollIntervalSeconds?: number;
  },
): boolean {
  const nowMs = opts?.nowMs ?? Date.now();
  const hbWindow = (opts?.heartbeatIntervalSeconds ?? 90) * 3 * 1000;
  const pollWindow = (opts?.pollIntervalSeconds ?? 90) * 3 * 1000;
  const hb = row.last_heartbeat_at ? Date.parse(row.last_heartbeat_at) : NaN;
  if (Number.isFinite(hb) && nowMs - hb < hbWindow) return true;
  const polled = row.last_polled_at ? Date.parse(row.last_polled_at) : NaN;
  return (
    Number.isFinite(polled) &&
    nowMs - polled < pollWindow &&
    row.docker_state === "running"
  );
}

/* ------------------------------------------------------------ rate limit */

/** Rate-limit mémoire basique par clé (register : par IP). */
export function createRateLimiter(max = 10, windowMs = 60_000) {
  const hits = new Map<string, number[]>();
  return (key: string, nowMs = Date.now()): boolean => {
    const list = (hits.get(key) || []).filter((t) => nowMs - t < windowMs);
    if (list.length >= max) {
      hits.set(key, list);
      return false;
    }
    list.push(nowMs);
    hits.set(key, list);
    return true;
  };
}

function clientIpOf(req: ApiRequest): string {
  const fwd = Array.isArray(req.headers?.["x-forwarded-for"])
    ? req.headers?.["x-forwarded-for"]?.[0]
    : req.headers?.["x-forwarded-for"];
  return String(fwd || "").split(",")[0]!.trim() || "local";
}

/* ----------------------------------------------------------------- mount */

export type FleetRegistryMountOptions = {
  /** Backend flotte (sync/poller). Défaut : mêmes env que le module fleet. */
  fleet?: FleetAdminMountOptions;
  /**
   * Secret partagé d'auto-inscription (Bearer de POST register).
   * Défaut env CREEZIO_FLEET_REGISTER_SECRET — sans lui, register → 503.
   */
  registerSecret?: string;
  /** Intervalle heartbeat annoncé aux serveurs (s). Défaut 90. */
  heartbeatIntervalSeconds?: number;
  /** Intervalle du poller de fond (s) — fenêtre du statut online. Défaut 90. */
  pollIntervalSeconds?: number;
  /** Rate-limit register (essais / minute / IP). Défaut 10. */
  registerRatePerMinute?: number;
};

function registerSecretOf(opts?: FleetRegistryMountOptions): string {
  return (
    opts?.registerSecret ||
    (process.env.CREEZIO_FLEET_REGISTER_SECRET || "").trim()
  );
}

/** Colonnes sensibles jamais restituées par l'API. */
const SENSITIVE_COLS = new Set(["access_token_enc", "server_key_hash"]);

function publicRow(
  row: Record<string, unknown>,
  opts?: FleetRegistryMountOptions,
  nowMs?: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!SENSITIVE_COLS.has(k)) out[k] = v;
  }
  out.registered = Boolean(row.server_key_hash);
  out.online = deriveFleetOnline(
    row as { last_heartbeat_at?: string; last_polled_at?: string; docker_state?: string },
    {
      nowMs,
      heartbeatIntervalSeconds: opts?.heartbeatIntervalSeconds ?? 90,
      pollIntervalSeconds: opts?.pollIntervalSeconds ?? 90,
    },
  );
  return out;
}

/** Mapping serveur backend flotte → statut registre. */
function backendServerToStatus(
  s: FleetBackendServer,
  source: string,
): FleetServerStatusInput | null {
  const brandId = String(s.brandId || "").trim();
  const name = String(s.name || "").trim();
  if (!brandId || !name) return null;
  // Coercions défensives conservées : la vue vient du backend en JSON.
  const docker = s.docker || null;
  const boot = s.bootStatus || null;
  const env = s.env || {};
  const hostId = String(s.hostId || "local");
  const port = s.port == null ? null : Number(s.port);
  return {
    hostId,
    brandId,
    name,
    containerName: s.containerName == null ? null : String(s.containerName),
    port: Number.isFinite(port as number) ? port : null,
    tunnelSlug: env.CREEZIO_TUNNEL_SLUG
      ? String(env.CREEZIO_TUNNEL_SLUG)
      : null,
    serverUrl:
      hostId === "local" && port ? `http://127.0.0.1:${port}/` : undefined,
    variant: undefined,
    orphan: s.orphan === true,
    version: s.version == null ? null : String(s.version),
    image: s.image == null ? null : String(s.image),
    dockerState: docker?.state == null ? null : String(docker.state),
    health: docker?.health == null ? null : String(docker.health),
    bootHeadline: boot?.headline == null ? null : String(boot.headline),
    source,
  };
}

/**
 * Sync (backfill) : lit la vue consolidée du backend flotte (client typé
 * `fetchFleetBackendServers` de @creezio/fleet — T4) et upsert le registre.
 * Utilisé par `POST sync` (session admin) et par le poller de fond.
 */
export async function syncFleetRegistryFromBackend(
  db: ScopedDbAccess,
  opts: FleetRegistryMountOptions | undefined,
  source: string,
): Promise<{ ok: boolean; upserted: number; error?: string }> {
  const list = await fetchFleetBackendServers(opts?.fleet);
  if (!list.ok) {
    return {
      ok: false,
      upserted: 0,
      error: `backend flotte → ${list.status}${list.error ? ` (${list.error})` : ""}`,
    };
  }
  let upserted = 0;
  for (const s of list.servers) {
    const status = backendServerToStatus(s, source);
    if (!status) continue;
    upsertFleetServerStatus(db, status);
    upserted++;
  }
  return { ok: true, upserted };
}

/**
 * Mount `fleet-registry` — /api/v1/modules/fleet-registry/*.
 *
 *   GET  servers            → registre (lecture DB pure, online dérivé)
 *   GET  events             → journal (200 derniers)
 *   POST sync               → backfill depuis le backend flotte (session admin)
 *   POST register           → auto-inscription serveur (Bearer register secret)
 *   POST heartbeat          → battement serveur (Bearer serverKey)
 *   DELETE servers/<id…>    → retrait d'une row obsolète (session admin)
 */
export function createFleetRegistryMount(
  opts?: FleetRegistryMountOptions,
): ApiMount {
  const allowRegister = createRateLimiter(
    opts?.registerRatePerMinute ?? 10,
    60_000,
  );
  const fleetPermission = "nav.fleet";
  return {
    dbLayer: "brand",
    // Pas de permission mount-level : register/heartbeat sont des routes
    // MACHINE (Bearer register secret / serverKey, vérifiés par le handler,
    // allowlist bordure) et `sync` est appelé in-process par le poller de
    // fond (pas de session). Les ops session sont gardées op par op.
    accessJustification:
      "routes machine register/heartbeat (Bearer vérifié handler) + sync poller in-process — ops session gardées op par op (nav.fleet)",
    operations: [
      { id: "list-servers", method: "GET", path: "/servers", description: "Lister les serveurs du registre", permission: fleetPermission },
      { id: "list-events", method: "GET", path: "/events", description: "Journal des événements flotte", permission: fleetPermission },
      { id: "sync", method: "POST", path: "/sync", description: "Backfill depuis le backend flotte" },
      { id: "register", method: "POST", path: "/register", description: "Auto-inscription serveur" },
      { id: "heartbeat", method: "POST", path: "/heartbeat", description: "Heartbeat serveur" },
      { id: "delete-server", method: "DELETE", path: "/servers/:id", description: "Retirer un serveur du registre", permission: fleetPermission },
      // fleetServerId = host/brand/name : variante id NON encodé (3 segments)
      // — sans cette op, la garde par op ne matcherait pas (fail-open).
      { id: "delete-server-path", method: "DELETE", path: "/servers/:host/:brand/:name", description: "Retirer un serveur (id non encodé)", permission: fleetPermission },
    ],
    handle: async ({ req, subPath, db }) => {
      if (!db) {
        return { status: 503, body: { ok: false, error: "db_unavailable" } };
      }
      const method = req.method.toUpperCase();

      if (subPath === "servers" && method === "GET") {
        const rows = db
          .prepare(
            `SELECT * FROM admin_fleet_servers ORDER BY host_id, brand_id, name`,
          )
          .all() as Array<Record<string, unknown>>;
        const nowMs = Date.now();
        return {
          status: 200,
          body: {
            ok: true,
            servers: rows.map((r) => publicRow(r, opts, nowMs)),
            heartbeatIntervalSeconds: opts?.heartbeatIntervalSeconds ?? 90,
          },
        };
      }

      if (subPath === "events" && method === "GET") {
        const events = db
          .prepare(
            `SELECT * FROM admin_fleet_events ORDER BY created_at DESC LIMIT 200`,
          )
          .all();
        return { status: 200, body: { ok: true, events } };
      }

      if (subPath === "sync" && method === "POST") {
        const body = (req.body || {}) as { source?: string };
        const source = body.source === "poller" ? "poller" : "sync";
        const r = await syncFleetRegistryFromBackend(db, opts, source);
        if (!r.ok) {
          return { status: 502, body: { ok: false, error: r.error } };
        }
        return {
          status: 200,
          body: { ok: true, upserted: r.upserted, source },
        };
      }

      // Auto-inscription (F3) — Bearer = secret partagé de la flotte.
      if (subPath === "register" && method === "POST") {
        const secret = registerSecretOf(opts);
        if (!secret) {
          return {
            status: 503,
            body: {
              ok: false,
              error:
                "auto-inscription non configurée (CREEZIO_FLEET_REGISTER_SECRET requis côté admin)",
            },
          };
        }
        if (!allowRegister(clientIpOf(req))) {
          return { status: 429, body: { ok: false, error: "rate_limited" } };
        }
        const bearer = bearerOf(req);
        if (
          !bearer ||
          bearer.length !== secret.length ||
          !crypto.timingSafeEqual(Buffer.from(bearer), Buffer.from(secret))
        ) {
          return { status: 401, body: { ok: false, error: "unauthorized" } };
        }
        const body = (req.body || {}) as Record<string, unknown>;
        const brandId = String(body.brandId || "").trim();
        const name = String(body.name || "").trim();
        const accessToken = String(body.accessToken || "").trim();
        if (!brandId || !name || !accessToken) {
          return {
            status: 400,
            body: { ok: false, error: "brandId, name, accessToken requis" },
          };
        }
        const hostId = String(body.hostId || "local").trim() || "local";
        const ts = nowIso();
        const serverId = upsertFleetServerStatus(db, {
          hostId,
          brandId,
          name,
          containerName:
            body.containerName == null ? undefined : String(body.containerName),
          serverUrl: body.serverUrl == null ? undefined : String(body.serverUrl),
          variant: body.variant == null ? undefined : String(body.variant),
          version: body.version == null ? undefined : String(body.version),
          kitVersion:
            body.kitVersion == null ? undefined : String(body.kitVersion),
          architectureVersion:
            body.architectureVersion == null
              ? undefined
              : String(body.architectureVersion),
          source: "register",
        });
        const existing = db
          .prepare(
            `SELECT registered_at FROM admin_fleet_servers WHERE id = ?`,
          )
          .get(serverId) as { registered_at: string | null } | undefined;
        const rotation = Boolean(existing?.registered_at);
        // serverKey : restitué UNE fois, stocké hashé.
        const serverKey = crypto.randomBytes(24).toString("hex");
        db.prepare(
          `UPDATE admin_fleet_servers
           SET access_token_enc = ?, server_key_hash = ?, registered_at = ?,
               last_heartbeat_at = ?, updated_at = ?, source = 'register'
           WHERE id = ?`,
        ).run(
          sealIntegrationSecret(accessToken),
          sha256Hex(serverKey),
          ts,
          ts,
          ts,
          serverId,
        );
        recordFleetEvent(
          db,
          serverId,
          rotation ? "rotated" : "registered",
          `version=${body.version || "?"} host=${hostId}`,
        );
        return {
          status: 200,
          body: {
            ok: true,
            serverId,
            serverKey,
            heartbeatIntervalSeconds: opts?.heartbeatIntervalSeconds ?? 90,
            rotation,
          },
        };
      }

      // Heartbeat (F3) — Bearer = serverKey (vérifié contre le hash stocké).
      if (subPath === "heartbeat" && method === "POST") {
        const body = (req.body || {}) as Record<string, unknown>;
        const serverId = String(body.serverId || "").trim();
        if (!serverId) {
          return { status: 400, body: { ok: false, error: "serverId requis" } };
        }
        const row = db
          .prepare(`SELECT * FROM admin_fleet_servers WHERE id = ?`)
          .get(serverId) as Record<string, unknown> | undefined;
        const bearer = bearerOf(req);
        if (
          !row ||
          !row.server_key_hash ||
          !bearer ||
          !tokenMatchesHash(bearer, String(row.server_key_hash))
        ) {
          return { status: 401, body: { ok: false, error: "unauthorized" } };
        }
        const ts = nowIso();
        const sets: string[] = ["last_heartbeat_at = ?", "updated_at = ?"];
        const args: unknown[] = [ts, ts];
        const setIf = (col: string, v: unknown) => {
          if (v !== undefined) {
            sets.push(`${col} = ?`);
            args.push(v ?? null);
          }
        };
        setIf(
          "version",
          body.version === undefined ? undefined : String(body.version ?? ""),
        );
        setIf(
          "kit_version",
          body.kitVersion === undefined
            ? undefined
            : body.kitVersion == null
              ? null
              : String(body.kitVersion),
        );
        setIf(
          "architecture_version",
          body.architectureVersion === undefined
            ? undefined
            : body.architectureVersion == null
              ? null
              : String(body.architectureVersion),
        );
        setIf(
          "health",
          body.health === undefined ? undefined : String(body.health ?? ""),
        );
        setIf(
          "boot_headline",
          body.bootHeadline === undefined
            ? undefined
            : body.bootHeadline == null
              ? null
              : String(body.bootHeadline),
        );
        setIf(
          "disk_bytes",
          body.diskBytes === undefined ? undefined : Number(body.diskBytes) || null,
        );
        args.push(serverId);
        db.prepare(
          `UPDATE admin_fleet_servers SET ${sets.join(", ")} WHERE id = ?`,
        ).run(...args);
        return {
          status: 200,
          body: {
            ok: true,
            heartbeatIntervalSeconds: opts?.heartbeatIntervalSeconds ?? 90,
          },
        };
      }

      // Retrait d'une row obsolète (serveur supprimé de la flotte).
      if (subPath.startsWith("servers/") && method === "DELETE") {
        const id = decodeURIComponent(subPath.slice("servers/".length));
        const r = db
          .prepare(`DELETE FROM admin_fleet_servers WHERE id = ?`)
          .run(id) as { changes: number };
        if (r.changes) recordFleetEvent(db, id, "removed");
        return {
          status: r.changes ? 200 : 404,
          body: { ok: Boolean(r.changes) },
        };
      }

      return { status: 404, body: { ok: false } };
    },
  };
}

/* ---------------------------------------------------------------- poller */

export type FleetRegistryPollerOptions = {
  api: Pick<ApiKernel, "handle">;
  /** Intervalle du poller (ms). Défaut 90 s (spec : 60-120 s). */
  intervalMs?: number;
  /**
   * Maintenance fleet-releases à chaque cycle (purge leases expirées +
   * auto-pause des releases en échec, F6). Défaut true — no-op silencieux si
   * le module fleet-releases n'est pas monté.
   */
  releasesMaintenance?: boolean;
  onError?: (e: unknown) => void;
};

/**
 * Poller de fond de l'app admin : upsert périodique du registre depuis le
 * backend flotte (source `poller`) via le kernel (pas de HTTP local, pas de
 * session). Best-effort : un backend flotte down ne casse rien. `unref()` —
 * ne retient jamais le process.
 */
export function startFleetRegistryPoller(opts: FleetRegistryPollerOptions): {
  stop: () => void;
  tick: () => Promise<void>;
} {
  const intervalMs = opts.intervalMs ?? 90_000;
  const tick = async () => {
    try {
      const res = await opts.api.handle({
        method: "POST",
        path: "/api/v1/modules/fleet-registry/sync",
        body: { source: "poller" },
        query: {},
        headers: {},
      });
      if (res.status !== 200) {
        opts.onError?.(
          new Error(
            `fleet-registry poller → ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`,
          ),
        );
      }
    } catch (e) {
      opts.onError?.(e);
    }
    // Janitor fleet-releases (F6) : best-effort, un 404 (module absent) est
    // silencieux — seule une exception remonte à onError.
    if (opts.releasesMaintenance !== false) {
      try {
        await opts.api.handle({
          method: "POST",
          path: "/api/v1/modules/fleet-releases/maintenance",
          body: {},
          query: {},
          headers: {},
        });
      } catch (e) {
        opts.onError?.(e);
      }
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  (timer as { unref?: () => void }).unref?.();
  // Premier cycle légèrement différé (laisser le backend flotte écouter).
  const first = setTimeout(() => void tick(), 5_000);
  (first as { unref?: () => void }).unref?.();
  return {
    stop: () => {
      clearInterval(timer);
      clearTimeout(first);
    },
    tick,
  };
}
