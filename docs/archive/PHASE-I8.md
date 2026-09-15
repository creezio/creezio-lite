# Phase I8 — Factory + demobrand freeze (H6)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` (+ wrappers sync expect H6) |
| **Prérequis** | I1–I7 |
| **ARCHITECTURE_VERSION** | **`"H6"`** |
| **Republish marques** | **Non** |

---

## Objectif

Figrer le kit pour conso marques : demobrand + factory prouvent H5 + I1–I7 ;
bump `ARCHITECTURE_VERSION` → `H6`.

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `ARCHITECTURE_VERSION = "H6"` | ✅ |
| 2 | Factory scaffold → `createNavShellAdapter` | ✅ |
| 3 | [FEATURE-PARITY-DEMOBRAND-H6.md](FEATURE-PARITY-DEMOBRAND-H6.md) | ✅ |
| 4 | Sync expect H6 (kit + 3 marques) | ✅ |
| 5 | Tests `test-phase-i8.mjs` + suite kit verte | ✅ |
| 6 | Ce fichier | ✅ |

## Décision bump H6

Oui — pin clair pour vendor marques (I9+) : contrats auth/assistant/tasks/mails
sqlite, control-plane ACL helpers, shell-ui adapters, admin plugins, registre org.

## Verdict

**Phase I8 : TERMINÉE.**  
**Kit gelé** — **ouverture TempoFlow I9**.
