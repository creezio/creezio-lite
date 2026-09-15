# Phase I15 — Certivan foundation (vendor H6 + brand-runtime)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `certivan-app` (+ doc kit) |
| **Prérequis** | [PHASE-I14.md](PHASE-I14.md) (TF republish) ; kit H6 gelé (I8) |
| **ARCHITECTURE_VERSION** | **`"H6"`** (consommé via vendor) |
| **Republish marques** | **Non** — [REPUBLISH-POLICY.md](REPUBLISH-POLICY.md) |

---

## Objectif

Ouvrir la conso marque Certivan sur le kit gelé H6 : sync vendor nominal
(assert version + packages `api-kernel` / `mcp-facade` / `shell-ui` /
`auth` / `assistant` / `tasks` / `mails`), boot
`bootCertivanBrandRuntime` **plus jamais fail-soft silencieux**, modules
métier VASP (dossiers / pièces / RTI) via `registerModuleApi` — zéro métier
dans `@creezio/*`.

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `npm run electron:sync-vendor` → `ARCHITECTURE_VERSION=H6` + `SYNC.json` | ✅ |
| 2 | Packages vendor `api-kernel` / `mcp-facade` / `shell-ui` / `auth` / `assistant` / `tasks` / `mails` | ✅ |
| 3 | `createSqliteRuntime` core+brand (`certivan.db`) + `bootCertivanBrandRuntime` | ✅ |
| 4 | Modules `dossiers` / `pieces` / `rti` + MCP aliases legacy-preferred | ✅ |
| 5 | Splash step `runtime` + `reportCrash` si échec boot brand | ✅ |
| 6 | Tests `electron:compile`, `test:phase-h3`, `test:phase-h4`, `test:rti`, `test:dossiers`, `test:electron-main-graph` | ✅ |
| 7 | Ce fichier + gates POST-H5 / control-plane checklist | ✅ |

## Boot — politique d’échec

| Avant I15 | Après I15 |
|-----------|-----------|
| Pas de brand-runtime | Splash `runtime` entre migrations et Meili |
| — | OK → `splashDone` ; catch → `splashPatch(error)` + `reportCrash(step=brand-runtime)` |
| UI Hono historique | Conservée (fail-soft **visible**, zéro perte features VASP) |

## Modules brand

| Module | Mount | MCP |
|--------|-------|-----|
| `dossiers` | list / get / status | `list_dossiers` → `module.dossiers.list`, `get_dossier` → `module.dossiers.get` |
| `pieces` | list / status | `list_pieces` → `module.pieces.list` |
| `rti` | status (UI) | `module.rti.status` (canonique) |

## Checklist

- [x] Vendor pin H6 (`SYNC.json.architectureVersion`)
- [x] Assert `ARCHITECTURE_VERSION ≥ H5` dans smoke H3
- [x] Packages H6 présents sous `crm/vendor/creezio/`
- [x] Échec brand-runtime visible (splash + collector)
- [x] Graphe main Electron vert (pas de `better-sqlite3` dans le main)
- [x] Vertical VASP (RTI / dossiers) non cassé

## Hors scope

- Control-plane `acl` / `decidePluginAccess` → **I16**
- Conso UI shell-ui / stores auth/assistant/tasks/mails → **I16**
- Republish Client+Serveur → **I16**

## Verdict

**Phase I15 : TERMINÉE.** Suite : **I16** (ACL L3 + shell-ui + conso + republish Certivan).
