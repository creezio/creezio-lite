# Phase C4 — V2/V3 prod-ready (SQLite + console + TF pilote)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repos** | `creezio/creezio` + `tempoflow2` (pilote) |
| **Prérequis** | [PHASE-C3.md](PHASE-C3.md), V2/V3 |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish marques** | **Non** — regroupé **C8** |

---

## Objectif

Fermer les demi-mesures V2/V3 : persistance SQLite rules/runs automations,
console ops sur SQLite (plus JSON mémoire), vendor `observability` +
`automations` sur TempoFlow pilote + demobrand aligné.

## Livrables kit

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `createSqliteAutomationPersist` + schema core | ✅ |
| 2 | Engine `persist` adapter (reopen rules/runs) | ✅ |
| 3 | Console obs → SQLite `var/console-core.db` | ✅ |
| 4 | Console `/api/automations` + persist | ✅ |
| 5 | Demobrand persist automations | ✅ |
| 6 | `test-phase-c4.mjs` + docs | ✅ |

## Livrables TempoFlow

| # | Livrable | Statut |
|---|----------|--------|
| 1 | Vendor sync `observability` + `automations` | ✅ |
| 2 | `brand-runtime` mounts + stores C4 | ✅ |
| 3 | `test:phase-c4` | ✅ |

## Vérif

```bash
cd /opt/docker/creezio && npm test   # inclut test-phase-c4
cd /opt/docker/tempoflow2/crm && npm run test:phase-c4
```

## Suite

→ **C7** control-plane unifié · **C8** docs + republish.

## Verdict

**Phase C4 : TERMINÉE.**
