/**
 * Collecteur des contributions démo des modules métier.
 *
 * Chaque module du registre marque (`BrandModuleDef.demo`) peut contribuer
 * des scénarios de démo interactive ; ce collecteur les agrège en la liste
 * de DÉFAUTS servie par `createInteractiveDemoMount` :
 *
 * ```ts
 * createInteractiveDemoMount({ defaults: collectDemoScenarios() });
 * ```
 *
 * Contrat :
 * - **validation** : chaque scénario passe `validateDemoScenario` — un
 *   scénario invalide est une erreur de module (bug), pas un cas runtime ;
 * - **dédup par id** : un même id contribué deux fois par le MÊME module
 *   (module listé en double dans le registre) est ignoré silencieusement ;
 *   un même id contribué par DEUX modules différents est un conflit, sauf
 *   `os-tour` (`genericOsTourScenario` partagé — premier gagne) ;
 * - **erreurs claires** : toutes les erreurs sont agrégées puis levées en
 *   UNE Error listant module + scénario + codes de validation — le boot
 *   échoue explicitement plutôt que de servir une démo tronquée ;
 * - **ordre stable** : la sortie suit l'ordre du registre (contributions)
 *   puis l'ordre de déclaration dans chaque module — jamais de tri implicite.
 *
 * Zéro texte métier ici : les scénarios vivent dans les modules marque.
 */

import type { DemoScenario } from "./types.js";
import { validateDemoScenario } from "./types.js";

/**
 * Contribution démo d'un module métier — forme aplatie du champ
 * `demo?: { scenarios: DemoScenario[] }` de `BrandModuleDef`, préfixée de
 * l'id du module pour la dédup et les messages d'erreur.
 */
export type DemoModuleContribution = {
  /** Id du module contributeur (clé de dédup et préfixe d'erreur). */
  moduleId: string;
  /** Scénarios par défaut contribués par le module. */
  scenarios: DemoScenario[];
};

/**
 * Agrège les scénarios démo contribués par les modules métier.
 *
 * Renvoie les scénarios valides dans l'ordre stable contributions →
 * déclaration. Lève une Error unique listant TOUTES les erreurs si un
 * scénario est invalide (`validateDemoScenario`) ou si deux modules
 * différents contribuent le même id.
 */
export function collectInteractiveDemoDefaults(
  contributions: readonly DemoModuleContribution[],
): DemoScenario[] {
  const errors: string[] = [];
  const out: DemoScenario[] = [];
  const ownerById = new Map<string, string>();

  for (const contribution of contributions ?? []) {
    if (!contribution || typeof contribution !== "object") {
      errors.push("contribution_invalide");
      continue;
    }
    const moduleId =
      typeof contribution.moduleId === "string" && contribution.moduleId.trim()
        ? contribution.moduleId
        : "<module_inconnu>";
    if (moduleId === "<module_inconnu>") {
      errors.push("module_id_requis");
    }
    const scenarios = (contribution as DemoModuleContribution).scenarios;
    if (!Array.isArray(scenarios)) {
      errors.push(`${moduleId}: scenarios_requis (tableau)`);
      continue;
    }

    for (const scenario of scenarios) {
      const id =
        scenario && typeof scenario === "object" && !Array.isArray(scenario)
          ? (scenario as Partial<DemoScenario>).id
          : undefined;
      const at = `${moduleId}:${typeof id === "string" && id ? id : "<sans_id>"}`;

      // Dédup par id : doublon interne au même module = ignoré (registre
      // listé deux fois) ; doublon entre modules distincts = conflit —
      // sauf `os-tour` (scénario OS partagé : premier gagne, les suivants
      // sont le même `genericOsTourScenario` posé par chaque stub module).
      if (typeof id === "string" && id && ownerById.has(id)) {
        const owner = ownerById.get(id)!;
        if (owner === moduleId || id === "os-tour") continue;
        errors.push(`scenario en double: ${id} (modules ${owner} et ${moduleId})`);
        continue;
      }

      const validation = validateDemoScenario(scenario);
      if (validation.length > 0) {
        errors.push(`${at}: ${validation.join(", ")}`);
        continue;
      }
      ownerById.set(id!, moduleId);
      out.push(scenario as DemoScenario);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      "collectInteractiveDemoDefaults — contributions invalides :\n" +
        errors.map((e) => `  - ${e}`).join("\n"),
    );
  }
  return out;
}
