import type {BrandModuleOnboarding,OnboardingStepContent} from './module-contract.ts';
type OnboardingContent=BrandModuleOnboarding;
export type OnboardingContentOverride={steps?:Array<Partial<OnboardingStepContent>&{id:string}>;texts?:Record<string,string>;mascot?:BrandModuleOnboarding['mascot']};
/** Copied from Creezio onboarding/content; persistence is supplied by the Sites adapter. */
export function mergeOnboardingContent(
  defaults: OnboardingContent,
  override?: OnboardingContentOverride | null,
): OnboardingContent {
  if (!override || typeof override !== "object") {
    return {
      steps: defaults.steps.map((s) => ({ ...s })),
      ...(defaults.mascot ? { mascot: { ...defaults.mascot, poses: { ...defaults.mascot.poses } } } : {}),
      ...(defaults.texts ? { texts: { ...defaults.texts } } : {}),
    };
  }

  const overrideSteps = Array.isArray(override.steps) ? override.steps : [];
  const byId = new Map<string, Partial<OnboardingStepContent> & { id: string }>();
  for (const s of overrideSteps) {
    if (s && typeof s.id === "string" && s.id) byId.set(s.id, s);
  }

  const steps: OnboardingStepContent[] = defaults.steps.map((base) => {
    const o = byId.get(base.id);
    if (!o) return { ...base };
    byId.delete(base.id);
    return {
      ...base,
      ...(typeof o.label === "string" ? { label: o.label } : {}),
      ...(typeof o.interstitialTitle === "string"
        ? { interstitialTitle: o.interstitialTitle }
        : {}),
      ...(typeof o.interstitialTagline === "string"
        ? { interstitialTagline: o.interstitialTagline }
        : {}),
      ...(base.texts || o.texts
        ? { texts: { ...base.texts, ...o.texts } }
        : {}),
    };
  });
  // Étapes ajoutées par l'override (inconnues des défauts).
  for (const o of byId.values()) {
    if (typeof o.label === "string" && o.label) {
      steps.push({
        id: o.id,
        label: o.label,
        ...(typeof o.interstitialTitle === "string"
          ? { interstitialTitle: o.interstitialTitle }
          : {}),
        ...(typeof o.interstitialTagline === "string"
          ? { interstitialTagline: o.interstitialTagline }
          : {}),
        ...(o.texts ? { texts: { ...o.texts } } : {}),
      });
    }
  }

  const mascotPoses = {
    ...defaults.mascot?.poses,
    ...override.mascot?.poses,
  };
  const mascotBaseUrl = override.mascot?.baseUrl ?? defaults.mascot?.baseUrl;
  const hasMascot =
    Object.keys(mascotPoses).length > 0 || mascotBaseUrl !== undefined;

  const texts = { ...defaults.texts, ...override.texts };

  return {
    steps,
    ...(hasMascot
      ? {
          mascot: {
            poses: mascotPoses,
            ...(mascotBaseUrl !== undefined ? { baseUrl: mascotBaseUrl } : {}),
          },
        }
      : {}),
    ...(Object.keys(texts).length ? { texts } : {}),
  };
}

