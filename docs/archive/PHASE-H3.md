# Phase H3 — Modules métier TempoFlow (brand repo)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (session 2026-07-29) |
| **Repo marque** | `creezio/tempoflow2` → `/opt/docker/tempoflow2` |
| **Repo kit** | `creezio/creezio` → `/opt/docker/creezio` (docs + contrats) |
| **Prérequis** | [PHASE-H2.md](PHASE-H2.md) sign-off |
| **Backlog** | [BACKLOG-H3.md](BACKLOG-H3.md) |
| **ARCHITECTURE_VERSION** | `"H3"` (`@creezio/platform-core`) |
| **Gold standard** | tempoflow2 **0.10.x** — pas tempoflow2-backup |

---

## Objectif

Isoler le **métier TempoFlow** hors du kit `@creezio/*` en modules brand :

1. inventaire tables → SQLite **brand** ;
2. structure `electron/modules/` + migrations brand ;
3. montages `registerModuleApi` + MCP `space: module` + slots `shell-ui` ;
4. boot `createSqliteRuntime` (core + brand) côté Electron Serveur ;
5. **zéro perte** des surfaces Hono / UI / MCP historiques.

**Hors scope** : proxy MCP unifié durci (fusion complète) → **H4** ;
réécriture totale sidebar ; Fidu/Certivan.

---

## Livrables

### H3.0 — Inventaire

| Done | Preuve |
|------|--------|
| Mapping modules → tables brand | `tempoflow2/crm/docs/H3-MODULES-INVENTORY.md` |
| Frontière core vs brand vs plugin | inventaire + matrice kit |

### H3.1 — Structure + vendor

| Done | Preuve |
|------|--------|
| `crm/electron/modules/<id>/` | panier, dispatch, releves, catalogue/stack/scan nav |
| Symlink `crm/modules` | → `electron/modules` |
| Vendor contrats H2 | api-kernel, mcp-facade, shell-ui, auth dans sync-vendor |

### H3.2 — Runtime core+brand

| Done | Preuve |
|------|--------|
| `tempoflowBrandMigrations` / `tempoflowCoreMigrations` | `composeMigrations` ids `h3_brand_*` / `h3_core_*` |
| `createTempoflowBrandRuntime` | `electron/brand-runtime.ts` |
| Boot Serveur après migrations | `main.ts` fail-soft + shutdown |
| Driver | `node:sqlite` (pas better-sqlite3 dans graphe main) |

### H3.3 — Modules montés

| Module | API | MCP | Nav |
|--------|-----|-----|-----|
| **panier** | ✅ `/api/v1/modules/panier` | ✅ `module.panier.*` | ✅ `brand.panier` → `/panier` |
| **dispatch** | ✅ `/api/v1/modules/dispatch` | ✅ `module.dispatch.*` | ✅ commandes + optimiser |
| **releves** | ✅ `/api/v1/modules/releves` | ✅ `module.releves.list` | ✅ `brand.releves` |

Deny brand→core : 403 `cross_layer_write_denied` (preuve smoke).

### H3.4 — Vague 2 registry

| Module | Statut |
|--------|--------|
| catalogue / stack / scan | 🟡 nav (+ migrations catalog_min / stack) — mounts API suite |

### H3.5 — Tests

| Done | Preuve |
|------|--------|
| `npm run test:phase-h3` (TF) | ALL GREEN |
| `test:electron-main-graph` | pas de better-sqlite3 dans main |
| `test:panier-sku` / `test:nav-acl` | verts (features historiques) |
| Kit `npm test` (H0–H2 + H3 docs) | verts |

### H3.6 — Kit transverse

| Done | Preuve |
|------|--------|
| `ARCHITECTURE_VERSION = "H3"` | platform-core |
| Docs | BACKLOG-H3, PHASE-H3, matrice, CHANGELOG |
| shell-ui | ids `brand.*` peuvent href vers routes produit (`/panier`) |
| Zéro métier TF dans `@creezio/*` | mounts uniquement dans tempoflow2 |

**Republish exe TF** : non requis pour la preuve H3 (smoke Node + compile).
Prochaine release Client/Serveur embarquera le boot brand runtime via pipeline
habituel.

---

## Checklist sign-off

- [x] H3.0–H3.5 livrés (pas de skip volontaire des modules prioritaires)
- [x] Au moins panier + dispatch + releves montés brand DB/API/MCP/nav
- [x] Features TF historiques non cassées (tests panier / nav / graphe)
- [x] `ARCHITECTURE_VERSION = "H3"`
- [x] Suite H4 documentée ci-dessous
- [x] Push kit + tempoflow2

## Verdict

**Phase H3 : TERMINÉE** pour le périmètre maximisé (3 modules montés +
registry vague 2 + runtime + docs). Catalogue/stack mounts API = suite
progressive documentée (pas « plus tard » flou).

---

## Reste pour H4 — MCP proxy unifié durci

H3 ajoute une façade MCP creezio **parallèle** (`space: module`). H4 doit :

1. Unifier / proxifier le MCP historique TF (`tempoflow2-crm`) et `mcp-facade`
   sous **une** entrée app (tools cœur + modules + plugins) ;
2. Durcir auth JWT / policies alignées `mcp_tool_policies` ;
3. Éviter la double exposition d’outils panier (historique vs `module.panier.*`)
   — mapping de compat ou dépréciation progressive ;
4. Preuves E2E + pas de régression `test:mcp-*` TF.

Prérequis H4 : H3 sign-off.
