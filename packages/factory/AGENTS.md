# AGENTS.md — @creezio/factory

## Mission

Maintenir le CLI `creezio` :

0. **Happy path** (`brand create --id/--name/--domain`) : monorepo + repo
   admin frère **locaux** + registre vide + mount interactive-demo +
   collecteurs assistant/onboarding (F3.4) + nav permissions (D8,
   `applyBrandModuleAuth` / `collectNavPermissions`). Guide
   `docs/agents/CREATE-APP.md`. Repos GitHub : **`--push` explicite**
   (token requis) — sans ce flag, `maybePushBrandRepos` ne résout aucun
   token et n'appelle pas le réseau (même si `GITHUB_TOKEN` est posé).
   `--no-push` = défaut redondant. **Pas** `demo-app` (déprécié, exit 1).
   **Pas** de module notes. **Pas** de `server/crm/`.
1. **Mode OS** (`new-app --name/--id/--domain`) : squelette Client+Serveur,
   slot métier vide (sandbox technique) — même câblage démo que create.
2. **Mode produit** (`new-app --from-prd <prd.md>`) : brief → `ProductModel` →
   artefacts métier + **main mince** (`startBrandDesktop`). `parseProductPrd`
   extrait `## Entités` ou échoue (pas de fallback notes). CHR seulement
   si `vertical: chr` explicite.
3. **BrandSpec** (`brand init|doctor|apply|smoke`) : SoT déclarative agent →
   apply via scaffold (ADR `docs/adr/ADR-brand-spec-app-runtime.md`).
   Doctor fail-closed : stub `(à remplir)`, leftover notes, 0 modules.

Les générateurs vivent ici. Le métier généré **n’entre pas** dans
`@creezio/platform-core` (ADR `docs/adr/ADR-factory-from-prd.md` +
`ADR-no-brand-domain-in-native-packages.md`).
L’orchestration OS vit dans `@creezio/app-runtime` — **ne pas** la régénérer
en jumeau dans `main.ts`.

## Ne pas faire

- Ne pas recycler des GUID, feeds ou tokens de production.
- Ne pas hardcoder le SQL TempoFlow dans un package natif — seulement via
  générateurs → fichiers marque.
- **Ne pas** versionner un clone métier TempoFlow sous `templates/`.
- **Ne pas** générer un sidecar JSON (`metier-api.mjs` / `store.json`) comme
  SoT métier. Chemin nominal = `createSqliteRuntime` + `createApiKernel` +
  mounts `/api/v1/modules/*` + harness `brand-kernel-harness.mjs`.
- **Ne pas** hardcoder des UIDs Meili `tf2_*` dans le feed marque : générer
  `meili-feed.ts` avec `catalog_*` + `configureMeiliBrandFeed`.
- Desktop from-prd : `startBrandDesktop` / `startBrandKernelHarness`
  (`@creezio/app-runtime`) — pas le monolithe `installBrandDesktopRuntime`.
- H11 : `build-builder-config.mjs` généré exige
  `src/electron/app-manifest.json` — plus de fallback `getManifest` /
  `listBrandIds` sur le registre kit.
- H13 : le README scaffold ne cite plus de vhost `dl-<marque>` en dur ;
  classes UI titlebar / fake-cursor / cache SW → `creezio-*` (codemod
  `scripts/codemods/H13/`).
- Ne pas écraser des fichiers existants sans `--force`.
- Ne pas exiger des flags techniques si `--from-prd` suffit.
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs factory` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.
- **Ne pas** documenter un workaround marque-only pour un trou scaffold
  (layout `node_modules`, `AUTH_DISABLED` smokes…) — fix ici d'abord.

## Layout hôte + smokes

- Scaffold npm : workspace racine (`workspaces: ["server"]`) + `.npmrc`
  (registre @creezio → npmjs.org, aucun token) +
  matérialise `scripts/ensure-server-lock.mjs` (SoT `docker/server/`).
  Plus de vendor ni de symlinks trackés.
- `--link-kit` / `CREEZIO_LINK_KIT=1` : `ensureBrandPackageLocks` pin les
  `@creezio/*` sur `<kit>/packages/*` (`file:`) le temps du `npm install`,
  puis restaure les manifests `^<lockstep>`. Les gates scaffold
  (`os-ui-scaffold`, `factory-two-repos`, …) passent toujours `--link-kit`
  — une PR `changeset-release/*` (version pas encore sur le registre) reste
  verte. Une marque production (clone GitHub) n'utilise PAS ce flag.
- Smokes `test:metier-parcours` : `AUTH_DISABLED=1` dans `harnessPrelude`
  (garde mounts F3 — sinon 401 notes).
- `tsconfig.preload.json` inclut `electron-shim.d.ts` : le preload compile
  hors ligne sans paquet `electron` (gates `factory-prd*`, lien
  `node_modules` kit — pas `--link-kit` / npm install).
- Smokes « créé puis listé » : cohérence éventuelle Meili (contrat kit —
  pas de write-through, `engine:"indexing"` + 0 item pendant l'indexation
  initiale). Les templates (`renderMetierParcoursSmoke`,
  `renderMiniPrdCoreSmoke`) assertent le read-after-write via `?ids=`
  (hydratation PK = SQL légitime) puis pollent la liste via le helper SoT
  `@creezio/desktop-tooling/scripts/meili-list-poll.mjs` (borné 60 s,
  échec explicite si `engine:"meili"` sans le doc). **Jamais** d'assertion
  naïve « GET liste immédiat post-create » sur une entité indexable —
  gate `test-phase-meili-smoke-polling`.

## Points d'entrée

- `bin/creezio.js` : binaire npm.
- `src/cli.ts` : `new-app` + dispatch `brand` / `server-docker` / `upgrade`.
- `src/upgrade-cli.ts` : `creezio upgrade` (P3.a) — runner de montée de
  version marque : détection version d'architecture (marker
  `creezio.architectureVersion` > lockfile `platform-core` > node_modules),
  chaîne de codemods H* dans l'ordre avec idempotence vérifiée (re-run
  = no-op sinon échec), **sync** `@creezio/*` de TOUS les manifests via
  `planCreezioManifestSync` (bump + AJOUT des deps SoT manquantes —
  trou prod 0.20.0 — jamais de suppression : dep hors SoT = warning
  listé), lockfiles régénérés (`npm install --package-lock-only` isolé
  au brand-root — jamais le prefix/workspace du kit ; jamais `npm update`),
  rematérialisation os-ui, doctor brand-spec fail-closed,
  `--dry-run` (liste les ajouts). Les codemods sont embarqués dans le
  package publié
  (`codemods/` + `codemods/lib/`, copiés au build par
  `scripts/copy-codemods.mjs` depuis `scripts/codemods/` du kit — SoT).
  Gate : `test-phase-upgrade-runner`.
- `src/npm-isolated.ts` : spawn npm ancré sur le projet marque
  (`--prefix` + env prefix/workspace stripé) — consommé par
  `upgrade-cli` et `package-lock`.
- `src/sync-creezio-deps.ts` : logique PARTAGÉE de sync des manifests
  marque (rôles root/server/server-ui/client ↔ SoT
  `SERVER/UI/CLIENT_CREEZIO_DEPS`) — consommée par `upgrade-cli.ts` ET par
  `scripts/propagate-brands.mjs` (import du dist) ; jamais de boucle de
  bump parallèle.
- `src/server-docker-cli.ts` : serveurs marque headless (`docker/server`).
  `publish` pose `org.opencontainers.image.source` (remote git du
  brand-root) — fail-closed si registre `ghcr.io` et remote introuvable.
- `src/server-docker-registry-gc.ts` : `creezio server-docker registry-gc`
  — GC fail-closed du registre Docker local (`registry:2`, `127.0.0.1:5000`) :
  API v2 list/delete + `docker exec … garbage-collect`, rétention `--keep N`
  (défaut 2) **par famille** : `auto.*` d'un côté, **semver** de l'autre
  (fenêtre indépendante ≥ 3 — une rafale `auto.*` n'évince jamais un
  semver). Tags PROTÉGÉS jamais supprimés : conteneurs en cours,
  `docker-data/servers.json` (`--brand-root` + labels `creezio.brand-root`,
  instances arrêtées incluses), releases fleet de l'app admin (`--admin-app`
  / `CREEZIO_FLEET_ADMIN_URL`, injoignable = refus). **Dry-run par défaut**,
  `--apply` exécute. Même politique sur le chemin `publish`.
  Gate : `scripts/test-phase-server-docker-registry-gc.mjs`.
- `src/server-docker-ghcr-gc.ts` : même geste `registry-gc` + rétention
  `publish` quand le registre cible EST `ghcr.io` — API GitHub Packages
  versions (pas v2). Règle : ≥ 3 semver, jamais un tag in-use /
  `servers.json` / instances. Auth manquante = fail-closed. Gate :
  `scripts/test-phase-server-docker-ghcr-gc.mjs`.
- `src/server-docker-tunnel.ts` : politique create fail-closed
  (`CREEZIO_CF_API_TOKEN` / `_ACCOUNT_ID` / `_ZONE_ID` requis sauf
  `CREEZIO_TUNNEL_LOCAL=1`) + dérivation slug réservé.
- `src/server-docker-agent-tunnel.ts` : helpers purs du tunnel cloudflared
  DÉDIÉ agent (T7) — container `creezio-agent-tunnel` (network host,
  restart unless-stopped), env file `docker-data/agent-tunnel.env` 600
  (`TUNNEL_TOKEN`, jamais en argv), détection
  `needsDedicatedAgentTunnelMigration` / `parseAgentPublicUrl`.
  `provisionDedicatedAgentTunnel` (CLI) : enroll **et** `agent up`
  (migration auto si hôte déjà enrôlé sans tunnel dédié) — ordre
  ensure → connecteur → DNS → retrait résiduel (gate
  `test-phase-agent-tunnel`). Persist `agentUrl` : `sudo -n` / wrapper
  `priv-io` si `fleet-hosts.json` est root:root 600, sinon POST admin
  (container) — jamais chmod manuel. Même chemin pour `cf.env` /
  `secrets.env` à l'`update` (fail-closed). `hostPort` persisté dans
  `servers.json` et réutilisé au recreate. `agent rm` = seul geste qui
  retire DNS `agent.*` / tunnel dédié ; `server-docker rm` d'une
  instance ne les touche jamais.
- `src/server-docker-owner.ts` : politique create fail-closed owner
  (`CREEZIO_OWNER_EMAIL` / `_PASSWORD` requis en VPS/prod ; optionnel si
  `CREEZIO_TUNNEL_LOCAL=1`) — first-run `POST /api/v1/os/setup`, persist
  `secrets.env` 600, `ensure-owner` + `CREEZIO_E2E_*` optionnels, jamais le
  mot de passe en log.
- `src/package-lock.ts` / `src/prepare-brand-distribution.ts` : locks npm
  des DEUX repos (marque + `<brand>-admin`) dès `new-app`/`brand apply`
  (Docker prêt out-of-the-box) — échec explicite si un lock n'est pas produit.
- Tout scaffold génère `.cursor/environment.json` (install standard
  `npm install --no-audit --no-fund`) — cloud agents Cursor prêts.
- `src/brand-cli.ts` : BrandSpec init/doctor/apply/smoke.
- `src/product-model.ts` : `ProductModel`, `parseProductPrd`, `safeBrandId`.
- `src/kit-release.ts` : SoT `SERVER_CREEZIO_DEPS` / `CLIENT_CREEZIO_DEPS` /
  `UI_CREEZIO_DEPS` (granola, grokbot, nav inclus) — les chemins scaffold /
  --from-prd / `renderUiPackageJson` / `creezio upgrade` / propagate
  consomment ces listes, jamais une copie inline.
- `src/scaffold.ts` / `scaffold-from-prd.ts` : artefacts.
- `src/generators/*` : schema, api, ui, **os-ui** (réf. + layout métier-only), nav, wiring, tests.
  Chrome : `<NavCatalogLoader />` (`@creezio/shell-ui/ui`) +
  `defaultOsAdminNavItems()` — **interdit** de régénérer une constante
  `OS_NAV` inline. `@creezio/nav` est dans SERVER/CLIENT_CREEZIO_DEPS +
  transpilePackages (même vague publish que granola/grokbot). Le loader
  reste importé depuis `@creezio/shell-ui/ui`. Plan
  `docs/plans/PLAN-NAV-CATALOG.md`.
- Pages OS (`/mails`, `/taches`, `/setup`…) vivent dans **`@creezio/os-ui`** ;
  matérialisées sous `ui/app/(creezio-os)/` (gitignoré). **Interdit** de les
  versionner dans `ui/app/` d'une marque.
- `fixtures/prd-tempoflow-produit.md` : gold CHR.
- `src/index.ts` : exports publics.

## Modifier sans casser

- Push GitHub factory = **opt-in `--push` uniquement**. Interdit de
  reconditionner le push à « un token est résolvable » ou à « on dirait
  un CI ». Pas d'env de bypass (`CREEZIO_FACTORY_NO_PUSH` n'existe pas).
  Les gates scaffold (`test-phase-d`, `factory-two-repos`, `create-brand`,
  `os-ui-scaffold`, `factory-prd`) tournent **avec** le token VM en place.
- Toute nouvelle option CLI → `CliArgs`, `parseArgs`, `printHelp`, `NewAppOptions`.
- `safeBrandId` doit continuer à mapper `tempoflow` → `tempoflow3`.
- Les smokes générés (`test:metier-parcours`, `test:first-run-auth`) doivent
  rester exécutables sans binaire Electron.
- `--force` reste la seule voie d'écrasement.

## Tests/gates

```bash
npm run build -w @creezio/factory
node --test scripts/test-phase-factory-prd.mjs
node --test scripts/test-phase-factory-prd-experience.mjs
node --test scripts/test-phase-os-ui-scaffold.mjs
node --test scripts/test-phase-server-docker-registry-gc.mjs
node --test scripts/test-phase-server-docker-ghcr-gc.mjs
```

Smoke manuel :

```bash
node packages/factory/bin/creezio.js new-app \
  --from-prd docs/experiences/tempoflow3/PRD-PRODUIT.md \
  --out /tmp/tempoflow3 --force
cd /tmp/tempoflow3 && npm run test:metier-parcours
```

## Liens

- `README.md`
- `docs/adr/ADR-factory-from-prd.md`
- `docs/experiences/tempoflow3/PROMPT-PRODUIT.md`
- `docs/experiences/tempoflow3/PRD-PRODUIT.md`
