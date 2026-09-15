# Phase D2 — TempoFlow : unifier stores plateforme

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `tempoflow2` (+ doc kit) |
| **Prérequis** | [PHASE-D1.md](PHASE-D1.md), I13 |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** — regroupé D3 si packing |

---

## Objectif

Sortir du mode « kit = shadow only » : adaptateurs uniques documentés ;
surface produit bascule en **dual-write** (auth/assistant) ou **rétention
brand explicite** (tasks/mails — cutover kit = feature loss).

## Contrat par domaine

| Domaine | Produit | Kit | Statut D2 |
|---------|---------|-----|-----------|
| Auth | Hono cookie + `users` brand | Miroir `creezio_users` à chaque login | **unified** dual-write |
| Assistant | `assistant_chats.db` | Dual-write `creezio_assistant_*` (même id) | **unified** dual-write |
| Tasks | `/api/v1/tasks` brand | `platform-tasks` parity only | **brand-retained** |
| Mails | `/api/v1/email` inbox | `platform-mails` outbound only | **brand-retained** |

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `src/lib/platform-stores/*` (contrat + adapters) | ✅ |
| 2 | Login Hono → `mirrorBrandLoginToKit` | ✅ |
| 3 | `chat-db` dual-write dynamique | ✅ |
| 4 | `CREEZIO_CORE_DB_PATH` server-launcher | ✅ |
| 5 | `GET /api/v1/platform/contract` | ✅ |
| 6 | Dry-run `migrate:platform-stores:dry-run` | ✅ |
| 7 | Tests `test:phase-d2` + i13 / assistant-chat-scope / h3 | ✅ |

## Zéro perte

- Tasks kanban / AI runs / mails inbox **non** migrés vers kit
- Dual-write best-effort (jamais bloquant login/chat)
- Mounts `platform-*` conservés pour parity demobrand

## Suite correction

D2 = adapters + dual-write / brand-retained — **pas** cutover unique.  
Fermeture SoT kit (zéro dual-write runtime) : **[PHASE-C0.md](PHASE-C0.md) → C1**.

## Verdict

**Phase D2 : TERMINÉE** (socle adapters). Suite historique : **D3**.
