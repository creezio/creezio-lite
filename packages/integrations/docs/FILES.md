# packages/integrations — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs integrations` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/index.ts`](../src/index.ts) | Barrel exports publics |
| [`src/n8n-sync.ts`](../src/n8n-sync.ts) | Push/update/remove credentials vers n8n embarqué (API publique) |
| [`src/providers.ts`](../src/providers.ts) | Catalogue providers (openai, notion, anthropic, custom) + mapping credentials n8n |
| [`src/reference.ts`](../src/reference.ts) | Références `integration://<slug>` (validation, slugify, parse) |
| [`src/schema.ts`](../src/schema.ts) | DDL `creezio_integrations` (core.db, `INTEGRATIONS_CORE_SQL`) |
| [`src/secret-box.ts`](../src/secret-box.ts) | Scellement AES-256-GCM dérivé `AUTH_SECRET` + hint |
| [`src/store.ts`](../src/store.ts) | Store SQLite : CRUD, resolveBySlug, setN8nSync |

## `src/http/`

| Fichier | Rôle |
|---|---|
| [`src/http/routes.ts`](../src/http/routes.ts) | Routes Hono `/api/v1/platform/integrations` (ACL owner / session / clé service) |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/index.ts`](../ui/index.ts) | Barrel UI |
| [`ui/integrations-client.tsx`](../ui/integrations-client.tsx) | Page CRM (design system kit) |
