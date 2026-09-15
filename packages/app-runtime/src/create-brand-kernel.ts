/**
 * Boot kernel marque — SQLite + api-kernel (OS).
 * La marque fournit migrations + registerModuleApi ; le kit monte
 * les surfaces natives (tasks, mails, assistant schema).
 */
import path from "node:path";
import fs from "node:fs";
import {
  createSqliteRuntime,
  platformCoreMigrations,
  type PathsContext,
  type SqliteMigration,
  type SqliteRuntime,
} from "@creezio/platform-core";
import {
  createApiKernel,
  type ApiKernel,
  type ApiRequest,
} from "@creezio/api-kernel";
import type { AppManifest } from "@creezio/brand-config";
import {
  PLUGIN_ACL_ORG_HEADER,
  PLUGIN_ACL_OWNER_HEADER,
  PLUGIN_ACL_USER_HEADER,
  createSqliteProductHubStore,
  decidePluginAccess,
  resolvePluginAclActorFromHeaders,
  type SqliteProductHubStore,
} from "@creezio/product-hub";
import {
  ASSISTANT_CORE_SQL,
  createSqliteAssistantStore,
  type SqliteAssistantStore,
} from "@creezio/assistant";
import {
  PLATFORM_TASKS_CORE_SQL,
  createSqliteTasksStore,
  createTasksApiMount,
  type SqliteTasksStore,
} from "@creezio/tasks";
import {
  PLATFORM_MAILS_CORE_SQL,
  configureMailSecretBridge,
  createMailsApiMount,
  createSqliteMailsStore,
  startImapSyncScheduler,
  startMailOutboxWorker,
  type ImapSyncScheduler,
  type MailOutboxWorker,
  type SqliteMailsStore,
} from "@creezio/mails";
import {
  SUPPORT_CORE_SQL,
  createSupportServerMount,
} from "@creezio/support";
import {
  INTEGRATIONS_CORE_SQL,
  createSqliteIntegrationsStore,
  parseIntegrationReference,
  type SqliteIntegrationsStore,
} from "@creezio/integrations";
import type { BrandKernelHandle } from "./types.js";
import { sessionFromNodeHeaders } from "./module-mount-auth.js";
import {
  getAuthConfig,
  sessionIsImpersonating,
} from "@creezio/auth";
import {
  isAccessControlConfigured,
  resolvePermissions,
} from "@creezio/access-control";
import {
  brandNavItemsToCatalog,
  createNavMount,
  navMigrations,
  registerOsNavAdminEntry,
} from "@creezio/nav";
import type { CoreNavItem } from "@creezio/shell-ui";
import {
  applyBrandModuleAuth,
  sessionCookieNameForBrand,
} from "./apply-brand-module-auth.js";
import type { BrandPermissionGroup } from "./module-contract.js";

export type CreateBrandKernelOptions = {
  manifest: AppManifest;
  userDataDir: string;
  isPackaged?: boolean;
  brandMigrations: readonly SqliteMigration[];
  registerModuleApi: (api: ApiKernel) => void;
  /** Ex. applyBrandMeiliConfig — avant open DB. */
  beforeBoot?: () => void;
  /**
   * Monter tasks/mails/assistant natifs (défaut true).
   * Désactiver uniquement pour tests isolation schéma cœur.
   */
  enablePlatformServices?: boolean;
  /**
   * Items nav métier (slot vertical / `collectNavItems`) — alimentent le
   * mount kit `@creezio/nav` (source `module`).
   */
  navItems?: readonly CoreNavItem[];
  /** Permissions owner issues des `navItems` (`collectNavPermissions`). */
  ownerPermissions?: readonly string[];
  /** Groupes `/admin/access` (`collectPermissionGroups`) — si AC déjà on. */
  permissionGroups?: readonly BrandPermissionGroup[];
};

export type BrandKernelBoot = BrandKernelHandle & {
  paths: PathsContext;
  tasks?: SqliteTasksStore;
  mails?: SqliteMailsStore;
  assistant?: SqliteAssistantStore;
};

function platformExtras(): SqliteMigration[] {
  return [
    { id: "app_runtime_001_assistant", sql: ASSISTANT_CORE_SQL },
    { id: "app_runtime_002_tasks", sql: PLATFORM_TASKS_CORE_SQL },
    { id: "app_runtime_003_mails", sql: PLATFORM_MAILS_CORE_SQL },
    { id: "app_runtime_004_support", sql: SUPPORT_CORE_SQL },
    { id: "app_runtime_005_integrations", sql: INTEGRATIONS_CORE_SQL },
  ];
}

function mountPlatformServices(
  api: ApiKernel,
  runtime: SqliteRuntime,
): Pick<BrandKernelBoot, "tasks" | "mails" | "assistant"> {
  const coreDbPath = runtime.paths.core;
  const assistant = createSqliteAssistantStore({ coreDbPath });
  const tasks = createSqliteTasksStore({ coreDbPath });
  const mails = createSqliteMailsStore({ coreDbPath });

  api.registerPlatformApi("platform-tasks", createTasksApiMount(tasks));
  api.registerPlatformApi("platform-mails", createMailsApiMount(mails));
  // Support natif : tickets du détenteur du serveur, pull par l'admin marque.
  api.registerPlatformApi("platform-support", createSupportServerMount());

  return { tasks, mails, assistant };
}

/**
 * Pont secrets mails → store intégrations (AES-256-GCM au repos).
 * `integration://<slug>` résolu côté kernel ; le store d'intégrations est
 * lazy (même core.db).
 */
function wireMailSecretBridge(
  getIntegrations: () => SqliteIntegrationsStore,
): void {
  configureMailSecretBridge({
    resolve(reference) {
      const slug = parseIntegrationReference(reference);
      if (!slug) return null;
      try {
        return getIntegrations().resolveBySlug(slug)?.secret ?? null;
      } catch {
        return null;
      }
    },
    store(input) {
      const created = getIntegrations().create({
        provider: input.provider,
        label: input.label,
        secret: input.secret,
        meta: input.meta,
      });
      return created.reference;
    },
  });
}

export function createBrandKernel(
  opts: CreateBrandKernelOptions,
): BrandKernelBoot {
  opts.beforeBoot?.();
  if (opts.ownerPermissions || opts.permissionGroups) {
    applyBrandModuleAuth({
      cookieName:
        getAuthConfig().cookieName ||
        sessionCookieNameForBrand(opts.manifest.brandId),
      ...(opts.ownerPermissions
        ? { ownerPermissions: opts.ownerPermissions }
        : {}),
      ...(opts.permissionGroups
        ? { permissionGroups: opts.permissionGroups }
        : {}),
    });
  }
  const enablePlatform = opts.enablePlatformServices !== false;
  const paths: PathsContext = {
    manifest: opts.manifest,
    userDataRoot: opts.userDataDir,
    isPackaged: Boolean(opts.isPackaged),
    resourcesRoot: opts.userDataDir,
  };
  const runtime = createSqliteRuntime({
    ctx: paths,
    coreMigrations: platformCoreMigrations({
      extras: enablePlatform ? platformExtras() : [],
    }),
    brandMigrations: [...opts.brandMigrations, ...navMigrations()],
    touchBrand: true,
  });
  // Version embarquée par l'image Docker versionnée (publish --tag X) —
  // /api/v1/core/version est la SoT de comparaison pour l'update de flotte.
  const appVersion = (process.env.CREEZIO_APP_VERSION || "").trim();

  // ACL plugins Product Hub (P3 plugins natifs) — store lazy sur core.db
  // (tables déjà posées par platformCoreMigrations h3/i10).
  let productHub: SqliteProductHubStore | null = null;
  const getProductHub = (): SqliteProductHubStore => {
    if (!productHub) {
      productHub = createSqliteProductHubStore({
        coreDbPath: runtime.paths.core,
      });
    }
    return productHub;
  };

  // Même décision que MCP / control-plane (decidePluginAccess H5).
  // Compat H2 : appel local sans headers actor = service (owner-level).
  function authorizePluginAccess(accessCtx: {
    pluginId: string;
    method: string;
    subPath: string;
    req: ApiRequest;
  }) {
    const headers = accessCtx.req.headers || {};
    const hasActorHint = Boolean(
      headers[PLUGIN_ACL_ORG_HEADER] ||
        headers[PLUGIN_ACL_USER_HEADER] ||
        headers[PLUGIN_ACL_OWNER_HEADER],
    );
    if (!hasActorHint) return { allow: true as const };
    const actor = resolvePluginAclActorFromHeaders(headers);
    const method = accessCtx.method.toUpperCase();
    const action =
      method === "GET" || method === "HEAD"
        ? ("see" as const)
        : ("execute" as const);
    return decidePluginAccess(
      getProductHub().getAclPolicy(accessCtx.pluginId),
      actor,
      action,
    );
  }

  /**
   * Garde permissions des mounts déclarés (ApiMount.permission) :
   * session cookie/Bearer → owner (non impersonné) OK, sinon permission
   * effective — résolution access-control (défauts rôle + overrides DB) si
   * la marque l'a configuré, claim JWT historique sinon. Sans session :
   * 401 — SAUF credential machine (clé opaque / header interne boot) déjà
   * authentifié à la bordure listenBrandOsHttp (confiance bordure).
   */
  async function authorizeModuleAccess(accessCtx: {
    space: "platform" | "module";
    mountId: string;
    permission: string;
    method: string;
    subPath: string;
    req: ApiRequest;
  }) {
    const headers = accessCtx.req.headers || {};
    const session = await sessionFromNodeHeaders(headers);
    if (!session) {
      // Pas de session : ne laisser passer que les credentials MACHINE déjà
      // authentifiés à la bordure (clé opaque / header interne boot). Un
      // Bearer JWT (3 segments) invalide ou expiré n'est PAS un hint machine.
      const bearerRaw = String(
        (Array.isArray(headers.authorization)
          ? headers.authorization[0]
          : headers.authorization) || "",
      );
      const bearer = bearerRaw.toLowerCase().startsWith("bearer ")
        ? bearerRaw.slice(7).trim()
        : "";
      const opaqueBearer = bearer && bearer.split(".").length !== 3;
      const machineHint =
        headers["x-api-key"] ||
        headers["x-creezio-catalog-internal"] ||
        opaqueBearer;
      if (machineHint) return { allow: true as const };
      return { allow: false as const, reason: "unauthenticated", status: 401 };
    }
    if (session.role === "owner" && !sessionIsImpersonating(session)) {
      return { allow: true as const };
    }
    const permissions = isAccessControlConfigured()
      ? await resolvePermissions(session.sub, null).catch(
          () => session.permissions,
        )
      : session.permissions;
    if (permissions.includes(accessCtx.permission)) {
      return { allow: true as const };
    }
    return {
      allow: false as const,
      reason: `permission_denied: ${accessCtx.permission}`,
      status: 403,
    };
  }

  const api = createApiKernel({
    brandId: opts.manifest.brandId,
    sqliteRuntime: runtime,
    authorizePluginAccess,
    authorizeModuleAccess,
    ...(appVersion ? { appVersion } : {}),
  });

  let platform: Pick<BrandKernelBoot, "tasks" | "mails" | "assistant"> = {};
  let outboxWorker: MailOutboxWorker | null = null;
  let imapScheduler: ImapSyncScheduler | null = null;
  let integrations: SqliteIntegrationsStore | null = null;
  if (enablePlatform) {
    platform = mountPlatformServices(api, runtime);
    const getIntegrations = (): SqliteIntegrationsStore => {
      if (!integrations) {
        integrations = createSqliteIntegrationsStore({
          coreDbPath: runtime.paths.core,
        });
      }
      return integrations;
    };
    // Secrets mails (`integration://…`) résolus via le store intégrations.
    wireMailSecretBridge(getIntegrations);
    // Worker outbox — côté kernel uniquement (jamais dans le plane Next :
    // pas de double envoi). Opt-out : CREEZIO_MAIL_OUTBOX=0.
    // CREEZIO_MAIL_OUTBOX_INTERVAL_MS : drain rapide pour gates/dev (ex. 120).
    if (platform.mails && process.env.CREEZIO_MAIL_OUTBOX !== "0") {
      const intervalRaw = Number(
        process.env.CREEZIO_MAIL_OUTBOX_INTERVAL_MS || "",
      );
      outboxWorker = startMailOutboxWorker({
        store: platform.mails,
        intervalMs:
          Number.isFinite(intervalRaw) && intervalRaw > 0
            ? intervalRaw
            : undefined,
        log: (line) => console.log(`[creezio-mails] ${line}`),
      });
    }
    // Sync IMAP par poll (comptes en base). Opt-out : CREEZIO_MAIL_IMAP=0.
    if (platform.mails && process.env.CREEZIO_MAIL_IMAP !== "0") {
      imapScheduler = startImapSyncScheduler({
        store: platform.mails,
        log: (line) => console.log(`[creezio-mails] ${line}`),
      });
    }
  }

  opts.registerModuleApi(api);

  // Chrome OS : mount nav auto (contrairement à granola/grokbot).
  // Si la marque a déjà monté `nav` (mount owned-by-brand), on ne l'écrase pas.
  registerOsNavAdminEntry();
  const navAlreadyMounted = api
    .listMounts()
    .some((m) => m.space === "module" && m.id === "nav");
  if (!navAlreadyMounted) {
    const navItems = opts.navItems;
    api.registerModuleApi(
      "nav",
      createNavMount({
        collectModuleEntries: () => brandNavItemsToCatalog(navItems),
        features: {
          plugins: opts.manifest.features?.plugins,
          fleet: opts.manifest.features?.fleet,
        },
        getSession: async (req) => {
          const session = await sessionFromNodeHeaders(req.headers || {});
          if (!session) return null;
          return {
            role: session.role,
            permissions: session.permissions,
            impersonating: sessionIsImpersonating(session),
            sub: session.sub,
          };
        },
      }),
    );
  }

  return {
    api,
    runtime,
    paths,
    ...platform,
    // ACL plugins (façade MCP harness/desktop) — lazy, même core.db.
    getPluginAclPolicy: (pluginId: string) =>
      getProductHub().getAclPolicy(pluginId),
    close: () => {
      outboxWorker?.stop();
      imapScheduler?.stop();
      platform.tasks?.close();
      platform.mails?.close();
      platform.assistant?.close();
      integrations?.close();
      productHub?.close();
      runtime.close();
    },
  };
}

/** Adaptateur pour startBrandDesktop / harness (signature bootKernel). */
export function brandKernelBooter(
  opts: Omit<CreateBrandKernelOptions, "userDataDir" | "isPackaged">,
): (boot: { userDataDir: string; isPackaged?: boolean }) => BrandKernelHandle {
  return (boot) =>
    createBrandKernel({
      ...opts,
      userDataDir: boot.userDataDir,
      isPackaged: boot.isPackaged,
    });
}
