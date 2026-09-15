# packages/observability — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs observability` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `fleet-collector/`

| Fichier | Rôle |
|---|---|
| [`fleet-collector/configure-fleet-npm.sh`](../fleet-collector/configure-fleet-npm.sh) | Provisionnement DNS + proxy host nginx-proxy-manager du collector (`FLEET_PUBLIC_DOMAIN`, secrets Cloudflare `CF_ENV`). |
| [`fleet-collector/env.mjs`](../fleet-collector/env.mjs) | Résolution env fleet-collector — defaults neutres `CREEZIO_*` / `FLEET_*` + dual-read legacy marques (`TF2_*`, `CERTIVAN_*`). Aucun domaine marque hardcodé : suffix tunnel / titres UI via injection. |
| [`fleet-collector/ops-api.mjs`](../fleet-collector/ops-api.mjs) | Agrégation flotte pour l’UI ops (slug → users → activité). Suffixe tunnel / hostnames : opts.tunnelSuffix (injection marque). |
| [`fleet-collector/server.mjs`](../fleet-collector/server.mjs) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`fleet-collector/test-fleet-collector.mjs`](../fleet-collector/test-fleet-collector.mjs) | Tests locaux du fleet-collector kit (spawn serveur éphémère). Env neutre CREEZIO_* — pas de domaine marque. |
| [`fleet-collector/test-server-admin.mjs`](../fleet-collector/test-server-admin.mjs) | Tests du backend flotte (routes admin, enroll, update async). |

## `scripts/`

| Fichier | Rôle |
|---|---|
| [`scripts/test-api-endpoints-registry.mjs`](../scripts/test-api-endpoints-registry.mjs) | (à documenter) |

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/api-mount.ts`](../src/api-mount.ts) | Mount API observabilité — /api/v1/platform/observability/... |
| [`src/helpers.ts`](../src/helpers.ts) | Helpers d'émission typés — activité / usages plugins / control-plane. |
| [`src/index.ts`](../src/index.ts) | @creezio/observability — activité / usages / CP (V2 SQLite) + boîte noire desktop ops/fleet (R4, extrait TempoFlow). |
| [`src/memory-store.ts`](../src/memory-store.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/schema.ts`](../src/schema.ts) | Schéma SQLite core — observabilité V2. export const OBSERVABILITY_CORE_SQL = ` CREATE TABLE IF NOT EXISTS creezio_obs_events ( id TEXT PRIMARY KEY, kind TEXT NOT NULL, action TEXT NOT NULL, org_id TEXT, user_id TEXT, brand_id TEXT, plugin_id TEXT, meta_json TEXT NOT NULL DEFAULT '{}', |
| [`src/sqlite-driver.ts`](../src/sqlite-driver.ts) | Driver SQLite minimal — dual-build CJS Electron (pas d'import.meta). |
| [`src/sqlite-store.ts`](../src/sqlite-store.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/types.ts`](../src/types.ts) | Contrats observabilité native (vision V2). |

## `src/api-endpoints/`

| Fichier | Rôle |
|---|---|
| [`src/api-endpoints/http-routes.ts`](../src/api-endpoints/http-routes.ts) | (à documenter) |
| [`src/api-endpoints/index.ts`](../src/api-endpoints/index.ts) | (à documenter) |
| [`src/api-endpoints/registry.ts`](../src/api-endpoints/registry.ts) | (à documenter) |

## `src/ops/`

| Fichier | Rôle |
|---|---|
| [`src/ops/emit.ts`](../src/ops/emit.ts) | Émission d'événements ops depuis un SOUS-PROCESS Node vanilla (meili-indexer, migrations…) : ligne `TF2EVENT {json}` sur stdout. Extrait de TempoFlow ops-emit.ts (R4). |
| [`src/ops/fleet-activity.ts`](../src/ops/fleet-activity.ts) | Journal d’événements produit flotte (ring mémoire). Schema FleetProductEvent v1 — attribution session + dwell. Extrait TempoFlow fleet-activity.ts (M7). |
| [`src/ops/fleet-agent.ts`](../src/ops/fleet-agent.ts) | Agent télémétrie flotte — heartbeat + sync opt-in. Extrait de TempoFlow fleet-agent.ts (R4) — endpoint / consent / IDs = hooks. Best-effort : jamais de throw vers le boot. |
| [`src/ops/fleet-samples.ts`](../src/ops/fleet-samples.ts) | Échantillons télémétrie flotte (best-effort, lecture seule, redactée). Pas de better-sqlite3 dans le process Electron (ABI) — spawn Node vanilla. Extrait TempoFlow fleet-samples.ts (M7) — chemins = hooks marque. |
| [`src/ops/journal.ts`](../src/ops/journal.ts) | Boîte noire desktop — journal d'événements structurés (JSONL / boot). Extrait de TempoFlow ops-journal.ts (R4). Hooks marque pour log + anomaly. Best-effort intégral : le journal ne doit JAMAIS être une source de crash. |
| [`src/ops/rules.ts`](../src/ops/rules.ts) | Boîte noire — moteur d'anomalies générique. Extrait de TempoFlow ops-rules.ts (R4). |
| [`src/ops/types.ts`](../src/ops/types.ts) | Boîte noire desktop — types + helpers PURS (aucun import Electron). Contrat JSONL ops (R4 / P29) — préfixe d'émission historique `TF2EVENT` conservé (wire sous-process Electron ×3). Lecture = dual-read via `OPS_EVENT_PREFIXES` ; `TF2EVENT` reste requis tant que des installations marque l'émettent. |

## `src/request-logs/`

| Fichier | Rôle |
|---|---|
| [`src/request-logs/config.ts`](../src/request-logs/config.ts) | Injection host pour request-logs (évite imports `@/` marque). O5 — gold TempoFlow générique. |
| [`src/request-logs/http-routes.ts`](../src/request-logs/http-routes.ts) | Admin — lecture / purge des logs API + MCP (session UI). Hono « nu » : hors doc OpenAPI publique. O5 — extrait TempoFlow (gold). Auth owner reste côté marque (montage). |
| [`src/request-logs/index.ts`](../src/request-logs/index.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/request-logs/middleware.ts`](../src/request-logs/middleware.ts) | Middlewares de collecte des logs API / MCP → ring buffer mémoire. Ne doit jamais faire échouer la requête (tout est try/catch). O5 — extrait TempoFlow (gold). |
| [`src/request-logs/request-logs.ts`](../src/request-logs/request-logs.ts) | Ring buffer en mémoire des appels API v1 + MCP (diagnostic desktop). Pas de persistance SQLite pour le MVP — process-local, max ~1000 entrées. O5 — extrait TempoFlow (gold), marque-agnostique. |

## `src/usage/`

| Fichier | Rôle |
|---|---|
| [`src/usage/adapters.ts`](../src/usage/adapters.ts) | Injection host pour usage-analytics (évite imports `@/` marque). |
| [`src/usage/http-routes.ts`](../src/usage/http-routes.ts) | Routes Hono usage analytics — ingest + admin (port TempoFlow — N6). Auth owner pour admin reste côté marque (montage). |
| [`src/usage/index.ts`](../src/usage/index.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/usage/ui-brand.ts`](../src/usage/ui-brand.ts) | Tokens UI / tracker usage (marque). |
| [`src/usage/usage-analytics-productivity.ts`](../src/usage/usage-analytics-productivity.ts) | Agrégations productivité : heatmap, heures actives, pauses, score. Basé sur les événements usage_events (heartbeats, clics, pages, idle…). |
| [`src/usage/usage-analytics-shared.ts`](../src/usage/usage-analytics-shared.ts) | Types / helpers partagés client + serveur (sans dépendance SQLite). export type UsageUserKind = "human" \| "ai" \| "system" \| "unknown"; export type UsagePeriod = "day" \| "week" \| "month" \| "year"; export function formatDuration(ms: number): string { if (!ms \|\| ms < 0) return "0s"; const s = Math.round(ms / 1000); if (s < 60) return `${s}s`; const m = Math.floor(s / 60); const rs = s % 60; if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`; |
| [`src/usage/usage-analytics.ts`](../src/usage/usage-analytics.ts) | Analytics d'usage — persistance SQLite + agrégations Admin. Événements UI (pages, clics, dwell) + actions serveur (agent IA…). |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/analytics-client.tsx`](../ui/analytics-client.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/analytics-productivity-panel.tsx`](../ui/analytics-productivity-panel.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/api-endpoints-client.tsx`](../ui/api-endpoints-client.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/index.ts`](../ui/index.ts) | Observability Admin UI (usage analytics N6 + request-logs / api-endpoints O5). Consommer via `@creezio/observability/ui`. |
| [`ui/request-logs-client.tsx`](../ui/request-logs-client.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/session-usage-analytics-provider.tsx`](../ui/session-usage-analytics-provider.tsx) | Bridge `useSession` (`@creezio/auth/ui`) → `UsageAnalyticsProvider`. Monté par BrandChrome factory. |
| [`ui/usage-analytics-client.ts`](../ui/usage-analytics-client.ts) | Tracker d'usage client — pages, dwell, clics, présence (heartbeat / idle / focus). Buffer + flush vers POST /api/v1/analytics/events. Miroir optionnel vers la télémétrie flotte Electron. Vie privée : on ne journalise PAS le contenu des frappes ni les mouvements souris, seulement des signaux d'activité agrégés (heartbeat / idle). |
| [`ui/usage-analytics-provider.tsx`](../ui/usage-analytics-provider.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `ui/primitives/`

| Fichier | Rôle |
|---|---|
| [`ui/primitives/badge.tsx`](../ui/primitives/badge.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/button.tsx`](../ui/primitives/button.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/card.tsx`](../ui/primitives/card.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/cn.ts`](../ui/primitives/cn.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/input.tsx`](../ui/primitives/input.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/primitives/tabs.tsx`](../ui/primitives/tabs.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
