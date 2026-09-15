# Phase H0 — Cadre & décisions verrouillées (sign-off)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` → `/opt/docker/creezio` |
| **Scope** | Documentation de cadre uniquement (+ constante `ARCHITECTURE_VERSION`) |
| **Hors scope** | Code runtime métier ; modifications tempoflow2 / fidu / certivan-app |

---

## Objectif

Verrouiller l’intention d’architecture post Phases A→G et préparer le backlog
des packages natifs manquants (**H1**), sans rediscuter les décisions produit.

## Livrables

| # | Livrable | Fichier | Statut |
|---|----------|---------|--------|
| 1 | Intention claire (non-dev + technique) + schéma 3 couches + décisions | [ARCHITECTURE-INTENTION.md](ARCHITECTURE-INTENTION.md) | ✅ |
| 2 | Matrice Natif / Métier / Plugin + statuts ✅/🟡/❌ | [MATRICE-NATIVE-METIER-PLUGIN.md](MATRICE-NATIVE-METIER-PLUGIN.md) | ✅ |
| 3 | Backlog packages `@creezio/*` H1 (ordre, deps, done) | [BACKLOG-H1-PACKAGES.md](BACKLOG-H1-PACKAGES.md) | ✅ |
| 4 | Sign-off H0 | ce fichier | ✅ |
| 5 | README kit lié aux docs | [../README.md](../README.md) | ✅ |
| 6 | Constante `ARCHITECTURE_VERSION = "H0"` | `@creezio/platform-core` | ✅ |

## Décisions utilisateur (verrouillées)

1. SQLite multi-fichiers `core` / `brand` / `plugin/<id>` ; promotion plugin→module marque = processus humain.
2. Modules métier dans le **repo marque** ; Creezio = base CMS stable.
3. Nav = nav Creezio + **slots** métier.
4. API + MCP : façade unique (proxy cœur + modules + plugins).
5. Plugins d’**organisation** + ACL ; pas d’univers perso isolé.
6. Multi-exe Client + Serveur par marque.
7. Serveur neuf jour 0 : SQLite core + métier ; plugins à l’install.

## Pré-requis

- Phases **A→G terminées** — [DOD-PHASE-A-G.md](DOD-PHASE-A-G.md).
- Gates G1 Certivan, G2 Fidu, G3 TempoFlow sign-off.

## Checklist sign-off

- [x] Docs H0 rédigées et cohérentes entre elles
- [x] README pointe vers Architecture / Matrice / Backlog H1 / Phase H0
- [x] Aucune modification runtime des repos marques
- [x] `ARCHITECTURE_VERSION` = `"H0"`
- [x] Commit + push `github.com/creezio/creezio`

## Verdict

**Phase H0 : TERMINÉE.**  
Cadre verrouillé — **prêt pour H1** (création packages natifs listés dans le backlog).

Prochaine étape : exécuter [BACKLOG-H1-PACKAGES.md](BACKLOG-H1-PACKAGES.md) en commençant par **H1.0** (sqlite layout) puis **H1.1** (`api-kernel`).
