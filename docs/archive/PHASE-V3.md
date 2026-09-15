# Phase V3 — Automations data-driven natives

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` |
| **Prérequis** | [PHASE-V2.md](PHASE-V2.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** |

---

## Objectif

Contrat événementiel (hooks/triggers) sur lifecycle plugin/org et changements
de données, avec preuve demobrand ; pont optionnel n8n (tag + webhook) **sans**
casser les marques ni exiger un n8n vivant.

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | Package `@creezio/automations` **lifecycle-only** (triggers, rules, actions, engine) — ≠ Database row-level | ✅ |
| 2 | Demobrand — règles défaut + dispatch install / data / factory | ✅ |
| 3 | API `/api/v1/platform/automations/*` | ✅ |
| 4 | Intégration optionnelle n8n : `n8n_tag_hint` + `webhook` (skip si pas d’URL) | ✅ |
| 5 | Tests `scripts/test-phase-v3.mjs` | ✅ |
| 6 | Docs PHASE-V3 + [VISION-V1-V3.md](VISION-V1-V3.md) | ✅ |
| 7 | Push kit — pas de republish marques | ✅ |

## Triggers

| Type | Quand (demobrand) |
|------|-------------------|
| `plugin.installed` | `installPlugin` / factory materialize |
| `plugin.uninstalled` | `uninstallPlugin` |
| `plugin.released` | fin materialize factory |
| `factory.materialized` | materialize OK |
| `org.data_changed` | écriture KV plugin (`dataLayer: plugin`) |
| `observability.recorded` | (extensible) |

## Actions

| Type | Comportement |
|------|----------------|
| `emit_observability` | Écrit un événement activité V2 |
| `log` | Logger adapter |
| `webhook` | POST JSON si URL (`N8N_AUTOMATION_WEBHOOK_URL` ou action.url) — sinon **skip OK** |
| `n8n_tag_hint` | Calcule `pluginN8nTag` (contrat tag-registry existant) |

## Preuves E2E

1. Factory materialize → runs `plugin.installed` + `factory.materialized` + tag n8n
2. POST KV plugin → `org.data_changed` → `automation.data_changed` dans obs
3. Webhook sans URL → skipped, pas d’échec
4. API list rules / runs

## Hors scope

- Workflows n8n HTTP réels obligatoires
- Auto-promotion plugin→module
- Univers perso / cloud registry

## Critères DoD

- [x] Engine + règles demobrand
- [x] Preuve data-driven + lifecycle
- [x] n8n optionnel non bloquant
- [x] Tests verts + npm test kit
- [x] Sign-off vision V1–V3
- [x] Push kit

## Verdict

**Phase V3 : TERMINÉE.** Vision V1–V3 : [VISION-V1-V3.md](VISION-V1-V3.md).
