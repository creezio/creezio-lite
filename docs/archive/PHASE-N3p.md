# Phase N3p — Cutover assistant (TF → Certivan → Fidu)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (+ marques) |
| **Prérequis** | [PHASE-N3.md](PHASE-N3.md) · plan [PLAN-N.md](PLAN-N.md) |
| **Baseline N3 SHA** | `863406f` (+ fix client-safe `a358d5b`) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non (pas de packing) |

---

## Objectif

Marques : imports `@creezio/assistant` (+ `/ui`) ; runtime/UI génériques
**absents** ; reste = AppMap / Prompts / BrandTools métier sous budget.
**Paperclip = mort**.

---

## Sign-off marques

| Marque | Repo SHA | LOC assistant | chat-db | UI locale |
|--------|----------|---------------|---------|-----------|
| **TempoFlow** | `cfd4a49` | **1745** | façade **26** | absente → kit `/ui` |
| **Certivan** | `49d39be` | **1507** | façade **26** | absente → kit `/ui` |
| **Fidu** | `e9542f5` | **1694** | façade **26** | absente → kit `/ui` |

### Budgets

| Surface | Critère |
|---------|---------|
| `src/lib/assistant` + `src/components/assistant` | ≤ **2000 LOC** ×3 |
| `chat-db.ts` | absent ou ≤ **80 LOC** |
| `assistant-widget.tsx` jumeau | **absent** ×3 |
| Marque conservée | app-map, prompts, sql-tools/sources, meili-brand, configure-brand, work-briefs |

### Wiring commun

- `configureAssistantBrand` (server) + `configure-brand-client` (identity UI)
- Meili / Hermes / DB injectés par marque
- Aids DOM unifiés `data-tf2-aid` pour UiDriver kit

---

## Gates

```bash
# Par marque (TF → CV → Fidu)
bash scripts/electron/sync-creezio-vendor.sh
npm run test:assistant-routing
npm run test:active-surface
npm run electron:compile
npm run build
# Fidu en plus : npm run test:fidu

# Kit
cd /opt/docker/creezio && npm test   # incl. test-phase-n3p
```

### Gate `test-phase-n3p`

- Absents ×3 : `assistant-widget.tsx`, `meili-rag.ts`, `hermes-client.ts`, `agent-loop.ts`
- Présents ×3 : `configure-brand.ts`, `app-map.ts`, `prompts.ts`
- LOC ≤ 2000 ; chat-db ≤ 80
- Paperclip mort
- PLAN-N N3p marqué livré + SHAs

---

## Done

| Critère | Preuve |
|---------|--------|
| Cutover TF+CV+Fidu poussé | SHAs ci-dessus |
| Budgets LOC | ✅ |
| Gates marques | ✅ |
| Republish packing | Non |

---

## Suite

**N4** — Migrations historiques plateforme → kit.
