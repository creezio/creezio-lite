/**
 * @creezio/interactive-demo — surface publique runtime.
 *
 * Moteur de démo interactive native (product tour live « Storylane-like »,
 * joué dans l'app par un faux curseur) : types de scénario déclaratifs,
 * collecteur des contributions des modules métier
 * (`collectInteractiveDemoDefaults`), contenu hybride DB (migrations +
 * merge + mount api-kernel) et scénario générique OS. Les composants React
 * vivent dans `@creezio/interactive-demo/ui`.
 */

export type {
  DemoTarget,
  DemoStepBase,
  DemoSayStep,
  DemoNavigateStep,
  DemoHighlightStep,
  DemoClickStep,
  DemoTypeStep,
  DemoScrollStep,
  DemoWaitStep,
  DemoWaitForStep,
  DemoStep,
  DemoStepKind,
  DemoScenario,
  DemoScenarioOverride,
} from "./types.js";
export { validateDemoScenario, scenarioMatchesRole } from "./types.js";

export { collectInteractiveDemoDefaults } from "./contributions.js";
export type { DemoModuleContribution } from "./contributions.js";

export {
  INTERACTIVE_DEMO_SCHEMA_SQL,
  interactiveDemoMigrations,
  mergeDemoScenarios,
  createInteractiveDemoMount,
} from "./content.js";
export type { InteractiveDemoMountOptions, DemoPersistence } from "./content.js";

export { genericOsTourScenario, osFeatureChapters } from "./generic.js";
export type { GenericOsTourOptions, OsFeatureChaptersOptions } from "./generic.js";
