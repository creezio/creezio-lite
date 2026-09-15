# Phase R2 — Product Hub SoT unique `core.db`

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` + `tempoflow2` |
| **Prérequis** | [PHASE-R1.md](PHASE-R1.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish exe TF** | **Non** (cutover lib + vendor ; pas de nécessité absolue) |

---

## Objectif

Éliminer le **split-brain** Product Hub :

- Electron / control-plane → déjà `@creezio/product-hub` + `core.db`
- Next (`plugin-product-hub.ts` + mig 028) → encore `tempoflow2.db`

SoT unique = **`@creezio/product-hub` + `core.db`**. Hermes→Product Hub gold
intact (même API produit `/api/v1/plugin-products`, autre backend store).

**Interdit** : inventer un second store ; perdre grants / PRD / admin plugins ;
casser le control-plane.

---

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `PRODUCT_HUB_RUNTIME_SQL` (docs/tests/changelog/gates extraits TF 028) | ✅ |
| 2 | Store SQLite : `updateTask`, gates helpers, changelog delivery, details étendus, `prepare` | ✅ |
| 3 | Adapter Next `platform-stores/product-hub-adapter.ts` + migrate one-shot brand→core | ✅ |
| 4 | Façade `plugin-product-hub.ts` + ACL + n8n registry → core.db | ✅ |
| 5 | Routes `plugin-products` SQL plugin_* → hub DB | ✅ |
| 6 | Tests kit `test-phase-r2.mjs` + TF `test-plugin-product-hub` / p2 | ✅ |
| 7 | Push kit + TF | ✅ |

---

## Frontière

| Dans `@creezio/product-hub` | Reste TF (marque) |
|-----------------------------|-------------------|
| lifecycle, PRD, clarifications, impact pur | Collecte evidence FS (`TEMPOFLOW_PLUGINS_DIR`) |
| store SQLite core + ACL L3/H5 | Routes Hono + session / UI Admin Plugins |
| grants-flow + control-plane | n8n API TempoFlow (`n8n-plugin-provisioning`) |
| RUNTIME SQL (documents, tests, changelog, gates) | Stockage fichiers documents hors DB |

Migration Electron **028** sur brand.db = **legacy** (tables peuvent rester
vides) ; boot core applique `PRODUCT_HUB_*_SQL` via store + `tempoflowCoreMigrations`.

---

## Cutover TempoFlow

1. `npm run build:packages` kit (+ CJS).
2. `npm run electron:sync-vendor` (product-hub déjà dans baseline).
3. Next : `CREEZIO_CORE_DB_PATH` / voisin `DB_PATH/sqlite/core.db`.
4. One-shot : si core vide et brand a `plugin_products` → copie ids conservés.
5. Zéro écriture runtime `plugin_*` dans `tempoflow2.db`.

---

## Suite

**R3** — Electron host cutover (`@creezio/electron-shell` + hooks brand).

---

## Verdict

**Phase R2 : TERMINÉE.** Product Hub SoT = kit `core.db` ; split-brain
`plugin-product-hub` / mig 028 brand éliminé ; grants/PRD/ACL/n8n préservés.
