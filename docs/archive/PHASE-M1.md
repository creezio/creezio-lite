# Phase M1 — Database engine : cutover TF sans shims

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` + `tempoflow2` |
| **Prérequis** | [PHASE-M0.md](PHASE-M0.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** |

---

## Objectif

`@creezio/database` est le seul SoT moteur ; TempoFlow n’a **plus** de dossier
shim `crm/src/lib/database/*`. Imports directs uniquement + câblage marque
hors arbre shim.

---

## Travaux

1. Wiring marque déplacé : `src/lib/brand-database-host.ts` (policy + adapters).
2. `admin-database.ts` / `db.ts` / `test:database-module` → `@creezio/database`.
3. Suppression complète de `crm/src/lib/database/**`.
4. Vendor sync **liste complète** (jamais un seul package).

---

## Critères done vision

| Critère | Preuve |
|---------|--------|
| `test ! -d crm/src/lib/database` | ✅ |
| `rg "from ['\"].*lib/database" crm/src` → 0 | ✅ (hors commentaire M1) |
| Imports `@creezio/database` dans consumers | ✅ |
| Zéro stub / façade re-export Database | ✅ |

**Exclu M1** : UI Admin Database (→ **M2**) ; Certivan/Fidu (→ **M1p**).

---

## Gates

```bash
cd /opt/docker/creezio && npm test && npm run build -w @creezio/database
cd /opt/docker/tempoflow2/crm && bash scripts/electron/sync-creezio-vendor.sh
cd /opt/docker/tempoflow2/crm && npm run electron:compile && npm run test:database-module
```

| Gate | Résultat |
|------|----------|
| kit `npm test` (+ M1) | ✅ |
| `@creezio/database` build | ✅ |
| TF vendor sync complète | ✅ |
| TF `electron:compile` | ✅ |
| TF `test:database-module` | ✅ |

---

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | Cutover TF sans `src/lib/database/` | ✅ |
| 2 | `brand-database-host.ts` (wiring marque) | ✅ |
| 3 | Ce fichier + `test-phase-m1.mjs` | ✅ |
| 4 | Matrice Database 🟡→✅ moteur sans shims | ✅ |
| 5 | Push kit + TF | ✅ |

---

## Suite

**M1p** — Même cutover Certivan puis Fidu (séquentiel).

---

## Verdict

**Phase M1 : TERMINÉE.** Plus de shims Database dans TempoFlow ; SoT =
`@creezio/database` + un seul fichier de wiring marque.
