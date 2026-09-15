# ADR — Surface tools assistant = kit ∪ MCP ∪ tasks

| | |
|--|--|
| **Statut** | Accepté — implémenté (O4r + O4r2 + O4r3 + O4r4, 2026-07-30) |
| **Contexte** | Remédiation silo `brand-chat-tools` / `TOOL_DEFINITIONS` ×3, puis mini-registre `mcp-bridge`, puis handlers Hono `/mcp` parallèles |

## Décision

La surface d’outils de l’assistant est **uniquement** :

1. **Platform kit** — `@creezio/assistant` (`PLATFORM_TOOL_DEFINITIONS` : explore SQL, Meili, surface_*/ui_*/external_* (+ alias déprécié supplier_*), `get_entity`)
2. **Tasks kit** — `configureAssistantBrand({ tasks })` → `create_task` / `list_tasks` (+ aliases `create_todo` / `list_todos`)
3. **MCP registry marque** — **une** factory `modules/brand-mcp.ts` (`create*BrandMcp(api)` → `create*ModuleMcpTools`) consommée par :
   - Electron `brand-runtime` (façade locale / proxy Hono)
   - Assistant via `mcp-bridge.ts` = **adaptateur mince** (`mcpFacadeToAssistantConfig`)
   - **Hono `/mcp`** via `bindFacadeToolsToHono` (O4r3) — **même SoT**, pas de second registre métier
4. **Addendum marque optionnel** — system prompt / Meili / hermes / auth — **jamais** handlers panier/compta dans `lib/assistant/`
5. **Host-only Hono** — `open_external_tab`, tâches IA, (évent. writes CV) : besoin ctx Bearer / desktop — **hors** factory, **pas** de jumeau `module.*`

## Anti-patterns (NON done)

| Pattern | Verdict |
|---------|---------|
| `lib/assistant/brand-chat-tools.ts` avec `executeTool` métier | **Mort** |
| `BrandTools.executeTool` comme SoT | **Legacy mort** |
| `TOOL_DEFINITIONS` complets ×3 marques | **Mort** |
| `mcp-bridge.ts` qui re-liste N tools + handlers en dur | **Mort (O4r2)** — second SoT interdit |
| Handlers métier panier/catalogue/dossiers **dupliqués** dans Hono `server.ts` alors que la factory les expose | **Mort (O4r3)** — Hono = `bindFacadeToolsToHono(create*BrandMcp)` |
| `add_to_cart` brand parallèle à `module.panier.*` | **Mort** |
| `module.desktop.open_external_tab` jumeau de `external_open_tab` | **Interdit** — open tab = plateforme (`external_*` ; `supplier_*` = alias déprécié) |

## Différenciation marque

- **Data** + **tools exposés** (ACL / modules montés / discovery MCP)
- OK mince : system prompt, Meili indexes, hermes skills, auth
- Projections `entitySources` / `formatSearchHit` : moteur kit + règles déclaratives marque (**O4r4**) ; `argsPreview` reste TS marque (non bloquant)
- **Pas** de handlers panier / tasks / compta dans `lib/assistant/` hors adaptateurs `mcp-bridge` + `tasks-adapter`

## Dispatch runtime (`executeTool` kit)

```
surface/ui/supplier → explore/sql/meili/get_entity → tasks adapter → mcp.callTool → outil inconnu
```

`mcp.callTool` = même façade que Electron **et** Hono (`create*BrandMcp` → `create*ModuleMcpTools`).

## Références

- [PHASE-O4r.md](PHASE-O4r.md)
- [PHASE-O4r2.md](PHASE-O4r2.md)
- [PHASE-O4r3.md](PHASE-O4r3.md)
- [PHASE-O4r4.md](PHASE-O4r4.md)
- [PHASE-O4p.md](PHASE-O4p.md) (historique)
- Package `@creezio/mcp-facade`, `@creezio/tasks`
