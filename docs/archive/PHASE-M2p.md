# Phase M2p — Admin UI Database : Certivan puis Fidu

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `certivan-app` `6c47d95` → `fidu` `fdc63d3` (+ kit `2f388db`) |
| **Prérequis** | [PHASE-M2.md](PHASE-M2.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Certivan sync vendor ; Fidu ship pipeline si UI desktop |

---

## Objectif

Même UI kit `@creezio/database/ui` + `createAdminDatabaseRoutes` sur
**Certivan** puis **Fidu** ; zéro copie locale des panels.

---

## Certivan

| Travaux | Statut |
|---------|--------|
| Panels locaux supprimés | ✅ |
| Page → `@creezio/database/ui` | ✅ |
| Route mince `createAdminDatabaseRoutes` | ✅ |
| Tailwind content + `transpilePackages` | ✅ |
| Vendor sync liste complète | ✅ |
| `test:database-module` 32 ok + admin-introspection | ✅ |

## Fidu

| Travaux | Statut |
|---------|--------|
| Pas de fork panel (déjà absent) → branchement UI kit | ✅ |
| Route `admin-database.ts` + montage `/admin` | ✅ |
| Page `/admin/database` + nav Admin | ✅ |
| Tailwind content + `transpilePackages` | ✅ |
| Vendor sync liste complète | ✅ |
| `test:database-module` (+ API/UI asserts M2p) | ✅ |

---

## Gates

```bash
cd /opt/docker/certivan-app/crm && bash scripts/electron/sync-creezio-vendor.sh \
  && npm run electron:compile && npm run test:database-module \
  && npm run test:admin-introspection
cd /opt/docker/fidu/crm && bash scripts/electron/sync-creezio-vendor.sh \
  && npm run electron:compile && npm run test:database-module
cd /opt/docker/creezio && npm test
```

---

## Critères done vision

| Critère | Certivan | Fidu |
|---------|----------|------|
| Panels locaux absents | ✅ | ✅ |
| Import `@creezio/database/ui` | ✅ | ✅ |
| Route mince kit | ✅ | ✅ |
| Vendor liste complète | ✅ | ✅ |

---

## Suite

**M3** — Product Hub / control-plane : zéro façade TF (si session le permet).

---

## Verdict

**Phase M2p : TERMINÉE.** Admin UI Database SoT kit sur les trois marques.
