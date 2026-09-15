/**
 * Réexport platform-core — équivalent TF plugin-execution-grant (N1).
 * Pas de duplication : SoT = `@creezio/platform-core`.
 */

export {
  issuePluginExecutionGrant,
  verifyPluginExecutionGrant,
  type PluginExecutionGrantPayload,
  type PluginGrantAction,
} from "@creezio/platform-core";
