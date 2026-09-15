/**
 * Admin Plugins UI (port kit — N6).
 * Consommer via `@creezio/product-hub/ui`.
 */
export { AdminPluginsList } from "./plugins-list";
export { AdminPluginDetail } from "./plugin-detail";
export { HostManagedNotice } from "./host-managed-notice";
export {
  configureTabWorkspaceHook,
  useTabWorkspaceOptional,
  type TabWorkspaceShim,
} from "./tab-workspace-shim";
