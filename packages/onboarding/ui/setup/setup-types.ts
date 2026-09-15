/** Config optionnelle SetupWizard — le reste vient de getShellUiBrand(). */
export type SetupWizardConfig = {
  stepLabels?: [string, string, string, string];
  slugPlaceholder?: string;
  tunnelHelp?: string;
  requireOpenaiKey?: boolean;
  afterCompleteHref?: string;
  accentColor?: string;
  backgroundColor?: string;
};

export type CompleteSetupPayload = {
  username: string;
  password: string;
  openaiKey: string;
  slug: string;
  recoveryKey: string;
  stayLoggedIn: boolean;
};

export const DEFAULT_SETUP_STEP_LABELS = [
  "Compte",
  "Récupération",
  "Tunnel",
  "OpenAI",
] as const;

export const DEFAULT_SLUG_PLACEHOLDER = "mon-espace";
export const DEFAULT_SETUP_ACCENT = "#f0701d";
export const DEFAULT_SETUP_BACKGROUND = "#14182f";
export const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])$/;
