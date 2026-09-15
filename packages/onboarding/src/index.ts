/**
 * @creezio/onboarding — setup first-run + moteur onboarding (Phase P).
 * UI React : `@creezio/onboarding/ui`.
 */

export const ONBOARDING_PACKAGE = "@creezio/onboarding" as const;

export const INTERSTITIAL_MS_DEFAULT = 2100;
export const AUTO_ADVANCE_MS_DEFAULT = 320;

export type {
  SetupWizardConfig,
  CompleteSetupPayload,
} from "./setup-types.js";
export {
  DEFAULT_SETUP_STEP_LABELS,
  DEFAULT_SLUG_PLACEHOLDER,
  DEFAULT_SETUP_ACCENT,
  DEFAULT_SETUP_BACKGROUND,
  SLUG_RE,
  validateAccountStep,
  validateRecoveryStep,
  validateSlugStep,
  validateOpenaiStep,
  buildCompleteSetupPayload,
} from "./setup-types.js";

export type {
  OnboardingStepId,
  ComputeInitialStepInput,
} from "./engine.js";
export {
  computeInitialStep,
  clampStep,
  nextStepIndex,
  prevStepIndex,
  shouldShowInterstitial,
} from "./engine.js";

export type { OnboardingSpecInput } from "./from-brand-spec.js";
export { setupWizardConfigFromSpec } from "./from-brand-spec.js";

export type {
  OnboardingStepContent,
  OnboardingMascot,
  OnboardingContent,
  OnboardingContentOverride,
  OnboardingContentMountOptions,
  BrandModuleOnboarding,
  BrandModuleOnboardingContribution,
} from "./content.js";
export {
  ONBOARDING_CONTENT_SCHEMA_SQL,
  onboardingContentMigrations,
  mergeOnboardingContent,
  composeOnboardingFromModules,
  createOnboardingContentMount,
} from "./content.js";
