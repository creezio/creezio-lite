# Phase I2 — Assistant sqlite core

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` — `@creezio/assistant` + demobrand |
| **Prérequis** | [PHASE-I1.md](PHASE-I1.md) |
| **ARCHITECTURE_VERSION** | inchangé (`H5`) |
| **Republish marques** | **Non** |

---

## Objectif

Persistance conversations/messages assistant dans **core.db** via
`createSqliteAssistantStore` + `ASSISTANT_CORE_SQL`.

## Décision chemin DB

| Chemin | Statut |
|--------|--------|
| `resolveCoreDbPath` / SqliteRuntime core | **Cible I2** (nouveaux stores) |
| `resolveAssistantDbPath` (`assistant_chats.db`) | **Legacy** — migration marques en I13 |

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `ASSISTANT_CORE_SQL` + `createSqliteAssistantStore` | ✅ |
| 2 | demobrand migration `i2_001_assistant` + sandbox.assistant | ✅ |
| 3 | README décision chemin | ✅ |
| 4 | Tests restart `test-phase-i2.mjs` | ✅ |
| 5 | Ce fichier | ✅ |

## Verdict

**Phase I2 : TERMINÉE.** Prêt pour **I3** (tasks/mails sqlite + provider).
