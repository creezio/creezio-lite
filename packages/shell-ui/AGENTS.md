# AGENTS — @creezio/shell-ui

## Mission

Maintenir le SoT UI du shell Creezio : nav slots historiques, brand tokens, helpers plateforme et chrome CRM partage (primitives, sidebar, workspace, search, desktop surfaces, settings). Le package doit supprimer les jumeaux TF/CV/Fidu pour les surfaces shell communes tout en laissant aux marques leur metier, leurs routes, leurs ACL et leurs providers.

La mission inclut une clarification de scope : `shell-ui` n'est plus uniquement nav + slots ; il porte aussi le chrome CRM court terme. En revanche, onboarding, cockpit, auth et splash ont des packages dedies et ne doivent pas etre reabsorbes.

## Ne pas faire / frontières

- Ne pas hardcoder de domaine marque (`panier`, `dispatch`, GED, RTI, fournisseur comme concept utilisateur, etc.).
- Ne pas importer de code app via `@/`.
- Ne pas utiliser `window.tempoflowDesktop` ou equivalent hardcode ; passer par `configureShellUiBrand` et `getShellDesktopApi`.
- **Jamais** `sed` / `replace_all` sur `window.<brand>Desktop` sans ajouter
  `import { getShellDesktopApi } from "@creezio/shell-ui"` dans chaque fichier
  touché (gate `scripts/test-phase-shell-desktop-api.mjs`).
- Ne pas ajouter d'usage `Supplier*` / `fournisseur` : les alias metier du module workspace ont ete PURGES en H12 — seuls les noms `ExternalSite*` / `siteId` existent. Ne pas reintroduire d'alias de compat.
- Les chemins plein ecran / canvas du workspace sont injectes par la marque via `configureWorkspacePaths` (`fullscreenPaths`, `canvases`) — aucun chemin metier en dur dans le kit.
- Ne pas remettre login/session dans shell-ui : utiliser `@creezio/auth/ui`.
- Ne pas remettre setup/onboarding : utiliser `@creezio/onboarding/ui`.
- Ne pas remettre cockpit serveur : utiliser `@creezio/cockpit/ui`.
- Ne pas remettre splash : utiliser `@creezio/electron-shell`.
- Ne pas deplacer les settings vers un nouveau package sans demande explicite ; documenter d'abord.
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs shell-ui` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Points d'entrée

Root :

- `src/index.ts` : exports publics root.
- `src/types.ts` : `CoreNavItem`, `NavSlotId`, `NavSlot`.
- `src/core-nav.ts` : navigation core historique (home/setup/login — pas la sidebar).
- `src/nav-catalog.ts` : SoT catalogue OS (`NavCatalogEntry`, `resolveNavCatalog`,
  `registerOsNavEntry`, `defaultOsCatalogEntries`). Plan
  `docs/plans/PLAN-NAV-CATALOG.md`.
- `src/registry.ts` : registry et merge nav.
- `src/adapters/nav-shell.ts` : adapter nav UI-agnostique.
- `src/brand.ts` : tokens marque et desktop API.
- `src/lib/*` : helpers plateforme purs.

UI :

- `ui/index.ts` : exports React publics.
- `ui/layout/sidebar-host.ts` : injection sidebar marque.
- `ui/layout/nav-icons.ts` : `resolveNavIcon(name)` — allowlist lucide,
  inconnu → `Circle` + warning.
- `ui/layout/native-os-nav.ts` : adaptateur `listOsNavEntries()` →
  `SidebarNavItem[]` (fallback hors mount).
- `ui/layout/nav-catalog-loader.tsx` : `<NavCatalogLoader />` — fetch
  `GET /api/v1/modules/nav`, bump `configureSidebar`. Chrome factory /
  marques : monter le loader, **interdit** de recopier un `OS_NAV`.
  Plan : `docs/plans/PLAN-NAV-CATALOG.md`.
- `ui/layout/sidebar.tsx` : sidebar CRM.
- `ui/workspace/tab-workspace-context.tsx` : workspace onglets principal.
- `ui/workspace/tab-workspace-host.ts` : host workspace historique.
- `ui/workspace/workspace-shell.tsx`, `ui/workspace/workspace-root.tsx`, `ui/workspace/workspace-tab-bar.tsx`.
- `ui/search/global-search-config.ts`, `ui/search/global-search-provider.tsx`.
- `ui/desktop/external-site-slot.tsx`, `ui/desktop/external-site-surface.ts`.
- `ui/settings/*` : settings desktop/admin.
- `ui/primitives/*` : primitives partages.

Docs :

- `README.md`
- `docs/FILES.md`
- `../../docs/archive/AUDIT-SHELL-UI-SCOPE.md`

## Modifier sans casser

- Pour nav bas niveau, garder la marque limitee a `registerBrandNav`; ne pas ajouter d'ids metier core.
- Les slots valides sont `brand-primary`, `brand-secondary`, `plugins`. Toute extension doit etre justifiee.
- Les hosts (`configureSidebar`, `configureGlobalSearch`, `configureTabWorkspaceHost`) doivent echouer clairement si requis mais non configures.
- Les composants UI doivent rester consommables via `@creezio/shell-ui/ui`.
- Garder les imports compatibles Next/React client-server ; eviter d'appeler `window` sans garde.
- Les helpers dans `src/lib/*` doivent rester purs ou best-effort non bloquants.
- Pour workspace, verifier les invariants : max tabs, keep-alive, locked navigation, external site tabs, storage keys configurables.
- Pour search, la recherche concrete reste injectee ; ne pas importer Meili ou DB marque dans le kit.
- Pour settings, les APIs appelees doivent rester configurees par props/hosts ou endpoints marque existants.
- Si une API UI est renommee, conserver les alias de compat uniquement si une marque les utilise deja, et documenter la deprecation.

## Config brand

La marque doit configurer :

- `configureShellUiBrand` :
  - `desktopApiGlobal`
  - `publicHostSuffix`
  - `titlebarDragClass` / `titlebarNoDragClass` (défauts + CSS kit H13 :
    `creezio-titlebar-drag` / `creezio-titlebar-no-drag` — plus de
    sélecteur nommé marque ; codemod `scripts/codemods/H13/`)
  - `apiKeyPrefix`
  - `productName`
  - `aidAttr` si besoin
- `configureSidebar` :
  - `getNavItems`
  - `getAdminItems`
  - `canShowHref`
  - `resolveForcedActiveHref`
  - `renderBrandMark`, `renderTools`, `renderPlugins` si besoin
- `configureGlobalSearch` :
  - `search(query, signal)`
  - `indexLabels`
  - `storageKey`
  - `preferCatalogueHref`
  - `onTrack`
- Workspace :
  - `configureDefaultNewTabHref`
  - `configureSidebarCollapsedKey`
  - `configureProductDetailCtx`
  - `configureWorkspaceStorageKey`
  - `configureWorkspacePaths` (chemins plein ecran / canvases metier)
  - `configureEntityRouteRoots`, `configureSectionLabels`, `configureEntityLabels` si necessaire
- `configureAiActivityPanel` pour brancher `@creezio/tasks/ui`.

Garder ce wiring dans un fichier client marque mince.

## Tests / gates

Commandes utiles :

```bash
npm run build -w @creezio/shell-ui
npm run typecheck -w @creezio/shell-ui
node --test scripts/test-phase-o9.mjs
node --test scripts/test-phase-o9p.mjs
node --test scripts/test-phase-p-shell-ui.mjs
node --test scripts/test-phase-shell-desktop-api.mjs
node --test scripts/test-phase-p29.mjs
```

Gates de scope :

- aucun nouveau terme/metier marque dans le kit ;
- aucun nouveau doublon sidebar/workspace/search dans les marques — le chrome vient du kit ;
- `ExternalSite*` uniquement (les alias `Supplier*` du workspace n'existent plus depuis H12) ;
- auth/onboarding/cockpit/splash restent hors package ;
- `getShellDesktopApi()` reste la seule lecture desktop global generique.

Gates fonctionnels :

- `configureSidebar()` requis avant `Sidebar`.
- `configureGlobalSearch()` requis avant provider search.
- `createNavShellAdapter().registerBrandNav()` met a jour `getRenderModel()`.
- `resolveCookieSecure` et `resolvePublicOrigin` restent corrects loopback/tunnel/prod.
- workspace conserve l'etat onglets et n'evince pas les panes fullscreen proteges.

## Fichiers sensibles

- `ui/workspace/tab-workspace-context.tsx` : coeur onglets, historique, external sites.
- `ui/workspace/types.ts` : types publics du workspace (noms neutres, chemins injectés via `configureWorkspacePaths`).
- `ui/layout/sidebar.tsx` : chrome nav dense.
- `ui/search/global-search-provider.tsx` : UX recherche et navigation.
- `ui/desktop/external-site-slot.tsx` : coordination desktop/webview.
- `src/brand.ts` : tokens marque et desktop API.
- `src/adapters/nav-shell.ts` : contrat nav slots.
- `src/lib/public-origin.ts` : securite cookies/origin.
- `src/lib/api-scopes.ts` : scopes API keys.
- `ui/settings/*` : nombreuses surfaces desktop avec endpoints host.
- `package.json` exports et peer dependencies.

## Liens

- [`README.md`](./README.md)
- [`docs/FILES.md`](./docs/FILES.md)
- [`../../docs/archive/AUDIT-SHELL-UI-SCOPE.md`](../../docs/archive/AUDIT-SHELL-UI-SCOPE.md)
- Packages lies : `@creezio/auth`, `@creezio/onboarding`, `@creezio/cockpit`, `@creezio/electron-shell`, `@creezio/tasks`, `@creezio/shell`
