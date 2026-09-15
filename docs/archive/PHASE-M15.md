# Phase M15 — Fidu gold

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `fidu` |
| **Prérequis** | [PHASE-M14.md](PHASE-M14.md) |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish** | Non (pas de packing touché — ship 0.1.60 déjà M12p) |

---

## Objectif

Fidu = **gold vision** : métier GED/CRM only + wiring mince ; migrations cœur =
`platformCoreMigrations()` kit ; zéro jumeau plateforme / stub fantôme.
**Paperclip = mort** (aucune surface).

---

## Allowlist Fidu (métier + wiring)

| Zone | Contenu autorisé |
|------|------------------|
| Modules métier | `dossiers`, `contacts`, `ged` (+ MCP/nav brand) |
| Seeds / vertical | hermes seeds, n8n-api-key, depot/GED hooks… |
| Host wiring | `host-runtime-ctx`, `host-stack` |
| Brand runtime | mounts dossiers/contacts/ged + stores kit |
| Composition | `main.ts` ≤ 800 LOC via `installBrandDesktopRuntime` |
| Migrations brand | `brand-migrations` métier cabinet (`i17_brand_*`) |

**Delete M15** : `electron/modules/core-migrations.ts` (`i17_core_*` local) → SoT kit.

---

## Travaux

| Fichier | Après |
|---------|-------|
| `brand-runtime.ts` | `platformCoreMigrations()` |
| `modules/core-migrations.ts` | **absent** |
| `modules/index.ts` | re-export alias déprécié → kit |

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-m15
cd /opt/docker/fidu/crm
npm run electron:compile \
  && npm run test:phase-h3 \
  && npm run test:database-module \
  && npm run test:fidu \
  && npm run build
```

Standing ship publish **seulement** si packing + verts — **non** ici.

---

## Done vision M15

| Critère | Preuve |
|---------|--------|
| Allowlist métier figée | ✅ |
| Core = kit `platformCoreMigrations` | ✅ |
| Paperclip absent | ✅ |
| Gates verts | ✅ |
| Suite | **M16** freeze vision |

---

## Push

| Repo | SHA |
|------|-----|
| kit `creezio/creezio` | *(ce commit)* |
| Fidu `fidu` | `2cc207e` (0.1.60, pas de republish) |

---

## Suite

Selon [PLAN-M.md](PLAN-M.md) : **M16** Freeze vision + matrice.
