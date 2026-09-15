# Phase H5 — Harden plugins / ACL (sign-off)

| | |
|--|--|
| **Statut** | ✅ Sign-off |
| **Date** | 2026-07-29 |
| **ARCHITECTURE_VERSION** | `"H5"` (`@creezio/platform-core`) |
| **Prérequis** | [PHASE-H4.md](PHASE-H4.md) |
| **Backlog** | [BACKLOG-H5.md](BACKLOG-H5.md) |

---

## Objectif

Durcir le runtime **plugins orga** : ACL Product Hub L3 (visibilité /
installation / exécution), deny cross-org, et une seule décision d'accès
partagée entre **API**, **MCP** et **control-plane** — sans casser TF /
Certivan / Fidu.

---

## Livrables

### ACL Product Hub (`@creezio/product-hub`)

| Item | Détail |
|------|--------|
| Actions | `see` · `install` · `execute` |
| Défaut membership | org/user listé ⇒ `see` + `execute` (**pas** `install`) |
| Fail-closed | inchangé (owner / service key sinon) |
| Cross-org | `ownerOrgId` + `isCrossOrgDenied` → `cross_org_denied` |
| Décision unique | `decidePluginAccess(policy, actor, action)` |
| Headers actor | `x-creezio-org-id` · `x-creezio-user-id` · `x-creezio-is-owner` |
| SQL H5 | `plugin_org_binding` + `plugin_acl_capability` |

### Runtime

| Item | Emplacement |
|------|-------------|
| `closePlugin` / `uninstallPlugin` / `removePluginDb` | `@creezio/platform-core` |
| `authorizePluginAccess` | `@creezio/api-kernel` |
| `createDenyUnauthorizedPluginToolPolicy` + JWT `orgId` | `@creezio/mcp-facade` |
| Control-plane `acl?: PluginControlPlaneAcl` | product-hub + electron-shell |
| Sandbox install/uninstall + ACL | `apps/demobrand` `sandbox-runtime` |

### Tests / docs

| Item | Emplacement |
|------|-------------|
| E2E + unit | `scripts/test-phase-h5.mjs` |
| Backlog / phase | `docs/BACKLOG-H5.md`, ce fichier |
| Matrice | `docs/MATRICE-NATIVE-METIER-PLUGIN.md` |

---

## Preuves E2E (demobrand)

1. **Install** (owner) → scaffold control-plane + `openPlugin` → DB `plugin/<id>.db`
2. **ACL bind** → `ownerOrgId` + org listée (see/execute)
3. **MCP** `plugin.<id>.*` : org-A OK · org-B `cross_org_denied` (list masquée)
4. **API** `/api/v1/plugins/<id>/*` : même décision via headers actor
5. **Revoke / uninstall** → close handle + delete DB + `clearAcl`

---

## Critères DoD

- [x] ACL L3 see/install/execute documentée + testée
- [x] Deny cross-org (API + MCP + control-plane)
- [x] E2E plugin-control verts (`test-phase-h5`)
- [x] Policies cohérentes (`decidePluginAccess`)
- [x] Tests kit H0–H5 (suite `npm test`) verts
- [x] `ARCHITECTURE_VERSION = "H5"`
- [x] Docs BACKLOG-H5 + PHASE-H5 + matrice
- [x] Rétrocompat control-plane **sans** `acl` (TF inchangé)
- [x] Push kit

---

## Sign-off plan H0–H5

| Phase | Thème | Version | Statut |
|-------|-------|---------|--------|
| **H0** | Cadre architecture | H0 | ✅ |
| **H1** | Packages cœur CMS | H1 | ✅ |
| **H2** | Isolation multi-DB / API / MCP | H2 | ✅ |
| **H3** | Modules métier hors kit (TF) | H3 | ✅ |
| **H4** | MCP proxy unifié | H4 | ✅ |
| **H5** | Harden plugins / ACL | **H5** | ✅ |

**Plan H0–H5 : COMPLET** — socle kit prêt ; consommation marques progressive.

---

## Gaps post-H5 (explicites, non flous)

| Gap | Détail | Priorité |
|-----|--------|----------|
| **TF L4 → L3** | TempoFlow `crm/src/lib/plugin-acl.ts` reste **user-only** ; pas encore branché sur `decidePluginAccess` / `plugin_acl_org` / caps | Progressive |
| **Certivan / Fidu** | Pas d'extraction ni republish H5 | Hors plan |
| **UI Admin multi-org** | Pas de surface Admin pour éditer caps L3 | Post |
| **Control-plane TF** | Toujours sans `acl` option — comportement Bearer-only inchangé (volontaire) | OK rétrocompat |
| **Registre plugins cloud** | Pas de store distant multi-tenant | Volontaire |

---

## Non-régression

- TF / Certivan / Fidu : **aucune** modification obligatoire H5
- Demobrand : preuve kit uniquement (pas de republish exe requis)
- Packaging lessons : intactes
