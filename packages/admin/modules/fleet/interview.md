# Interview module fleet

> **AVERTISSEMENT — document de rétro-ingénierie** (généré par agent,
> commit `8ca1821`, 2026-08-06). Ce fichier décrit le produit **tel
> qu'il est codé** ; ce n'est PAS un brief produit ni un journal de
> décisions. INTERDIT d'y ajouter une « décision » pour justifier du
> code nouveau : toute évolution de comportement exige une validation
> explicite du propriétaire, et ce fichier n'est mis à jour qu'APRÈS
> merge, en miroir du code réel.

## 1. Identité & pages

- id : `fleet` ; titre : « Flotte (proxy backend) ».
- Module **natif kit** (`@creezio/admin`), monté par les apps admin de
  marque sous `/api/v1/modules/fleet`.
- Pas de route UI propre : le client `FleetAdminClient` (exporté par
  `@creezio/admin/ui`) est matérialisé par l'app admin (TempoFlow :
  `/flotte`, nav `brand.flotte`). Permission = session OS admin (garde F3 :
  le kernel protège les `/api/v1/modules/*` par défaut, sauf allowlist
  explicite — webhook Stripe signé, register/heartbeat Bearer, plan agents
  releases, `POST maintenance`, landing ; SoT
  `packages/app-runtime/src/module-mount-auth.ts`).

## 2. Données & migrations

- **Aucune table.** Le module est stateless ; les JSON du backend flotte
  restent la SoT des gestes.
- IDs de migration historiques du package (`admin_001_native_modules` …
  `admin_005_fleet_releases`) : **intouchables**. Toute nouvelle migration
  de ce module (aucune prévue) serait `mod_fleet_00N_<slug>`.
- Migrations cross-module interdites.

## 3. API

- Mount **manuscrit** (`createFleetAdminMount`) — justification : ce n'est
  pas un CRUD, c'est un reverse-proxy attrape-tout (méthode + query + body
  relayés) ; `createEntityApiMount` n'a pas de sens ici.
- Options `FleetAdminMountOptions` : `backendUrl` (défaut env
  `CREEZIO_FLEET_BACKEND_URL` puis `http://127.0.0.1:18800`), `basic`
  (défaut env `CREEZIO_FLEET_BACKEND_BASIC`), `timeoutMs` (défaut 30 000).
- Helper server-side `fleetFetch(opts, method, subPath, body?, timeoutMs=8000)`
  partagé avec `support`, `fleet-registry`, `fleet-releases`.
- Décision de sécurité structurante : le Basic est ajouté **côté serveur
  admin uniquement** — jamais renvoyé, jamais loggé, jamais exposé au client
  (règle « Ne pas faire » du package).

## 4. UI, nav & permissions — kit graphique imposé

- Pas de page propre. Le plan gestes de `/flotte` est rendu par
  `FleetAdminClient` (voir interviews fleet-registry §4 et fleet-releases §4
  pour l'inventaire complet des composants).
- Composants réellement importés par `fleet-admin-client.tsx` : `Badge`,
  `Button`, `Card`, `Input` depuis `@creezio/shell-ui/ui/kit` (import direct
  kit — normal pour un package natif, les apps consommatrices utilisent les
  re-exports `@/components/ui/*`).
- Écarts constatés (tracés en dette, TODO.md) : `window.prompt/confirm/alert`
  pour update/suppression au lieu de `dialog`, `<select>` HTML brut pour le
  choix de marque, classes couleur ad hoc (`text-emerald-400`…).

## 5. Tools MCP & policies

Aucun tool MCP. Aucune policy.

## 6. Rôles & permissions

- Session OS de l'app admin requise (kernel). Pas de granularité par rôle
  dans le module : tout utilisateur connecté à l'app admin (repo privé,
  opérateurs marque uniquement) peut piloter la flotte.
- Le Basic backend est un secret d'infrastructure (généré dans
  `docker-data/server-admin.json` de l'app admin), pas un credential
  utilisateur.

## 7. Meili / n8n / plugins

Aucun index Meili, aucun workflow n8n, aucune interaction plugin.

## 8. Seeds & onboarding

Aucun.

## 9. Gates de validation

- Pas de gate kit dédiée au proxy (dette FLEET-1). Couverture indirecte :
  - `scripts/test-phase-factory-two-repos.mjs` : le scaffold factory d'une
    app admin référence `createFleetAdminMount` dans
    `brand-module-api.ts` ;
  - `scripts/test-phase-admin-fleet-registry.mjs` et
    `scripts/test-phase-fleet-releases.mjs` exercent `fleetFetch` contre un
    mock HTTP Basic (401 sans Basic correct).

## 10. i18n

Libellés et messages d'erreur serveur en **français** (convention package
admin). Le naming métier (« restaurants »…) vient des labels de l'app admin
consommatrice, jamais du kit.
