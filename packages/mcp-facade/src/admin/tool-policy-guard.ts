/**
 * Garde d'enforcement réutilisable des policies MCP admin (M1).
 *
 * Trois surfaces, pour trois points d'entrée :
 *   - `checkToolPolicy`          : décision brute (enabled/rôles/scopes) —
 *                                  utilisable par n'importe quel enforcement
 *                                  marque (ex. factory `registerMcpTool`) ;
 *   - `createToolPolicyAuthorize`: `McpAuthorizeToolCallFn` composable avec
 *                                  `composeToolPolicies` / `denyCrossLayerToolCall`
 *                                  pour la façade (`createBrandMcpFacade`) ;
 *   - `registerGuardedMcpTool`   : wrapper serveur MCP SDK — annotations +
 *                                  policy + audit + scopes marque injectés.
 *
 * Aucune donnée marque : la résolution du rôle (`resolveRole`) et la logique
 * scopes marque (`scopeAllows`) sont injectées. Les policies vivent dans la
 * table `mcp_tool_policies` (adapters `configureMcpAdmin`) — mêmes lignes que
 * la page /admin/mcp.
 */

import type {
  McpAuthorizeContext,
  McpAuthorizeToolCallFn,
} from "../types.js";
import { getMcpAdminAdapters, isMcpAdminConfigured } from "./adapters.js";
import { auditMcpAdmin, ensureMcpAdminSchema } from "./mcp-admin.js";

export type ToolPolicyDenialReason =
  | "tool_disabled"
  | "role_forbidden"
  | "policy_scope_forbidden";

/** Vue minimale d'une policy — ce que la garde consomme. */
export type ToolPolicyView = {
  enabled: boolean;
  allowedRoles: string[];
  allowedScopes: string[];
};

export type ToolPolicyActor = {
  userId?: string | null;
  /**
   * Scopes accordés à l'acteur (string séparée espaces/virgules ou tableau).
   * `null`/`undefined` = pas de modèle de scopes sur ce canal → la garde ne
   * vérifie pas les scopes (les canaux OAuth/API key doivent passer `""` au
   * minimum pour forcer la vérification).
   */
  scopes?: string | readonly string[] | null;
};

export type ToolPolicyGuardOptions = {
  /** Résolution de la policy (défaut : table `mcp_tool_policies` des adapters). */
  getPolicy?: (name: string) => ToolPolicyView | null | undefined;
  /** Rôle de l'acteur (injecté par la marque — ex. getUserById(id)?.role). */
  resolveRole?: (userId: string) => string | null | undefined;
  /** Rôle par défaut quand user inconnu / non résolu (défaut "collaborator"). */
  defaultRole?: string;
  /** Scopes « accès complet » qui court-circuitent la policy (défaut ["crm","full"]). */
  fullAccessScopes?: readonly string[];
  /** Audit (défaut `auditMcpAdmin` du kit). */
  audit?: typeof auditMcpAdmin;
};

function splitList(raw: string | null | undefined): string[] {
  return String(raw || "")
    .split(/[\s,]+/)
    .filter(Boolean);
}

function grantedScopeSet(scopes: string | readonly string[]): Set<string> {
  if (Array.isArray(scopes)) return new Set(scopes.map(String).filter(Boolean));
  return new Set(splitList(String(scopes)));
}

/** Policy stockée, lue directement (indépendante du registre tools marque). */
export function getStoredMcpToolPolicy(name: string): ToolPolicyView | null {
  ensureMcpAdminSchema();
  const row = getMcpAdminAdapters()
    .getDb()
    .prepare(
      `SELECT enabled, allowed_roles, allowed_scopes
       FROM mcp_tool_policies WHERE tool_name = ?`,
    )
    .get(name) as
    | { enabled: number; allowed_roles: string; allowed_scopes: string }
    | undefined;
  if (!row) return null;
  return {
    enabled: row.enabled !== 0,
    allowedRoles: splitList(row.allowed_roles),
    allowedScopes: splitList(row.allowed_scopes),
  };
}

/**
 * Décision d'enforcement d'un tool pour un acteur.
 * Retourne la raison du deny, ou `null` si autorisé.
 *
 * Sémantique (parité kit) :
 *  - policy absente ou `enabled=false` → "tool_disabled" ;
 *  - rôle (resolveRole(userId) sinon defaultRole) hors allowedRoles → "role_forbidden" ;
 *  - scopes fournis, aucun full-access ni allowedScope accordé → "policy_scope_forbidden"
 *    (allowedScopes vide = aucune restriction de scope configurée).
 */
export function checkToolPolicy(
  name: string,
  actor: ToolPolicyActor,
  opts: ToolPolicyGuardOptions = {},
): ToolPolicyDenialReason | null {
  const getPolicy = opts.getPolicy || getStoredMcpToolPolicy;
  const policy = getPolicy(name);
  if (!policy?.enabled) return "tool_disabled";
  const role =
    (actor.userId ? opts.resolveRole?.(actor.userId) : null) ||
    opts.defaultRole ||
    "collaborator";
  if (!policy.allowedRoles.includes(role)) return "role_forbidden";
  if (actor.scopes != null && policy.allowedScopes.length > 0) {
    const granted = grantedScopeSet(actor.scopes);
    const fullAccess = opts.fullAccessScopes || ["crm", "full"];
    if (
      !fullAccess.some((scope) => granted.has(scope)) &&
      !policy.allowedScopes.some((scope) => granted.has(scope))
    ) {
      return "policy_scope_forbidden";
    }
  }
  return null;
}

export type CreateToolPolicyAuthorizeOptions = ToolPolicyGuardOptions & {
  /**
   * Extraction de l'acteur depuis le contexte façade. Défaut : subject JWT
   * (hors "anonymous"/"opaque-token") comme userId ; scopes depuis les
   * claims (`scope` string OAuth ou `scopes`), sinon `null` (pas de scopes
   * sur ce canal → pas de vérif scopes).
   */
  resolveActor?: (ctx: McpAuthorizeContext) => ToolPolicyActor;
};

function defaultResolveActor(ctx: McpAuthorizeContext): ToolPolicyActor {
  const claims = ctx.claims || {};
  const claimUserId =
    typeof claims.userId === "string" && claims.userId ? claims.userId : null;
  const subject =
    ctx.subject && ctx.subject !== "anonymous" && ctx.subject !== "opaque-token"
      ? ctx.subject
      : null;
  let scopes: string | readonly string[] | null = null;
  if (typeof claims.scope === "string") scopes = claims.scope;
  else if (Array.isArray(claims.scopes)) scopes = claims.scopes.map(String);
  else if (typeof claims.scopes === "string") scopes = claims.scopes;
  return { userId: claimUserId ?? subject, scopes };
}

/**
 * `McpAuthorizeToolCallFn` (composable via `composeToolPolicies`) qui applique
 * les policies admin. Opt-in non cassant : si aucun `getPolicy` custom n'est
 * fourni ET que `configureMcpAdmin` n'a pas été câblé, la garde autorise tout
 * (comportement identique à une façade sans admin MCP).
 */
export function createToolPolicyAuthorize(
  opts: CreateToolPolicyAuthorizeOptions = {},
): McpAuthorizeToolCallFn {
  const resolveActor = opts.resolveActor || defaultResolveActor;
  const audit = opts.audit || auditMcpAdmin;
  return (ctx) => {
    if (!opts.getPolicy && !isMcpAdminConfigured()) {
      return { allow: true };
    }
    const actor = resolveActor(ctx);
    // Les policies sont stockées sous le nom canonique OU le nom public
    // (alias legacy) selon la surface seedée — on tente les deux.
    const getPolicy = opts.getPolicy || getStoredMcpToolPolicy;
    let denial = checkToolPolicy(ctx.canonicalName, actor, opts);
    if (
      denial === "tool_disabled" &&
      ctx.name !== ctx.canonicalName &&
      getPolicy(ctx.name)
    ) {
      denial = checkToolPolicy(ctx.name, actor, opts);
    }
    if (denial) {
      try {
        audit("tool_call", {
          actor: actor.userId || null,
          toolName: ctx.name,
          outcome: "denied",
          detail: { reason: denial },
        });
      } catch {
        /* audit best-effort côté façade */
      }
      return { allow: false, reason: denial };
    }
    return { allow: true };
  };
}

/* ---------------------------------------------- serveur MCP SDK (marques) */

/** Surface minimale du serveur MCP SDK (`@modelcontextprotocol/sdk`). */
export type GuardedMcpServerLike = {
  registerTool(
    name: string,
    config: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (input: any) => any,
  ): unknown;
};

export type GuardedMcpToolContext = {
  userId?: string | null;
  clientId?: string | null;
  scopes?: string | null;
};

export type GuardedMcpToolDefinition = {
  name: string;
  requiredScope?: string;
  annotations?: Record<string, boolean>;
};

export type RegisterGuardedMcpToolOptions = ToolPolicyGuardOptions & {
  /**
   * Vérification scopes marque supplémentaire (ex. apiKeyAllowsMethod) —
   * deny `insufficient_scope` si false. Injectée par la marque.
   */
  scopeAllows?: (
    ctx: GuardedMcpToolContext,
    def: GuardedMcpToolDefinition,
  ) => boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function errorResult(payload: Record<string, unknown>): any {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    isError: true,
  };
}

/**
 * Enregistre un tool sur le serveur MCP SDK avec annotations + policy admin
 * + audit + vérification scopes marque — SoT de l'enforcement TF-like
 * (`registerMcpTool` des marques délègue ici, le registre métier reste marque).
 */
export function registerGuardedMcpTool(
  server: GuardedMcpServerLike,
  ctx: GuardedMcpToolContext,
  def: GuardedMcpToolDefinition,
  config: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (input: any) => any,
  opts: RegisterGuardedMcpToolOptions = {},
): void {
  const auditFn = opts.audit || auditMcpAdmin;
  server.registerTool(
    def.name,
    {
      ...config,
      ...(def.annotations ? { annotations: def.annotations } : {}),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (input: any) => {
      const audit = (outcome: string, detail?: unknown) =>
        auditFn("tool_call", {
          actor: ctx.userId ?? null,
          clientId: ctx.clientId ?? null,
          toolName: def.name,
          outcome,
          detail,
        });
      const denial = checkToolPolicy(
        def.name,
        { userId: ctx.userId, scopes: ctx.scopes ?? "" },
        opts,
      );
      if (denial) {
        audit("denied", { reason: denial });
        return errorResult({ error: denial, tool: def.name });
      }
      if (opts.scopeAllows && !opts.scopeAllows(ctx, def)) {
        audit("denied", { reason: "insufficient_scope" });
        return errorResult({
          error: "insufficient_scope",
          tool: def.name,
          required_scope: def.requiredScope,
        });
      }
      try {
        const result = await handler(input);
        audit(result?.isError ? "error" : "ok");
        return result;
      } catch (error) {
        audit("error", {
          message:
            error instanceof Error ? error.message.slice(0, 300) : "Erreur tool",
        });
        throw error;
      }
    },
  );
}
