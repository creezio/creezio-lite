# Phase O2 — Anti-façades lib + wraps migrations Fidu

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + TempoFlow + Certivan + Fidu |
| **Prérequis** | [PHASE-O1.md](PHASE-O1.md) · plan [PLAN-O.md](PLAN-O.md) |
| **Baseline O1 kit tip** | `ff1ca87` / docs `022111b` |
| **Kit tip O2** | `e1335d8` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Oui Fidu **0.1.64** |

### SHAs marques (gold O2)

| Marque | SHA |
|--------|-----|
| TempoFlow | `3bf55fd` |
| Certivan | `ba620bd` |
| Fidu | `50f741b` |

---

## Objectif

**0 façade** lib re-export (`mcp-admin`, `usage-analytics*`, `assistant/chat-db`,
`active-surface`). **0 wraps** `platformHistoricalMigrations().find` dans
`fidu/.../migrations/steps/`. Imports `@creezio/*` directs ; wirings
`brand-*-host` conservés (O7).

---

## Travaux

| Zone | Action |
|------|--------|
| Kit | `platformHistoricalMigrationByName` (extract find) |
| TF/CV | delete façades lib ; imports kit + brand-host aux call sites |
| Fidu | delete chat-db/active-surface ; `platform-compose.ts` ; delete wraps steps |
| Gates | N3p/N4p/N6p/N8/M8/M8p amendés anti-façade |
| Vendor | sync liste complète ×3 |

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-o2
# ×3 :
rg -n "from ['\"]@/lib/mcp-admin|from ['\"]@/lib/assistant/chat-db" crm/src && exit 1 || true
test ! -f crm/src/lib/mcp-admin.ts          # TF/CV
test ! -f crm/src/lib/assistant/chat-db.ts  # ×3
# Fidu :
rg -n "platformHistoricalMigrations\(\)\.find" crm/electron/migrations/steps && exit 1 || true
npm run build && npm run electron:compile
npm run test:fidu
```

---

## Done

| Critère | Preuve |
|---------|--------|
| Façades listées absentes | ✅ |
| 0 wraps `.find` dans steps/ | ✅ |
| Runner Fidu ≤150 LOC | ✅ |
| `test-phase-o2` + `npm test` | ✅ |
| Sync vendor ×3 | ✅ |
| Republish Fidu | ✅ 0.1.64 feed |

---

## Suite

**O3** — Jumeaux Electron plateforme → kit.
