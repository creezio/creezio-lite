# Phase M7 — Fleet + observability TF sans stubs

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `tempoflow2` |
| **Prérequis** | [PHASE-M6p.md](PHASE-M6p.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Non (packing inchangé) |

---

## Objectif

Stubs R4 fleet/ops TF → imports directs `@creezio/observability` (+
`@creezio/platform-core` pour consentement). Logique générique restante
portée dans le kit (`fleet-activity`, `fleet-samples` via hooks chemins).
Fichiers listés **absents** ; pas de fantômes re-export.

---

## Travaux kit

| Livrable | Note |
|----------|------|
| `ops/fleet-activity.ts` | Ring mémoire FleetProductEvent v1 |
| `ops/fleet-samples.ts` | `createFleetSamples(paths)` — spawn Node + redact |
| Exports `index.ts` | activity + samples + agent/journal existants |
| `fleet-telemetry` | déjà SoT `platform-core` (M4) — labels UI Config restent dans le composant React marque |
| `brand-config` DEFAULT_HOST_ONLY | retire `fleet-agent` / `fleet-samples` (wiring via `host-runtime-ctx`) |

---

## Travaux TF

| Fichier | Avant | Après |
|---------|------:|------:|
| `electron/fleet-agent.ts` | stub R4 | **absent** → `tfFleetAgent()` |
| `electron/ops-journal.ts` | stub R4 | **absent** → kit + hooks `main.ts` |
| `electron/ops-emit.ts` | re-export | **absent** |
| `electron/ops-rules.ts` | re-export | **absent** |
| `electron/ops-types.ts` | re-export | **absent** |
| `electron/fleet-telemetry.ts` | re-export + META mort | **absent** → `platform-core` |
| `electron/fleet-activity.ts` | logique locale | **absent** → kit |
| `electron/fleet-samples.ts` | logique locale | **absent** → `tfFleetSamples()` |
| `electron/host-runtime-ctx.ts` | hermes/n8n/tunnel | + `tfFleetAgent` / `tfFleetSamples` |
| `electron/host-stack.ts` | require stubs | lazy → host-runtime-ctx |
| `electron/crash-reporter.ts` | import stubs | kit + host-runtime-ctx |
| `electron/main.ts` | imports stubs | `@creezio/observability` + `setOpsJournalHooks` |

---

## Critères done vision

| Critère | Preuve |
|---------|--------|
| Stubs agent/journal/emit/rules/types absents | ✅ |
| Pas de fichiers-fantômes re-export fleet/ops | ✅ |
| `fleet-activity` / `fleet-samples` SoT kit | ✅ |
| Vendor liste complète | ✅ |
| Gates ci-dessous | ✅ |
| PHASE-M7.md | ✅ |

**Exclu M7** : Certivan/Fidu (→ **M7p**).

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. c4/r4 + test-phase-m7
cd /opt/docker/tempoflow2/crm && bash scripts/electron/sync-creezio-vendor.sh
npm run electron:compile \
  && npm run test:fleet \
  && npm run test:ops-journal \
  && npm run test:phase-c4 \
  && npm run electron:compile
```

| Gate | Résultat |
|------|----------|
| kit `npm test` (c4/r4/m7) | ✅ |
| TF vendor liste complète | ✅ |
| TF `test:fleet` / `test:ops-journal` / `test:phase-c4` / compile | ✅ |

---

## Push

| Repo | SHA |
|------|-----|
| kit `creezio/creezio` | `0715e49` |
| TF `tempoflow2` | `575eb35` |

---

## Suite

**M7p** — Certivan puis Fidu (mêmes critères fleet/ops sans stubs).
