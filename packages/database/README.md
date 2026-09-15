# @creezio/database

## Rôle

`@creezio/database` fournit l'Admin Database natif Creezio : catalogue SQLite, browse, CRUD admin controle, vues sauvegardees, journal d'acces, export, UI React et automations **row-level**.

Le module est fail-closed par defaut : aucune table metier n'est modifiable tant qu'une marque n'appelle pas `configureDatabasePolicy({ crudAllowlist })`.

## Périmètre

Inclus :

- schema core `DATABASE_CORE_SQL` pour `db_automations`, `db_automation_events`, `db_automation_runs`, `db_saved_views`, `db_access_log` ;
- routes Hono Admin Database ;
- CRUD admin avec allowlist explicite ;
- vues sauvegardees ;
- webhooks signes, garde SSRF et retries ;
- automations row-level basees sur triggers SQLite outbox ;
- UI `@creezio/database/ui`.

Hors perimetre :

- lifecycle automations plugins/org/factory (`@creezio/automations`) ;
- decisions d'auth owner et RBAC fines, qui restent cote marque ;
- allowlists metier dans le kit.

## Installation/build

```bash
npm install
npm run build -w @creezio/database
npm run typecheck -w @creezio/database
```

Le package exporte `@creezio/database` et `@creezio/database/ui`.

## Configuration

Configuration minimale au boot marque :

```ts
import {
  DEFAULT_FORBIDDEN_WRITE_TABLES,
  configureDatabaseEngine,
  configureDatabasePolicy,
  configureDatabaseWebhookBrand,
} from "@creezio/database";

configureDatabasePolicy({
  crudAllowlist: ["customers", "orders"],
  forbiddenWriteTables: DEFAULT_FORBIDDEN_WRITE_TABLES,
});

configureDatabaseEngine({
  emitPluginEvent: (event, payload) => pluginBus.emit(event, payload),
  n8nWebhookBaseUrl: "http://127.0.0.1:5678/webhook",
});

configureDatabaseWebhookBrand({
  userAgent: "MyBrand-Database-Automation/1.0",
  signatureHeader: "X-MyBrand-Signature",
  sourceHeader: "X-MyBrand-Source",
  sourceHeaderValue: "database-automation",
});
```

Les env supportes par les webhooks :

- `N8N_WEBHOOK_BASE_URL` comme base d'action `n8n_webhook` ;
- `CREEZIO_WEBHOOK_ALLOW_PRIVATE` / `TF2_WEBHOOK_ALLOW_PRIVATE` pour autoriser des reseaux prives ;
- `CREEZIO_WEBHOOK_ALLOW_LOOPBACK` / `TF2_WEBHOOK_ALLOW_LOOPBACK` pour les tests loopback.

## API publique + exemples

Exports principaux :

- SQLite : `openNodeSqliteDatabase`, `SqliteDatabase`, `DATABASE_CORE_SQL` ;
- policy : `configureDatabasePolicy`, `canCrudTable`, `canAutomateTable`, `DEFAULT_FORBIDDEN_WRITE_TABLES` ;
- catalogue/query : `listCatalog`, `getTableMeta`, `browseTable`, `getRowByRowid` ;
- CRUD : `insertRow`, `updateRow`, `deleteRow` ;
- vues : `listSavedViews`, `createSavedView`, `updateSavedView`, `deleteSavedView` ;
- automations : `createAutomation`, `updateAutomation`, `deleteAutomation`, `syncAutomationTriggers`, `processPendingEvents`, `startAutomationWorker` ;
- webhooks : `assertWebhookUrl`, `signWebhookBody`, `deliverWebhook` ;
- HTTP : `createAdminDatabaseRoutes`.

Monter les routes admin :

```ts
import { createAdminDatabaseRoutes } from "@creezio/database";

const routes = createAdminDatabaseRoutes({
  getDb: () => readDb,
  getWriteDb: () => writeDb,
  getActor: (c) => String(c.get("userId") || "owner"),
  webhookTestSource: "mybrand-database",
});
```

Creer une automation row-level :

```ts
import { createAutomation, syncAutomationTriggers } from "@creezio/database";

createAutomation(db, {
  tableName: "customers",
  name: "Webhook nouveau client",
  triggerType: "row_added",
  actions: [{ type: "webhook", url: "https://example.test/hook" }],
});

syncAutomationTriggers(db, "customers");
```

Utiliser l'UI :

```tsx
import { DatabaseClient } from "@creezio/database/ui";

export function AdminDatabasePage() {
  return <DatabaseClient apiBase="/admin" />;
}
```

## Flux

### Browse/CRUD

1. La marque ouvre les DB read/write et configure la policy.
2. `GET /database/tables` liste le catalogue.
3. `GET /database/tables/:table` browse avec pagination, recherche, tri et filtres.
4. `POST/PATCH/DELETE /rows` appelle `insertRow`, `updateRow` ou `deleteRow`.
5. `assertWritable` refuse toute table hors allowlist ou interdite.
6. Les acces sont journalises dans `db_access_log`.

### Automations row-level

1. Une automation active est creee pour une table automatisable.
2. `syncAutomationTriggers` installe les triggers SQLite insert/update/delete.
3. Les triggers ecrivent dans `db_automation_events`.
4. `processPendingEvents` matche conditions, watch columns et actions.
5. Les runs vont dans `db_automation_runs`.
6. `processRetries` retente les webhooks jusqu'a `MAX_WEBHOOK_ATTEMPTS`.

## Intégration marques

La marque doit :

- definir `crudAllowlist` localement ;
- garder les tables sensibles dans `forbiddenWriteTables` ;
- monter les routes derriere une auth owner/admin ;
- brancher `emitPluginEvent` et `n8nWebhookBaseUrl` si necessaire ;
- configurer les headers webhook brandes ;
- ajouter `@creezio/database/ui` au transpile/Tailwind quand l'UI est consommée.

## Dépendances

- `@creezio/platform-core` pour le driver SQLite ;
- `hono` pour les routes Admin Database ;
- peer deps React/Radix/lucide/tailwind pour l'UI.

## Voir aussi

- `AGENTS.md`
- `docs/FILES.md`
- `packages/automations/README.md`
