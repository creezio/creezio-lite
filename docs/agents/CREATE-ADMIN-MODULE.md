# CREATE-ADMIN-MODULE — créer un module d'app admin (`@creezio/admin`)

Guide pour ajouter un module natif aux **apps admin de marque** (l'OS qui
gère l'entreprise de la marque — ADR
[ADR-admin-app-os](../adr/ADR-admin-app-os.md)). Modèles vivants :
`fleet-registry` (migration `admin_004`) et `fleet-releases`
(`admin_005`) dans `packages/admin/src/`.

Un module admin = **kit** (package `@creezio/admin`, zéro domaine marque)
consommé par l'app admin de chaque marque (repo `<brand>-admin`).

## 0. Spec 5 fichiers (standard module)

Chaque module admin natif a son dossier spec `packages/admin/modules/<id>/`
(`prd.md`, `interview.md`, `TODO.md`, `CHANGELOG.md`, `gate.mjs`) — contrat
[DOC-STANDARD-MODULE.md](../DOC-STANDARD-MODULE.md), vérifié par la gate
`test-phase-module-docs`. Un module **propre à un repo admin** (pas kit) vit
dans `<brand>-admin/admin-spec/modules/<id>/` — scaffold :
`creezio brand module init <id> --app <brand>-admin` (détecte `admin-spec/`).
Remplir prd + interview AVANT d'implémenter ; claim des tâches TODO dans le
même commit que la première modif.

## Patron en 4 pièces

### 1. Migration `admin_00X`

Dans `packages/admin/src/` (ou le fichier du module) : exporter
`ADMIN_SCHEMA_00X_SQL` et l'ajouter à `adminMigrations()`
(`src/index.ts`) avec un id stable :

```ts
export function adminMigrations(): SqliteMigration[] {
  return [
    // …
    { id: "admin_006_mon_module", sql: ADMIN_SCHEMA_006_SQL },
  ];
}
```

Tables préfixées `admin_*`, dans la **brand.db de l'app admin** (l'app
admin est une app Creezio normale — `adminMigrations()` passe en
`brandMigrations`).

### 2. Mount API

Exporter `create<MonModule>Mount(opts): ApiMount` (couche `brand`) **avec
`operations[]`** (même contrat métier : 1 capacité = 1 op) et
l'enregistrer dans `registerAdminModules(api, opts)` → route
`/api/v1/modules/<id>/*`. Deux postures d'auth, à choisir explicitement :

- **session admin** (CRUD opéré depuis l'UI) — posture des modules
  existants ;
- **Bearer machine-to-machine** (serveurs/agents de la flotte) — comme
  `fleet-registry` (`POST register` Bearer secret partagé, `POST heartbeat`
  Bearer serverKey hashé) et `fleet-releases` (Bearer `hostId:agentToken`
  vérifié via le backend flotte `POST /admin/api/hosts/verify` + cache).
  Secrets : jamais en clair en DB (hash sha256 ou chiffrement AES-GCM via
  `@creezio/integrations`).

Pour un module CRUD simple : `createAdminCrudMount` existe déjà
(prospects/roadmap/clients).

### 3. UI

Client React dans `packages/admin/ui/` (TS brut, compilé par l'app Next
consommatrice), exporté par `ui/index.ts` — labels/naming côté marque.
La page de l'app admin (`server/ui/app/<route>/page.tsx` du repo
`<brand>-admin`) ne fait qu'importer le client.

### 4. Gate

`scripts/test-phase-admin-<module>.mjs` (modèles :
`test-phase-admin-fleet-registry.mjs`, `test-phase-fleet-releases.mjs`,
`test-phase-admin-billing.mjs`) — enregistrée dans la ligne `test` du
`package.json` racine (une gate non listée n'est jamais exécutée).

## Frontières

- **Zéro domaine marque** dans `@creezio/admin` (« restaurants » = config
  de l'app admin, pas du kit).
- Ne pas recréer la logique Docker/flotte : la SoT des gestes reste le
  backend flotte (`@creezio/fleet`, `packages/fleet/src/server-admin.ts`)
  — un module admin le **consomme** (proxy `fleet`) ou matérialise une vue
  (`fleet-registry` : la DB est une vue, les JSON restent la SoT).
- Ne pas exposer les secrets backend (Basic flotte) au client : proxys
  server-side uniquement.

## Déploiement (app admin TempoFlow)

Après modification kit : build + changeset + merge `main` → publication npm,
puis `npm update "@creezio/*"` dans le repo admin et rebuild/recreate du
conteneur — procédure canonique dans l'AGENTS du repo `tempoflow3-admin`.

## Checklist finale

- [ ] Spec 5 fichiers `packages/admin/modules/<id>/` remplie (gate
      `test-phase-module-docs` verte)
- [ ] UI composée des composants du kit graphique
      ([DOC-STANDARD-UI.md](../DOC-STANDARD-UI.md))
- [ ] Migration `admin_00X` ajoutée à `adminMigrations()` (id stable)
- [ ] Mount enregistré dans `registerAdminModules` + posture d'auth choisie
- [ ] UI dans `packages/admin/ui/` + export `ui/index.ts`
- [ ] Gate créée et enregistrée dans la ligne `test` racine
- [ ] README/AGENTS/FILES de `packages/admin` à jour
      (`node scripts/generate-files-md.mjs admin`)
- [ ] `npm update "@creezio/*"` du repo `<brand>-admin` après publication, rebuild+recreate
