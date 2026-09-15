# Phase I0 — Gouvernance post-H5 & outillage transversal

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` (+ wrappers sync TF / Certivan / Fidu) |
| **Prérequis** | [PHASE-H5.md](PHASE-H5.md) sign-off |
| **ARCHITECTURE_VERSION** | baseline I0 = `H5` ; freeze ultérieur **I8 → `H6`** (dry-run actuel = H6) |
| **Republish marques** | **Non** — voir [REPUBLISH-POLICY.md](REPUBLISH-POLICY.md) |

---

## Objectif

Verrouiller le mode d’emploi post-sign-off H5 (gates, sync vendor standardisé,
console `ARCHITECTURE_VERSION`, matrice, politique republish) **avant** tout
code métier / persistance packages (I1+).

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | Ce fichier + [BACKLOG-I0.md](BACKLOG-I0.md) | ✅ |
| 2 | [gates/POST-H5.md](gates/POST-H5.md) | ✅ |
| 3 | [REPUBLISH-POLICY.md](REPUBLISH-POLICY.md) | ✅ |
| 4 | `scripts/sync-creezio-vendor.sh` (contrat canonique) | ✅ |
| 5 | Wrappers sync TF / Certivan / Fidu | ✅ |
| 6 | Console + API `architectureVersion` | ✅ |
| 7 | Matrice + PROPAGATION mapping H3–H5 | ✅ |
| 8 | Tests `scripts/test-phase-i0.mjs` | ✅ |

## Checklist

- [x] Doc gates post-H5 (kit / TF / Certivan / Fidu)
- [x] Sync vendor : même contrat (liste packages, rebuild CJS, assert version)
- [x] Console affiche `ARCHITECTURE_VERSION`
- [x] Matrice + PROPAGATION à jour (packages H3–H5 surfaces)
- [x] Politique « sync → tests → publish »
- [x] Dry-run sync TF documenté (sans forcer copie H5 conso)
- [x] 0 republish exe

## Dry-run sync TF (preuve)

```bash
CREEZIO_SYNC_DRY_RUN=1 bash /opt/docker/tempoflow2/crm/scripts/electron/sync-creezio-vendor.sh
```

**À la livraison I0** : attendu `ARCHITECTURE_VERSION=H5`, packages baseline H5,
`OK dry-run`.

**Post-I8 / actuel (D0)** : le même dry-run attend
`ARCHITECTURE_VERSION=H6`, packages baseline I3 (auth…mails), `OK dry-run`.
Voir [gates/POST-H5.md](gates/POST-H5.md). Ne pas documenter H5 comme
cible sync courante.

## Hors scope I0

- Stores sqlite auth/assistant/tasks/mails (I1–I3)
- Bascule control-plane / ACL marques (I4, I9+)
- Republish Client/Serveur
- Bump `ARCHITECTURE_VERSION` (réservé I8 → H6 éventuel)

## Verdict

**Phase I0 : TERMINÉE.**  
Gouvernance et outillage sync prêts — **prêt pour I1** (auth sqlite core).
