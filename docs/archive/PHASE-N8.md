# Phase N8 — Gates LOC + allowlists vision

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` |
| **Prérequis** | [PHASE-N7.md](PHASE-N7.md) · plan [PLAN-N.md](PLAN-N.md) |
| **Baseline N7 kit tip** | `fdc10d8` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non |

---

## Objectif

Budgets LOC **mesurables** ×3 marques + listes **forbidden** (jumeaux
plateforme / clients admin locaux) — gates permanents `test-phase-n8`.

**Paperclip = mort.**

---

## Budgets LOC (ceiling)

| Surface | TF | CV | Fidu |
|---------|---:|---:|-----:|
| `electron/main.ts` | ≤800 | ≤800 | ≤800 |
| `electron/preload-app.ts` | ≤260 | ≤260 | ≤260 |
| `electron/migrations/runner.ts` | ≤150 | ≤150 | ≤150 |
| `electron/supplier-tabs.ts` | ≥400 (métier) | ≤40 | ≤40 |
| `electron/supplier-driver.ts` | — | ≤40 | ≤40 |
| `src/lib/mcp-admin.ts` | ≤80 | ≤80 | absent OK |
| `src/lib/usage-analytics.ts` | ≤80 | ≤80 | absent OK |
| `src/app/admin/plugins/page.tsx` | ≤80 | ≤80 | absent OK |
| `src/lib/assistant/configure-brand.ts` | ≤80 | ≤80 | ≤80 |

## Forbidden (doivent rester absents ×3 sauf note)

| Relatif `crm/` | Notes |
|----------------|-------|
| `electron/meili-launcher.ts` | SoT kit |
| `electron/local-config.ts` | SoT kit |
| `electron/host-na-stubs.ts` | N5 Fidu deleted |
| `src/components/admin/analytics-client.tsx` | N6p TF/CV |
| `src/components/admin/mcp-admin-client.tsx` | N6p TF/CV |
| `src/components/admin/analytics-productivity-panel.tsx` | N6p TF/CV |
| Toute API / launcher Paperclip | N0 — mort |

### Allowlist métier TF (rappel)

`supplier-tabs` / `supplier-driver` **locaux gras** autorisés uniquement TF.
CV/Fidu = façades kit `browser-tabs`.

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-n8
```

---

## Done

| Critère | Preuve |
|---------|--------|
| Budgets + forbidden figés | ✅ ce doc + `test-phase-n8.mjs` |
| Kit `npm test` | ✅ |
| PLAN-N N8 | ✅ |

---

## SHAs

| Repo | SHA |
|------|-----|
| Kit | `b522876` |

---

## Suite

**N9** — Freeze vision 100 % (matrice + dry-run sync ×3).
