# Backlog H2 — Isolation DB / API runtime

> Suite de [PHASE-H1.md](PHASE-H1.md).  
> Objectif : passer des **contrats H1** (paths, façade, deny path `__cross/`) à une
> **isolation réelle runtime** (handles SQLite, migrations par couche, frontiers
> API/MCP prouvées par tests).

Références : [ARCHITECTURE-INTENTION.md](ARCHITECTURE-INTENTION.md),
[MATRICE-NATIVE-METIER-PLUGIN.md](MATRICE-NATIVE-METIER-PLUGIN.md),
[PHASE-H1.md](PHASE-H1.md).

**Hors scope H2** : extraction modules TempoFlow dans un brand repo (→ **H3**).

---

## Ordre recommandé

```text
H2.0  platform-core — SqliteRuntime (handles core/brand/plugin + lifecycle)
  └─► H2.1  Migrations / schémas par couche (ensureMigrations + versioning)
        └─► H2.2  api-kernel — ScopedDbAccess + deny cross-layer write
              ├─► H2.3  mcp-facade — discovery tools scindée par couche
              └─► H2.4  demobrand — branchement E2E multi-DB + routes isolées
H2.5  Docs PHASE-H2 + ARCHITECTURE_VERSION=H2 + tests verts + push
```

---

## Sous-phases

### H2.0 — Multi-DB runtime (`@creezio/platform-core`)

| | |
|--|--|
| **But** | Ouvrir / fermer les handles `core` / `brand` / `plugin/<id>` avec cycle de vie clair |
| **Done** | `createSqliteRuntime(ctx)` ; jour 0 = core+brand only ; `openPlugin(id)` à l'install ; chemins stables inchangés ; `close()` ; statut open |

### H2.1 — Schémas / migrations

| | |
|--|--|
| **But** | Versioning séparé par fichier DB |
| **Done** | `SqliteMigration` + `ensureMigrations` + table `_creezio_schema_migrations` ; helpers composer migrations core (auth/hub injectés) vs brand (marque) vs plugin (à l'install) |

### H2.2 — Frontières API (`@creezio/api-kernel`)

| | |
|--|--|
| **But** | Brand/plugin **ne peuvent pas** écrire dans core (deny-by-default) |
| **Done** | `ScopedDbAccess` injecté dans `ApiHandlerContext` ; refus write cross-layer ; `__cross/*` toujours 403 sans `allowCrossWrite` ; tests d'intégration qui prouvent l'isolation |

### H2.3 — MCP façade scindée

| | |
|--|--|
| **But** | Discovery tools par couche sans extraire le métier TF |
| **Done** | `listTools({ space })` + `listToolsBySpace()` ; tool admin `creezio.admin.list_tools_by_space` ; discoverer modules/plugins tagués `space` |

### H2.4 — Demobrand preuve E2E

| | |
|--|--|
| **But** | Sandbox kit avec multi-DB réel + routes API isolées |
| **Done** | Boot `createSqliteRuntime` ; table brand démo ; mount module brand-only ; install plugin → DB `plugin/<id>` ; Product Hub sur core runtime ; zéro republish marque prod |

### H2.5 — Sign-off

| | |
|--|--|
| **Done** | `ARCHITECTURE_VERSION = "H2"` ; `docs/PHASE-H2.md` ; matrice / README / CHANGELOG ; `npm run build` (+ cjs) + `npm test` ; push |

---

## Critères transverses

1. Ne casse pas TempoFlow / Certivan / Fidu (kit + demobrand uniquement).
2. Pas de republish exe marques.
3. Tests d'intégration isolation DB+API verts.
4. Documenter explicitement le reste **H3** (modules TF → brand repo).
