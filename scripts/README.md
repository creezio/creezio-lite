# `scripts/` — gates, build CJS, propagation kit

Outils du monorepo **creezio** (hors packages npm).

## Rôle

- **Gates de phases** : `test-phase-*.mjs` — assertions architecture / contrats / docs
- **Build dual CJS** : `build-cjs.mjs` — génère `packages/*/dist-cjs` pour Electron `require`
- **Propagation** : `kit-version.mjs`, `propagation-impact.mjs`
- **Docs** : `generate-files-md.mjs` — génère/rafraîchit les `docs/FILES.md`
  (standard [../docs/DOC-STANDARD.md](../docs/DOC-STANDARD.md), gate
  `test-phase-docs-freshness.mjs`)
- **Lib** : `scripts/lib/*` (brand roots, twins intention,
  `assert-runtime-dist.mjs` anti dist stale, etc.)

Les journaux d'époque des phases (`PHASE-*.md`) sont archivés dans
[../docs/archive/](../docs/archive/).

## Commandes usuelles

```bash
# Depuis la racine du kit
npm run test:kit         # gates pures kit — 100 % vertes partout (fail-fast)
npm run test:brands      # gates lisant les repos marque (skip auto-détecté)
npm run test:env         # gates environnementales (opt-in, skip explicite)
npm test                 # toutes les gates en un node --test (CI complet)
npm run build:cjs        # dual CJS uniquement
npm run build:packages   # tsc packages + CJS
npm run kit:impact -- --package=@creezio/platform-core
npm run kit:version -- --package=@creezio/shell --bump=patch
```

Gates ciblées :

```bash
node --test scripts/test-phase-p29.mjs
node --test scripts/test-phase-c2.mjs
node --test scripts/test-phase-o9.mjs
```

## Suites de gates (`test-fast.mjs`)

`npm run test:kit` / `test:brands` / `test:env` partagent le même runner
fail-fast (`scripts/test-fast.mjs`) : séquentiel, stop 1re rouge,
`--from`/`--only`/`--skip`/`--keep-going`, journal JSONL
`/tmp/creezio-test-fast.log`. La liste des gates vient du script npm `test`
(SoT unique) ; la suite de chaque gate est **détectée automatiquement** —
aucune liste figée de noms, aucun assert affaibli.

| Suite | Détection | Prérequis | Skip |
|-------|-----------|-----------|------|
| `kit` | défaut (ne lit que ce repo) | aucun — doit être 100 % verte partout | jamais |
| `brands` | la gate importe `scripts/lib/brand-roots.mjs` ou résout `dockerRoot` | clones des repos marque présents pour chaque marque référencée (`tempoflow2` — repo legacy figé avec son `crm/vendor/creezio` d'époque —, `certivan-app`, `fidu`) | auto : par marque manquante, raison affichée |
| `env` | liste `ENV_GATES` dans `test-fast.mjs` | `test-os-cold-warm.mjs` : `CREEZIO_COLD_WARM=1` (bootstrap embeds réseau, ~4 Go `/tmp`, ~10 min) ; `test-phase-factory-prd*.mjs` : `CREEZIO_FACTORY_PRD=1` (scaffold --from-prd + smoke, lien `node_modules` du kit, pas de npm install — hors-ligne et en ligne) ; `test-phase-factory-docker-parity.mjs` : `CREEZIO_FACTORY_DOCKER=1` (app neuve factory → npm install → image Docker → parité boot-status/cloudflared, ~10 min, docker requis) ; `test-os-native-pnp.mjs` + `test-os-shell-contracts.mjs` : `CREEZIO_KIT_BINARIES=1` (binaires natifs réels meili/cloudflared/hermes/n8n — incompatibles avec `CREEZIO_SKIP_KIT_BINARIES=1`, tournent en nightly self-hosted) | opt-in : skip explicite tant que la variable n'est pas posée |

Workflow quotidien : `npm run test:kit` → première rouge → corriger →
`npm run test:kit -- --from <gate>`. Sur un poste avec les repos marque à
jour, `npm run test:brands` lance les gates historiques M/N/O/P (cutover
marques de l'ère vendoring — skip auto sans les repos d'époque).

### Ajouter une gate

1. Créer `scripts/test-phase-<nom>.mjs` (`node:test`).
2. L'ajouter dans la ligne `test` du `package.json` racine — SoT unique :
   les suites `test:kit` / `test:brands` / `test:env` en dérivent
   automatiquement (classification auto décrite dans l'en-tête de
   `test-fast.mjs` et le tableau ci-dessus).

### Environnement d'exécution (ce VPS)

- Les gates écrivent sous `/tmp` (tmpfs) : nettoyer `/tmp/creezio-*` et
  `/tmp/tempoflow3-*` après un chantier ; `TMPDIR=/opt/docker/tmp` pour les
  runs lourds.
- Durées indicatives : `build:packages` ~10-15 min, `test:kit` ~15 min,
  `npm test` côté TF3 ~20 min.
- État connu : voir « État connu des suites » dans [AGENTS.md](./AGENTS.md).

## Gates invariants P1.a (frontières d'architecture)

Quatre gates kit gravent les invariants de l'audit d'architecture (les
règles ne sont plus seulement de la doc) :

| Gate | Invariant | Dette |
|------|-----------|-------|
| `test-phase-no-brand-vocab.mjs` | zéro vocabulaire marque dans `packages/*/src\|ui` (frontière n°1) | [`no-brand-vocab-allowlist.json`](./no-brand-vocab-allowlist.json) — **ratchet décroissant** : compteur par fichier×pattern + ticket audit F1.x ; maintenance `node scripts/lib/brand-vocab.mjs --write-allowlist` (rétrécit uniquement, refuse ajout/incrément) |
| `test-phase-host-no-electron.mjs` | `electron-shell/src/host/**` chargeable en Node pur : zéro import statique d'`electron` (valeurs via `loadElectron()`, exception unique `host/load-electron.ts`) | aucune |
| `test-phase-creezio-manifest-align.mjs` | specs `@creezio/*` identiques entre les manifests d'une app marque (scaffold factory) + doctor brand-spec `CREEZIO_MANIFEST_MISALIGNED` fail-closed (incident login 0.6.0, règle d'or [../docs/PROPAGATION.md](../docs/PROPAGATION.md)) | aucune |
| `test-phase-build-order-imports.mjs` | graphe d'imports `@creezio/*` runtime (type-only ignorés) : zéro cycle + ordre de build respecté (`build-workspaces.mjs --list` = SoT) | aucune |

Une occurrence hors allowlist est TOUJOURS rouge — on corrige le code, on
n'agrandit jamais une allowlist P1.a.

## Organisation

| Préfixe | Série |
|---------|--------|
| `test-phase-b*.mjs` … `f` | Extraction / factory / propagation historique |
| `test-phase-h*.mjs` | H1–H5 packages + isolation |
| `test-phase-i*.mjs` | Gouvernance I0–I8 + conso marques |
| `test-phase-v*.mjs` | Vision V1–V3 |
| `test-phase-c*.mjs` | Corrections cutover C* |
| `test-phase-r*.mjs` | Database / gel inventions |
| `test-phase-m*.mjs` / `n*` / `o*` / `p*` | Plans M/N/O/P |

## Voir aussi

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md) — inventaire fichier par fichier
- [../docs/PACKAGES.md](../docs/PACKAGES.md)
- [../AGENTS.md](../AGENTS.md)
