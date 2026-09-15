# Phase R1 — Extraire Database TF → `@creezio/database`

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` + `tempoflow2` |
| **Prérequis** | [PHASE-R0.md](PHASE-R0.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish exe TF** | **Non** (cutover lib + vendor ; pas de nécessité absolue) |

---

## Objectif

Porter le **vrai** module Admin Database TempoFlow
(`crm/src/lib/database/*` + schéma automations + contrats API) vers
`@creezio/database`, puis faire consommer le package par TF (**SoT kit**)
sans perte de features panel Admin Database / automations row-level.

**Interdit** : inventer un moteur automations différent ; classer Database
comme métier ; casser Hermes→Product Hub (R2).

---

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | Package `@creezio/database` (port réel lib TF) | ✅ |
| 2 | `DATABASE_CORE_SQL` (= migration TF v33) | ✅ |
| 3 | Adapters host (`emitPluginEvent`, webhook brand, policy) | ✅ |
| 4 | Cutover TF : imports → `@creezio/database` + vendor sync | ✅ |
| 5 | Route Hono `admin-database` + UI inchangées (contrats HTTP) | ✅ |
| 6 | Tests kit `test-phase-r1.mjs` + TF `test:database-module` | ✅ |
| 7 | Matrice : Database = natif ✅ | ✅ |
| 8 | Push kit + TF | ✅ |

---

## Frontière

| Dans `@creezio/database` | Reste TF (marque) |
|--------------------------|-------------------|
| catalogue, browse, CRUD, views, export | UI React Admin Database |
| automations-store, triggers SQLite, engine, webhooks | Route Hono + session owner |
| access-log, conditions, identifiers, policy | Whitelist métier via `configureDatabasePolicy` (défaut kit vide / fail-closed) |
| `DATABASE_CORE_SQL` | Migration electron v33 (réutilise SQL kit) |

`@creezio/automations` reste **lifecycle-only** (R0) — pas fusionné.

---

## Cutover TempoFlow

1. `npm run build:packages` kit (+ CJS).
2. `CREEZIO_VENDOR_PACKAGES=… database` → `electron:sync-vendor`.
3. `src/lib/database/*` = shims re-export + configure adapters TF.
4. `admin-database.ts` / `db.ts` consomment le package (via shims ou import direct).

---

## Suite

**R2** — Product Hub SoT unique `core.db` → [PHASE-R2.md](PHASE-R2.md).

---

## Verdict

**Phase R1 : TERMINÉE.** Database Admin = natif `@creezio/database` ; TF consomme
le package ; zéro perte features row-level.
