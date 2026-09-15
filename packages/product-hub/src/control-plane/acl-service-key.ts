/**
 * Compat Hermes / E2E : Bearer sans headers actor → clé service.
 */

import {
  PLUGIN_ACL_ORG_HEADER,
  PLUGIN_ACL_OWNER_HEADER,
  PLUGIN_ACL_USER_HEADER,
} from "../acl.js";
import type { PluginControlPlaneAcl } from "./types.js";

const ACTOR_HINT_HEADERS = [
  PLUGIN_ACL_ORG_HEADER,
  PLUGIN_ACL_USER_HEADER,
  PLUGIN_ACL_OWNER_HEADER,
  "x-creezio-org-id",
  "x-creezio-user-id",
  "x-creezio-is-owner",
] as const;

/**
 * Enrobe une ACL store : absence de hint actor → `isServiceKey: true`
 * (skill Hermes, tests control-plane).
 */
export function withBearerServiceKeyFallback(
  base: PluginControlPlaneAcl,
): PluginControlPlaneAcl {
  return {
    ...base,
    resolveActor(headers) {
      const actor = base.resolveActor(headers);
      const hasHint = ACTOR_HINT_HEADERS.some((h) => Boolean(headers[h]));
      if (!hasHint) return { ...actor, isServiceKey: true };
      return actor;
    },
  };
}
