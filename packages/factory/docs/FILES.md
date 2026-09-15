# packages/factory — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs factory` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `bin/`

| Fichier | Rôle |
|---|---|
| [`bin/creezio.js`](../bin/creezio.js) | Binaire npm |

## `codemods/H10/`

| Fichier | Rôle |
|---|---|
| [`codemods/H10/h10-explicit-desktop-deps.mjs`](../codemods/H10/h10-explicit-desktop-deps.mjs) | Copie build (gitignorée) du codemod H10 — SoT `scripts/codemods/H10/` du kit : clients desktop legacy → deps explicites + `ensureDesktopNode` + preload `preload.js`. |

## `codemods/H11/`

| Fichier | Rôle |
|---|---|
| [`codemods/H11/h11-purge-tf2-compat.mjs`](../codemods/H11/h11-purge-tf2-compat.mjs) | Copie build (gitignorée) du codemod H11 — SoT `scripts/codemods/H11/` : purge `TEMPOFLOW_*`, asserts feed CHR, `countKey: "sites"`, fallback builder. |

## `codemods/H12/`

| Fichier | Rôle |
|---|---|
| [`codemods/H12/h12-electron-shell-imports.mjs`](../codemods/H12/h12-electron-shell-imports.mjs) | Copie build (gitignorée) du codemod H12 — SoT `scripts/codemods/H12/` : reclasse imports `@creezio/electron-shell` (+ `/meili`) vers host-runtime / search / platform-core ; alias host nommés marque → `DESKTOP_*` / `ensureDesktopNode`. |
| [`codemods/H12/h12-workspace-debrand.mjs`](../codemods/H12/h12-workspace-debrand.mjs) | Copie build (gitignorée) du codemod H12 — SoT `scripts/codemods/H12/` : `configureFullscreenPaths` → `configureWorkspacePaths`, workspace neutre (`isCanvasHref`, `openExternalSite`). |

## `codemods/H13/`

| Fichier | Rôle |
|---|---|
| [`codemods/H13/h13-ui-debrand.mjs`](../codemods/H13/h13-ui-debrand.mjs) | Copie build (gitignorée) du codemod H13 — SoT `scripts/codemods/H13/` : titlebar / fake-cursor / cache SW → `creezio-*`. |

## `codemods/H7/`

| Fichier | Rôle |
|---|---|
| [`codemods/H7/h7-neutralize-brand-contracts.mjs`](../codemods/H7/h7-neutralize-brand-contracts.mjs) | Copie embarquée du codemod H7 (neutralise contrats marque) publiée avec `@creezio/factory`. |

## `codemods/H8/`

| Fichier | Rôle |
|---|---|
| [`codemods/H8/h8-materialize-brand-manifest.mjs`](../codemods/H8/h8-materialize-brand-manifest.mjs) | Copie embarquée du codemod H8 — manifest local d'abord + matérialise `app-manifest.json` depuis le registre kit déprécié. |

## `codemods/H9/`

| Fichier | Rôle |
|---|---|
| [`codemods/H9/h9-import-module-contract.mjs`](../codemods/H9/h9-import-module-contract.mjs) | Copie embarquée du codemod H9 — `types.ts` → ré-export kit + `accessJustification` sur mounts sans permission. |

## `codemods/lib/`

| Fichier | Rôle |
|---|---|
| [`codemods/lib/skip-dirs.mjs`](../codemods/lib/skip-dirs.mjs) | Copie du SKIP_DIRS partagé des codemods H*. |

## `scripts/`

| Fichier | Rôle |
|---|---|
| [`scripts/copy-codemods.mjs`](../scripts/copy-codemods.mjs) | Copie `scripts/codemods/` du kit → `codemods/` du package au build (embarque les codemods H* dans le npm publié). |

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/admin-repo.ts`](../src/admin-repo.ts) | Scaffold du repo ADMIN dédié `<brand>-admin` (app OS complète en mode admin : modules @creezio/admin, landing, compose) — layout 2 repos. |
| [`src/brand-cli.ts`](../src/brand-cli.ts) | CLI `creezio brand` — create (happy path) / init / doctor / apply / smoke. |
| [`src/brand-module-init.ts`](../src/brand-module-init.ts) | CLI `creezio brand module init` — spec 5 fichiers, stub `BrandModuleDef`, registre, runner de gates colocalisées. |
| [`src/cli.ts`](../src/cli.ts) | CLI `new-app`, `--from-prd` ; `demo-app` déprécié (exit 1). |
| [`src/github-repos.ts`](../src/github-repos.ts) | Création + push des 2 repos GitHub privés d'une marque (monorepo + `<brand>-admin`) — **opt-in `--push` uniquement** (sans ce flag : zéro réseau, zéro résolution de token) ; token env `GITHUB_TOKEN`/`CREEZIO_GITHUB_TOKEN` ou `.github-token` seulement si `--push` ; vendor + package-lock synchronisés AVANT push. |
| [`src/index.ts`](../src/index.ts) | Exports publics |
| [`src/kit-release.ts`](../src/kit-release.ts) | Version lockstep + SoT `SERVER_CREEZIO_DEPS` / `UI_CREEZIO_DEPS` / `CLIENT_CREEZIO_DEPS` (granola, grokbot, nav inclus) + `creezioNpmDeps` / `.npmrc` généré (npmjs.org, aucun token) ; `--link-kit` (`file:` worktree). |
| [`src/minimal-png.ts`](../src/minimal-png.ts) | Icône placeholder |
| [`src/npm-isolated.ts`](../src/npm-isolated.ts) | Spawn npm isolé au projet marque (`--prefix` + env prefix/workspace stripé) — `creezio upgrade` / `ensureBrandPackageLocks` ne touchent jamais le `node_modules` du kit. |
| [`src/package-lock.ts`](../src/package-lock.ts) | Cohérence package.json ↔ package-lock (npm ci Docker) — régénération lock-only / install ; `--link-kit` pin worktree. |
| [`src/plugin-templates.ts`](../src/plugin-templates.ts) | Installation des templates de plugins kit (`templates/plugins/<id>/`) dans le répertoire plugins d'une app (`<userData>/plugins/<id>/` + `.enabled`). |
| [`src/prepare-brand-distribution.ts`](../src/prepare-brand-distribution.ts) | Locks après chaque scaffold (brand create / new-app / brand apply). |
| [`src/product-model.ts`](../src/product-model.ts) | `ProductModel`, `parseProductPrd` (extrait `## Entités` ou échoue ; pas de fallback notes). |
| [`src/scaffold-from-prd.ts`](../src/scaffold-from-prd.ts) | Artefacts métier / wiring |
| [`src/scaffold.ts`](../src/scaffold.ts) | Scaffold OS + branche PRD |
| [`src/server-docker-agent-tunnel.ts`](../src/server-docker-agent-tunnel.ts) | T7 — helpers purs du tunnel cloudflared DÉDIÉ agent : container `creezio-agent-tunnel`, env file 600, run-args `--protocol http2`, `needsDedicatedAgentTunnelMigration` / `parseAgentPublicUrl` (migration auto à `agent up`), persist `agentUrl` dans `fleet-hosts.json`. I/O privilégié : direct → `sudo -n` → wrapper `/usr/local/sbin/creezio-server-docker priv-io` ; EACCES → `formatStackFileEaccesError` (fail-closed, jamais chmod). |
| [`src/server-docker-cli.ts`](../src/server-docker-cli.ts) | CLI `creezio server-docker` — create/start/stop/rm/logs/ls, build/up/down/proof, `publish` (+ rétention locale ou GHCR, label OCI `org.opencontainers.image.source` dérivé du remote git marque — fail-closed si `ghcr.io` et remote introuvable, `--release` = déclaration draft dans l'app admin), `registry-gc` (GC registre local ou GHCR), `admin up`, `agent up` (migration auto tunnel dédié si hôte déjà enrôlé), `agent rm` (seul geste qui retire DNS agent), `enroll` (`provisionDedicatedAgentTunnel`), `ensure-owner` (seed + persist `secrets.env` 600). `update` préserve sidecar + **réutilise `hostPort` persisté** ; I/O des env_file 600 via le même chemin privilégié que `persistDedicatedAgentUrl`. `migrate-stack` seul retire le sidecar (même tunnel). `rm` d'instance = `deprovisionCfSlug` sans DNS agent. |
| [`src/server-docker-ghcr-gc.ts`](../src/server-docker-ghcr-gc.ts) | Rétention / GC GHCR via l'API GitHub Packages (versions) : `registry-gc --registry ghcr.io/<owner>` + post-`publish` — ≥ 3 semver, jamais in-use / servers.json, fail-closed sans auth. |
| [`src/server-docker-owner.ts`](../src/server-docker-owner.ts) | Politique `server-docker create` fail-closed owner : `CREEZIO_OWNER_EMAIL` / `_PASSWORD` requis sauf `CREEZIO_TUNNEL_LOCAL=1` ; first-run `POST /api/v1/os/setup` + vérif login ; persist `secrets.env` 600 ; `ensure-owner` + `CREEZIO_E2E_*` optionnels (recette) ; après setup, `GET .../interactive-demo/scenarios` ≥ 1 (sauté si owner skip / LOCAL) ; jamais le mot de passe en log. |
| [`src/server-docker-registry-gc.ts`](../src/server-docker-registry-gc.ts) | `creezio server-docker registry-gc` — GC fail-closed du registre Docker local (`registry:2`) : API v2 catalogue/tags/delete, rétention `--keep N` (défaut 2) par famille (`auto.*` / semver ≥ 3 indépendants), tags protégés (conteneurs en cours, `docker-data/servers.json`, releases fleet), `registry garbage-collect`. Dry-run par défaut, `--apply` exécute. Même politique sur `publish`. |
| [`src/server-docker-registry.ts`](../src/server-docker-registry.ts) | Registre d'instances serveur Docker par marque — SoT `docker-data/servers.json` (image `creezio-server-<brandId>`, containers `<brandId>-server-<nom>`). Lecture/écriture via I/O privilégié (direct / `sudo -n` / wrapper `priv-io`) ; EACCES fail-closed (jamais « premier create » silencieux). |
| [`src/server-docker-tunnel.ts`](../src/server-docker-tunnel.ts) | Politique `server-docker create` fail-closed : contrat CF (`CREEZIO_CF_API_TOKEN` / `_ACCOUNT_ID` / `_ZONE_ID`) requis sauf `CREEZIO_TUNNEL_LOCAL=1` ; slug réservé → `<brand>-<slug>` ; secrets CF hors registre (`cf.env` 600). |
| [`src/server-docker-ufw.ts`](../src/server-docker-ufw.ts) | Préflight UFW fail-closed des ports flotte consommés depuis les conteneurs (18800 backend, 18810 host-agent) : règle `172.16.0.0/12 → 172.17.0.1:<port>` détectée/posée (root ou `sudo -n`, re-vérifiée) à `agent up`/`admin up`/`enroll`, sinon erreur avec la commande exacte — incident 10–30/08/2026. |
| [`src/sync-creezio-deps.ts`](../src/sync-creezio-deps.ts) | Sync des deps `@creezio/*` d'une marque avec la SoT kit (rôles root/server/server-ui/client ↔ `SERVER/UI/CLIENT_CREEZIO_DEPS`) : bump + ajout des manquantes, jamais de suppression (extras = warning). Partagé entre `creezio upgrade` et `scripts/propagate-brands.mjs`. |
| [`src/upgrade-cli.ts`](../src/upgrade-cli.ts) | `creezio upgrade` (P3.a) — détection version d'architecture marque, chaîne de codemods H* dans l'ordre (idempotence vérifiée), sync `@creezio/*` tous manifests via `sync-creezio-deps.ts` (bump + ajouts SoT, `--package-lock-only`), rematérialisation os-ui, doctor fail-closed, `--dry-run`. |
| [`src/write-app-file.ts`](../src/write-app-file.ts) | Écriture des fichiers d'app marque — respecte le marker `creezio:owned-by-brand` même avec `--force` (merge package.json, jamais de wipe du métier enrichi). |

## `src/generators/`

| Fichier | Rôle |
|---|---|
| [`src/generators/api.ts`](../src/generators/api.ts) | API métier HTTP |
| [`src/generators/brand-workflows.ts`](../src/generators/brand-workflows.ts) | Génère `ci.yml` (anti-régression) + `deploy.yml` (CD self-hosted) pour chaque marque npm — plus de workflows vendor. |
| [`src/generators/index.ts`](../src/generators/index.ts) | Re-exports |
| [`src/generators/linux-e2e.ts`](../src/generators/linux-e2e.ts) | Artefacts pack Linux / E2E / env pour `--from-prd` (wrappers minces vers desktop-tooling, metier-base, `.env.example`). |
| [`src/generators/meili-feed-presets.ts`](../src/generators/meili-feed-presets.ts) | Registre factory des presets Meili (id libre côté OS) — inline `meili-feed.ts` dans la marque, pas de preset runtime kit. |
| [`src/generators/modules-registry.ts`](../src/generators/modules-registry.ts) | Socle registre modules (types H9, index, stubs, collecteurs) partagé scaffold + `brand module init`. |
| [`src/generators/native-runtime.ts`](../src/generators/native-runtime.ts) | Générateurs du runtime natif OS d'une marque — SQLite + api-kernel (EntitySpec CRUD), pas de sidecar JSON. |
| [`src/generators/nav.ts`](../src/generators/nav.ts) | Nav shell-ui |
| [`src/generators/os-ui.ts`](../src/generators/os-ui.ts) | Catalogue des pages OS Next (SoT `@creezio/os-ui/routes`) — matérialisées sous `ui/app/(creezio-os)/` (gitignoré), plus versionnées dans la marque. |
| [`src/generators/schema.ts`](../src/generators/schema.ts) | SQL + schema TS brand |
| [`src/generators/server-docker-scripts.ts`](../src/generators/server-docker-scripts.ts) | Scripts npm `server-docker:*` + résolveur CLI kit générés dans chaque app (héritage du serveur Docker sans copie). |
| [`src/generators/tests.ts`](../src/generators/tests.ts) | Smokes générés |
| [`src/generators/ui.ts`](../src/generators/ui.ts) | Pages Next + SPA |
| [`src/generators/verify-prod.ts`](../src/generators/verify-prod.ts) | Générateur `scripts/verify-prod.mjs` (vérification E2E canonique, skill fleet-ops §3b) matérialisé dans toute app générée : checks plateforme par profil brand/admin (version, login E2E via `secrets.env`, auth/me, browse `engine:"meili"`, llm-status), extension métier `verify-prod.local.mjs`. |
| [`src/generators/wiring.ts`](../src/generators/wiring.ts) | Twins paths/host-stack/boot |

## `templates/plugins/insights-assistant/`

| Fichier | Rôle |
|---|---|
| [`templates/plugins/insights-assistant/index.js`](../templates/plugins/insights-assistant/index.js) | Sidecar du template `insights-assistant` : découverte des modules via `/api/v1/core/architecture`, échantillonnage plafonné, synthèse LLM (`llm:use`), cache `data/plugin.sqlite`. Zéro métier marque. |

## `templates/plugins/insights-assistant/migrations/`

| Fichier | Rôle |
|---|---|
| [`templates/plugins/insights-assistant/migrations/001_init.sql`](../templates/plugins/insights-assistant/migrations/001_init.sql) | Migration initiale du cache de synthèses du plugin (appliquée par le sidecar, table `_plugin_migrations`). |
