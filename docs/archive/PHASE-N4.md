# Phase N4 — Migrations historiques plateforme → kit

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` |
| **Prérequis** | [PHASE-N3p.md](PHASE-N3p.md) · plan [PLAN-N.md](PLAN-N.md) |
| **Baseline N3p SHA** | `369a7bf` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non |

---

## Objectif

SoT des steps **plateforme** du runner `electron/migrations` (brand.db /
`schema_version`) dans `@creezio/platform-core` ; inventaire 100 % classé ;
gaps `migrate-legacy` comblés. **Sans cutover marques** (→ N4p).

**Paperclip = mort** — aucun artefact introduit.  
**Exclu** : steps métier TF/CV/Fidu ; rewrite SQL métier.

---

## Inventaire TF (step → kit | brand | core)

| Step | Nom | Classe | Destination N4 |
|------|-----|--------|----------------|
| 001 | base-schema | métier TF (+ `meta`) | **brand** (métier) |
| 006 | agregateurs | métier | **brand** |
| 007 | drop-statut-scrape | métier | **brand** |
| 008 | catalogue-enrichi | métier | **brand** |
| 009 | commandes | métier | **brand** |
| 010 | category-images | métier | **brand** |
| 011 | onboarding | métier | **brand** |
| 012 | onboarding-brand | métier | **brand** |
| 013 | conditions-fournisseur | métier | **brand** |
| 014 | sku-coverage | métier | **brand** |
| 015 | commande-versions-sku-mapping | métier | **brand** |
| 016 | subscriptions | métier | **brand** |
| 017 | agent-todos | plateforme (prérequis 029) | **kit** `platformHistoricalMigrations` |
| 018 | restaurant-geo | métier | **brand** |
| 019 | panier-sku-default | métier | **brand** |
| 020 | api-keys | plateforme | **kit** |
| 021 | hermes | métier TF (surveillance prix) | **brand** |
| 022 | mcp-oauth | plateforme | **kit** |
| 023 | users | plateforme | **kit** |
| 024 | users-kind | plateforme | **kit** |
| 025 | desktop-presence | plateforme | **kit** |
| 026 | collab-ia-kanban | plateforme | **kit** |
| 027 | mcp-admin | plateforme | **kit** |
| 028 | plugin-product-hub | plateforme legacy | **kit** + **core** `PRODUCT_HUB_*` + migrate-legacy |
| 029 | unified-tasks | plateforme | **kit** |
| 030 | plugin-prd-sections | plateforme | **kit** + core / migrate-legacy |
| 031 | ai-recurrence-quotas | plateforme | **kit** |
| 032 | plugin-acl | plateforme | **kit** + core ACL / migrate-legacy |
| 033 | database-automations | plateforme | **kit** (`DATABASE_CORE_SQL` lazy) |
| 034 | emails | plateforme | **kit** |
| 035 | usage-analytics | plateforme | **kit** |

**Certivan 036–042** / **Fidu GED-CRM** = métier marque (hors N4).  
**021 hermes** classé métier : DDL surveillance/scraper lié catalogue TF, pas socle commun.

---

## Travaux kit

### `@creezio/platform-core` — `historical-migrations/`

| Module | Rôle | LOC (`wc -l`) |
|--------|------|---------------|
| `types.ts` | `HistoricalMigration` + helpers | ~70 |
| `runner.ts` | `runHistoricalMigrations` (better-sqlite3 cwd) | ~140 |
| `steps/*.ts` (×16) | TF gold plateforme | ~950 |
| `steps/index.ts` | `platformHistoricalMigrations()` + versions | ~55 |
| `index.ts` | barrel | ~30 |

**Total** : **1102 LOC** (`wc -l` sous `historical-migrations/`).

### Gaps comblés

| Gap | Fix |
|-----|-----|
| `migrateLegacyBrandProductHubOnce` SELECT `sections_json` si step 028 seul | filtre colonnes via `PRAGMA table_info` |
| Couverture core vs historique documentée | commentaire `core-migrations.ts` |
| Step 033 sans dep compile `database` | `createRequire("@creezio/database")` |

### API publique

```ts
import {
  platformHistoricalMigrations,
  runHistoricalMigrations,
  PLATFORM_HISTORICAL_STEP_VERSIONS,
  platformCoreMigrations,
} from "@creezio/platform-core";

// brand.db (Node vanilla) — cutover N4p
runHistoricalMigrations(dbPath, {
  migrations: [
    ...metierSteps,
    ...platformHistoricalMigrations(),
  ],
});

// core.db — inchangé M11
platformCoreMigrations();
```

---

## Upgrade path (DB existante)

1. Bases déjà à `schema_version ≥ 35` : no-op runner (steps idempotents).
2. Bases intermédiaires : mêmes versions numériques TF gold dans le kit —
   cutover N4p = import kit, **pas** de renumérotation.
3. Plugin Hub legacy brand → core : `migrateLegacyBrandProductHubOnce`
   (colonnes absentes ignorées — N4).
4. Auth kit (`creezio_users`) ≠ table `users` brand : dual-path inchangé
   (`migrateBrandCredentialsToKit` / stores).

---

## Critères done vision

| Critère | Preuve |
|---------|--------|
| Inventaire 100 % classé | ✅ tableau ci-dessus |
| Steps plateforme SoT kit | ✅ `platformHistoricalMigrations` |
| Aucune step plateforme **uniquement** marque sans équivalent kit | ✅ (jumeaux encore présents jusqu’à N4p — OK kit-only) |
| migrate-legacy gap columns | ✅ |
| Harness upgrade fixture | ✅ `test-phase-n4` |
| Paperclip absent | ✅ |
| Cutover marques | **exclu** → N4p |

---

## Gates

```bash
cd /opt/docker/creezio
npm run build -w @creezio/platform-core && npm run build -w @creezio/product-hub
npm test   # incl. test-phase-n4
```

---

## Push

| Repo | SHA |
|------|-----|
| kit `creezio/creezio` | `b2234b9` |

---

## Suite

**N4p** — Cutover migrations TF → Certivan → Fidu (runner ≤150 LOC ;
steps marque = métier only).
