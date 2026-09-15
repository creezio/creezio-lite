# Phase M14 — Certivan gold

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `certivan-app` |
| **Prérequis** | [PHASE-M13.md](PHASE-M13.md) |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish** | Non (pas de packing) |

---

## Objectif

Certivan = **gold vision** : métier RTI/VASP only + wiring mince ; migrations
cœur = `platformCoreMigrations()` kit (IDs TF gold) ; zéro jumeau plateforme /
stub fantôme. Paperclip = mort.

---

## Allowlist Certivan (métier + wiring)

| Zone | Contenu autorisé |
|------|------------------|
| Modules métier | `dossiers`, `pieces`, `rti` (+ MCP/nav brand) |
| Seeds / vertical | hermes seeds, n8n-api-key, fleet-dossier-samples, pdf-renderer… |
| Host wiring | `host-runtime-ctx`, `host-stack` |
| Brand runtime | mounts dossiers/pieces/rti + stores kit |
| Composition | `main.ts` ≤ 800 LOC via `installBrandDesktopRuntime` |
| Migrations brand | `brand-migrations` métier VASP (`i15_brand_*`) |

**Delete M14** : `electron/modules/core-migrations.ts` (composition `i15_core_*`
locale) → SoT kit.

---

## Travaux

| Fichier | Après |
|---------|-------|
| `brand-runtime.ts` | `platformCoreMigrations()` |
| `modules/core-migrations.ts` | **absent** |
| `modules/index.ts` | re-export alias déprécié → kit |
| `test-phase-h3-modules.mjs` | assert `h3_core_*` / `r2_core_*` |

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-m14
cd /opt/docker/certivan-app/crm
npm run electron:compile \
  && npm run test:phase-h3 \
  && npm run test:database-module \
  && npm run test:rti \
  && npm run test:dossiers \
  && npm run test:pieces \
  && npm run test:shell \
  && npm run build
```

---

## Done vision M14

| Critère | Preuve |
|---------|--------|
| Allowlist métier figée | ✅ |
| Core = kit `platformCoreMigrations` | ✅ |
| Jumeaux plateforme = 0 | ✅ gate M14.3 |
| Gates verts | ✅ |
| Suite | **M15** Fidu gold |

---

## Push

| Repo | SHA |
|------|-----|
| kit `creezio/creezio` | *(ce commit)* |
| Certivan `certivan-app` | `e51b369` |

---

## Suite

Selon [PLAN-M.md](PLAN-M.md) : **M15** Fidu gold.
