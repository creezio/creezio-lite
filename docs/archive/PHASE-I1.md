# Phase I1 — Auth sqlite core

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` — `@creezio/auth` + demobrand |
| **Prérequis** | [PHASE-I0.md](PHASE-I0.md) |
| **ARCHITECTURE_VERSION** | inchangé (`H5`) |
| **Republish marques** | **Non** |

---

## Objectif

Livrer `createSqliteAuthStore` (core.db) + migrations `AUTH_CORE_SQL` branchables
depuis `SqliteRuntime`, avec preuve demobrand et tests de session après restart.

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `packages/auth/src/sqlite-store.ts` + driver | ✅ |
| 2 | Export `createSqliteAuthStore` / `OpenSqliteDatabase` | ✅ |
| 3 | demobrand sandbox branche store sqlite | ✅ |
| 4 | README auth (driver injecté documenté) | ✅ |
| 5 | Tests `scripts/test-phase-i1.mjs` | ✅ |
| 6 | Ce fichier | ✅ |

## Hors scope

- Bascule UI login marques
- Recovery métier marque
- Bump `ARCHITECTURE_VERSION`

## Verdict

**Phase I1 : TERMINÉE.** Prêt pour **I2** (assistant sqlite core).
