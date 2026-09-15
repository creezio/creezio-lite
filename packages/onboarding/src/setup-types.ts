/** Config optionnelle SetupWizard — le reste vient de getShellUiBrand(). */
export type SetupWizardConfig = {
  /** Override labels étapes (défaut: Compte / Récupération / Tunnel / OpenAI). */
  stepLabels?: [string, string, string, string];
  /** Placeholder slug (défaut générique: "mon-espace"). */
  slugPlaceholder?: string;
  /** Phrase d'aide étape tunnel (avant le preview slug.host). */
  tunnelHelp?: string;
  /** Si false, étape 4 optionnelle / sautable (défaut true). */
  requireOpenaiKey?: boolean;
  /** Redirect post-success (défaut "/onboarding"). */
  afterCompleteHref?: string;
  /** Accent CSS (défaut #f0701d). */
  accentColor?: string;
  /** Fond (défaut #14182f). */
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

export function validateAccountStep(input: {
  username: string;
  password: string;
  password2: string;
}): string | null {
  if (input.username.trim().length < 2) {
    return "Choisissez un identifiant (min. 2 caractères).";
  }
  if (input.password.length < 6) {
    return "Mot de passe trop court (min. 6 caractères).";
  }
  if (input.password !== input.password2) {
    return "Les mots de passe ne correspondent pas.";
  }
  return null;
}

export function validateRecoveryStep(input: {
  recoveryKey: string;
  recoveryAck: boolean;
}): string | null {
  if (!input.recoveryKey) return "Clé de récupération manquante.";
  if (!input.recoveryAck) {
    return "Cochez la case pour confirmer que vous avez noté la clé.";
  }
  return null;
}

export function validateSlugStep(input: {
  slug: string;
  slugOk: boolean | null;
  slugReason: string | null;
}): string | null {
  const s = input.slug.trim().toLowerCase();
  if (!SLUG_RE.test(s)) return "Slug invalide.";
  if (input.slugOk === false) return input.slugReason || "Slug indisponible.";
  return null;
}

export function validateOpenaiStep(
  openaiKey: string,
  requireOpenaiKey: boolean,
): string | null {
  if (requireOpenaiKey && !openaiKey.trim()) {
    return "Collez votre clé OpenAI (sk-…).";
  }
  return null;
}

export function buildCompleteSetupPayload(input: {
  username: string;
  password: string;
  openaiKey: string;
  slug: string;
  recoveryKey: string;
  stayLoggedIn: boolean;
}): CompleteSetupPayload {
  return {
    username: input.username.trim(),
    password: input.password,
    openaiKey: input.openaiKey.trim(),
    slug: input.slug.trim().toLowerCase(),
    recoveryKey: input.recoveryKey,
    stayLoggedIn: input.stayLoggedIn,
  };
}
