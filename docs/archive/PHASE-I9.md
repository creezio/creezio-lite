# Phase I9 — Vendor H6 + brand-runtime nominal (TempoFlow)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `tempoflow2` (+ doc kit) |
| **Prérequis** | [PHASE-I8.md](PHASE-I8.md) (kit H6 gelé) |
| **ARCHITECTURE_VERSION** | **`"H6"`** (consommé via vendor) |
| **Republish marques** | **Non** — [REPUBLISH-POLICY.md](REPUBLISH-POLICY.md) |

---

## Objectif

Ouvrir la conso marque TempoFlow sur le kit gelé H6 : sync vendor nominal
(assert version + packages `auth` / `assistant` / `tasks` / `mails`), boot
`bootTempoflowBrandRuntime` **plus jamais fail-soft silencieux**.

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `npm run electron:sync-vendor` → `ARCHITECTURE_VERSION=H6` | ✅ |
| 2 | Packages vendor `assistant` / `tasks` / `mails` (+ deps `package.json`) | ✅ |
| 3 | Splash step `runtime` + `reportCrash` si échec boot brand | ✅ |
| 4 | Tests `electron:compile`, `test:phase-h3`, `test:phase-h4`, `test:electron-main-graph` | ✅ |
| 5 | Ce fichier + gates POST-H5 / control-plane checklist | ✅ |

## Boot — politique d’échec

| Avant I9 | Après I9 |
|----------|----------|
| `try/catch` log-only (silencieux) | Splash `runtime` en **error** + `reportCrash(step=brand-runtime)` |
| Pas d’étape splash | Étape « Runtime plateforme » entre migrations et Meili |
| UI Hono historique continue | Conservé (fail-soft **visible**, zéro perte features) |

## Checklist

- [x] Vendor pin H6 (`SYNC.json.architectureVersion`)
- [x] Assert `ARCHITECTURE_VERSION ≥ H5` dans smoke H3
- [x] `assistant` / `tasks` / `mails` présents sous `crm/vendor/creezio/`
- [x] Échec brand-runtime visible (splash + collector)
- [x] Graphe main Electron vert (pas de `better-sqlite3` dans le main)

## Hors scope

- Control-plane `acl` / `decidePluginAccess` → **I10**
- Conso stores auth/assistant/tasks/mails dans le code marque → **I13**
- Republish Client+Serveur → **I14**

## Verdict

**Phase I9 : TERMINÉE.** Suite : **I10** (ACL L3 + control-plane `acl`).
