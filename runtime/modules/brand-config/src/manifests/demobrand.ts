import { createAppManifest } from "../create-manifest.js";

/**
 * Manifest sandbox Phase D — DemoBrand.
 * Feeds / GUID / dockerDl distincts des marques prod.
 * Généré via `createAppManifest` (même chemin que `lite new-app`).
 */
export const demobrandManifest = createAppManifest({
  brandId: "demobrand",
  productName: "DemoBrand",
  domain: "demobrand.creez.io",
  sandbox: true,
  defaultAppRoot: "/opt/docker/lite/apps/demobrand",
});
