# Phase M7p — Fleet / observability Certivan puis Fidu

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `certivan-app` + `fidu` |
| **Prérequis** | [PHASE-M7.md](PHASE-M7.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Non (packing inchangé) |

---

## Objectif

Mêmes critères que M7 sur Certivan puis Fidu : jumeaux / stubs
fleet/ops **absents** ; SoT `@creezio/observability` (+ `platform-core`
consentement) ; vendor **liste complète**.

---

## Kit (delta M7p)

| Livrable | Note |
|----------|------|
| `getHeartbeatExtras` | hook runtime flotte (dossierStats métier) |
| `OPS_EVENT_PREFIXES` | dual-read `TF2EVENT` + `CertivanEVENT` |
| Émission | toujours `TF2EVENT` (`emitOpsEvent`) |

---

## Certivan

| Fichier | Après |
|---------|-------|
| `fleet-agent.ts` / `ops-*` / `fleet-{telemetry,activity,samples}` | **absents** |
| `host-runtime-ctx` | `cvFleetAgent` / `cvFleetSamples` |
| `fleet-dossier-samples.ts` | **métier** (sampleDossierStats → getHeartbeatExtras) |
| `ops-track` Next | émet `TF2EVENT` |
| Gates | `test:fleet`, `test:ops-journal`, main-graph, app-kind, compile |

---

## Fidu

| Critère | Preuve |
|---------|--------|
| Stubs fleet/ops electron | **déjà absents** (pas de surface flotte desktop) |
| Vendor liste complète | ✅ sync post-M7/M7p kit |
| `electron:compile` | ✅ |

---

## Critères done vision

| Critère | Certivan | Fidu |
|---------|----------|------|
| Stubs/jumeaux agent/journal absents | ✅ | ✅ (N/A) |
| Pas de fantômes re-export | ✅ | ✅ |
| Vendor liste complète | ✅ | ✅ |
| Gates pertinents | ✅ | ✅ compile + vendor |

---

## Push

| Repo | SHA |
|------|-----|
| kit `creezio/creezio` | `e6bb680` |
| Certivan `certivan-app` | `7f8e03f` |
| Fidu | `ca088e3` |

---

## Suite

**M8** — stores auth/tasks/mails mince (si capacité) ; sinon arrêt après M7p.
