/**
 * BrandSpec — contrat déclaratif marque (SoT agent créateur).
 * Le runtime OS reste dans @creezio/* ; ici = identité + modules + platform needs.
 */

export type BrandPlatformNeeds = {
  auth: boolean;
  desktop: boolean;
  pluginApi: boolean;
  chat: boolean;
  sync: boolean;
  meili: boolean;
  mcp: boolean;
  onboarding: boolean;
};

export type BrandMeiliIndexDecl = {
  uid: string;
  primaryKey?: string;
  sourceTable?: string;
  searchableAttributes?: string[];
  filterableAttributes?: string[];
};

export type BrandMeiliDecl = {
  enabled: boolean;
  /**
   * `none` (pas de feed), `custom` (indexes[] déclarés ci-dessous), ou l'id
   * d'un preset du REGISTRE FACTORY (`@creezio/factory` meili-feed-presets) —
   * le contrat OS n'énumère aucun preset vertical. Valeur legacy
   * `<vertical>-catalog` acceptée une version (normalisée par la factory).
   */
  feedPreset?: string;
  indexes?: BrandMeiliIndexDecl[];
};

export type BrandMcpDecl = {
  enabled: boolean;
  allowUnauthenticated?: boolean;
  spaces?: string[];
};

export type BrandOnboardingDecl = {
  enabled: boolean;
  stepLabels?: string[];
  slugPlaceholder?: string;
  tunnelHelp?: string;
  requireOpenaiKey?: boolean;
  afterCompleteHref?: string;
  accentColor?: string;
  backgroundColor?: string;
};

export type BrandYaml = {
  brandId: string;
  brandName: string;
  domain: string;
  tagline?: string;
  /**
   * Vertical métier — champ LIBRE (le contrat OS n'énumère pas les
   * verticaux ; la factory peut en connaître certains comme générateurs
   * legacy assumés).
   */
  vertical?: string;
  sandbox?: boolean;
  /**
   * URL serveur pré-provisionnée dans le picker du client join-only
   * (installateur distribué au cabinet). Optionnel.
   */
  defaultServerUrl?: string;
  platform?: Partial<BrandPlatformNeeds>;
  meili?: BrandMeiliDecl;
  mcp?: BrandMcpDecl;
  onboarding?: BrandOnboardingDecl;
};

export type BrandModuleSpec = {
  id: string;
  dir: string;
  hasPrd: boolean;
  hasSchema: boolean;
  hasApi: boolean;
  hasMcp: boolean;
  hasUi: boolean;
};

export type BrandSpecIssue = {
  level: "error" | "warn" | "info";
  code: string;
  message: string;
  path?: string;
};

export type BrandSpec = {
  rootDir: string;
  brand: BrandYaml;
  productMd: string | null;
  modules: BrandModuleSpec[];
  platformDir: string | null;
  databasesDir: string | null;
  agentsMd: string | null;
  interviewSchema: unknown | null;
};

export type DoctorResult = {
  ok: boolean;
  spec: BrandSpec | null;
  issues: BrandSpecIssue[];
};

export function defaultPlatformNeeds(): BrandPlatformNeeds {
  return {
    auth: true,
    desktop: true,
    pluginApi: true,
    chat: true,
    sync: false,
    meili: true,
    mcp: true,
    onboarding: true,
  };
}
