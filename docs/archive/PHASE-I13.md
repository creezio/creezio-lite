# Phase I13 — Conso auth / assistant / tasks / mails (TempoFlow)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `tempoflow2` (+ doc kit) |
| **Prérequis** | [PHASE-I12.md](PHASE-I12.md), contrats I1–I3 |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** — I14 |

---

## Objectif

Brancher les stores sqlite kit (`@creezio/auth`, `assistant`, `tasks`,
`mails`) sur le brand-runtime TempoFlow (core.db) + mounts API plateforme ;
sans remplacer les routes Hono métier historiques (zéro perte features).

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `brand-runtime` : `auth` / `assistant` / `tasks` / `mails` | ✅ |
| 2 | Mounts `platform-tasks` / `platform-mails` (+ file-sink) | ✅ |
| 3 | Tests `test:phase-i13` | ✅ |
| 4 | Ce fichier | ✅ |

## Note

Auth / tasks / mails **historiques** (brand `tempoflow2.db` / Hono) restent
la surface produit. Les stores kit = couche plateforme core pour conso
graduelle et parity demobrand.

## Verdict

**Phase I13 : TERMINÉE.** Suite : **I14** (feature-parity + republish TF).
