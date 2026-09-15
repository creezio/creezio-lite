# Phase H1 — Packages cœur CMS (`@creezio/*`)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (session 2026-07-29) |
| **Repo** | `creezio/creezio` → `/opt/docker/creezio` |
| **Prérequis** | [PHASE-H0.md](PHASE-H0.md) sign-off |
| **Backlog** | [BACKLOG-H1-PACKAGES.md](BACKLOG-H1-PACKAGES.md) |
| **ARCHITECTURE_VERSION** | `"H1"` (`@creezio/platform-core`) |

---

## Objectif

Matérialiser le **cœur CMS** manquant (sqlite multi-fichiers, API façade, MCP,
auth, nav/slots, assistant/tasks/mails, store Product Hub sqlite core) **sans**
importer le métier TempoFlow / Fidu / Certivan dans le kit, et **sans** republier
les exes prod.

---

## Livrables par sous-phase

### H1.0 — SQLite multi-fichiers (`@creezio/platform-core`)

| Done | Preuve |
|------|--------|
| `resolveCoreDbPath` | `{userData}/sqlite/core.db` |
| `resolveBrandDbPath` | = `resolveDbPath` (`manifest.dbFileName`) soft-compat |
| `resolvePluginDbPath(id)` | `{userData}/sqlite/plugin/<id>.db` |
| `ensurePluginDb` / `ensureDay0SqliteLayout` | mkdir + touch ; plugin **à l'install** |
| `ARCHITECTURE_VERSION = "H1"` | exporté |
| Tests | `scripts/test-phase-h1.mjs` |

Migration : code neuf → `resolveBrandDbPath` ; `resolveDbPath` reste alias
déprécié documenté (README package).

### H1.1 — `@creezio/api-kernel`

| Done | Preuve |
|------|--------|
| Préfixe unique `/api/v1` | `API_V1_PREFIX` |
| Routes cœur | `/api/v1/core/{health,version,architecture}` |
| `registerModuleApi` / `registerPluginApi` | registre + `listMounts` |
| Cross-write deny-by-default | `POST …/__cross/*` → 403 sans `allowCrossWrite` |
| Zéro route métier TF | test source + design |

### H1.2 — `@creezio/mcp-facade`

| Done | Preuve |
|------|--------|
| Tools cœur admin | `creezio.health`, `creezio.architecture`, `creezio.admin.list_mounts` |
| `discoverTools()` | hook modules/plugins |
| JWT HS256 / opaque secret | aligné `mcpJwtSecret` |
| Doc « pas de MCP produit séparé » | README package |
| Tests | découverte vide + 1 stub |

### H1.3 — `@creezio/auth`

| Done | Preuve |
|------|--------|
| Store mémoire login/logout | `createMemoryAuthStore` |
| DDL sqlite core | `AUTH_CORE_SQL` |
| IPC branchable | `bindAuthIpcHandlers` → `IpcChannels.auth` |
| Pas de dépendance marque | package kit pur |

### H1.4 — `@creezio/shell-ui`

| Done | Preuve |
|------|--------|
| `CORE_NAV_ITEMS` / `CoreNavItem` | nav native |
| `createNavRegistry` / `registerBrandNav` / `mergeNav` | slots |
| Demobrand + factory consomment le package | plus de stub isolé hardcodé |
| Guard ids métier TF exacts | refus `panier` / `/panier` etc. |

### H1.5 — `@creezio/assistant`

| Done | Preuve |
|------|--------|
| Store conversations mémoire | `createMemoryAssistantStore` |
| Surface IPC documentée | `ASSISTANT_IPC_SURFACE` |
| Pas de skills métier | README |

> Persistance sqlite (`resolveAssistantDbPath` historique) : contrat path conservé ;
> migration complète vers core = raffinement post-H1 (store API déjà prêt).

### H1.6 — `@creezio/tasks`

| Done | Preuve |
|------|--------|
| CRUD tasks cœur | `createMemoryTasksStore` |
| Montage api-kernel | `createTasksApiMount` → `platform-tasks` |
| ACL user minimale | header `x-creezio-user-id` ; forbid cross-user |
| Distinct `PluginTaskRecord` | package séparé |

### H1.7 — `@creezio/mails`

| Done | Preuve |
|------|--------|
| Modèle + draft/send stub | `createMemoryMailsStore` |
| API cœur | `createMailsApiMount` |
| Slot providers | `registerMailProvider` |
| Pas de templates TF/Fidu | README |

### H1.8 — Product Hub sqlite core

| Done | Preuve |
|------|--------|
| `createSqliteProductHubStore(coreDbPath)` | `node:sqlite` ou driver injecté |
| ACL L3/L4 persistée | `upsertAcl` / `getAcl` |
| `ensurePluginDb` | platform-core (fichier plugin à l'install) |
| Demobrand opt-in | `DEMOBRAND_PRODUCT_HUB_SQLITE=1` |

### H1.9 — Factory / demobrand

| Done | Preuve |
|------|--------|
| Scaffold wire api-kernel + mcp-facade + auth + shell-ui | `packages/factory/src/scaffold.ts` |
| Demobrand deps + main wiring | `apps/demobrand` |
| Tests factory Phase D adaptés | nav via shell-ui |

---

## Critères transverses

1. Workspaces `packages/*` + `npm run build` / `npm test` verts.
2. Inventaire propagation (`KIT_PACKAGES`) à 15 packages runtime listés.
3. CHANGELOG Unreleased mis à jour.
4. Aucune modification des repos `tempoflow2` / `fidu` / `certivan-app`.
5. Pas de republish exes prod.

---

## Checklist sign-off

- [x] H1.0–H1.4 + H1.8 obligatoires
- [x] H1.5–H1.7 livrés (stores + API ; pas d'extraction TF complète)
- [x] H1.9 demobrand/factory branchés
- [x] `ARCHITECTURE_VERSION = "H1"`
- [x] Docs H0 toujours valides ; matrice statut mise à jour
- [x] `npm run build` + `npm test`
- [x] Push `github.com/creezio/creezio`

## Verdict

**Phase H1 : TERMINÉE** pour le périmètre backlog (packages natifs + sqlite +
façades + demobrand). Prochaine étape naturelle : consommation progressive par
les marques (gates dédiés, hors ce backlog) + raffinements stores sqlite auth /
assistant si besoin runtime Electron.
