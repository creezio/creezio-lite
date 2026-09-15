# AGENTS — @creezio/onboarding

## Mission

Maintenir le kit d'onboarding générique : moteur d'étapes, UI React, first-run desktop et helpers d'assemblage. Le package doit rester réutilisable par plusieurs marques.

## Ne pas faire

- Ne pas ajouter d'étapes métier marque dans le kit.
- Ne pas importer de chemins d'application (`@/lib/*`, routes Next marque, assets marque).
- Ne pas persister directement en base depuis les composants UI ; passer par `OnboardingTransport`.
- Ne pas faire dépendre le moteur `src/engine.ts` de React, du DOM ou de `process.env`.
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs onboarding` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Points d'entrée

- `src/index.ts` : exports moteur et validations first-run.
- `src/engine.ts` : calculs purs de navigation.
- `src/content.ts` : contenu hybride DB (`onboardingContentMigrations`, `mergeOnboardingContent`, `composeOnboardingFromModules`, `createOnboardingContentMount` → `/api/v1/modules/onboarding/*`, tables `onboarding_content` + `onboarding_preferences`). `BrandModuleOnboarding` = contribution d'un `BrandModuleDef` (F3.4). Imports type-only `@creezio/api-kernel` / `@creezio/platform-core` — ne pas y ajouter d'import runtime (cycle).
- `src/setup-types.ts` : config et validation `SetupWizard`.
- `ui/index.ts` : surface publique React.
- `ui/onboarding/onboarding-wizard.tsx` : orchestration du parcours injecté.
- `ui/onboarding/configure.ts` : config UI globale.
- `ui/onboarding/define.ts` : helpers d'injection de steps.
- `ui/setup/setup-wizard.tsx` : first-run desktop.

## Modifier sans casser

- Garder `OnboardingStepContext` stable : les steps marque en dépendent.
- Préserver le comportement des flags (`interstitials`, `allowSkip`, `interstitialMs`).
- Les erreurs de `persistStep` restent non bloquantes ; `skip`/`complete` affichent les erreurs.
- Tester les fonctions pures avant de modifier les composants.
- Vérifier les exports `@creezio/onboarding` et `@creezio/onboarding/ui` après ajout d'API.

## Config brand

- Contenu hybride (ADR-module-natif-hybride) : la marque déclare ses défauts dans `server/src/electron/brand-onboarding-content.ts` (UN fichier explicite) **ou** via `BrandModuleDef.onboarding` collecté par `collectOnboardingContent()` (`composeOnboardingFromModules`), compose `onboardingContentMigrations()` dans ses migrations brand et enregistre `createOnboardingContentMount({ defaults })` sous l'id `onboarding`. Les overrides (textes/mascotte) vivent en `brand.db` ; les réponses du parcours vont dans `onboarding_preferences` via `PUT preferences`.
- `configureOnboardingUi({ companionSrc })` pour les images compagnon.
- `OnboardingWizard` reçoit les steps, `transport`, `flags`, `theme`, `resolveExitHref`, `onExit`.
- `SetupWizard` lit l'identité et l'API desktop via `@creezio/shell-ui`.
- Pas d'env direct dans le package ; passer les valeurs par config ou bindings shell.

## Tests/gates

```bash
npm run typecheck -w @creezio/onboarding
npm run build -w @creezio/onboarding
```

Pour une modification UI, vérifier aussi dans une marque hôte que :

- le first-run appelle bien `completeSetup` ;
- `skip` et `complete` redirigent correctement ;
- les interstitiels ne bloquent pas les steps sans titre.

## Fichiers sensibles

- `ui/onboarding/types.ts` : contrat des steps marque.
- `ui/onboarding/onboarding-wizard.tsx` : gestion de navigation et erreurs.
- `ui/setup/setup-wizard.tsx` : secrets OpenAI, recovery key, tunnel slug.
- `src/setup-types.ts` : validations partagées.

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
