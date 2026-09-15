# Phase V2 — Observabilité native plateforme

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` |
| **Prérequis** | [PHASE-V1.md](PHASE-V1.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** |

---

## Objectif

Contrats + store **core** pour journaliser l’activité, les usages plugins et
les événements control-plane ; exposition API + console minimale multi-org —
aligné vision Notion (autonomie locale + pilotage global).

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | Package `@creezio/observability` (schema core, memory/sqlite, helpers, API mount) | ✅ |
| 2 | Demobrand — store core + émissions factory / install / API plugin | ✅ |
| 3 | Console — `GET/POST /api/observability` + panel multi-org | ✅ |
| 4 | Tests `scripts/test-phase-v2.mjs` | ✅ |
| 5 | Ce fichier + README / CHANGELOG / matrice | ✅ |
| 6 | Push kit — pas de republish marques | ✅ |

## Contrats

| Kind | Exemples d’actions | Agrégats |
|------|-------------------|----------|
| `activity` | `login`, `factory.intention`, `factory.materialize`, … | par `orgId` |
| `plugin_usage` | `api.get` / `api.post` / `execute` | par `pluginId` + `orgId` |
| `control_plane` | `install`, `uninstall`, `grant`, … | list filtrable |

Persistance cible : SQLite **core** (`creezio_obs_events`).

## Surface API (demobrand)

| Méthode | Path | Rôle |
|---------|------|------|
| GET | `/api/v1/platform/observability/summary` | Totaux + top usage/orgs + récents |
| GET | `/api/v1/platform/observability/events` | Liste filtrable |
| POST | `/api/v1/platform/observability/events` | Enregistrer un événement |
| GET | `/api/v1/platform/observability/usage` | Agrégat usages plugins |
| GET | `/api/v1/platform/observability/orgs` | Agrégat activité multi-org |

## Preuves

1. Factory materialize → `activity` + `control_plane` install
2. Appel API plugin ACL → `plugin_usage`
3. Agrégats org-A vs org-B
4. SQLite reopen conserve les événements

## Hors scope

- Cloud registry / télémétrie SaaS centrale
- Dashboards marques (TF/Fidu/Certivan) — conso progressive hors V2

## Critères DoD

- [x] Package observability + schema core
- [x] API + demobrand émissions
- [x] Console multi-org minimale
- [x] Tests verts + `npm test` kit
- [x] Docs PHASE-V2
- [x] Push kit

## Suite

→ **V3** — Automations data-driven natives (hooks lifecycle / data + preuve demobrand).

## Verdict

**Phase V2 : TERMINÉE.**
