# @creezio/automations

## Rôle

`@creezio/automations` est le moteur d'automations **lifecycle-only** du kit Creezio. Il reagit aux evenements de cycle de vie `plugin.*`, `org.*`, `factory.*` et `observability.*`.

Important : ce package n'est pas le moteur Admin Database row-level. Les automations declenchees par insert/update/delete SQLite vivent dans `@creezio/database`.

## Périmètre

Inclus :

- definition des triggers lifecycle (`plugin.installed`, `factory.materialized`, etc.) ;
- moteur en memoire avec persistance SQLite facultative ;
- execution d'actions `emit_observability`, `log`, `webhook`, `n8n_tag_hint` ;
- mount API `/api/v1/platform/automations/...` pour lister, creer, supprimer et dispatcher ;
- regles sandbox `defaultDemobrandAutomationRules()`.

Hors perimetre :

- CRUD Admin Database, triggers SQLite row-level, vues sauvegardees ;
- orchestration cloud, retry durable de webhooks, ACL metier marque ;
- ecriture directe dans les repos marques.

## Installation/build

```bash
npm install
npm run build -w @creezio/automations
npm run typecheck -w @creezio/automations
```

Le package publie `dist` et `dist-cjs`. L'entree ESM/CJS est `@creezio/automations`.

## Configuration

Le moteur accepte des adapters injectes au boot :

```ts
import {
  createAutomationEngine,
  createSqliteAutomationPersist,
} from "@creezio/automations";

const persist = createSqliteAutomationPersist({
  coreDbPath: "/path/to/core.db",
});

const engine = createAutomationEngine({
  persist,
  defaultWebhookUrl: process.env.N8N_AUTOMATION_WEBHOOK_URL,
  n8nTagPrefix: "mybrand-plugin:",
  emitObservability: (event) => observability.record(event),
  postWebhook: (url, body) => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((res) => ({ ok: res.ok, status: res.status })),
  log: (level, message, meta) => logger[level](message, meta),
});
```

Sans `persist`, les regles sont chargees vides et les runs restent en memoire. Avec `persist`, le schema `AUTOMATIONS_CORE_SQL` cree `creezio_automation_rules` et `creezio_automation_runs`.

## API publique + exemples

Exports principaux :

- types : `AutomationRule`, `AutomationTriggerEvent`, `AutomationAction`, `AutomationRunResult`, `AutomationEngineAdapters` ;
- constantes : `AUTOMATION_TRIGGER_TYPES`, `AUTOMATION_ACTION_TYPES`, `AUTOMATIONS_CORE_SQL` ;
- fonctions : `createAutomationEngine`, `defaultDemobrandAutomationRules`, `ruleMatches`, `createAutomationsApiMount`, `createSqliteAutomationPersist`.

Creer et dispatcher une regle :

```ts
import { createAutomationEngine } from "@creezio/automations";

const engine = createAutomationEngine({
  log: (level, message) => console[level](message),
});

engine.addRule({
  name: "Notifier installation plugin",
  enabled: true,
  trigger: "plugin.installed",
  filter: { dataLayer: "plugin" },
  actions: [
    { type: "log", message: "Plugin installe" },
    { type: "n8n_tag_hint" },
  ],
});

const results = await engine.dispatch({
  type: "plugin.installed",
  brandId: "demobrand",
  orgId: "org_1",
  pluginId: "crm-helper",
  dataLayer: "plugin",
});
```

Monter l'API :

```ts
import { createAutomationsApiMount } from "@creezio/automations";

apiKernel.mount("/api/v1/platform/automations", createAutomationsApiMount(engine));
```

Routes exposees par le mount :

- `GET rules` ou `GET ""` ;
- `POST rules` ;
- `DELETE rules/:id` ;
- `POST dispatch` ;
- `GET runs?limit=50`.

## Flux

1. Une marque cree le moteur et injecte les adapters.
2. Les regles sont chargees depuis la persistance optionnelle.
3. Un evenement lifecycle est dispatché.
4. `ruleMatches` filtre par trigger, `pluginId`, `orgId` et `dataLayer`.
5. Les actions s'executent sequentiellement.
6. Le run est conserve en memoire et, si configure, append dans SQLite.

Les actions webhook sans URL ou sans adapter `postWebhook` sont considerees comme sautees, pas comme fatales.

## Intégration marques

La marque fournit :

- un prefixe n8n (`n8nTagPrefix`) coherent avec Product Hub ;
- les bridges observability et webhook ;
- le chemin de DB core si la persistance est souhaitee ;
- le montage API via `@creezio/api-kernel`.

Ne pas importer de modules verticaux metier depuis ce package. Les informations marque doivent arriver par adapters.

## Dépendances

- `@creezio/api-kernel` pour `ApiMount` ;
- `@creezio/platform-core` pour l'ouverture SQLite Node ;
- `@creezio/product-hub` pour `pluginN8nTag` ;
- `@creezio/observability` comme surface d'integration attendue cote adapter.

## Voir aussi

- `AGENTS.md`
- `docs/FILES.md`
- `@creezio/database` pour les automations row-level Admin Database
