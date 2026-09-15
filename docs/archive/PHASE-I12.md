# Phase I12 — UI nav shell-ui adapters + MCP une entrée (TempoFlow)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `tempoflow2` (+ doc kit) |
| **Prérequis** | [PHASE-I11.md](PHASE-I11.md), [PHASE-I7.md](PHASE-I7.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** |

---

## Objectif

Next consomme `createNavShellAdapter` (mergedNav / render model) ;
marque = `registerBrandNav` only ; gate MCP = **une** entrée publique `/mcp`.

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `electron/modules/nav-shell.ts` + façade `creezio-nav-shell` | ✅ |
| 2 | Sidebar Next lit labels/href brand depuis adapter | ✅ |
| 3 | API `GET /api/v1/shell/nav` | ✅ |
| 4 | `mcp-entry.ts` + assert single public entry | ✅ |
| 5 | Tests `test:phase-i12` | ✅ |
| 6 | Ce fichier | ✅ |

## Verdict

**Phase I12 : TERMINÉE.** Suite : **I13** (conso auth/assistant/tasks/mails).
