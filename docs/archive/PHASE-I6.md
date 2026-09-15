# Phase I6 — Propagation org registre persisté

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` — `@creezio/propagation` + console |
| **Prérequis** | [PHASE-I0.md](PHASE-I0.md) |
| **ARCHITECTURE_VERSION** | inchangé (`H5`) |
| **Republish marques** | **Non** |

---

## Objectif

Remplacer le registre purement mémoire par une persistance fichier pour
console / dry-run remontée L3.

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `createFileOrgPluginRegistry` | ✅ |
| 2 | Console `GET/POST /api/org-plugins` + panel | ✅ |
| 3 | Tests list/upsert/review + reopen | ✅ |
| 4 | Ce fichier | ✅ |

## Fichier défaut

`var/org-plugin-registry.json` (override `CREEZIO_ORG_PLUGIN_REGISTRY_PATH`).

## Hors scope

- Cloud registry multi-tenant
- Auto-promotion

## Verdict

**Phase I6 : TERMINÉE.** Prêt pour **I7** (shell-ui adapters).
