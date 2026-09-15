# Phase N3 — Assistant marque → `@creezio/assistant`

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` |
| **Prérequis** | [PHASE-N2p.md](PHASE-N2p.md) · plan [PLAN-N.md](PLAN-N.md) |
| **Baseline N2p SHA** | `4f37a9e` |
| **Kit SHA** | `863406f` (+ fix `a358d5b`) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non |

---

## Objectif

Runtime + UI assistant **génériques** SoT dans `@creezio/assistant`
(store I2 déjà là). Marques = AppMap / Prompts / BrandTools métier seulement.
**Sans cutover marques** (→ N3p).

**Paperclip = mort** — aucun artefact introduit.  
**Exclu kit** : panier / dispatch / relevés / TOOL_DEFINITIONS métier TF.

---

## Inventaire (kit)

### Store (préexistant I2 / C1)

| Module | Rôle |
|--------|------|
| `types` / `schema` / `memory-store` / `sqlite-store` / `env-store` | Persistance conversations |

### Runtime porté (TF gold) — `src/runtime/`

| Module | Source TF | Notes |
|--------|-----------|-------|
| `agent-loop.ts` | idem | Boucle tool-calling |
| `anthropic-chat.ts` | idem | Fallback Anthropic |
| `chat-db.ts` | idem | API conversations (+ kit store) |
| `explore-tools.ts` / `run-sql.ts` / `sql-process-guard.ts` | idem | SQL via `AssistantDbAccess` |
| `hermes-client.ts` / `hermes-models.ts` / `hermes-kanban.ts` | idem | Skills/tenant injectables |
| `meili-rag.ts` | idem | Indexes via `AssistantMeiliConfig` |
| `modes.ts` / `models.ts` | idem | Briefs Work → brand prompts |
| `routing.ts` / `geo-hint.ts` / `active-surface.ts` | idem | |
| `surface-router.ts` / `ui-actions.ts` | idem | |
| `tool-trace.ts` / `whisper.ts` / `schema-catalog.ts` | idem | |

### Extension brand — `src/brand/`

| API | Rôle |
|-----|------|
| `configureAssistantBrand` | Identity + AppMap + Prompts + BrandTools + DB + Meili + Hermes |
| `AssistantBrandTools` | `getEntity` / `executeTool` / `collectSourcesFromSqlRows` |
| `AssistantAppMap` (`app-map-shim`) | `pageInfoFor` / `appMapPromptSection` — pages marque |
| `AssistantPrompts` (`prompts-shim`) | `buildSystemPrompt` / `getToolDefinitions` |

### UI — `ui/` (export `@creezio/assistant/ui`)

| Module | Source TF |
|--------|-----------|
| `assistant-widget.tsx` | idem (~2,1 kLOC) |
| `assistant-provider.tsx` / `assistant-root.tsx` | idem |
| `ui-driver.tsx` / `fake-cursor.ts` / voice / trace / steps | idem |
| `primitives/*` | shadcn peer (comme `@creezio/database/ui`) |

**Total `src/` + `ui/`** : ~11 kLOC (`wc -l`).

### Exclu (reste marque jusqu’à N3p / métier)

- Contenu `app-map.ts` / `prompts.ts` TF (panier, catalogue, TOOL_DEFINITIONS)
- `sql-tools.ts` / `sources.ts` schéma TF (→ BrandTools)
- `src/server/assistant-chat.ts` (orchestration + outils métier)
- Cutover delete jumeaux marques

---

## Pattern injection

```ts
import { configureAssistantBrand } from "@creezio/assistant";

configureAssistantBrand({
  identity: {
    productName: "TempoFlow",
    uiStorageKey: "tempoflow2-assistant-ui",
    modeStorageKey: "tempoflow2-assistant-preferred-mode",
    desktopApiGlobal: "tempoflowDesktop",
    globalStorePrefix: "__tf2",
  },
  appMap: { pages: APP_MAP },
  prompts: {
    baseSystemPrompt: BASE,
    toolDefinitions: TOOL_DEFINITIONS,
    buildHermesWorkSystemBrief,
  },
  tools: { getEntity, executeTool, collectSourcesFromSqlRows },
  db: { queryAll, queryOne, getDbPath, getDb, tableExists },
  meili: {
    indexes: ["tf2_marketplaces", "tf2_produits", "tf2_all"],
    primaryIndexes: ["tf2_marketplaces", "tf2_produits"],
    fallbackIndex: "tf2_all",
    mapHit,
    enrichHits,
  },
  hermes: {
    defaultSkills: ["tempoflow2-n8n", "tempoflow2-crm", "tempoflow2-plugins"],
    kanbanTenant: "tempoflow-crm",
  },
});
```

```tsx
import { AssistantWidget } from "@creezio/assistant/ui";
```

---

## Gates

```bash
cd /opt/docker/creezio
npm run build -w @creezio/assistant && node scripts/build-cjs.mjs
npm test   # incl. test-phase-n3
```

### Gate `test-phase-n3`

- Modules runtime + brand + UI listés
- `configureAssistantBrand` / exports publics
- LOC ≫ store-only (> 5 k)
- Pas de `tf2_*` indexes / `/panier` / `add_to_cart` TOOL_DEFINITIONS en dur
- Routing Meili vs SQL (porté)
- Paperclip mort
- PLAN-N N3 marqué livré

---

## Done

| Critère | Preuve |
|---------|--------|
| Runtime+UI dans kit | ~11 kLOC src+ui |
| Extension AppMap / Prompts / BrandTools | `brand/*` |
| Build assistant ESM+CJS | ✅ |
| `test-phase-n3` | ✅ |
| Republish | Non |

---

## Suite

**N3p** — Cutover assistant TF → Certivan → Fidu (imports kit, delete générique, ≤2000 LOC métier).
