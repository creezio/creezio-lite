# Backlog H1 — packages `@creezio/*`

> Suite de [PHASE-H0.md](PHASE-H0.md).  
> **Sign-off** : [PHASE-H1.md](PHASE-H1.md) (2026-07-29).  
> Objectif H1 : matérialiser le **cœur CMS** manquant (auth, nav/slots, API,
> MCP façade, sqlite multi-fichiers, assistant…) **sans** importer le métier
> TempoFlow/Fidu/Certivan dans le kit.

Références : [ARCHITECTURE-INTENTION.md](ARCHITECTURE-INTENTION.md),
[MATRICE-NATIVE-METIER-PLUGIN.md](MATRICE-NATIVE-METIER-PLUGIN.md).

---

## Ordre recommandé

```text
H1.0  platform-core (sqlite layout + ARCHITECTURE_VERSION)
  └─► H1.1  api-kernel
        ├─► H1.2  mcp-facade
        └─► H1.3  auth
              └─► H1.4  shell-ui (nav + slots)
                    ├─► H1.5  assistant
                    ├─► H1.6  tasks
                    └─► H1.7  mails
H1.8  product-hub stores (sqlite core) — peut chevaucher H1.1–H1.3
H1.9  factory / demobrand branchés sur les nouveaux packages
```

Les packages **déjà ✅** (brand-config, shell, electron-shell, desktop-tooling,
factory, propagation, product-hub contrats) ne sont pas « créés » en H1 : ils
sont **étendus** si besoin (surtout `platform-core` et `shell`).

---

## Packages à créer / étendre

### H1.0 — `@creezio/platform-core` *(étendre)*

| | |
|--|--|
| **But** | Layout SQLite `core` / `brand` / `plugin/<id>` + helpers paths |
| **Dépendances** | `brand-config` |
| **Done** | `resolveCoreDbPath`, `resolveBrandDbPath`, `resolvePluginDbPath(id)` ; doc migration depuis `resolveDbPath` ; `ARCHITECTURE_VERSION` exporté ; tests unitaires paths ; pas de breaking hard sans alias déprécié |

### H1.1 — `@creezio/api-kernel`

| | |
|--|--|
| **But** | Façade HTTP unique : routes cœur + montage / proxy modules + plugins |
| **Dépendances** | `platform-core`, `brand-config` ; plus tard `auth` |
| **Done** | Router cœur minimal (health, version, architecture) ; registre de montage `registerModuleApi` / `registerPluginApi` ; un seul préfixe domaine documenté ; tests registre + health ; **zéro** route métier TempoFlow |

### H1.2 — `@creezio/mcp-facade`

| | |
|--|--|
| **But** | MCP d’app unique : tools admin cœur + découverte tools modules/plugins |
| **Dépendances** | `api-kernel`, `platform-core` (`mcpJwtSecret` / local-config) |
| **Done** | Liste tools cœur (admin) ; hook `discoverTools()` pour modules/plugins ; auth JWT alignée config existante ; doc « pas de MCP produit séparé » ; tests découverte vide + 1 stub |

### H1.3 — `@creezio/auth`

| | |
|--|--|
| **But** | Session / login / logout / recovery — natif Creezio |
| **Dépendances** | `platform-core` (sqlite core, recovery-key, local-config), `shell` (canaux IPC déjà là) |
| **Done** | API + handlers IPC branchables ; schéma tables dans **sqlite core** ; pas de dépendance marque ; tests login/logout mémoire ou sqlite temp |

### H1.4 — `@creezio/shell-ui`

| | |
|--|--|
| **But** | Nav Creezio + **slots** typés pour onglets/vues métier |
| **Dépendances** | `shell`, `brand-config` |
| **Done** | `CoreNavItem[]` natifs ; `NavSlot` / `registerBrandNav(items)` ; factory demobrand consomme le package (plus de stub isolé) ; **aucune** entrée panier/dispatch hardcodée |

### H1.5 — `@creezio/assistant`

| | |
|--|--|
| **But** | Chat / assistant plateforme (DB + bridge UI chrome) |
| **Dépendances** | `platform-core` (assistant db → migrer vers core ou fichier dédié documenté), `shell`, optionnel Hermes host via electron-shell |
| **Done** | Store conversations ; IPC `assistant:*` / `llm:*` documentés comme surface package ; tests store ; pas de skills métier marque |

### H1.6 — `@creezio/tasks`

| | |
|--|--|
| **But** | Tâches **natifs plateforme** (hors tasks Product Hub plugin) |
| **Dépendances** | `platform-core` (sqlite core), `api-kernel`, `auth` |
| **Done** | CRUD tasks cœur ; montage api-kernel ; ACL user minimale ; distinct des `PluginTaskRecord` product-hub |

### H1.7 — `@creezio/mails`

| | |
|--|--|
| **But** | Mails natifs plateforme (boîte / envoi générique) |
| **Dépendances** | `platform-core`, `api-kernel`, `auth` |
| **Done** | Modèle + API cœur ; **pas** de templates TempoFlow/Fidu ; slot/extension pour providers marque |

### H1.8 — Product Hub store sqlite core *(étendre `@creezio/product-hub`)*

| | |
|--|--|
| **But** | Remplacer / dual-run le store mémoire + SQL vertical pour registry plugins dans **sqlite core** |
| **Dépendances** | H1.0 paths ; `schema-sql` déjà présent |
| **Done** | `createSqliteProductHubStore(coreDbPath)` dans le kit ; demobrand peut l’utiliser ; ACL L3/L4 persistée core ; DB `plugin/<id>` créée **seulement** à l’install (API `ensurePluginDb`) |

### H1.9 — Factory / demobrand

| | |
|--|--|
| **But** | Squelette new-app consomme auth + shell-ui + api-kernel (+ stubs mcp) |
| **Dépendances** | H1.1–H1.4 au minimum |
| **Done** | `creezio new-app` génère wiring ; demobrand build+test vert ; README factory à jour |

---

## Critères transverses Done (chaque package H1)

1. `package.json` name `@creezio/<id>`, workspace root, build ESM + CJS si runtime Electron.
2. Export public documenté dans le README package (court).
3. **Aucun** import hardcodé `tempoflow` / `fidu` / `certivan` hors manifests `brand-config`.
4. Entrée inventaire propagation (`kit-inventory` / surfaces) mise à jour si package runtime.
5. Test Node (`scripts/test-phase-h1*.mjs` ou équivalent) + `npm test` vert.
6. Entrée [CHANGELOG.md](../CHANGELOG.md) Unreleased.
7. Pas de modification des repos `tempoflow2` / `fidu` / `certivan-app` depuis ce backlog (consommation ultérieure, gate dédiée).

---

## Hors H1 (rappel)

| Item | Pourquoi |
|------|----------|
| Extraire panier/dispatch/optimiser… | Métier marque — décision verrouillée |
| Auto-promotion plugin → module | Processus humain/produit |
| MCP « produit Creezio » séparé | Une façade = MCP de l’app |
| Univers plugins perso hors org | ACL org uniquement |

---

## Definition of Done — Phase H1 (globale)

- Packages H1.0–H1.4 **obligatoires** ; H1.5–H1.7 **souhaités** (peuvent glisser H1.b).
- H1.8 store Product Hub sqlite core **obligatoire** pour coller au modèle jour 0.
- Docs H0 toujours valides ; `ARCHITECTURE_VERSION` bumpé vers `"H1"` au sign-off H1.
- `npm run build` + `npm test` verts sur `/opt/docker/creezio`.
- Push `github.com/creezio/creezio` — **sans** toucher les repos marques.
