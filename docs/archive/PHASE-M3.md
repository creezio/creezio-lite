# Phase M3 — Product Hub / control-plane : zéro façade TF

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `tempoflow2` |
| **Prérequis** | [PHASE-M2p.md](PHASE-M2p.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Non (M3 TF) ; M3p = Certivan/Fidu |

---

## Objectif

Product Hub + control-plane **sans jumeau TF** : imports directs
`@creezio/product-hub` + `startHostPluginControlPlane` ; adapters verticaux
minces (git, accept-check, CRM key) ; SoT `core.db` ; pas de dual-write brand.

---

## Travaux kit

1. `migrateLegacyBrandProductHubOnce` — one-shot brand→core.
2. `withBearerServiceKeyFallback` + `createBrandProductHubBindings`.
3. `createCachedSqliteProductHubAccessor` — singleton Next/CRM.
4. `createProductHubHost` — API routes (impact, CRUD, PRD…).

## Travaux TF

| Fichier | Avant | Après | Rôle |
|---------|------:|------:|------|
| `electron/plugin-control-api.ts` | 467 | **16** | barrel wiring |
| `electron/plugin-control-extras.ts` | — | vertical | boot kit + accept-check/versions/llm |
| `electron/plugin-hub-store.ts` | 114 | **39** | bindings kit |
| `electron/plugin-control-adapters.ts` | 103 | 103 | vertical git/CRM |
| `src/lib/.../product-hub-adapter.ts` | 308 | **37** | accessor kit |
| `src/lib/plugin-product-hub.ts` | 319 | **37** | host-api kit |

---

## Critères done vision

| Critère | Preuve |
|---------|--------|
| Façades ≤40 LOC wiring pur | ✅ api 16 / hub-store 39 / adapter 37 / product-hub 37 |
| Boot = `startHostPluginControlPlane` | ✅ extras |
| SoT core.db ; pas de dual-write brand | ✅ migrate one-shot kit only |
| Adapters verticaux seulement | ✅ adapters + extras |

**Exclu M3** : Certivan/Fidu (→ **M3p**).

---

## Gates

```bash
cd /opt/docker/creezio && npm test && npm run build -w @creezio/product-hub
cd /opt/docker/tempoflow2/crm && bash scripts/electron/sync-creezio-vendor.sh
cd /opt/docker/tempoflow2/crm && npm run electron:compile \
  && npm run test:plugin-acl-l3 \
  && npm run test:plugin-control-api \
  && npm run test:product-hub \
  && npm run test:plugin-runtime
```

| Gate | Résultat |
|------|----------|
| kit `npm test` (+ M3) | ✅ |
| `@creezio/product-hub` build | ✅ |
| TF vendor sync complète | ✅ |
| TF `electron:compile` | ✅ |
| TF `test:plugin-acl-l3` | ✅ |
| TF `test:plugin-control-api` | ✅ |
| TF `test:product-hub` | ✅ |
| TF `test:plugin-runtime` | ✅ |

---

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | Helpers kit Product Hub (migrate, bindings, host-api) | ✅ |
| 2 | Cutover TF façades ≤40 LOC | ✅ |
| 3 | Ce fichier + `test-phase-m3.mjs` | ✅ |
| 4 | Push kit `0f6b843` + TF `c2b0291` | ✅ |

---

## Suite

**M3p** — Product Hub marques (Certivan puis Fidu) → [PHASE-M3p.md](PHASE-M3p.md).
