# @creezio/grokbot

## 0.26.0

### Patch Changes

- Updated dependencies [2f5b6ea]
  - @creezio/platform-core@0.26.0
  - @creezio/api-kernel@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [2da43ad]
  - @creezio/platform-core@0.25.0
  - @creezio/api-kernel@0.25.0

## 0.24.1

### Patch Changes

- @creezio/platform-core@0.24.1
- @creezio/api-kernel@0.24.1

## 0.24.0

### Patch Changes

- Updated dependencies [efc7bb5]
  - @creezio/platform-core@0.24.0
  - @creezio/api-kernel@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [ddf823d]
- Updated dependencies [bf14b35]
- Updated dependencies [b0a53b0]
  - @creezio/platform-core@0.23.0
  - @creezio/api-kernel@0.23.0

## 0.22.0

### Patch Changes

- @creezio/platform-core@0.22.0
- @creezio/api-kernel@0.22.0

## 0.21.0

### Patch Changes

- @creezio/platform-core@0.21.0
- @creezio/api-kernel@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [e6303bb]
  - @creezio/platform-core@0.20.0
  - @creezio/api-kernel@0.20.0

## 0.19.0

### Minor Changes

- 9324b6c: Deux nouveaux modules natifs hybrides (ADR-module-natif-hybride) :

  - `@creezio/granola` — connecteur Granola (AI meeting notes) : mount
    `/api/v1/modules/granola/*` avec récepteur webhook signé
    (Standard Webhooks, fail-closed dès qu'un `signingSecret` est configuré,
    dédup par `event_id`), sync des notes en brand.db via l'API publique
    (`grn_…`), `register-webhook` qui crée l'endpoint côté Granola et capture
    le `signing_secret` (retourné une seule fois), proxys
    notes/transcript/folders/webhook-endpoints, UI `GranolaClient`
    (URL webhook à copier, livraisons, notes).
  - `@creezio/grokbot` — pilotage d'agents cloud via l'API Cursor v1 :
    client REST complet (agents, runs, usage, artefacts, models,
    repositories), mount `/api/v1/modules/grokbot/*` avec token stocké côté
    serveur (masqué en GET), miroir local des agents en brand.db, cache DB
    1 h sur `repositories` (rate limit amont), ops clés publiées MCP
    (`create-agent`, `create-run`, `get-run`…), UI `GrokbotClient`
    (lancement, suivi des runs, prompts de suivi, annulation).

  UI OS : pages `/granola` et `/grokbot` (wrappers `@creezio/os-ui`) +
  entrées sidebar natives (`defaultOsPrimaryNavItems` + chrome factory
  `OS_NAV`). Après publish : `os-ui:materialize` rematérialise les pages ;
  les marques qui inlinent la nav (chrome owned-by-brand) doivent ajouter
  les deux hrefs.

  Câblage API marque : composer `granolaMigrations()` / `grokbotMigrations()`
  dans les migrations brand et enregistrer `createGranolaMount({ defaults })`
  / `createGrokbotMount({ defaults })` via `registerModuleApi`.

- 2eff636: UI GrokBot : sélecteur de dépôts (cache mount 1 h, bouton refresh + toast
  429), Select kit pour modèles et mode `agent` | `plan`, checkbox PR
  labellisée, blocs usage tokens et artefacts (download présigné via le
  mount, sans exposer le token Cursor). Split
  `grokbot-launch-form` / `grokbot-usage-artifacts` / `grokbot-agent-runs`.

  Suivi live (GROKBOT-2) : poll ciblé de l'agent ouvert (`GET agents/:id` +
  runs, 4 s si RUNNING/CREATING sinon 15 s, jamais models/repos), timeline
  (durée, result, branches/PR), follow-up Textarea kit, cancel confirmé
  (Dialog kit), filtre Archivés + `POST unarchive`, skeletons, CTA token
  manquant et message module non monté. SSE hors scope v1.

- cc2724a: Vague unique granola + grokbot + catalogue sidebar :

  - Factory **installe** `@creezio/granola`, `@creezio/grokbot` et
    `@creezio/nav` (SERVER_CREEZIO_DEPS / CLIENT_CREEZIO_DEPS /
    transpilePackages / package.json UI). Jamais les retirer pour un
    E404 pré-publish — le spawn `npm install` d'une app neuve est
    attendu KO jusqu'à `changeset publish` (publish.yml), pas un skip
    de gate.
  - Chrome factory : `<NavCatalogLoader />` depuis `@creezio/shell-ui/ui`
    (GET `/api/v1/modules/nav`) — plus de `const OS_NAV`.
  - UI Granola (notes + transcript + dossiers + santé webhook) et
    GrokBot (repos/usage/artefacts + runs live) sur cette même ligne.

### Patch Changes

- @creezio/platform-core@0.19.0
- @creezio/api-kernel@0.19.0
