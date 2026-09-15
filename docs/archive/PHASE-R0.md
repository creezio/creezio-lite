# Phase R0 — Geler les inventions (intention OS Creezio)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` |
| **Prérequis** | Audit écart intention OS Creezio (backlog R0→R10) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** |

---

## Intention verrouillée

- **OS Creezio = commun** (packages `@creezio/*` = SoT).
- **Apps marques = minimum métier** (TF / Certivan / Fidu).
- **Extraire** ce qui existe déjà dans TempoFlow — **ne pas inventer** de jumeaux.
- **Database admin + automations row-level = natif**, pas métier.
- `@creezio/automations` (V3) = **lifecycle-only** (plugins / org / factory / obs) —
  **≠** automations Database row-level.

---

## Amendement prototypes V1 / V2 / V3

| Prototype | Package | Statut après R0 |
|-----------|---------|-----------------|
| V1 Fabrique | `@creezio/product-hub` factory | **Prototype ≠ SoT produit** — utile demobrand/console ; évolutions = extraction réelle ou gel |
| V2 Observabilité | `@creezio/observability` | Idem — ne pas inventer un 2ᵉ moteur obs dans les marques |
| V3 Lifecycle automations | `@creezio/automations` | **Lifecycle-only** — **pas** le moteur Database TF |

Interdit : traiter V1–V3 comme preuve que « Database / fabrique / obs » sont déjà
extraits du vertical TF au sens intention.

---

## Interdiction nouvelles features plateforme dans les marques

À partir de R0, **aucune nouvelle capacité plateforme** (Database, Product Hub,
auth, tasks, mails, observabilité, automations row-level, control-plane, etc.)
ne doit être inventée ou enrichie **dans** TempoFlow / Certivan / Fidu.

Règle :

1. Si c’est **commun** → package `@creezio/*` (extraction ou extension kit).
2. Si c’est **métier marque** → reste dans le repo marque, hors kit.
3. Les marques **consomment** le kit (vendor sync) — elles ne deviennent pas SoT.

---

## Livrables R0

| # | Livrable | Statut |
|---|----------|--------|
| 1 | Ce fichier `PHASE-R0.md` | ✅ |
| 2 | Amendement [VISION-V1-V3.md](VISION-V1-V3.md) — prototypes ≠ SoT | ✅ |
| 3 | Amendement [MATRICE-NATIVE-METIER-PLUGIN.md](MATRICE-NATIVE-METIER-PLUGIN.md) | ✅ |
| 4 | `@creezio/automations` renommé / documenté **lifecycle-only** | ✅ |
| 5 | Push kit | ✅ |

---

## Suite

**R1** — Extraire Database TF → `@creezio/database` (port réel + cutover TF).
Voir [PHASE-R1.md](PHASE-R1.md).

---

## Verdict

**Phase R0 : TERMINÉE.** Inventions gelées ; V1–V3 = prototypes ; automations
package = lifecycle-only.
