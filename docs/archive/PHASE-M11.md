# Phase M11 — SQLite core layout / migrations cœur

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `tempoflow2` |
| **Prérequis** | [PHASE-M10.md](PHASE-M10.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Non |

---

## Objectif

Migrations / runtime SQLite **cœur** uniquement `@creezio/platform-core` ;
TF ne garde que `brand-migrations` métier (pas auth / hub / tasks plateforme).

---

## Travaux kit

| Livrable | Note |
|----------|------|
| `platform-core/core-migrations.ts` | `platformCoreMigrations()` + `PLATFORM_CORE_MIGRATION_IDS` |
| Peer deps optionnels | `@creezio/auth`, `@creezio/product-hub` (load runtime, pas de cycle build) |
| IDs stables | `h3_core_001_auth` … `r2_core_004_product_hub_runtime` (TF gold) |

---

## Travaux TF

| Fichier | Avant | Après |
|---------|------:|------:|
| `electron/modules/core-migrations.ts` | 36 LOC composition | **absent** |
| `brand-runtime.ts` | `tempoflowCoreMigrations()` | `platformCoreMigrations()` kit |
| `modules/index.ts` | export local | re-export alias déprécié → kit |
| `brand-migrations.ts` | métier only | inchangé (catalogue/panier/…) |

---

## Critères done vision

| Critère | Preuve |
|---------|--------|
| Pas de DDL / composition cœur dupliquée dans TF | ✅ `core-migrations.ts` absent |
| `brand-migrations` sans tables auth/hub/tasks plateforme | ✅ |
| SoT `platformCoreMigrations` kit | ✅ |
| Vendor liste complète | ✅ |
| Gates ci-dessous | ✅ |
| PHASE-M11.md | ✅ |

**Exclu M11** : Certivan/Fidu (IDs `i15_*` / `i17_*` → gold M14/M15) ;
slim `main.ts` (→ **M12**).

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-m11
cd /opt/docker/tempoflow2/crm && bash scripts/electron/sync-creezio-vendor.sh
npm run electron:compile \
  && npm run test:phase-d2 \
  && npm run test:phase-c1 \
  && npm run electron:compile
```

---

## Push

| Repo | SHA |
|------|-----|
| kit `creezio/creezio` | `b443335` |
| TF `tempoflow2` | `a7fd8d6` |

---

## Suite

**M12** — `electron/main.ts` ≤ 800 LOC via façade kit.
