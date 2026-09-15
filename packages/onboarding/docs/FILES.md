# packages/onboarding — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs onboarding` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/content.ts`](../src/content.ts) | Contenu onboarding hybride (ADR-module-natif-hybride) : tables brand.db `onboarding_content` (override marque) + `onboarding_preferences` (réponses utilisateur), merge pur défauts/override, `composeOnboardingFromModules` (contributions `BrandModuleDef.onboarding`), mount `/api/v1/modules/onboarding/*`. La marque déclare ses défauts dans `server/src/electron/brand-onboarding-content.ts` ou via le registre de modules. |
| [`src/engine.ts`](../src/engine.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/from-brand-spec.ts`](../src/from-brand-spec.ts) | Bridge BrandSpec → `SetupWizardConfig` (sans dépendance runtime à @creezio/brand-spec côté UI). |
| [`src/index.ts`](../src/index.ts) | @creezio/onboarding — setup first-run + moteur onboarding (Phase P). UI React : `@creezio/onboarding/ui`. |
| [`src/setup-types.ts`](../src/setup-types.ts) | Config optionnelle SetupWizard — le reste vient de getShellUiBrand(). export type SetupWizardConfig = { Override labels étapes (défaut: Compte / Récupération / Tunnel / OpenAI). |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/index.ts`](../ui/index.ts) | @creezio/onboarding/ui — SetupWizard + moteur onboarding + micro. |

## `ui/onboarding/`

| Fichier | Rôle |
|---|---|
| [`ui/onboarding/configure.ts`](../ui/onboarding/configure.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/onboarding/define.ts`](../ui/onboarding/define.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/onboarding/interstitial.tsx`](../ui/onboarding/interstitial.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/onboarding/micro.tsx`](../ui/onboarding/micro.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/onboarding/onboarding-shell.tsx`](../ui/onboarding/onboarding-shell.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/onboarding/onboarding-wizard.tsx`](../ui/onboarding/onboarding-wizard.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`ui/onboarding/types.ts`](../ui/onboarding/types.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `ui/setup/`

| Fichier | Rôle |
|---|---|
| [`ui/setup/http-setup-api.ts`](../ui/setup/http-setup-api.ts) | (à documenter) |
| [`ui/setup/setup-types.ts`](../ui/setup/setup-types.ts) | Config optionnelle SetupWizard — le reste vient de getShellUiBrand(). export type SetupWizardConfig = { stepLabels?: [string, string, string, string]; slugPlaceholder?: string; tunnelHelp?: string; requireOpenaiKey?: boolean; afterCompleteHref?: string; accentColor?: string; backgroundColor?: string; }; export type CompleteSetupPayload = { |
| [`ui/setup/setup-wizard.tsx`](../ui/setup/setup-wizard.tsx) | _(pas de cartouche JSDoc en tête — voir le code)_ |
