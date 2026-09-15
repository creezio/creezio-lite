# @creezio/onboarding

## Rôle

`@creezio/onboarding` fournit le socle kit du premier lancement et du parcours d'onboarding Creezio :

- moteur pur de navigation entre étapes (`computeInitialStep`, `clampStep`, `nextStepIndex`, `prevStepIndex`) ;
- `SetupWizard` desktop pour compte local, clé de récupération, tunnel et clé OpenAI ;
- `OnboardingWizard` React, `Stepper`, interstitiels et composants "micro" ;
- helpers type-safe pour que la marque injecte ses propres étapes (`defineOnboardingSteps`, `createOnboardingHostProps`) ;
- contenu hybride en DB + preferences (`src/content.ts`, ADR-module-natif-hybride) : mount `/api/v1/modules/onboarding/*`, migrations `onboarding_content` / `onboarding_preferences`, merge pur défauts marque / override DB, contributions `BrandModuleDef.onboarding` via `composeOnboardingFromModules` / `collectOnboardingContent()`.

Le package ne contient pas de parcours métier marque. Il assemble une expérience générique et laisse la marque fournir les contenus, le transport et les bindings desktop.

## Périmètre kit vs marque

### Ce que le kit FOURNIT

- Calcule l'étape initiale, les bornes et les transitions.
- Affiche le shell d'onboarding, les interstitiels, les aides visuelles et les composants de saisie.
- Expose `SetupWizard` pour le first-run desktop basé sur `@creezio/shell-ui`.
- Lit les bindings shell génériques (`getShellUiBrand`, `getShellDesktopApi`, `resolveDesktopHomePath`).
- Flag natif onboarding on/off (`features.onboarding`, brand-spec) — défaut post-setup = `/` (jamais de placeholder mort).

### Ce que la marque DOIT fournir

- Définit la liste des étapes métier (`OnboardingStepDef[]`) et leur rendu.
- Implémente `OnboardingTransport` (`persistStep`, `skip`, `complete`).
- Configure éventuellement la mascotte via `configureOnboardingUi`.
- Fournit les handlers desktop (`completeSetup`, `checkTunnelSlug`, `generateRecoveryKey`, etc.) via `@creezio/shell-ui`.
- Décide des routes de sortie (`resolveExitHref`, `afterCompleteHref`) et des textes/skins propres.
- Page métier `ui/app/onboarding/` si parcours produit (sinon le wrapper OS redirige vers `/`).

### Ce que le package ne doit JAMAIS contenir

- Étapes métier hardcodées (restaurant, CHR, vertical spécifique).
- Écran placeholder inutilisable sur `/onboarding`.

## Installation/build

Depuis la racine du repo :

```bash
npm run build -w @creezio/onboarding
npm run typecheck -w @creezio/onboarding
```

Exports :

- `@creezio/onboarding` : moteur et types non React.
- `@creezio/onboarding/ui` : composants React client.
- `@creezio/onboarding/ui/onboarding/onboarding.css` : CSS du parcours.

## Configuration détaillée

### `configureOnboardingUi`

Configuration globale UI optionnelle :

```ts
import { configureOnboardingUi } from "@creezio/onboarding/ui";

configureOnboardingUi({
  companionSrc: (pose) => `/brand/companion/${pose}.png`,
});
```

`companionSrc` reçoit une `CompanionPose` (`pointing`, `thumbs`, `waving`, `presenting`). Si elle est absente ou renvoie `undefined`, le kit n'affiche pas de mascotte.

### Steps injectés par la marque

```tsx
import {
  OnboardingWizard,
  defineOnboardingSteps,
} from "@creezio/onboarding/ui";

const steps = defineOnboardingSteps([
  {
    id: "profile",
    label: "Profil",
    interstitialTitle: "On prépare votre espace",
    render: ({ advance }) => (
      <button type="button" onClick={advance}>
        Continuer
      </button>
    ),
  },
]);

export function BrandOnboardingPage() {
  return (
    <OnboardingWizard
      steps={[...steps]}
      transport={{
        persistStep: async (stepIndex) => {
          await fetch("/api/onboarding/step", {
            method: "POST",
            body: JSON.stringify({ stepIndex }),
          });
        },
        skip: async () => fetch("/api/onboarding/skip", { method: "POST" }),
        complete: async () => fetch("/api/onboarding/complete", { method: "POST" }),
      }}
      flags={{ interstitials: true, allowSkip: true }}
      theme={{ accentColor: "#f0701d" }}
    />
  );
}
```

### `SetupWizardConfig`

`SetupWizard` accepte une configuration locale :

```tsx
import { SetupWizard } from "@creezio/onboarding/ui";

<SetupWizard
  config={{
    requireOpenaiKey: true,
    afterCompleteHref: "/onboarding", // défaut kit = "/" (jamais un placeholder mort)
    slugPlaceholder: "mon-espace",
    tunnelHelp: "Choisissez l'adresse publique de votre instance :",
    accentColor: "#f0701d",
    backgroundColor: "#14182f",
  }}
/>;
```

### Activer / désactiver l'onboarding produit

| Levier | Off (demo) | On (parcours métier) |
|--------|------------|----------------------|
| `AppManifest.features.onboarding` | `false` | absent ou `true` |
| `brand-spec` `platform.onboarding` / `onboarding.enabled` | `false` | `true` |
| `afterCompleteHref` | `/` | `/onboarding` |
| Page OS `/onboarding` | redirige vers `/` | page marque `ui/app/onboarding/` |

`creezio brand create` / `blankAppModel` : onboarding **off** par défaut
(`demo-app` est déprécié, exit 1). TempoFlow (étapes réelles) : inchangé.

### Contenu hybride en DB + preferences (ADR-module-natif-hybride)

Les textes d'étapes, interstitiels et poses mascotte sont éditables **sans
toucher au code** : la marque déclare ses défauts dans UN fichier explicite
(`server/src/electron/brand-onboarding-content.ts`), les overrides vivent en
`brand.db` et le mount sert toujours `merge(défauts, override)`.

```ts
// server/src/electron/brand-onboarding-content.ts (marque)
import type { OnboardingContent } from "@creezio/onboarding";
export const myBrandOnboardingContent: OnboardingContent = {
  steps: [{ id: "bienvenue", label: "Bienvenue" } /* … */],
  mascot: { poses: { pointing: "/brand/mascot-pointing.png" } },
};

// server/src/electron/brand-migrations.ts (marque)
composeMigrations(/* … */, ...onboardingContentMigrations());

// server/src/electron/brand-module-api.ts (marque)
api.registerModuleApi(
  "onboarding",
  createOnboardingContentMount({ defaults: myBrandOnboardingContent }),
);
```

Routes (`/api/v1/modules/onboarding/*`, dbLayer brand, JSON uniquement) :

- `GET content` → `{ ok, content, hasOverride }` (contenu mergé) ;
- `PUT content` (override partiel, même shape que `OnboardingContent`) →
  stocké en DB, réponse = contenu mergé ; `DELETE content` → retour défauts ;
- `GET preferences?user=<k>` → `{ ok, user, answers }` ;
- `PUT preferences` `{ user, answers }` → upsert une row par clé
  (`onboarding_preferences`, UNIQUE user_key+key).

`mergeOnboardingContent(defaults, override)` est pur et exporté : merge par
`id` d'étape (label/interstitiel/texts partiels), `mascot.poses` et `texts`
fusionnés clé par clé, étapes non listées conservées.

### Brand bindings

Le kit lit les bindings de marque par `@creezio/shell-ui` :

- `getShellUiBrand()` : `productName`, `publicHostSuffix` et identité visuelle shell ;
- `getShellDesktopApi()` : API desktop first-run (`getSetupStatus`, `generateRecoveryKey`, `checkTunnelSlug`, `completeSetup`, `setAssistantChrome`) ;
- `resolveDesktopHomePath()` : fallback de sortie après skip/complete.

### Env

Ce package ne lit pas directement `process.env`. Les valeurs runtime viennent du shell desktop, de la configuration passée aux composants ou des handlers marque.

## API publique avec exemples

### Moteur non React

```ts
import {
  computeInitialStep,
  nextStepIndex,
  prevStepIndex,
  shouldShowInterstitial,
} from "@creezio/onboarding";

const initial = computeInitialStep({
  stepCount: 4,
  persistedStep: 1,
  editMode: false,
});

const next = nextStepIndex(initial, 4);
const previous = prevStepIndex(next);
const showIntro = shouldShowInterstitial({
  targetIndex: next,
  interstitialsEnabled: true,
  hasTitle: true,
});
```

### Types UI principaux

```ts
import type {
  OnboardingStepDef,
  OnboardingStepContext,
  OnboardingTransport,
  OnboardingTheme,
  SetupWizardConfig,
} from "@creezio/onboarding/ui";
```

### Validation first-run

```ts
import {
  buildCompleteSetupPayload,
  validateAccountStep,
  validateOpenaiStep,
  validateRecoveryStep,
  validateSlugStep,
} from "@creezio/onboarding";

const accountError = validateAccountStep({
  username: "owner",
  password: "secret1",
  password2: "secret1",
});

const payload = buildCompleteSetupPayload({
  username: " owner ",
  password: "secret1",
  openaiKey: " sk-xxx ",
  slug: " Mon-Espace ",
  recoveryKey: "key",
  stayLoggedIn: true,
});
```

## Flux

1. La marque configure éventuellement `configureOnboardingUi`.
2. Elle construit ses `OnboardingStepDef[]` avec `defineOnboardingSteps`.
3. `OnboardingWizard` calcule l'étape courante, appelle `transport.persistStep` à chaque navigation et affiche un interstitiel si l'étape cible le demande.
4. Les steps appellent `advance`, `back`, `skip`, `complete` ou `goTo` via `OnboardingStepContext`.
5. `skip` et `complete` délèguent à `transport`, puis sortent vers `resolveExitHref` ou vers le home desktop.
6. En first-run desktop, `SetupWizard` pilote les APIs desktop shell jusqu'à `completeSetup`, puis redirige vers `afterCompleteHref`.

## Intégration marques

- Monter `SetupWizard` sur une route first-run desktop si l'application doit créer son owner/tunnel/OpenAI avant accès CRM.
- Monter `OnboardingWizard` sur une route post-setup pour les étapes métier.
- Ne pas coder de logique métier dans le package : les écrans de marque restent dans l'application hôte.
- Garder `transport` idempotent : `persistStep` peut être appelé plusieurs fois et ses erreurs sont ignorées côté UI.
- Utiliser `theme` pour les couleurs ponctuelles et `@creezio/shell-ui` pour l'identité produit globale.

## Dépendances

- Runtime : `@creezio/shell-ui`.
- Peer UI : `react`, `lucide-react`.
- Build/typecheck : TypeScript.

## Voir aussi

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md)
