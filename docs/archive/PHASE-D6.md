# Phase D6 — Certivan polish gaps

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `certivan-app` (+ doc kit) |
| **Prérequis** | [PHASE-I16.md](PHASE-I16.md), D0–D5 |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish marques** | **Non** — polish aliases only (pas de runtime packaged critique) |

---

## Audit dualités (post-I16)

| Zone | État | Action D6 |
|------|------|-----------|
| Control-plane HTTP + ACL L3 | ✅ I16 | Aucun gap |
| Foundation SqliteRuntime / modules VASP | ✅ I15 | Aucun gap |
| Aliases MCP src ↔ electron | 🟡 miroir manuel | **Corrigé** — re-export unique |
| Dualité Hono `/mcp` vs façade Electron | Présente (comme TF pré-D1) | **Accepté** — pas de clients OAuth gold TF ; port D1 non requis |
| Stores kit shadow vs Hono | Comme TF pré-D2 | **Accepté** — hors polish ; reprise éventuelle = backlog vision |

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | Audit documenté | ✅ |
| 2 | Aliases source unique (`src/lib` re-export) | ✅ |
| 3 | Ce fichier | ✅ |
| 4 | Push Certivan + kit | ✅ |

## Suite correction

Dualités MCP/stores **acceptées en D6** = demi-mesure documentée.  
**Fermées en C2** : [PHASE-C2.md](PHASE-C2.md).

## Verdict

**Phase D6 : TERMINÉE** — polish aliases ; dualités reportées à **C2**.
