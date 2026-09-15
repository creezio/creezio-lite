# Phase N9 — Freeze vision 100 %

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (+ preuves dry-run 3 marques) |
| **Prérequis** | [PHASE-N8.md](PHASE-N8.md) · plan [PLAN-N.md](PLAN-N.md) |
| **Baseline N8 kit tip** | `1c689b6` |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish** | Non |

---

## Objectif

Geler la **vision stricte N*** à 100 % : matrice Native/Métier à jour ;
PLAN-N N0→N9 documentés ; SHAs gold ; dry-run sync vendor ×3 verts ;
`npm test` kit (incl. `test-phase-n9`).

**Paperclip = mort.**  
Stubs / jumeaux plateforme = **NON done**.

---

## Freeze

| Artefact | Preuve |
|----------|--------|
| Matrice | [MATRICE-NATIVE-METIER-PLUGIN.md](MATRICE-NATIVE-METIER-PLUGIN.md) — N9 gold |
| PLAN-N | [PLAN-N.md](PLAN-N.md) — N0→N9 ✅ |
| Gates kit | `test-phase-n0` … `test-phase-n9` dans `npm test` |
| Dry-run sync | TF + Certivan + Fidu → `OK dry-run` (H6, liste complète) |
| LOC / allowlists | [PHASE-N8.md](PHASE-N8.md) |

### SHAs marques (gold)

| Marque | SHA | Note |
|--------|-----|------|
| TempoFlow | `c85bb0f` | N6p admin → kit |
| Certivan | `51c7c22` | N6p + N7 browser-tabs façades |
| Fidu | `5e5367d` | N7 + ship **0.1.63** |

### Fidu publish

[Fidu-Setup-0.1.63.exe](https://fidu.creez.io/dl-e660352fb04dbd5e2519f0e60897c548/Fidu-Setup-0.1.63.exe)

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-n9
CREEZIO_SYNC_DRY_RUN=1 bash /opt/docker/tempoflow2/crm/scripts/electron/sync-creezio-vendor.sh
CREEZIO_SYNC_DRY_RUN=1 bash /opt/docker/certivan-app/crm/scripts/electron/sync-creezio-vendor.sh
CREEZIO_SYNC_DRY_RUN=1 bash /opt/docker/fidu/crm/scripts/electron/sync-creezio-vendor.sh
```

---

## Done vision N9

| Critère | Preuve |
|---------|--------|
| Matrice N9 | ✅ |
| PLAN-N N0→N9 | ✅ |
| Dry-run sync ×3 | ✅ |
| Kit `npm test` | ✅ |
| Suite | **Plan N* fermé** |

---

## SHAs

| Repo | SHA |
|------|-----|
| kit `creezio/creezio` | `49f1bd1` |

---

## Suite

Plan **N0→N9** terminé. Hors scope volontaire inchangé (auto-promotion plugin,
univers perso, cloud registry). Wirings gras marque = dette polish, pas jumeaux.
