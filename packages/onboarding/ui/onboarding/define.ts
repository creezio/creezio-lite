import type { OnboardingStepDef, OnboardingWizardProps } from "./types";

/**
 * Helper DX type-safe : fige le tableau de steps injecté par la marque.
 * N’embarque aucun step métier — assemblage uniquement.
 */
export function defineOnboardingSteps<const T extends readonly OnboardingStepDef[]>(
  steps: T,
): T {
  return steps;
}

/**
 * Helper DX : assemble les props host (`steps` + `transport` + flags/theme/exit)
 * sans figer de parcours métier dans le kit.
 */
export function createOnboardingHostProps(
  props: OnboardingWizardProps,
): OnboardingWizardProps {
  return props;
}
