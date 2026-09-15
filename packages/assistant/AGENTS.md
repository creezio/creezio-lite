# AGENTS — @creezio/assistant

## Mission

Maintenir le runtime assistant générique : registry brand, stockage chat, modes Chat/Work, tools plateforme, MCP, Hermes, routes HTTP et UI. Le package doit rester le socle multi-marques, sans métier hardcodé.

## Ne pas faire

- Ne pas importer de code marque (`@/lib/*`, routes Next, stores CRM spécifiques).
- Ne pas réintroduire `BrandTools.executeTool` pour le métier : utiliser `configureAssistantBrand({ mcp })`.
- Ne pas exposer deux surfaces publiques pour le même tool MCP sans raison.
- Ne pas logger de secrets OpenAI/Hermes/API dans les traces ou tool results.
- Ne pas rendre `chat-db` dépendant uniquement du legacy `assistant_chats.db`; préserver le store kit.
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs assistant` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Points d'entrée

- `src/index.ts` : surface publique.
- `src/brand/registry.ts` : `configureAssistantBrand` et résolveurs.
- `src/brand/module-sources.ts` : descripteurs `BrandModuleAssistantSource` (entity / context / tool) + `applyModuleAssistantSources` — consommation réelle des sources collectées par `createBrandModuleRegistry`.
- `src/brand/types.ts` : contrat marque (`moduleSources` additif).
- `src/http/assistant-routes.ts` : routes Hono assistant.
- `src/runtime/assistant-chat.ts` : orchestration SSE, tools, Chat/Work.
- `src/runtime/chat-db.ts` : conversations/messages/profils agent.
- `src/runtime/modes.ts` : modes `chat` et `work`.
- `src/runtime/hermes-client.ts` : client Hermes.
- `src/runtime/mcp-tools.ts` : discovery/call MCP.
- `src/runtime/tasks-tools.ts` : adapter `create_task` / `list_tasks`.
- `ui/index.ts` : exports React.
- `ui/fake-cursor.ts` : id DOM `creezio-fake-cursor` (H13).

## Modifier sans casser

- Garder `AssistantBrandConfig` rétrocompatible sauf changement majeur coordonné.
- Tout nouveau tool métier doit passer par MCP discovery ou par un adapter kit clairement générique.
- Toute route ajoutée doit accepter une auth injectée ou rester explicitement publique.
- Les erreurs upstream LLM doivent être mappées sans révéler de secrets.
- Préserver les événements SSE utilisés par l'UI (`thinking`, `tool_start`, `tool_result`, `token`, `done`).
- Ne pas bloquer le mode Chat si Hermes est absent ; seul Work doit dépendre de Hermes.
- Conserver les aliases tasks (`create_todo`, `list_todos`) tant que les marques en dépendent.

## Config brand

Configuration minimale :

```ts
configureAssistantBrand({
  identity,
  auth: { getSession },
});
```

Configuration complète fréquente :

- `appMap.pages` pour le prompt de navigation ;
- `prompts` pour base system, addendum Chat, briefs Work ;
- `moduleSources` pour les descripteurs collectés depuis `BrandModuleDef.assistantSources` ;
- `mcp` pour tools métier ;
- `tasks` pour `create_task` / `list_tasks` ;
- `db` pour SQL/explore ;
- `meili` pour RAG ;
- `hermes` pour Work et kanban Hermes ;
- `desktopPresence` pour erreurs offline ;
- `trackServerDebounced` pour ops.

Env sensibles :

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `HERMES_API_URL` / `HERMES_GATEWAY_URL`
- `HERMES_API_SERVER_KEY` / `API_SERVER_KEY`
- `HERMES_MODEL`
- `CREEZIO_CORE_DB_PATH` / `DB_PATH`

## Tests/gates

```bash
npm run typecheck -w @creezio/assistant
npm run build -w @creezio/assistant
```

Selon la zone modifiée, vérifier aussi dans une marque hôte :

- `POST /api/v1/assistant/chat` stream bien en SSE ;
- conversations list/get/delete respectent les ACL ;
- tools MCP sont listés puis exécutés ;
- mode Work échoue clairement si Hermes est non configuré ;
- UI assistant ouvre/ferme le panneau et conserve le mode préféré.

## Fichiers sensibles

- `src/runtime/assistant-chat.ts` : orchestration principale et secrets LLM.
- `src/http/assistant-routes.ts` : auth, ACL conversation, streams desktop.
- `src/runtime/chat-db.ts` : migrations et compat store kit/legacy.
- `src/runtime/mcp-tools.ts` : frontière métier.
- `src/brand/types.ts` : contrat multi-marques.
- `src/runtime/run-sql.ts`, `schema-catalog.ts`, `sql-process-guard.ts` : accès DB.
- `ui/assistant-widget.tsx`, `ui/assistant-provider.tsx` : état client persistant.

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
