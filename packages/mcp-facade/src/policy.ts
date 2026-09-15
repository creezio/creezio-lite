/**
 * Policies MCP H4 — deny cross-layer cohérent api-kernel H2.
 * H5 — plugin ACL (see/execute) alignée Product Hub.
 */

import type {
  McpAuthorizeContext,
  McpToolPolicyDecision,
} from "./types.js";

export type PluginAclPolicyResolver = (pluginId: string) =>
  | {
      allowedOrgIds: string[];
      allowedUserIds: string[];
      ownerOrgId?: string | null;
      capabilitiesBySubject?: Record<string, Array<"see" | "install" | "execute">>;
      failClosed?: boolean;
      pluginId: string;
    }
  | undefined;

export type PluginAclActorResolver = (ctx: McpAuthorizeContext) => {
  orgId?: string | null;
  userId?: string | null;
  isOwner?: boolean;
  isServiceKey?: boolean;
  isImpersonating?: boolean;
};

export type DecidePluginAccessFn = (
  policy:
    | {
        pluginId: string;
        allowedOrgIds: string[];
        allowedUserIds: string[];
        ownerOrgId?: string | null;
        capabilitiesBySubject?: Record<
          string,
          Array<"see" | "install" | "execute">
        >;
        failClosed?: boolean;
      }
    | undefined,
  actor: {
    orgId?: string | null;
    userId?: string | null;
    isOwner?: boolean;
    isServiceKey?: boolean;
    isImpersonating?: boolean;
  },
  action: "see" | "install" | "execute",
) => { allow: true } | { allow: false; reason: string };

/**
 * Deny-by-default si la charge utile tente un échappement cross-layer
 * (même sémantique que api-kernel `__cross/` / `core/` escaping).
 */
export function denyCrossLayerToolCall(
  ctx: McpAuthorizeContext,
): McpToolPolicyDecision {
  const args = ctx.args || {};
  for (const [key, value] of Object.entries(args)) {
    const blob = `${key}=${stringifyArg(value)}`.toLowerCase();
    if (
      blob.includes("__cross/") ||
      blob.includes("__cross") ||
      /(^|[=\s/])core\//.test(blob) ||
      blob.includes("/../") ||
      blob.includes("..\\")
    ) {
      return { allow: false, reason: "cross_layer_denied" };
    }
  }

  // Un tool module/plugin ne peut pas se faire passer pour core via alias.
  if (ctx.isAlias && ctx.space === "core") {
    return { allow: false, reason: "alias_to_core_denied" };
  }

  // Spoof explicite de couche cible.
  const targetSpace = args.targetSpace ?? args.target_space ?? args.space;
  if (
    typeof targetSpace === "string" &&
    targetSpace !== ctx.space &&
    (targetSpace === "core" ||
      targetSpace === "module" ||
      targetSpace === "plugin")
  ) {
    return { allow: false, reason: "cross_layer_space_spoof" };
  }

  return { allow: true };
}

/**
 * Compose plusieurs policies (premier deny gagne).
 */
export function composeToolPolicies(
  ...policies: Array<
    (ctx: McpAuthorizeContext) => McpToolPolicyDecision | Promise<McpToolPolicyDecision>
  >
): (ctx: McpAuthorizeContext) => Promise<McpToolPolicyDecision> {
  return async (ctx) => {
    for (const p of policies) {
      const d = await p(ctx);
      if (!d.allow) return d;
    }
    return { allow: true };
  };
}

/**
 * H5 — deny tools `plugin.<id>.*` si l'acteur n'a pas `execute`.
 * Injecter `decidePluginAccess` depuis `@creezio/product-hub` pour
 * une décision identique à l'API / control-plane.
 */
export function createDenyUnauthorizedPluginToolPolicy(opts: {
  getPolicy: PluginAclPolicyResolver;
  resolveActor?: PluginAclActorResolver;
  decide: DecidePluginAccessFn;
}): (ctx: McpAuthorizeContext) => McpToolPolicyDecision {
  const resolveActor =
    opts.resolveActor ||
    ((ctx) => ({
      orgId: ctx.orgId ?? (ctx.claims?.orgId as string | undefined) ?? null,
      userId: ctx.subject || null,
      isOwner: Boolean(ctx.claims?.isOwner),
      isServiceKey: ctx.subject === "opaque-token" || ctx.subject === "anonymous",
    }));

  return (ctx) => {
    if (ctx.space !== "plugin") return { allow: true };
    const pluginId = ctx.ownerId;
    if (!pluginId) {
      return { allow: false, reason: "acl_plugin_owner_missing" };
    }
    const actor = resolveActor(ctx);
    const decision = opts.decide(opts.getPolicy(pluginId), actor, "execute");
    if (!decision.allow) return { allow: false, reason: decision.reason };
    return { allow: true };
  };
}

function stringifyArg(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
