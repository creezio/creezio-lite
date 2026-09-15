# @creezio/assistant

## 0.26.0

### Minor Changes

- 2f5b6ea: H13 — résidu allowlist runtime (ARCHITECTURE_VERSION H12 → H13, convention 0.x : minor comme H10/H11/H12).

  - Crash env : plus de dual-read `TF2_*` / `CERTIVAN_*` / `FIDU_*` / `TEMPOFLOW3_*` — `CREEZIO_*` + scan `envKey`.
  - `envForNodeScriptSpawn` : plus d'heuristique packagée nommée marque.
  - UI kit : `creezio-fake-cursor`, `creezio-titlebar-*`, cache SW `creezio-shell-*`.
  - Codemods `scripts/codemods/H13/` (`since: 0.26.0`), appliqués par `creezio upgrade`.

### Patch Changes

- Updated dependencies [2f5b6ea]
  - @creezio/platform-core@0.26.0
  - @creezio/shell@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [2da43ad]
  - @creezio/platform-core@0.25.0
  - @creezio/shell@0.25.0

## 0.24.1

### Patch Changes

- @creezio/shell@0.24.1
- @creezio/platform-core@0.24.1

## 0.24.0

### Patch Changes

- Updated dependencies [efc7bb5]
  - @creezio/platform-core@0.24.0
  - @creezio/shell@0.24.0

## 0.23.0

### Minor Changes

- cd50ae5: T5 / F3.4 — volet 2 du contrat de module : champs additifs `assistantSources`,
  `assistantSourcesJustification` et `onboarding` sur `BrandModuleDef`.
  Collecteurs `collectAssistantSources` / `collectOnboardingContent` dans
  `createBrandModuleRegistry` ; consommation réelle dans `@creezio/assistant`
  (`moduleSources`, `applyModuleAssistantSources`, contexte prompt +
  entitySources + toolDefinitions) et `@creezio/onboarding`
  (`composeOnboardingFromModules`, mount factory). Doctor warn
  `MODULE_ASSISTANT_SOURCES_MISSING` si un module expose une API sans sources
  ni justification. Templates factory (`brand module init`, from-prd) mis à
  jour. Pas de bump `ARCHITECTURE_VERSION` (champs optionnels).

### Patch Changes

- Updated dependencies [ddf823d]
- Updated dependencies [bf14b35]
- Updated dependencies [b0a53b0]
  - @creezio/platform-core@0.23.0
  - @creezio/shell@0.23.0

## 0.22.0

### Patch Changes

- @creezio/shell@0.22.0
- @creezio/platform-core@0.22.0

## 0.21.0

### Patch Changes

- @creezio/shell@0.21.0
- @creezio/platform-core@0.21.0

## 0.20.0

### Patch Changes

- b7d12cc: Propager cookie / Bearer de la session chat OS dans la requête synthétique des tools `module.*` — plus de 401 `requireSession` in-process.
- Updated dependencies [e6303bb]
  - @creezio/platform-core@0.20.0
  - @creezio/shell@0.20.0

## 0.19.1

### Patch Changes

- Chat OS : extraire cookie / JWT de la requête et les passer à `callTool` (tools `module.*` voient la session utilisateur, plus de 401 `requireSession` in-process).

## 0.19.0

### Patch Changes

- bf7a973: Hermes warm indépendant de n8n : `CREEZIO_NATIVE_WARM_N8N=0` ne coupe plus Work. `GET /plugin-approvals` répond 200 `[]` sans Product Hub.
  - @creezio/shell@0.19.0
  - @creezio/platform-core@0.19.0

## 0.18.0

### Patch Changes

- @creezio/shell@0.18.0
- @creezio/platform-core@0.18.0

## 0.17.1

### Patch Changes

- 27c319c: Fix OpenAI `Invalid 'tools': array too long` (plafond 128) : le chat OS n'envoie plus les alias Hermes en double, `listTools` masque les tools `enabled=0`, et le payload est dédupliqué / tronqué à 128. `callTool` et l'admin MCP restent inchangés.
  - @creezio/shell@0.17.1
  - @creezio/platform-core@0.17.1

## 0.17.0

### Patch Changes

- Updated dependencies [13c1d18]
  - @creezio/platform-core@0.17.0
  - @creezio/shell@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies [5dfc286]
  - @creezio/platform-core@0.16.0
  - @creezio/shell@0.16.0

## 0.15.0

### Patch Changes

- @creezio/shell@0.15.0
- @creezio/platform-core@0.15.0

## 0.14.0

### Patch Changes

- @creezio/shell@0.14.0
- @creezio/platform-core@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [a9e9fd7]
  - @creezio/platform-core@0.13.0
  - @creezio/shell@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [17c82b1]
  - @creezio/platform-core@0.12.0
  - @creezio/shell@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [b0856ee]
  - @creezio/platform-core@0.11.0
  - @creezio/shell@0.11.0

## 0.10.15

### Patch Changes

- @creezio/shell@0.10.15
- @creezio/platform-core@0.10.15

## 0.10.14

### Patch Changes

- @creezio/shell@0.10.14
- @creezio/platform-core@0.10.14

## 0.10.13

### Patch Changes

- @creezio/shell@0.10.13
- @creezio/platform-core@0.10.13

## 0.10.12

### Patch Changes

- @creezio/shell@0.10.12
- @creezio/platform-core@0.10.12

## 0.10.11

### Patch Changes

- @creezio/shell@0.10.11
- @creezio/platform-core@0.10.11

## 0.10.10

### Patch Changes

- Updated dependencies [4ecd205]
  - @creezio/platform-core@0.10.10
  - @creezio/shell@0.10.10

## 0.10.9

### Patch Changes

- @creezio/shell@0.10.9
- @creezio/platform-core@0.10.9

## 0.10.8

### Patch Changes

- @creezio/shell@0.10.8
- @creezio/platform-core@0.10.8

## 0.10.7

### Patch Changes

- @creezio/shell@0.10.7
- @creezio/platform-core@0.10.7

## 0.10.6

### Patch Changes

- @creezio/shell@0.10.6
- @creezio/platform-core@0.10.6

## 0.10.5

### Patch Changes

- @creezio/shell@0.10.5
- @creezio/platform-core@0.10.5

## 0.10.4

### Patch Changes

- @creezio/shell@0.10.4
- @creezio/platform-core@0.10.4

## 0.10.3

### Patch Changes

- @creezio/shell@0.10.3
- @creezio/platform-core@0.10.3

## 0.10.2

### Patch Changes

- @creezio/shell@0.10.2
- @creezio/platform-core@0.10.2

## 0.10.1

### Patch Changes

- @creezio/shell@0.10.1
- @creezio/platform-core@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [96464bc]
  - @creezio/platform-core@0.10.0
  - @creezio/shell@0.10.0

## 0.9.4

### Patch Changes

- @creezio/shell@0.9.4
- @creezio/platform-core@0.9.4

## 0.9.3

### Patch Changes

- @creezio/shell@0.9.3
- @creezio/platform-core@0.9.3

## 0.9.2

### Patch Changes

- @creezio/shell@0.9.2
- @creezio/platform-core@0.9.2

## 0.9.1

### Patch Changes

- @creezio/shell@0.9.1
- @creezio/platform-core@0.9.1

## 0.9.0

### Patch Changes

- @creezio/shell@0.9.0
- @creezio/platform-core@0.9.0

## 0.8.1

### Patch Changes

- @creezio/shell@0.8.1
- @creezio/platform-core@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies [848ec06]
  - @creezio/platform-core@0.8.0
  - @creezio/shell@0.8.0

## 0.7.1

### Patch Changes

- @creezio/shell@0.7.1
- @creezio/platform-core@0.7.1

## 0.7.0

### Patch Changes

- @creezio/shell@0.7.0
- @creezio/platform-core@0.7.0

## 0.6.0

### Patch Changes

- @creezio/shell@0.6.0
- @creezio/platform-core@0.6.0

## 0.5.0

### Patch Changes

- d674c86: Peers internes @creezio/\* en `>=0.4.0` (au lieu de `^0.4.0`) : ?vite que le
  train lockstep escalade en 1.0.0 au premier bump minor (les peers restent
  satisfaits par toute version future du kit).
- Updated dependencies [d674c86]
  - @creezio/platform-core@0.5.0
  - @creezio/shell@0.5.0
