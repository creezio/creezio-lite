export type {
  BrandPlatformNeeds,
  BrandMeiliIndexDecl,
  BrandMeiliDecl,
  BrandMcpDecl,
  BrandOnboardingDecl,
  BrandYaml,
  BrandModuleSpec,
  BrandSpecIssue,
  BrandSpec,
  DoctorResult,
} from "./types.js";
export { defaultPlatformNeeds } from "./types.js";

export { loadBrandSpec, resolveBrandSpecDir } from "./load.js";
export {
  doctorBrandSpec,
  doctorAppBrandSpec,
  formatDoctorReport,
} from "./doctor.js";
export {
  initBrandSpec,
  moduleTemplateFiles,
  renderModuleSpecFiles,
  MODULE_SPEC_FILES,
  type InitBrandSpecOptions,
} from "./init.js";
export {
  resolveOnboardingDecl,
  toSetupWizardConfig,
} from "./onboarding-from-spec.js";
