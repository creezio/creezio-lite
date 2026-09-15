/**
 * Runtime sandbox DemoBrand (H2.4 / H5) — multi-DB réel + routes API isolées
 * + ACL Product Hub L3 (see/install/execute) + deny cross-org.
 *
 * Preuve kit :
 * - jour 0 = core + brand only
 * - module `demo-notes` écrit uniquement dans brand
 * - `installSandboxPlugin` crée `plugin/<id>.db` + mount API plugin + ACL org
 * - MCP tools plugin filtrés / deny si org non autorisée
 * - uninstall = closePlugin + remove DB + clear ACL
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  composeMigrations,
  createSqliteRuntime,
  type PathsContext,
  type SqliteMigration,
  type SqliteRuntime,
} from "@creezio/platform-core";
import {
  AUTH_CORE_SQL,
  createSqliteAuthStore,
  type SqliteAuthStore,
} from "@creezio/auth";
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
  createMailsApiMount,
  createSqliteMailsStore,
  type SqliteMailsStore,
} from "@creezio/mails";
import {
  OBSERVABILITY_CORE_SQL,
  createObservabilityApiMount,
  createSqliteObservabilityStore,
  recordActivity,
  recordControlPlaneEvent,
  recordPluginUsage,
  type SqliteObservabilityStore,
} from "@creezio/observability";
import {
  createAutomationEngine,
  createAutomationsApiMount,
  createSqliteAutomationPersist,
  defaultDemobrandAutomationRules,
  type AutomationEngine,
} from "@creezio/automations";
import {
  startHostPluginControlPlane,
  type HostRuntimeContext,
} from "@creezio/host-runtime";
import type { PluginControlPlaneState } from "@creezio/product-hub";
import {
  productHubTokensFromManifest,
  PRODUCT_HUB_ACL_H5_SQL,
  PRODUCT_HUB_ACL_ORG_SQL,
  PRODUCT_HUB_ACL_USER_SQL,
  PRODUCT_HUB_CORE_SQL,
  PLUGIN_ACL_ORG_HEADER,
  PLUGIN_ACL_OWNER_HEADER,
  PLUGIN_ACL_USER_HEADER,
  buildPluginAclActorHeaders,
  createConversationalPluginFactory,
  createFsPluginScaffoldAdapters,
  createOptionalLlmPrdDrafter,
  createPluginControlPlaneAclFromStore,
  createSqliteProductHubStore,
  decidePluginAccess,
  resolvePluginAclActorFromHeaders,
  type ConversationalPluginFactory,
  type PluginAclActor,
  type PluginAclCapability,
  type PluginControlPlaneAcl,
  type SqliteProductHubStore,
} from "@creezio/product-hub";
import {
  createApiKernel,
  type ApiKernel,
  type ApiMount,
  type ApiRequest,
} from "@creezio/api-kernel";
import {
  createDenyUnauthorizedPluginToolPolicy,
  createMcpFacade,
  type McpFacade,
  type McpRegisteredTool,
} from "@creezio/mcp-facade";
import { pluginsRootDir } from "@creezio/platform-core";
import { installKitPluginTemplate } from "@creezio/factory";
import { demobrandManifest as manifest } from "./app-manifest.js";
import { createAdminPluginsApiMount } from "./admin-plugins-api.js";
import { createPluginFactoryApiMount } from "./plugin-factory-api.js";

export const DEMOBRAND_NOTES_SQL = `
CREATE TABLE IF NOT EXISTS demobrand_notes (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`;

export const DEMOBRAND_PLUGIN_KV_SQL = `
CREATE TABLE IF NOT EXISTS plugin_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
`;

export function demobrandCoreMigrations(): SqliteMigration[] {
  return composeMigrations(
    { id: "h2_001_auth", sql: AUTH_CORE_SQL },
    {
      id: "h2_002_product_hub",
      sql: [
        PRODUCT_HUB_CORE_SQL,
        PRODUCT_HUB_ACL_USER_SQL,
        PRODUCT_HUB_ACL_ORG_SQL,
        PRODUCT_HUB_ACL_H5_SQL,
      ].join("\n"),
    },
    { id: "i2_001_assistant", sql: ASSISTANT_CORE_SQL },
    { id: "i3_001_tasks", sql: PLATFORM_TASKS_CORE_SQL },
    { id: "i3_002_mails", sql: PLATFORM_MAILS_CORE_SQL },
    { id: "v2_001_observability", sql: OBSERVABILITY_CORE_SQL },
  );
}

export function demobrandBrandMigrations(): SqliteMigration[] {
  return composeMigrations({
    id: "h2_brand_001_notes",
    sql: DEMOBRAND_NOTES_SQL,
  });
}

export function demobrandPluginMigrations(): SqliteMigration[] {
  return composeMigrations({
    id: "h2_plugin_001_kv",
    sql: DEMOBRAND_PLUGIN_KV_SQL,
  });
}

function createDemoNotesMount(): ApiMount {
  return {
    dbLayer: "brand",
    handle: async ({ req, subPath, db }) => {
      if (!db) {
        return { status: 503, body: { ok: false, error: "db_unavailable" } };
      }
      const method = req.method.toUpperCase();

      // Tentative explicite d'écrire core → doit 403 via ScopedDbAccess
      if (subPath === "attack-core" && method === "POST") {
        db.access({ kind: "core" }, "write").exec(
          `INSERT INTO _creezio_schema_info(key, value) VALUES ('pwned', '1')`,
        );
        return { status: 200, body: { ok: true, pwned: true } };
      }

      if (subPath === "notes" && method === "GET") {
        const rows = db
          .prepare(
            `SELECT id, body, created_at FROM demobrand_notes ORDER BY created_at DESC`,
          )
          .all() as Array<{ id: string; body: string; created_at: string }>;
        return { status: 200, body: { ok: true, layer: db.layer, notes: rows } };
      }

      if (subPath === "notes" && method === "POST") {
        const body =
          req.body && typeof req.body === "object"
            ? (req.body as { body?: string; id?: string })
            : {};
        const id = body.id || `note-${Date.now()}`;
        const text = String(body.body ?? "");
        const createdAt = new Date().toISOString();
        db.prepare(
          `INSERT INTO demobrand_notes (id, body, created_at) VALUES (?, ?, ?)`,
        ).run(id, text, createdAt);
        return {
          status: 201,
          body: { ok: true, layer: db.layer, note: { id, body: text, created_at: createdAt } },
        };
      }

      return { status: 404, body: { ok: false, error: "not_found", subPath } };
    },
  };
}

function createPluginKvMount(
  pluginId: string,
  onDataChanged?: (info: {
    pluginId: string;
    key: string;
    value: string;
    actor: PluginAclActor;
  }) => void | Promise<void>,
): ApiMount {
  return {
    dbLayer: "plugin",
    handle: async ({ req, subPath, db }) => {
      if (!db) {
        return { status: 503, body: { ok: false, error: "db_unavailable" } };
      }
      const method = req.method.toUpperCase();

      if (subPath === "attack-core" && method === "POST") {
        db.access({ kind: "core" }, "write").exec(
          `INSERT INTO _creezio_schema_info(key, value) VALUES ('pwned', '1')`,
        );
        return { status: 200, body: { ok: true, pwned: true } };
      }

      if (subPath === "kv" && method === "GET") {
        const rows = db
          .prepare(`SELECT key, value, updated_at FROM plugin_kv`)
          .all() as Array<{ key: string; value: string; updated_at: string }>;
        return {
          status: 200,
          body: { ok: true, pluginId, layer: db.layer, kv: rows },
        };
      }

      if (subPath === "kv" && method === "POST") {
        const body =
          req.body && typeof req.body === "object"
            ? (req.body as { key?: string; value?: string })
            : {};
        const key = String(body.key || "default");
        const value = String(body.value ?? "");
        const updatedAt = new Date().toISOString();
        db.prepare(
          `INSERT INTO plugin_kv (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ).run(key, value, updatedAt);
        const actor = resolvePluginAclActorFromHeaders(req.headers || {});
        await onDataChanged?.({ pluginId, key, value, actor });
        return {
          status: 201,
          body: {
            ok: true,
            pluginId,
            layer: db.layer,
            entry: { key, value, updated_at: updatedAt },
          },
        };
      }

      return { status: 404, body: { ok: false, error: "not_found", subPath } };
    },
  };
}

export type InstallSandboxPluginOpts = {
  /** Org propriétaire (binding L3) — défaut `org-sandbox`. */
  ownerOrgId?: string;
  /** Orgs qui voient / exécutent (défaut = [ownerOrgId]). */
  allowedOrgIds?: string[];
  /** Capacités explicites (sinon see+execute pour orgs listées). */
  orgCapabilities?: Array<{
    orgId: string;
    capabilities: PluginAclCapability[];
  }>;
};

export type DemobrandSandbox = {
  ctx: PathsContext;
  runtime: SqliteRuntime;
  api: ApiKernel;
  mcp: McpFacade;
  productHub: SqliteProductHubStore;
  /** V1 — fabrique plugins conversationnelle. */
  pluginFactory: ConversationalPluginFactory;
  /** V2 — observabilité native (core). */
  observability: SqliteObservabilityStore;
  /** V3 — automations data-driven. */
  automations: AutomationEngine;
  /** Répertoire plugins FS (scaffold). */
  pluginsDir: string;
  installPlugin(
    pluginId: string,
    opts?: InstallSandboxPluginOpts,
  ): {
    path: string;
    created: boolean;
  };
  uninstallPlugin(pluginId: string): {
    closed: boolean;
    removed: boolean;
    path: string;
  };
  /** Auth persisté core.db (I1). */
  auth: SqliteAuthStore;
  /** Assistant persisté core.db (I2). */
  assistant: SqliteAssistantStore;
  /** Tasks / mails plateforme (I3). */
  tasks: SqliteTasksStore;
  mails: SqliteMailsStore;
  /** Headers actor pour API / control-plane. */
  actorHeaders(actor: PluginAclActor): Record<string, string>;
  /**
   * I4 / C7 — ACL control-plane pour `startHostPluginControlPlane({ acl })`.
   */
  controlPlaneAcl(opts?: {
    onInstalled?: (pluginId: string, actor: PluginAclActor) => void;
    onUninstalled?: (pluginId: string) => void;
  }): PluginControlPlaneAcl;
  /** C7 — démarre le control plane unifié kit. */
  startControlPlane(opts?: {
    port?: number;
  }): Promise<PluginControlPlaneState>;
  close(): void;
};

/**
 * Boot sandbox H2/H5. `userDataRoot` optionnel (tests / CI) — défaut tmp.
 */
export function createDemobrandSandbox(opts?: {
  userDataRoot?: string;
}): DemobrandSandbox {
  const userDataRoot =
    opts?.userDataRoot ||
    fs.mkdtempSync(path.join(os.tmpdir(), "creezio-demobrand-h5-"));

  const ctx: PathsContext = {
    manifest,
    userDataRoot,
    isPackaged: true,
  };

  const runtime = createSqliteRuntime({
    ctx,
    coreMigrations: demobrandCoreMigrations(),
    brandMigrations: demobrandBrandMigrations(),
    touchBrand: true,
  });

  const productHub = createSqliteProductHubStore({
    coreDbPath: runtime.paths.core,
    conversationPrefix: "demobrand",
  });

  const auth = createSqliteAuthStore({
    coreDbPath: runtime.paths.core,
  });

  const assistant = createSqliteAssistantStore({
    coreDbPath: runtime.paths.core,
  });

  const tasks = createSqliteTasksStore({
    coreDbPath: runtime.paths.core,
  });

  const mails = createSqliteMailsStore({
    coreDbPath: runtime.paths.core,
  });

  const observability = createSqliteObservabilityStore({
    coreDbPath: runtime.paths.core,
  });

  const hubTokens = productHubTokensFromManifest(manifest);
  const automationPersist = createSqliteAutomationPersist({
    coreDbPath: runtime.paths.core,
  });
  const automations = createAutomationEngine({
    persist: automationPersist,
    n8nTagPrefix: hubTokens.n8nTagPrefix,
    defaultWebhookUrl: process.env.N8N_AUTOMATION_WEBHOOK_URL || null,
    emitObservability: (input) => {
      observability.record({
        kind: "activity",
        action: input.action,
        orgId: input.orgId,
        userId: input.userId,
        brandId: input.brandId,
        pluginId: input.pluginId,
        meta: input.meta,
      });
    },
    postWebhook: async (url, body) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return { ok: res.ok, status: res.status };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  });
  if (automations.listRules().length === 0) {
    for (const rule of defaultDemobrandAutomationRules()) {
      automations.addRule(rule);
    }
  }

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
    // Compat H2 : appels sans headers actor = service (tests isolation DB).
    if (!hasActorHint) return { allow: true as const };
    const actor = resolvePluginAclActorFromHeaders(headers);
    const action =
      accessCtx.method.toUpperCase() === "GET" ||
      accessCtx.method.toUpperCase() === "HEAD"
        ? ("see" as const)
        : ("execute" as const);
    const decision = decidePluginAccess(
      productHub.getAclPolicy(accessCtx.pluginId),
      actor,
      action,
    );
    if (decision.allow) {
      recordPluginUsage(observability, {
        pluginId: accessCtx.pluginId,
        action: `api.${accessCtx.method.toLowerCase()}`,
        actor: {
          orgId: actor.orgId,
          userId: actor.userId,
          brandId: manifest.brandId,
        },
        meta: { subPath: accessCtx.subPath },
      });
    }
    return decision;
  }

  const api = createApiKernel({
    brandId: manifest.brandId,
    appVersion: "0.1.0",
    sqliteRuntime: runtime,
    authorizePluginAccess,
  });
  api.registerModuleApi("demo-notes", createDemoNotesMount());
  api.registerPlatformApi("platform-tasks", createTasksApiMount(tasks));
  api.registerPlatformApi("platform-mails", createMailsApiMount(mails));
  api.registerModuleApi("admin-plugins", createAdminPluginsApiMount(productHub));

  const pluginsDir = pluginsRootDir(userDataRoot);
  fs.mkdirSync(pluginsDir, { recursive: true });
  // P4 — plugin démo kit « insights-assistant » (template @creezio/factory)
  // installé automatiquement dans la sandbox (idempotent, non bloquant).
  try {
    installKitPluginTemplate({
      templateId: "insights-assistant",
      pluginsDir,
    });
  } catch {
    /* template absent (install partielle) — sandbox utilisable sans */
  }
  const fsAdapters = createFsPluginScaffoldAdapters(pluginsDir);

  const sandboxRef: { install?: DemobrandSandbox["installPlugin"] } = {};

  const pluginFactory = createConversationalPluginFactory({
    store: productHub,
    /** C3 — LLM opt. via env ; sinon déterministe. */
    draftPrd: createOptionalLlmPrdDrafter(),
    collectEvidence: () => {
      const fromHub = productHub.listProducts().map((p) => ({
        type: "product_prd" as const,
        name: p.name,
        description: p.description,
        pluginId: p.plugin_id || undefined,
      }));
      const fromFs = fs.existsSync(pluginsDir)
        ? fs
            .readdirSync(pluginsDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => {
              const mf = path.join(pluginsDir, d.name, "manifest.json");
              let description = "";
              let name = d.name;
              if (fs.existsSync(mf)) {
                try {
                  const j = JSON.parse(fs.readFileSync(mf, "utf8")) as {
                    name?: string;
                    description?: string;
                  };
                  name = j.name || name;
                  description = j.description || "";
                } catch {
                  /* */
                }
              }
              return {
                type: "plugin_manifest" as const,
                name,
                description,
                pluginId: d.name,
              };
            })
        : [];
      return [...fromHub, ...fromFs];
    },
    scaffoldPlugin: (input) => fsAdapters.scaffoldPlugin(input),
    writePluginFiles: (id, files) => fsAdapters.writePluginFiles(id, files),
    installRuntime: (pluginId, actor) => {
      const ownerOrgId = actor.orgId || "org-sandbox";
      if (!runtime.hasPluginOpen(pluginId)) {
        sandboxRef.install?.(pluginId, { ownerOrgId });
      }
      return { dbOpened: runtime.hasPluginOpen(pluginId) };
    },
  });

  api.registerModuleApi(
    "plugin-factory",
    createPluginFactoryApiMount(pluginFactory),
  );
  api.registerPlatformApi(
    "observability",
    createObservabilityApiMount(observability),
  );
  api.registerPlatformApi("automations", createAutomationsApiMount(automations));

  // Wrap factory surface pour émettre activité V2 + triggers V3
  const rawSubmit = pluginFactory.submitIntention.bind(pluginFactory);
  const rawMaterialize = pluginFactory.materialize.bind(pluginFactory);
  const rawIterate = pluginFactory.iterate.bind(pluginFactory);
  pluginFactory.submitIntention = async (input) => {
    const session = await rawSubmit(input);
    recordActivity(
      observability,
      "factory.intention",
      { orgId: "org-sandbox", brandId: manifest.brandId },
      { productId: session.productId, phase: session.phase },
    );
    return session;
  };
  pluginFactory.materialize = async (input) => {
    const result = await rawMaterialize(input);
    if (result.ok) {
      recordActivity(
        observability,
        "factory.materialize",
        {
          orgId: input.actor.orgId,
          userId: input.actor.userId,
          brandId: manifest.brandId,
        },
        { pluginId: result.pluginId, productId: input.productId },
      );
      // control_plane install émis par installPlugin (installRuntime)
      await automations.dispatch({
        type: "factory.materialized",
        orgId: input.actor.orgId,
        userId: input.actor.userId,
        brandId: manifest.brandId,
        pluginId: result.pluginId,
        payload: { productId: input.productId },
      });
      await automations.dispatch({
        type: "plugin.released",
        orgId: input.actor.orgId,
        userId: input.actor.userId,
        brandId: manifest.brandId,
        pluginId: result.pluginId,
      });
    }
    return result;
  };
  pluginFactory.iterate = async (input) => {
    const session = await rawIterate(input);
    recordActivity(
      observability,
      "factory.iterate",
      { orgId: "org-sandbox", brandId: manifest.brandId },
      { pluginId: input.pluginId, productId: session.productId },
    );
    return session;
  };

  function moduleTools(): McpRegisteredTool[] {
    return [
      {
        name: "module.demo-notes.list",
        description: "Liste les notes brand (sandbox)",
        space: "module",
        ownerId: "demo-notes",
        handler: async () => {
          const res = await api.handle({
            method: "GET",
            path: "/api/v1/modules/demo-notes/notes",
          });
          return { ok: res.status < 400, content: res.body };
        },
      },
      {
        name: "module.plugin-factory.submit",
        description: "Soumet une intention à la fabrique plugins (V1)",
        space: "module",
        ownerId: "plugin-factory",
        handler: async (args) => {
          const text = String(
            (args as { text?: string })?.text || "",
          ).trim();
          try {
            const session = await pluginFactory.submitIntention({ text });
            return { ok: true, content: { session } };
          } catch (e) {
            return {
              ok: false,
              content: {
                error: e instanceof Error ? e.message : "error",
              },
            };
          }
        },
      },
      {
        name: "module.plugin-factory.sessions",
        description: "Liste les sessions fabrique plugins",
        space: "module",
        ownerId: "plugin-factory",
        handler: async () => ({
          ok: true,
          content: { sessions: pluginFactory.listSessions() },
        }),
      },
    ];
  }

  function pluginTools(): McpRegisteredTool[] {
    return runtime.listOpenPlugins().map((pluginId) => ({
      name: `plugin.${pluginId}.kv_list`,
      description: `Liste KV plugin ${pluginId}`,
      space: "plugin" as const,
      ownerId: pluginId,
      handler: async () => {
        // Tool déjà autorisé par policy MCP execute — lecture interne owner.
        const res = await api.handle({
          method: "GET",
          path: `/api/v1/plugins/${pluginId}/kv`,
          headers: {
            [PLUGIN_ACL_OWNER_HEADER]: "1",
          },
        });
        return { ok: res.status < 400, content: res.body };
      },
    }));
  }

  const pluginAclPolicy = createDenyUnauthorizedPluginToolPolicy({
    getPolicy: (pluginId) => productHub.getAclPolicy(pluginId),
    decide: decidePluginAccess,
    resolveActor: (ctx) => ({
      orgId: ctx.orgId ?? null,
      userId: ctx.subject && ctx.subject !== "opaque-token" ? ctx.subject : null,
      isOwner: Boolean(ctx.claims?.isOwner),
      isServiceKey:
        ctx.subject === "opaque-token" || ctx.subject === "anonymous",
    }),
  });

  const mcp = createMcpFacade({
    brandId: manifest.brandId,
    allowUnauthenticated: true,
    listApiMounts: () => api.listMounts(),
    authorizeToolCall: pluginAclPolicy,
    discoverToolsBySpace: async () => ({
      module: moduleTools(),
      plugin: pluginTools(),
    }),
    filterPluginToolsForActor: (tools, actorCtx) => {
      const actor: PluginAclActor = {
        orgId: actorCtx.orgId ?? null,
        userId:
          actorCtx.subject &&
          actorCtx.subject !== "opaque-token" &&
          actorCtx.subject !== "anonymous"
            ? actorCtx.subject
            : null,
        isOwner: Boolean(actorCtx.claims?.isOwner),
        isServiceKey:
          actorCtx.subject === "opaque-token" ||
          actorCtx.subject === "anonymous",
      };
      return tools.filter((t) => {
        if (t.space !== "plugin") return true;
        const id = t.ownerId;
        if (!id) return false;
        return decidePluginAccess(productHub.getAclPolicy(id), actor, "see")
          .allow;
      });
    },
  });

  let controlPlane: PluginControlPlaneState | null = null;

  const sandbox: DemobrandSandbox = {
    ctx,
    runtime,
    api,
    mcp,
    productHub,
    pluginFactory,
    observability,
    automations,
    pluginsDir,
    auth,
    assistant,
    tasks,
    mails,

    actorHeaders(actor) {
      return buildPluginAclActorHeaders(actor);
    },

    controlPlaneAcl(opts) {
      return createPluginControlPlaneAclFromStore({
        store: productHub,
        fallbackOwnerOrgId: "org-sandbox",
        onInstalled: (pluginId, actor) => {
          const ownerOrgId = actor.orgId || "org-sandbox";
          // Évite double-bind : installPlugin gère ACL + openPlugin
          if (!runtime.hasPluginOpen(pluginId)) {
            sandbox.installPlugin(pluginId, { ownerOrgId });
          }
          opts?.onInstalled?.(pluginId, actor);
        },
        onUninstalled: (pluginId) => {
          if (runtime.hasPluginOpen(pluginId)) {
            sandbox.uninstallPlugin(pluginId);
          } else {
            productHub.clearAcl(pluginId);
          }
          opts?.onUninstalled?.(pluginId);
        },
      });
    },

    async startControlPlane(opts) {
      if (controlPlane) return controlPlane;
      const hostCtx: HostRuntimeContext = {
        manifest,
        userDataDir: userDataRoot,
        resourcesRoot: userDataRoot,
        isPackaged: true,
      };
      controlPlane = await startHostPluginControlPlane({
        ctx: hostCtx,
        productHubStore: productHub,
        acl: sandbox.controlPlaneAcl(),
        port: opts?.port ?? 0,
      });
      return controlPlane;
    },

    installPlugin(pluginId, installOpts) {
      const ownerOrgId = installOpts?.ownerOrgId || "org-sandbox";
      const opened = runtime.openPlugin(pluginId, demobrandPluginMigrations());
      api.registerPluginApi(
        pluginId,
        createPluginKvMount(pluginId, async (info) => {
          await automations.dispatch({
            type: "org.data_changed",
            orgId: info.actor.orgId || ownerOrgId,
            userId: info.actor.userId,
            brandId: manifest.brandId,
            pluginId: info.pluginId,
            dataLayer: "plugin",
            payload: { key: info.key, value: info.value },
          });
        }),
      );
      const orgIds = installOpts?.allowedOrgIds?.length
        ? installOpts.allowedOrgIds
        : [ownerOrgId];
      const capabilities = (installOpts?.orgCapabilities || []).flatMap((g) =>
        g.capabilities.map((capability) => ({
          subjectKind: "org" as const,
          subjectId: g.orgId,
          capability,
        })),
      );
      productHub.upsertAcl({
        pluginId,
        orgIds,
        userIds: [],
        ownerOrgId,
        ...(capabilities.length > 0 ? { capabilities } : {}),
      });
      recordControlPlaneEvent(observability, "install", {
        pluginId,
        actor: { orgId: ownerOrgId, brandId: manifest.brandId },
        meta: { created: opened.created },
      });
      void automations.dispatch({
        type: "plugin.installed",
        orgId: ownerOrgId,
        brandId: manifest.brandId,
        pluginId,
        payload: { created: opened.created },
      });
      return { path: opened.handle.path, created: opened.created };
    },

    uninstallPlugin(pluginId) {
      api.unregisterPluginApi(pluginId);
      const result = runtime.uninstallPlugin(pluginId);
      productHub.clearAcl(pluginId);
      recordControlPlaneEvent(observability, "uninstall", {
        pluginId,
        actor: { brandId: manifest.brandId },
      });
      void automations.dispatch({
        type: "plugin.uninstalled",
        brandId: manifest.brandId,
        pluginId,
      });
      return result;
    },

    close() {
      if (controlPlane) {
        void controlPlane.close().catch(() => {});
        controlPlane = null;
      }
      observability.close();
      mails.close();
      tasks.close();
      assistant.close();
      auth.close();
      productHub.close();
      runtime.close();
    },
  };

  sandboxRef.install = (pluginId, opts) => sandbox.installPlugin(pluginId, opts);
  return sandbox;
}
