/**
 * Bridge BrandSpec → SetupWizardConfig (sans dépendre de @creezio/brand-spec
 * au runtime UI — la marque / factory peut passer un objet déjà résolu).
 */
import type { SetupWizardConfig } from "./setup-types.js";

export type OnboardingSpecInput = {
  enabled?: boolean;
  stepLabels?: string[];
  slugPlaceholder?: string;
  tunnelHelp?: string;
  requireOpenaiKey?: boolean;
  afterCompleteHref?: string;
  accentColor?: string;
  backgroundColor?: string;
};

/** Home CRM — sortie post-setup quand l'onboarding produit est off. */
const HOME_AFTER_SETUP = "/";

/**
 * Convertit une déclaration onboarding (YAML brand-spec) en SetupWizardConfig.
 * `enabled: false` / input null → config qui sort sur home (jamais null mort).
 */
export function setupWizardConfigFromSpec(
  input: OnboardingSpecInput | null | undefined,
): SetupWizardConfig {
  if (!input || input.enabled === false) {
    return { afterCompleteHref: HOME_AFTER_SETUP };
  }
  const out: SetupWizardConfig = {};
  if (input.stepLabels && input.stepLabels.length >= 4) {
    out.stepLabels = [
      input.stepLabels[0]!,
      input.stepLabels[1]!,
      input.stepLabels[2]!,
      input.stepLabels[3]!,
    ];
  }
  if (input.slugPlaceholder) out.slugPlaceholder = input.slugPlaceholder;
  if (input.tunnelHelp) out.tunnelHelp = input.tunnelHelp;
  if (input.requireOpenaiKey != null) {
    out.requireOpenaiKey = input.requireOpenaiKey;
  }
  if (input.afterCompleteHref) out.afterCompleteHref = input.afterCompleteHref;
  else out.afterCompleteHref = "/onboarding";
  if (input.accentColor) out.accentColor = input.accentColor;
  if (input.backgroundColor) out.backgroundColor = input.backgroundColor;
  return out;
}
