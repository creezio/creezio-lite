# Phase I3 — Tasks / mails sqlite (+ provider non-stub)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` + wrappers sync 3 marques |
| **Prérequis** | [PHASE-I1.md](PHASE-I1.md), [PHASE-I2.md](PHASE-I2.md) |
| **ARCHITECTURE_VERSION** | inchangé (`H5`) |
| **Republish marques** | **Non** |

---

## Objectif

Persister tasks/mails plateforme en core ; fournir un provider mails **non-stub**
injectable (`file-sink`) ; élargir la liste vendor sync (prépare I9).

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `createSqliteTasksStore` | ✅ |
| 2 | `createSqliteMailsStore` + `createFileSinkMailProvider` | ✅ |
| 3 | demobrand mounts + migrations i3_* | ✅ |
| 4 | Vendor list + assistant/tasks/mails (kit + TF/Certivan/Fidu wrappers) | ✅ |
| 5 | Tests `test-phase-i3.mjs` | ✅ |
| 6 | Ce fichier | ✅ |

## Gel contrats (gate)

API stores auth / assistant / tasks / mails sqlite figées pour conso marques (I13+).

## Verdict

**Phase I3 : TERMINÉE.** Prêt pour **I4** (control-plane runtime unifié).
