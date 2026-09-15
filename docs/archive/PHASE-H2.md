# Phase H2 — Isolation DB / API runtime

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (session 2026-07-29) |
| **Repo** | `creezio/creezio` → `/opt/docker/creezio` |
| **Prérequis** | [PHASE-H1.md](PHASE-H1.md) sign-off |
| **Backlog** | [BACKLOG-H2.md](BACKLOG-H2.md) |
| **ARCHITECTURE_VERSION** | `"H2"` (`@creezio/platform-core`) |

---

## Objectif

Faire passer les contrats H1 (paths, façade API, deny `__cross/`) à une
**isolation réelle runtime** :

1. handles SQLite `core` / `brand` / `plugin/<id>` avec cycle de vie ;
2. migrations versionnées **par fichier** ;
3. frontières API deny-by-default (brand/plugin → core interdit) ;
4. MCP discovery scindée par couche ;
5. preuve E2E sur **demobrand** (pas de republish TempoFlow/Fidu/Certivan).

**Hors scope** : extraction modules TempoFlow dans le brand repo → **H3**.

---

## Livrables par sous-phase

### H2.0 — Multi-DB runtime (`@creezio/platform-core`)

| Done | Preuve |
|------|--------|
| `createSqliteRuntime(ctx)` | open core+brand jour 0 |
| `openPlugin(id)` | fichier `sqlite/plugin/<id>.db` à l'install only |
| `getCore` / `getBrand` / `getPlugin` / `close` / `status` | API runtime |
| Chemins stables H1 | `resolveCore/Brand/PluginDbPath` inchangés |
| Tests | `scripts/test-phase-h2.mjs` H2.0 |

### H2.1 — Schémas / migrations

| Done | Preuve |
|------|--------|
| `SqliteMigration` + `ensureMigrations` | table `_creezio_schema_migrations` par DB |
| `composeMigrations` + `SQLITE_META_MIGRATION` | méta kit sans deps circulaires |
| Core vs brand vs plugin séparés | test « pas de fuite brand→core » |
| DDL métier injecté par appelant | auth / Product Hub / brand notes (demobrand) |

**Stratégie versioning**

| Couche | Qui possède les migrations | Quand appliquées |
|--------|----------------------------|------------------|
| **core** | kit (+ packages natifs : auth, product-hub…) | Boot serveur jour 0 |
| **brand** | **repo marque** | Boot jour 0 (schéma modules, même vide) |
| **plugin/<id>** | plugin / Product Hub | `openPlugin` à l'install |

### H2.2 — Frontières API (`@creezio/api-kernel`)

| Done | Preuve |
|------|--------|
| `ScopedDbAccess` + `createScopedDbAccess` | injecté dans `ApiHandlerContext.db` |
| `CrossLayerWriteDeniedError` → HTTP 403 | `cross_layer_write_denied` |
| Deny path `__cross/*` + `core/*` escaping | `cross_write_denied` |
| `/api/v1/core/architecture` expose `isolation.scopedDb` | test intégration |
| Tests | attack-core brand/plugin → 403 ; write brand OK |

### H2.3 — MCP façade scindée (`@creezio/mcp-facade`)

| Done | Preuve |
|------|--------|
| `listTools({ space })` | filtre couche |
| `listToolsBySpace()` | `{ core, module, plugin }` |
| `discoverToolsBySpace` | hook H2 |
| Tool `creezio.admin.list_tools_by_space` | admin cœur |
| Discoverer ne peut pas injecter `space: "core"` | garde facade |

### H2.4 — Demobrand preuve E2E

| Done | Preuve |
|------|--------|
| `apps/demobrand/.../sandbox-runtime.ts` | `createDemobrandSandbox` |
| Module `demo-notes` → brand only | POST notes + attack-core 403 |
| `installPlugin` → DB plugin + mount | KV plugin + attack-core 403 |
| Product Hub sur core runtime | `createRequest` sandbox |
| MCP modules/plugins découverts | `listToolsBySpace` |
| `main.ts` branche sandbox sur `userDataDir` | pas de republish marque |

### H2.5 — Sign-off transverse

| Done | Preuve |
|------|--------|
| `ARCHITECTURE_VERSION = "H2"` | export platform-core |
| Docs | BACKLOG-H2, PHASE-H2, README, matrice, CHANGELOG |
| Build + tests | `npm run build` (+ cjs) + `npm test` incl. H2 |
| Push | `github.com/creezio/creezio` |
| Aucune modif tempoflow2 / fidu / certivan-app | scope kit |

---

## Checklist sign-off

- [x] H2.0–H2.4 livrés (pas de sous-partie skippée)
- [x] Tests isolation DB+API+MCP+demobrand verts
- [x] `ARCHITECTURE_VERSION = "H2"`
- [x] Suite H3 documentée ci-dessous
- [x] Push kit

## Verdict

**Phase H2 : TERMINÉE** pour le périmètre backlog (isolation runtime).

---

## Reste pour H3 — extraction modules TempoFlow (brand repo)

H2 isole les **tuyaux**. H3 déplace le **métier** hors du monolithe marque
historique vers le modèle « modules dans le repo marque » :

1. **Inventaire modules TF** (panier, dispatch, relevés, optimiser, catalogue…)
   et mapping tables → SQLite **brand** (vs résidus encore en monolithe).
2. **Contrats d'accueil** : montages `registerModuleApi` + tools MCP
   `discoverToolsBySpace({ module })` + slots `shell-ui` pour chaque module.
3. **Migrations brand** versionnées dans **tempoflow2** (pas dans le kit) ;
   boot serveur TF appelle `createSqliteRuntime` avec `brandMigrations` TF.
4. **Découpage progressif** : un module à la fois, gates verts, **sans**
   casser Client/Serveur publiés (republish seulement si nécessité + tests).
5. **Plugins orga** restent hors métier TF (ACL Product Hub + DB
   `plugin/<id>` déjà H1/H2).
6. **Pas** d'import panier/dispatch dans `@creezio/*`.

Prérequis H3 : H2 sign-off + décision ordre d'extraction modules (produit).
