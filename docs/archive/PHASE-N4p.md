# Phase N4p — Cutover migrations (TF → Certivan → Fidu)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repos** | `creezio/creezio` + 3 marques |
| **Prérequis** | [PHASE-N4.md](PHASE-N4.md) · plan [PLAN-N.md](PLAN-N.md) |
| **Baseline N4 SHA** | `b2234b9` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Oui Fidu (boot DB packaged) — voir push marques |

---

## Objectif

Steps **plateforme** absents des marques (ou wraps mince Fidu) ; runner ≤150 LOC
via `runHistoricalMigrations` ; steps restants = métier / brand-migrations.

**Paperclip = mort.**

---

## Cutover par marque

| Marque | SHA | Runner LOC | Steps plateforme locaux | Notes |
|--------|-----|------------|-------------------------|-------|
| TempoFlow | `37ea6e6` | 44 | **absents** | métier catalogue + hermes + kit |
| Certivan | `da7e356` | 70 | **absents** | 036 baseline → kit ; FRESH sans TF |
| Fidu | `1763332` (+ release `85e2082` / **0.1.61**) | 45 | wraps ≤20 LOC | orphelins TF deleted ; 018/019 deltas |

### Absents (TF + CV)

`017_agent_todos`, `020_api_keys`, `022_mcp_oauth`, `023_users`,
`024_users_kind`, `025_desktop_presence`, `026_collab_ia_kanban`,
`027_mcp_admin`, `028_plugin_product_hub`, `029_unified_tasks`,
`030_plugin_prd_sections`, `031_ai_recurrence_quotas`, `032_plugin_acl`,
`033_database_automations`, `034_emails`, `035_usage_analytics`.

### Fidu

- Orphelins catalogue TF **absents**.
- `002` / `003` / `012` / `023` / `017` = wraps → kit `up()`.
- `018_collab_ia_kanban` / `019_ai_task_p1` = deltas métier GED conservés.

---

## Gates

```bash
# Kit
cd /opt/docker/creezio && npm test   # incl. test-phase-n4p

# TF
cd /opt/docker/tempoflow2/crm
test ! -f electron/migrations/steps/028_plugin_product_hub.ts
wc -l electron/migrations/runner.ts   # ≤150
npm run electron:compile && npm run test:database-module

# CV
cd /opt/docker/certivan-app/crm
test ! -f electron/migrations/steps/033_database_automations.ts
wc -l electron/migrations/runner.ts   # ≤150
npm run electron:compile && npm run test:database-module

# Fidu
cd /opt/docker/fidu/crm
test ! -f electron/migrations/steps/001_base.ts
wc -l electron/migrations/runner.ts   # ≤150
npm run electron:compile && npm run test:fidu
```

---

## Done

| Critère | Preuve |
|---------|--------|
| Cutover TF+CV+Fidu poussé | SHAs ci-dessus |
| Runners ≤150 LOC | ✅ |
| Steps plateforme TF/CV absents | ✅ |
| Gates database-module / test:fidu | ✅ |
| Vendor liste complète | ✅ sync ×3 |
| Republish packing | ✅ Fidu **0.1.61** — [Fidu-Setup-0.1.61.exe](https://fidu.creez.io/dl-e660352fb04dbd5e2519f0e60897c548/Fidu-Setup-0.1.61.exe) |
| Kit sign-off | `893ad64` |

---

## Suite

**N5** — Feature-off Fidu (`host-na-stubs` → contrat kit).
