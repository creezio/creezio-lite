# Creezio — OS desktop & serveur pour marques

> **Agents/devs : lisez d'abord [docs/RUNBOOK-AGENTS.md](./docs/RUNBOOK-AGENTS.md)** — topologie serveurs, release kit→apps, runners, gates CI, deploy, cookbook incidents.

Creezio est un **kit plateforme** (monorepo `@creezio/*`) : un « OS » complet
d'application métier — auth, shell UI, API, MCP, assistant IA, tâches, mails,
observabilité, plugins, runtime Electron, serveur Docker headless — que des
**marques** (TempoFlow, Foove, Winhub, Certivan, Fidu…) consomment en y ajoutant uniquement
leur métier vertical. Une nouvelle marque se crée depuis un brief produit,
sans réécrire le socle.

> **Écosystème privé (décision actée).** Les packages `@creezio/*` sont
> publiés sur GitHub Packages en **registre privé** — écosystème fermé assumé.
> Toute installation (`npm ci` / `npm install`, kit ou app) exige
> `CREEZIO_NPM_TOKEN` = PAT GitHub `read:packages` d'un compte membre de
> l'org creezio (`gh auth token` si `gh` est authentifié, sinon créer le PAT
> sur github.com/settings/tokens). Le `.npmrc` des repos consomme cette
> variable — jamais de token commité.

## Architecture en bref

```
                      ┌──────────────────────────────┐
                      │        kit creezio           │
                      │  packages/@creezio/* (36)    │
                      └──────────────┬───────────────┘
                                     │  packages npm @creezio/* (GitHub Packages)
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
   marque A (tempoflow3)        marque B (certivan)          marque C (fidu)
   métier + BrandSpec           métier + wiring              métier + wiring

Chaque marque se déploie en 4 modes (même code) :
 1. Desktop Electron complet   — startBrandDesktop, embeds locaux (SQLite,
                                 Hermes, n8n, Meilisearch)
 2. Serveur Docker headless    — creezio server-docker, kernel harness sans
                                 Electron, CRM servi en HTTP
 3. Client desktop « thin »    — Electron remote-only pointé sur un serveur
                                 (defaultServerUrl)
 4. Sidecar navigateur IA      — Chromium piloté par CDP (browser-host) pour
                                 les sessions web des agents
```

Détails : [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Quickstart

```bash
npm install
npm run build:packages   # tsc tous les packages + dual CJS
npm run test:kit         # gates pures kit — doivent être 100 % vertes
```

Suites de tests complémentaires (voir [scripts/README.md](./scripts/README.md)) :
`npm run test:brands` (nécessite les clones locaux des repos marque, skip auto sinon)
et `npm run test:env` (gates lourdes opt-in).

## Commandes clés

```bash
# Happy path — app vide (pas de notes, pas de crm/)
npx creezio brand create --id acme --name Acme --domain acme.local

# Legacy — brief produit (PRD, vertical: chr ou ## Entités)
npx creezio new-app --from-prd <PRD.md> --out apps/<id> --force

# Créer/mettre à jour une marque depuis un BrandSpec YAML
npx creezio brand apply --spec brand-spec/
npx creezio brand doctor --spec brand-spec/

# demo-app est déprécié (exit 1) — utiliser brand create

# Serveur Docker headless multi-instances (+ console admin)
npx creezio server-docker create --brand-root <racine-marque> --name server-1
npx creezio server-docker admin up
npx creezio server-docker admin add-brand <racine-marque>

# Propagation kit → marques : changeset (`npx changeset`) → merge main →
# PR « version packages » → publication npm → `npm update "@creezio/*"` marque
# (docs/NPM-DISTRIBUTION.md). Outils d'analyse internes :
npm run kit:impact -- --package=@creezio/platform-core
npm run kit:version -- --package=@creezio/shell --bump=patch
```

Toute app générée = **2 repos** : le monorepo marque (`server/` métier +
Docker, `client/` desktop thin remote-only, `brand-spec/` à la racine)
**et** un repo admin dédié privé `<brand>-admin`
(app admin de la marque : flotte, support, billing…) — voir
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Les 32 packages

30 publiés en **lockstep 0.10.8** + `@creezio/factory` **0.6.6** (CLI,
privé, hors lockstep) + `@creezio/propagation` 0.1.6. **CLI =
`CREEZIO_KIT_ROOT`**, pas le pin app — [docs/README.md](./docs/README.md).

| Package | Rôle |
|---------|------|
| `brand-config` | AppManifest : identité desktop, feeds, GUID, publish |
| `shell` | Preload / IPC contracts / DesktopBridge |
| `platform-core` | Paths, SQLite multi-fichier (`core`/`brand`/`plugin`), embeds env |
| `product-hub` | Product Hub, ACL plugins, PRD factory |
| `api-kernel` | Façade HTTP `/api/v1` (core/platform/modules/plugins) |
| `mcp-facade` | MCP unifié, OAuth, host tools |
| `auth` | Session, login, recovery |
| `access-control` | Rôles / permissions déclaratifs, overrides DB, écran « Rôles & accès » |
| `shell-ui` | Nav + chrome CRM UI (React) |
| `os-ui` | Surfaces Next OS natives (mails, tâches, setup, admin…) matérialisées dans les marques |
| `onboarding` | Setup first-run + moteur d'onboarding |
| `interactive-demo` | Démo interactive native (product tour live joué par un faux curseur, scénarios éditables en DB) |
| `cockpit` | UI server-cockpit (shell autonome + client CRM) |
| `assistant` | Chat / Hermes Work / tools IA |
| `tasks` | Kanban + missions IA |
| `mails` | Inbox mails |
| `support` | Tickets support serveur marque (page `/support` + export admin) |
| `integrations` | Clés API tierces (`integration://<slug>`, secret-box, sync n8n) |
| `granola` | Module Granola : webhook signé (Standard Webhooks) + sync notes/transcripts via API |
| `grokbot` | Pilotage d'agents cloud via l'API Cursor v1 (token, agents, runs, usage, artefacts) |
| `observability` | Ops, fleet, analytics, request-logs |
| `landing` | Landing page publique de marque (`lp.{zone}`, contenu DB éditable admin) |
| `admin` | Modules natifs des apps admin de marque (fleet, support, prospection, roadmap, billing) |
| `automations` | Lifecycle automations plugins/org |
| `database` | Admin Database CRUD |
| `electron-shell` | Host Electron : boot, updater, tray, plugins, sidecars, Meili |
| `browser-host` | Chromium serveur IA (CDP, driver `external_*`, screencast) |
| `app-runtime` | Façade marque n°1 : `startBrandDesktop` / kernel harness / compose OS |
| `brand-spec` | BrandSpec YAML (SoT déclaratif marque) + doctor |
| `desktop-tooling` | Publish desktop, remote-build, after-pack, build-status |
| `factory` | `creezio new-app` / `brand apply` / `server-docker` |
| `propagation` | Semver, impact kit→marques, registre org |

Index détaillé : [docs/PACKAGES.md](./docs/PACKAGES.md) — chaque package (et
chaque zone `docker/*`) a son trio `README.md` / `AGENTS.md` / `docs/FILES.md`,
vérifié par la gate `test-phase-docs-freshness`
(standard : [docs/DOC-STANDARD.md](./docs/DOC-STANDARD.md)).

`apps/console` = console ops du parc ; `apps/demobrand` = sandbox kit (pas un
produit client).

## Documentation

| Entrée | Contenu |
|--------|---------|
| [docs/README.md](./docs/README.md) | Hub docs : runbook, CREATE-MODULE, standard module, contrat secrets, factory 0.6.6 vs lockstep 0.10.8 |
| [docs/RUNBOOK-AGENTS.md](./docs/RUNBOOK-AGENTS.md) | Topologie (Winhub, TempoFlow, **Foove** `*.crm.foove.io`), release, deploy |
| [docs/agents/CREATE-MODULE.md](./docs/agents/CREATE-MODULE.md) | Créer un module (5 fichiers + `gate.mjs`) |
| [docs/DOC-STANDARD-MODULE.md](./docs/DOC-STANDARD-MODULE.md) | Contrat module |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Modes de déploiement, boot, admin, navigateur IA, propagation |
| [docs/PACKAGES.md](./docs/PACKAGES.md) | Index de tous les packages |
| [docs/DOC-STANDARD.md](./docs/DOC-STANDARD.md) | Standard documentaire (trio, format FILES.md, règles éditoriales) |
| [docs/adr/](./docs/adr/) | Décisions d'architecture (ADR) en vigueur |
| [docs/BACKLOG.md](./docs/BACKLOG.md) | Dettes restantes assumées |
| [docs/archive/](./docs/archive/) | Journal historique de construction (ne décrit pas l'état courant) |
| [AGENTS.md](./AGENTS.md) | Guide agents IA (frontières, où modifier, pièges) |

## Frontières

- Le kit est la **source of truth plateforme** ; le métier vertical vit dans
  les repos marque (pas de domaine marque dans `@creezio/*` —
  [ADR](./docs/adr/ADR-no-brand-domain-in-native-packages.md)).
- Isolation DB stricte `core` / `brand` / `plugin/<id>`.
- Les marques consomment le kit en packages npm publiés
  (`@creezio/*` sur GitHub Packages — `docs/NPM-DISTRIBUTION.md`).
