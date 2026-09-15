# Phase I17 — Fidu ADR clientSlim + foundation H6

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `fidu` (+ doc kit) |
| **Prérequis** | [PHASE-I16.md](PHASE-I16.md) Certivan republish |
| **ARCHITECTURE_VERSION** | **`"H6"`** (vendor) |
| **Republish marques** | **Non** — [REPUBLISH-POLICY.md](REPUBLISH-POLICY.md) |

---

## Objectif

ADR `clientSlim` + sync vendor H6 + `createSqliteRuntime` + modules GED/CRM
via `registerModuleApi` — zéro métier dans `@creezio/*`.

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | ADR [ADR-FIDU-CLIENTSLIM-I17.md](ADR-FIDU-CLIENTSLIM-I17.md) — **garder `false`** | ✅ |
| 2 | Vendor H6 + `SYNC.json` + deps api-kernel/mcp-facade/shell-ui/auth/… | ✅ |
| 3 | `bootFiduBrandRuntime` + splash/crash visible | ✅ |
| 4 | Modules `dossiers` / `contacts` / `ged` + MCP aliases | ✅ |
| 5 | Tests `electron:compile` + `test:phase-h3` + `test:fidu` | ✅ |
| 6 | Push — **pas** de republish | ✅ |

## Verdict

**Phase I17 : TERMINÉE.** Suite : **I18** (ACL L3 + shell-ui + conso + republish Fidu).
