# @creezio/factory

## Rôle

CLI `creezio` pour générer une application marque Client + Serveur
consommant `@creezio/*`. Happy path : **`creezio brand create`**
(voir [CREATE-APP.md](../../docs/agents/CREATE-APP.md)). `demo-app` est
déprécié (exit 1). `--from-prd` reste le legacy TempoFlow3.

## Happy path — `brand create`

```bash
creezio brand create --id acme --name Acme --domain acme.local --out /tmp/acme
# Repos GitHub : ajouter --push (token GITHUB_TOKEN requis).
```

Squelette OS + registre vide + mount interactive-demo + arbre `<id>-admin`
**locaux**. Zéro notes, zéro `server/crm/`. `--push` crée les 2 repos
GitHub privés ; sans ce flag : aucun appel réseau, même si un token est
présent (env / `.github-token`). `--no-push` est le défaut (redondant).

## Mode produit — `--from-prd` (legacy)

```bash
creezio new-app \
  --from-prd docs/experiences/tempoflow3/PRD-PRODUIT.md \
  --out /tmp/tempoflow3
```

1. Parse le PRD → `ProductModel` (entities, pages, flows, platformNeeds).
2. Dérive `brandId` / `name` / `domain` (ex. TempoFlow → `tempoflow3`).
3. Génère OS shell + métier marque (schéma, API HTTP, pages, nav, wiring).
4. Fournit `npm run test:metier-parcours` (fournisseurs → panier → commande).

Les smokes générés respectent la cohérence éventuelle Meili (contrat kit :
pas de write-through, liste servie `engine:"indexing"` pendant l'indexation
initiale) : read-after-write déterministe par `GET ?ids=<id>` (hydratation
PK, chemin SQL légitime) puis polling borné (60 s) jusqu'à visibilité dans
la liste, avec échec explicite si `engine:"meili"` sans le doc — helper SoT
`@creezio/desktop-tooling/scripts/meili-list-poll.mjs`.

### Mode technique — flags

```bash
creezio new-app \
  --name DemoBrand \
  --id demobrand \
  --domain demobrand.creez.io
```

Squelette OS + slot métier vide (comportement historique Phase D).

### Serveur Docker headless

```bash
creezio server-docker proof --brand-root "$BRAND_ROOT"
```

Image générique + Compose multi-instances (`server-1` / `server-2`) —
SoT dans `docker/server/` (sans Electron/AppImage). Voir `docker/server/README.md`.

`server-docker publish` pousse une image versionnée au registre
(rétention auto) et pose le label OCI
`org.opencontainers.image.source=https://github.com/<org>/<repo-marque>`
dérivé du remote git `origin` du brand-root (fail-closed si le registre
est `ghcr.io` et que le remote est introuvable). `publish --release`
déclare en plus la release (status `draft`) dans l'app admin de la
marque (`--admin-app <url>` ou env `CREEZIO_FLEET_ADMIN_URL`,
`--channel stable` par défaut) pour le déploiement flotte en pull —
voir la skill
[creezio-fleet-ops §4b](../../.cursor/skills/creezio-fleet-ops/SKILL.md).

`server-docker registry-gc` purge le registre Docker local (`registry:2`,
`127.0.0.1:5000`) **ou** GHCR (`--registry ghcr.io/<owner>`) : garde les N
tags les plus récents **par famille** (`auto.*` / semver — plancher 3
semver côté GHCR, `--keep`, env `CREEZIO_REGISTRY_GC_KEEP`) **et** tout
tag protégé : conteneur en cours, `docker-data/servers.json` (`--brand-root`
+ labels `creezio.brand-root`), releases fleet (`--admin-app` /
`CREEZIO_FLEET_ADMIN_URL`). Local : DELETE manifests + `registry
garbage-collect`. GHCR : API Packages versions (auth `GHCR_TOKEN` /
`GITHUB_TOKEN` / `.github-token` obligatoire). **Dry-run par défaut** —
`--apply` exécute. Voir skill fleet-ops §10.

### Templates plugins (`templates/plugins/`)

Plugins **génériques kit** prêts à installer dans toute marque (seed
`<server>/plugins/` → runtime au boot). Exemple vivant :
`insights-assistant` (synthèse IA des modules découverts via
`/api/v1/core/architecture` — zéro métier marque, permissions
`crm:read`+`llm:use`, DB cache `data/plugin.sqlite`). Le scaffold
(`new-app` / `brand create` / `brand apply`) appelle
`installKitPluginTemplate({ templateId: "insights-assistant", … })` —
sans cet appel le repo marque part à 0 plugins. Gate E2E :
`scripts/test-phase-plugin-insights.mjs`. Guide auteur :
[CREATE-PLUGIN](../../docs/agents/CREATE-PLUGIN.md).

## Monter de version — `creezio upgrade`

```bash
creezio upgrade [--brand-root <dir>] [--dry-run] [--no-install]
```

Rejoue la montée de version d'un repo marque : chaîne de codemods
d'architecture (idempotence prouvée à chaque pas), puis **synchronisation
des deps `@creezio/*`** de tous les manifests (racine, `server`,
`server/ui`, `client`) avec la SoT du kit installé
(`SERVER/UI/CLIENT_CREEZIO_DEPS`, `src/kit-release.ts`) :

- deps existantes → bump vers `^<lockstep kit>` ;
- deps requises manquantes → **ajoutées** (le trou historique : os-ui
  0.20.0 matérialise `/granola` et `/grokbot` sur une marque sans ces deps
  → build cassé) ;
- dep `@creezio/*` hors SoT → **jamais supprimée**, warning listé ;
- lockfiles régénérés via `npm install --package-lock-only` (jamais
  `npm update`) ; `--dry-run` liste bumps et ajouts sans rien écrire.

Le même moteur (`src/sync-creezio-deps.ts`) alimente le rollout flotte
`scripts/propagate-brands.mjs`. Le doctor brand-spec vérifie en fail-closed
que toute page os-ui a ses deps déclarées (`OS_UI_PAGE_DEP_MISSING`).

## Options

| Option | Description |
|--------|-------------|
| `--from-prd` | Chemin PRD markdown |
| `--name` / `--id` / `--domain` | Requis sans PRD ; overrides avec PRD |
| `--out` | Dossier cible (défaut `apps/<id>`) |
| `--env-prefix` | Préfixe env |
| `--feed-token` | Token feed sandbox |
| `--sandbox` / `--no-sandbox` | Flag sandbox (défaut oui) |
| `--force` | Écrase les fichiers existants |
| `--push` | Crée + pousse les 2 repos GitHub privés (opt-in ; token requis). Défaut = local. |
| `--no-push` | Défaut (redondant) : aucun appel GitHub. |
| `--link-kit` | Installe `@creezio/*` depuis le worktree kit (`file:`), pas le registre. Équivalent : `CREEZIO_LINK_KIT=1`. Les manifests restent `^<lockstep>`. Requis en CI / PR de release (version pas encore publiée). |

## API publique

```ts
import {
  scaffoldNewApp,
  parseProductPrd,
  safeBrandId,
  parseArgs,
  runCli,
} from "@creezio/factory";
```

## Artefacts `--from-prd`

- `product-model.json`
- `product-model.json` + registre `modules/<entité>.ts` (jamais notes par défaut)
- `scripts/test-metier-parcours.mjs` (pas de sidecar `metier-api.mjs`)
- `ui/app/**` pages App Router métier (`/dashboard`, entités)
- `src/electron/main.ts` → `startBrandDesktop`
- **interdit** : `server/crm/`, `src/lib/host-stack.ts`

## Build

```bash
npm run build -w @creezio/factory
npm run typecheck -w @creezio/factory
```

## Voir aussi

- `AGENTS.md`
- `docs/adr/ADR-factory-from-prd.md`
- `docs/experiences/tempoflow3/`
