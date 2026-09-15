# packages/brand-spec — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs brand-spec` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/doctor.ts`](../src/doctor.ts) | `doctorBrandSpec` / `formatDoctorReport` — validation BrandSpec ; ignore helpers modules (`_lib`, `shared.ts`, `mcp-shared.ts`, `meili-shared.ts`, `index.ts`, `types.ts`) ; démo trop pauvre (`MODULE_DEMO_THIN`) = warn ; pin kit < 0.10.1 (ex. Winhub 0.9.2) : démo absente = warn ; contrat ops 0.10.6 : `MODULE_OP_MISSING` (apiMounts sans operations[] non vide) / `UNCATALOGUED` / `MCP_OVERLAP` fail-closed (pin < 0.10.6 = warn) ; `mcpTools` = `MODULE_MCP_TOOLS_DEPRECATED` (error, 0.10.8) ; `MODULE_ASSISTANT_SOURCES_MISSING` = warn (API sans `assistantSources` ni justification, F3.4) ; mounts kit/OS hors `modules/*.ts` non scannés ; délègue `MODULE_MEILI_TABLE_UNKNOWN` à `meili-table-coherence.ts`. |
| [`src/index.ts`](../src/index.ts) | Export public @creezio/brand-spec (types + load + doctor + init + onboarding-from-spec). |
| [`src/init.ts`](../src/init.ts) | `initBrandSpec` — scaffold d'un dossier brand-spec/ (brand.yaml, modules/, platform/). |
| [`src/load.ts`](../src/load.ts) | `loadBrandSpec` / `resolveBrandSpecDir` — parse YAML + défauts platform needs. |
| [`src/meili-table-coherence.ts`](../src/meili-table-coherence.ts) | Check T6 `MODULE_MEILI_TABLE_UNKNOWN` — ensemble `CREATE TABLE` cross-module (tous modules + `fromprd_brand_*` / `brand-migrations.ts`), parse `IF NOT EXISTS` + quotes ; échappatoire `tableProvisionedBy`. |
| [`src/onboarding-from-spec.ts`](../src/onboarding-from-spec.ts) | `resolveOnboardingDecl` / `toSetupWizardConfig` — fusion onboarding depuis brand.yaml + platform/onboarding.yaml. |
| [`src/types.ts`](../src/types.ts) | Types du contrat BrandSpec (identité + modules + platform needs) — SoT agent créateur, le runtime reste dans @creezio/*. |
