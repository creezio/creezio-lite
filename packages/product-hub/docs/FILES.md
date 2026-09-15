# packages/product-hub — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs product-hub` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/acl.ts`](../src/acl.ts) | ACL plugins — contrats L3 (org/tenant) et L4 (user) — H5 durci. Port du modèle Certivan/TF2 `plugin_acl` (L4) + extension kit L3 (org). FAIL-CLOSED : sans grant explicite, seul l'owner (ou clé service) voit. H5 : capacités `see` / `install` / `execute` + deny cross-org. Persistance SQL = vertical (apps) ; ce module reste pur. |
| [`src/brand-tokens.ts`](../src/brand-tokens.ts) | Jetons Product Hub dérivés de AppManifest — zéro hardcode TEMPOFLOW_/CERTIVAN_. |
| [`src/clarifications.ts`](../src/clarifications.ts) | Clarifications structurées — interview itérative Product Hub. |
| [`src/grants-flow.ts`](../src/grants-flow.ts) | Flux execution_grant après validation PRD — logique brand-agnostic. |
| [`src/host-api.ts`](../src/host-api.ts) | API Product Hub côté app (Next / CRM) — logique hors façade marque. La marque ne garde que le câblage store + env pluginsDir. |
| [`src/impact.ts`](../src/impact.ts) | Rapport d'impact — logique pure (evidence injectée, pas de FS/DB hardcodés). |
| [`src/index.ts`](../src/index.ts) | @creezio/product-hub — Product Hub / plugins brand-agnostic (Phase E / P09). Contrats purs + store + control plane + routes HTTP `/plugin-products` + n8n provisioning + fabrique conversationnelle. UI Admin via `./ui` ; scaffolds git / test-runner restent verticaux. |
| [`src/lifecycle.ts`](../src/lifecycle.ts) | Machine d'état Product Hub — contrats purs (TF2/Certivan plugin-product-hub). |
| [`src/managed-marker.ts`](../src/managed-marker.ts) | Marqueur plugins gérés par Product Hub (migration douce). |
| [`src/n8n-provisioning.ts`](../src/n8n-provisioning.ts) | Provisioning n8n plugins — SoT kit (tags + registre SQLite). Config marque : préfixe tag, managedBy, modeLabel, credentials. |
| [`src/n8n-tags.ts`](../src/n8n-tags.ts) | Tags n8n génériques — préfixe depuis AppManifest / ProductHubBrandTokens. n8n 2.29 limite les tags à 24 caractères. |
| [`src/prd.ts`](../src/prd.ts) | Contrats PRD étendu — sections structurées obligatoires. |
| [`src/schema-sql.ts`](../src/schema-sql.ts) | DDL SQL Product Hub — à exécuter par les migrations verticales des apps. Le kit n'embarque pas better-sqlite3 ; il expose le contrat SQL. |

## `src/admin/`

| Fichier | Rôle |
|---|---|
| [`src/admin/plugin-acl-admin.ts`](../src/admin/plugin-acl-admin.ts) | Admin Plugins L3 — opérations CRUD binding + caps (Phase I5). UI-agnostique : consommé par demobrand / console / marques. |

## `src/control-plane/`

| Fichier | Rôle |
|---|---|
| [`src/control-plane/acl-from-store.ts`](../src/control-plane/acl-from-store.ts) | Helper I4 — construire `PluginControlPlaneAcl` depuis un store Product Hub (sqlite ou mémoire enrichi). Chemin unique recommandé pour demobrand / marques. |
| [`src/control-plane/acl-service-key.ts`](../src/control-plane/acl-service-key.ts) | Compat Hermes / E2E : Bearer sans headers actor → clé service. |
| [`src/control-plane/handler.ts`](../src/control-plane/handler.ts) | Handler HTTP control plane plugins — patterns génériques TF2/Certivan. Bind 127.0.0.1 recommandé. Auth Bearer + grants Product Hub. H5 : ACL L3 see/install/execute + deny cross-org (si `opts.acl`). |
| [`src/control-plane/http-utils.ts`](../src/control-plane/http-utils.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/control-plane/server.ts`](../src/control-plane/server.ts) | Serveur HTTP loopback control plane — factory brand-agnostic. |
| [`src/control-plane/types.ts`](../src/control-plane/types.ts) | Contrats control plane plugins HTTP (loopback) — brand-agnostic. |

## `src/factory/`

| Fichier | Rôle |
|---|---|
| [`src/factory/draft-prd.ts`](../src/factory/draft-prd.ts) | Brouillon PRD déterministe depuis une intention (+ réponses clarifications). Pas d'appel LLM — preuve kit / sandbox ; les marques peuvent remplacer. |
| [`src/factory/fs-adapters.ts`](../src/factory/fs-adapters.ts) | Adapters FS génériques pour scaffold / writeFiles (control-plane compatible). |
| [`src/factory/index.ts`](../src/factory/index.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/factory/prd-drafter.ts`](../src/factory/prd-drafter.ts) | PrdDrafter pluggable (C3) — déterministe par défaut, LLM optionnel. Sans clé / sans complete injecté → `draftPrdFromIntention` (zéro réseau). Avec `CREEZIO_PRD_LLM_API_KEY` + URL (ou `complete` de test) → tente LLM, fallback déterministe si échec / JSON invalide. |
| [`src/factory/scaffold-files.ts`](../src/factory/scaffold-files.ts) | Fichiers scaffold plugin réels générés depuis un PRD (C3 — plus de stub console.log-only). |
| [`src/factory/session.ts`](../src/factory/session.ts) | Orchestrateur fabrique plugins conversationnelle (V1). Flux : intention → analyse (impact) → [clarification] → PRD → approve → scaffold + openPlugin (adapter) → tools MCP space plugin (runtime marque). |
| [`src/factory/slug.ts`](../src/factory/slug.ts) | Dérive un plugin_id valide depuis une intention textuelle. |
| [`src/factory/types.ts`](../src/factory/types.ts) | Contrats fabrique plugins conversationnelle (vision V1). |

## `src/http/`

| Fichier | Rôle |
|---|---|
| [`src/http/plugin-factory-routes.ts`](../src/http/plugin-factory-routes.ts) | Routes Hono fabrique conversationnelle — intention → PRD → scaffold. Port demobrand `createPluginFactoryApiMount` → Hono pour marques TF/CV. Montage typique : api.route("/plugin-factory", createPluginFactoryRoutes({ factory, getActor })) |
| [`src/http/plugin-products-routes.ts`](../src/http/plugin-products-routes.ts) | Routes Hono Product Hub `/plugin-products` — SoT kit (gold TempoFlow). Auth outer (session/API key) reste côté marque au montage. |

## `src/plugin-ui/`

| Fichier | Rôle |
|---|---|
| [`src/plugin-ui/brand.ts`](../src/plugin-ui/brand.ts) | Tokens marque pour admin plugins UI / desktop API (N6). |
| [`src/plugin-ui/helpers.ts`](../src/plugin-ui/helpers.ts) | Ouverture panel plugin / sidebar items (port TempoFlow — N6). |
| [`src/plugin-ui/index.ts`](../src/plugin-ui/index.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `src/store/`

| Fichier | Rôle |
|---|---|
| [`src/store/brand-bindings.ts`](../src/store/brand-bindings.ts) | Bindings marque — singleton store core.db + ACL control-plane. |
| [`src/store/cached-accessor.ts`](../src/store/cached-accessor.ts) | Accessor Next/CRM — singleton store core.db + migrate legacy one-shot. |
| [`src/store/memory-store.ts`](../src/store/memory-store.ts) | Store Product Hub en mémoire — sandbox DemoBrand + tests kit. Les apps prod utilisent SQLite (vertical) en implémentant ProductHubStore. |
| [`src/store/migrate-legacy.ts`](../src/store/migrate-legacy.ts) | Migration one-shot brand.db → core.db (Product Hub). Copie ids conservés ; pas de dual-write ensuite. |
| [`src/store/sqlite-driver.ts`](../src/store/sqlite-driver.ts) | Driver SQLite minimal pour Product Hub (H1.8). Compatible better-sqlite3 et node:sqlite DatabaseSync. Note : pas d'`import.meta` — le dual-build CJS (Electron) l'interdit. |
| [`src/store/sqlite-store.ts`](../src/store/sqlite-store.ts) | Store Product Hub persisté dans sqlite **core** (Phase H1.8). |
| [`src/store/types.ts`](../src/store/types.ts) | Contrat store Product Hub — implémentations : mémoire (kit) / SQLite (apps). |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/host-managed-notice.tsx`](../ui/host-managed-notice.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/index.ts`](../ui/index.ts) | Admin Plugins UI (port TempoFlow — N6). Consommer via `@creezio/product-hub/ui`. |
| [`ui/plugin-detail.tsx`](../ui/plugin-detail.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/plugins-list.tsx`](../ui/plugins-list.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/tab-workspace-shim.tsx`](../ui/tab-workspace-shim.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `ui/primitives/`

| Fichier | Rôle |
|---|---|
| [`ui/primitives/badge.tsx`](../ui/primitives/badge.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/button.tsx`](../ui/primitives/button.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/card.tsx`](../ui/primitives/card.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/cn.ts`](../ui/primitives/cn.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/input.tsx`](../ui/primitives/input.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/tabs.tsx`](../ui/primitives/tabs.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
