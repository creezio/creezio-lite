# Phase C1 — Cutover stores TempoFlow (SoT kit)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repos** | `tempoflow2` (+ packages kit assistant/tasks/mails) |
| **Prérequis** | [PHASE-C0.md](PHASE-C0.md), D2 adapters |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** — regroupé **C8** |

---

## Objectif

Fin du dual-write auth/assistant et de la rétention brand tasks/mails :
**une SoT kit** (`core.db`) + extensions verticales sans miroir parallèle.

## Contrat

| Domaine | `productBackend` | status | Notes |
|---------|------------------|--------|-------|
| Auth | `kit-core` | cutover | Credentials kit ; JWT cookie + ACL brand |
| Assistant | `kit-core` | cutover | Rich schema C1 ; migrate legacy one-shot |
| Tasks | `kit-core` | cutover | UUID partagé ; kanban/AI brand |
| Mails | `kit-core` | cutover | Index kit inbound+outbound ; PJ brand |

## Livrables kit

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `@creezio/assistant` model/mode/user_id/sources_json | ✅ |
| 2 | `@creezio/tasks` `upsertWithId` | ✅ |
| 3 | `@creezio/mails` inbound columns + `insertInbound` | ✅ |
| 4 | Ce fichier + matrice | ✅ |

## Livrables TempoFlow

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `platform-stores/*` cutover | ✅ |
| 2 | Auth login kit-first | ✅ |
| 3 | `chat-db` façade kit (plus dual-write) | ✅ |
| 4 | Tasks/mails bridge kit | ✅ |
| 5 | `test:phase-c1` | ✅ |
| 6 | Vendor sync packages | ✅ |

## Critères done

- [x] `mirrorBrandLoginToKit` / dual-write chat absents du runtime
- [x] Contrat JSON : 4× `kit-core` / `cutover`
- [x] Tests C1 verts
- [x] Pas de republish (C8)

## Suite

→ **C2** Certivan dualités · **C5** Fidu mounts (//) · **C3** fabrique V1.

## Verdict

**Phase C1 : TERMINÉE.**
