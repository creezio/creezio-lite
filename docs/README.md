# Documentation kit Creezio

Point d'entrée unique. Un agent qui débarque lit **d'abord** le runbook, puis
le contrat module, puis crée.

## Agents — lire dans cet ordre

| Doc | Quand |
|-----|--------|
| **[RUNBOOK-AGENTS.md](./RUNBOOK-AGENTS.md)** | Opérer l'écosystème : topologie VPS, release kit→apps, runners, gates, deploy, cookbook. **CLI = `CREEZIO_KIT_ROOT`, pas le pin app.** |
| **[agents/CREATE-MODULE.md](./agents/CREATE-MODULE.md)** | Ajouter un module métier dans un repo marque |
| **[DOC-STANDARD-MODULE.md](./DOC-STANDARD-MODULE.md)** | Contrat module : **5 fichiers** (`prd.md`, `interview.md`, `TODO.md`, `CHANGELOG.md`, `gate.mjs`) |
| **[agents/CREATE-BRAND.md](./agents/CREATE-BRAND.md)** | Créer une marque (BrandSpec → doctor → apply → smoke) |

Autres guides : [CREATE-PACKAGE](./agents/CREATE-PACKAGE.md) ·
[CREATE-PLUGIN](./agents/CREATE-PLUGIN.md) ·
[CREATE-ADMIN-MODULE](./agents/CREATE-ADMIN-MODULE.md).

## Contrat secrets unique

Un seul contrat, partout (VPS, CI, `server-docker create`, cloud agents).
**Jamais** de secret en clair (commande, log, fichier commité, compose
`environment:`).

| Variable | Rôle |
|----------|------|
| `CREEZIO_NPM_TOKEN` | PAT GitHub `read:packages` (membre org creezio) — `npm ci` / `npm install` kit **et** apps, secret BuildKit Docker. Le `.npmrc` consomme `${CREEZIO_NPM_TOKEN}` — jamais de token commité. |
| `CREEZIO_CF_API_TOKEN` | Token Cloudflare (Tunnels + DNS zone) — auto-provisioning tunnel au boot |
| `CREEZIO_CF_ACCOUNT_ID` | Compte Cloudflare |
| `CREEZIO_CF_ZONE_ID` | Zone DNS de **la marque** (pas seulement `tempoflow.fr`) |
| `CREEZIO_CF_ZONE_NAME` | Optionnel — hostname `{slug}.{zone}` (ex. `crm.foove.io` → `{slug}.crm.foove.io`) |
| `CREEZIO_OWNER_EMAIL` | First-run owner VPS/prod (`server-docker create`) — persisté dans `docker-data/stacks/<nom>/secrets.env` (600), **pas** dans le registre |
| `CREEZIO_OWNER_PASSWORD` | First-run owner VPS/prod — **jamais** loggé ; même fichier `secrets.env` |
| `CREEZIO_E2E_EMAIL` | Optionnel — compte recette / smoke (`ensure-owner` le seed s'il manque) |
| `CREEZIO_E2E_PASSWORD` | Optionnel — recette / smoke — **jamais** loggé |

Détail tunnel / owner : [RUNBOOK-AGENTS.md §7.3](./RUNBOOK-AGENTS.md) et
§7.2. Dev local : `CREEZIO_TUNNEL_LOCAL=1` (CF + owner optionnels).

## Versions — factory ≠ lockstep

| Ensemble | Version | Quoi |
|----------|---------|------|
| **Lockstep** (groupe `fixed` changesets) | **0.10.8** | Packages **publiés** `@creezio/*` (runtime, UI, brand-spec…) — pin app `^0.10.8` |
| **`@creezio/factory`** | **0.6.6** | CLI `creezio` (privé, **hors** lockstep) — `new-app`, `brand *`, `server-docker` |
| **`@creezio/propagation`** | 0.1.6 | Outillage interne, hors lockstep |

**CLI = clone kit (`CREEZIO_KIT_ROOT`), pas le pin app.** Le pin `^0.10.8`
est la version **consommée** au runtime / dans l'image. `creezio` /
`scripts/creezio-cli.mjs` résout
`$CREEZIO_KIT_ROOT/packages/factory/bin/creezio.js` **avant**
`node_modules/@creezio/factory`. Toujours pointer le clone kit du VPS
(`CREEZIO_KIT_ROOT=/opt/docker/creezio` ici) pour create / update / doctor /
apply — jamais « la factory pinnée dans l'app ».

## Par package (préféré)

→ **[PACKAGES.md](./PACKAGES.md)** — index README / AGENTS / FILES de chaque `@creezio/*`.

→ **[../AGENTS.md](../AGENTS.md)** — règles globales pour agents.

→ **[../README.md](../README.md)** — 30 packages, quickstart.

## Architecture & intention

| Doc | Sujet |
|-----|--------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Modes de déploiement, boot, admin, navigateur IA, propagation |
| [ARCHITECTURE-INTENTION.md](./ARCHITECTURE-INTENTION.md) | Intention 3 couches (décisions verrouillées) |
| [MATRICE-NATIVE-METIER-PLUGIN.md](./MATRICE-NATIVE-METIER-PLUGIN.md) | Qui possède quoi : natif / métier / plugin |
| [PLATFORM-VS-VERTICAL.md](./PLATFORM-VS-VERTICAL.md) | Règles de décision kit vs marque |
| [PROPAGATION.md](./PROPAGATION.md) | Propagation kit→marques |
| [NPM-DISTRIBUTION.md](./NPM-DISTRIBUTION.md) | Publication GitHub Packages, lockstep 0.10.8 vs factory 0.6.6 |
| [RUNBOOK-FLOTTE.md](./RUNBOOK-FLOTTE.md) | Gestes flotte (zones/hostnames = ceux de **la marque**) |
| [BACKLOG.md](./BACKLOG.md) | Dettes restantes assumées |
| [adr/](./adr/) | Décisions d'architecture (ADR) en vigueur |

## Agents & fixtures

- [agents/CREATE-BRAND.md](./agents/CREATE-BRAND.md) — créer une marque (BrandSpec)
- [experiences/tempoflow3/](./experiences/tempoflow3/) — fixtures factory `--from-prd`

## Historique

→ **[archive/](./archive/)** — journal de construction (phases, plans,
backlogs d'époque, gates signées, audits). Ne décrit pas l'état courant.
