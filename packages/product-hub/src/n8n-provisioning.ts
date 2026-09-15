/**
 * Provisioning n8n plugins — SoT kit (tags + registre SQLite).
 * Config marque : préfixe tag, managedBy, modeLabel, credentials.
 */

import crypto from "node:crypto";
import type { AppManifest } from "@creezio/brand-config";
import {
  productHubTokensFromManifest,
  type ProductHubBrandTokens,
} from "./brand-tokens.js";
import { pluginN8nTag as kitPluginN8nTag } from "./n8n-tags.js";
import type { SqliteDatabase, SqliteStatement } from "./store/sqlite-driver.js";

export type { N8nPluginIdentityMode } from "./n8n-tags.js";
import type { N8nPluginIdentityMode } from "./n8n-tags.js";

type N8nList<T> = {
  data?: T[];
  nextCursor?: string | null;
};

export type N8nTag = {
  id: string;
  name: string;
};

export type N8nWorkflow = {
  id: string;
  name: string;
  tags?: Array<N8nTag | string>;
  [key: string]: unknown;
};

export type N8nExecution = {
  id: string;
  workflowId: string;
  [key: string]: unknown;
};

export type N8nConnectionStatus = {
  connected: boolean;
  apiUrl: string | null;
  version: string | null;
  mode: N8nPluginIdentityMode;
  modeLabel: string;
  usersApiSupported: boolean;
  dedicatedUserSupported: boolean;
  projectsSupported: boolean;
  reason: string;
};

export type PluginN8nSnapshot = {
  connection: N8nConnectionStatus;
  tag: string;
  tagId: string;
  workflows: N8nWorkflow[];
  executions: N8nExecution[];
  registry: Array<Record<string, unknown>>;
};

export type N8nRequest = <T = unknown>(
  endpoint: string,
  init?: RequestInit,
) => Promise<T>;

export type PluginN8nHubDb = Pick<SqliteDatabase, "prepare"> & {
  /** better-sqlite3 transaction — optionnel. */
  transaction?: <T>(fn: () => T) => () => T;
};

export type PluginN8nProvisioningDeps = {
  getDb: () => PluginN8nHubDb;
  getWriteDb?: () => PluginN8nHubDb;
  /** Préfixe tag marque (`tempoflow-plugin:`) ou tokens / manifest. */
  tokens:
    | Pick<ProductHubBrandTokens, "n8nTagPrefix">
    | AppManifest
    | string;
  /** Metadata registre (`managedBy`). */
  managedBy: string;
  /** Label connexion snapshot (ex. « Tag dédié + registre kit »). */
  modeLabel?: string;
  /** Credentials ; défaut = env N8N_API_URL / N8N_API_KEY / N8N_VERSION. */
  getConfig?: () => { base: string; key: string; version?: string | null };
  /** Injecteur HTTP (tests). */
  request?: N8nRequest;
};

export type PluginN8nProvisioning = {
  n8nRequest: N8nRequest;
  pluginN8nTag: (pluginProductId: string) => string;
  ensurePluginN8nTag: (
    pluginProductId: string,
    request?: N8nRequest,
  ) => Promise<N8nTag>;
  detectN8nPluginCapabilities: (
    request?: N8nRequest,
  ) => Promise<N8nConnectionStatus>;
  provisionPluginN8nIdentity: (
    pluginProductId: string,
    request?: N8nRequest,
  ) => Promise<{ mode: N8nPluginIdentityMode; tag: string; tagId: string }>;
  createPluginN8nWorkflow: (
    input: {
      pluginProductId: string;
      name: string;
      nodes: Array<Record<string, unknown>>;
      connections: Record<string, unknown>;
      settings: Record<string, unknown>;
    },
    request?: N8nRequest,
  ) => Promise<{ workflow: N8nWorkflow; tag: string }>;
  getPluginN8nSnapshot: (
    pluginProductId: string,
    request?: N8nRequest,
  ) => Promise<PluginN8nSnapshot>;
};

function defaultN8nConfig(): { base: string; key: string; version: string | null } {
  const base = String(process.env.N8N_API_URL || "").replace(/\/+$/, "");
  const key = String(process.env.N8N_API_KEY || "");
  if (!base || !key) throw new Error("API n8n non configurée");
  return {
    base,
    key,
    version: process.env.N8N_VERSION || null,
  };
}

function publicApiUrl(base: string): string {
  try {
    const url = new URL(base);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return base;
  }
}

function workflowHasTag(workflow: N8nWorkflow, tag: string): boolean {
  return Boolean(
    workflow.tags?.some((item) =>
      typeof item === "string" ? item === tag : item.name === tag,
    ),
  );
}

async function listAll<T>(
  endpoint: string,
  request: N8nRequest,
  limit = 250,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  do {
    const separator = endpoint.includes("?") ? "&" : "?";
    const cursorQuery: string = cursor
      ? `&cursor=${encodeURIComponent(cursor)}`
      : "";
    const result = await request<N8nList<T>>(
      `${endpoint}${separator}limit=${limit}${cursorQuery}`,
    );
    out.push(...(Array.isArray(result.data) ? result.data : []));
    cursor = result.nextCursor || null;
  } while (cursor);
  return out;
}

function runInTransaction(db: PluginN8nHubDb, fn: () => void): void {
  if (typeof db.transaction === "function") {
    db.transaction(fn)();
    return;
  }
  fn();
}

/**
 * Fabrique le module n8n provisioning plugins (générique, config marque).
 */
export function createPluginN8nProvisioning(
  deps: PluginN8nProvisioningDeps,
): PluginN8nProvisioning {
  const getWriteDb = deps.getWriteDb ?? deps.getDb;
  const modeLabel =
    deps.modeLabel ?? `Tag dédié + registre ${deps.managedBy}`;

  const resolveConfig = () => {
    if (deps.getConfig) {
      const c = deps.getConfig();
      return {
        base: c.base.replace(/\/+$/, ""),
        key: c.key,
        version: c.version ?? null,
      };
    }
    return defaultN8nConfig();
  };

  const n8nRequest: N8nRequest = async <T = unknown>(
    endpoint: string,
    init?: RequestInit,
  ): Promise<T> => {
    if (deps.request) return deps.request<T>(endpoint, init);
    const { base, key } = resolveConfig();
    const response = await fetch(`${base}${endpoint}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "X-N8N-API-KEY": key,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        typeof (result as { message?: unknown }).message === "string"
          ? (result as { message: string }).message
          : JSON.stringify(result).slice(0, 300);
      throw new Error(`n8n HTTP ${response.status}: ${message}`);
    }
    return result as T;
  };

  function pluginN8nTag(pluginProductId: string): string {
    return kitPluginN8nTag(pluginProductId, deps.tokens);
  }

  async function ensurePluginN8nTag(
    pluginProductId: string,
    request: N8nRequest = n8nRequest,
  ): Promise<N8nTag> {
    const name = pluginN8nTag(pluginProductId);
    const tags = await listAll<N8nTag>("/tags", request, 100);
    const existing = tags.find((tag) => tag.name === name);
    if (existing) return existing;
    return request<N8nTag>("/tags", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  async function detectN8nPluginCapabilities(
    request: N8nRequest = n8nRequest,
  ): Promise<N8nConnectionStatus> {
    const { base, version } = resolveConfig();
    const [users, projects] = await Promise.allSettled([
      request<N8nList<Record<string, unknown>>>(
        "/users?limit=1&includeRole=true",
      ),
      request<N8nList<Record<string, unknown>>>("/projects?limit=1"),
    ]);
    const projectsSupported = projects.status === "fulfilled";
    return {
      connected: true,
      apiUrl: publicApiUrl(base),
      version,
      mode: "tag-registry",
      modeLabel,
      usersApiSupported: users.status === "fulfilled",
      dedicatedUserSupported: false,
      projectsSupported,
      reason: projectsSupported
        ? "L’API utilisateurs ne permet pas d’émettre automatiquement une clé personnelle sans activation de compte."
        : "La licence n8n refuse les projets et l’API publique ne permet pas d’émettre une clé personnelle pour un utilisateur invité.",
    };
  }

  function upsertWorkflowRegistry(
    pluginProductId: string,
    workflow: N8nWorkflow,
    tag: string,
  ): void {
    getWriteDb()
      .prepare(
        `INSERT INTO plugin_n8n_resources
       (id, plugin_product_id, resource_type, external_id, name, tag, metadata_json, archived_at)
       VALUES (?, ?, 'workflow', ?, ?, ?, ?, NULL)
       ON CONFLICT(plugin_product_id, resource_type, external_id)
       DO UPDATE SET name=excluded.name, tag=excluded.tag,
         metadata_json=excluded.metadata_json, archived_at=NULL`,
      )
      .run(
        crypto.randomUUID(),
        pluginProductId,
        workflow.id,
        workflow.name,
        tag,
        JSON.stringify({ managedBy: deps.managedBy, isolation: "tag-registry" }),
      );
  }

  function reconcileWorkflowRegistry(
    pluginProductId: string,
    workflows: N8nWorkflow[],
    tag: string,
  ): Array<Record<string, unknown>> {
    const db = getWriteDb();
    runInTransaction(db, () => {
      for (const workflow of workflows) {
        upsertWorkflowRegistry(pluginProductId, workflow, tag);
      }
      const activeIds = workflows.map((workflow) => workflow.id);
      if (activeIds.length) {
        const placeholders = activeIds.map(() => "?").join(",");
        db.prepare(
          `UPDATE plugin_n8n_resources SET archived_at=datetime('now')
         WHERE plugin_product_id=? AND resource_type='workflow'
         AND external_id NOT IN (${placeholders}) AND archived_at IS NULL`,
        ).run(pluginProductId, ...activeIds);
      } else {
        db.prepare(
          `UPDATE plugin_n8n_resources SET archived_at=datetime('now')
         WHERE plugin_product_id=? AND resource_type='workflow' AND archived_at IS NULL`,
        ).run(pluginProductId);
      }
    });
    return deps.getDb()
      .prepare(
        `SELECT * FROM plugin_n8n_resources
       WHERE plugin_product_id=? ORDER BY created_at DESC`,
      )
      .all(pluginProductId) as Array<Record<string, unknown>>;
  }

  async function provisionPluginN8nIdentity(
    pluginProductId: string,
    request: N8nRequest = n8nRequest,
  ): Promise<{ mode: N8nPluginIdentityMode; tag: string; tagId: string }> {
    const tag = await ensurePluginN8nTag(pluginProductId, request);
    return { mode: "tag-registry", tag: tag.name, tagId: tag.id };
  }

  async function createPluginN8nWorkflow(
    input: {
      pluginProductId: string;
      name: string;
      nodes: Array<Record<string, unknown>>;
      connections: Record<string, unknown>;
      settings: Record<string, unknown>;
    },
    request: N8nRequest = n8nRequest,
  ): Promise<{ workflow: N8nWorkflow; tag: string }> {
    const tag = await ensurePluginN8nTag(input.pluginProductId, request);
    const workflow = await request<N8nWorkflow>("/workflows", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        nodes: input.nodes,
        connections: input.connections,
        settings: input.settings,
      }),
    });
    if (!workflow.id) throw new Error("n8n n’a pas renvoyé l’identifiant workflow");
    try {
      await request(`/workflows/${encodeURIComponent(workflow.id)}/tags`, {
        method: "PUT",
        body: JSON.stringify([{ id: tag.id }]),
      });
    } catch (error) {
      await request(`/workflows/${encodeURIComponent(workflow.id)}`, {
        method: "DELETE",
      }).catch(() => undefined);
      throw error;
    }
    const tagged = { ...workflow, tags: [tag] };
    upsertWorkflowRegistry(input.pluginProductId, tagged, tag.name);
    return { workflow: tagged, tag: tag.name };
  }

  async function getPluginN8nSnapshot(
    pluginProductId: string,
    request: N8nRequest = n8nRequest,
  ): Promise<PluginN8nSnapshot> {
    const [connection, tagIdentity, allWorkflows] = await Promise.all([
      detectN8nPluginCapabilities(request),
      ensurePluginN8nTag(pluginProductId, request),
      listAll<N8nWorkflow>("/workflows", request),
    ]);
    const workflows = allWorkflows.filter((workflow) =>
      workflowHasTag(workflow, tagIdentity.name),
    );
    const executionLists = await Promise.all(
      workflows.map((workflow) =>
        listAll<N8nExecution>(
          `/executions?workflowId=${encodeURIComponent(workflow.id)}`,
          request,
          100,
        ),
      ),
    );
    return {
      connection,
      tag: tagIdentity.name,
      tagId: tagIdentity.id,
      workflows,
      executions: executionLists.flat(),
      registry: reconcileWorkflowRegistry(
        pluginProductId,
        workflows,
        tagIdentity.name,
      ),
    };
  }

  return {
    n8nRequest,
    pluginN8nTag,
    ensurePluginN8nTag,
    detectN8nPluginCapabilities,
    provisionPluginN8nIdentity,
    createPluginN8nWorkflow,
    getPluginN8nSnapshot,
  };
}

/** Résout le préfixe tag depuis tokens/manifest (helper marques). */
export function resolveN8nTagPrefix(
  tokens:
    | Pick<ProductHubBrandTokens, "n8nTagPrefix">
    | AppManifest
    | string,
): string {
  if (typeof tokens === "string") {
    return tokens.endsWith(":") ? tokens : `${tokens}:`;
  }
  if ("n8nTagPrefix" in tokens) return tokens.n8nTagPrefix;
  return productHubTokensFromManifest(tokens).n8nTagPrefix;
}

/** Type guard utile pour les stubs marque. */
export type PluginN8nPrepare = SqliteStatement;
