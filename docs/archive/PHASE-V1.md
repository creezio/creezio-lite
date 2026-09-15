# Phase V1 — Fabrique plugins conversationnelle

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` (kit + demobrand + console) |
| **Prérequis** | D0–D6 terminés · H6 freeze |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** |

---

## Objectif

Livrer le flux E2E vision Notion : **intention (chat/PRD) → analyse →
scaffold plugin isolé → DB `plugin/<id>` → tools MCP space plugin →
itération**, en réutilisant Product Hub, `SqliteRuntime.openPlugin`,
mcp-facade et ACL L3 — preuve demobrand (+ surface console minimale).

## Flux

```text
intention (texte / chat)
    → impact (buildPluginImpactReport + evidence)
    → [clarification si vague]
    → brouillon PRD (sections obligatoires)
    → approve PRD
    → scaffold FS + write files
    → openPlugin + ACL L3 (adapter runtime)
    → tools MCP plugin.<id>.*
    → iterate (evolve) → re-materialize
```

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `@creezio/product-hub` — `createConversationalPluginFactory` + draft PRD / slug / FS adapters | ✅ |
| 2 | Demobrand — `pluginFactory` sandbox + mount API `plugin-factory` + tools MCP module | ✅ |
| 3 | Console — panel + `GET/POST /api/plugin-factory` (démo mémoire) | ✅ |
| 4 | Tests E2E `scripts/test-phase-v1.mjs` | ✅ |
| 5 | Ce fichier + README / CHANGELOG | ✅ |
| 6 | Push kit — **pas** de republish marques | ✅ |

## Surface API (demobrand)

| Méthode | Path | Rôle |
|---------|------|------|
| POST | `/api/v1/modules/plugin-factory/intention` | Soumettre intention |
| POST | `/api/v1/modules/plugin-factory/clarify` | Répondre clarifications |
| POST | `/api/v1/modules/plugin-factory/approve` | Valider PRD |
| POST | `/api/v1/modules/plugin-factory/materialize` | Scaffold + openPlugin (owner) |
| POST | `/api/v1/modules/plugin-factory/iterate` | Evolve plugin existant |
| GET | `/api/v1/modules/plugin-factory/sessions` | Lister sessions |

MCP module : `module.plugin-factory.submit` · `module.plugin-factory.sessions`.

## Preuves E2E

1. Intention longue → PRD → approve → materialize → DB `plugin/<id>.db` ouverte
2. ACL org-A voit tools MCP ; org-B masquée (`cross_org` / filter)
3. API KV plugin writable sous ACL
4. Itération `evolve` réécrit fichiers scaffold
5. Chemin clarification (intention courte / `forceClarification`)

## Hors scope (volontaire)

- Auto-promotion plugin → module marque
- Univers perso hors org
- Cloud registry
- Appels LLM réels (brouillon PRD déterministe kit ; marques peuvent remplacer)

## Critères DoD

- [x] Factory conversationnelle dans product-hub
- [x] Demobrand E2E verts (`test-phase-v1`)
- [x] Console minimale
- [x] `npm test` / build kit verts
- [x] Docs PHASE-V1
- [x] Push kit — 0 republish exe marques

## Suite

→ **V2** — Observabilité native plateforme (activité, usages plugins, control-plane).

## Verdict

**Phase V1 : TERMINÉE.**
