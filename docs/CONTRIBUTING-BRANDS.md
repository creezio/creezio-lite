# Contributing Brands — gouvernance kit ↔ apps consommatrices

Comment une app naît, vit avec le kit, et comment le kit évolue sans casser
ses consommateurs. Complète [PROPAGATION.md](./PROPAGATION.md) (contrat de
propagation) — ici : le cycle de vie opérationnel et les règles.

**Modèle open source PULL** : le kit ne connaît pas ses consommateurs
(potentiellement 100+ apps, dont des apps d'autres développeurs). Pas de
registre central, pas de notification, pas de test des apps dans la CI kit.
Le kit publie des **packages npm versionnés** sur GitHub Packages
(changesets, lockstep — [NPM-DISTRIBUTION.md](./NPM-DISTRIBUTION.md)) avec
changelog + `ARCHITECTURE_VERSION` + codemods ; chaque app tire la dernière
version QUAND ELLE LE DÉCIDE, par un geste explicite (`npm update
"@creezio/*"` sur une branche + suite CI complète, puis merge).

## Cycle de vie d'une app

```
scaffold factory (creezio new-app)
  → repo app : deps npm `@creezio/*` versionnées (lockfiles commités,
    .npmrc → GitHub Packages) + workflows CI/CD
  → mise à jour décidée : branche + `npm update "@creezio/*"` + suite
    complète CI (le changelog kit / la Version PR liste les breaking)
  → deploy : workflow Deploy sur CI verte de main (runner du serveur app)
```

1. **Scaffold** : `creezio new-app` génère le repo app complet — dont
   `.github/workflows/{ci,deploy}.yml`, le `.npmrc` (registre `@creezio` →
   GitHub Packages, token via env `CREEZIO_NPM_TOKEN`) et les lockfiles
   (générateur : `packages/factory/src/generators/brand-workflows.ts`).
   Les apps migrées ajoutent une gate `server/scripts/test-deps-integrity.mjs`
   (cohérence des packages `@creezio/*` installés vs lockfile — voir winhub /
   tempoflow3).
2. **Un serveur par app, un runner par app** : chaque app vit sur SON
   serveur, avec son runner self-hosted pour le deploy (la CI tourne sur
   GitHub-hosted ; pattern : `~/actions-runners/<app>` + service systemd
   user, `.env` avec `TMPDIR` hors tmpfs — voir les runners existants).
   App sans runner (serveur pas encore câblé, dev tiers sans infra) :
   générer les workflows avec `githubHosted: true` (ubuntu-latest) + secret
   repo `CREEZIO_NPM_TOKEN` (PAT `read:packages` de l'org, requis par le
   `.npmrc`) ; le deploy attend le runner du serveur de l'app.
   **Deploy depuis le SERVEUR de l'app** (pattern winhub, repris par
   tempoflow3) : la source déployée est le clone local du brand root — le
   registre d'instances `docker-data/servers.json` est gitignoré, donc
   ABSENT d'un checkout runner (`--brand-root .` depuis le checkout casse
   `server-docker update`). Le CLI `server-docker build|publish` (du clone
   kit du serveur, `CREEZIO_KIT_ROOT`) applique la garde
   `assert-runtime-dist` (hash de contenu src↔dist des packages kit) : un
   clone kit pullé sans rebuild laisse un dist stale et la garde refuse —
   à juste titre — le build d'image (le job deploy de tempoflow3 rebuild
   donc le kit avant publish : `npm ci && npm run build:packages`).
   **Update `--backup` : sudo requis pour le runner.** Les fichiers de
   `docker-data/servers/<nom>/` sont écrits par les conteneurs (root, y
   compris des secrets en mode 600) et `docker-data/backups/` appartient à
   root : le tar de snapshot lancé par l'utilisateur du runner échoue en
   `Permission denied` et l'update est annulé (échec propre, rien touché).
   Le job deploy lance donc les étapes `server-docker update` en
   `sudo -n env "PATH=$PATH" node …` — l'utilisateur du runner doit avoir
   sudo NOPASSWD sur le serveur (constat tempoflow-vps, runner `deploy`).
3. **Versions pinnées par lockfile** : le `package-lock.json` commité pinne
   la version exacte de chaque package `@creezio/*` (range `^<lockstep>`
   dans `package.json`). `node_modules/` est GÉNÉRÉ — jamais édité à la
   main (écrasé au prochain `npm ci`).
4. **Suivre les releases (pull)** : la marque surveille les releases du kit
   (CHANGELOG racine alimenté par changesets, tags `@creezio/<pkg>@<v>`).
   Mesurer une montée = `npm update "@creezio/*"` sur une branche + suite
   complète CI de l'app. RIEN n'est automatique côté app : pas de mise à
   jour sans geste explicite.
5. **Mise à jour décidée** : merge de la branche de bump (lockfiles
   commités : racine + `server/ui`) → CI + deploy suivent. Breaking change
   kit (bump `ARCHITECTURE_VERSION`) : appliquer les codemods fournis
   (`scripts/codemods/<version>/` du kit) pendant la montée.


## Consommation npm (en vigueur — le vendoring est supprimé)

Voir [NPM-DISTRIBUTION.md](./NPM-DISTRIBUTION.md). Résumé app :
`.npmrc` (registry GitHub Packages + `CREEZIO_NPM_TOKEN`), deps
`"@creezio/<pkg>": "^0.9.2"`, mise à jour par `npm update "@creezio/*"`.
Les workflows `kit-compat` / `vendor-update` et les scripts
`install-server-deps` / symlinks trackés sont **SUPPRIMÉS** ; les 4 apps
(winhub, tempoflow3 et leurs repos admin) sont migrées et déployées en
`^0.9.2`.
## Process app → kit (bug ou évolution du kit constaté depuis une app)

**Jamais de patch dans `node_modules/@creezio/`.** Ces packages sont
réinstallés à chaque `npm ci` — un fix se fait dans le repo kit, publié,
puis consommé par `npm update "@creezio/*"`.

Chemin nominal :

1. reproduire le problème dans un **test kit** (`scripts/test-*.mjs` du repo
   creezio — gate dédiée ou cas ajouté à une gate existante) ;
2. corriger le kit ; `npm run build:packages` ; `npm run test:kit` vert ;
   `npx changeset` ;
3. PR sur `creezio/creezio` → merge `main` → Version PR → publication npm ;
4. chaque app récupère le correctif à la prochaine release publiée, par
   `npm update "@creezio/*"` quand son développeur le décide.

## Breaking change — définition

Est breaking (et exige le process ci-dessous) tout changement qui casse une
app à jour de son wiring :

- contrats `BrandMeiliFeed`, `gate.mjs` (gates module colocalisées),
  manifest `brand-spec` ;
- migrations SQL dont le schéma impacte le métier app ;
- signatures/exports publics `@creezio/*` consommés par le wiring app ;
- plus généralement : tout ce qui justifie un bump d'`ARCHITECTURE_VERSION`
  (`packages/platform-core/src/architecture-version.ts`).

## Checklist codemod (bump `ARCHITECTURE_VERSION`)

C'est CE contrat qui protège les 100+ apps : un breaking change est
versionné et livre sa migration automatique.

1. bump de la valeur dans
   `packages/platform-core/src/architecture-version.ts` ;
2. codemods de migration dans `scripts/codemods/<nouvelleVersion>/`
   (`manifest.json` + scripts idempotents, contrat :
   [`scripts/codemods/README.md`](../scripts/codemods/README.md)) — la gate
   `scripts/test-phase-arch-codemod.mjs` REFUSE un bump sans manifest ;
   la marque applique les codemods lors de sa montée de version npm ;
3. ADR dans [`docs/adr/`](./adr/) documentant le breaking change ;
4. le bump apparaît dans le CHANGELOG racine et la release npm — la mise à
   jour reste le choix de chaque app, la migration est fournie.
