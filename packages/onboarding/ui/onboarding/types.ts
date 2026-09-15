import type { ReactNode } from "react";

export type OnboardingStepId = string;

export type OnboardingStepContext = {
  stepIndex: number;
  entry: "start" | "end";
  saving: boolean;
  skipping: boolean;
  advance: () => void;
  goTo: (index: number) => void;
  back: () => void;
  skip: () => void;
  complete: () => void;
  setSaving: (v: boolean) => void;
  setError: (msg: string | null) => void;
};

export type OnboardingStepDef = {
  id: OnboardingStepId;
  label: string;
  /** Titre interstitiel (si flags.interstitials). */
  interstitialTitle?: string;
  interstitialTagline?: string;
  render: (ctx: OnboardingStepContext) => ReactNode;
};

export type OnboardingTransport = {
  persistStep: (stepIndex: number) => void | Promise<void>;
  skip: () => Promise<void>;
  complete: () => Promise<void>;
};

export type OnboardingWizardFlags = {
  interstitials?: boolean;
  allowSkip?: boolean;
  interstitialMs?: number;
};

export type OnboardingTheme = {
  accentColor?: string;
  inkColor?: string;
  tealColor?: string;
  creamBackground?: string;
};

export type OnboardingWizardProps = {
  steps: OnboardingStepDef[];
  transport: OnboardingTransport;
  initialStep?: number;
  editMode?: boolean;
  flags?: OnboardingWizardFlags;
  theme?: OnboardingTheme;
  resolveExitHref?: () => Promise<string> | string;
  onExit?: (href: string) => void;
  className?: string;
};

export type CompanionPose = "pointing" | "thumbs" | "waving" | "presenting";

/**
 * @deprecated Alias historique TF — utiliser `CompanionPose`.
 * Conservé pour compat types uniquement ; sera retiré dans une major.
 * Ne pas utiliser dans le code marque ni dans de nouveaux exports internes.
 */
export type TempoPose = CompanionPose;
