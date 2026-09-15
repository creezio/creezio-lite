export {
  configureProductHubUiBrand,
  getProductHubUiBrand,
  resetProductHubUiBrandForTests,
  getDesktopApi,
  type ProductHubUiBrand,
  type DesktopApiBridge,
} from "./brand.js";

export {
  pluginSidebarItems,
  notifyPluginsChanged,
  resolvePluginPanelOpenTarget,
  isPluginPanelOpenTarget,
  openPluginPanelInWorkspace,
  isRemoteDesktopClient,
  type PluginPanelOpenTarget,
  type PluginPanelOpenFail,
  type PluginStatusSnapshot,
  type PluginSidebarItem,
} from "./helpers.js";
