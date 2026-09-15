# packages/assistant — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs assistant` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/env-store.ts`](../src/env-store.ts) | Assistant SoT via env `CREEZIO_CORE_DB_PATH` / `DB_PATH` — M8. |
| [`src/index.ts`](../src/index.ts) | @creezio/assistant — chat plateforme (store I2 + runtime/UI N3 + chat O4/O4r). Extension marque : configureAssistantBrand({ appMap, prompts, mcp, tasks, tools, auth, meili, … }). Métier = discovery MCP ; tasks = adapter ; pas de BrandTools.executeTool. |
| [`src/memory-store.ts`](../src/memory-store.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/schema.ts`](../src/schema.ts) | DDL assistant — tables dans sqlite **core** (Phase I2 + C1 rich fields). Décision figée : persistance cible = `resolveCoreDbPath` / SqliteRuntime core. `resolveAssistantDbPath` (`assistant_chats.db`) reste un chemin **historique** pour marques non migrées ; ne pas l’utiliser pour les nouveaux stores kit. Colonnes riches `model` / `mode` / `user_id` / `sources_json` (voir ensureAssistantRichColumns) — présentes sur toutes les installations. |
| [`src/sqlite-driver.ts`](../src/sqlite-driver.ts) | Driver SQLite minimal pour @creezio/assistant (Phase I2). |
| [`src/sqlite-store.ts`](../src/sqlite-store.ts) | Store assistant persisté dans sqlite **core** (Phase I2 + C1 rich). |
| [`src/types.ts`](../src/types.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `src/brand/`

| Fichier | Rôle |
|---|---|
| [`src/brand/app-map-shim.ts`](../src/brand/app-map-shim.ts) | AppMap générique — pages injectées via configureAssistantBrand({ appMap }). Aucune page panier/dispatch/catalogue TF en dur. |
| [`src/brand/db-shim.ts`](../src/brand/db-shim.ts) | Shim DB — délègue à configureAssistantBrand({ db }). |
| [`src/brand/desktop-presence-shim.ts`](../src/brand/desktop-presence-shim.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/brand/entity-projections.ts`](../src/brand/entity-projections.ts) | O4r4 — projections entitySources / formatSearchHit déclaratives. Extraite des switches marque (TF/CV/Fidu) : pas d’invention métier, seulement un moteur kit + règles déclarées par la marque. |
| [`src/brand/module-sources.ts`](../src/brand/module-sources.ts) | Descripteurs `BrandModuleAssistantSource` (entity / context / tool) + `applyModuleAssistantSources` — consommation des sources collectées par le registre de modules (F3.4). |
| [`src/brand/ops-track-shim.ts`](../src/brand/ops-track-shim.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/brand/prompts-shim.ts`](../src/brand/prompts-shim.ts) | Prompts génériques + injection marque (AssistantPrompts). TOOL_DEFINITIONS plateforme = SoT kit (platform-tool-definitions). Métier = discovery MCP ; pas de liste panier/tasks dupliquée en marque. |
| [`src/brand/registry.ts`](../src/brand/registry.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/brand/sources-shim.ts`](../src/brand/sources-shim.ts) | Sources CRM — délégué à AssistantBrandTools (pas de schéma panier/catalogue en kit). |
| [`src/brand/types.ts`](../src/brand/types.ts) | Points d’extension marque pour `@creezio/assistant` (Phase N3 / O4r). Marques = AppMap + Prompts addendum + projections (entitySources / Meili) + façade MCP (tools métier découverts) + adapter tasks. Kit = runtime + PLATFORM tools + handlers tasks/MCP. `BrandTools.executeTool` = legacy mort (O4r) — ne plus brancher de métier. |

## `src/http/`

| Fichier | Rôle |
|---|---|
| [`src/http/assistant-routes.ts`](../src/http/assistant-routes.ts) | Surface HTTP assistant (mount Hono). Port gold TempoFlow `crm/src/server/routes/assistant.ts` → kit (D-P16 / P5). Auth / desktop-presence / Product Hub / usage restent injectables marque. Prérequis : `configureAssistantBrand(...)` au boot host. |

## `src/runtime/`

| Fichier | Rôle |
|---|---|
| [`src/runtime/active-surface.ts`](../src/runtime/active-surface.ts) | Contrat `activeSurface` — source de vérité unique : « que regarde l'utilisateur ? » (CRM React vs onglet site externe). Wire `kind: "supplier"` = alias historique TF (ne pas étendre) ; labels = génériques. Module sans alias @/ / sans React — importable par les tests Node et le serveur assistant. |
| [`src/runtime/agent-loop.ts`](../src/runtime/agent-loop.ts) | Boucle agent LLM générique (OpenAI tool-calling, non-streaming). Utilisée par le runner des collaborateurs IA (`ai-task-agent.ts`). Contrairement au chat (assistant-chat.ts, SSE + streaming), cette boucle est synchrone côté serveur : messages → tool_calls → résultats → … jusqu'à un outil terminal (`finish_task`) ou un plafond (steps, durée, tokens). |
| [`src/runtime/anthropic-chat.ts`](../src/runtime/anthropic-chat.ts) | Client Anthropic Messages API + tool_use (fallback quand OpenAI est en quota). |
| [`src/runtime/assistant-chat.ts`](../src/runtime/assistant-chat.ts) | Orchestration chat assistant (SSE / tools / Work Hermes) — Phase O4 / O4r. SoT générique : surface/ui/supplier, explore SQL, Meili, boucles OpenAI/Anthropic. Métier = discovery MCP (`configureAssistantBrand({ mcp })`). Tasks = adapter kit (`configureAssistantBrand({ tasks })`). Projections = getEntity / entitySources / Meili (pas d’executeTool métier). BrandTools.executeTool = legacy mort (O4r). |
| [`src/runtime/chat-db.ts`](../src/runtime/chat-db.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/runtime/explore-tools.ts`](../src/runtime/explore-tools.ts) | Outils d'exploration schéma pour l'assistant agentique. Process générique : list_distinct_values / describe_table / find_columns avant tout filtre égalité sur colonne texte — jamais inventer un littéral. |
| [`src/runtime/geo-hint.ts`](../src/runtime/geo-hint.ts) | Villes FR fréquentes pour détection rapide dans une question utilisateur. const KNOWN_CITIES = [ "Paris", "Lyon", "Marseille", "Lille", "Bordeaux", "Toulouse", "Nantes", "Nice", "Strasbourg", "Montpellier", "Rennes", "Grenoble", "Tours", "Dijon", "Reims", "Le Havre", "Saint-Etienne", "Saint-Étienne", "Angers", "Villeurbanne", "Aix-en-Provence", "Clermont-Ferrand", "Saint-Priest", "Grigny", ]; const CITY_ALT = KNOWN_CITIES.map((c) => c.replace(/[.*+?^${}()\|[\]\\]/g, "\\$&")).join("\|"); Normalise une ville pour comparaison (casse, accents, espa |
| [`src/runtime/hermes-client.ts`](../src/runtime/hermes-client.ts) | Client Hermes Gateway (API OpenAI-compat sur le host). Work mode : délégation agentique — skills via configureAssistantBrand({ hermes }). |
| [`src/runtime/hermes-kanban.ts`](../src/runtime/hermes-kanban.ts) | Client Hermes Kanban (WebUI) — CRUD + board pour sync CRM. Tenant / skills via configureAssistantBrand({ hermes }). Auth : - Desktop embarqué (loopback) : pas de password → auth WebUI off → pas de cookie. - Si `HERMES_WEBUI_PASSWORD` est défini : login → cookie session (mémoire process). |
| [`src/runtime/hermes-models.ts`](../src/runtime/hermes-models.ts) | Modèles Hermes via WebUI (`/api/model/options` + `/api/model/set`). Pas de liste en dur — source = providers authentifiés Hermes. |
| [`src/runtime/mcp-tools.ts`](../src/runtime/mcp-tools.ts) | Bridge assistant ↔ façade MCP marque (O4r). Surface métier = listTools / callTool — pas BrandTools.executeTool. |
| [`src/runtime/meili-rag.ts`](../src/runtime/meili-rag.ts) | Recherche keyword Meilisearch (générique). Indexes + mapHit + enrichHits via configureAssistantBrand({ meili }). |
| [`src/runtime/models.ts`](../src/runtime/models.ts) | Modèles chat exposés dans le select UI (configurable via env). export type ModelTier = "reasoning" \| "standard" \| "fast"; export type ModelOption = { id: string; tier: ModelTier; Libellé UI, ex. "o4-mini · Reasoning" |
| [`src/runtime/modes.ts`](../src/runtime/modes.ts) | Modes assistant : Chat (guide) vs Work (délégation Hermes). Briefs métier → configureAssistantBrand({ prompts }). |
| [`src/runtime/openai-tool-payload.ts`](../src/runtime/openai-tool-payload.ts) | Payload tools Chat Completions OpenAI — `openaiSafeToolName`, plafond `OPENAI_CHAT_MAX_TOOLS` (128), `selectOpenAiToolDefinitions` (fusion multi-listes, dédup premier gagnant, troncature). |
| [`src/runtime/platform-tool-definitions.ts`](../src/runtime/platform-tool-definitions.ts) | Définitions d'outils plateforme (SoT kit) — explore / SQL / Meili / surface / UI / supplier. Métier (module.*) = discovery MCP. Tasks = PLATFORM_TASK_TOOL_DEFINITIONS + adapter tasks. Phase O4r — remplace la duplication ×3 dans prompts.ts marques. |
| [`src/runtime/routing.ts`](../src/runtime/routing.ts) | Routage premier outil assistant (Meili vs SQL vs UI / surface). Module sans alias @/ — importable par les tests Node. |
| [`src/runtime/run-sql.ts`](../src/runtime/run-sql.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/runtime/schema-catalog.ts`](../src/runtime/schema-catalog.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/runtime/sql-process-guard.ts`](../src/runtime/sql-process-guard.ts) | Garde-fou process générique pour run_sql : si un filtre égalité texte renvoie 0, injecter les DISTINCT réels (sans hardcoder de littéraux métier). |
| [`src/runtime/surface-router.ts`](../src/runtime/surface-router.ts) | Routage observation/action selon activeSurface. Pure (pas d'I/O) — testable hors Electron. |
| [`src/runtime/tasks-tools.ts`](../src/runtime/tasks-tools.ts) | Handlers create_task / list_tasks (O4r) — SoT kit + adapter marque. |
| [`src/runtime/tool-trace.ts`](../src/runtime/tool-trace.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/runtime/ui-actions.ts`](../src/runtime/ui-actions.ts) | Actions UI pilotées par l'assistant (souris virtuelle côté navigateur). Aller-retour : la boucle LLM émet un événement SSE `ui_action` → le navigateur (UiDriver) exécute l'action visuellement (faux curseur) → il POST le résultat sur /api/v1/assistant/ui-actions/:id/result → la promesse serveur se résout et le tool retourne le résultat au LLM. Extension desktop (Electron) : les actions `external_*` (alias déprécié `supplier_*`) ciblent les onglets sites externes. Canal SSE historique GET /api/v1/assistant/supplier-actions/stream (nom wire TF — inchangé). Le résultat revient par la même route RE |
| [`src/runtime/whisper.ts`](../src/runtime/whisper.ts) | Transcription audio → texte via OpenAI Whisper (ou modèle compatible). |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/assistant-message-content.tsx`](../ui/assistant-message-content.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/assistant-provider.tsx`](../ui/assistant-provider.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/assistant-root.tsx`](../ui/assistant-root.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/assistant-tool-steps.tsx`](../ui/assistant-tool-steps.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/assistant-trace-panel.tsx`](../ui/assistant-trace-panel.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/assistant-widget.tsx`](../ui/assistant-widget.tsx) | // @ts-nocheck — desktop API loosely typed; marques fournissent Window.*Desktop |
| [`ui/entity-links.ts`](../ui/entity-links.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/fake-cursor.ts`](../ui/fake-cursor.ts) | Souris virtuelle de l'assistant — curseur visuel animé qui se déplace jusqu'à la cible puis « clique » (halo). Singleton DOM hors React pour survivre aux navigations App Router. |
| [`ui/index.ts`](../ui/index.ts) | Assistant UI (port TempoFlow — N3). Consommer via `@creezio/assistant/ui`. |
| [`ui/tab-workspace-shim.ts`](../ui/tab-workspace-shim.ts) | Shim workspace onglets — marques aliasent ce module vers leur TabWorkspaceProvider. Défaut : pas de workspace (null). |
| [`ui/ui-driver.tsx`](../ui/ui-driver.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/use-voice-input.ts`](../ui/use-voice-input.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `ui/primitives/`

| Fichier | Rôle |
|---|---|
| [`ui/primitives/badge.tsx`](../ui/primitives/badge.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/button.tsx`](../ui/primitives/button.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/cn.ts`](../ui/primitives/cn.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/dropdown-menu.tsx`](../ui/primitives/dropdown-menu.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/input.tsx`](../ui/primitives/input.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/scroll-area.tsx`](../ui/primitives/scroll-area.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/select.tsx`](../ui/primitives/select.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
