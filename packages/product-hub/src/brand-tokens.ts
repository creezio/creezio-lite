/**
 * Jetons Product Hub dérivés de AppManifest (`envKey` / envPrefix).
 */

import type { AppManifest } from "@creezio/brand-config";

export type ProductHubBrandTokens = {
  brandId: string;
  envPrefix: string;
  /** Préfixe tag n8n, ex. `demobrand-plugin:` (limite 24 car. n8n incluse côté tag helper). */
  n8nTagPrefix: string;
  /** Préfixe token execution_grant, ex. `demobrand_exec_`. */
  grantTokenPrefix: string;
  /** Préfixe token control plane, ex. `demobrand_plug_`. */
  controlTokenPrefix: string;
  /** Header HTTP grant (minuscules), ex. `x-demobrand-execution-grant`. */
  executionGrantHeader: string;
  /** Header bypass admin-dev, ex. `x-demobrand-grant-bypass`. */
  grantBypassHeader: string;
  /** Env `{ENV}_PLUGIN_GRANT_BYPASS`. */
  grantBypassEnvKey: string;
  /** Valeur attendue du header bypass. */
  grantBypassValue: string;
  /** Nom service health, ex. `demobrand-plugins-api`. */
  controlPlaneServiceName: string;
  /** Env génériques + brandés pour bridge Hermes / sidecars. */
  pluginsDirEnvKeys: string[];
  pluginsApiTokenEnvKeys: string[];
  pluginsApiUrlEnvKeys: string[];
  /** Env override URL CRM plugin-products. */
  productsApiUrlEnvKey: string;
  productsApiKeyEnvKey: string;
};

function brandedEnv(envPrefix: string, suffix: string): string {
  return `${envPrefix.toUpperCase()}_${suffix}`;
}

/** Construit tous les jetons marque depuis le manifest (ou un sous-ensemble). */
export function productHubTokensFromManifest(
  manifest: Pick<AppManifest, "brandId" | "envPrefix">,
): ProductHubBrandTokens {
  const brandId = manifest.brandId.toLowerCase();
  const envPrefix = manifest.envPrefix.toUpperCase();
  const envLower = envPrefix.toLowerCase();
  return {
    brandId,
    envPrefix,
    n8nTagPrefix: `${brandId}-plugin:`,
    grantTokenPrefix: `${envLower}_exec_`,
    controlTokenPrefix: `${envLower}_plug_`,
    executionGrantHeader: `x-${brandId}-execution-grant`,
    grantBypassHeader: `x-${brandId}-grant-bypass`,
    grantBypassEnvKey: brandedEnv(envPrefix, "PLUGIN_GRANT_BYPASS"),
    grantBypassValue: "admin-dev",
    controlPlaneServiceName: `${brandId}-plugins-api`,
    pluginsDirEnvKeys: ["PLUGINS_DIR", brandedEnv(envPrefix, "PLUGINS_DIR")],
    pluginsApiTokenEnvKeys: [
      "PLUGINS_API_TOKEN",
      brandedEnv(envPrefix, "PLUGINS_API_TOKEN"),
    ],
    pluginsApiUrlEnvKeys: [
      "PLUGINS_API_URL",
      brandedEnv(envPrefix, "PLUGINS_API_URL"),
    ],
    productsApiUrlEnvKey: brandedEnv(envPrefix, "PLUGIN_PRODUCTS_API_URL"),
    productsApiKeyEnvKey: brandedEnv(envPrefix, "PLUGIN_PRODUCTS_API_KEY"),
  };
}

/** Hint agent joint aux 403 grant — brand-agnostic (pas d'URL marque). */
export function grantProcessHint(opts?: { crmApiPath?: string }): string {
  const path =
    opts?.crmApiPath || "$CRM_API_URL/api/v1/plugin-products";
  return (
    `Process Product Hub requis : 1) créer la demande via POST ${path} ` +
    "(rapport d'impact en retour) ; 2) présenter audit + questions de cadrage à l'utilisateur ; " +
    "3) déposer le PRD via POST …/plugin-products/<id>/prd ; 4) demander à l'utilisateur de VALIDER le projet " +
    "(chat ou Admin → Plugins) ; 5) après validation, POST /v1/products/<productId>/grant ici même. " +
    "Ne jamais mentionner grants/PRD/machine d'état à l'utilisateur — parler de « projet » et de « validation »."
  );
}
