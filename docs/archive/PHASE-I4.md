# Phase I4 — Control-plane runtime unifié (kit)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` |
| **Prérequis** | [PHASE-I0.md](PHASE-I0.md), H5 ACL |
| **ARCHITECTURE_VERSION** | inchangé (`H5`) |
| **Republish marques** | **Non** |

---

## Objectif

Une seule implémentation control-plane (product-hub + electron-shell + `acl?`)
comme gold demobrand ; documenter le remplacement des `plugin-control-api` locaux.

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `createPluginControlPlaneAclFromStore` | ✅ |
| 2 | `buildPluginAclActorHeaders` | ✅ |
| 3 | demobrand `sandbox.controlPlaneAcl()` | ✅ |
| 4 | [CONTROL-PLANE-BRAND-MIGRATION.md](CONTROL-PLANE-BRAND-MIGRATION.md) | ✅ |
| 5 | Tests I4 + non-régression H5 | ✅ |
| 6 | Ce fichier | ✅ |

## Hors scope

- Bascule TF / Certivan / Fidu (I10 / I16 / I18)
- UI Admin plugins (I5)

## Verdict

**Phase I4 : TERMINÉE.** Checklist bascule prête — **prêt pour I5**.
