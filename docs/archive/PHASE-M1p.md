# Phase M1p — Database engine : propagate Certivan puis Fidu

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `certivan-app` → `fidu` (+ docs kit) |
| **Prérequis** | [PHASE-M1.md](PHASE-M1.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** |

---

## Objectif

Même critère vision que M1 sur **Certivan** puis **Fidu** (séquentiel) :
plus de jumeau / shim `src/lib/database/*` ; imports `@creezio/database` ;
vendor **liste complète**.

---

## Certivan

| Travaux | Statut |
|---------|--------|
| Suppression jumeau `crm/src/lib/database/**` (~1609 LOC) | ✅ |
| `brand-database-host.ts` (policy + webhook Certivan) | ✅ |
| Route `admin-database` + `db.ts` → `@creezio/database` | ✅ |
| Migration 033 = `DATABASE_CORE_SQL` kit | ✅ |
| Sync vendor **liste complète** (+ observability/automations/database) | ✅ |
| `test:database-module` 32 ok | ✅ |
| `electron:compile` | ✅ |

## Fidu

| Travaux | Statut |
|---------|--------|
| Pas de jumeau `src/lib/database` (déjà absent) | ✅ |
| `brand-database-host.ts` + allowlist métier Fidu | ✅ |
| Migration `023_database_automations` = `DATABASE_CORE_SQL` | ✅ |
| `db.ts` bootstrap automations kit | ✅ |
| Sync vendor **liste complète** | ✅ |
| `test:database-module` réel (27 ok, pas stub) | ✅ |
| `electron:compile` | ✅ |

**Exclu M1p** : UI Admin Database (→ **M2 / M2p**).

---

## Gates

```bash
cd /opt/docker/certivan-app/crm && bash scripts/electron/sync-creezio-vendor.sh \
  && npm run electron:compile && npm run test:database-module
cd /opt/docker/fidu/crm && bash scripts/electron/sync-creezio-vendor.sh \
  && npm run electron:compile && npm run test:database-module
cd /opt/docker/creezio && npm test
```

---

## Critères done vision

| Critère | Certivan | Fidu |
|---------|----------|------|
| `test ! -d src/lib/database` | ✅ | ✅ |
| Imports `@creezio/database` directs | ✅ | ✅ |
| Vendor liste complète (pas un seul package) | ✅ | ✅ |
| Test database non-stub vert | ✅ 32 | ✅ 27 |

---

## Suite

**M2** — Admin UI Database hors TF (panels React → kit).

---

## Verdict

**Phase M1p : TERMINÉE.** Database engine kit consommé par Certivan et Fidu
sans shims / jumeaux locaux.
