# Phase O5 — Admin request-logs / api-endpoints → `@creezio/observability`

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (extract only) |
| **Prérequis** | [PHASE-O4p.md](PHASE-O4p.md) · plan [PLAN-O.md](PLAN-O.md) |
| **Baseline O4p kit tip** | `e4af9a4` / tip `4274edc` |
| **Kit tip O5** | `d6d5b81` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non (cutover = O5p) |

---

## Objectif

Clients + middleware + routes admin **request-logs** / UI **api-endpoints**
génériques SoT dans `@creezio/observability` (+ `/ui`). Marques gardent les
jumeaux jusqu’à O5p. **Pas de cutover**.

**Façades / stubs = NON done.** Paperclip = mort.  
**Exclu kit** : agregateurs métier ; route inline `/admin/endpoints` (registre
Hono marque).

---

## Inventaire

### Porté (gold TF)

| Module | Rôle |
|--------|------|
| `src/request-logs/request-logs.ts` | Ring buffer · redact · list/clear · miroir jsonl flotte |
| `src/request-logs/middleware.ts` | `requestLogApiMiddleware` / `requestLogMcpMiddleware` |
| `src/request-logs/http-routes.ts` | `createRequestLogsRoutes()` GET/DELETE |
| `src/request-logs/config.ts` | `configureRequestLogs({ getFleetStateDir })` |
| `ui/request-logs-client.tsx` | `RequestLogsClient` |
| `ui/api-endpoints-client.tsx` | `ApiEndpointsClient` |

### Injection marque (O5p)

| Hook | Rôle |
|------|------|
| `configureRequestLogs({ getFleetStateDir })` | Optionnel — défaut multi-env `CREEZIO_/TF2_/CERTIVAN_/FIDU_FLEET_STATE_DIR` |
| Redact `*_live_` | Générique kit (plus de préfixe marque hardcodé) |

### Hors kit (reste marque → O5p)

- Jumeaux `lib/request-logs.ts`, `server/request-log-middleware.ts`,
  `server/routes/request-logs.ts`, clients admin × marques
- Pages AppShell `/admin/request-logs` · `/admin/api` (≤80 LOC après cutover)
- Handler registre `/admin/endpoints` (dépend du Hono app marque)

---

## Pattern injection (O5p)

```ts
import {
  configureRequestLogs,
  createRequestLogsRoutes,
  requestLogApiMiddleware,
  requestLogMcpMiddleware,
} from "@creezio/observability";
import { RequestLogsClient, ApiEndpointsClient } from "@creezio/observability/ui";

configureRequestLogs({
  getFleetStateDir: () => process.env.TF2_FLEET_STATE_DIR, // optionnel
});

api.use("*", requestLogApiMiddleware);
mcp.use("*", requestLogMcpMiddleware);
api.route("/admin", createRequestLogsRoutes());
```

---

## Gates

```bash
cd /opt/docker/creezio
npm run build -w @creezio/observability && node scripts/build-cjs.mjs
npm test   # incl. test-phase-o5
```

### Gate `test-phase-o5`

- Modules `src/request-logs/*` + UI clients + exports
- `configureRequestLogs` / `createRequestLogsRoutes` / middlewares
- Pas d’import `@/` · Paperclip mort · redact générique
- Jumeaux marques **encore présents** (anti-cutover prématuré)
- PLAN-O O5 marqué livré

---

## Done

| Critère | Preuve |
|---------|--------|
| Lib + middleware + routes dans kit | `src/request-logs/*` |
| UI clients dans `@creezio/observability/ui` | `RequestLogsClient` · `ApiEndpointsClient` |
| Build observability ESM+CJS | ✅ |
| `test-phase-o5` | ✅ |
| Cutover différé | O5p |
| Republish | Non |

---

## Suite

**O5p** — ✅ Cutover livré ([PHASE-O5p.md](PHASE-O5p.md)).
