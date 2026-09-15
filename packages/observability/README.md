# @creezio/observability

## Rôle

`@creezio/observability` regroupe les briques d'observabilité Creezio :

- store d'événements activité / plugin usage / control-plane ;
- `ApiMount` `/platform/observability` ;
- ops journal desktop JSONL, règles de boot et émission d'événements ;
- agent flotte desktop opt-in, fleet activity et samples ;
- usage analytics UI/admin ;
- request logs API/MCP avec redaction ;
- UI admin analytics, request logs et endpoints ;
- `fleet-collector` autonome (`creezio-fleet-collector`).

Le package est marque-agnostique : endpoints, consentement, identité d'installation, chemins et labels UI sont injectés par la marque ou par env neutre.

## Périmètre kit vs marque

**Kit**

- Fournit les schémas/stores observability.
- Enregistre les événements et agrégations génériques.
- Écrit un journal ops local best-effort, avec redaction.
- Produit les heartbeats/crash/bundles de flotte via hooks.
- Capture les logs API/MCP dans un ring buffer mémoire et miroir JSONL.
- Stocke et agrège les événements usage analytics.
- Fournit routes Hono ingest/admin et UI React admin.
- Fournit un collector HTTP autonome pour la flotte.

**Marque**

- Configure les DB adapters (`configureUsageAnalytics`) et request logs (`configureRequestLogs`).
- Configure les tokens UI analytics (`configureUsageAnalyticsUiBrand`).
- Appelle `initOpsJournal`, `track*` et `createFleetAgent` depuis l'app desktop.
- Fournit consentement, install id, version, santé services, samples et commandes distantes.
- Monte les middlewares `requestLogApiMiddleware` / `requestLogMcpMiddleware`.
- Monte les routes analytics/admin avec auth owner.
- Déploie/configure le `fleet-collector` et ses secrets.

## Installation/build

```bash
npm run build -w @creezio/observability
npm run typecheck -w @creezio/observability
npm run test:fleet-collector -w @creezio/observability
```

Lancement collector :

```bash
npm run fleet-collector -w @creezio/observability
# ou
npx creezio-fleet-collector
```

Exports :

- `@creezio/observability` : stores, helpers, ops, fleet, usage, request logs.
- `@creezio/observability/ui` : UI admin et tracker client.
- `@creezio/observability/fleet-collector/*` : collector autonome.

## Configuration détaillée

### Store observability et `ApiMount`

```ts
import {
  createObservabilityApiMount,
  createSqliteObservabilityStore,
} from "@creezio/observability";

const store = createSqliteObservabilityStore({ db });
const mount = createObservabilityApiMount(store);
```

### Usage analytics

```ts
import {
  configureUsageAnalytics,
  configureUsageAnalyticsUiBrand,
} from "@creezio/observability";

configureUsageAnalytics({
  getWriteDb: () => db,
  getDb: () => db,
  tableExists: (name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name)),
});

configureUsageAnalyticsUiBrand({
  aidAttr: "data-brand-aid",
  titlebarNoDragClass: "brand-titlebar-no-drag",
  mirrorFleetAction: (payload) => recordFleetAction(payload),
});
```

`configureUsageAnalytics({ getWriteDb })` est requis avant les routes et queries usage.

### Request logs

```ts
import {
  configureRequestLogs,
  requestLogApiMiddleware,
  requestLogMcpMiddleware,
} from "@creezio/observability";

configureRequestLogs({
  getFleetStateDir: () => "/var/lib/brand/fleet-state",
});

api.use("/api/v1/*", requestLogApiMiddleware);
mcp.use("/mcp/*", requestLogMcpMiddleware);
```

Si `getFleetStateDir` est absent, le package lit :

- `CREEZIO_FLEET_STATE_DIR`
- sinon toute variable `${envPrefix}_FLEET_STATE_DIR` dérivée du manifest
  marque (posée par le host — aucun préfixe marque câblé dans le kit)

### Ops journal

```ts
import {
  initOpsJournal,
  setOpsJournalHooks,
  track,
  trackDecision,
} from "@creezio/observability";

setOpsJournalHooks({
  log: (scope, line) => logger.info(`[${scope}] ${line}`),
  onAnomaly: (evt) => reportAnomaly(evt),
});

initOpsJournal(userDataDir, appVersion);

track({ level: "info", kind: "boot.start", ctx: { appVersion } });
trackDecision("service.meili", "ok", { durationMs: 120 });
```

Le journal écrit dans `<userData>/ops`, garde une rétention bornée et ne doit jamais faire crasher l'app.

Préfixes d'événements ops (`src/ops/types.ts`) : le SoT d'émission reste
`TF2EVENT ` (préfixe historique conservé pour ne pas casser les collecteurs
déployés) ; la lecture est dual-read via `OPS_EVENT_PREFIXES` (`TF2EVENT `,
`CertivanEVENT `, …) — un parseur doit accepter tous les préfixes connus.

### Fleet agent

```ts
import { createFleetAgent } from "@creezio/observability";

const fleet = createFleetAgent({
  baseUrl: "https://fleet.example.com/i-token",
  getConfig: () => telemetryConfig,
  isScopeActive: (cfg, scope) => cfg.enabled && Boolean(cfg.scopes[scope]),
  getInstallId: () => installId,
  getAppVersion: () => appVersion,
  getTunnelInfo: () => ({ slug: "demo", hostname: "demo.example.com" }),
  log: (scope, line) => logger.info(`[${scope}] ${line}`),
});

fleet.startFleetAgent({
  appKind: "server",
  getHealth: async () => ({ next: "ok", hermes: "ok" }),
  getRequestLogsSample: async () => listRequestLogs({ limit: 20 }).logs,
  getHeartbeatExtras: async () => ({ dossierStats: { open: 12 } }),
});
```

### Fleet collector env

Le collector lit des env neutres, avec dual-read legacy :

- `CREEZIO_FLEET_PORT` / `FLEET_PORT`
- `CREEZIO_FLEET_INGEST_TOKEN` / `FLEET_INGEST_TOKEN`
- `CREEZIO_FLEET_OPS_USER`, `_PASS`, `_TOKEN`
- `CREEZIO_FLEET_DIR` / `FLEET_DIR`
- `FLEET_PUBLIC_DOMAIN` / `CREEZIO_FLEET_DOMAIN`
- `CREEZIO_FLEET_TUNNEL_SUFFIX`
- `CREEZIO_FLEET_UI_TITLE`, `_MARK`, `_HOME_TITLE`, `_REALM`
- `CREEZIO_FLEET_UI_EXTRAS_TITLE`
- `CREEZIO_FLEET_UI_ETAT_LABELS`

Voir [fleet-collector/README.md](./fleet-collector/README.md).

## API publique avec exemples

### Observability store / ApiMount

Endpoints de `createObservabilityApiMount(store)` :

- `GET /events`
- `POST /events`
- `GET /usage`
- `GET /orgs`
- `GET /summary`

```bash
curl "$API/platform/observability/events?kind=activity&limit=20"
curl -X POST "$API/platform/observability/events" \
  -H "Content-Type: application/json" \
  -d '{"kind":"activity","action":"page_view","userId":"u1","meta":{"path":"/dashboard"}}'
```

### Usage analytics routes

```ts
import {
  createUsageAnalyticsAdminRoutes,
  createUsageAnalyticsIngestRoutes,
} from "@creezio/observability";

api.route(
  "/usage",
  createUsageAnalyticsIngestRoutes({
    getSession: async (c) => c.get("session") ?? null,
    getUserKind: (userId) => getUser(userId)?.kind ?? "human",
  }),
);

admin.route("/", createUsageAnalyticsAdminRoutes());
```

Endpoints :

- `POST /usage/events`
- `GET /analytics/overview`
- `GET /analytics/timeline`
- `GET /analytics/pages`
- `GET /analytics/clicks`
- `GET /analytics/users`
- `GET /analytics/events`
- `GET /analytics/productivity`
- `DELETE /analytics/events`

### Request logs

```ts
import {
  createRequestLogsRoutes,
  listRequestLogs,
} from "@creezio/observability";

admin.route("/admin", createRequestLogsRoutes());

const recentErrors = listRequestLogs({
  source: "api",
  errorsOnly: true,
  limit: 50,
});
```

Routes :

- `GET /request-logs?limit=100&source=api|mcp|all&q=...&errorsOnly=1`
- `DELETE /request-logs`

### UI

```tsx
import {
  AnalyticsClient,
  RequestLogsClient,
  UsageAnalyticsProvider,
} from "@creezio/observability/ui";

export function AdminObservability() {
  return (
    <UsageAnalyticsProvider session={{ userId: "u1", username: "Owner" }}>
      <AnalyticsClient />
      <RequestLogsClient />
    </UsageAnalyticsProvider>
  );
}
```

## Flux

### Usage analytics

1. `UsageAnalyticsProvider` installe le tracker client.
2. Les clics et pages sont annotés via `aidAttr`.
3. Les événements sont batchés vers `POST /usage/events`.
4. `insertUsageEvents` écrit en SQLite.
5. Les routes admin agrègent overview, timeline, pages, clicks, users et productivité.
6. Optionnellement, `mirrorFleetAction` copie les actions vers le buffer flotte.

### Request logs

1. Les middlewares lisent requête/réponse de manière best-effort.
2. Les secrets sont redacted par nom de clé et patterns de valeur.
3. `pushRequestLog` ajoute au ring buffer mémoire.
4. Si un fleet state dir est configuré, un résumé JSONL est écrit pour l'agent flotte.
5. L'UI admin lit/purge via `createRequestLogsRoutes`.

### Ops journal et fleet

1. `initOpsJournal` crée un boot id et un fichier JSONL.
2. `track*` enregistre décisions, anomalies, crashes et événements externes.
3. `createFleetAgent` construit des heartbeats opt-in selon scopes.
4. L'agent poste `/heartbeat`, `/crash`, `/bundle` et poll `/commands`.
5. `fleet-collector` stocke les données et expose une UI ops.

## Intégration marques

- Configurer usage analytics avant les routes et avant l'UI tracker.
- Brancher request logs tôt dans la stack Hono, avant auth, mais redaction toujours active.
- Monter les routes admin derrière auth owner.
- Initialiser ops journal après logger et avant les services à diagnostiquer.
- Créer un `FleetAgent` uniquement si la télémétrie opt-in est disponible.
- Garder les extras métier opaques (`dossierStats`, etc.) dans `getHeartbeatExtras`.
- Déployer `fleet-collector` avec tokens forts et Basic/Bearer ops.

## Dépendances

- Runtime : `@creezio/api-kernel`, `@creezio/platform-core`, `hono`.
- UI peer : `react`, `next`, `lucide-react`, `recharts`, Radix UI, `clsx`, `tailwind-merge`, `class-variance-authority`.
- Node runtime pour ops/fleet collector : `fs`, `path`, `os`, HTTP.

## Voir aussi

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md)
- [fleet-collector/README.md](./fleet-collector/README.md)
