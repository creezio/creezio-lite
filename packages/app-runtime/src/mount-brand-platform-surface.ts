/**
 * Surface Hono plateforme — auth / tasks / assistant / desktop / users sur le
 * port unique du serveur marque (harness Docker ET desktop).
 *
 * Comble l'écart kit : ces routes vivaient dans le fork Next historique ; ici elles
 * sont servies par le kit lui-même (l'UI Next standalone rewrite /api/v1/*
 * vers ce serveur). SSE streamé (screencast, desktop-actions, runs).
 *
 * Chemins :
 * - /api/v1/auth/*                    login/logout/me/impersonation/ai-workspace-session
 * - /api/v1/tasks/*                   kanban + runs + activity + screencast SSE
 * - /api/v1/assistant/*               chat + ui-actions + desktop-actions SSE
 * - /api/v1/desktop/screencast/frame  frames POSTées par le bridge Electron
 * - /api/v1/desktop/sessions          bridges / users online (cockpit)
 * - /api/v1/cockpit/health            santé agrégée services (cockpit)
 * - /api/v1/platform/users            collaborateurs plateforme (owner)
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import {
  createAuthRoutes,
  createSessionToken,
  getAuthConfig,
  migrateBrandCredentialsToKit,
  sessionActorIsOwner,
  sessionIsImpersonating,
  verifySessionToken,
  type AuthRouteUser,
  type SessionPayload,
} from "@creezio/auth";
import {
  createAccessControlRoutes,
  createSqliteAccessStore,
  getAccessControlStore,
  isAccessControlConfigured,
  registerAccessControlStore,
  resolvePermissions,
} from "@creezio/access-control";
import {
  applyBrandModuleAuth,
  sessionCookieNameForBrand,
} from "./apply-brand-module-auth.js";
import type { BrandPermissionGroup } from "./module-contract.js";
import {
  configureAssistantBrand,
  createAssistantRoutes,
  dispatchSupplierAction,
  getAssistantBrandConfig,
  mergeAssistantBrandConfig,
  type AssistantDbAccess,
} from "@creezio/assistant";
import {
  configureTasksBrand,
  createAssistantTasksAdapter,
  createTasksHonoRoutes,
  getTasksBrandConfig,
  stopAiRunnerLoop,
  type TasksBrandConfig,
  type TasksSession,
  type TasksWorkspaceAdapter,
} from "@creezio/tasks";
import {
  publishScreencastFrame,
  screencastViewerCount,
  subscribeScreencast,
} from "@creezio/browser-host";
import {
  createIntegrationsRoutes,
  createN8nIntegrationsSync,
  createSqliteIntegrationsStore,
  type N8nBridge,
} from "@creezio/integrations";
import { getOpsDir } from "@creezio/observability";
import {
  openBrandPlatformStore,
  type BrandPlatformStore,
} from "./brand-platform-store.js";
import { buildCockpitHealth } from "./cockpit-health.js";
import type { BrandBrowserSidecarHandle } from "./wire-brand-browser-sidecar.js";

export type BrandPlatformRuntime = {
  store: BrandPlatformStore;
  sessionCookieName: string;
  baseUrl: () => string;
  getSidecar: () => BrandBrowserSidecarHandle | null;
  presence: DesktopPresenceRegistry;
};

export type DesktopPresenceRegistry = {
  registerDesktopBridge: (opts: {
    userId: string;
    deviceId?: string;
    deviceLabel?: string | null;
    subscriptionId: string;
  }) => void;
  unregisterDesktopBridge: (
    userId: string,
    deviceId: string,
    subscriptionId?: string,
  ) => void;
  touchDesktopBridge: (userId: string, deviceId: string) => void;
  isDesktopOnline: (userId: string) => boolean;
  listOnlineBridges: () => Array<{
    userId: string;
    deviceId: string;
    deviceLabel?: string | null;
    bridgeConnected: boolean;
    online: boolean;
  }>;
};

const BRIDGE_STALE_MS = 90_000;

function createPresenceRegistry(
  getSidecar: () => BrandBrowserSidecarHandle | null,
): DesktopPresenceRegistry {
  type Bridge = {
    userId: string;
    deviceId: string;
    deviceLabel: string | null;
    subscriptionId: string;
    lastSeen: number;
  };
  const bridges = new Map<string, Bridge>();

  const alive = (b: Bridge) => Date.now() - b.lastSeen < BRIDGE_STALE_MS;

  return {
    registerDesktopBridge: (opts) => {
      bridges.set(opts.subscriptionId, {
        userId: opts.userId,
        deviceId: opts.deviceId || "host",
        deviceLabel: opts.deviceLabel ?? null,
        subscriptionId: opts.subscriptionId,
        lastSeen: Date.now(),
      });
    },
    unregisterDesktopBridge: (_userId, _deviceId, subscriptionId) => {
      if (subscriptionId) bridges.delete(subscriptionId);
    },
    touchDesktopBridge: (userId, deviceId) => {
      for (const b of bridges.values()) {
        if (b.userId === userId && b.deviceId === deviceId) {
          b.lastSeen = Date.now();
        }
      }
    },
    isDesktopOnline: (userId) => {
      for (const b of bridges.values()) {
        if (b.userId === userId && alive(b)) return true;
      }
      const sidecar = getSidecar();
      return Boolean(sidecar && userId === sidecar.serverHostUserId);
    },
    listOnlineBridges: () => {
      const out: Array<{
        userId: string;
        deviceId: string;
        deviceLabel?: string | null;
        bridgeConnected: boolean;
        online: boolean;
      }> = [];
      for (const b of bridges.values()) {
        if (!alive(b)) continue;
        out.push({
          userId: b.userId,
          deviceId: b.deviceId,
          deviceLabel: b.deviceLabel,
          bridgeConnected: true,
          online: true,
        });
      }
      const sidecar = getSidecar();
      if (sidecar) {
        // IA serveur = online sans desktop : host synthétique sidecar.
        out.push({
          userId: sidecar.serverHostUserId,
          deviceId: "server-browser",
          deviceLabel: "Navigateur IA serveur",
          bridgeConnected: true,
          online: true,
        });
      }
      return out;
    },
  };
}

/** Singleton globalThis — adapters marque lus paresseusement (beforeBoot). */
const RUNTIME_KEY = "__creezioBrandPlatformRuntime";

function runtimeSlot(): { current: BrandPlatformRuntime | null } {
  const g = globalThis as unknown as {
    [RUNTIME_KEY]?: { current: BrandPlatformRuntime | null };
  };
  if (!g[RUNTIME_KEY]) g[RUNTIME_KEY] = { current: null };
  return g[RUNTIME_KEY]!;
}

export function getBrandPlatformRuntime(): BrandPlatformRuntime | null {
  return runtimeSlot().current;
}

/* ── Session helpers (cookie ou Bearer) ── */

async function sessionFromContext(
  c: Context,
): Promise<SessionPayload | null> {
  let token = "";
  try {
    token = getCookie(c, getAuthConfig().cookieName) || "";
  } catch {
    token = "";
  }
  if (!token) {
    const authz = c.req.header("authorization") || "";
    if (authz.toLowerCase().startsWith("bearer ")) token = authz.slice(7).trim();
  }
  if (!token) return null;
  return verifySessionToken(token);
}

/* ── Adapters tasks plateforme (configureTasksBrand côté marque) ── */

/**
 * Adapters plateforme LAZY (globalThis) : `mountBrandPlatformSurface` les
 * branche via `configureTasksBrand` (autoconfig kit) ; une marque peut
 * toujours surcharger au beforeBoot. Sans surface montée → erreurs propres.
 */
export function createPlatformTasksBrandAdapters(): Pick<
  TasksBrandConfig,
  "db" | "users" | "presence" | "workspace" | "screencast" | "auth"
> {
  const rt = () => getBrandPlatformRuntime();

  const workspace: TasksWorkspaceAdapter = {
    ensureOnHost: async ({ aiUserId, hostUserId, show, label }) => {
      const runtime = rt();
      const sidecar = runtime?.getSidecar();
      if (sidecar) {
        const info = await sidecar.host.ensure({ aiUserId, ...(label ? { label } : {}) });
        sidecar.syncAiExecutors();
        return { ok: true, workspace: info };
      }
      if (!runtime) return { ok: false, error: "platform_surface_unmounted" };
      // Fallback desktop Electron (parité kit) : dispatch bridge ciblé host.
      const user = runtime.store.getUserById(aiUserId);
      if (!user) return { ok: false, error: `Collaborateur IA introuvable: ${aiUserId}` };
      const owner = runtime.store.getOwner();
      const token = await createSessionToken({
        user: {
          id: user.id,
          username: user.username,
          role: "collaborator",
          permissions: user.permissions,
        },
        actor: owner
          ? { id: owner.id, username: owner.username, role: "owner", permissions: [...owner.permissions] }
          : null,
      });
      return dispatchSupplierAction(
        "ai_workspace_ensure",
        {
          ai_user_id: aiUserId,
          token,
          base_url: runtime.baseUrl(),
          label: label || user.username,
          ...(show ? { show: true } : {}),
        },
        undefined,
        { targetUserId: hostUserId, requireTargetOnline: true },
      );
    },
    navigate: async ({ aiUserId, hostUserId, href }) => {
      const sidecar = rt()?.getSidecar();
      if (sidecar) return sidecar.host.navigate({ aiUserId, href });
      return dispatchSupplierAction(
        "ai_workspace_navigate",
        { ai_user_id: aiUserId, href },
        undefined,
        { targetUserId: hostUserId, requireTargetOnline: true },
      );
    },
    openTab: async ({ aiUserId, hostUserId, params }) => {
      const sidecar = rt()?.getSidecar();
      if (sidecar) return sidecar.host.openTab({ aiUserId, params });
      return dispatchSupplierAction(
        "ai_workspace_open_tab",
        { ai_user_id: aiUserId, ...params },
        undefined,
        { targetUserId: hostUserId, requireTargetOnline: true },
      );
    },
    listTabs: async ({ aiUserId, hostUserId }) => {
      const sidecar = rt()?.getSidecar();
      if (sidecar) return { ok: true, tabs: sidecar.host.listTabs(aiUserId) };
      return dispatchSupplierAction(
        "ai_workspace_list_tabs",
        { ai_user_id: aiUserId },
        undefined,
        { targetUserId: hostUserId, requireTargetOnline: true },
      );
    },
    webAction: async ({ aiUserId, hostUserId, webType, params, tabId }) => {
      const sidecar = rt()?.getSidecar();
      if (sidecar) {
        return sidecar.host.webAction({
          aiUserId,
          webType,
          ...(params ? { params } : {}),
          ...(tabId ? { tabId } : {}),
        });
      }
      return dispatchSupplierAction(
        "ai_workspace_web_action",
        {
          ai_user_id: aiUserId,
          web_type: webType,
          web_params: params || {},
          ...(tabId ? { tab_id: tabId } : {}),
        },
        undefined,
        { targetUserId: hostUserId, requireTargetOnline: true },
      );
    },
    startScreencast: async (aiUserId) => {
      const runtime = rt();
      const sidecar = runtime?.getSidecar();
      if (sidecar) return sidecar.host.startScreencast(aiUserId);
      const host = runtime?.presence.listOnlineBridges()[0]?.userId;
      if (!host) return { ok: false, error: "Aucun hôte desktop/serveur en ligne" };
      return dispatchSupplierAction(
        "ai_workspace_screencast_start",
        { ai_user_id: aiUserId },
        undefined,
        { targetUserId: host, requireTargetOnline: true },
      );
    },
    stopScreencast: async (aiUserId) => {
      const runtime = rt();
      const sidecar = runtime?.getSidecar();
      if (sidecar) return sidecar.host.stopScreencast(aiUserId);
      const host = runtime?.presence.listOnlineBridges()[0]?.userId;
      if (!host) return { ok: true, already: true };
      return dispatchSupplierAction(
        "ai_workspace_screencast_stop",
        { ai_user_id: aiUserId },
        undefined,
        { targetUserId: host },
      );
    },
  };

  return {
    db: {
      getWriteDb: () => {
        const runtime = rt();
        if (!runtime) throw new Error("platform_surface_unmounted");
        return runtime.store.dbAdapter.getWriteDb();
      },
      queryAll: (sql, params) =>
        rt()?.store.dbAdapter.queryAll(sql, params) ?? [],
      queryOne: (sql, params) =>
        rt()?.store.dbAdapter.queryOne(sql, params) ?? null,
      tableExists: (name) =>
        rt()?.store.dbAdapter.tableExists(name) ?? false,
    },
    users: {
      getById: (id) => rt()?.store.getUserById(id) ?? null,
      list: () => rt()?.store.listUsers() ?? [],
      getOwner: () => rt()?.store.getOwner() ?? null,
      ready: () => Boolean(rt()),
    },
    presence: {
      isDesktopOnline: (userId) =>
        rt()?.presence.isDesktopOnline(userId) ?? false,
      listOnlineBridges: () => rt()?.presence.listOnlineBridges() ?? [],
    },
    workspace,
    screencast: {
      viewerCount: (aiUserId) => screencastViewerCount(aiUserId),
      subscribe: (aiUserId, listener) => subscribeScreencast(aiUserId, listener),
    },
    auth: {
      getSessionFromContext: async (c) =>
        (await sessionFromContext(c)) as TasksSession | null,
      sessionActorIsOwner: (session) =>
        sessionActorIsOwner(session as SessionPayload | null),
      sessionIsImpersonating: (session) =>
        sessionIsImpersonating(session as SessionPayload | null),
    },
  };
}

/* ── Surface Hono ── */

export type BrandPlatformSurface = {
  app: Hono;
  runtime: BrandPlatformRuntime;
  attachSidecar: (sidecar: BrandBrowserSidecarHandle | null) => void;
  close: () => void;
};

const PLATFORM_PREFIXES = [
  "/api/v1/auth",
  // Module natif access-control (rôles & accès) — monté si la marque
  // appelle configureAccessControl au beforeBoot.
  "/api/v1/access",
  "/api/v1/tasks",
  "/api/v1/assistant",
  "/api/v1/desktop",
  "/api/v1/cockpit",
  // Référentiel utilisateurs unique : /api/v1/users est une route PLATEFORME
  // (les pages marque type Collaborateurs y parlent directement) — jamais une
  // table users métier parallèle dans le plane, sinon comptes non logables.
  "/api/v1/users",
  "/api/v1/platform/users",
  "/api/v1/platform/workspace",
  "/api/v1/platform/presence",
  "/api/v1/platform/desktop",
  // Intégrations / clés API tierces (ADR-integrations-store).
  "/api/v1/platform/integrations",
  // Clés IA BYOK owner (Configuration web headless).
  "/api/v1/platform/llm-keys",
  // Tunnel / recherche / journal ops owner (Configuration web headless).
  "/api/v1/platform/tunnel",
  "/api/v1/platform/search",
  "/api/v1/platform/ops",
];

/** Chemins proxifiés Node http → surface plateforme (streaming SSE). */
export function platformSurfaceHandlesPath(pathname: string): boolean {
  return PLATFORM_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function mountBrandPlatformSurface(opts: {
  brandId: string;
  coreDbPath: string;
  baseUrl: () => string;
  /** Défaut : `${brandId}_session` (aligné cookie desktop marque). */
  sessionCookieName?: string;
  ownerPermissions?: readonly string[];
  /**
   * Groupes `/admin/access` issus de `collectPermissionGroups()` — fusionnés
   * seulement si `configureAccessControl` a déjà été appelé au beforeBoot.
   */
  permissionGroups?: readonly BrandPermissionGroup[];
  /**
   * DB métier (SqliteHandle kernel) pour les tools SQL assistant par défaut
   * (run_sql / explore, lecture seule côté runtime assistant).
   */
  brandDb?: () => {
    path: string;
    prepare: (sql: string) => {
      all: (...params: unknown[]) => unknown[];
      get: (...params: unknown[]) => unknown;
      run: (...params: unknown[]) => unknown;
    };
  } | null;
  /**
   * Bridge API n8n embarqué (lazy — la clé apparaît après le warm n8n).
   * Alimente la sync des intégrations vers les credentials n8n.
   */
  n8nBridge?: () => N8nBridge | null;
  /**
   * Pont clés IA BYOK (owner) — lecture/écriture du store local-config de
   * l'hôte. Injecté par le harness headless : la page Configuration web
   * (Compte & clés) passe par GET/PUT /api/v1/platform/llm-keys au lieu de
   * l'IPC Electron.
   */
  llmKeys?: {
    get: () => { openai: boolean; anthropic: boolean };
    set: (provider: "openai" | "anthropic", key: string | null) => void;
  };
  /**
   * Pont tunnel headless (owner) — miroir HTTP des IPC tunnel:* desktop.
   * Lazy : le service tunnel vit dans l'OS composé par le harness.
   */
  tunnelBridge?: () => {
    getTunnelStatus: () => unknown;
    checkTunnelSlug: (
      slug: string,
    ) => Promise<{ available: boolean; reason?: string; hostname?: string }>;
    reserveTunnel: (
      slug: string,
      localPort: number,
    ) => Promise<
      { ok: true; hostname: string; publicUrl: string } | { ok: false; error: string }
    >;
    configureTunnelIngress?: (ports: { crmPort: number }) => Promise<void>;
    startCloudflared: () => Promise<void>;
    stopCloudflared: () => void;
  } | null;
  /** Port HTTP local du serveur (reserve tunnel). */
  localPort?: () => number;
  /**
   * Pont recherche headless (owner) — santé Meili + réindexation manuelle,
   * miroir HTTP de l'IPC search:reindex desktop.
   */
  searchBridge?: () => {
    health: () => Promise<unknown>;
    reindex: () => Promise<unknown>;
  } | null;
  onLog?: (line: string) => void;
}): BrandPlatformSurface {
  const log =
    opts.onLog || ((line: string) => console.log(`[platform-surface] ${line}`));
  const cookieName =
    opts.sessionCookieName || sessionCookieNameForBrand(opts.brandId);

  // beforeBoot (bindings) a pu déjà poser cookie + ownerPermissions.
  // On complète sans écraser : cookie existant conservé, permissions
  // seulement si fournies ici, groupes seulement si access-control déjà on.
  applyBrandModuleAuth({
    cookieName,
    ...(opts.ownerPermissions
      ? { ownerPermissions: opts.ownerPermissions }
      : {}),
    ...(opts.permissionGroups
      ? { permissionGroups: opts.permissionGroups }
      : {}),
  });
  const effectiveCookieName = getAuthConfig().cookieName || cookieName;

  const store = openBrandPlatformStore({
    coreDbPath: opts.coreDbPath,
    ...(opts.ownerPermissions
      ? { ownerPermissions: opts.ownerPermissions }
      : {}),
  });

  // Module natif access-control : la marque a appelé configureAccessControl
  // au beforeBoot → tables posées sur le MÊME core.db + slot runtime pour
  // resolvePermissions (sidebar, /me, garde API kernel).
  const accessControlEnabled = isAccessControlConfigured();
  if (accessControlEnabled && !getAccessControlStore()) {
    registerAccessControlStore(createSqliteAccessStore({ db: store.db }));
    log("access-control: store enregistré (core.db)");
  }

  let sidecar: BrandBrowserSidecarHandle | null = null;
  const getSidecar = () => sidecar;
  const presence = createPresenceRegistry(getSidecar);

  const runtime: BrandPlatformRuntime = {
    store,
    sessionCookieName: effectiveCookieName,
    baseUrl: opts.baseUrl,
    getSidecar,
    presence,
  };
  runtimeSlot().current = runtime;

  // Assistant : la marque peut avoir posé AppMap/prompts/meili/hermes au
  // beforeBoot. On complète toujours db + presence + tasks (merge) — sans
  // écraser le métier. Sans aucune config, pose le défaut kit.
  // Session = cookie/Bearer par requête (routes) — pas d'auth.getSession ici.
  {
    const brandDb = opts.brandDb;
    let db: AssistantDbAccess | undefined;
    if (brandDb) {
      const handle = () => {
        const h = brandDb();
        if (!h) throw new Error("brand_db_unavailable");
        return h;
      };
      db = {
        queryAll: <T = Record<string, unknown>>(
          sql: string,
          params: unknown[] = [],
        ) => handle().prepare(sql).all(...params) as T[],
        queryOne: <T = Record<string, unknown>>(
          sql: string,
          params: unknown[] = [],
        ) => handle().prepare(sql).get(...params) as T | undefined,
        getDbPath: () => handle().path,
        getDb: () => handle(),
      };
    }
    const platformBits = {
      ...(db ? { db } : {}),
      desktopPresence: {
        isDesktopOnline: (userId: string) => presence.isDesktopOnline(userId),
        desktopOfflineError: (userId: string) => ({
          error: "Poste desktop hors ligne — action impossible",
          userId,
        }),
      },
      // create_task / list_tasks → kanban kit (nécessite configureTasksBrand).
      tasks: createAssistantTasksAdapter(),
    };
    if (!getAssistantBrandConfig()) {
      configureAssistantBrand({
        identity: {
          productName: opts.brandId,
          uiStorageKey: `${opts.brandId}-assistant-ui`,
          modeStorageKey: `${opts.brandId}-assistant-preferred-mode`,
          desktopApiGlobal: "creezioDesktop",
          globalStorePrefix: "__creezio",
        },
        ...platformBits,
      });
      log("assistant: config kit par défaut (marque sans configureAssistantBrand)");
    } else {
      mergeAssistantBrandConfig(platformBits);
      log("assistant: merge db/presence/tasks sur config marque");
    }
  }

  // Tasks : même contrat que l'assistant — sans configureTasksBrand au
  // beforeBoot, GET /api/v1/tasks crashe (requireTasksBrand → 500). Les
  // adapters plateforme lazy (createPlatformTasksBrandAdapters) branchent
  // db/users/presence/workspace sur le runtime qui vient d'être posé.
  if (!getTasksBrandConfig()) {
    const brandKey = opts.brandId.replace(/[^a-z0-9]/gi, "") || "creezio";
    const envPrefix = `${brandKey.toUpperCase()}_AI`;
    configureTasksBrand({
      productName: opts.brandId,
      productDomain: opts.brandId,
      hermesSourceLabel: opts.brandId,
      hermesSkill: brandKey,
      envPrefix,
      idempotencyPrefix: brandKey.slice(0, 12) || "tasks",
      assistantIdempotencyPrefix: `${brandKey.slice(0, 8) || "asst"}-asst`,
      taskHref: "/taches",
      examplePaths: ["/taches"],
      navigation: {
        permissionForPath: () => null,
        hasPermission: () => true,
      },
      externalTabs: {
        resolve: (input) => ({
          ok: true,
          url: String(input.url || ""),
          title: String(input.title || input.url || ""),
          ...(typeof input.site_id === "number" ? { siteId: input.site_id } : {}),
          ...(typeof input.fournisseur_id === "number"
            ? { fournisseurId: input.fournisseur_id }
            : {}),
        }),
        toWorkspaceParams: (r) => ({
          url: r.url,
          title: r.title,
          ...(r.siteId != null ? { site_id: r.siteId } : {}),
          ...(r.fournisseurId != null ? { fournisseur_id: r.fournisseurId } : {}),
        }),
      },
      ...createPlatformTasksBrandAdapters(),
    });
    log("tasks: config kit par défaut (marque sans configureTasksBrand)");
  }

  const app = new Hono();

  /**
   * Contrat de composition : une sous-route inconnue d'un préfixe plateforme
   * (ex. POST /api/v1/desktop/heartbeat métier TF) NE doit PAS mourir en
   * « 404 Not Found » texte Hono — le harness (listen-brand-os-http) rejoue
   * la requête vers le plane UI marque quand il voit ce marqueur précis.
   * Les 404 métier de la surface (ex. user_not_found) ne fallthrough pas.
   */
  app.notFound((c) =>
    c.json(
      { ok: false, error: "platform_route_not_found", path: c.req.path },
      404,
    ),
  );

  /* Auth (login/logout/me/impersonate/ai-workspace-session). */
  const toRouteUser = (u: {
    id: string;
    username: string;
    role: "owner" | "collaborator";
    kind: "human" | "ai";
    active: boolean;
    permissions: string[];
  }): AuthRouteUser => ({
    id: u.id,
    username: u.username,
    role: u.role,
    permissions: u.permissions,
    active: u.active,
    kind: u.kind,
  });

  app.route(
    "/api/v1/auth",
    createAuthRoutes({
      // Kit-first (authenticateViaKit) porte le login owner ; pas de table
      // credentials marque ici → projection par username.
      authenticateUser: () => null,
      ensureOwnerSynced: () => {
        const owner = store.getOwner();
        return owner ? toRouteUser(owner) : null;
      },
      getUserById: (id) => {
        const u = store.getUserById(id);
        return u ? toRouteUser(u) : null;
      },
      getUserByUsername: (username) => {
        const lc = username.trim().toLowerCase();
        const u = store
          .listUsers()
          .find((x) => x.username.toLowerCase() === lc);
        return u ? { id: u.id, active: u.active ? 1 : 0 } : null;
      },
      listUsers: () => store.listUsers().map(toRouteUser),
      ownerPermissions: getAuthConfig().ownerPermissions,
      resolveCookieSecure: (c) =>
        (c.req.header("x-forwarded-proto") || "").toLowerCase() === "https",
      getSessionFromContext: sessionFromContext,
      // Rôle métier marque (configureAuth.resolveBrandRole) résolu contre la
      // db brand de la surface — best effort, jamais de throw (la route /me
      // retombe sur brand_role null).
      resolveBrandRole: async (userId) => {
        try {
          return (
            (await getAuthConfig().resolveBrandRole?.(
              userId,
              opts.brandDb?.() ?? null,
            )) ?? null
          );
        } catch {
          return null;
        }
      },
      // Permissions dynamiques (access-control) : /me + JWT mintés frais.
      // Owner = ownerPermissions (court-circuit — jamais bridé par la matrice).
      ...(accessControlEnabled
        ? {
            resolveEffectivePermissions: async (
              userId: string,
              kitRole: "owner" | "collaborator",
            ) => {
              if (kitRole === "owner") return getAuthConfig().ownerPermissions;
              let brandRole: string | null = null;
              try {
                brandRole =
                  (await getAuthConfig().resolveBrandRole?.(
                    userId,
                    opts.brandDb?.() ?? null,
                  )) ?? null;
              } catch {
                brandRole = null;
              }
              return resolvePermissions(userId, brandRole);
            },
          }
        : {}),
    }),
  );

  /* Access-control (matrice rôles × permissions, comptes, audit). */
  if (accessControlEnabled) {
    app.route(
      "/api/v1/access",
      createAccessControlRoutes({
        getSession: (c) => sessionFromContext(c),
        listUsers: () =>
          store.listUsers().map((u) => ({
            id: u.id,
            username: u.username,
            role: u.role,
            kind: u.kind,
            active: u.active,
          })),
        getUserById: (id) => {
          const u = store.getUserById(id);
          return u
            ? {
                id: u.id,
                username: u.username,
                role: u.role,
                kind: u.kind,
                active: u.active,
              }
            : null;
        },
        ownerPermissions: () => getAuthConfig().ownerPermissions,
        userAdminPermission: () => getAuthConfig().userAdminPermission,
      }),
    );
    log("access-control: routes /api/v1/access montées");
  }

  /* Assistant (chat, ui-actions résultats, flux desktop-actions SSE). */
  app.route(
    "/api/v1/assistant",
    createAssistantRoutes({
      getSession: (c) => sessionFromContext(c),
      desktopPresence: presence,
      desktopStreamAuth: "session",
      resolveDeviceMeta: (c) => ({
        deviceId:
          c.req.query("device_id") || c.req.header("x-device-id") || "desktop",
        deviceLabel:
          c.req.query("device_label") ||
          c.req.header("x-device-label") ||
          null,
      }),
    }),
  );

  /* Tasks (kanban + runs + activity + screencast SSE). */
  app.route("/api/v1/tasks", createTasksHonoRoutes());

  /* Heartbeat desktop — pollé toutes les 60 s par le SessionProvider kit
   * dès qu'une session est ouverte. No-op natif : sans bridge Electron en
   * ligne, 200 { ok, desktop: false } au lieu du 404
   * platform_route_not_found (qui repartait en fallthrough vers le plane UI
   * — bruit logs + faux états sur les apps web sans desktop). Bridge
   * connecté : desktop: true reflète le registre de présence réel. */
  app.post("/api/v1/desktop/heartbeat", async (c) => {
    const session = await sessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    return c.json({
      ok: true,
      desktop: presence.isDesktopOnline(session.sub),
    });
  });

  /* Frames screencast POSTées par le bridge Electron (session requise). */
  app.post("/api/v1/desktop/screencast/frame", async (c) => {
    const session = await sessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as {
      ai_user_id?: string;
      data?: string;
    };
    const aiUserId = String(body.ai_user_id || "").trim();
    const data = typeof body.data === "string" ? body.data : "";
    if (!aiUserId || !data) {
      return c.json({ error: "ai_user_id et data requis" }, 400);
    }
    const { viewers, seq } = publishScreencastFrame(aiUserId, data);
    return c.json({ ok: true, viewers, seq });
  });

  /* Sessions desktop (cockpit) — bridges SSE + users online. */
  app.get("/api/v1/desktop/sessions", async (c) => {
    const session = await sessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    const bridges = presence.listOnlineBridges();
    const onlineIds = new Set(bridges.map((b) => b.userId));
    return c.json({
      bridges,
      users: store
        .listUsers()
        .filter((u) => u.active)
        .map((u) => ({ userId: u.id, online: onlineIds.has(u.id) })),
    });
  });

  /* Cockpit santé (owner) — Meili / Hermes / n8n / tunnel via envs warm. */
  app.get("/api/v1/cockpit/health", async (c) => {
    const session = await sessionFromContext(c);
    if (
      !session ||
      !sessionActorIsOwner(session) ||
      sessionIsImpersonating(session)
    ) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    let dbPath: string | null = null;
    try {
      dbPath = opts.brandDb?.()?.path ?? null;
    } catch {
      dbPath = null;
    }
    const health = await buildCockpitHealth({ dbPath });
    const aiCollaborators = store
      .listUsers()
      .filter((u) => u.kind === "ai" && u.active).length;
    return c.json({ ...health, ai_collaborators: aiCollaborators });
  });

  /* Clés IA BYOK (owner, headless) — miroir HTTP de l'IPC setLlmKey desktop.
   * `active` = env process courant (l'assistant tourne dans CE process). */
  if (opts.llmKeys) {
    const llmKeysBridge = opts.llmKeys;
    const llmKeysPayload = () => {
      const stored = llmKeysBridge.get();
      const openaiActive = Boolean((process.env.OPENAI_API_KEY || "").trim());
      const anthropicActive = Boolean(
        (process.env.ANTHROPIC_API_KEY || "").trim(),
      );
      return {
        ok: true,
        openai: { stored: stored.openai, active: openaiActive },
        anthropic: { stored: stored.anthropic, active: anthropicActive },
        assistantReady: openaiActive,
      };
    };
    app.get("/api/v1/platform/llm-keys", async (c) => {
      const session = await sessionFromContext(c);
      if (
        !session ||
        !sessionActorIsOwner(session) ||
        sessionIsImpersonating(session)
      ) {
        return c.json({ error: "Réservé au compte principal" }, 403);
      }
      return c.json(llmKeysPayload());
    });
    app.put("/api/v1/platform/llm-keys", async (c) => {
      const session = await sessionFromContext(c);
      if (
        !session ||
        !sessionActorIsOwner(session) ||
        sessionIsImpersonating(session)
      ) {
        return c.json({ error: "Réservé au compte principal" }, 403);
      }
      const body = (await c.req.json().catch(() => ({}))) as {
        provider?: string;
        key?: string | null;
      };
      const provider = body.provider;
      if (provider !== "openai" && provider !== "anthropic") {
        return c.json({ error: "provider openai|anthropic requis" }, 400);
      }
      const key = typeof body.key === "string" ? body.key.trim() : null;
      try {
        llmKeysBridge.set(provider, key || null);
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : String(err) },
          500,
        );
      }
      log(`llm-keys: clé ${provider} ${key ? "enregistrée" : "supprimée"} (owner)`);
      return c.json(llmKeysPayload());
    });
  }

  /** Garde owner partagée par les routes Configuration headless ci-dessous. */
  const requireOwner = async (c: Context): Promise<boolean> => {
    const session = await sessionFromContext(c);
    return Boolean(
      session &&
        sessionActorIsOwner(session) &&
        !sessionIsImpersonating(session),
    );
  };

  /* Tunnel headless (owner) — miroir HTTP des IPC tunnel:* desktop. Sans
   * bridge (OS non composé), 503 explicite. */
  if (opts.tunnelBridge) {
    const bridge = opts.tunnelBridge;
    const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])$/;
    app.post("/api/v1/platform/tunnel/start", async (c) => {
      if (!(await requireOwner(c))) {
        return c.json({ error: "Réservé au compte principal" }, 403);
      }
      const tunnel = bridge();
      if (!tunnel) return c.json({ error: "tunnel_unavailable" }, 503);
      try {
        if (tunnel.configureTunnelIngress && opts.localPort) {
          await tunnel.configureTunnelIngress({ crmPort: opts.localPort() });
        }
        await tunnel.startCloudflared();
        return c.json({ ok: true, status: tunnel.getTunnelStatus() });
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : String(err) },
          500,
        );
      }
    });
    app.post("/api/v1/platform/tunnel/stop", async (c) => {
      if (!(await requireOwner(c))) {
        return c.json({ error: "Réservé au compte principal" }, 403);
      }
      const tunnel = bridge();
      if (!tunnel) return c.json({ error: "tunnel_unavailable" }, 503);
      tunnel.stopCloudflared();
      log("tunnel: arrêté via Configuration web (owner)");
      return c.json({ ok: true, status: tunnel.getTunnelStatus() });
    });
    app.post("/api/v1/platform/tunnel/check-slug", async (c) => {
      if (!(await requireOwner(c))) {
        return c.json({ error: "Réservé au compte principal" }, 403);
      }
      const tunnel = bridge();
      if (!tunnel) return c.json({ error: "tunnel_unavailable" }, 503);
      const body = (await c.req.json().catch(() => ({}))) as {
        slug?: string;
      };
      const slug = String(body.slug || "").trim().toLowerCase();
      if (!SLUG_RE.test(slug)) {
        return c.json(
          { available: false, reason: "Slug invalide (a-z, 0-9, tirets, 2–48 car.)" },
          200,
        );
      }
      try {
        return c.json(await tunnel.checkTunnelSlug(slug));
      } catch (err) {
        return c.json(
          {
            available: false,
            reason: err instanceof Error ? err.message : String(err),
          },
          200,
        );
      }
    });
    app.post("/api/v1/platform/tunnel/reserve", async (c) => {
      if (!(await requireOwner(c))) {
        return c.json({ error: "Réservé au compte principal" }, 403);
      }
      const tunnel = bridge();
      if (!tunnel) return c.json({ error: "tunnel_unavailable" }, 503);
      const body = (await c.req.json().catch(() => ({}))) as {
        slug?: string;
      };
      const slug = String(body.slug || "").trim().toLowerCase();
      if (!SLUG_RE.test(slug)) {
        return c.json({ error: "slug_invalide" }, 400);
      }
      try {
        const r = await tunnel.reserveTunnel(slug, opts.localPort?.() ?? 0);
        if (!r.ok) return c.json({ error: r.error }, 400);
        if (tunnel.configureTunnelIngress && opts.localPort) {
          await tunnel.configureTunnelIngress({ crmPort: opts.localPort() });
        }
        await tunnel.startCloudflared();
        log(`tunnel: slug ${slug} réservé via Configuration web (owner)`);
        return c.json({
          ok: true,
          hostname: r.hostname,
          publicUrl: r.publicUrl,
          status: tunnel.getTunnelStatus(),
        });
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : String(err) },
          500,
        );
      }
    });
  }

  /* Recherche Meili headless (owner) — miroir HTTP de l'IPC search:reindex. */
  if (opts.searchBridge) {
    const bridge = opts.searchBridge;
    app.get("/api/v1/platform/search/health", async (c) => {
      if (!(await requireOwner(c))) {
        return c.json({ error: "Réservé au compte principal" }, 403);
      }
      const search = bridge();
      if (!search) return c.json({ error: "search_unavailable" }, 503);
      try {
        return c.json(await search.health());
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : String(err) },
          500,
        );
      }
    });
    app.post("/api/v1/platform/search/reindex", async (c) => {
      if (!(await requireOwner(c))) {
        return c.json({ error: "Réservé au compte principal" }, 403);
      }
      const search = bridge();
      if (!search) return c.json({ error: "search_unavailable" }, 503);
      try {
        log("search: réindexation demandée via Configuration web (owner)");
        return c.json(await search.reindex());
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : String(err) },
          500,
        );
      }
    });
  }

  /* Journal ops headless (owner) — boîte noire {dataDir}/ops écrite par le
   * harness (initOpsJournal). Miroir de la route marque /api/v1/ops/events,
   * en canonique kit pour toutes les apps serveur. */
  app.get("/api/v1/platform/ops/events", async (c) => {
    if (!(await requireOwner(c))) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    const dir = getOpsDir();
    if (!dir || !fs.existsSync(dir)) {
      return c.json({ available: false, events: [], boots: [] });
    }
    const limit = Math.min(
      500,
      Math.max(1, Number(c.req.query("limit") || 120) || 120),
    );
    const level = (c.req.query("level") || "").trim();
    const bootId = (c.req.query("bootId") || "").replace(/[^a-z0-9-]/gi, "");
    const files = (() => {
      try {
        if (bootId) {
          const f = path.join(dir, `${bootId}.jsonl`);
          return fs.existsSync(f) ? [f] : [];
        }
        return fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => {
            const full = path.join(dir, f);
            let mtime = 0;
            try {
              mtime = fs.statSync(full).mtimeMs;
            } catch {
              /* volatil */
            }
            return { full, mtime };
          })
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, 3)
          .map((f) => f.full);
      } catch {
        return [] as string[];
      }
    })();
    const events: Record<string, unknown>[] = [];
    for (const file of files) {
      try {
        for (const line of fs.readFileSync(file, "utf8").trim().split("\n")) {
          try {
            const evt = JSON.parse(line) as Record<string, unknown>;
            if (level && evt.level !== level) continue;
            events.push(evt);
          } catch {
            /* ligne corrompue */
          }
        }
      } catch {
        /* fichier absent */
      }
    }
    events.sort(
      (a, b) =>
        String(b.ts || "").localeCompare(String(a.ts || "")) ||
        Number(b.seq || 0) - Number(a.seq || 0),
    );
    let boots: Record<string, unknown>[] = [];
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(dir, "index.json"), "utf8"),
      ) as { boots?: Record<string, unknown>[] };
      boots = Array.isArray(raw.boots) ? raw.boots : [];
      boots = boots
        .sort((a, b) =>
          String(b.startedAt || "").localeCompare(String(a.startedAt || "")),
        )
        .slice(0, 15);
    } catch {
      /* pas d'index */
    }
    return c.json({
      available: true,
      events: events.slice(0, limit),
      boots,
    });
  });

  /* ACL plugins cockpit — liste vide tant que Product Hub n'est pas branché
   * ici (évite le fallthrough UI qui timeoute sur /cockpit/plugin-acl). */
  app.get("/api/v1/cockpit/plugin-acl", async (c) => {
    const session = await sessionFromContext(c);
    if (
      !session ||
      !sessionActorIsOwner(session) ||
      sessionIsImpersonating(session)
    ) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    return c.json({ plugins: [] as Array<{ plugin_id: string; name: string; user_ids: string[] }> });
  });

  app.post("/api/v1/cockpit/ai-workspace/:aiUserId/close", async (c) => {
    const session = await sessionFromContext(c);
    if (
      !session ||
      !sessionActorIsOwner(session) ||
      sessionIsImpersonating(session)
    ) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    const aiUserId = c.req.param("aiUserId");
    const user = store.getUserById(aiUserId);
    if (!user || user.kind !== "ai") {
      return c.json({ error: "Collaborateur IA introuvable" }, 404);
    }
    const sidecar = getSidecar();
    if (sidecar) {
      try {
        const r = await dispatchSupplierAction(
          "ai_workspace_close",
          { ai_user_id: aiUserId },
          undefined,
          { requireTargetOnline: false },
        );
        return c.json(r ?? { ok: true }, 200);
      } catch (e) {
        return c.json(
          { ok: false, error: e instanceof Error ? e.message : String(e) },
          502,
        );
      }
    }
    const host = presence.listOnlineBridges()[0]?.userId;
    if (!host) {
      return c.json({ ok: true, detail: "aucun hôte — rien à fermer" });
    }
    const r = await dispatchSupplierAction(
      "ai_workspace_close",
      { ai_user_id: aiUserId },
      undefined,
      { targetUserId: host },
    );
    return c.json(r ?? { ok: true }, (r as { ok?: boolean })?.ok === false ? 502 : 200);
  });

  /* Collaborateurs plateforme (owner) — création IA / liste. */
  /* ── Référentiel utilisateurs UNIQUE (core.db) ─────────────────────────
   * Cycle de vie complet des comptes : liste, création (credentials kit si
   * password), mise à jour (permissions / actif / reset mot de passe), meta
   * ACL déclarées par la marque (configureAuth). Monté sur
   * /api/v1/platform/users ET /api/v1/users : les UIs marque (ex. page
   * Collaborateurs verbatim) parlent à CE référentiel — un compte créé ici
   * peut se loguer (authenticateViaKit), pas de table users métier parallèle.
   */
  const ownerSession = async (c: Context): Promise<SessionPayload | null> => {
    const session = await sessionFromContext(c);
    if (
      !session ||
      !sessionActorIsOwner(session) ||
      sessionIsImpersonating(session)
    ) {
      return null;
    }
    return session;
  };

  /* E1 — garde gestion utilisateurs : owner, OU (si la marque a déclaré
   * configureAuth({ userAdminPermission }) ) une session collaborateur non
   * impersonée portant cette permission. Option absente = owner-only,
   * comportement historique octet pour octet. */
  const ownerOrUserAdminSession = async (
    c: Context,
  ): Promise<{ session: SessionPayload; isOwner: boolean } | null> => {
    const asOwner = await ownerSession(c);
    if (asOwner) return { session: asOwner, isOwner: true };
    const permission = getAuthConfig().userAdminPermission;
    if (!permission) return null;
    const session = await sessionFromContext(c);
    if (!session || sessionIsImpersonating(session)) return null;
    if (!session.permissions?.includes(permission)) return null;
    return { session, isOwner: false };
  };

  /* Un userAdmin non-owner ne peut jamais accorder une permission réservée
   * au owner (anti-escalade). */
  const stripOwnerOnlyPerms = (perms: string[]): string[] => {
    const ownerOnly = new Set(getAuthConfig().ownerOnlyPermissions);
    return perms.filter((p) => !ownerOnly.has(p));
  };

  const normalizePerms = (raw: unknown): string[] | undefined =>
    Array.isArray(raw)
      ? raw.filter((p): p is string => typeof p === "string")
      : undefined;

  const usersApi = new Hono();

  usersApi.get("/meta", async (c) => {
    if (!(await ownerOrUserAdminSession(c))) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    const cfg = getAuthConfig();
    return c.json({
      ok: true,
      permission_keys: cfg.collaboratorAssignablePermissions,
      owner_only: cfg.ownerOnlyPermissions,
      defaults: cfg.collaboratorDefaultPermissions,
      kinds: ["human", "ai"],
    });
  });

  usersApi.get("/", async (c) => {
    const session = await sessionFromContext(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    return c.json({ ok: true, users: store.listUsers() });
  });

  usersApi.post("/", async (c) => {
    const admin = await ownerOrUserAdminSession(c);
    if (!admin) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      username?: string;
      kind?: string;
      permissions?: unknown;
      password?: string;
    };
    const username = String(body.username || "").trim();
    const kind = body.kind === "ai" ? "ai" : "human";
    const password = typeof body.password === "string" ? body.password : "";
    // Un humain doit pouvoir se loguer immédiatement — credentials kit
    // obligatoires à la création (les agents IA n'ont pas de login).
    if (kind === "human" && password.length < 6) {
      return c.json({ error: "Mot de passe trop court (6 min)" }, 400);
    }
    try {
      let permissions =
        normalizePerms(body.permissions) ??
        [...getAuthConfig().collaboratorDefaultPermissions];
      if (!admin.isOwner) permissions = stripOwnerOnlyPerms(permissions);
      const user = store.createCollaborator({
        username,
        kind,
        permissions,
      });
      if (kind === "human") {
        const cred = await migrateBrandCredentialsToKit({
          username,
          password,
          displayName: username,
        });
        if (!cred.ok) {
          // Pas de compte fantôme sans login possible.
          store.setCollaboratorActive(user.id, false);
          return c.json(
            { error: `credentials kit indisponibles (${cred.error})` },
            500,
          );
        }
      }
      sidecar?.syncAiExecutors();
      return c.json({ ok: true, user }, 201);
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : String(e) },
        400,
      );
    }
  });

  usersApi.patch("/:id", async (c) => {
    const admin = await ownerOrUserAdminSession(c);
    if (!admin) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      username?: string;
      kind?: string;
      permissions?: unknown;
      active?: boolean;
      password?: string;
    };
    const requestedPerms = normalizePerms(body.permissions);
    const nextPerms =
      requestedPerms && !admin.isOwner
        ? stripOwnerOnlyPerms(requestedPerms)
        : requestedPerms;
    try {
      const user = store.updateCollaborator(c.req.param("id"), {
        ...(typeof body.username === "string"
          ? { username: body.username }
          : {}),
        ...(body.kind === "ai" || body.kind === "human"
          ? { kind: body.kind }
          : {}),
        ...(nextPerms ? { permissions: nextPerms } : {}),
        ...(typeof body.active === "boolean" ? { active: body.active } : {}),
      });
      if (typeof body.password === "string" && body.password) {
        if (body.password.length < 6) {
          return c.json({ error: "Mot de passe trop court (6 min)" }, 400);
        }
        const cred = await migrateBrandCredentialsToKit({
          username: user.username,
          password: body.password,
          displayName: user.username,
        });
        if (!cred.ok) {
          return c.json(
            { error: `reset mot de passe impossible (${cred.error})` },
            500,
          );
        }
      }
      sidecar?.syncAiExecutors();
      return c.json({ ok: true, user });
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : String(e) },
        400,
      );
    }
  });

  app.route("/api/v1/platform/users", usersApi);
  app.route("/api/v1/users", usersApi);

  /* Workspace IA (owner) — mêmes adapters que tasks : sidecar serveur
   * prioritaire, sinon dispatch bridge desktop (client thin / TF2). Sert
   * l'admin, les gates hybrides et « Voir comme IA ». */
  const platformWorkspace = createPlatformTasksBrandAdapters().workspace;
  const resolveHostUserId = (given?: string): string =>
    (given || "").trim() ||
    presence.listOnlineBridges()[0]?.userId ||
    "";

  const workspaceGuard = async (c: Context) => {
    const session = await sessionFromContext(c);
    if (!session || !sessionActorIsOwner(session)) return null;
    return session;
  };

  app.post("/api/v1/platform/workspace/ensure", async (c) => {
    if (!(await workspaceGuard(c))) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      ai_user_id?: string;
      host_user_id?: string;
      label?: string;
      show?: boolean;
    };
    const aiUserId = String(body.ai_user_id || "").trim();
    if (!aiUserId) return c.json({ error: "ai_user_id requis" }, 400);
    const r = await platformWorkspace.ensureOnHost({
      aiUserId,
      hostUserId: resolveHostUserId(body.host_user_id),
      ...(body.label ? { label: body.label } : {}),
      ...(body.show ? { show: true } : {}),
    });
    return c.json(r, r?.ok === true ? 200 : 502);
  });

  app.post("/api/v1/platform/workspace/open-tab", async (c) => {
    if (!(await workspaceGuard(c))) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      ai_user_id?: string;
      host_user_id?: string;
      [k: string]: unknown;
    };
    const aiUserId = String(body.ai_user_id || "").trim();
    if (!aiUserId) return c.json({ error: "ai_user_id requis" }, 400);
    const { ai_user_id: _a, host_user_id: hostId, ...params } = body;
    const r = await platformWorkspace.openTab({
      aiUserId,
      hostUserId: resolveHostUserId(hostId),
      params: params as Record<string, unknown>,
    });
    return c.json(r, r?.ok === true ? 200 : 502);
  });

  app.post("/api/v1/platform/workspace/web-action", async (c) => {
    if (!(await workspaceGuard(c))) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      ai_user_id?: string;
      host_user_id?: string;
      web_type?: string;
      web_params?: Record<string, unknown>;
      tab_id?: string;
    };
    const aiUserId = String(body.ai_user_id || "").trim();
    const webType = String(body.web_type || "").trim();
    if (!aiUserId || !webType) {
      return c.json({ error: "ai_user_id et web_type requis" }, 400);
    }
    const r = await platformWorkspace.webAction({
      aiUserId,
      hostUserId: resolveHostUserId(body.host_user_id),
      webType,
      ...(body.web_params ? { params: body.web_params } : {}),
      ...(body.tab_id ? { tabId: body.tab_id } : {}),
    });
    return c.json(r, r?.ok === true ? 200 : 502);
  });

  /* Presence bridges (owner) — inclut l'hôte synthétique sidecar serveur. */
  app.get("/api/v1/platform/presence", async (c) => {
    if (!(await workspaceGuard(c))) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    return c.json({ ok: true, bridges: presence.listOnlineBridges() });
  });

  // Dispatch desktop générique (owner) — actions external_* / supplier_*
  // vers le poste d'un humain connecté (client thin / TF2) ou l'IA serveur.
  app.post("/api/v1/platform/desktop/dispatch", async (c) => {
    if (!(await workspaceGuard(c))) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      target_user_id?: string;
      type?: string;
      params?: Record<string, unknown>;
    };
    const targetUserId = String(body.target_user_id || "").trim();
    const type = String(body.type || "").trim();
    if (!targetUserId || !type) {
      return c.json({ error: "target_user_id et type requis" }, 400);
    }
    const r = await dispatchSupplierAction(
      type as Parameters<typeof dispatchSupplierAction>[0],
      body.params || {},
      undefined,
      { targetUserId, requireTargetOnline: true },
    );
    return c.json(r, (r as { ok?: boolean })?.ok === true ? 200 : 502);
  });

  app.get("/api/v1/platform/workspace/:aiUserId/tabs", async (c) => {
    if (!(await workspaceGuard(c))) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    const r = await platformWorkspace.listTabs({
      aiUserId: c.req.param("aiUserId"),
      hostUserId: resolveHostUserId(c.req.query("host_user_id")),
    });
    return c.json(r, r?.ok === true ? 200 : 502);
  });

  /* ── Intégrations / clés API tierces (ADR-integrations-store) ──────────
   * Store natif core.db (secrets AES-256-GCM/AUTH_SECRET), sync n8n push,
   * résolution par référence pour Hermes/plugins via la clé API service
   * (table api_keys, brand.db — la clé CRM injectée dans l'env Hermes). */
  const integrationsStore = createSqliteIntegrationsStore({
    coreDbPath: opts.coreDbPath,
  });

  const verifyServiceKey = (
    c: Context,
  ): { id: string | number; name: string } | null => {
    const brandDb = opts.brandDb?.();
    if (!brandDb) return null;
    const authz = c.req.header("authorization") || "";
    const raw =
      c.req.header("x-api-key") ||
      (authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "");
    if (!raw || raw.split(".").length === 3) return null; // JWT = session, pas clé
    try {
      const hash = createHash("sha256").update(raw, "utf8").digest("hex");
      const row = brandDb
        .prepare(
          `SELECT id, name, scopes FROM api_keys
            WHERE key_hash = ? AND revoked_at IS NULL`,
        )
        .get(hash) as
        | { id: string | number; name: string; scopes: string }
        | undefined;
      if (!row) return null;
      const scopes = String(row.scopes || "");
      if (scopes !== "full" && !scopes.split(",").includes("crm:read")) {
        return null;
      }
      return { id: row.id, name: row.name };
    } catch {
      return null; // table api_keys absente (marque sans clés publiques)
    }
  };

  app.route(
    "/api/v1/platform/integrations",
    createIntegrationsRoutes({
      store: integrationsStore,
      getSession: (c) => sessionFromContext(c),
      getOwnerSession: (c) => ownerSession(c),
      verifyServiceKey,
      ...(opts.n8nBridge
        ? {
            n8nSync: createN8nIntegrationsSync({
              getBridge: opts.n8nBridge,
              log: (line) => log(`integrations: ${line}`),
            }),
          }
        : {}),
      onLog: (line) => log(`integrations: ${line}`),
    }),
  );

  log(
    `surface plateforme montée (cookie=${effectiveCookieName}, core=${opts.coreDbPath})`,
  );

  return {
    app,
    runtime,
    attachSidecar: (next) => {
      sidecar = next;
      sidecar?.syncAiExecutors();
    },
    close: () => {
      if (runtimeSlot().current === runtime) {
        runtimeSlot().current = null;
        // La boucle runner IA (ensureAiRunnerLoop, posée par la première
        // requête tasks) référence CE runtime via les adapters lazy : un
        // tick post-close jette requireTasksBrand en unhandledRejection
        // (flake gate PNM.2). Teardown fail-closed : on arrête les timers ;
        // une nouvelle surface les relancera à sa première requête tasks.
        stopAiRunnerLoop();
      }
      integrationsStore.close();
      store.close();
    },
  };
}
