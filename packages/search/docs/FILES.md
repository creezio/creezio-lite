# packages/search — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs search` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/brand-meili-boot.ts`](../src/brand-meili-boot.ts) | (à documenter) |
| [`src/index.ts`](../src/index.ts) | (à documenter) |
| [`src/meili-launcher.ts`](../src/meili-launcher.ts) | (à documenter) |

## `src/meili/`

| Fichier | Rôle |
|---|---|
| [`src/meili/browse.ts`](../src/meili/browse.ts) | (à documenter) |
| [`src/meili/coherence-db.ts`](../src/meili/coherence-db.ts) | (à documenter) |
| [`src/meili/coherence-query.ts`](../src/meili/coherence-query.ts) | (à documenter) |
| [`src/meili/coherence.ts`](../src/meili/coherence.ts) | (à documenter) |
| [`src/meili/feed.ts`](../src/meili/feed.ts) | Feed marque générique (`BrandMeiliFeed`, `BrandMeiliIndexSpec`) — `table` + échappatoire déclarative `tableProvisionedBy` (doctor `MODULE_MEILI_TABLE_UNKNOWN`, pas d'env de bypass). |
| [`src/meili/generic-indexer.ts`](../src/meili/generic-indexer.ts) | (à documenter) |
| [`src/meili/index-schema.ts`](../src/meili/index-schema.ts) | (à documenter) |
| [`src/meili/index.ts`](../src/meili/index.ts) | (à documenter) |
| [`src/meili/pagination-settings.ts`](../src/meili/pagination-settings.ts) | Plancher `pagination.maxTotalHits` (défaut Meili 1000 = cap silencieux browse). |
| [`src/meili/indexer.ts`](../src/meili/indexer.ts) | (à documenter) |
| [`src/meili/pagination-settings.ts`](../src/meili/pagination-settings.ts) | Plancher `pagination.maxTotalHits` (défaut Meili 1000 = cap silencieux browse). |
