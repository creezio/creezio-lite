# packages/core — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs core` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/api.ts`](../src/api.ts) | API D1/R2 des extensions métier, espaces et invitations. |
| [`src/http.ts`](../src/http.ts) | Lecture bornée des requêtes, origine et réponses HTTP. |
| [`src/index.ts`](../src/index.ts) | Entrée API native, identité Sites et composition du kernel. |
| [`src/types.ts`](../src/types.ts) | Types publics des extensions Sites. |
| [`src/validation.ts`](../src/validation.ts) | Validation des modules et des écritures, contrôle de rôle. |
