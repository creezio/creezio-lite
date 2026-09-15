# Propagation — contrat kit → marques

Comment un changement du kit atteint les marques (TempoFlow, Certivan,
Fidu, TempoFlow3…), et comment les innovations terrain remontent.


> **EN VIGUEUR (depuis 2026-08-10) — distribution npm versionnée.** Les
> packages `@creezio/*` sont publiés sur GitHub Packages en versions semver
> lockstep ([NPM-DISTRIBUTION.md](./NPM-DISTRIBUTION.md)) ; les apps
> consomment via `npm update "@creezio/*"`. Le mécanisme vendor historique
> (sync `vendor/creezio`, `SYNC.json`, workflows `kit-compat`/`vendor-update`)
> est **SUPPRIMÉ** — voir `docs/archive/` pour l'historique.
## Modèle

```
L1 cœur (@creezio/*)
  ↓ descente (release npm + `npm update` marque)
L2 produit métier (marques)
  ↓
L3 organisation cliente (plugins / ACL org)
  ↓
L4 utilisateur (plugins personnels)
  ↑ remontée innovations terrain
```

## Chemin nominal — modèle PULL (écosystème fermé)

Le kit est distribué en **registre privé** (décision actée 2026-08-10 :
écosystème fermé assumé — toute installation exige un PAT `read:packages`
de l'org, cf. README). Il peut avoir 100+ apps consommatrices au sein de
l'org. **Le kit ne connaît pas ses
consommateurs** — pas de registre, pas de notification, pas de test des
apps dans la CI kit. La propagation est à l'initiative de CHAQUE app
(gouvernance complète : [CONTRIBUTING-BRANDS.md](./CONTRIBUTING-BRANDS.md)) :

1. **Le kit publie** : modifier le kit ; `npm run build:packages` ;
   `npm run test:kit` vert ; push/merge sur `main`. Le kit se protège avec
   SES gates — dont `test-phase-arch-codemod` : un bump
   `ARCHITECTURE_VERSION` sans codemod de migration est ROUGE
   ([`scripts/codemods/README.md`](../scripts/codemods/README.md)). C'est ce
   contrat (changelog + versioning + codemods) qui protège les apps.
2. **L'app mesure quand elle veut** : distribution npm — la marque
   consomme `@creezio/*` en versions publiées (`^<lockstep>`). Vérifier une
   montée = `npm update "@creezio/*"` sur une branche + suite complète CI.
   Le changelog kit (changesets) liste les breaking `feat!`/`fix!` et les
   bumps `ARCHITECTURE_VERSION`. **Assistance PUSH (P3.b)** : le workflow
   kit [`propagate.yml`](../.github/workflows/propagate.yml) ouvre
   automatiquement, après chaque release publiée, une PR de bump chez chaque
   marque configurée ([`.github/propagate-brands.json`](../.github/propagate-brands.json))
   — la marque reste libre de merger (le modèle PULL n'est pas inversé :
   la PR est une offre, pas un déploiement).
3. **Le développeur de l'app décide** : merge de la branche de bump
   (lockfile commité — CI + deploy de l'app suivent).
4. Breaking change (`ARCHITECTURE_VERSION`) : codemods de migration
   obligatoires, livrés dans le MÊME commit kit que le bump (gate
   `test-phase-arch-codemod`) et appliqués par la marque lors de la
   montée de version — **runner outillé (P3.a)** : `creezio upgrade`
   (package factory) détecte la version d'architecture de la marque,
   applique LA CHAÎNE des codemods intermédiaires dans l'ordre (idempotence
   vérifiée à chaque pas), synchronise tous les manifests `@creezio/*` avec
   la SoT du kit — bump des deps existantes ET ajout des deps requises
   manquantes (`SERVER/UI/CLIENT_CREEZIO_DEPS` ; une dep hors SoT n'est
   jamais supprimée, elle est listée en warning) — puis régénère les
   lockfiles (`npm install --package-lock-only`, jamais `npm update`),
   rematérialise os-ui et lance le doctor. `--dry-run` pour lister sans
   écrire. Gate : `test-phase-upgrade-runner`.

`node_modules/` côté app est GÉNÉRÉ — jamais de patch manuel d'un package
`@creezio/*` installé (écrasé au prochain `npm ci`).

## Topologie multi-serveurs

Chaque app est indépendante : **un serveur par app**, avec son runner
self-hosted pour le deploy (la CI tourne sur GitHub-hosted). Une app SANS
runner (serveur pas encore câblé, ou dev tiers sans infra) tourne
intégralement sur GitHub-hosted : générer ses workflows avec
`githubHosted: true` (factory) + secret repo `CREEZIO_NPM_TOKEN` (PAT
`read:packages` de l'org, requis par le `.npmrc` pour installer les
`@creezio/*`) ; le deploy, lui, exige toujours le runner du serveur de
l'app.

Politique de republish des binaires desktop : voir
[archive/REPUBLISH-POLICY.md](./archive/REPUBLISH-POLICY.md) (politique
historique toujours applicable : republier tous les artefacts impactés d'une
marque, feeds `latest.yml` cohérents).

## Semver `@creezio/*`

| Commit (Conventional) | Bump |
|-----------------------|------|
| `feat!:` / `BREAKING CHANGE` | **major** |
| `feat:` | **minor** |
| `fix:` / `perf:` | **patch** |
| `docs` / `test` / `chore` / `ci` / `build` / `style` / `refactor` | **none** (ou patch via `--force-patch`) |

- Changelog racine : [`CHANGELOG.md`](../CHANGELOG.md).
- Tooling : `npm run kit:version` (dry-run par défaut, `--apply` pour écrire) ;
  policy code : `@creezio/propagation` → `SEMVER_POLICY_SUMMARY`.

```bash
npm run kit:version -- --package=@creezio/platform-core --bump=minor
npm run kit:version -- --package=product-hub --from-commits --since=HEAD~10
npm run kit:version -- --package=@creezio/shell --bump=patch --apply
```

## Impact d'un bump

```bash
npm run kit:impact -- --package=@creezio/platform-core
npm run kit:impact -- --package=electron-shell --bump=major --json
```

Surfaces typiquement touchées par package : `brand-config` (deps,
electron-builder), `shell` (preload/main), `platform-core` (SqliteRuntime,
`ARCHITECTURE_VERSION`), `api-kernel` (façade HTTP), `mcp-facade` (proxy MCP),
`shell-ui` (nav + chrome UI), `auth` (session), `assistant` / `tasks` /
`mails` (modules CMS), `electron-shell` (runtime), `app-runtime` (façade
boot), `os-ui` (pages OS à rematérialiser), `desktop-tooling` (publish),
`factory` / `propagation` (outillage).

## Sidebar = catalogue (interdiction `OS_NAV`)

Depuis NAV-3 (`docs/plans/PLAN-NAV-CATALOG.md` Phase C) la sidebar d'une
marque **consomme** `GET /api/v1/modules/nav` via `<NavCatalogLoader />`
exporté par `@creezio/shell-ui/ui` (re-export `@creezio/nav/ui` après
publish — **ne pas** ajouter `@creezio/nav` aux deps d'une app tant que
le package n'est pas sur GitHub Packages).

**Interdit** :

- recopier une constante `OS_NAV` / `NAV` avec des hrefs OS
  (`/taches`, `/mails`, granola, grokbot…) ;
- lister `@creezio/granola` / `@creezio/grokbot` / `@creezio/nav` dans
  le `package.json` d'une marque **avant** publication lockstep ;
- patcher le chrome owned-by-brand pour « ajouter » un module OS.

Après `npm update "@creezio/*"` : monter le loader, retirer les listes
OS inline, `os-ui:materialize` (page `/admin/nav`). Snippets complets :
`docs/plans/PLAN-NAV-CATALOG.md` §7.

## Règle d'or du bump côté apps

Toujours bumper **les deux** manifests en même temps :

`ash
npm install '@creezio/<pkg>@^X.Y.Z' --save          # racine / workspace server
npm install '@creezio/<pkg>@^X.Y.Z' --save --prefix server/ui
`

Le hook prebuild os-ui:materialize lit les routes OS depuis le

ode_modules du workspace server (hoisté à la racine), **pas** celui de
server/ui. Un bump partiel (UI seule) laisse les pages OS matérialisées sur
l'ancienne version et crée un 
ode_modules nested (dual-package) — CI verte,
deploy vert, mais ancienne page servie. Incident réel : login 0.6.0
(2026-08-10), corrigé en alignant les 24 deps @creezio/* des deux manifests.

## Canaux marque

Outillage **interne kit** (package privé `@creezio/propagation`) : corps de
PR par marque (`buildAllBrandPrPayloads(impact)`, template
[`.github/PULL_REQUEST_TEMPLATE/kit-bump.md`](../.github/PULL_REQUEST_TEMPLATE/kit-bump.md)).
Les gates historiques de premier branchement (G1/G2/G3) sont signées et
archivées : [archive/gates/](./archive/gates/).

**Branché en réel depuis P3.b** : `.github/workflows/propagate.yml`
(`workflow_run` sur Publish) exécute `scripts/propagate-brands.mjs` qui,
pour chaque marque de `.github/propagate-brands.json` :

1. no-op si le HEAD n'est pas un commit release changesets ;
2. GET les PR ouvertes du repo cible — skip si même titre, même head
   (`creezio/kit-bump-<version>`), ou `package.json` déjà au pin (default
   branch ou PR ouverte) ; skip aussi si `main` est déjà au pin. Puis
   clone ; skip si déjà à jour ou branche de bump déjà poussée. POST
   `/pulls` HTTP 422 = skip (PR déjà existante), jamais une erreur
   (D7 — `ls-remote` seul a produit TF3 #73 après #72 mergée) ;
3. synchronise tous les manifests `@creezio/*` avec la SoT kit via
   `planCreezioManifestSync` (logique partagée `@creezio/factory` — bump des
   existantes + ajout des deps requises manquantes, extras hors SoT listés
   en warning dans la PR, jamais supprimés) + régénère chaque lockfile en
   `--package-lock-only` ;
4. pousse `creezio/kit-bump-<version>` et ouvre la PR avec le rapport
   d'impact `@creezio/propagation` en corps.

Secret requis côté repo kit : `CREEZIO_PROPAGATE_TOKEN` (PAT compte
`creezio`, scopes `repo` + `read:packages`). Ajouter une marque au rollout
= une entrée JSON, zéro code.

## Registre plugins org (L3)

Contrat dans `@creezio/propagation` :

- `OrgPluginRecord` + `createMemoryOrgPluginRegistry` /
  `createFileOrgPluginRegistry({ filePath })` (persistance JSON ops)
- Visibilités : `owner_only` → `pending_review` → `promoted_vertical` → `promoted_kit`
- Remontée : `submitForOrgReview` → `proposeVerticalPromotion` → `proposeKitPromotion`
- Console : `GET/POST /api/org-plugins` (fichier `var/org-plugin-registry.json`)
- Cloud registry / auto-promotion = hors scope

## Points d'extension

| Direction | Chaîne |
|-----------|--------|
| **Descente** | `kit.release.published` → `vertical.deps.bumped` → `org.feature.rolled_out` → `user.plugin.entitled` |
| **Remontée** | `user.plugin.created` → `org.plugin.reviewed` → `vertical.plugin.promoted` → `kit.plugin.accepted` |

Bus in-process : `createExtensionHookBus()`.

## Console ops

`apps/console` affiche versions kit, canaux et parc feeds :

```bash
npm run console:dev   # http://127.0.0.1:3080
curl -s http://127.0.0.1:3080/api/kit-versions | jq .
```
