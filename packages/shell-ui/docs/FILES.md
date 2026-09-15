# packages/shell-ui — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs shell-ui` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/brand.ts`](../src/brand.ts) | O9 — tokens marque pour shell-ui (desktop API, hosts, titlebar). |
| [`src/core-nav.ts`](../src/core-nav.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/index.ts`](../src/index.ts) | @creezio/shell-ui — nav + slots (H1.4 / I7) + libs plateforme (O9). UI React : `@creezio/shell-ui/ui`. |
| [`src/nav-catalog.ts`](../src/nav-catalog.ts) | Catalogue de nav OS (Phase A) : types `NavCatalogEntry` / `NavOverride`, merge pur `resolveNavCatalog`, registre `registerOsNavEntry` / `defaultOsCatalogEntries`. Node-safe, zéro React. Plan `docs/plans/PLAN-NAV-CATALOG.md`. |
| [`src/registry.ts`](../src/registry.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/types.ts`](../src/types.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `src/adapters/`

| Fichier | Rôle |
|---|---|
| [`src/adapters/nav-shell.ts`](../src/adapters/nav-shell.ts) | Adapter nav shell (Phase I7) — contrat de rendu UI-agnostique. Marque = `registerBrandNav` uniquement ; pas de hardcode panier/dispatch dans le kit. React/Next consomme `getRenderModel()` / `subscribe`. |

## `src/lib/`

| Fichier | Rôle |
|---|---|
| [`src/lib/api-scopes.ts`](../src/lib/api-scopes.ts) | Scopes des clés API publiques (`api_keys.scopes`). - `full` : accès intégration complet (Hermes, clés UI) - `crm:read` : GET/HEAD/OPTIONS uniquement - `crm:write` : lectures + mutations (implique read) Stockage : chaîne CSV (`crm:read,crm:write`) ou `full`. |
| [`src/lib/catalog-suspense-key.ts`](../src/lib/catalog-suspense-key.ts) | Clé Suspense stable — inclut la vue + filtres actifs (sans recréer page par page). export function buildCatalogSuspenseKey( sp: Record<string, string \| undefined> \| undefined, resolveView: (raw: string \| undefined) => string, filterKeys: readonly string[], ): string { const view = resolveView(sp?.view); const parts: string[] = [view]; for (const key of filterKeys) { const value = (sp?.[key] \|\| "").trim(); if (value) parts.push(`${key}=${value}`); } |
| [`src/lib/data-changed.ts`](../src/lib/data-changed.ts) | (à documenter) |
| [`src/lib/desktop-home-path.ts`](../src/lib/desktop-home-path.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/lib/geo-distance.ts`](../src/lib/geo-distance.ts) | Distance géodésique (haversine) — logique pure, testable. |
| [`src/lib/img.ts`](../src/lib/img.ts) | Réécrit les URLs d'images externes vers leur variante miniature CDN. Évite de charger des originaux de 20+ Mpx dans des cartes de 300 px. |
| [`src/lib/keepalive-eviction.ts`](../src/lib/keepalive-eviction.ts) | Politique d'éviction keep-alive (pur / testable). Les panes fullscreen (`/site` + matchers marque) ne sont jamais évincées. |
| [`src/lib/ops-track.ts`](../src/lib/ops-track.ts) | Boîte noire — émission d'événements ops depuis le SERVEUR Next. Le serveur tourne en sous-process du main Electron : une ligne `TF2EVENT {json}` sur stdout est captée par le hook logger du main (voir `@creezio/observability` initOpsJournal). En mode serveur pur (Docker), la ligne reste un simple log console — inoffensif. Volontairement autonome (pas d'import electron/) pour respecter la frontière de build Next. |
| [`src/lib/optimize-cover-url.ts`](../src/lib/optimize-cover-url.ts) | Réécrit les URLs de covers (secteurs / catégories) vers une taille vignette. Les /img/familles.webp locaux sont déjà optimisés — pass-through. |
| [`src/lib/page-trails.ts`](../src/lib/page-trails.ts) | Trails admin / loading plateforme (O9) — trails métier restent marque. export type TrailCrumb = { href?: string; label: string }; export function trailForRequestLogs(): TrailCrumb[] { return [ { href: "/admin/request-logs", label: "Admin" }, { label: "Logs API / MCP" }, ]; } export function trailForAnalytics(): TrailCrumb[] { |
| [`src/lib/public-origin.ts`](../src/lib/public-origin.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/lib/server-incident.ts`](../src/lib/server-incident.ts) | Remontée d'incidents serveur (app desktop) vers le collecteur de crash. Actif si `CREEZIO_CRASH_ENDPOINT` ou `*_CRASH_ENDPOINT` (`envKey`) est injecté — no-op en déploiement web classique. H13 : plus de dual-read nommé marque. |
| [`src/lib/tab-document-url.ts`](../src/lib/tab-document-url.ts) | Comparaison d'URL « même document » pour onglets sites externes. Ignore le hash (soft-nav SPA). Normalise trailing slash sur pathname, hostname en minuscules, et aligne localhost ↔ 127.0.0.1. Dupliqué volontairement dans electron/tab-url.ts (rootDir Electron isolé). |
| [`src/lib/utils.ts`](../src/lib/utils.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/app-error-boundary.tsx`](../ui/app-error-boundary.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/data-table.tsx`](../ui/data-table.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/desktop-types.ts`](../ui/desktop-types.ts) | Types bridge desktop (SoT @creezio/shell) — re-export UI (`DesktopContentRect`, `DesktopTabLoadState`, `DesktopTabInfo`) : les composants shell-ui consomment les types bridge sans importer Electron. Inclut les types update desktop plateforme (O9). |
| [`ui/faceted-filters.tsx`](../ui/faceted-filters.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/global-search-host.ts`](../ui/global-search-host.ts) | Host marque pour GlobalSearch (dépend tab-workspace). |
| [`ui/global-search.tsx`](../ui/global-search.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/index.ts`](../ui/index.ts) | @creezio/shell-ui/ui — primitives + shell CRM UI (O9, gold TF). Consommer via `@creezio/shell-ui/ui`. |
| [`ui/kit.ts`](../ui/kit.ts) | Entrée légère client-safe (primitives + helpers desktop, sans workspace/assistant) — à préférer dans les packages kit UI. |
| [`ui/list-toolbar.tsx`](../ui/list-toolbar.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/pagination.tsx`](../ui/pagination.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/range-filters.tsx`](../ui/range-filters.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/search-input.tsx`](../ui/search-input.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `ui/desktop/`

| Fichier | Rôle |
|---|---|
| [`ui/desktop/auth-window-chrome.tsx`](../ui/desktop/auth-window-chrome.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/desktop/desktop-bridge.tsx`](../ui/desktop/desktop-bridge.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/desktop/external-site-slot.tsx`](../ui/desktop/external-site-slot.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/desktop/external-site-surface.ts`](../ui/desktop/external-site-surface.ts) | Commandes de surface native (WebContentsView) dérivées de l'onglet workspace. Pur / testable - pas d'Electron. Quitter un onglet site externe -> showCrm (masquer Chromium). Entrer / revenir sur un onglet site externe avec electronTabId -> activate. |
| [`ui/desktop/site-link.tsx`](../ui/desktop/site-link.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/desktop/window-chrome-controls.tsx`](../ui/desktop/window-chrome-controls.tsx) | Re-export — source : `src/components/workspace/window-chrome-controls.tsx`. Conservé aussi sous `desktop/` pour le chemin checklist du port shell. |

## `ui/layout/`

| Fichier | Rôle |
|---|---|
| [`ui/layout/app-shell.tsx`](../ui/layout/app-shell.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/layout/desktop-update-banner.tsx`](../ui/layout/desktop-update-banner.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/layout/entity-header.tsx`](../ui/layout/entity-header.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/layout/native-os-nav.ts`](../ui/layout/native-os-nav.ts) | Adaptateur sidebar : `defaultOsCatalogEntries()` → `SidebarNavItem[]` (icônes via `resolveNavIcon`). Fallback hors mount. `defaultOsAdminNavItems({ includePlugins })`. Chrome = `NavCatalogLoader`, pas un `OS_NAV` recopié. |
| [`ui/layout/nav-catalog-loader.tsx`](../ui/layout/nav-catalog-loader.tsx) | `<NavCatalogLoader />` — fetch `GET /api/v1/modules/nav`, bump `configureSidebar({ getNavItems })`. API publique chrome (factory importe d'ici, pas `@creezio/nav`). |
| [`ui/layout/nav-icons.ts`](../ui/layout/nav-icons.ts) | `resolveNavIcon(name)` — allowlist lucide (sidebar OS + Bot / NotebookPen). Inconnu → `Circle` + warning, pas de throw UI. |
| [`ui/layout/page-chrome.tsx`](../ui/layout/page-chrome.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/layout/page-toolbar-context.tsx`](../ui/layout/page-toolbar-context.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/layout/sandbox-banner.tsx`](../ui/layout/sandbox-banner.tsx) | Bandeau permanent en environnement sandbox (clone restaurant). Activé via APP_ENV=sandbox — jamais en prod / client. Lecture dynamique de process.env pour éviter l'inlining Next au build. |
| [`ui/layout/section-view-shell.tsx`](../ui/layout/section-view-shell.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/layout/sidebar-host.ts`](../ui/layout/sidebar-host.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/layout/sidebar.tsx`](../ui/layout/sidebar.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `ui/lib/`

| Fichier | Rôle |
|---|---|
| [`ui/lib/ai-screencast-hub.ts`](../ui/lib/ai-screencast-hub.ts) | Hub screencast des espaces IA — côté serveur Next (mémoire process). L'app desktop POSTe des frames JPEG (base64) via POST /api/v1/desktop/screencast/frame ; les spectateurs s'abonnent en SSE via GET /api/v1/tasks/screencast/:aiUserId/stream. Backpressure : on ne garde QUE la dernière frame par IA. Chaque spectateur a un slot « latest » écrasé à chaque publication ; la livraison est planifiée (setImmediate) et n'envoie que la frame la plus récente — un spectateur lent saute des frames au lieu d'accumuler une file. Singleton globalThis : survit au HMR dev, simple module en prod. |
| [`ui/lib/ai-workspace-client.ts`](../ui/lib/ai-workspace-client.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/lib/aid.ts`](../ui/lib/aid.ts) | (à documenter) |
| [`ui/lib/desktop-host.ts`](../ui/lib/desktop-host.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/lib/fleet-tracker-client.ts`](../ui/lib/fleet-tracker-client.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/lib/hermes-ui.ts`](../ui/lib/hermes-ui.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/lib/n8n-ui.ts`](../ui/lib/n8n-ui.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/lib/use-creezio-resource.tsx`](../ui/lib/use-creezio-resource.tsx) | (à documenter) |
| [`ui/lib/use-shell-ui-brand.ts`](../ui/lib/use-shell-ui-brand.ts) | (à documenter) |

## `ui/os-pages/`

| Fichier | Rôle |
|---|---|
| [`ui/os-pages/desktop-settings-page.tsx`](../ui/os-pages/desktop-settings-page.tsx) | Page OS réglages desktop (composition kit) — les marques ne font que la ré-exporter. |
| [`ui/os-pages/index.ts`](../ui/os-pages/index.ts) | Exports ciblés des surfaces UI OS (évite le barrel `/ui` qui tire workspace+assistant Node). |

## `ui/page-loading/`

| Fichier | Rôle |
|---|---|
| [`ui/page-loading/entity-page-loading.tsx`](../ui/page-loading/entity-page-loading.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/page-loading/list-page-loading.tsx`](../ui/page-loading/list-page-loading.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `ui/primitives/`

| Fichier | Rôle |
|---|---|
| [`ui/primitives/avatar.tsx`](../ui/primitives/avatar.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/badge.tsx`](../ui/primitives/badge.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/breadcrumb.tsx`](../ui/primitives/breadcrumb.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/button.tsx`](../ui/primitives/button.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/card.tsx`](../ui/primitives/card.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/chart.tsx`](../ui/primitives/chart.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/command.tsx`](../ui/primitives/command.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/dialog.tsx`](../ui/primitives/dialog.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/dropdown-menu.tsx`](../ui/primitives/dropdown-menu.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/input.tsx`](../ui/primitives/input.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/label.tsx`](../ui/primitives/label.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/resizable.tsx`](../ui/primitives/resizable.tsx) | Panneaux redimensionnables (react-resizable-panels) — layout webmail. |
| [`ui/primitives/scroll-area.tsx`](../ui/primitives/scroll-area.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/select.tsx`](../ui/primitives/select.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/separator.tsx`](../ui/primitives/separator.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/sheet.tsx`](../ui/primitives/sheet.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/skeleton.tsx`](../ui/primitives/skeleton.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/sonner.tsx`](../ui/primitives/sonner.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/tabs.tsx`](../ui/primitives/tabs.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/textarea.tsx`](../ui/primitives/textarea.tsx) | Zone de texte multi-lignes stylée kit. |
| [`ui/primitives/tooltip.tsx`](../ui/primitives/tooltip.tsx) | Tooltip Radix (provider/trigger/content). |

## `ui/pwa/`

| Fichier | Rôle |
|---|---|
| [`ui/pwa/client-error-reporter.tsx`](../ui/pwa/client-error-reporter.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/pwa/register-sw.tsx`](../ui/pwa/register-sw.tsx) | Enregistrement SW + purge des caches HTML `creezio-shell-*` (H13). |

## `ui/search/`

| Fichier | Rôle |
|---|---|
| [`ui/search/global-search-config.ts`](../ui/search/global-search-config.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/search/global-search-provider.tsx`](../ui/search/global-search-provider.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/search/search-history.ts`](../ui/search/search-history.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `ui/settings/`

| Fichier | Rôle |
|---|---|
| [`ui/settings/account-settings.tsx`](../ui/settings/account-settings.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/agent-profile-settings.tsx`](../ui/settings/agent-profile-settings.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/api-keys-settings.tsx`](../ui/settings/api-keys-settings.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/desktop-background-settings.tsx`](../ui/settings/desktop-background-settings.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/desktop-connection-settings.tsx`](../ui/settings/desktop-connection-settings.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/desktop-embed-env-panel.tsx`](../ui/settings/desktop-embed-env-panel.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/desktop-fleet-telemetry-settings.tsx`](../ui/settings/desktop-fleet-telemetry-settings.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/desktop-hermes-settings.tsx`](../ui/settings/desktop-hermes-settings.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/desktop-llm-keys.tsx`](../ui/settings/desktop-llm-keys.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/desktop-n8n-settings.tsx`](../ui/settings/desktop-n8n-settings.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/desktop-tunnel.tsx`](../ui/settings/desktop-tunnel.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/desktop-update-settings.tsx`](../ui/settings/desktop-update-settings.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/factory-reset-settings.tsx`](../ui/settings/factory-reset-settings.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/host-only-settings.tsx`](../ui/settings/host-only-settings.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/locked-config-field.tsx`](../ui/settings/locked-config-field.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/ops-diagnostic-settings.tsx`](../ui/settings/ops-diagnostic-settings.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/search-reindex-settings.tsx`](../ui/settings/search-reindex-settings.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/settings/server-mode-cards.tsx`](../ui/settings/server-mode-cards.tsx) | (à documenter) |

## `ui/theme/`

| Fichier | Rôle |
|---|---|
| [`ui/theme/tailwind-preset.cjs`](../ui/theme/tailwind-preset.cjs) | Preset Tailwind Creezio (accent orange, neutres réchauffés, variables CSS) — CJS volontaire (chargé par tailwind.config Node/jiti). |

## `ui/workspace/`

| Fichier | Rôle |
|---|---|
| [`ui/workspace/ai-activity-panel-host.tsx`](../ui/workspace/ai-activity-panel-host.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/workspace/ai-workspace-agent-host.tsx`](../ui/workspace/ai-workspace-agent-host.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/workspace/ai-workspace-banner.tsx`](../ui/workspace/ai-workspace-banner.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/workspace/impersonation-banner.tsx`](../ui/workspace/impersonation-banner.tsx) | (à documenter) |
| [`ui/workspace/keep-alive.tsx`](../ui/workspace/keep-alive.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/workspace/tab-workspace-context.tsx`](../ui/workspace/tab-workspace-context.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/workspace/tab-workspace-host.ts`](../ui/workspace/tab-workspace-host.ts) | Host marque pour le tab-workspace (nav / surfaces métier reste marque). O9 — injection ; pas de jumeau. Capacité native = ouvrir un **site externe** (onglet), pas un « fournisseur ». Les libellés métier (Fournisseur, Outil, …) = config/UI marque. |
| [`ui/workspace/types.ts`](../ui/workspace/types.ts) | Type de page CRM — standard unique. - section : listes (toolbar recherche + titre + actions sous les onglets) - entity : fiches détail (fil d'Ariane sticky ; titre via EntityHeader) |
| [`ui/workspace/use-location-search.tsx`](../ui/workspace/use-location-search.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/workspace/window-chrome-controls.tsx`](../ui/workspace/window-chrome-controls.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/workspace/workspace-config.ts`](../ui/workspace/workspace-config.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/workspace/workspace-root.tsx`](../ui/workspace/workspace-root.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/workspace/workspace-shell.tsx`](../ui/workspace/workspace-shell.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/workspace/workspace-tab-bar.tsx`](../ui/workspace/workspace-tab-bar.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
