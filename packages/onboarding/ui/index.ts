/**
 * @creezio/onboarding/ui — SetupWizard + moteur onboarding + micro.
 */

export { SetupWizard, DEFAULT_AFTER_SETUP_HREF } from "./setup/setup-wizard";
export type { SetupWizardConfig, CompleteSetupPayload } from "./setup/setup-types";
export {
  DEFAULT_SETUP_STEP_LABELS,
  DEFAULT_SLUG_PLACEHOLDER,
  DEFAULT_SETUP_ACCENT,
  DEFAULT_SETUP_BACKGROUND,
  SLUG_RE,
} from "./setup/setup-types";

export { OnboardingWizard } from "./onboarding/onboarding-wizard";
export { Stepper } from "./onboarding/onboarding-shell";
export {
  Interstitial,
  INTERSTITIAL_MS,
} from "./onboarding/interstitial";
export {
  useMicro,
  MicroScreen,
  MicroLabel,
  BigInput,
  BigOption,
  AUTO_ADVANCE_MS,
} from "./onboarding/micro";
export {
  configureOnboardingUi,
  getOnboardingUiConfig,
  resetOnboardingUiForTests,
} from "./onboarding/configure";
export type { OnboardingUiConfig } from "./onboarding/configure";

export {
  defineOnboardingSteps,
  createOnboardingHostProps,
} from "./onboarding/define";

export type {
  OnboardingStepId,
  OnboardingStepDef,
  OnboardingStepContext,
  OnboardingTransport,
  OnboardingWizardFlags,
  OnboardingTheme,
  OnboardingWizardProps,
  CompanionPose,
  /** @deprecated — préférer CompanionPose */
  TempoPose,
} from "./onboarding/types";
