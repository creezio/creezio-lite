# packages/landing — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs landing` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/index.ts`](../src/index.ts) | Types, kinds préfabriqués, `defaultLandingSeed`, `buildLandingSeedSql`, `landingMigrations`, `createLandingMount` (CRUD + upload base64), `resolveLandingMediaDir`, `createLandingMediaGET` (route Next binaire) |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/index.ts`](../ui/index.ts) | Surface React publique |
| [`ui/landing-admin-client.tsx`](../ui/landing-admin-client.tsx) | Client d'édition admin (sections, settings, médias) |
| [`ui/landing-public-page.tsx`](../ui/landing-public-page.tsx) | Rendu public (fetch `GET /api/v1/modules/landing/public`) |
| [`ui/prefabs.tsx`](../ui/prefabs.tsx) | Préfabriqués hero/features/pricing/cta/footer + `LANDING_PREFAB_COMPONENTS` |
| [`ui/types.ts`](../ui/types.ts) | Vues sections/settings + registry `LandingComponents` (surcharge par kind) |
