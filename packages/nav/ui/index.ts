/**
 * @creezio/nav/ui — écran admin + re-export du loader chrome.
 *
 * Le loader vit dans `@creezio/shell-ui/ui` : la factory n'importe PAS
 * `@creezio/nav` tant que le package n'est pas publié (E404 new-app).
 */

export { NavAdminClient } from "./nav-admin-client";
export {
  NAV_CATALOG_ENDPOINT,
  NavCatalogLoader,
  applyNavCatalogItemsToSidebar,
  mapNavCatalogSessionToSidebar,
} from "@creezio/shell-ui/ui";
