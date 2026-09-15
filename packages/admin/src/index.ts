/**
 * @creezio/admin — modules natifs des apps admin de marque (mode admin).
 *
 * ADR : docs/adr/ADR-admin-app-os.md. L'app admin est une app Creezio
 * complète (même OS) ; ce package fournit les modules communs à toutes les
 * admins de marques :
 *
 *   - fleet       : pilotage flotte (proxy vers le backend flotte
 *                   backend flotte @creezio/fleet — hôtes, serveurs, updates, logs…)
 *   - prospects   : CRM prospection kanban générique (la marque nomme)
 *   - roadmap     : roadmap produit de la marque
 *   - support     : tickets clients agrégés depuis les serveurs marque
 *   - billing     : abonnements/factures clients, rapprochement
 *                   client ↔ serveur ↔ abonnement (Stripe via config marque)
 *
 * Zéro domaine marque ici (ADR-no-brand-domain-in-native-packages) :
 * le naming (« restaurants »…) vient de la config de l'app admin.
 */

import crypto from "node:crypto";
import type {
  ApiKernel,
  ApiMount,
  ApiRequest,
  ModuleOperation,
  ScopedDbAccess,
} from "@creezio/api-kernel";
// T4 : le contrat client du backend flotte (URL/Basic env, fetch Basic,
// helpers typés) est importé directement de @creezio/fleet — plus de hop
// HTTP artisanal re-déclaré ici. Le transport Basic loopback demeure
// (backend flotte = container séparé, seul détenteur du socket Docker).
import {
  fleetBackendFetch,
  resolveFleetBackendBasic,
  resolveFleetBackendUrl,
  type FleetBackendClientOptions,
} from "@creezio/fleet";
import type { SqliteMigration } from "@creezio/platform-core";
import {
  ADMIN_SCHEMA_004_SQL,
  ADMIN_SCHEMA_006_SQL,
  createFleetRegistryMount,
  type FleetRegistryMountOptions,
} from "./fleet-registry.js";
import {
  ADMIN_SCHEMA_005_SQL,
  createFleetReleasesMount,
  type FleetReleasesMountOptions,
} from "./fleet-releases.js";

export {
  ADMIN_SCHEMA_004_SQL,
  ADMIN_SCHEMA_006_SQL,
  createFleetRegistryMount,
  createRateLimiter,
  deriveFleetOnline,
  fleetServerId,
  recordFleetEvent,
  startFleetRegistryPoller,
  syncFleetRegistryFromBackend,
  upsertFleetServerStatus,
  type FleetRegistryMountOptions,
  type FleetRegistryPollerOptions,
  type FleetServerStatusInput,
} from "./fleet-registry.js";

export {
  ADMIN_SCHEMA_005_SQL,
  autoPauseFleetReleases,
  computeFleetUpdateDirectives,
  createBackendFleetCredentialVerifier,
  createFleetReleasesMount,
  fleetImageMatchesTarget,
  fleetImageRefWithDigest,
  fleetWaveBucket,
  fleetWaveIncludes,
  purgeExpiredFleetSlots,
  type FleetCredentialVerifier,
  type FleetReleasesMountOptions,
  type FleetUpdateDirective,
} from "./fleet-releases.js";

/* ------------------------------------------------------------ migrations */

export const ADMIN_SCHEMA_SQL = `-- Schéma modules admin natifs (@creezio/admin)

CREATE TABLE IF NOT EXISTS admin_prospects (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  nom TEXT NOT NULL,
  contact TEXT,
  email TEXT,
  telephone TEXT,
  ville TEXT,
  site_web TEXT,
  notes TEXT,
  colonne TEXT NOT NULL DEFAULT 'a_contacter',
  position REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_roadmap_items (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  titre TEXT NOT NULL,
  description TEXT,
  statut TEXT NOT NULL DEFAULT 'idee',
  jalon TEXT,
  position REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_support_tickets (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- provenance flotte
  host_id TEXT,
  server_name TEXT,
  remote_id TEXT,
  -- contenu
  sujet TEXT NOT NULL,
  corps TEXT,
  auteur TEXT,
  statut TEXT NOT NULL DEFAULT 'ouvert',
  derniere_reponse TEXT
);

CREATE TABLE IF NOT EXISTS admin_billing_customers (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  nom TEXT NOT NULL,
  email TEXT,
  -- rapprochement flotte : quel serveur appartient à ce client
  host_id TEXT,
  server_name TEXT,
  stripe_customer_id TEXT
);

CREATE TABLE IF NOT EXISTS admin_billing_subscriptions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  plan TEXT,
  montant_mensuel REAL,
  devise TEXT DEFAULT 'EUR',
  statut TEXT NOT NULL DEFAULT 'active',
  stripe_subscription_id TEXT
);

CREATE TABLE IF NOT EXISTS admin_billing_invoices (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  subscription_id TEXT,
  periode TEXT,
  montant REAL,
  devise TEXT DEFAULT 'EUR',
  statut TEXT NOT NULL DEFAULT 'draft',
  stripe_invoice_id TEXT
);
`;

export const ADMIN_SCHEMA_002_SQL = `-- Fils support + journal événements Stripe

CREATE TABLE IF NOT EXISTS admin_support_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  remote_id TEXT,
  created_at TEXT NOT NULL,
  origine TEXT NOT NULL DEFAULT 'client',
  auteur TEXT,
  corps TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_support_messages_ticket
  ON admin_support_messages (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS admin_billing_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  stripe_event_id TEXT UNIQUE,
  type TEXT NOT NULL,
  payload TEXT
);
`;

export const ADMIN_SCHEMA_003_SQL = `-- Billing : prochaine échéance d'abonnement
ALTER TABLE admin_billing_subscriptions ADD COLUMN periode_fin TEXT;
`;

export function adminMigrations(): SqliteMigration[] {
  return [
    { id: "admin_001_native_modules", sql: ADMIN_SCHEMA_SQL },
    { id: "admin_002_support_messages_billing_events", sql: ADMIN_SCHEMA_002_SQL },
    { id: "admin_003_billing_periode_fin", sql: ADMIN_SCHEMA_003_SQL },
    { id: "admin_004_fleet_registry", sql: ADMIN_SCHEMA_004_SQL },
    { id: "admin_005_fleet_releases", sql: ADMIN_SCHEMA_005_SQL },
    { id: "admin_006_fleet_kit_version", sql: ADMIN_SCHEMA_006_SQL },
  ];
}

/* ------------------------------------ permissions des modules admin (P4) */

/**
 * Permission canonique de chaque module admin natif — SoT kit : gardée par
 * `authorizeModuleAccess` (mounts ci-dessous), filtrée par la sidebar
 * (`BrandNavItem.permission`) et administrable dans « Rôles & accès »
 * (@creezio/access-control). Owner = bypass systématique (kit).
 * `clients` / `landing` sont des modules scaffoldés côté app admin (entité
 * factory / @creezio/landing) — la constante vit ici pour que toute app
 * admin générée partage le même vocabulaire.
 */
export const ADMIN_MODULE_PERMISSIONS = {
  fleet: "nav.fleet",
  support: "nav.support",
  prospects: "nav.prospects",
  roadmap: "nav.roadmap",
  clients: "nav.clients",
  billing: "nav.billing",
  landing: "nav.landing",
} as const;

export type AdminModulePermissionId =
  (typeof ADMIN_MODULE_PERMISSIONS)[keyof typeof ADMIN_MODULE_PERMISSIONS];

type AdminAccessPermissionGroup = {
  id: string;
  label: string;
  permissions: Array<{ id: string; label: string }>;
};

/** Catalogue « un module = un groupe » pour la matrice Rôles & accès. */
export function adminAccessPermissionGroups(): AdminAccessPermissionGroup[] {
  return [
    {
      id: "fleet",
      label: "Flotte",
      permissions: [
        { id: ADMIN_MODULE_PERMISSIONS.fleet, label: "Flotte (serveurs, releases, updates)" },
      ],
    },
    {
      id: "support",
      label: "Support",
      permissions: [
        { id: ADMIN_MODULE_PERMISSIONS.support, label: "Tickets support" },
      ],
    },
    {
      id: "prospection",
      label: "Prospection",
      permissions: [
        { id: ADMIN_MODULE_PERMISSIONS.prospects, label: "Prospects (kanban)" },
      ],
    },
    {
      id: "roadmap",
      label: "Roadmap",
      permissions: [
        { id: ADMIN_MODULE_PERMISSIONS.roadmap, label: "Roadmap produit" },
      ],
    },
    {
      id: "billing",
      label: "Facturation",
      permissions: [
        { id: ADMIN_MODULE_PERMISSIONS.clients, label: "Clients" },
        { id: ADMIN_MODULE_PERMISSIONS.billing, label: "Billing (abonnements, factures, Stripe)" },
      ],
    },
    {
      id: "landing",
      label: "Landing page",
      permissions: [
        { id: ADMIN_MODULE_PERMISSIONS.landing, label: "Landing page (édition)" },
      ],
    },
  ];
}

export type AdminAccessControlPresetOptions = {
  /** Groupes additionnels (modules admin métier de la marque). */
  extraGroups?: AdminAccessPermissionGroup[];
  /** Permissions additionnelles du rôle collaborateur par défaut. */
  extraCollaboratorPermissions?: string[];
};

/**
 * Preset access-control des apps admin (à passer à `configureAccessControl`
 * dans brand-platform-bindings) — politique de migration EXPLICITE :
 * le rôle `collaborator` reçoit PAR DÉFAUT toutes les permissions de
 * modules (aucun compte existant ne perd d'accès au déploiement) ; l'owner
 * restreint ensuite compte par compte (onglet Comptes de « Rôles & accès »,
 * overrides `access_user_overrides`) ou pour tout le rôle (matrice).
 * `platform.access.manage` reste owner-only par défaut.
 */
export function adminAccessControlPreset(
  opts?: AdminAccessControlPresetOptions,
): {
  roles: Array<{ id: string; label: string; defaultPermissions: string[] }>;
  defaultRole: string;
  permissionGroups: AdminAccessPermissionGroup[];
} {
  const groups = [
    ...adminAccessPermissionGroups(),
    ...(opts?.extraGroups ?? []),
  ];
  const allModulePermissions = [
    ...new Set([
      ...groups.flatMap((g) => g.permissions.map((p) => p.id)),
      ...(opts?.extraCollaboratorPermissions ?? []),
    ]),
  ];
  return {
    roles: [
      {
        id: "collaborator",
        label: "Collaborateur",
        defaultPermissions: allModulePermissions,
      },
    ],
    defaultRole: "collaborator",
    permissionGroups: groups,
  };
}

/* ---------------------------------- opérations déclarées (SoT HTTP/MCP) */

const CRUD_OPS = (permission: string): ModuleOperation[] => [
  { id: "list", method: "GET", path: "/", description: "Lister", permission },
  { id: "create", method: "POST", path: "/", description: "Créer", permission },
  { id: "get", method: "GET", path: "/:id", description: "Lire", permission },
  { id: "update", method: "PATCH", path: "/:id", description: "Mettre à jour", permission },
  { id: "replace", method: "PUT", path: "/:id", description: "Remplacer", permission },
  { id: "delete", method: "DELETE", path: "/:id", description: "Supprimer", permission },
];

/* --------------------------------------------------------- module fleet */

/**
 * Options backend flotte des mounts admin — `backendUrl`/`basic` viennent du
 * client typé @creezio/fleet (`FleetBackendClientOptions`, T4).
 */
export type FleetAdminMountOptions = FleetBackendClientOptions & {
  /** Timeout par requête proxy (ms). */
  timeoutMs?: number;
};

/**
 * Module `fleet` — proxy authentifié vers le backend flotte.
 *
 * `/api/v1/modules/fleet/<sub>` → `{backend}/admin/api/<sub>` (Basic).
 * Garde : session + permission `nav.fleet` (owner bypass) — le Basic reste
 * interne au serveur admin (jamais exposé au client).
 */
export function createFleetAdminMount(opts?: FleetAdminMountOptions): ApiMount {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  return {
    dbLayer: "brand",
    permission: ADMIN_MODULE_PERMISSIONS.fleet,
    operations: [
      { id: "proxy-get", method: "GET", path: "/", description: "Proxy GET backend flotte" },
      { id: "proxy-get-sub", method: "GET", path: "/:sub", description: "Proxy GET sous-chemin flotte" },
      { id: "proxy-post", method: "POST", path: "/", description: "Proxy POST backend flotte" },
      { id: "proxy-post-sub", method: "POST", path: "/:sub", description: "Proxy POST sous-chemin flotte" },
      { id: "proxy-put", method: "PUT", path: "/:sub", description: "Proxy PUT flotte" },
      { id: "proxy-patch", method: "PATCH", path: "/:sub", description: "Proxy PATCH flotte" },
      { id: "proxy-delete", method: "DELETE", path: "/:sub", description: "Proxy DELETE flotte" },
    ],
    handle: async ({ req, subPath }) => {
      const base = resolveFleetBackendUrl(opts);
      const basic = resolveFleetBackendBasic(opts);
      if (!basic) {
        return {
          status: 503,
          body: {
            ok: false,
            error:
              "backend flotte non configuré (CREEZIO_FLEET_BACKEND_BASIC requis)",
          },
        };
      }
      const qs = buildQueryString(req);
      const url = `${base}/admin/api/${subPath}${qs}`;
      const method = req.method.toUpperCase();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method,
          signal: ctrl.signal,
          headers: {
            Authorization: `Basic ${Buffer.from(basic).toString("base64")}`,
            ...(req.body !== undefined && method !== "GET"
              ? { "Content-Type": "application/json" }
              : {}),
          },
          ...(req.body !== undefined && method !== "GET"
            ? { body: JSON.stringify(req.body) }
            : {}),
        });
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = { ok: false, error: "réponse backend non JSON" };
        }
        return { status: res.status, body };
      } catch (e) {
        return {
          status: 502,
          body: {
            ok: false,
            error: `backend flotte injoignable: ${(e as Error)?.message || e}`,
          },
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function buildQueryString(req: ApiRequest): string {
  const entries = Object.entries(req.query || {});
  if (!entries.length) return "";
  const qs = new URLSearchParams();
  for (const [k, v] of entries) {
    if (Array.isArray(v)) {
      for (const x of v) qs.append(k, String(x));
    } else if (v != null) {
      qs.set(k, String(v));
    }
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/* --------------------------------------------- CRUD générique (SQLite) */

const CRUD_TABLES: Record<string, readonly string[]> = {
  prospects: [
    "nom",
    "contact",
    "email",
    "telephone",
    "ville",
    "site_web",
    "notes",
    "colonne",
    "position",
  ],
  roadmap: ["titre", "description", "statut", "jalon", "position"],
  "billing-customers": [
    "nom",
    "email",
    "host_id",
    "server_name",
    "stripe_customer_id",
  ],
  "billing-subscriptions": [
    "customer_id",
    "plan",
    "montant_mensuel",
    "devise",
    "statut",
    "stripe_subscription_id",
  ],
};

const CRUD_SQL_TABLE: Record<string, string> = {
  prospects: "admin_prospects",
  roadmap: "admin_roadmap_items",
  "billing-customers": "admin_billing_customers",
  "billing-subscriptions": "admin_billing_subscriptions",
};

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

/**
 * Mount CRUD générique sur brand.db de l'app admin.
 * GET '' → liste ; POST '' → create ; GET/PUT/DELETE '<id>'.
 */
/** Permission module d'un mount CRUD admin (billing-* → nav.billing). */
const CRUD_PERMISSION: Record<keyof typeof CRUD_SQL_TABLE, string> = {
  prospects: ADMIN_MODULE_PERMISSIONS.prospects,
  roadmap: ADMIN_MODULE_PERMISSIONS.roadmap,
  "billing-customers": ADMIN_MODULE_PERMISSIONS.billing,
  "billing-subscriptions": ADMIN_MODULE_PERMISSIONS.billing,
};

export function createAdminCrudMount(kind: keyof typeof CRUD_SQL_TABLE): ApiMount {
  const table = CRUD_SQL_TABLE[kind];
  const cols = CRUD_TABLES[kind] || [];
  const permission =
    CRUD_PERMISSION[kind] ?? ADMIN_MODULE_PERMISSIONS.billing;
  return {
    dbLayer: "brand",
    permission,
    operations: CRUD_OPS(permission),
    handle: async ({ req, subPath, db }) => {
      if (!db) return { status: 503, body: { ok: false, error: "db_unavailable" } };
      const method = req.method.toUpperCase();
      const parts = subPath.split("/").filter(Boolean);

      if (!parts.length && method === "GET") {
        // `position` n'existe que sur les tables kanban-ordonnables.
        const orderBy = cols.includes("position")
          ? "position ASC, created_at DESC"
          : "created_at DESC";
        const items = db
          .prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`)
          .all();
        return { status: 200, body: { ok: true, items } };
      }

      if (!parts.length && method === "POST") {
        const body = (req.body || {}) as Record<string, unknown>;
        // PROSP-3 / ROAD-3 — validations métier avant INSERT (éviter 500 SQLite).
        if (kind === "prospects" && !String(body.nom || "").trim()) {
          return {
            status: 400,
            body: { ok: false, error: "nom_required" },
          };
        }
        if (kind === "roadmap" && !String(body.titre || "").trim()) {
          return {
            status: 400,
            body: { ok: false, error: "titre_required" },
          };
        }
        const id = String(body.id || newId());
        const ts = nowIso();
        const values: Record<string, unknown> = {
          id,
          created_at: ts,
          updated_at: ts,
        };
        for (const c of cols) {
          if (body[c] !== undefined) values[c] = body[c];
        }
        const keys = Object.keys(values);
        db.prepare(
          `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys
            .map(() => "?")
            .join(",")})`,
        ).run(...keys.map((k) => values[k]));
        const item = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
        return { status: 201, body: { ok: true, item } };
      }

      if (parts.length === 1) {
        const id = parts[0]!;
        if (method === "GET") {
          const item = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
          if (!item) return { status: 404, body: { ok: false } };
          return { status: 200, body: { ok: true, item } };
        }
        if (method === "PUT" || method === "PATCH") {
          const body = (req.body || {}) as Record<string, unknown>;
          const sets: string[] = ["updated_at = ?"];
          const args: unknown[] = [nowIso()];
          for (const c of cols) {
            if (body[c] !== undefined) {
              sets.push(`${c} = ?`);
              args.push(body[c]);
            }
          }
          args.push(id);
          const r = db
            .prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`)
            .run(...args) as { changes: number };
          if (!r.changes) return { status: 404, body: { ok: false } };
          const item = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
          return { status: 200, body: { ok: true, item } };
        }
        if (method === "DELETE") {
          const r = db
            .prepare(`DELETE FROM ${table} WHERE id = ?`)
            .run(id) as { changes: number };
          return { status: r.changes ? 200 : 404, body: { ok: Boolean(r.changes) } };
        }
      }

      return { status: 404, body: { ok: false } };
    },
  };
}

/* -------------------------------------------------------- module support */

/**
 * Appel authentifié (Basic) vers le backend flotte — délègue au client typé
 * `fleetBackendFetch` de @creezio/fleet (T4). Export conservé (module
 * support + consommateurs existants).
 */
export async function fleetFetch(
  opts: FleetAdminMountOptions | undefined,
  method: string,
  subPath: string,
  body?: unknown,
  timeoutMs = 8000,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  return fleetBackendFetch(opts, method, subPath, body, timeoutMs);
}

/** Chemin backend flotte du mount support d'un serveur (local ou hôte). */
function supportPathFor(
  s: { hostId?: string; brandId: string; name: string },
  rest: string,
): string {
  const seg = `servers/${encodeURIComponent(s.brandId)}/${encodeURIComponent(s.name)}/support${rest}`;
  return s.hostId && s.hostId !== "local"
    ? `/admin/api/hosts/${encodeURIComponent(s.hostId)}/${seg}`
    : `/admin/api/${seg}`;
}

export type SupportAdminMountOptions = {
  fleet?: FleetAdminMountOptions;
};

/**
 * Module `support` (côté admin) — tickets agrégés depuis les serveurs
 * marque (brique serveur : `@creezio/support`, mount `platform-support`).
 *
 * - GET  ``            → tickets agrégés
 * - GET  `<id>`        → ticket + fil de messages
 * - POST `sync`        → pull TOUTE la flotte (backend flotte → agents →
 *                        instances) et upsert tickets + messages
 * - POST `<id>/reply`  → réponse admin : relayée au serveur marque
 *                        (visible par le client) + copie locale
 * - POST `<id>/statut` → statut local + propagation au serveur marque
 * - POST `ingest`      → upsert direct (tests / imports)
 */
export function createSupportAdminMount(
  opts?: SupportAdminMountOptions,
): ApiMount {
  return {
    dbLayer: "brand",
    permission: ADMIN_MODULE_PERMISSIONS.support,
    operations: [
      { id: "list", method: "GET", path: "/", description: "Lister les tickets agrégés" },
      { id: "sync", method: "POST", path: "/sync", description: "Pull tickets depuis la flotte" },
      { id: "ingest", method: "POST", path: "/ingest", description: "Upsert ticket (tests / imports)" },
      { id: "get", method: "GET", path: "/:id", description: "Ticket + fil de messages" },
      { id: "reply", method: "POST", path: "/:id/reply", description: "Répondre à un ticket" },
      { id: "statut", method: "POST", path: "/:id/statut", description: "Changer le statut d'un ticket" },
    ],
    handle: async ({ req, subPath, db }) => {
      if (!db) return { status: 503, body: { ok: false, error: "db_unavailable" } };
      const method = req.method.toUpperCase();
      const parts = subPath.split("/").filter(Boolean);

      if (!parts.length && method === "GET") {
        const items = db
          .prepare(
            `SELECT t.*,
               (SELECT COUNT(*) FROM admin_support_messages m WHERE m.ticket_id = t.id) AS messages_count
             FROM admin_support_tickets t ORDER BY t.updated_at DESC`,
          )
          .all();
        return { status: 200, body: { ok: true, items } };
      }

      // Pull de toute la flotte : backend flotte → (agents) → instances.
      if (parts.length === 1 && parts[0] === "sync" && method === "POST") {
        const list = await fleetFetch(opts?.fleet, "GET", "/admin/api/servers");
        if (list.status !== 200 || !list.json?.ok) {
          return {
            status: 502,
            body: { ok: false, error: "backend flotte injoignable", detail: list.json },
          };
        }
        const servers = (list.json.servers || []) as Array<{
          hostId?: string;
          brandId: string;
          name: string;
          orphan?: boolean;
        }>;
        let scanned = 0;
        let tickets = 0;
        let messages = 0;
        const errors: string[] = [];
        for (const s of servers) {
          if (s.orphan || !s.brandId || !s.name) continue;
          scanned++;
          let exp: Awaited<ReturnType<typeof fleetFetch>>;
          try {
            exp = await fleetFetch(
              opts?.fleet,
              "GET",
              supportPathFor(s, "/export"),
            );
          } catch (e) {
            errors.push(`${s.name}: ${(e as Error)?.message || e}`);
            continue;
          }
          if (exp.status !== 200 || !exp.json?.ok) continue;
          const remoteTickets = (exp.json.tickets || []) as Array<
            Record<string, unknown> & { messages?: Array<Record<string, unknown>> }
          >;
          for (const t of remoteTickets) {
            const remoteId = String(t.id || "");
            if (!remoteId) continue;
            const hostId = String(s.hostId || "local");
            const existing = db
              .prepare(
                `SELECT id FROM admin_support_tickets
                 WHERE host_id = ? AND server_name = ? AND remote_id = ?`,
              )
              .get(hostId, s.name, remoteId) as { id: string } | undefined;
            const ts = nowIso();
            const msgs = Array.isArray(t.messages) ? t.messages : [];
            const firstClient = msgs.find((m) => m.origine !== "admin");
            const lastAdmin = [...msgs]
              .reverse()
              .find((m) => m.origine === "admin");
            let localId: string;
            if (existing) {
              localId = existing.id;
              db.prepare(
                `UPDATE admin_support_tickets
                 SET sujet = ?, corps = ?, auteur = ?, statut = ?,
                     derniere_reponse = ?, updated_at = ?
                 WHERE id = ?`,
              ).run(
                String(t.sujet || "(sans sujet)"),
                String(firstClient?.corps || t.corps || ""),
                String(t.auteur || ""),
                String(t.statut || "ouvert"),
                lastAdmin ? String(lastAdmin.created_at || "") : null,
                ts,
                localId,
              );
            } else {
              localId = newId();
              db.prepare(
                `INSERT INTO admin_support_tickets
                 (id, created_at, updated_at, host_id, server_name, remote_id,
                  sujet, corps, auteur, statut, derniere_reponse)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
              ).run(
                localId,
                String(t.created_at || ts),
                ts,
                hostId,
                s.name,
                remoteId,
                String(t.sujet || "(sans sujet)"),
                String(firstClient?.corps || t.corps || ""),
                String(t.auteur || ""),
                String(t.statut || "ouvert"),
                lastAdmin ? String(lastAdmin.created_at || "") : null,
              );
            }
            tickets++;
            for (const m of msgs) {
              const mRemoteId = String(m.id || "");
              if (!mRemoteId) continue;
              const mExists = db
                .prepare(
                  `SELECT id FROM admin_support_messages
                   WHERE ticket_id = ? AND remote_id = ?`,
                )
                .get(localId, mRemoteId) as { id: string } | undefined;
              if (mExists) continue;
              db.prepare(
                `INSERT INTO admin_support_messages
                 (id, ticket_id, remote_id, created_at, origine, auteur, corps)
                 VALUES (?,?,?,?,?,?,?)`,
              ).run(
                newId(),
                localId,
                mRemoteId,
                String(m.created_at || nowIso()),
                String(m.origine || "client"),
                m.auteur == null ? null : String(m.auteur),
                String(m.corps || ""),
              );
              messages++;
            }
          }
        }
        return {
          status: 200,
          body: { ok: true, scanned, tickets, messages, errors },
        };
      }

      // Ingestion (sync flotte) : upsert par (host_id, server_name, remote_id).
      if (parts.length === 1 && parts[0] === "ingest" && method === "POST") {
        const body = (req.body || {}) as { tickets?: Array<Record<string, unknown>> };
        const tickets = Array.isArray(body.tickets) ? body.tickets : [];
        let upserted = 0;
        for (const t of tickets) {
          const hostId = String(t.host_id || "");
          const serverName = String(t.server_name || "");
          const remoteId = String(t.remote_id || t.id || "");
          if (!remoteId) continue;
          const existing = db
            .prepare(
              `SELECT id FROM admin_support_tickets
               WHERE host_id = ? AND server_name = ? AND remote_id = ?`,
            )
            .get(hostId, serverName, remoteId) as { id: string } | undefined;
          const ts = nowIso();
          if (existing) {
            db.prepare(
              `UPDATE admin_support_tickets
               SET sujet = ?, corps = ?, auteur = ?, statut = ?, updated_at = ?
               WHERE id = ?`,
            ).run(
              String(t.sujet || t.subject || "(sans sujet)"),
              String(t.corps || t.body || ""),
              String(t.auteur || t.author || ""),
              String(t.statut || t.status || "ouvert"),
              ts,
              existing.id,
            );
          } else {
            db.prepare(
              `INSERT INTO admin_support_tickets
               (id, created_at, updated_at, host_id, server_name, remote_id,
                sujet, corps, auteur, statut)
               VALUES (?,?,?,?,?,?,?,?,?,?)`,
            ).run(
              newId(),
              String(t.created_at || ts),
              ts,
              hostId,
              serverName,
              remoteId,
              String(t.sujet || t.subject || "(sans sujet)"),
              String(t.corps || t.body || ""),
              String(t.auteur || t.author || ""),
              String(t.statut || t.status || "ouvert"),
            );
          }
          upserted++;
        }
        return { status: 200, body: { ok: true, upserted } };
      }

      if (parts.length === 1 && method === "GET") {
        const item = db
          .prepare(`SELECT * FROM admin_support_tickets WHERE id = ?`)
          .get(parts[0]!) as Record<string, unknown> | undefined;
        if (!item) return { status: 404, body: { ok: false } };
        const messages = db
          .prepare(
            `SELECT * FROM admin_support_messages
             WHERE ticket_id = ? ORDER BY created_at ASC`,
          )
          .all(parts[0]!);
        return { status: 200, body: { ok: true, item, messages } };
      }

      // Réponse admin — relayée au serveur marque (le client la voit sur
      // sa page /support) puis copiée localement.
      if (parts.length === 2 && parts[1] === "reply" && method === "POST") {
        const body = (req.body || {}) as { corps?: string; auteur?: string };
        const corps = String(body.corps || "").trim();
        if (!corps) return { status: 400, body: { ok: false, error: "corps requis" } };
        const ticket = db
          .prepare(`SELECT * FROM admin_support_tickets WHERE id = ?`)
          .get(parts[0]!) as
          | { id: string; host_id: string; server_name: string; remote_id: string; sujet: string }
          | undefined;
        if (!ticket) return { status: 404, body: { ok: false } };
        // Retrouver le brandId du serveur d'origine via la liste flotte.
        const list = await fleetFetch(opts?.fleet, "GET", "/admin/api/servers");
        const servers = (list.json?.servers || []) as Array<{
          hostId?: string;
          brandId: string;
          name: string;
        }>;
        const origin = servers.find(
          (s) =>
            (String(s.hostId || "local") === ticket.host_id) &&
            s.name === ticket.server_name,
        );
        if (!origin) {
          return {
            status: 502,
            body: { ok: false, error: "serveur d'origine introuvable dans la flotte" },
          };
        }
        const r = await fleetFetch(
          opts?.fleet,
          "POST",
          supportPathFor(origin, `/${encodeURIComponent(ticket.remote_id)}/reply`),
          { corps, auteur: String(body.auteur || "").trim() || "support" },
        );
        if (r.status !== 200 || !r.json?.ok) {
          return {
            status: 502,
            body: { ok: false, error: "relais réponse KO", detail: r.json },
          };
        }
        const ts = nowIso();
        db.prepare(
          `INSERT INTO admin_support_messages
           (id, ticket_id, remote_id, created_at, origine, auteur, corps)
           VALUES (?,?,?,?,?,?,?)`,
        ).run(newId(), ticket.id, null, ts, "admin", String(body.auteur || "support"), corps);
        db.prepare(
          `UPDATE admin_support_tickets
           SET statut = 'repondu', derniere_reponse = ?, updated_at = ? WHERE id = ?`,
        ).run(ts, ts, ticket.id);
        return { status: 200, body: { ok: true } };
      }

      if (parts.length === 2 && parts[1] === "statut" && method === "POST") {
        const body = (req.body || {}) as { statut?: string };
        const statut = String(body.statut || "ouvert");
        const ticket = db
          .prepare(`SELECT * FROM admin_support_tickets WHERE id = ?`)
          .get(parts[0]!) as
          | { id: string; host_id: string; server_name: string; remote_id: string }
          | undefined;
        if (!ticket) return { status: 404, body: { ok: false } };
        db.prepare(
          `UPDATE admin_support_tickets SET statut = ?, updated_at = ? WHERE id = ?`,
        ).run(statut, nowIso(), ticket.id);
        // Propagation best-effort au serveur marque (le client voit le statut).
        try {
          const list = await fleetFetch(opts?.fleet, "GET", "/admin/api/servers");
          const servers = (list.json?.servers || []) as Array<{
            hostId?: string;
            brandId: string;
            name: string;
          }>;
          const origin = servers.find(
            (s) =>
              String(s.hostId || "local") === ticket.host_id &&
              s.name === ticket.server_name,
          );
          if (origin) {
            await fleetFetch(
              opts?.fleet,
              "POST",
              supportPathFor(origin, `/${encodeURIComponent(ticket.remote_id)}/statut`),
              { statut },
            );
          }
        } catch {
          /* best-effort */
        }
        return { status: 200, body: { ok: true } };
      }

      return { status: 404, body: { ok: false } };
    },
  };
}

/* -------------------------------------------------- module billing Stripe */

export type BillingWebhookMountOptions = {
  /**
   * Secret de signature webhook (`whsec_…`). Défaut env
   * STRIPE_WEBHOOK_SECRET (fichier .env gitignoré de l'app admin).
   */
  webhookSecret?: string;
  /** Tolérance horodatage signature (s). Défaut 300. */
  toleranceSeconds?: number;
};

function stripeSecret(opts?: BillingWebhookMountOptions): string {
  return (
    opts?.webhookSecret || (process.env.STRIPE_WEBHOOK_SECRET || "").trim()
  );
}

/**
 * Vérifie une signature Stripe (`stripe-signature: t=…,v1=…`) sur le corps
 * brut — schéma officiel : HMAC-SHA256(secret, `${t}.${payload}`).
 * Implémentation locale : pas de dépendance au SDK stripe.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  if (!rawBody || !header || !secret) return false;
  const parts = new Map<string, string[]>();
  for (const kv of header.split(",")) {
    const i = kv.indexOf("=");
    if (i <= 0) continue;
    const k = kv.slice(0, i).trim();
    const v = kv.slice(i + 1).trim();
    parts.set(k, [...(parts.get(k) || []), v]);
  }
  const t = Number(parts.get("t")?.[0] || 0);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  for (const sig of parts.get("v1") || []) {
    try {
      if (
        sig.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
      ) {
        return true;
      }
    } catch {
      /* longueur invalide */
    }
  }
  return false;
}

type StripeEvent = {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
};

/* ---- projections partagées webhook (passif) / réconciliation (active) ---- */

function projectStripeCustomer(
  db: ScopedDbAccess,
  obj: Record<string, unknown>,
  ts: string,
): boolean {
  const stripeCustomerId = String(obj.id || "");
  if (!stripeCustomerId) return false;
  const nom = String(obj.name || obj.email || stripeCustomerId);
  const email = obj.email == null ? null : String(obj.email);
  const existing = db
    .prepare(
      `SELECT id FROM admin_billing_customers WHERE stripe_customer_id = ?`,
    )
    .get(stripeCustomerId) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE admin_billing_customers SET nom = ?, email = ?, updated_at = ? WHERE id = ?`,
    ).run(nom, email, ts, existing.id);
  } else {
    db.prepare(
      `INSERT INTO admin_billing_customers
       (id, created_at, updated_at, nom, email, stripe_customer_id)
       VALUES (?,?,?,?,?,?)`,
    ).run(newId(), ts, ts, nom, email, stripeCustomerId);
  }
  return true;
}

function projectStripeSubscription(
  db: ScopedDbAccess,
  obj: Record<string, unknown>,
  ts: string,
  o?: { forceCanceled?: boolean },
): boolean {
  const stripeSubId = String(obj.id || "");
  const stripeCustomerId = String(obj.customer || "");
  if (!stripeSubId) return false;
  let customer = db
    .prepare(
      `SELECT id FROM admin_billing_customers WHERE stripe_customer_id = ?`,
    )
    .get(stripeCustomerId) as { id: string } | undefined;
  if (!customer && stripeCustomerId) {
    const cid = newId();
    db.prepare(
      `INSERT INTO admin_billing_customers
       (id, created_at, updated_at, nom, stripe_customer_id)
       VALUES (?,?,?,?,?)`,
    ).run(cid, ts, ts, stripeCustomerId, stripeCustomerId);
    customer = { id: cid };
  }
  const items = (obj.items as { data?: Array<Record<string, unknown>> })?.data;
  const price = (items?.[0]?.price || {}) as Record<string, unknown>;
  const plan = String(price.nickname || price.id || "");
  const montant =
    price.unit_amount != null ? Number(price.unit_amount) / 100 : null;
  const devise = String(price.currency || "eur").toUpperCase();
  const statut = o?.forceCanceled ? "canceled" : String(obj.status || "active");
  // prochaine échéance : current_period_end (epoch s) — au niveau
  // subscription (API historique) ou du premier item (API 2025+).
  const periodEndEpoch =
    obj.current_period_end ?? items?.[0]?.current_period_end;
  const periodeFin = periodEndEpoch
    ? new Date(Number(periodEndEpoch) * 1000).toISOString()
    : null;
  const existing = db
    .prepare(
      `SELECT id FROM admin_billing_subscriptions WHERE stripe_subscription_id = ?`,
    )
    .get(stripeSubId) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE admin_billing_subscriptions
       SET plan = ?, montant_mensuel = ?, devise = ?, statut = ?,
           periode_fin = COALESCE(?, periode_fin), updated_at = ?
       WHERE id = ?`,
    ).run(plan, montant, devise, statut, periodeFin, ts, existing.id);
  } else {
    db.prepare(
      `INSERT INTO admin_billing_subscriptions
       (id, created_at, updated_at, customer_id, plan, montant_mensuel,
        devise, statut, periode_fin, stripe_subscription_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      newId(),
      ts,
      ts,
      customer?.id || "",
      plan,
      montant,
      devise,
      statut,
      periodeFin,
      stripeSubId,
    );
  }
  return true;
}

function projectStripeInvoice(
  db: ScopedDbAccess,
  obj: Record<string, unknown>,
  ts: string,
  statutHint?: string,
): boolean {
  const stripeInvoiceId = String(obj.id || "");
  const stripeCustomerId = String(obj.customer || "");
  if (!stripeInvoiceId) return false;
  const customer = db
    .prepare(
      `SELECT id FROM admin_billing_customers WHERE stripe_customer_id = ?`,
    )
    .get(stripeCustomerId) as { id: string } | undefined;
  const sub = db
    .prepare(
      `SELECT id FROM admin_billing_subscriptions WHERE stripe_subscription_id = ?`,
    )
    .get(String(obj.subscription || "")) as { id: string } | undefined;
  const amountCents =
    obj.amount_paid != null && Number(obj.amount_paid) > 0
      ? obj.amount_paid
      : obj.amount_due;
  const montant = amountCents != null ? Number(amountCents) / 100 : null;
  const statut =
    statutHint ||
    (obj.paid === true ? "paid" : String(obj.status || "open"));
  const periode = obj.period_start
    ? new Date(Number(obj.period_start) * 1000).toISOString().slice(0, 7)
    : null;
  const existing = db
    .prepare(`SELECT id FROM admin_billing_invoices WHERE stripe_invoice_id = ?`)
    .get(stripeInvoiceId) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE admin_billing_invoices
       SET montant = ?, statut = ?, periode = ? WHERE id = ?`,
    ).run(montant, statut, periode, existing.id);
  } else {
    db.prepare(
      `INSERT INTO admin_billing_invoices
       (id, created_at, customer_id, subscription_id, periode, montant,
        devise, statut, stripe_invoice_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      newId(),
      ts,
      customer?.id || "",
      sub?.id || null,
      periode,
      montant,
      String(obj.currency || "eur").toUpperCase(),
      statut,
      stripeInvoiceId,
    );
  }
  return true;
}

/**
 * Module `billing-webhook` — POST `/api/v1/modules/billing-webhook/stripe`.
 *
 * Auth = signature Stripe (pas de session : Stripe appelle directement).
 * Chaque événement est journalisé (`admin_billing_events`, dédup par id
 * Stripe) puis projeté :
 *   - customer.created|updated            → admin_billing_customers
 *   - customer.subscription.*             → admin_billing_subscriptions
 *   - invoice.finalized|paid|payment_failed|voided → admin_billing_invoices
 */
export function createBillingWebhookMount(
  opts?: BillingWebhookMountOptions,
): ApiMount {
  return {
    dbLayer: "brand",
    // JAMAIS de permission ici : Stripe appelle sans session — l'auth est
    // la signature HMAC vérifiée par le handler (verifyStripeSignature) et
    // la bordure allowliste ce chemin (PUBLIC_MODULE_PATHS).
    accessJustification:
      "webhook Stripe signé (stripe-signature HMAC-SHA256 vérifiée par le mount) — route machine sans session",
    operations: [
      { id: "stripe", method: "POST", path: "/stripe", description: "Webhook Stripe signé" },
    ],
    handle: async ({ req, subPath, db }) => {
      if (!db) return { status: 503, body: { ok: false, error: "db_unavailable" } };
      if (subPath !== "stripe" || req.method.toUpperCase() !== "POST") {
        return { status: 404, body: { ok: false } };
      }
      const secret = stripeSecret(opts);
      if (!secret) {
        return {
          status: 503,
          body: { ok: false, error: "STRIPE_WEBHOOK_SECRET non configuré" },
        };
      }
      const header = String(
        (Array.isArray(req.headers?.["stripe-signature"])
          ? req.headers?.["stripe-signature"]?.[0]
          : req.headers?.["stripe-signature"]) || "",
      );
      const raw = req.rawBody || "";
      if (
        !verifyStripeSignature(
          raw,
          header,
          secret,
          opts?.toleranceSeconds ?? 300,
        )
      ) {
        return { status: 400, body: { ok: false, error: "signature invalide" } };
      }
      const event = (req.body || {}) as StripeEvent;
      const eventId = String(event.id || "");
      const type = String(event.type || "");
      const obj = (event.data?.object || {}) as Record<string, unknown>;
      const ts = nowIso();

      // Journal (idempotence : Stripe retente les webhooks).
      if (eventId) {
        const seen = db
          .prepare(
            `SELECT id FROM admin_billing_events WHERE stripe_event_id = ?`,
          )
          .get(eventId);
        if (seen) return { status: 200, body: { ok: true, duplicate: true } };
        db.prepare(
          `INSERT INTO admin_billing_events (id, created_at, stripe_event_id, type, payload)
           VALUES (?,?,?,?,?)`,
        ).run(newId(), ts, eventId, type, raw.slice(0, 100_000));
      }

      if (type === "customer.created" || type === "customer.updated") {
        projectStripeCustomer(db, obj, ts);
      } else if (type.startsWith("customer.subscription.")) {
        projectStripeSubscription(db, obj, ts, {
          forceCanceled: type === "customer.subscription.deleted",
        });
      } else if (type.startsWith("invoice.")) {
        const statut =
          type === "invoice.paid" || obj.paid === true
            ? "paid"
            : type === "invoice.payment_failed"
              ? "payment_failed"
              : String(obj.status || "open");
        projectStripeInvoice(db, obj, ts, statut);
      }

      return { status: 200, body: { ok: true, received: type } };
    },
  };
}

/* --------------------------------------- module billing (UI + reconcile) */

export type BillingAdminMountOptions = {
  /**
   * Clé secrète API Stripe (`sk_live_…` / `sk_test_…`). Défaut env
   * STRIPE_API_KEY (fichier .env gitignoré de l'app admin — jamais commitée).
   * Dashboard Stripe → Développeurs → Clés API → « Clé secrète ».
   */
  stripeApiKey?: string;
  /**
   * Base de l'API Stripe. Défaut env STRIPE_API_BASE puis
   * https://api.stripe.com — l'override sert aux tests (mock local).
   */
  apiBase?: string;
  /** Timeout par appel Stripe (ms). Défaut 20000. */
  timeoutMs?: number;
};

type StripeList = { data?: Array<Record<string, unknown>>; has_more?: boolean };

/**
 * Liste paginée d'une collection Stripe (`starting_after`), cap 10 pages.
 */
async function stripeListAll(
  base: string,
  path: string,
  key: string,
  timeoutMs: number,
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 10; page++) {
    const url = new URL(`${base}${path}`);
    url.searchParams.set("limit", "100");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Stripe ${path} → HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}`,
        );
      }
      const body = (await res.json()) as StripeList;
      const data = Array.isArray(body.data) ? body.data : [];
      out.push(...data);
      if (!body.has_more || !data.length) return out;
      startingAfter = String(data[data.length - 1]?.id || "");
      if (!startingAfter) return out;
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

/**
 * Module `billing` — API de la section Facturation de l'app admin.
 *
 *   GET  /api/v1/modules/billing/overview  → clients + abonnement (montant,
 *        statut, prochaine échéance), factures, événements Stripe, stats
 *        (MRR, abonnements actifs, impayés). Rapprochement client ↔ serveur
 *        via host_id/server_name des customers.
 *   POST /api/v1/modules/billing/reconcile → réconciliation ACTIVE : relit
 *        customers/subscriptions/invoices via l'API Stripe (STRIPE_API_KEY)
 *        et resynchronise les projections admin_billing_* — complète les
 *        webhooks (passifs) au démarrage ou si un webhook a été manqué.
 */
export function createBillingAdminMount(
  opts?: BillingAdminMountOptions,
): ApiMount {
  const timeoutMs = opts?.timeoutMs ?? 20_000;
  return {
    dbLayer: "brand",
    permission: ADMIN_MODULE_PERMISSIONS.billing,
    operations: [
      { id: "overview", method: "GET", path: "/overview", description: "Vue d'ensemble facturation" },
      { id: "reconcile", method: "POST", path: "/reconcile", description: "Réconciliation Stripe active" },
    ],
    handle: async ({ req, subPath, db }) => {
      if (!db) return { status: 503, body: { ok: false, error: "db_unavailable" } };
      const method = req.method.toUpperCase();

      if (subPath === "overview" && method === "GET") {
        const customers = db
          .prepare(
            `SELECT c.id, c.nom, c.email, c.host_id, c.server_name,
                    c.stripe_customer_id, c.updated_at,
                    s.plan, s.montant_mensuel, s.devise AS sub_devise,
                    s.statut AS sub_statut, s.periode_fin
             FROM admin_billing_customers c
             LEFT JOIN admin_billing_subscriptions s
               ON s.id = (SELECT id FROM admin_billing_subscriptions
                          WHERE customer_id = c.id
                          ORDER BY updated_at DESC LIMIT 1)
             ORDER BY c.nom COLLATE NOCASE`,
          )
          .all();
        const invoices = db
          .prepare(
            `SELECT i.id, i.created_at, i.periode, i.montant, i.devise,
                    i.statut, i.stripe_invoice_id, c.nom AS client_nom
             FROM admin_billing_invoices i
             LEFT JOIN admin_billing_customers c ON c.id = i.customer_id
             ORDER BY i.created_at DESC LIMIT 200`,
          )
          .all();
        const events = db
          .prepare(
            `SELECT id, created_at, stripe_event_id, type
             FROM admin_billing_events ORDER BY created_at DESC LIMIT 100`,
          )
          .all();
        const stats = db
          .prepare(
            `SELECT
               (SELECT COALESCE(SUM(montant_mensuel), 0)
                FROM admin_billing_subscriptions
                WHERE statut IN ('active','trialing')) AS mrr,
               (SELECT COUNT(*) FROM admin_billing_subscriptions
                WHERE statut IN ('active','trialing')) AS abonnements_actifs,
               (SELECT COUNT(*) FROM admin_billing_invoices
                WHERE statut IN ('open','payment_failed','uncollectible'))
                 AS factures_impayees`,
          )
          .get();
        return {
          status: 200,
          body: { ok: true, customers, invoices, events, stats },
        };
      }

      if (subPath === "reconcile" && method === "POST") {
        const key =
          opts?.stripeApiKey || (process.env.STRIPE_API_KEY || "").trim();
        if (!key) {
          return {
            status: 503,
            body: {
              ok: false,
              error: "STRIPE_API_KEY non configuré",
              hint:
                "Dashboard Stripe → Développeurs → Clés API → clé secrète " +
                "(sk_…), à poser dans le .env gitignoré de l'app admin " +
                "(voir skill creezio-fleet-ops §5).",
            },
          };
        }
        const base = (
          opts?.apiBase ||
          (process.env.STRIPE_API_BASE || "").trim() ||
          "https://api.stripe.com"
        ).replace(/\/$/, "");
        const ts = nowIso();
        try {
          const [customers, subscriptions, invoices] = await Promise.all([
            stripeListAll(base, "/v1/customers", key, timeoutMs),
            stripeListAll(base, "/v1/subscriptions?status=all", key, timeoutMs),
            stripeListAll(base, "/v1/invoices", key, timeoutMs),
          ]);
          let nCustomers = 0;
          let nSubs = 0;
          let nInvoices = 0;
          for (const c of customers) {
            if (projectStripeCustomer(db, c, ts)) nCustomers++;
          }
          for (const s of subscriptions) {
            if (
              projectStripeSubscription(db, s, ts, {
                forceCanceled: String(s.status || "") === "canceled",
              })
            ) {
              nSubs++;
            }
          }
          for (const i of invoices) {
            if (projectStripeInvoice(db, i, ts)) nInvoices++;
          }
          return {
            status: 200,
            body: {
              ok: true,
              source: base,
              customers: nCustomers,
              subscriptions: nSubs,
              invoices: nInvoices,
              at: ts,
            },
          };
        } catch (e) {
          return {
            status: 502,
            body: {
              ok: false,
              error: `réconciliation Stripe échouée: ${(e as Error)?.message || e}`,
            },
          };
        }
      }

      return { status: 404, body: { ok: false } };
    },
  };
}

/* ------------------------------------------------------------- register */

export type RegisterAdminModulesOptions = {
  fleet?: FleetAdminMountOptions;
  fleetRegistry?: FleetRegistryMountOptions;
  fleetReleases?: FleetReleasesMountOptions;
  billing?: BillingWebhookMountOptions;
  billingAdmin?: BillingAdminMountOptions;
};

/**
 * Enregistre les modules admin natifs sur le kernel de l'app admin.
 * `/api/v1/modules/fleet|fleet-registry|prospects|roadmap|support|billing-*`.
 */
export function registerAdminModules(
  api: ApiKernel,
  opts?: RegisterAdminModulesOptions,
): void {
  api.registerModuleApi("fleet", createFleetAdminMount(opts?.fleet));
  api.registerModuleApi(
    "fleet-registry",
    createFleetRegistryMount({
      fleet: opts?.fleet,
      ...(opts?.fleetRegistry || {}),
    }),
  );
  api.registerModuleApi(
    "fleet-releases",
    createFleetReleasesMount({
      fleet: opts?.fleet,
      ...(opts?.fleetReleases || {}),
    }),
  );
  api.registerModuleApi("prospects", createAdminCrudMount("prospects"));
  api.registerModuleApi("roadmap", createAdminCrudMount("roadmap"));
  api.registerModuleApi(
    "support",
    createSupportAdminMount({ fleet: opts?.fleet }),
  );
  api.registerModuleApi(
    "billing-customers",
    createAdminCrudMount("billing-customers"),
  );
  api.registerModuleApi(
    "billing-subscriptions",
    createAdminCrudMount("billing-subscriptions"),
  );
  api.registerModuleApi(
    "billing-webhook",
    createBillingWebhookMount(opts?.billing),
  );
  api.registerModuleApi("billing", createBillingAdminMount(opts?.billingAdmin));
}
