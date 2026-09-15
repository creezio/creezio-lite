# Phase M16 — Freeze vision + matrice

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (+ preuves dry-run 3 marques) |
| **Prérequis** | [PHASE-M15.md](PHASE-M15.md) |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish** | Non |

---

## Objectif

Geler la **vision stricte M*** : matrice Native/Métier sans « stub OK » ;
allowlists gold TF/Certivan/Fidu ; sync vendor dry-run 3 marques verts.

---

## Freeze

| Artefact | Preuve |
|----------|--------|
| Matrice | [MATRICE-NATIVE-METIER-PLUGIN.md](MATRICE-NATIVE-METIER-PLUGIN.md) — M14/M15 gold, Paperclip mort |
| PLAN-M | [PLAN-M.md](PLAN-M.md) — M0→M16 documentés |
| Gates kit | `test-phase-m13` … `test-phase-m16` dans `npm test` |
| Dry-run sync | TF + Certivan + Fidu → `OK dry-run` (H6, liste complète packages) |

### SHAs marques (gold)

| Marque | SHA | Note |
|--------|-----|------|
| TempoFlow | `3565524` (M12p deps) + audit M13 | main ≤800 ; allowlist M13 |
| Certivan | `e51b369` | M14 `platformCoreMigrations` |
| Fidu | `2cc207e` | M15 gold ; ship **0.1.60** (M12p) ; pas de republish M15 |

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-m16
CREEZIO_SYNC_DRY_RUN=1 bash /opt/docker/tempoflow2/crm/scripts/electron/sync-creezio-vendor.sh
CREEZIO_SYNC_DRY_RUN=1 bash /opt/docker/certivan-app/crm/scripts/electron/sync-creezio-vendor.sh
CREEZIO_SYNC_DRY_RUN=1 bash /opt/docker/fidu/crm/scripts/electron/sync-creezio-vendor.sh
```

---

## Done vision M16

| Critère | Preuve |
|---------|--------|
| Matrice sans « stub OK » | ✅ |
| PLAN-M M13–M16 remplis | ✅ |
| Dry-run sync 3 marques | ✅ |
| Kit `npm test` | ✅ |
| Suite | **Plan M* fermé** |

---

## Push

| Repo | SHA |
|------|-----|
| kit `creezio/creezio` | *(ce commit)* |

---

## Suite

Plan **M0→M16** terminé. Hors scope volontaire inchangé (auto-promotion plugin,
univers perso, cloud registry). Wirings gras marque = dette polish, pas jumeaux.
