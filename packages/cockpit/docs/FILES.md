# packages/cockpit — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs cockpit` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/config.ts`](../src/config.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/index.ts`](../src/index.ts) | @creezio/cockpit — config + types (non-React). UI React : `@creezio/cockpit/ui`. |
| [`src/types.ts`](../src/types.ts) | Types partagés cockpit UI (contrats API /api/v1/cockpit). export type CockpitTabId = export type CockpitServiceHealth = { configured: boolean; |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/cockpit-client.tsx`](../ui/cockpit-client.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/index.ts`](../ui/index.ts) | @creezio/cockpit/ui — ServerCockpitShell + CockpitClient. |
| [`ui/server-cockpit-shell.tsx`](../ui/server-cockpit-shell.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `ui/hooks/`

| Fichier | Rôle |
|---|---|
| [`ui/hooks/use-cockpit-dashboard.ts`](../ui/hooks/use-cockpit-dashboard.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `ui/parts/`

| Fichier | Rôle |
|---|---|
| [`ui/parts/service-card.tsx`](../ui/parts/service-card.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/parts/status-dot.tsx`](../ui/parts/status-dot.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
