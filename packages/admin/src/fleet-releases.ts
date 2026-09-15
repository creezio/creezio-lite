/**
 * Module `fleet-releases` — updates en PULL de la flotte (F5).
 *
 * L'admin déclare des releases (image versionnée poussée par `publish`) ;
 * chaque agent hôte (@creezio/fleet host-agent) POLLE ce module, télécharge l'image via
 * le registre pull-only (F4) et applique l'update via son `updateServer`
 * local (backup/recreate/rollback intacts). AUCUN push admin → agent : le
 * geste manuel existant (POST /agent/api/…/update) reste disponible.
 *
 * Tables (admin_005, brand.db de l'app admin) :
 *   - admin_fleet_releases        : releases par marque (status draft|rolling|
 *                                   paused|done|aborted, wave_pct 0-100)
 *   - admin_fleet_update_reports  : dernier rapport par (release, serveur)
 *   - admin_fleet_download_slots  : sémaphore de téléchargement (lease TTL)
 *
 * Auth agents (`next` / `slots` / `report`) : Bearer `hostId:agentToken` —
 * le credential flotte déjà émis à l'enrôlement (fleet-hosts.json du backend
 * server-admin, SoT). La vérification est déléguée au backend
 * (`POST /admin/api/hosts/verify`, Basic) avec un petit cache mémoire.
 * CRUD releases / rollout : session admin (même posture que les autres
 * modules admin).
 *
 * Calcul `next` par serveur de l'hôte :
 *   hold → jamais d'update ; pinned_image → cible prioritaire ; sinon
 *   release `rolling` de la marque ∧ channel du serveur ∧
 *   hash(server_id) mod 100 < wave_pct → cible si différente de l'image
 *   courante. Pull par digest si la release en a un.
 */

import crypto from "node:crypto";
import type { ApiMount, ApiRequest, ScopedDbAccess } from "@creezio/api-kernel";
// T4 : vérification credential agents via le client typé de @creezio/fleet
// (plus de fetch HTTP artisanal — le contrat vit à côté du backend).
import {
  FLEET_PROTOCOL_HEADER,
  FLEET_PROTOCOL_VERSION,
  verifyFleetHostCredential,
} from "@creezio/fleet";
import type { FleetAdminMountOptions } from "./index.js";
import { recordFleetEvent } from "./fleet-registry.js";

/* ------------------------------------------------------------- migration */

export const ADMIN_SCHEMA_005_SQL = `-- Releases flotte + rapports d'update + slots de téléchargement (F5)

CREATE TABLE IF NOT EXISTS admin_fleet_releases (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  image TEXT NOT NULL,              -- référence pullable (registry.{zone}/… F4)
  digest TEXT,                      -- sha256:… → pull par digest si présent
  variant TEXT NOT NULL DEFAULT 'base',
  channel TEXT NOT NULL DEFAULT 'stable',
  status TEXT NOT NULL DEFAULT 'draft', -- draft|rolling|paused|done|aborted
  wave_pct INTEGER NOT NULL DEFAULT 0,  -- 0-100 : part de la flotte ciblée
  UNIQUE(brand_id, tag, variant)
);

CREATE TABLE IF NOT EXISTS admin_fleet_update_reports (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  release_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  host_id TEXT,
  status TEXT NOT NULL,             -- done|failed|rolled_back
  detail TEXT,
  UNIQUE(release_id, server_id)
);

CREATE INDEX IF NOT EXISTS idx_admin_fleet_update_reports_release
  ON admin_fleet_update_reports (release_id, status);

CREATE TABLE IF NOT EXISTS admin_fleet_download_slots (
  lease_id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  host_id TEXT,
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_fleet_download_slots_release
  ON admin_fleet_download_slots (release_id, expires_at);
`;

/* ---------------------------------------------------------------- helpers */

function nowIso(nowMs?: number): string {
  return new Date(nowMs ?? Date.now()).toISOString();
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function bearerOf(req: ApiRequest): string {
  const raw = Array.isArray(req.headers?.authorization)
    ? req.headers?.authorization?.[0]
    : req.headers?.authorization;
  const m = String(raw || "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : "";
}

/**
 * Assignation déterministe d'un serveur à une vague : hash stable de
 * server_id → 0-99. Un serveur reste dans la même « position » de vague
 * pendant tout le rollout (une promotion 10 % → 50 % n'exclut jamais un
 * serveur déjà servi).
 */
export function fleetWaveBucket(serverId: string): number {
  const h = crypto.createHash("sha256").update(String(serverId)).digest();
  return h.readUInt32BE(0) % 100;
}

export function fleetWaveIncludes(serverId: string, wavePct: number): boolean {
  const pct = Math.max(0, Math.min(100, Math.floor(wavePct)));
  return fleetWaveBucket(serverId) < pct;
}

/**
 * Référence pull par digest : repo (sans tag) + `@sha256:…`. Un `:` avant le
 * dernier `/` est un port de registre, pas un tag.
 */
export function fleetImageRefWithDigest(
  image: string,
  digest: string | null | undefined,
): string {
  if (!digest) return image;
  const slash = image.lastIndexOf("/");
  const colon = image.lastIndexOf(":");
  const repo = colon > slash ? image.slice(0, colon) : image;
  return `${repo}@${digest}`;
}

/**
 * Un serveur est « à jour » vis-à-vis d'une cible si son image courante est
 * la référence taguée OU la référence par digest (un update pullé par digest
 * laisse `repo@sha256:…` comme image du container).
 */
export function fleetImageMatchesTarget(
  currentImage: string | null | undefined,
  targetImage: string,
  targetDigest?: string | null,
): boolean {
  if (!currentImage) return false;
  if (currentImage === targetImage) return true;
  return Boolean(
    targetDigest &&
      currentImage === fleetImageRefWithDigest(targetImage, targetDigest),
  );
}

/* --------------------------------------------------- vérification agents */

export type FleetCredentialVerifier = (
  hostId: string,
  token: string,
) => Promise<boolean>;

/**
 * Vérificateur par défaut : délègue au backend flotte via le client typé
 * `verifyFleetHostCredential` (@creezio/fleet — `POST /admin/api/hosts/verify`,
 * Basic) — fleet-hosts.json reste la SoT des credentials. Cache mémoire
 * court (défaut 60 s, négatif 15 s) pour ne pas marteler le backend à
 * chaque poll.
 */
export function createBackendFleetCredentialVerifier(
  fleet?: FleetAdminMountOptions,
  opts?: { cacheTtlMs?: number; negativeTtlMs?: number },
): FleetCredentialVerifier {
  const ttl = opts?.cacheTtlMs ?? 60_000;
  const negTtl = opts?.negativeTtlMs ?? 15_000;
  const cache = new Map<string, { ok: boolean; until: number }>();
  return async (hostId, token) => {
    if (!hostId || !token) return false;
    const key =
      hostId +
      ":" +
      crypto.createHash("sha256").update(token).digest("hex").slice(0, 32);
    const hit = cache.get(key);
    const now = Date.now();
    if (hit && hit.until > now) return hit.ok;
    let ok = false;
    try {
      ok = await verifyFleetHostCredential(fleet, hostId, token);
    } catch {
      ok = false;
    }
    cache.set(key, { ok, until: now + (ok ? ttl : negTtl) });
    return ok;
  };
}

/* -------------------------------------------------------------- directives */

export type FleetUpdateDirective = {
  serverId: string;
  brandId: string;
  name: string;
  containerName: string | null;
  image: string;
  digest: string | null;
  releaseId: string | null;
  reason: "pin" | "release";
};

type ReleaseRow = {
  id: string;
  created_at: string;
  brand_id: string;
  tag: string;
  image: string;
  digest: string | null;
  variant: string;
  channel: string;
  status: string;
  wave_pct: number;
};

/**
 * Directives d'update pour tous les serveurs d'un hôte.
 * hold → exclu ; pinned_image → cible prioritaire ; sinon release rolling
 * (marque + channel + vague). Une cible identique à l'image courante ne
 * produit pas de directive.
 */
export function computeFleetUpdateDirectives(
  db: ScopedDbAccess,
  hostId: string,
): FleetUpdateDirective[] {
  const servers = db
    .prepare(
      `SELECT id, brand_id, name, container_name, image, variant,
              pinned_image, hold, channel
       FROM admin_fleet_servers
       WHERE host_id = ? AND orphan = 0
       ORDER BY brand_id, name`,
    )
    .all(hostId) as Array<{
    id: string;
    brand_id: string;
    name: string;
    container_name: string | null;
    image: string | null;
    variant: string | null;
    pinned_image: string | null;
    hold: number;
    channel: string;
  }>;
  const rolling = db
    .prepare(
      `SELECT * FROM admin_fleet_releases
       WHERE status = 'rolling' ORDER BY created_at DESC`,
    )
    .all() as ReleaseRow[];
  const out: FleetUpdateDirective[] = [];
  for (const s of servers) {
    if (s.hold) continue;
    if (s.pinned_image) {
      if (!fleetImageMatchesTarget(s.image, s.pinned_image)) {
        out.push({
          serverId: s.id,
          brandId: s.brand_id,
          name: s.name,
          containerName: s.container_name,
          image: s.pinned_image,
          digest: null,
          releaseId: null,
          reason: "pin",
        });
      }
      continue;
    }
    const serverVariant = (s.variant || "base").trim() || "base";
    const release = rolling.find(
      (r) =>
        r.brand_id === s.brand_id &&
        r.channel === (s.channel || "stable") &&
        (r.variant || "base") === serverVariant &&
        fleetWaveIncludes(s.id, r.wave_pct),
    );
    if (!release) continue;
    if (fleetImageMatchesTarget(s.image, release.image, release.digest)) continue;
    out.push({
      serverId: s.id,
      brandId: s.brand_id,
      name: s.name,
      containerName: s.container_name,
      image: release.image,
      digest: release.digest || null,
      releaseId: release.id,
      reason: "release",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ slots */

/** Purge les leases expirées (appelée à chaque geste slot + maintenance F6). */
export function purgeExpiredFleetSlots(
  db: ScopedDbAccess,
  nowMs = Date.now(),
): number {
  const r = db
    .prepare(`DELETE FROM admin_fleet_download_slots WHERE expires_at <= ?`)
    .run(nowIso(nowMs)) as { changes: number };
  return r.changes;
}

/* ------------------------------------------------------- garde-fous (F6) */

/**
 * Garde-fou rollout : toute release `rolling` qui accumule trop d'échecs
 * (`failed` + `rolled_back` ≥ seuil) passe automatiquement en `paused` —
 * les agents cessent immédiatement de recevoir la directive au poll suivant.
 * Seuil : option, sinon env CREEZIO_FLEET_AUTO_PAUSE_FAILURES, sinon 2.
 * Idempotent : une release déjà paused n'est pas retouchée.
 */
export function autoPauseFleetReleases(
  db: ScopedDbAccess,
  opts?: { maxFailures?: number; nowMs?: number },
): string[] {
  const env = Number(process.env.CREEZIO_FLEET_AUTO_PAUSE_FAILURES || 0);
  const max = opts?.maxFailures ?? (env > 0 ? env : 2);
  const rows = db
    .prepare(
      `SELECT r.id,
         (SELECT COUNT(*) FROM admin_fleet_update_reports p
          WHERE p.release_id = r.id AND p.status IN ('failed','rolled_back'))
           AS failures
       FROM admin_fleet_releases r WHERE r.status = 'rolling'`,
    )
    .all() as Array<{ id: string; failures: number }>;
  const paused: string[] = [];
  const ts = nowIso(opts?.nowMs);
  for (const r of rows) {
    if (r.failures < max) continue;
    db.prepare(
      `UPDATE admin_fleet_releases SET status = 'paused', updated_at = ?
       WHERE id = ? AND status = 'rolling'`,
    ).run(ts, r.id);
    db.prepare(
      `DELETE FROM admin_fleet_download_slots WHERE release_id = ?`,
    ).run(r.id);
    recordFleetEvent(
      db,
      null,
      "release_auto_paused",
      `${r.id} — ${r.failures} échec(s) ≥ seuil ${max}`,
    );
    paused.push(r.id);
  }
  return paused;
}

/* ------------------------------------------------------------------ mount */

export type FleetReleasesMountOptions = {
  /** Backend flotte (vérif credentials agents). Défaut env module fleet. */
  fleet?: FleetAdminMountOptions;
  /** Vérificateur credential agent (tests). Défaut : backend verify + cache. */
  verifyFleetCredential?: FleetCredentialVerifier;
  /** Slots de téléchargement simultanés par release. Défaut 5 (env CREEZIO_FLEET_DOWNLOAD_SLOTS). */
  maxDownloadSlots?: number;
  /** TTL d'une lease de téléchargement (s). Défaut 900 (15 min). */
  slotTtlSeconds?: number;
  /** Intervalle de poll annoncé aux agents (s). Défaut 300 (5 min). */
  pollIntervalSeconds?: number;
  /** Seuil d'auto-pause d'une release rolling (échecs). Défaut 2 (env CREEZIO_FLEET_AUTO_PAUSE_FAILURES). */
  autoPauseFailures?: number;
  /** Horloge injectable (gates : lease expirée). */
  nowMs?: () => number;
};

function maxSlotsOf(opts?: FleetReleasesMountOptions): number {
  const env = Number(process.env.CREEZIO_FLEET_DOWNLOAD_SLOTS || 0);
  return opts?.maxDownloadSlots ?? (env > 0 ? env : 5);
}

const RELEASE_STATUSES = new Set([
  "draft",
  "rolling",
  "paused",
  "done",
  "aborted",
]);
const REPORT_STATUSES = new Set(["done", "failed", "rolled_back"]);

/**
 * Mount `fleet-releases` — /api/v1/modules/fleet-releases/*.
 *
 * Agents (Bearer hostId:agentToken, vérifié via le backend flotte) :
 *   GET    next?hostId=…       → directives d'update + pollIntervalSeconds
 *   POST   slots               → lease téléchargement {releaseId, serverId}
 *   DELETE slots/<leaseId>     → libère la lease
 *   POST   report              → rapport d'update {releaseId, serverId, status}
 *
 * Session admin (UI /flotte) :
 *   GET    releases            → releases + agrégats de rapports
 *   POST   releases            → déclare une release (publish --release)
 *   PUT    releases/<id>       → status / wave_pct / channel / digest
 *   DELETE releases/<id>       → supprime (draft/aborted seulement)
 *   PUT    servers/<id…>/rollout → pin / hold / channel par serveur
 */
export function createFleetReleasesMount(
  opts?: FleetReleasesMountOptions,
): ApiMount {
  const verify =
    opts?.verifyFleetCredential ||
    createBackendFleetCredentialVerifier(opts?.fleet);
  const now = () => (opts?.nowMs ? opts.nowMs() : Date.now());

  async function agentAuth(
    req: ApiRequest,
    hostIdHint?: string,
  ): Promise<{ ok: boolean; hostId: string }> {
    const bearer = bearerOf(req);
    // Credential = "hostId:agentToken" (hostId dans le token — le hint
    // query/body doit correspondre pour éviter les confusions inter-hôtes).
    const i = bearer.indexOf(":");
    if (i <= 0) return { ok: false, hostId: "" };
    const hostId = bearer.slice(0, i);
    const token = bearer.slice(i + 1);
    if (hostIdHint && hostIdHint !== hostId) return { ok: false, hostId };
    const ok = await verify(hostId, token);
    return { ok, hostId };
  }

  const fleetPermission = "nav.fleet";
  return {
    dbLayer: "brand",
    // Pas de permission mount-level : next/slots/report sont des routes
    // AGENT (Bearer hostId:agentToken vérifié par le handler, allowlist
    // bordure) et maintenance est appelée in-process par le poller. Les ops
    // session (CRUD releases, rollout) sont gardées op par op.
    accessJustification:
      "routes agent next/slots/report (Bearer hostId:agentToken vérifié handler) + maintenance poller in-process — ops session gardées op par op (nav.fleet)",
    operations: [
      { id: "next", method: "GET", path: "/next", description: "Prochaines directives d'update" },
      { id: "create-slot", method: "POST", path: "/slots", description: "Créer un slot de téléchargement" },
      { id: "delete-slot", method: "DELETE", path: "/slots/:id", description: "Supprimer un slot" },
      { id: "report", method: "POST", path: "/report", description: "Rapport d'update agent" },
      { id: "maintenance", method: "POST", path: "/maintenance", description: "Maintenance releases" },
      { id: "list-releases", method: "GET", path: "/releases", description: "Lister les releases", permission: fleetPermission },
      { id: "create-release", method: "POST", path: "/releases", description: "Créer une release", permission: fleetPermission },
      { id: "update-release", method: "PATCH", path: "/releases/:id", description: "Mettre à jour une release", permission: fleetPermission },
      { id: "replace-release", method: "PUT", path: "/releases/:id", description: "Mettre à jour une release (PUT)", permission: fleetPermission },
      { id: "delete-release", method: "DELETE", path: "/releases/:id", description: "Supprimer une release", permission: fleetPermission },
      { id: "rollout", method: "PATCH", path: "/servers/:id/rollout", description: "Pin / hold / channel d'un serveur", permission: fleetPermission },
      // serverId = host/brand/name : variantes id NON encodé (fail-closed).
      { id: "rollout-put", method: "PUT", path: "/servers/:id/rollout", description: "Pin / hold / channel (PUT)", permission: fleetPermission },
      { id: "rollout-path", method: "PATCH", path: "/servers/:host/:brand/:name/rollout", description: "Rollout (id non encodé)", permission: fleetPermission },
      { id: "rollout-path-put", method: "PUT", path: "/servers/:host/:brand/:name/rollout", description: "Rollout (id non encodé, PUT)", permission: fleetPermission },
    ],
    // Le protocole flotte est porté dans les DEUX sens : les agents (boucle
    // pull agent-updates) vérifient le header des réponses de ce mount —
    // strict depuis 0.19.0 (FLEET_PROTOCOL_ACCEPT_MISSING=false).
    handle: async (ctx) => {
      const res = await handleFleetReleases(ctx);
      return {
        ...res,
        headers: {
          ...(res.headers || {}),
          [FLEET_PROTOCOL_HEADER]: String(FLEET_PROTOCOL_VERSION),
        },
      };
    },
  };

  async function handleFleetReleases({
    req,
    subPath,
    db,
  }: {
    req: ApiRequest;
    subPath: string;
    db?: ScopedDbAccess;
  }): Promise<{
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
  }> {
    {
      if (!db) {
        return { status: 503, body: { ok: false, error: "db_unavailable" } };
      }
      const method = req.method.toUpperCase();

      /* ------------------------------------------------ agents (Bearer) */

      if (subPath === "next" && method === "GET") {
        const hostId = String(
          (Array.isArray(req.query?.hostId)
            ? req.query?.hostId?.[0]
            : req.query?.hostId) || "",
        ).trim();
        if (!hostId) {
          return { status: 400, body: { ok: false, error: "hostId requis" } };
        }
        const auth = await agentAuth(req, hostId);
        if (!auth.ok) {
          return { status: 401, body: { ok: false, error: "unauthorized" } };
        }
        const updates = computeFleetUpdateDirectives(db, hostId);
        return {
          status: 200,
          body: {
            ok: true,
            updates,
            pollIntervalSeconds: opts?.pollIntervalSeconds ?? 300,
          },
        };
      }

      if (subPath === "slots" && method === "POST") {
        const body = (req.body || {}) as Record<string, unknown>;
        const releaseId = String(body.releaseId || "").trim();
        const serverId = String(body.serverId || "").trim();
        if (!releaseId || !serverId) {
          return {
            status: 400,
            body: { ok: false, error: "releaseId, serverId requis" },
          };
        }
        const auth = await agentAuth(req);
        if (!auth.ok) {
          return { status: 401, body: { ok: false, error: "unauthorized" } };
        }
        const nowMs = now();
        purgeExpiredFleetSlots(db, nowMs);
        // Lease déjà active pour ce serveur → renvoyée telle quelle
        // (idempotence des retries agent).
        const existing = db
          .prepare(
            `SELECT lease_id, expires_at FROM admin_fleet_download_slots
             WHERE release_id = ? AND server_id = ?`,
          )
          .get(releaseId, serverId) as
          | { lease_id: string; expires_at: string }
          | undefined;
        const ttlSeconds = opts?.slotTtlSeconds ?? 900;
        if (existing) {
          return {
            status: 200,
            body: {
              ok: true,
              granted: true,
              leaseId: existing.lease_id,
              ttlSeconds,
              expiresAt: existing.expires_at,
            },
          };
        }
        const active = (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM admin_fleet_download_slots
               WHERE release_id = ?`,
            )
            .get(releaseId) as { n: number }
        ).n;
        const max = maxSlotsOf(opts);
        if (active >= max) {
          const position = active - max + 1;
          return {
            status: 200,
            body: {
              ok: true,
              granted: false,
              position,
              retryAfterSeconds: Math.min(30 * position, 300),
            },
          };
        }
        const leaseId = newId();
        const expiresAt = nowIso(nowMs + ttlSeconds * 1000);
        db.prepare(
          `INSERT INTO admin_fleet_download_slots
           (lease_id, release_id, server_id, host_id, granted_at, expires_at)
           VALUES (?,?,?,?,?,?)`,
        ).run(leaseId, releaseId, serverId, auth.hostId, nowIso(nowMs), expiresAt);
        return {
          status: 200,
          body: { ok: true, granted: true, leaseId, ttlSeconds, expiresAt },
        };
      }

      if (subPath.startsWith("slots/") && method === "DELETE") {
        const auth = await agentAuth(req);
        if (!auth.ok) {
          return { status: 401, body: { ok: false, error: "unauthorized" } };
        }
        const leaseId = decodeURIComponent(subPath.slice("slots/".length));
        const r = db
          .prepare(`DELETE FROM admin_fleet_download_slots WHERE lease_id = ?`)
          .run(leaseId) as { changes: number };
        return { status: 200, body: { ok: true, released: Boolean(r.changes) } };
      }

      if (subPath === "report" && method === "POST") {
        const body = (req.body || {}) as Record<string, unknown>;
        const releaseId = String(body.releaseId || "").trim();
        const serverId = String(body.serverId || "").trim();
        const status = String(body.status || "").trim();
        if (!releaseId || !serverId || !REPORT_STATUSES.has(status)) {
          return {
            status: 400,
            body: {
              ok: false,
              error: "releaseId, serverId, status done|failed|rolled_back requis",
            },
          };
        }
        const auth = await agentAuth(req);
        if (!auth.ok) {
          return { status: 401, body: { ok: false, error: "unauthorized" } };
        }
        const ts = nowIso(now());
        const detail =
          body.detail === undefined ? null : String(body.detail).slice(0, 4000);
        const existing = db
          .prepare(
            `SELECT id FROM admin_fleet_update_reports
             WHERE release_id = ? AND server_id = ?`,
          )
          .get(releaseId, serverId) as { id: string } | undefined;
        if (existing) {
          db.prepare(
            `UPDATE admin_fleet_update_reports
             SET status = ?, detail = ?, host_id = ?, updated_at = ?
             WHERE id = ?`,
          ).run(status, detail, auth.hostId, ts, existing.id);
        } else {
          db.prepare(
            `INSERT INTO admin_fleet_update_reports
             (id, created_at, updated_at, release_id, server_id, host_id,
              status, detail)
             VALUES (?,?,?,?,?,?,?,?)`,
          ).run(newId(), ts, ts, releaseId, serverId, auth.hostId, status, detail);
        }
        recordFleetEvent(
          db,
          serverId,
          status === "done" ? "update_done" : "update_failed",
          `release=${releaseId} status=${status}${detail ? ` ${detail.slice(0, 200)}` : ""}`,
        );
        return { status: 200, body: { ok: true } };
      }

        /* ---------------------------------------------- maintenance (F6) */

        // Janitor idempotent : purge des leases expirées + auto-pause des
        // releases en échec. Appelé par le poller de fond de l'app admin
        // (startFleetRegistryPoller) — inoffensif si appelé plus souvent.
        if (subPath === "maintenance" && method === "POST") {
          const nowMs = now();
          const purgedSlots = purgeExpiredFleetSlots(db, nowMs);
          const autoPaused = autoPauseFleetReleases(db, {
            maxFailures: opts?.autoPauseFailures,
            nowMs,
          });
          return { status: 200, body: { ok: true, purgedSlots, autoPaused } };
        }

        /* -------------------------------------------- session admin (UI) */

        if (subPath === "releases" && method === "GET") {
        const releases = db
          .prepare(
            `SELECT r.*,
               (SELECT COUNT(*) FROM admin_fleet_update_reports p
                WHERE p.release_id = r.id AND p.status = 'done') AS reports_done,
               (SELECT COUNT(*) FROM admin_fleet_update_reports p
                WHERE p.release_id = r.id AND p.status = 'failed') AS reports_failed,
               (SELECT COUNT(*) FROM admin_fleet_update_reports p
                WHERE p.release_id = r.id AND p.status = 'rolled_back') AS reports_rolled_back,
               (SELECT COUNT(*) FROM admin_fleet_download_slots s
                WHERE s.release_id = r.id) AS active_slots
             FROM admin_fleet_releases r
             ORDER BY r.created_at DESC`,
          )
          .all();
        return { status: 200, body: { ok: true, releases } };
      }

      if (subPath === "releases" && method === "POST") {
        const body = (req.body || {}) as Record<string, unknown>;
        const brandId = String(body.brandId || "").trim();
        const tag = String(body.tag || "").trim();
        const image = String(body.image || "").trim();
        if (!brandId || !tag || !image) {
          return {
            status: 400,
            body: { ok: false, error: "brandId, tag, image requis" },
          };
        }
        const status = String(body.status || "draft");
        if (!RELEASE_STATUSES.has(status)) {
          return { status: 400, body: { ok: false, error: "status invalide" } };
        }
        const variant = String(body.variant || "base").trim() || "base";
        const ts = nowIso(now());
        // Idempotence publish --release : même (brand, tag, variant) → update.
        const existing = db
          .prepare(
            `SELECT id FROM admin_fleet_releases
             WHERE brand_id = ? AND tag = ? AND variant = ?`,
          )
          .get(brandId, tag, variant) as { id: string } | undefined;
        if (existing) {
          db.prepare(
            `UPDATE admin_fleet_releases
             SET image = ?, digest = ?, updated_at = ? WHERE id = ?`,
          ).run(
            image,
            body.digest == null ? null : String(body.digest),
            ts,
            existing.id,
          );
          const release = db
            .prepare(`SELECT * FROM admin_fleet_releases WHERE id = ?`)
            .get(existing.id);
          return { status: 200, body: { ok: true, release, updated: true } };
        }
        const id = newId();
        db.prepare(
          `INSERT INTO admin_fleet_releases
           (id, created_at, updated_at, brand_id, tag, image, digest,
            variant, channel, status, wave_pct)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          id,
          ts,
          ts,
          brandId,
          tag,
          image,
          body.digest == null ? null : String(body.digest),
          variant,
          String(body.channel || "stable").trim() || "stable",
          status,
          Math.max(0, Math.min(100, Number(body.wavePct ?? 0) || 0)),
        );
        recordFleetEvent(db, null, "release_created", `${brandId}:${tag} (${variant})`);
        const release = db
          .prepare(`SELECT * FROM admin_fleet_releases WHERE id = ?`)
          .get(id);
        return { status: 201, body: { ok: true, release } };
      }

      if (subPath.startsWith("releases/") && (method === "PUT" || method === "PATCH")) {
        const id = decodeURIComponent(subPath.slice("releases/".length));
        const body = (req.body || {}) as Record<string, unknown>;
        const sets: string[] = ["updated_at = ?"];
        const args: unknown[] = [nowIso(now())];
        if (body.status !== undefined) {
          const status = String(body.status);
          if (!RELEASE_STATUSES.has(status)) {
            return { status: 400, body: { ok: false, error: "status invalide" } };
          }
          sets.push("status = ?");
          args.push(status);
        }
        if (body.wavePct !== undefined) {
          sets.push("wave_pct = ?");
          args.push(Math.max(0, Math.min(100, Number(body.wavePct) || 0)));
        }
        if (body.channel !== undefined) {
          sets.push("channel = ?");
          args.push(String(body.channel || "stable").trim() || "stable");
        }
        if (body.digest !== undefined) {
          sets.push("digest = ?");
          args.push(body.digest == null ? null : String(body.digest));
        }
        args.push(id);
        const r = db
          .prepare(
            `UPDATE admin_fleet_releases SET ${sets.join(", ")} WHERE id = ?`,
          )
          .run(...args) as { changes: number };
        if (!r.changes) return { status: 404, body: { ok: false } };
        if (body.status !== undefined) {
          recordFleetEvent(db, null, "release_status", `${id} → ${body.status}`);
          // Kill-switch / pause / fin : les leases de téléchargement en cours
          // sont révoquées immédiatement (les agents cessent au poll suivant).
          if (String(body.status) !== "rolling") {
            db.prepare(
              `DELETE FROM admin_fleet_download_slots WHERE release_id = ?`,
            ).run(id);
          }
        }
        const release = db
          .prepare(`SELECT * FROM admin_fleet_releases WHERE id = ?`)
          .get(id);
        return { status: 200, body: { ok: true, release } };
      }

      if (subPath.startsWith("releases/") && method === "DELETE") {
        const id = decodeURIComponent(subPath.slice("releases/".length));
        const row = db
          .prepare(`SELECT status FROM admin_fleet_releases WHERE id = ?`)
          .get(id) as { status: string } | undefined;
        if (!row) return { status: 404, body: { ok: false } };
        if (row.status !== "draft" && row.status !== "aborted") {
          return {
            status: 409,
            body: {
              ok: false,
              error: "seule une release draft ou aborted peut être supprimée",
            },
          };
        }
        db.prepare(`DELETE FROM admin_fleet_releases WHERE id = ?`).run(id);
        db.prepare(
          `DELETE FROM admin_fleet_download_slots WHERE release_id = ?`,
        ).run(id);
        return { status: 200, body: { ok: true } };
      }

      // Pilotage rollout par serveur : pin / hold / channel.
      const mRollout = subPath.match(/^servers\/(.+)\/rollout$/);
      if (mRollout && (method === "PUT" || method === "PATCH")) {
        const id = decodeURIComponent(mRollout[1]!);
        const body = (req.body || {}) as Record<string, unknown>;
        const sets: string[] = ["updated_at = ?"];
        const args: unknown[] = [nowIso(now())];
        if (body.pinnedImage !== undefined) {
          sets.push("pinned_image = ?");
          args.push(body.pinnedImage == null ? null : String(body.pinnedImage));
        }
        if (body.hold !== undefined) {
          sets.push("hold = ?");
          args.push(body.hold ? 1 : 0);
        }
        if (body.channel !== undefined) {
          sets.push("channel = ?");
          args.push(String(body.channel || "stable").trim() || "stable");
        }
        args.push(id);
        const r = db
          .prepare(
            `UPDATE admin_fleet_servers SET ${sets.join(", ")} WHERE id = ?`,
          )
          .run(...args) as { changes: number };
        if (!r.changes) return { status: 404, body: { ok: false } };
        recordFleetEvent(
          db,
          id,
          "rollout_updated",
          JSON.stringify({
            pinnedImage: body.pinnedImage,
            hold: body.hold,
            channel: body.channel,
          }).slice(0, 500),
        );
        const server = db
          .prepare(
            `SELECT id, pinned_image, hold, channel FROM admin_fleet_servers WHERE id = ?`,
          )
          .get(id);
        return { status: 200, body: { ok: true, server } };
      }

      return { status: 404, body: { ok: false } };
    }
  }
}
