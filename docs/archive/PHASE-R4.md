# Phase R4 — Observabilité unifiée (`@creezio/observability` ← ops/fleet TF)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` + `tempoflow2` |
| **Prérequis** | [PHASE-R3.md](PHASE-R3.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish exe TF** | **Non** (cutover lib + vendor) |
| **Kit SHA** | `5550186` |
| **TF SHA** | `beddcaa` |

---

## Objectif

Unifier la **boîte noire desktop** (ops-journal / rules / emit) et l’**agent
flotte** dans `@creezio/observability` (SoT kit), en **extrayant** TempoFlow —
sans inventer un 2ᵉ moteur, sans casser le protocole `TF2EVENT`.

Le store SQLite V2 (activité / usages / control-plane) **coexiste** dans le
même package : console org ≠ journal poste, même façade `@creezio/observability`.

---

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `ops/types.ts` + `journal.ts` + `rules.ts` + `emit.ts` dans kit | ✅ |
| 2 | `createFleetAgent` + hooks (endpoint, consent, installId, log) | ✅ |
| 3 | Hooks journal : `log` / `onAnomaly` (crash-reporter marque) | ✅ |
| 4 | Stubs TF `ops-*` + `fleet-agent.ts` | ✅ |
| 5 | `scripts/test-phase-r4.mjs` + smokes TF `test:ops-journal` | ✅ |
| 6 | `docs/PHASE-R4.md` + push kit / TF | ✅ |

---

## Frontière

| Dans `@creezio/observability` | Reste TF (marque) |
|-------------------------------|-------------------|
| Types ops, JSONL, TF2EVENT, rules, emit | Prefixe log basename, kinds métier instrumentés |
| `initOpsJournal` / `track` / drain / summaries | Hook `onAnomaly` → crash-reporter TF |
| `createFleetAgent` | Endpoint `fleet.tempoflow.fr`, `getFleetTelemetry`, scopes TF |

**Interdit respecté** : pas de 2ᵉ journal ; protocole `TF2EVENT` inchangé.

---

## Cutover TempoFlow (ops)

```bash
cd /opt/docker/creezio && npm run build -w @creezio/observability && npx tsc -p packages/observability/tsconfig.cjs.json
cd /opt/docker/tempoflow2/crm && npm run electron:sync-vendor && npm run electron:compile
npm run test:ops-journal && npm run test:electron-main-graph && npm run test:updater
node /opt/docker/creezio/scripts/test-phase-r4.mjs
```

---

## Suite

**R5** — API façade unifiée (si capacité) ; sinon arrêt après R4.

---

## Verdict

**Phase R4 : TERMINÉE.** Ops journal + fleet agent extraits dans
`@creezio/observability` ; TempoFlow = stubs + hooks marque.
