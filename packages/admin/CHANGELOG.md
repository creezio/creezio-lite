# @creezio/admin

## 0.26.0

### Patch Changes

- Updated dependencies [cff3d24]
- Updated dependencies [2f5b6ea]
  - @creezio/fleet@0.26.0
  - @creezio/platform-core@0.26.0
  - @creezio/api-kernel@0.26.0
  - @creezio/integrations@0.26.0

## 0.25.0

### Patch Changes

- Updated dependencies [2da43ad]
  - @creezio/platform-core@0.25.0
  - @creezio/integrations@0.25.0
  - @creezio/api-kernel@0.25.0
  - @creezio/fleet@0.25.0

## 0.24.1

### Patch Changes

- Updated dependencies [465aa62]
  - @creezio/fleet@0.24.1
  - @creezio/platform-core@0.24.1
  - @creezio/api-kernel@0.24.1
  - @creezio/integrations@0.24.1

## 0.24.0

### Patch Changes

- Updated dependencies [efc7bb5]
  - @creezio/platform-core@0.24.0
  - @creezio/api-kernel@0.24.0
  - @creezio/integrations@0.24.0
  - @creezio/fleet@0.24.0

## 0.23.0

### Minor Changes

- 40e40c7: T4 — suppression du hop HTTP artisanal admin → backend flotte : le contrat
  client du backend (`server-admin-client.ts`) vit désormais dans
  `@creezio/fleet` (résolution env `CREEZIO_FLEET_BACKEND_URL`/`_BASIC`,
  `fleetBackendFetch` Basic, helpers typés `fetchFleetBackendServers` /
  `verifyFleetHostCredential`), et `@creezio/admin` l'importe directement —
  `fleet-registry` (sync/poller) et `fleet-releases` (vérif credential agents)
  n'ont plus de fetch HTTP re-déclaré à la main ; `fleetFetch` (export
  conservé) délègue au client. Comportement identique : transport HTTP Basic
  loopback conservé (backend flotte = container séparé, seul détenteur du
  socket Docker et de `fleet-hosts.json`), serveur HTTP server-admin intact
  pour les host-agents distants (protocole v1, header
  `x-creezio-fleet-protocol` inchangé).

### Patch Changes

- Updated dependencies [ddf823d]
- Updated dependencies [40e40c7]
- Updated dependencies [bf14b35]
- Updated dependencies [b0a53b0]
  - @creezio/platform-core@0.23.0
  - @creezio/fleet@0.23.0
  - @creezio/api-kernel@0.23.0
  - @creezio/integrations@0.23.0

## 0.22.0

### Patch Changes

- @creezio/platform-core@0.22.0
- @creezio/api-kernel@0.22.0
- @creezio/fleet@0.22.0
- @creezio/integrations@0.22.0

## 0.21.0

### Patch Changes

- Updated dependencies [247aa2b]
- Updated dependencies [60683cf]
  - @creezio/fleet@0.21.0
  - @creezio/platform-core@0.21.0
  - @creezio/api-kernel@0.21.0
  - @creezio/integrations@0.21.0

## 0.20.0

### Minor Changes

- ac7035c: Retrait des wrappers de compat fleet-collector (dette 0.16, BACKLOG) :

  - `@creezio/observability` : suppression des 7 wrappers `.mjs`
    (`admin-docker`, `server-lib`, `instance-stack`, `agent-updates`,
    `registry-pull-proxy`, `server-admin`, `host-agent`) et du bin npm
    `creezio-server-admin` — la SoT flotte est `@creezio/fleet`
    (`packages/fleet/dist`). Le collector télémétrie (`server.mjs`,
    `ops-api.mjs`, `env.mjs`) reste inchangé.
  - `@creezio/factory` : le CLI `server-docker` (`importInstanceStack`,
    imports `server-lib` de backup/update/migrate-stack) pointe directement
    sur `packages/fleet/dist` (fail-closed si dist absent).
  - `@creezio/fleet` : protocole flotte v1 **strict** —
    `FLEET_PROTOCOL_ACCEPT_MISSING=false` (politique F4.4d). Pas de bump v2 :
    le format filaire est inchangé ; vérifié via l'API flotte que tous les
    composants déployés (host-agents enrôlés inclus) annoncent déjà v1.
  - `@creezio/admin` : le mount `fleet-releases` pose désormais le header
    `x-creezio-fleet-protocol` sur toutes ses réponses (la boucle pull des
    agents le vérifie — strict en 0.19) ; nouvelle dépendance
    `@creezio/fleet`.

### Patch Changes

- Updated dependencies [ac7035c]
- Updated dependencies [e6303bb]
  - @creezio/fleet@0.20.0
  - @creezio/platform-core@0.20.0
  - @creezio/api-kernel@0.20.0
  - @creezio/integrations@0.20.0

## 0.19.0

### Patch Changes

- @creezio/platform-core@0.19.0
- @creezio/api-kernel@0.19.0
- @creezio/integrations@0.19.0

## 0.18.0

### Minor Changes

- 7c40c12: Permissions par module dans le mode admin (P4) — dette BACKLOG « Rôles/permissions mode admin ».

  - **access-control** : overrides PAR COMPTE (`access_user_overrides` dans core.db) — `allow` ajoute, `deny` retire, priorité sur le rôle et ses overrides. `resolvePermissions` les applique, `GET /users` expose `roleBaseline`/`overrides`, nouvelle route `PUT /users/:id/permissions` (`{ changes: [{ permission, effect: allow|deny|inherit }] }`, audit `user.override.set|clear`), UI « Rôles & accès » onglet Comptes : éditeur tri-état par compte.
  - **admin** : chaque mount déclare sa permission de module (`ADMIN_MODULE_PERMISSIONS` — `nav.fleet`, `nav.support`, `nav.prospects`, `nav.roadmap`, `nav.billing`, `nav.clients`, `nav.landing`), gardée fail-closed par `authorizeModuleAccess` (owner bypass). Routes machine préservées SANS permission session : webhook Stripe signé, `register`/`heartbeat`, `next`/`slots`/`report`/`maintenance` (host-agent v1 intact) + variantes multi-segments des ids serveurs non encodés. Preset `adminAccessControlPreset()` (politique de migration SANS lockout : collaborateur = tous les modules par défaut, l'owner restreint ensuite) + `adminAccessPermissionGroups()`. Nouvel export UI `AdminModuleGate` : état explicite « Accès refusé » en URL directe.
  - **landing** : `createLandingMount({ permission })` opt-in — édition gardée (settings/sections/media), `GET /public` reste anonyme.
  - **factory** : `scaffoldAdminApp` génère `brand-platform-bindings.ts` (preset access-control) + pages modules avec `AdminModuleGate` + nav avec permissions ; `ProductEntity.permission`/`ProductPage.permission` threadés sur les `EntitySpec` et la nav des modules générés ; nouveau geste `creezio server-docker access <nom> --user <email> [--grant p,…] [--revoke p,…] [--reset] [--role id|none]` (bootstrap sans UI, écrit core.db + audit, cohérent ensure-owner).
  - **shell-ui** : bypass owner explicite dans le filtre de nav (`hasItemPermission`) — même règle que la garde API.
  - **search** : fix master key Meili — une clé base64url commençant par `-` cassait le parsing CLI (`unexpected argument`), boot flaky ; génération hex + régénération des clés à tiret initial.

### Patch Changes

- @creezio/platform-core@0.18.0
- @creezio/api-kernel@0.18.0
- @creezio/integrations@0.18.0

## 0.17.1

### Patch Changes

- @creezio/platform-core@0.17.1
- @creezio/api-kernel@0.17.1
- @creezio/integrations@0.17.1

## 0.17.0

### Minor Changes

- b25b823: P3.b — rollout npm flotte-wide : `buildAllBrandPrPayloads` branché sur le
  workflow réel `propagate.yml` (canaux marque data-driven, `brandId` libre,
  PR de bump automatique avec rapport d'impact) ; heartbeat flotte enrichi
  `kitVersion` + `architectureVersion` (champs additifs, protocole v1
  dual-accept) ; registre admin `admin_fleet_servers` : colonnes
  `kit_version` / `architecture_version` (migration `admin_006`) exposées via
  l'API fleet et badge UI — « quelle version tourne où ».

### Patch Changes

- Updated dependencies [13c1d18]
  - @creezio/platform-core@0.17.0
  - @creezio/api-kernel@0.17.0
  - @creezio/integrations@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies [5dfc286]
  - @creezio/api-kernel@0.16.0
  - @creezio/platform-core@0.16.0
  - @creezio/integrations@0.16.0

## 0.15.0

### Patch Changes

- @creezio/platform-core@0.15.0
- @creezio/api-kernel@0.15.0
- @creezio/integrations@0.15.0

## 0.14.0

### Patch Changes

- @creezio/platform-core@0.14.0
- @creezio/api-kernel@0.14.0
- @creezio/integrations@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [a9e9fd7]
  - @creezio/platform-core@0.13.0
  - @creezio/api-kernel@0.13.0
  - @creezio/integrations@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies [17c82b1]
  - @creezio/platform-core@0.12.0
  - @creezio/api-kernel@0.12.0
  - @creezio/integrations@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [b0856ee]
  - @creezio/platform-core@0.11.0
  - @creezio/api-kernel@0.11.0
  - @creezio/integrations@0.11.0

## 0.10.15

### Patch Changes

- @creezio/platform-core@0.10.15
- @creezio/api-kernel@0.10.15
- @creezio/integrations@0.10.15

## 0.10.14

### Patch Changes

- @creezio/platform-core@0.10.14
- @creezio/api-kernel@0.10.14
- @creezio/integrations@0.10.14

## 0.10.13

### Patch Changes

- Updated dependencies [e07d2cf]
  - @creezio/api-kernel@0.10.13
  - @creezio/platform-core@0.10.13
  - @creezio/integrations@0.10.13

## 0.10.12

### Patch Changes

- Updated dependencies [0823798]
  - @creezio/api-kernel@0.10.12
  - @creezio/platform-core@0.10.12
  - @creezio/integrations@0.10.12

## 0.10.11

### Patch Changes

- @creezio/platform-core@0.10.11
- @creezio/api-kernel@0.10.11
- @creezio/integrations@0.10.11

## 0.10.10

### Patch Changes

- Updated dependencies [4ecd205]
  - @creezio/platform-core@0.10.10
  - @creezio/api-kernel@0.10.10
  - @creezio/integrations@0.10.10

## 0.10.9

### Patch Changes

- @creezio/platform-core@0.10.9
- @creezio/api-kernel@0.10.9
- @creezio/integrations@0.10.9

## 0.10.8

### Patch Changes

- Updated dependencies [a2fea46]
  - @creezio/api-kernel@0.10.8
  - @creezio/platform-core@0.10.8
  - @creezio/integrations@0.10.8

## 0.10.7

### Patch Changes

- Updated dependencies [55b1cd5]
  - @creezio/api-kernel@0.10.7
  - @creezio/platform-core@0.10.7
  - @creezio/integrations@0.10.7

## 0.10.6

### Patch Changes

- Updated dependencies [1c7ec66]
  - @creezio/api-kernel@0.10.6
  - @creezio/platform-core@0.10.6
  - @creezio/integrations@0.10.6

## 0.10.5

### Patch Changes

- @creezio/platform-core@0.10.5
- @creezio/api-kernel@0.10.5
- @creezio/integrations@0.10.5

## 0.10.4

### Patch Changes

- @creezio/platform-core@0.10.4
- @creezio/api-kernel@0.10.4
- @creezio/integrations@0.10.4

## 0.10.3

### Patch Changes

- @creezio/platform-core@0.10.3
- @creezio/api-kernel@0.10.3
- @creezio/integrations@0.10.3

## 0.10.2

### Patch Changes

- @creezio/platform-core@0.10.2
- @creezio/api-kernel@0.10.2
- @creezio/integrations@0.10.2

## 0.10.1

### Patch Changes

- @creezio/platform-core@0.10.1
- @creezio/api-kernel@0.10.1
- @creezio/integrations@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [96464bc]
  - @creezio/platform-core@0.10.0
  - @creezio/api-kernel@0.10.0
  - @creezio/integrations@0.10.0

## 0.9.4

### Patch Changes

- @creezio/platform-core@0.9.4
- @creezio/api-kernel@0.9.4
- @creezio/integrations@0.9.4

## 0.9.3

### Patch Changes

- @creezio/platform-core@0.9.3
- @creezio/api-kernel@0.9.3
- @creezio/integrations@0.9.3

## 0.9.2

### Patch Changes

- @creezio/platform-core@0.9.2
- @creezio/api-kernel@0.9.2
- @creezio/integrations@0.9.2

## 0.9.1

### Patch Changes

- @creezio/platform-core@0.9.1
- @creezio/api-kernel@0.9.1
- @creezio/integrations@0.9.1

## 0.9.0

### Patch Changes

- @creezio/integrations@0.9.0
- @creezio/platform-core@0.9.0
- @creezio/api-kernel@0.9.0

## 0.8.1

### Patch Changes

- @creezio/platform-core@0.8.1
- @creezio/api-kernel@0.8.1
- @creezio/integrations@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies [848ec06]
  - @creezio/api-kernel@0.8.0
  - @creezio/platform-core@0.8.0
  - @creezio/integrations@0.8.0

## 0.7.1

### Patch Changes

- @creezio/platform-core@0.7.1
- @creezio/api-kernel@0.7.1
- @creezio/integrations@0.7.1

## 0.7.0

### Patch Changes

- @creezio/platform-core@0.7.0
- @creezio/api-kernel@0.7.0
- @creezio/integrations@0.7.0

## 0.6.0

### Patch Changes

- @creezio/integrations@0.6.0
- @creezio/platform-core@0.6.0
- @creezio/api-kernel@0.6.0

## 0.5.0

### Patch Changes

- d674c86: Peers internes @creezio/\* en `>=0.4.0` (au lieu de `^0.4.0`) : ?vite que le
  train lockstep escalade en 1.0.0 au premier bump minor (les peers restent
  satisfaits par toute version future du kit).
- Updated dependencies [d674c86]
  - @creezio/integrations@0.5.0
  - @creezio/platform-core@0.5.0
  - @creezio/api-kernel@0.5.0
