# Phase I11 — Modules catalogue / stack / scan (TempoFlow)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `tempoflow2` (+ doc kit) |
| **Prérequis** | [PHASE-I10.md](PHASE-I10.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** |

---

## Objectif

Lever les 🟡 inventaire H3 : mounts API/MCP brand pour **catalogue**,
**stack**, **scan** ; migrations core vs brand déjà séparées (I9/I10).

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `createCatalogueMount` / `createStackMount` / `createScanMount` | ✅ |
| 2 | Register brand-runtime + `TEMPOFLOW_MOUNTED_MODULE_IDS` | ✅ |
| 3 | MCP tools + aliases legacy (`search_products`, `get_stack`…) | ✅ |
| 4 | Inventaire H3 sans 🟡 bloquant | ✅ |
| 5 | Tests `test:phase-h3` / `test:phase-h4` verts | ✅ |
| 6 | Ce fichier | ✅ |

## Frontière

| Couche | Contenu |
|--------|---------|
| **core** | Auth, Product Hub, ACL H5 |
| **brand** | catalogue / panier / dispatch / releves / stack |
| **scan** | UI only (pas de tables) — mount status |

## Verdict

**Phase I11 : TERMINÉE.** Suite : **I12** (nav shell-ui adapters + MCP gate).
