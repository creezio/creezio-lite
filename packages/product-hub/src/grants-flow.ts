/**
 * Flux execution_grant après validation PRD — logique brand-agnostic.
 */

import {
  issuePluginExecutionGrant,
  verifyPluginExecutionGrant,
  type PluginGrantAction,
  type PluginExecutionGrantPayload,
} from "@creezio/platform-core";
import type { ProductHubBrandTokens } from "./brand-tokens.js";
import { grantProcessHint } from "./brand-tokens.js";
import { isValidPluginId } from "@creezio/platform-core";

export type ProductHubPrdRevision = {
  id?: string;
  validated_at?: string | null;
  version?: number;
};

export type ProductHubProductDetails = {
  product?: {
    plugin_id?: string | null;
    archived_at?: string | null;
    lifecycle_state?: string;
  };
  prdRevisions?: ProductHubPrdRevision[];
};

export type IssueGrantResult =
  | {
      ok: true;
      token: string;
      expiresAt: string;
      grantId: string;
      prdRevisionId: string;
      payload: PluginExecutionGrantPayload;
    }
  | { ok: false; code: number; error: string };

/**
 * Émet un grant si (et seulement si) la dernière révision PRD est validée.
 */
export function issueGrantFromProductDetails(opts: {
  details: ProductHubProductDetails;
  productId: string;
  pluginId: string;
  secret: string;
  tokenPrefix: string;
  ttlSeconds?: number;
}): IssueGrantResult {
  if (!isValidPluginId(opts.pluginId)) {
    return { ok: false, code: 400, error: "plugin_id invalide" };
  }
  if (opts.details.product?.archived_at) {
    return {
      ok: false,
      code: 409,
      error: "Produit archivé — aucun grant possible",
    };
  }
  const linked = String(opts.details.product?.plugin_id || "");
  if (linked && linked !== opts.pluginId) {
    return {
      ok: false,
      code: 409,
      error: `Produit lié au plugin « ${linked} » — plugin_id demandé incohérent`,
    };
  }
  const revisions = Array.isArray(opts.details.prdRevisions)
    ? opts.details.prdRevisions
    : [];
  const validated = revisions
    .filter((rev) => rev && rev.validated_at)
    .sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0];
  if (!validated?.id) {
    return {
      ok: false,
      code: 409,
      error:
        "PRD non validé — demander à l'utilisateur de valider le projet (chat ou Admin → Plugins), puis réessayer",
    };
  }
  const latestVersion = revisions.reduce(
    (max, rev) => Math.max(max, Number(rev?.version || 0)),
    0,
  );
  if (Number(validated.version || 0) < latestVersion) {
    return {
      ok: false,
      code: 409,
      error:
        "Une révision PRD plus récente n'est pas validée — faire valider la dernière version du projet",
    };
  }
  const issued = issuePluginExecutionGrant({
    secret: opts.secret,
    productId: opts.productId,
    prdRevisionId: String(validated.id),
    pluginId: opts.pluginId,
    ttlSeconds: opts.ttlSeconds ?? 600,
    tokenPrefix: opts.tokenPrefix,
  });
  return {
    ok: true,
    token: issued.token,
    expiresAt: new Date(issued.payload.exp * 1000).toISOString(),
    grantId: issued.payload.grantId,
    prdRevisionId: String(validated.id),
    payload: issued.payload,
  };
}

export function extractExecutionGrantFromRequest(opts: {
  tokens: ProductHubBrandTokens;
  headers: Record<string, string | string[] | undefined>;
  body?: { execution_grant?: string };
}): string {
  const headerVal = opts.headers[opts.tokens.executionGrantHeader];
  const fromHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  return String(opts.body?.execution_grant || fromHeader || "");
}

export function isGrantBypassEnabled(opts: {
  tokens: ProductHubBrandTokens;
  headers: Record<string, string | string[] | undefined>;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = opts.env || process.env;
  if (env[opts.tokens.grantBypassEnvKey] !== "1") return false;
  const headerVal = opts.headers[opts.tokens.grantBypassHeader];
  const fromHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  return String(fromHeader || "") === opts.tokens.grantBypassValue;
}

export function requirePluginExecutionGrant(opts: {
  tokens: ProductHubBrandTokens;
  secret: string;
  pluginId: string;
  action: PluginGrantAction;
  headers: Record<string, string | string[] | undefined>;
  body?: { execution_grant?: string };
  env?: NodeJS.ProcessEnv;
}): { ok: true } | { ok: false; error: string; hint: string } {
  if (
    isGrantBypassEnabled({
      tokens: opts.tokens,
      headers: opts.headers,
      env: opts.env,
    })
  ) {
    return { ok: true };
  }
  const result = verifyPluginExecutionGrant({
    token: extractExecutionGrantFromRequest(opts),
    secret: opts.secret,
    pluginId: opts.pluginId,
    action: opts.action,
    tokenPrefix: opts.tokens.grantTokenPrefix,
  });
  if (result.ok) return { ok: true };
  return { ok: false, error: result.error, hint: grantProcessHint() };
}

export { grantProcessHint };
