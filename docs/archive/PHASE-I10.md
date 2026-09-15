# Phase I10 — ACL L3 + control-plane `acl` (TempoFlow)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `tempoflow2` (+ doc kit) |
| **Prérequis** | [PHASE-I9.md](PHASE-I9.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** |

---

## Objectif

Bascule TempoFlow sur le control-plane kit avec ACL Product Hub L3
(`decidePluginAccess` / `createPluginControlPlaneAclFromStore`) ; remplacer
le modèle cockpit user-only par la façade kit ; prouver deny cross-org.

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | Migration core `PRODUCT_HUB_ACL_H5_SQL` | ✅ |
| 2 | `brand-runtime` : `productHub` + `controlPlaneAcl` / `actorHeaders` | ✅ |
| 3 | `startPluginControlApi` → `createPluginControlPlaneHandler` + `acl` | ✅ |
| 4 | Adapters verticaux git/CRM (`plugin-control-adapters.ts`) | ✅ |
| 5 | Extras TF (accept-check, versions, health, llm…) conservés | ✅ |
| 6 | `src/lib/plugin-acl.ts` → façade `decidePluginAccess` | ✅ |
| 7 | Tests deny cross-org (`test:plugin-acl-l3`) + control-api verts | ✅ |
| 8 | Ce fichier + checklist [CONTROL-PLANE-BRAND-MIGRATION.md](CONTROL-PLANE-BRAND-MIGRATION.md) | ✅ |

## Compat Hermes

Sans headers actor (`x-creezio-org-id`…) : acteur = **clé service**
(Bearer control-plane) — comportement E2E / skill inchangé.  
Avec headers : ACL L3/L4 + deny cross-org.

Bridge env : `TEMPOFLOW_PLUGINS_*` + alias `TF2_PLUGINS_*`.

## Hors scope

- Modules catalogue/stack/scan mounts → **I11**
- UI nav shell-ui adapters → **I12**
- Conso stores auth/assistant/tasks/mails → **I13**
- Republish → **I14**

## Verdict

**Phase I10 : TERMINÉE.** Suite : **I11**.
