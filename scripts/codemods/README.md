# Codemods d'architecture — migrations kit → marques

Quand `ARCHITECTURE_VERSION` (`packages/platform-core/src/architecture-version.ts`)
change (ex. `H6` → `H7`), les marques consommateurs npm doivent migrer. Le
bump est REFUSÉ par la gate `test-phase-arch-codemod` **sauf si un codemod
de migration existe ici** : la marque l'exécute lors de sa montée de
version (`npm update "@creezio/*"` + codemods).

## Contrat

Un dossier par **version cible** :

```
scripts/codemods/
  H7/
    manifest.json          # {"scripts": ["01-rename-x.mjs", …], "since": "0.12.0"}
    01-rename-x.mjs
    02-move-y.mjs
```

- `manifest.json` : `{"scripts": [...], "since": "<lockstep>"}` — scripts
  exécutés **dans l'ordre** du tableau ; `since` = version lockstep
  `@creezio/*` qui a introduit cette architecture (SoT du mapping
  lockstep→architecture consommé par `creezio upgrade` pour détecter la
  version courante d'une marque via son package-lock — gate
  `test-phase-arch-codemod`).
- Chaque script est un module Node (`.mjs`) lancé par
  `ROOT=<racine marque> node <script>` :
  - `ROOT` (env) = racine du clone marque à transformer (fichiers marque
    uniquement — jamais `node_modules/`, `dist/`, `dist-electron-server/`,
    `win-unpacked/`, `release/`, `out/` : SoT partagée
    `scripts/codemods/lib/skip-dirs.mjs`, réinstallé au prochain `npm ci`) ;
  - **idempotent** : relancer le script sur une marque déjà migrée est un
    no-op vert ;
  - **sortie contractuelle** : chaque fichier modifié est listé sur une
    ligne `  ~ <chemin relatif>` (aucune ligne `~` = no-op). C'est ce qui
    permet à `creezio upgrade` de PROUVER l'idempotence : chaque pas de la
    chaîne est re-exécuté, un re-run qui liste encore des `~` = échec
    explicite de la migration ;
  - exit ≠ 0 = migration impossible → la marque reste intacte (le codemod
    s'exécute AVANT le commit du lockfile bumpé).

## Runner `creezio upgrade` (P3.a)

Les marques n'appliquent plus la chaîne à la main : `creezio upgrade`
(`packages/factory/src/upgrade-cli.ts`), exécuté à la racine d'un repo
marque, détecte la version d'architecture courante (marqueur
`creezio.architectureVersion` du package.json racine, sinon mapping
lockstep→arch via les `since`, sinon platform-core installé), applique la
chaîne des codemods intermédiaires dans l'ordre (idempotence prouvée à
chaque pas), synchronise les deps `@creezio/*` de TOUS les manifests avec
la SoT du kit (`planCreezioManifestSync` — bump des existantes + AJOUT des
deps requises manquantes, jamais de suppression silencieuse) + lockfiles
(`npm install --package-lock-only`, jamais `npm update`), rematérialise les
pages os-ui et lance le doctor brand-spec. `--dry-run` liste le plan.

Le build de `@creezio/factory` copie ce dossier dans le package publié
(`packages/factory/codemods/`, gitignoré) — la SoT reste ICI.

## Checklist bump `ARCHITECTURE_VERSION` (docs/CONTRIBUTING-BRANDS.md)

1. bump de la valeur dans `packages/platform-core/src/architecture-version.ts` ;
2. `scripts/codemods/<nouvelleVersion>/manifest.json` + scripts (la gate
   `scripts/test-phase-arch-codemod.mjs` REFUSE un bump sans manifest) ;
3. ADR dans `docs/adr/` expliquant le breaking change ;
4. push sur `main` → publication npm ; chaque app consommatrice voit le bump
   dans le CHANGELOG / la release et exécute les codemods lors de sa montée
   de version (`npm update "@creezio/*"` + `ROOT=. node <codemod>`).
