# Phase M8 — Stores auth / assistant / tasks / mails TF (vision stricte)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `tempoflow2` |
| **Prérequis** | [PHASE-M7p.md](PHASE-M7p.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Non (packing inchangé) |

---

## Objectif

Stores SoT kit (`@creezio/auth|assistant|tasks|mails` + `platform-core`) ;
plus de couche `platform-stores/*` lourde côté TF. Call-sites → imports
directs. `platform-stores` = Product Hub M3 seulement (≤80 LOC cumulés).

---

## Travaux kit

| Livrable | Note |
|----------|------|
| `platform-core/core-db-env.ts` | `resolveCoreDbPathFromEnv` / `ensureCoreDbParent` |
| `platform-core/platform-stores-contract.ts` | `PLATFORM_STORES_CONTRACT` (4 domaines cutover) |
| `auth/env-store.ts` | `getKitAuthStore` / `authenticateViaKit` / migrate / count |
| `assistant/env-store.ts` | `getKitAssistantStore` / `requireKitAssistantStore` |
| `tasks/env-bridge.ts` | `upsertKitPlatformTask` |
| `mails/env-bridge.ts` | `indexKitInboundMail` |

---

## Travaux TF

| Fichier | Avant | Après |
|---------|------:|------:|
| `platform-stores/auth-adapter.ts` | 163 | **absent** → `@creezio/auth` |
| `platform-stores/assistant-adapter.ts` | 45 | **absent** → `@creezio/assistant` |
| `platform-stores/tasks-mails-adapters.ts` | 110 | **absent** → `@creezio/tasks` / `mails` |
| `platform-stores/paths.ts` | 47 | **absent** → `@creezio/platform-core` |
| `platform-stores/contract.ts` | 76 | **absent** → kit contract |
| `platform-stores/product-hub-adapter.ts` | 37 | **≤40** (paths kit) |
| `platform-stores/**` total | ~515 | **≤80** |
| `routes/auth.ts` | platform-stores | `@creezio/auth` |
| `lib/tasks.ts` | platform-stores | `@creezio/tasks` |
| `lib/email-queries.ts` | platform-stores | `@creezio/mails` |
| `lib/assistant/chat-db.ts` | assistant-adapter | `@creezio/assistant` |

---

## Critères done vision

| Critère | Preuve |
|---------|--------|
| Adapters lourds absents | ✅ |
| `platform-stores` ≤80 LOC cumulés | ✅ (~49) |
| Call-sites `@creezio/*` directs | ✅ |
| Pas de dual-write runtime | ✅ |
| Vendor liste complète | ✅ |
| Gates ci-dessous | ✅ |
| PHASE-M8.md | ✅ |

**Exclu M8** : Certivan/Fidu (→ **M8p**).

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-m8
cd /opt/docker/tempoflow2/crm && bash scripts/electron/sync-creezio-vendor.sh
npm run electron:compile \
  && npm run test:phase-c1 \
  && npm run test:phase-i13 \
  && npm run test:tasks \
  && npm run test:mcp-tasks \
  && npm run test:email-inbox \
  && npm run test:assistant-routing \
  && npm run test:assistant-chat-scope \
  && npm run electron:compile
```

---

## Push

| Repo | SHA |
|------|-----|
| kit `creezio/creezio` | `0a894b3` |
| TF `tempoflow2` | `d7b60b4` |

---

## Suite

**M8p** — Certivan puis Fidu (mêmes critères stores mince).
