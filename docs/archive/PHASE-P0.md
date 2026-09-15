# Phase P0 — Gates intention + matrice honnête

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` |
| **Prérequis** | [ETAT-DES-LIEUX-INTENTION.md](ETAT-DES-LIEUX-INTENTION.md) · [PLAN-P.md](PLAN-P.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non (process) |

---

## Objectif

Remplacer le piège « package `@creezio/*` existe ⇒ ✅ » par des **gates qui
mesurent le cutover marques** (jumeaux absents / LOC / import kit). Matrice
sincère : ✅ seulement si cutover prouvé.

**Façades / stubs / jumeaux = NON done.** Paperclip = mort.  
**Règle ×3=NATIF** : [ETAT-DES-LIEUX-INTENTION.md](ETAT-DES-LIEUX-INTENTION.md) §0.

---

## Livrables

| Artefact | Rôle |
|----------|------|
| `scripts/lib/intention-twins.mjs` | Scanner sim TF↔CV + listes P1/P2 + allowlist métier |
| `scripts/test-phase-p0-intention.mjs` | Gate process : docs, matrice 🟡, scanner, anti-✅ cosmétique |
| Matrice §1 Shell CRM / Tasks / Mails / Fleet | 🟡 jusqu’à cutover P1/P2/P6/P7 |
| Sync vendor DEFAULT | liste complète (obs/automations/database inclus) |

---

## Ce que P0 **ne** fait pas

- N’éteint pas les jumeaux shell/tasks (→ **P1** / **P2**).
- Les gates `test-phase-p1-shell` / `test-phase-p2-tasks` durcissent l’absence.

P0 prouve que la **mesure** est honnête : si la matrice marquait Shell CRM ou
Tasks en ✅ alors que des jumeaux locaux existent, la gate **échoue**.

---

## Gates

```bash
cd /opt/docker/creezio
node --test scripts/test-phase-p0-intention.mjs
npm test   # inclut p0
```

### Gate `test-phase-p0-intention`

- PLAN-P + ETAT §0 ×3=NATIF + PHASE-P0
- Matrice : légende cutover ; Shell CRM + Tasks = 🟡 (pas ✅)
- Scanner trouve encore les jumeaux P1/P2 sur HEAD dette (preuve mesure)
- 0 Paperclip ; sync DEFAULT packages ≥ liste complète

---

## Done

| Critère | Preuve |
|---------|--------|
| Gate mesure cutover (pas package) | ✅ `intention-twins` + p0 |
| Matrice honnête | ✅ 🟡 Shell CRM / Tasks |
| Paperclip mort | ✅ |
| Sync liste complète | ✅ DEFAULT_PACKAGES |

---

*Vague suivante : [PLAN-P.md](PLAN-P.md) **P1** shell CRM cutover ×3.*
