import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { BrandOnboardingDecl, BrandSpec } from "./types.js";

/**
 * Fusionne onboarding depuis brand.yaml + platform/onboarding.yaml.
 */
export function resolveOnboardingDecl(
  spec: BrandSpec,
): BrandOnboardingDecl | null {
  let fromPlatform: BrandOnboardingDecl | null = null;
  if (spec.platformDir) {
    for (const name of ["onboarding.yaml", "onboarding.yml"]) {
      const p = path.join(spec.platformDir, name);
      if (fs.existsSync(p)) {
        const raw = parseYaml(fs.readFileSync(p, "utf8")) as BrandOnboardingDecl;
        if (raw && typeof raw === "object") {
          fromPlatform = {
            enabled: raw.enabled !== false,
            stepLabels: raw.stepLabels,
            slugPlaceholder: raw.slugPlaceholder,
            tunnelHelp: raw.tunnelHelp,
            requireOpenaiKey: raw.requireOpenaiKey,
            afterCompleteHref: raw.afterCompleteHref,
            accentColor: raw.accentColor,
            backgroundColor: raw.backgroundColor,
          };
        }
        break;
      }
    }
  }

  const fromBrand = spec.brand.onboarding;
  if (!fromBrand && !fromPlatform) {
    if (spec.brand.platform?.onboarding === false) return null;
    return { enabled: true };
  }

  const merged: BrandOnboardingDecl = {
    enabled:
      fromBrand?.enabled !== false &&
      fromPlatform?.enabled !== false &&
      spec.brand.platform?.onboarding !== false,
    stepLabels: fromBrand?.stepLabels || fromPlatform?.stepLabels,
    slugPlaceholder:
      fromBrand?.slugPlaceholder || fromPlatform?.slugPlaceholder,
    tunnelHelp: fromBrand?.tunnelHelp || fromPlatform?.tunnelHelp,
    requireOpenaiKey:
      fromBrand?.requireOpenaiKey ?? fromPlatform?.requireOpenaiKey,
    afterCompleteHref:
      fromBrand?.afterCompleteHref || fromPlatform?.afterCompleteHref,
    accentColor: fromBrand?.accentColor || fromPlatform?.accentColor,
    backgroundColor:
      fromBrand?.backgroundColor || fromPlatform?.backgroundColor,
  };
  return merged;
}

/**
 * Convertit une déclaration BrandSpec → config compatible SetupWizard.
 * `enabled: false` → sortie home (`/`) ; sinon `afterCompleteHref` ou `/onboarding`.
 */
export function toSetupWizardConfig(decl: BrandOnboardingDecl): {
  stepLabels?: [string, string, string, string];
  slugPlaceholder?: string;
  tunnelHelp?: string;
  requireOpenaiKey?: boolean;
  afterCompleteHref?: string;
  accentColor?: string;
  backgroundColor?: string;
} {
  if (decl.enabled === false) {
    return { afterCompleteHref: "/" };
  }
  const out: ReturnType<typeof toSetupWizardConfig> = {};
  if (decl.stepLabels && decl.stepLabels.length >= 4) {
    out.stepLabels = [
      decl.stepLabels[0]!,
      decl.stepLabels[1]!,
      decl.stepLabels[2]!,
      decl.stepLabels[3]!,
    ];
  }
  if (decl.slugPlaceholder) out.slugPlaceholder = decl.slugPlaceholder;
  if (decl.tunnelHelp) out.tunnelHelp = decl.tunnelHelp;
  if (decl.requireOpenaiKey != null) out.requireOpenaiKey = decl.requireOpenaiKey;
  out.afterCompleteHref = decl.afterCompleteHref || "/onboarding";
  if (decl.accentColor) out.accentColor = decl.accentColor;
  if (decl.backgroundColor) out.backgroundColor = decl.backgroundColor;
  return out;
}
