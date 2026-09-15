# Phase I5 — UI Admin Plugins multi-org L3

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` — product-hub admin + demobrand |
| **Prérequis** | [PHASE-I4.md](PHASE-I4.md) |
| **ARCHITECTURE_VERSION** | inchangé (`H5`) |
| **Republish marques** | **Non** |

---

## Objectif

Surface Admin pour éditer binding org + caps `see` / `install` / `execute`,
avec preuve deny cross-org.

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `list/upsert/clear/previewPluginAclAdmin` (@creezio/product-hub) | ✅ |
| 2 | demobrand mount `admin-plugins` | ✅ |
| 3 | UI `resources/renderer/admin-plugins.html` | ✅ |
| 4 | Tests E2E API deny cross-org | ✅ |
| 5 | Ce fichier | ✅ |

## Scénario UI documenté

1. Ouvrir `admin-plugins.html` (lien depuis index demobrand)
2. Upsert `weather-demo` owner `org-a` caps see+execute
3. Preview acteur `org-b` → **DENY** `cross_org_denied`
4. Preview acteur `org-a` → **ALLOW**

Même flux testé via API (`test-phase-i5.mjs`) sans Electron.

## Hors scope

- Migration UI cockpit TF historique
- Cloud registry

## Verdict

**Phase I5 : TERMINÉE.** Prêt pour **I6** (registre org persisté).
