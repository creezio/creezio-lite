/**
 * Façade / proxy MCP unique — tools cœur + discoverTools modules/plugins.
 * H2.3 : discovery / listage scindés par couche (core / module / plugin).
 * H4   : registry dynamique, namespacing, aliases legacy, policies deny
 *        cross-layer, surface publique sans double exposition.
 *
 * Pas de MCP « produit Creezio » séparé du MCP de l'app.
 */

import { ARCHITECTURE_VERSION } from "@creezio/platform-core";
import { dynImport } from "./dyn-import.js";
import { verifyMcpBearer } from "./jwt.js";
import { assertNamespacedToolName, isLegacyAliasName } from "./namespace.js";
import {
  composeToolPolicies,
  denyCrossLayerToolCall,
} from "./policy.js";
import { createCoreMcpTools } from "./core-tools.js";
import { isMcpAdminConfigured } from "./admin/adapters.js";
import { filterListedToolsByEnabledPolicy } from "./admin/mcp-admin.js";
import type {
  DiscoverToolsBySpaceFn,
  DiscoverToolsFn,
  McpAuthorizeToolCallFn,
  McpCallToolOpts,
  McpFacadeOptions,
  McpListToolsResult,
  McpPublicSurfaceMode,
  McpRegisteredTool,
  McpToolCallResult,
  McpToolDefinition,
  McpToolsBySpace,
  McpToolSpace,
} from "./types.js";

export type McpFacade = {
  listTools(opts?: {
    bearerToken?: string | null;
    /** Filtre H2 — une seule couche. */
    space?: McpToolSpace;
    /** Override ponctuel de la surface publique. */
    publicSurface?: McpPublicSurfaceMode;
  }): Promise<McpListToolsResult>;
  /** H2 : tools groupés par couche. */
  listToolsBySpace(opts?: {
    bearerToken?: string | null;
    publicSurface?: McpPublicSurfaceMode;
  }): Promise<McpToolsBySpace>;
  callTool(
    name: string,
    args?: Record<string, unknown>,
    opts?: McpCallToolOpts,
  ): Promise<McpToolCallResult>;
  /** Réenregistre / remplace le discoverer plat. */
  setDiscoverTools(fn: DiscoverToolsFn): void;
  /** Réenregistre le discoverer scindé (H2). */
  setDiscoverToolsBySpace(fn: DiscoverToolsBySpaceFn): void;
  /** H4 — enregistre un tool namespacé (module/plugin ; core réservé). */
  registerTool(tool: McpRegisteredTool): void;
  /** H4 — alias legacy → canonique. */
  registerAlias(alias: string, canonicalName: string): void;
  /** H4 — retire un tool du registre dynamique. */
  unregisterTool(name: string): boolean;
  /** H4 — map alias → canonique. */
  listAliases(): Record<string, string>;
  /** H4 — résout alias → nom canonique. */
  resolveToolName(name: string): string;
};

function emptyBySpace(): McpToolsBySpace {
  return { core: [], module: [], plugin: [] };
}

function toDef(t: McpRegisteredTool): McpToolDefinition {
  return {
    name: t.name,
    description: t.description,
    space: t.space,
    ...(t.ownerId ? { ownerId: t.ownerId } : {}),
    ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}),
    ...(t.aliasOf ? { aliasOf: t.aliasOf } : {}),
    ...(t.defaultRoles?.length ? { defaultRoles: t.defaultRoles } : {}),
    ...(typeof t.mcpPublishDefault === "boolean"
      ? { mcpPublishDefault: t.mcpPublishDefault }
      : {}),
    ...(t.requiredScope ? { requiredScope: t.requiredScope } : {}),
  };
}

function groupBySpace(tools: McpToolDefinition[]): McpToolsBySpace {
  const out = emptyBySpace();
  for (const t of tools) {
    out[t.space].push(t);
  }
  return out;
}

/**
 * Applique publicSurface : évite de lister à la fois get_panier et
 * module.panier.get quand un alias les relie.
 */
function applyPublicSurface(
  tools: McpRegisteredTool[],
  aliases: Map<string, string>,
  mode: McpPublicSurfaceMode,
): McpToolDefinition[] {
  const canonicalHidden = new Set<string>();
  if (mode === "legacy-preferred") {
    for (const canonical of aliases.values()) {
      canonicalHidden.add(canonical);
    }
  }

  const defs: McpToolDefinition[] = [];

  for (const t of tools) {
    if (mode === "legacy-preferred" && canonicalHidden.has(t.name)) {
      continue;
    }
    defs.push(toDef(t));
  }

  if (mode === "legacy-preferred" || mode === "both") {
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const [alias, canonical] of aliases) {
      const target = byName.get(canonical);
      if (!target) continue;
      if (defs.some((d) => d.name === alias)) continue;
      defs.push({
        name: alias,
        description: `${target.description} (alias → ${canonical})`,
        space: target.space,
        ...(target.ownerId ? { ownerId: target.ownerId } : {}),
        ...(target.inputSchema ? { inputSchema: target.inputSchema } : {}),
        aliasOf: canonical,
      });
    }
  }

  return defs;
}

export function createMcpFacade(options: McpFacadeOptions = {}): McpFacade {
  let discover: DiscoverToolsFn = options.discoverTools || (async () => []);
  let discoverBySpace: DiscoverToolsBySpaceFn =
    options.discoverToolsBySpace || (async () => ({}));
  const architectureVersion =
    options.architectureVersion ?? ARCHITECTURE_VERSION;
  const enforceNamespaces = options.enforceNamespaces !== false;
  const publicSurfaceDefault: McpPublicSurfaceMode =
    options.publicSurface ?? "legacy-preferred";

  const dynamicTools = new Map<string, McpRegisteredTool>();
  const aliases = new Map<string, string>();

  if (options.aliases) {
    for (const [alias, canonical] of Object.entries(options.aliases)) {
      aliases.set(alias, canonical);
    }
  }

  const authorize: McpAuthorizeToolCallFn = (() => {
    const custom = options.authorizeToolCall;
    const useDefault = options.defaultCrossLayerDeny !== false;
    if (custom && useDefault) {
      return composeToolPolicies(denyCrossLayerToolCall, custom);
    }
    if (custom) return custom;
    if (useDefault) return denyCrossLayerToolCall;
    return async () => ({ allow: true as const });
  })();

  function registerAlias(alias: string, canonicalName: string): void {
    if (!alias || !canonicalName) {
      throw new Error("mcp_alias_invalid: alias et canonical requis");
    }
    if (alias === canonicalName) {
      throw new Error("mcp_alias_invalid: alias = canonical");
    }
    if (!isLegacyAliasName(alias) && enforceNamespaces) {
      // Autoriser aussi un alias namespacé (ex. module.panier.get → autre),
      // mais interdire qu'un alias pointe vers rien de valide plus tard.
    }
    aliases.set(alias, canonicalName);
  }

  function registerTool(tool: McpRegisteredTool): void {
    if (tool.space === "core") {
      throw new Error(
        "mcp_register_core_denied: les tools core sont réservés à la façade",
      );
    }
    if (enforceNamespaces) {
      assertNamespacedToolName(tool.space, tool.name, tool.ownerId);
    }
    dynamicTools.set(tool.name, tool);
  }

  async function auth(bearer?: string | null) {
    // Bearer opaque (clé API service) : résolution app AVANT le JWT.
    if (options.resolveBearerActor) {
      const token = String(bearer || "")
        .replace(/^Bearer\s+/i, "")
        .trim();
      if (token) {
        try {
          const actor = await options.resolveBearerActor(token);
          if (actor?.subject) {
            return {
              ok: true as const,
              subject: actor.subject,
              ...(actor.orgId ? { orgId: actor.orgId } : {}),
              ...(actor.claims ? { claims: actor.claims } : {}),
            };
          }
        } catch {
          // Token inconnu / DB indisponible → fallback JWT inchangé.
        }
      }
    }
    const viaMcp = verifyMcpBearer(bearer, options.jwtSecret, {
      allowUnauthenticated: options.allowUnauthenticated,
    });
    if (viaMcp.ok) return viaMcp;
    // Fallback : Bearer JWT session plateforme (chat OS, clients CRM).
    // Un JWT signé AUTH_SECRET n'est pas un JWT MCP (invalid_signature) —
    // on le valide via @creezio/auth, résolu au runtime de l'app (pas de
    // dépendance de build : façade utilisable hors app → verdict inchangé).
    const token = String(bearer || "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    if (token && token.split(".").length === 3) {
      try {
        const authMod = (await dynImport("@creezio/auth")) as {
          verifySessionToken?: (
            t: string,
          ) => Promise<Record<string, unknown> | null>;
        };
        const session = await authMod.verifySessionToken?.(token);
        const sub = session && typeof session.sub === "string" ? session.sub : "";
        if (sub) {
          return {
            ok: true as const,
            subject: sub,
            claims: session as Record<string, unknown>,
          };
        }
      } catch {
        // @creezio/auth absent (façade standalone) → verdict MCP inchangé.
      }
    }
    return viaMcp;
  }

  async function discoveredTools(): Promise<McpRegisteredTool[]> {
    const flat = await discover();
    const bySpace = await discoverBySpace();
    const out: McpRegisteredTool[] = [...flat];
    for (const space of ["module", "plugin"] as const) {
      for (const t of bySpace[space] || []) {
        out.push({ ...t, space: t.space || space });
      }
    }
    for (const t of dynamicTools.values()) {
      out.push(t);
    }
    return out;
  }

  async function allTools(): Promise<McpRegisteredTool[]> {
    const discovered = await discoveredTools();
    const byName = new Map<string, McpRegisteredTool>();

    const core = createCoreMcpTools({
      architectureVersion,
      brandId: options.brandId,
      listApiMounts: options.listApiMounts,
      listToolsBySpaceSync: () => cachedBySpace,
      listAliasesSync: () => Object.fromEntries(aliases),
    });

    let cachedBySpace = emptyBySpace();

    for (const t of core) byName.set(t.name, t);
    for (const t of discovered) {
      if (byName.has(t.name)) {
        // Les tools cœur gagnent ; modules/plugins doivent préfixer leur id.
        continue;
      }
      if (t.space === "core") {
        // Interdit : un discoverer ne peut pas injecter un tool core.
        continue;
      }
      if (enforceNamespaces) {
        try {
          assertNamespacedToolName(t.space, t.name, t.ownerId);
        } catch {
          // Tool non conforme : ignoré (pas de crash discovery).
          continue;
        }
      }
      byName.set(t.name, t);
    }

    const all = [...byName.values()];
    cachedBySpace = groupBySpace(all.map(toDef));
    return all;
  }

  function resolveToolName(name: string): string {
    return aliases.get(name) || name;
  }

  return {
    setDiscoverTools(fn) {
      discover = fn;
    },

    setDiscoverToolsBySpace(fn) {
      discoverBySpace = fn;
    },

    registerTool,
    registerAlias,

    unregisterTool(name) {
      return dynamicTools.delete(name);
    },

    listAliases() {
      return Object.fromEntries(aliases);
    },

    resolveToolName,

    async listTools(opts) {
      const a = await auth(opts?.bearerToken);
      if (!a.ok) {
        throw Object.assign(new Error(a.error), { status: a.status });
      }
      const tools = await allTools();
      const mode = opts?.publicSurface ?? publicSurfaceDefault;
      let defs = applyPublicSurface(tools, aliases, mode);
      if (opts?.space) {
        defs = defs.filter((t) => t.space === opts.space);
      }
      if (options.filterPluginToolsForActor) {
        defs = await options.filterPluginToolsForActor(defs, {
          subject: a.subject,
          orgId: a.orgId,
          claims: a.claims,
        });
      }
      if (isMcpAdminConfigured()) {
        defs = filterListedToolsByEnabledPolicy(
          defs,
          Object.fromEntries(aliases),
        );
      }
      return { tools: defs };
    },

    async listToolsBySpace(opts) {
      const a = await auth(opts?.bearerToken);
      if (!a.ok) {
        throw Object.assign(new Error(a.error), { status: a.status });
      }
      const tools = await allTools();
      const mode = opts?.publicSurface ?? publicSurfaceDefault;
      let defs = applyPublicSurface(tools, aliases, mode);
      if (options.filterPluginToolsForActor) {
        defs = await options.filterPluginToolsForActor(defs, {
          subject: a.subject,
          orgId: a.orgId,
          claims: a.claims,
        });
      }
      if (isMcpAdminConfigured()) {
        defs = filterListedToolsByEnabledPolicy(
          defs,
          Object.fromEntries(aliases),
        );
      }
      return groupBySpace(defs);
    },

    async callTool(name, args = {}, opts) {
      const a = await auth(opts?.bearerToken);
      if (!a.ok) {
        return { ok: false, error: a.error };
      }
      const canonicalName = resolveToolName(name);
      const isAlias = canonicalName !== name;
      const tools = await allTools();
      const tool = tools.find((t) => t.name === canonicalName);
      if (!tool) return { ok: false, error: "tool_not_found" };

      const decision = await authorize({
        name,
        canonicalName,
        space: tool.space,
        ownerId: tool.ownerId,
        subject: a.subject,
        orgId: a.orgId,
        claims: a.claims,
        args,
        isAlias,
      });
      if (!decision.allow) {
        return { ok: false, error: decision.reason };
      }

      // Acteur transmis aux handlers (2ᵉ argument optionnel, rétro-compat).
      // Bearer + headers d'origine : tools `module.*` les recopient sur la
      // ApiRequest synthétique (requireSession cookie/JWT).
      return tool.handler(args, {
        ...(a.subject ? { subject: a.subject } : {}),
        ...(a.orgId ? { orgId: a.orgId } : {}),
        ...(a.claims ? { claims: a.claims } : {}),
        ...(opts?.bearerToken ? { bearerToken: opts.bearerToken } : {}),
        ...(opts?.headers && Object.keys(opts.headers).length
          ? { headers: opts.headers }
          : {}),
      });
    },
  };
}
