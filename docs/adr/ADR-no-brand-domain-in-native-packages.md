# ADR — Pas de domaine métier marque dans les packages natifs

| | |
|--|--|
| **Statut** | Accepté — implémenté (2026-07-30) — contrainte d’intention post-O9 |
| **Contexte** | Extract O9 a promu du vocabulaire TempoFlow (`supplier` / `fournisseur`, panier, optimiser…) dans `@creezio/shell-ui`, `@creezio/shell`, `@creezio/electron-shell`, `@creezio/assistant` |

## Décision

Les packages `@creezio/*` **natifs** (shell, shell-ui, electron-shell, assistant plateforme, tasks UI générique) exposent des **capacités génériques**.

| Domaine | Vocabulaire kit (SoT) | Vocabulaire marque (UI / i18n / config) |
|---------|----------------------|----------------------------------------|
| Onglet site tiers | **site externe** / `external` / `siteId` / `openExternalSite` | TF : « Fournisseur » · Fidu : « Outil externe » · etc. |
| Routes métier | **aucune** en dur (`/panier`, `/optimiser`, `/fournisseurs`…) | `configureFullscreenPaths`, `configureSectionLabels`, `configureEntityRouteRoots`, `configureWorkspaceTabIcons` |
| Tools assistant desktop | **`external_*`** | Alias wire `supplier_*` dépréciés (compat TF) |

## Anti-patterns (NON done)

- ❌ Labels utilisateur « Site fournisseur », « Onglet fournisseur » dans le kit
- ❌ Types / API SoT `OpenSupplierSiteOpts`, `fournisseurId` **sans** alias générique
- ❌ Promouvoir panier / relevés / marketplaces / optimiser comme API native
- ❌ Figer le domaine TF (catalogue fournisseurs) dans un package multi-marques
- ❌ Cutover O9p qui re-copie du vocabulaire fournisseur comme contrat kit

## Compat temporaire

Alias **dépréciés** autorisés le temps du cutover marques :

- `OpenSupplierSiteOpts` → `OpenExternalSiteOpts`
- `fournisseurId` → `siteId` (miroir payload IPC)
- `onSupplierTabOpened` / `tabs:supplier-opened` → `onExternalTabOpened` / `tabs:external-opened`
- Tools `supplier_*` → `external_*` (même handlers)
- Partition Electron historique `persist:fournisseur-<id>` = **wire session** (ne pas casser les cookies TF) ; nouveau code parle `siteId`

## Hygiene P29 (partiel — aliases fermés)

Gate : `node --test scripts/test-phase-p29.mjs` (+ `test-phase-p-shell-ui.mjs`).

| Package | SoT | Alias déprécié |
|---------|-----|----------------|
| shell-ui | `OpenExternalSiteOpts` / `siteId` | `OpenSupplierSiteOpts` / `fournisseurId` |
| assistant | `EXTERNAL_SITE_TOOL_NAMES` / `siteIdFromSurfaceHref` | `SUPPLIER_TOOL_NAMES` / `fournisseurIdFromSurfaceHref` |
| tasks | wire `external_*` | `supplier_*` |
| electron-shell Meili | `BrandMeiliFeed` / `configureMeiliBrandFeed` / UIDs `catalog_*` | legacy `tf2_*` sans feed ; `configureMeiliCatalogSqlTables` |
| observability | émission `TF2EVENT` / `OPS_EVENT_PREFIX` | dual-read `CertivanEVENT` via `OPS_EVENT_PREFIXES` |

## Dettes connues (ne pas « oublier »)

- `workspace-tab-bar` : icônes métier → `configureWorkspaceTabIcons` (marque)
- `list-toolbar` : clés query TF (`fournisseur`, `promo`…) encore listées — à sortir en config marque
- `platform-tool-definitions` : exemples SQL / Meili citant `fournisseurs` (data TF) — OK en exemple doc si clairement « marque data », pas en nom d’outil
- Wire HTTP `/assistant/supplier-actions/stream` : nom historique — rename = breaking ; documenter, ne pas étendre
- Wire `activeSurface.kind: "supplier"` : alias historique — accepter aussi `"external"` ; labels = « Site externe »
- Fingerprint Meili champ `counts.fournisseurs` = nom historique (valeur = table `sites` configurée)
- Indexeur legacy `tf2_*` reste le défaut de `runIndexation()` **sans** feed (compat TF2) ; marques from-prd utilisent `catalog_*` via feed
- Commentaires « gold TempoFlow » = historique OK ; **API / labels** = générique obligatoire

## Conséquence O9p → O11

En extrayant des jumeaux, **ne pas** promouvoir du vocabulaire fournisseur / panier comme API native. Spécialiser par `configure*` / brand host / i18n marque.

## Réfs

- Incident intention : extract O9 `desktop-bridge` « Site fournisseur »
- Précédent similaire : mort de `brand-chat-tools` (ADR assistant tools MCP)
- Plan : [PLAN-O.md](PLAN-O.md) · [PHASE-O9.md](PHASE-O9.md)
