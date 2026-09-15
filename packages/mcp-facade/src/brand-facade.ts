/**
 * DX factory marque — remplace le boilerplate create*BrandMcp ×3.
 * La marque fournit api + aliases ; tools module.* générés depuis
 * `api.listOperations()`. `discoverModuleTools` = hook apps optionnel
 * (extras / JWT) — SoT = `operations[]`, pas de `mcpTools` manuscrit.
 */
import type { ApiKernel } from "@creezio/api-kernel";
import { createMcpFacade, type McpFacade } from "./facade.js";
import { composeToolPolicies } from "./policy.js";
import { isMcpAdminConfigured } from "./admin/adapters.js";
import { seedMcpToolPolicies } from "./admin/mcp-admin.js";
import {
  createToolPolicyAuthorize,
  type CreateToolPolicyAuthorizeOptions,
} from "./admin/tool-policy-guard.js";
import { discoverModuleToolsFromKernel } from "./module-ops-tools.js";
import type {
  McpAuthorizeToolCallFn,
  McpFacadeOptions,
  McpPublicSurfaceMode,
  McpRegisteredTool,
} from "./types.js";

export type CreateBrandMcpFacadeOptions = Omit<
  McpFacadeOptions,
  "discoverToolsBySpace" | "aliases"
> & {
  api: ApiKernel;
  /** Aliases legacy métier (surface publique). */
  aliases: Record<string, string>;
  /**
   * Hook apps (extras / JWT). Le runtime génère toujours depuis
   * `api.listOperations()` (space module) — SoT = `operations[]`.
   */
  discoverModuleTools?: (
    api: ApiKernel,
  ) => McpRegisteredTool[] | Promise<McpRegisteredTool[]>;
  /** Discovery plugins (défaut : []). */
  discoverPluginTools?: (
    api: ApiKernel,
  ) => McpRegisteredTool[] | Promise<McpRegisteredTool[]>;
  /** Surface publique (défaut legacy-preferred — compat clients MCP externes). */
  publicSurface?: McpPublicSurfaceMode;
  /** Aliases additionnels fusionnés. */
  extraAliases?: Record<string, string>;
  /**
   * M2 — enforcement des policies admin MCP (`mcp_tool_policies`) sur les
   * tool calls de la façade, composé avec `denyCrossLayerToolCall`. Opt-in
   * et non cassant : sans ce flag (ou si `configureMcpAdmin` n'est pas
   * câblé), comportement identique à aujourd'hui. `true` = défauts ; objet =
   * options de la garde (resolveRole, fullAccessScopes, …). Les tools listés
   * par la façade sont seedés en policies permissives à la première décision
   * (rien ne casse à l'activation).
   */
  toolPolicyGuard?: boolean | CreateToolPolicyAuthorizeOptions;
};

/**
 * Une seule factory listTools/callTool pour Electron / Hono / assistant.
 */
export function createBrandMcpFacade(
  options: CreateBrandMcpFacadeOptions,
): McpFacade {
  const {
    api,
    aliases,
    discoverModuleTools,
    discoverPluginTools,
    extraAliases,
    publicSurface = "legacy-preferred",
    toolPolicyGuard,
    ...rest
  } = options;

  let facade: McpFacade;

  let authorizeToolCall = rest.authorizeToolCall;
  if (toolPolicyGuard) {
    const guardOpts =
      typeof toolPolicyGuard === "object" ? toolPolicyGuard : {};
    const policyAuthorize = createToolPolicyAuthorize(guardOpts);
    // Seed permissif des tools exposés par la façade (INSERT OR IGNORE) —
    // lazy à la première décision : la DB admin n'est pas forcément prête
    // à la création de la façade.
    let policySeeded = false;
    const ensurePolicySeed = async () => {
      if (policySeeded || guardOpts.getPolicy || !isMcpAdminConfigured()) {
        return;
      }
      policySeeded = true;
      try {
        const { tools } = await facade.listTools();
        seedMcpToolPolicies(
          tools.map((tool) => ({
            name: tool.name,
            defaultRoles: tool.defaultRoles,
            requiredScope: tool.requiredScope,
            mcpPublishDefault: tool.mcpPublishDefault,
          })),
        );
      } catch {
        policySeeded = false; // DB pas prête — retentera au prochain call
      }
    };
    const guardedAuthorize: McpAuthorizeToolCallFn = async (ctx) => {
      await ensurePolicySeed();
      return policyAuthorize(ctx);
    };
    authorizeToolCall = authorizeToolCall
      ? composeToolPolicies(authorizeToolCall, guardedAuthorize)
      : guardedAuthorize;
  }

  facade = createMcpFacade({
    allowUnauthenticated: true,
    enforceNamespaces: true,
    publicSurface,
    // defaultCrossLayerDeny=true : la façade compose elle-même
    // denyCrossLayerToolCall AVANT authorizeToolCall (premier deny gagne).
    defaultCrossLayerDeny: true,
    listApiMounts: () => api.listMounts(),
    ...rest,
    authorizeToolCall,
    aliases: { ...aliases, ...(extraAliases || {}) },
    discoverToolsBySpace: async () => ({
      module: discoverModuleToolsFromKernel(
        api,
        discoverModuleTools ? await discoverModuleTools(api) : [],
      ),
      plugin: discoverPluginTools
        ? await discoverPluginTools(api)
        : [],
    }),
  });

  return facade;
}
