# Phase I7 — Shell-UI adapters hors demobrand

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` — `@creezio/shell-ui` + demobrand |
| **Prérequis** | [PHASE-I0.md](PHASE-I0.md) |
| **ARCHITECTURE_VERSION** | inchangé (`H5`) |
| **Republish marques** | **Non** |

---

## Objectif

Adapters UI réutilisables pour que les marques consomment la nav Creezio +
slots sans hardcoder.

## Contrat

**Marque = `registerBrandNav` only** (ids `brand.*`).

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `createNavShellAdapter` + `NavRenderModel` | ✅ |
| 2 | `renderNavHtml` preuve | ✅ |
| 3 | demobrand `nav-shell.ts` + UI mount | ✅ |
| 4 | README contrat | ✅ |
| 5 | Tests smoke nav | ✅ |
| 6 | Ce fichier | ✅ |

## Verdict

**Phase I7 : TERMINÉE.** API adapter stable → **OK I12** (TF UI). Prêt pour **I8**.
