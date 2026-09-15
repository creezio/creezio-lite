/**
 * Câblage ACL Product Hub → façade MCP (P2/P3 plugins natifs).
 * Fail-closed : sans grant ACL, un plugin n'est NI visible NI appelable —
 * sauf acteur niveau owner (owner non impersoné / clé service), logique
 * `decidePluginAccess` H5.
 */
import {
  composeToolPolicies,
  createDenyUnauthorizedPluginToolPolicy,
  denyCrossLayerToolCall,
  type McpAuthorizeToolCallFn,
  type McpToolDefinition,
} from "@creezio/mcp-facade";
import {
  decidePluginAccess,
  type PluginAclActor,
  type PluginAclPolicy,
} from "@creezio/product-hub";

export type PluginAclMcpWiring = {
  authorizeToolCall: McpAuthorizeToolCallFn;
  filterPluginToolsForActor: (
    tools: McpToolDefinition[],
    ctx: {
      subject?: string;
      orgId?: string;
      claims?: Record<string, unknown>;
    },
  ) => McpToolDefinition[];
};

function actorFromMcpCtx(ctx: {
  subject?: string;
  orgId?: string | null;
  claims?: Record<string, unknown>;
}): PluginAclActor {
  const subject = ctx.subject || "";
  const isServiceKey = subject === "opaque-token" || subject === "anonymous";
  return {
    orgId: ctx.orgId ?? (ctx.claims?.orgId as string | undefined) ?? null,
    userId: subject && !isServiceKey ? subject : null,
    isOwner: Boolean(ctx.claims?.isOwner),
    isServiceKey,
  };
}

/**
 * Compose `denyCrossLayerToolCall` + deny plugin sans grant execute,
 * et fournit le filtre listTools (capacité `see`).
 */
export function createPluginAclMcpWiring(opts: {
  /** Policy Product Hub (undefined ⇒ fail-closed owner-only). */
  getPolicy?: (pluginId: string) => PluginAclPolicy | undefined;
}): PluginAclMcpWiring {
  const getPolicy = (pluginId: string): PluginAclPolicy | undefined => {
    try {
      return opts.getPolicy?.(pluginId);
    } catch {
      return undefined;
    }
  };

  const authorizeToolCall = composeToolPolicies(
    denyCrossLayerToolCall,
    createDenyUnauthorizedPluginToolPolicy({
      getPolicy: (pluginId) => getPolicy(pluginId),
      decide: decidePluginAccess,
      resolveActor: (ctx) =>
        actorFromMcpCtx({
          subject: ctx.subject,
          orgId: ctx.orgId ?? null,
          claims: ctx.claims,
        }),
    }),
  );

  const filterPluginToolsForActor: PluginAclMcpWiring["filterPluginToolsForActor"] =
    (tools, actorCtx) => {
      const actor = actorFromMcpCtx(actorCtx);
      return tools.filter((t) => {
        if (t.space !== "plugin") return true;
        if (!t.ownerId) return false;
        return decidePluginAccess(getPolicy(t.ownerId), actor, "see").allow;
      });
    };

  return { authorizeToolCall, filterPluginToolsForActor };
}
