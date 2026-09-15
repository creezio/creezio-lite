# AGENTS.md — @creezio/database

## Mission

Maintenir l'Admin Database natif Creezio : catalogue, browse, CRUD fail-closed, vues, webhooks et automations row-level SQLite. Le package doit rester generique et brand-agnostic.

## Ne pas faire

- Ne pas mettre d'allowlist metier dans le kit.
- Ne pas rendre le CRUD permissif par defaut.
- Ne pas confondre avec `@creezio/automations` lifecycle-only.
- Ne pas exposer les tables systeme en ecriture.
- Ne pas retirer les protections SSRF webhook sans alternative explicite.
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs database` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Points d'entrée

- `src/index.ts` : contrat public.
- `src/whitelist.ts` : policy fail-closed.
- `src/schema.ts` : tables core `db_*`.
- `src/http/admin-routes.ts` : routes Hono.
- `src/crud.ts` : insert/update/delete controles.
- `src/views.ts` : vues sauvegardees.
- `src/automations-store.ts`, `src/triggers.ts`, `src/engine.ts` : automations row-level.
- `src/webhooks.ts` : validation, signature et livraison.
- `ui/index.ts` : exports UI React.

## Modifier sans casser

- Toute ecriture doit passer par `canCrudTable`.
- Toute automation doit respecter `canAutomateTable`.
- Garder `DEFAULT_FORBIDDEN_WRITE_TABLES` conservateur.
- Si le schema `DATABASE_CORE_SQL` change, penser migration/backfill dans les marques.
- Ne jamais interpoler un nom de table/colonne sans `isSafeIdentifier` et `quoteIdent`.
- Les routes admin doivent renvoyer des erreurs JSON stables, pas des exceptions brutes.

## Config brand

La marque configure :

- `configureDatabasePolicy({ crudAllowlist, forbiddenWriteTables })` ;
- `configureDatabaseEngine({ emitPluginEvent, n8nWebhookBaseUrl })` ;
- `configureDatabaseWebhookBrand(...)` ;
- `createAdminDatabaseRoutes({ getDb, getWriteDb, getActor })` ;
- ou (factory / kernel) laisser `app-runtime` appeler `registerRuntimeDatabaseStores`
  qui enregistre `core` + `brand` (+ plugins ouverts) — UI via `GET /database/dbs`
  et `?db=`.

La marque porte aussi l'auth owner/admin (TF legacy) ; le kernel factory monte
les routes automatiquement.

## Tests/gates

Avant validation :

```bash
npm run typecheck -w @creezio/database
npm run build -w @creezio/database
```

Scenarios a couvrir si comportement modifie :

- CRUD refuse sans allowlist ;
- tables interdites jamais modifiables ;
- triggers insert/update/delete ecrivent l'outbox ;
- webhooks bloquent loopback/prive hors env de test ;
- UI compile via `@creezio/database/ui`.

## Fichiers sensibles

- `src/whitelist.ts` : fail-closed.
- `src/schema.ts` : donnees persistantes.
- `src/crud.ts` : ecriture SQL.
- `src/webhooks.ts` : SSRF/signature/timeouts.
- `src/http/admin-routes.ts` : surface HTTP admin.
- `ui/database-client.tsx` et `ui/database-automations-panel.tsx` : UX admin.

## Liens

- `README.md`
- `docs/FILES.md`
- `packages/automations/README.md`
