/**
 * Réexport platform-core — équivalent TF plugin-events (N1).
 * Pas de duplication : SoT = `@creezio/platform-core`.
 */

export {
  PLUGIN_RUNTIME_FILE,
  PLUGIN_SITE_ID_BASE,
  PLUGIN_SITE_ID_SPAN,
  pluginAcceptsHook,
  pluginHookUrl,
  pluginN8nWebhookUrl,
  pluginRuntimePath,
  pluginSiteId,
  readPluginRuntimeState,
  writePluginRuntimeState,
  type PluginRuntimeEntry,
  type PluginRuntimeState,
} from "@creezio/platform-core";
