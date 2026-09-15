# Phase M2 — Admin UI Database hors TF

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `tempoflow2` |
| **Prérequis** | [PHASE-M1.md](PHASE-M1.md) / [PHASE-M1p.md](PHASE-M1p.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Oui** (après M2p — sync UI sur Certivan/Fidu) |

---

## Objectif

Panels Admin Database **hors** TempoFlow : SoT kit `@creezio/database/ui` +
handlers HTTP `createAdminDatabaseRoutes`. TF ne garde que auth / policy /
montage mince.

---

## Travaux

1. Port TF → kit : `ui/database-client.tsx`, `ui/database-automations-panel.tsx`,
   `ui/types.ts` + primitives associées (badge/button/input/sheet/tabs/cn).
2. Factory Hono `createAdminDatabaseRoutes` dans `@creezio/database` (handlers).
3. TF `admin-database.ts` mince (getDb / getActor / webhookTestSource).
4. Page `/admin/database` → `import { DatabaseClient } from "@creezio/database/ui"`.
5. Suppression panels TF locaux ; Tailwind content + `transpilePackages`.
6. Vendor sync copie aussi `packages/*/ui` (liste complète inchangée).

---

## Critères done vision

| Critère | Preuve |
|---------|--------|
| Panels absents TF (`database-client.tsx`, `database/`) | ✅ |
| Page admin = import `@creezio/database/ui` | ✅ |
| `admin-database.ts` ≤ ~150 LOC (auth/mount/policy) | ✅ (~19 LOC) |
| Zéro stub / façade UI locale | ✅ |

**Exclu M2** : Certivan/Fidu (→ **M2p**).

---

## Gates

```bash
cd /opt/docker/creezio && npm test && npm run build -w @creezio/database
cd /opt/docker/tempoflow2/crm && bash scripts/electron/sync-creezio-vendor.sh
cd /opt/docker/tempoflow2/crm && npm run electron:compile \
  && npm run test:database-module \
  && npm run test:admin-introspection
```

| Gate | Résultat |
|------|----------|
| kit `npm test` (+ M2) | ✅ |
| `@creezio/database` build | ✅ |
| TF vendor sync complète | ✅ |
| TF `electron:compile` | ✅ |
| TF `test:database-module` | ✅ |
| TF `test:admin-introspection` | ✅ |

---

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `@creezio/database/ui` + `createAdminDatabaseRoutes` | ✅ |
| 2 | Cutover TF sans panels locaux | ✅ |
| 3 | Ce fichier + `test-phase-m2.mjs` | ✅ |
| 4 | Push kit `18285a5` + TF `a50fc11` | ✅ |

---

## Suite

**M2p** — Même UI kit sur Certivan puis Fidu (séquentiel).

---

## Verdict

**Phase M2 : TERMINÉE.** Admin UI Database SoT kit ; TF = auth + montage.
