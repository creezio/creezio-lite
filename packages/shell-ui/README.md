# @creezio/shell-ui

## Rôle

`@creezio/shell-ui` fournit la navigation native Creezio, les slots de navigation et le chrome CRM partage entre marques : primitives UI, sidebar, workspace a onglets, recherche globale, surfaces desktop/site externe, settings desktop, layouts et petites libs plateforme.

Le package a deux couches :

| Import | Contenu |
|---|---|
| `@creezio/shell-ui` | noyau bas niveau : registry nav, slots, brand tokens, helpers/lib plateforme |
| `@creezio/shell-ui/ui` | React UI : primitives, AppShell, sidebar, workspace, search, desktop surfaces, settings |

Point d'arbitrage important : historiquement, `shell-ui` etait "nav + slots" (H1/I7). Le package contient aujourd'hui aussi du chrome CRM extrait des apps (sidebar, workspace, search, settings, libs client). Selon `docs/archive/AUDIT-SHELL-UI-SCOPE.md`, ce n'est pas seulement un mauvais nom : c'est le SoT court terme pour le chrome shell CRM, tandis que onboarding, cockpit, splash et auth restent dans leurs packages dedies.

## Périmètre (kit vs marque)

### Dans le kit

Noyau nav / slots :

- `CoreNavItem`, `NavSlotId`, `NavSlot`
- `CORE_NAV_ITEMS`, `createNavRegistry`, `mergeNav`
- `createNavShellAdapter`
- slots `brand-primary`, `brand-secondary`, `plugins`

Chrome CRM / UI :

- primitives shadcn-like (`Button`, `Input`, `Card`, `Dialog`, `Command`, etc.) ;
- sidebar CRM (`Sidebar`, `CrmSidebar`) et host `configureSidebar` ;
- workspace a onglets (`TabWorkspaceProvider`, `WorkspaceShell`, `WorkspaceRoot`, `WorkspaceTabBar`) ;
- bandeau impersonation natif (`ImpersonationBanner`, rendu par `WorkspaceRoot` dès que `me.impersonating` — « Revenir à mon compte » via `stopImpersonate`) ;
- recherche globale (`configureGlobalSearch`, `GlobalSearchProvider`) ;
- surfaces desktop/site externe (`ExternalSiteSlot`, `DesktopBridge`, `SiteLink`) ;
- settings desktop (`DesktopHermesSettings`, `DesktopN8nSettings`, `ApiKeysSettings`, etc.) ;
- composants layout (`AppShell`, `PageChrome`, `EntityHeader`, `SectionViewShell`) ;
- helpers plateforme (`resolvePublicOrigin`, `resolveCookieSecure`, scopes API, URL images, keep-alive, trails, telemetry best-effort).

### Dans la marque

- items nav metier avec ids `brand.*` et hrefs produit ;
- ACL de visibilite (`canShowHref`) ;
- icones et ordre des liens principaux/admin ;
- recherche concrete (Meili, fallback DB, labels d'index) ;
- contexte detail produit / page meta / breadcrumbs metier ;
- providers metier (`PanierProvider`, RTI, GED, VASP, etc.) ;
- routes Next (`/site/[id]`, pages settings/admin) ;
- libelles utilisateur propres a la marque ;
- choix de `desktopApiGlobal`, prefixe API key, nom produit ;
- wiring client dans un fichier boot.

### Hors scope a ne pas reabsorber

| Domaine | Package SoT |
|---|---|
| Login, session UI | `@creezio/auth/ui` |
| Setup / onboarding | `@creezio/onboarding/ui` |
| Cockpit serveur | `@creezio/cockpit/ui` |
| Splash desktop | `@creezio/electron-shell` |
| Tasks AI panel | `@creezio/tasks/ui`, injecte via `configureAiActivityPanel` |
| Auth store/session | `@creezio/auth` |

Conclusion de l'audit : "NATIF shell" est une classification plateforme, pas une obligation de tout mettre dans un seul package. `shell-ui` garde nav + slots + chrome CRM mince ; onboarding/cockpit/splash/auth restent separes.

## Installation / build

```bash
npm install
npm run build -w @creezio/shell-ui
npm run typecheck -w @creezio/shell-ui
```

Artefacts :

- ESM : `dist/`
- CJS Electron : `dist-cjs/`
- UI source : `ui/`

Dependances directes : `@creezio/brand-config`, `@creezio/shell`, `clsx`, `tailwind-merge`. Les dependances React/Radix/Next/Recharts/cmdk/lucide/sonner sont peer dependencies optionnelles car elles concernent `./ui`.

## Configuration

### Brand tokens

```ts
import { configureShellUiBrand } from "@creezio/shell-ui";

configureShellUiBrand({
  desktopApiGlobal: "mybrandDesktop",
  publicHostSuffix: "mybrand.example",
  titlebarDragClass: "mybrand-titlebar-drag",
  titlebarNoDragClass: "mybrand-titlebar-no-drag",
  apiKeyPrefix: "mybrand_live_",
  productName: "Ma Marque",
  aidAttr: "data-creezio-aid",
});
```

`getShellDesktopApi()` lit `window[desktopApiGlobal]` de maniere souple et retourne `undefined` cote serveur.

#### Page login (`login`)

Le panneau brand de la page login split-screen (`LoginPage` de
`@creezio/auth/ui`) se configure via la clé `login` — tout est optionnel,
le défaut est neutre (gradient encre du thème kit, tuile initiale du nom
produit, aucun texte marketing) :

```ts
configureShellUiBrand({
  productName: "Ma Marque",
  // …
  login: {
    tagline: "La tagline produit affichée dans le panneau.",
    highlights: ["Argument un", "Argument deux", "Argument trois"],
    logoUrl: "/logo.svg",                    // défaut : initiale du produit
    panelBackground: "linear-gradient(165deg, #15112e, #221d4d)",
    panelImageUrl: "/login-visual.jpg",      // optionnel, voilé sombre
    panelSide: "right",                      // ou "left"
  },
});
```

En pratique la marque passe cet objet à `CreezioUiBoot` (prop `login`,
`@creezio/os-ui/boot`) plutôt que d'appeler `configureShellUiBrand`
elle-même. Les composants qui lisent la brand au render utilisent le hook
`useShellUiBrand` (`@creezio/shell-ui/ui[/kit]`) : la marque est appliquée
au render par `CreezioUiBoot` et le hook re-render si elle change.

### Boot client marque typique

Un seul fichier de wiring est attendu cote marque, par exemple `crm/src/lib/shell-ui/configure-shell-ui-client.ts`.

```ts
import {
  configureDefaultNewTabHref,
  configureGlobalSearch,
  configureSidebar,
  configureShellUiBrand,
} from "@creezio/shell-ui/ui";

configureShellUiBrand({
  productName: "Ma Marque",
  desktopApiGlobal: "mybrandDesktop",
  apiKeyPrefix: "mybrand_live_",
});

configureSidebar({
  getNavItems: () => brandNavItems,
  getAdminItems: () => brandAdminItems,
  canShowHref: (href, me) => canAccessHref(href, me),
  resolveForcedActiveHref: (pathname, search) =>
    resolveForcedActiveHref(pathname, search),
});

configureGlobalSearch({
  placeholder: "Rechercher...",
  indexLabels: { products: "Produits", clients: "Clients" },
  search: (query, signal) => searchBrandIndexes(query, signal),
});

configureDefaultNewTabHref("/dashboard");
```

### Nav slots bas niveau

La marque enregistre seulement ses items ; le kit ne connait pas les ids metier.

```ts
import { createNavShellAdapter } from "@creezio/shell-ui";

const shell = createNavShellAdapter();
shell.registerBrandNav(
  [{ id: "brand.notes", label: "Notes", href: "/notes", group: "brand" }],
  "brand-primary",
);
shell.registerBrandNav(
  [{ id: "brand.plugin-x", label: "Plugin X", href: "/plugins/x", group: "plugin" }],
  "plugins",
);

const model = shell.getRenderModel();
```

Slots disponibles :

| Slot | Usage |
|---|---|
| `brand-primary` | navigation metier principale |
| `brand-secondary` | liens secondaires metier |
| `plugins` | items issus de plugins Product Hub ou equivalents |

Le render model groupe les items par `core`, `brand`, `plugin`.

## API publique (exports + exemples)

### Package root `@creezio/shell-ui`

Exports nav :

- types `CoreNavItem`, `NavItem`, `NavSlot`, `NavSlotId`
- `CORE_NAV_ITEMS`, `coreNavItems`
- `createNavRegistry`, `mergeNav`
- `createNavShellAdapter`

Exports brand :

- `configureShellUiBrand`, `getShellUiBrand`, `getShellDesktopApi`, `resetShellUiBrandForTests`, `subscribeShellUiBrand` (+ hook `useShellUiBrand` côté `./ui`)

Exports helpers :

- scopes API : `API_SCOPE_FULL`, `API_SCOPE_CRM_READ`, `API_SCOPE_CRM_WRITE`, `API_SCOPE_TASKS_RUN`, `normalizeApiScopes`, `parseApiKeyScopes`, `apiKeyAllowsMethod`, `apiKeyAllowsTasks`, `scopesFromPluginPermissions`
- utils : `cn`, `formatDate`, `formatDateTime`, `formatMoney`, `parsePage`, `formatVariationPct`, `formatDeltaMoney`, `variationTone`
- origin/cookie : `resolvePublicOrigin`, `resolveCookieSecure`, `isLoopbackHost`
- ops : `trackServer`, `trackServerDebounced`, `reportServerIncident`
- UI helpers purs : `haversineKm`, `thumbUrl`, `optimizeCoverUrl`, `buildCatalogSuspenseKey`, `normalizeTabDocumentUrl`, `isSameTabDocument`, `isSameTabOrigin`
- desktop home/keepalive : `CRM_HOME_PATH`, `SERVER_COCKPIT_PATH`, `resolveDesktopHomePath`, `rankKeepAliveEvictionKeys`

```ts
import {
  apiKeyAllowsMethod,
  createNavShellAdapter,
  resolveCookieSecure,
} from "@creezio/shell-ui";

const canWrite = apiKeyAllowsMethod("crm:write", "POST");
const secure = resolveCookieSecure(headers, {
  appPublicUrl: process.env.APP_PUBLIC_URL,
});
```

### UI `@creezio/shell-ui/ui`

Exports majeurs :

- brand/hosts : `configureShellUiBrand`, `configureTabWorkspaceHost`, `configureGlobalSearchHost`, `configureAiActivityPanel`
- primitives : `Button`, `Badge`, `Input`, `Card`, `Tabs`, `Dialog`, `Sheet`, `DropdownMenu`, `Command`, `Toaster`, `ChartContainer`, etc.
- layout : `AppShell`, `PageChrome`, `PageToolbarProvider`, `SectionViewShell`, `EntityHeader`, `Sidebar`, `CrmSidebar`, `configureSidebar`
- workspace : `TabWorkspaceProvider`, `WorkspaceShell`, `WorkspaceRoot`, `WorkspaceTabBar`, `KeepAliveOutlet`, `ImpersonationBanner`, `createTab`, `createExternalSiteTab`
- search : `configureGlobalSearch`, `GlobalSearchProvider`, `GlobalSearchTrigger`, `SearchInput`, `search-history`
- desktop : `ExternalSiteSlot`, `DesktopBridge`, `AuthWindowChrome`, `WindowChromeControls`, `SiteLink`
- settings : `DesktopHermesSettings`, `DesktopN8nSettings`, `DesktopTunnel`, `ApiKeysSettings`, `AccountSettings`, etc.

```tsx
import {
  GlobalSearchProvider,
  Sidebar,
  TabWorkspaceProvider,
  WorkspaceRoot,
} from "@creezio/shell-ui/ui";

export function AppChrome({ children }) {
  return (
    <TabWorkspaceProvider>
      <GlobalSearchProvider>
        <WorkspaceRoot sidebar={<Sidebar />}>{children}</WorkspaceRoot>
      </GlobalSearchProvider>
    </TabWorkspaceProvider>
  );
}
```

### Sites externes / workspace : noms neutres (alias metier purges en H12)

La terminologie kit est neutre. Les alias metier historiques du module
workspace ont ete SUPPRIMES en H12 (codemod `scripts/codemods/H12/`) —
mapping ancien → nouveau :

| Ancien nom (supprime) | SoT kit |
|---|---|
| `OpenSupplierSiteOpts`, `openSupplierSite`, `fournisseurId` | `OpenExternalSiteOpts`, `openExternalSite`, `siteId` |
| `SupplierTabMeta`, `createSupplierTab`, `patchSupplierTab` | `ExternalSiteTabMeta`, `createExternalSiteTab`, `patchExternalSiteTab` |
| `fournisseurIdFromHref`, `isSupplierHref` | `siteIdFromHref`, `isExternalSiteHref` |
| `isOptimiserCanvasHref` | `isCanvasHref` |
| `configureFullscreenPaths({ panierPath, optimiserPath })` | `configureWorkspacePaths({ fullscreenPaths, canvases })` |
| `PANIER_PATH`, `OPTIMISER_PATH`, `TF_LEGACY_*` | constantes DE MARQUE (le kit n'exporte plus de chemin metier) |

Ne pas ajouter de nouveau libelle utilisateur "fournisseur" dans le kit, ni
de nouvel alias de compat. Regle de fond :
[ADR-no-brand-domain-in-native-packages](../../docs/adr/ADR-no-brand-domain-in-native-packages.md)
(gates `test-phase-p29` + `test-phase-no-brand-vocab`).

Exemple de wiring marque (chemins plein ecran / canvas) :

```ts
import { configureWorkspacePaths } from "@creezio/shell-ui/ui";

configureWorkspacePaths({
  // Prefixes de pathnames rendus plein ecran sous les onglets.
  fullscreenPaths: ["/ma-selection"],
  // Canvas plein ecran conditionnel : actif seulement quand le query param
  // requis est present.
  canvases: [{ path: "/mon-atelier", requiredQuery: "objet" }],
});
```

## Flux / fonctionnement

### Nav slots

1. `CORE_NAV_ITEMS` fournit les items Creezio de base.
2. La marque appelle `registerBrandNav(items, slot)`.
3. `mergeNav` combine core + marque.
4. `getRenderModel()` classe les items en groupes `core`, `brand`, `plugin`.
5. L'UI React ou un rendu HTML minimal consomme le render model.

### Chrome CRM

1. La marque configure `ShellUiBrand`, `SidebarHost`, `GlobalSearchConfig` et defaults workspace.
2. `Sidebar` lit `getSidebarHost()` et applique ACL/active href.
3. `TabWorkspaceProvider` gere onglets, historique, keep-alive, liens externes et verrouillages.
4. `WorkspaceShell` / `WorkspaceRoot` composent sidebar, tab bar, footbar, banners et children metier.
5. `GlobalSearchProvider` appelle la fonction `search` injectee par la marque et ouvre les resultats via workspace.
6. `ExternalSiteSlot` coordonne les etats de chargement webview/site externe avec le desktop.

### Settings et libs client

Les settings desktop sont dans `shell-ui/ui/settings` pour eviter les jumeaux TF/CV/Fidu a court terme. Si ce domaine grossit, une extraction future vers `@creezio/desktop-settings` est envisagee, mais elle n'est pas le SoT actuel.

## Intégration marques

Checklist :

1. Appeler `configureShellUiBrand`.
2. Configurer `configureSidebar` avec nav items, admin items, ACL, render plugins/tools si besoin.
3. Configurer `configureGlobalSearch`.
4. Configurer workspace : `configureDefaultNewTabHref`, `configureSidebarCollapsedKey`, `configureProductDetailCtx` si necessaire.
5. Remplacer les composants locaux par les imports `@creezio/shell-ui/ui`.
6. Garder un `WorkspaceRoot` local uniquement s'il compose des providers/banners metier minces.
7. Migrer les surfaces "supplier" vers "external site" pour les nouveaux usages.
8. Ne pas remettre onboarding/cockpit/auth/splash dans ce package.

Doublons historiques côté marque (à ne pas recréer — remplacés par le kit) :

- `src/components/layout/sidebar.tsx`
- `src/components/workspace/tab-workspace-context.tsx`
- `src/components/workspace/workspace-shell.tsx`
- `src/components/global-search-provider.tsx`
- `src/components/desktop/supplier-site-slot.tsx`

## Dépendances @creezio/*

| Dependance | Rôle |
|---|---|
| `@creezio/brand-config` | contexte marque et convergence config |
| `@creezio/shell` | types desktop, IPC/bridge et shell runtime |

Peer optional / interactions :

- `@creezio/auth` : `SessionProvider`, `LoginForm`; shell-ui ne possede pas l'auth.
- `@creezio/assistant` : surfaces AI optionnelles.
- `@creezio/tasks` : panel AI tasks injecte via `configureAiActivityPanel`.
- `@creezio/onboarding`, `@creezio/cockpit`, `@creezio/electron-shell` : packages dedies, hors shell-ui.

## Voir aussi → AGENTS.md + docs/FILES.md

- [`AGENTS.md`](./AGENTS.md) : consignes de modification pour agents.
- [`docs/FILES.md`](./docs/FILES.md) : inventaire fichier par fichier.
- [`../../docs/archive/AUDIT-SHELL-UI-SCOPE.md`](../../docs/archive/AUDIT-SHELL-UI-SCOPE.md) : arbitrage nav slots vs chrome CRM et frontieres avec onboarding/cockpit/splash/auth.


## Profil Creezio Lite / Sites

Le profil Sites utilise les composants originaux. Ajouts optionnels : pagination/recherche distantes de DataTable, destination de logout et désactivation d’impersonation, catalogue admin et rafraîchissement nav via le bus data. Les défauts historiques sont préservés. Correctifs de typage React et import useCallback sans changement de design.

Depuis Lite 0.2.1, `WorkspacePaneRouterContext` (export de `ui/workspace/keep-alive`) accepte un composant de gel de route propre à l’hôte. Sans provider, le comportement Next original reste identique. Le template Sites fournit `SitesPaneRouter` : il conserve les contextes Vinext par pane, empêchant les onglets inactifs de changer de contenu ou de titre. Le bridge reste dans l’application Sites ; aucune dépendance Vinext n’est ajoutée au package natif.
