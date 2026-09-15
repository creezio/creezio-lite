/**
 * Résolution env fleet-collector — defaults neutres `CREEZIO_*` / `FLEET_*`
 * + dual-read legacy marques (`TF2_*`, `CERTIVAN_*`).
 *
 * Aucun domaine marque hardcodé : suffix tunnel / titres UI via injection.
 */

function firstDefined(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

function parseJsonEnv(raw, fallback) {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * @returns {{
 *   port: number,
 *   ingestToken: string,
 *   opsToken: string,
 *   opsUser: string,
 *   opsPass: string,
 *   dataDir: string | undefined,
 *   tunnelSuffix: string,
 *   publicDomain: string,
 *   ui: {
 *     title: string,
 *     mark: string,
 *     homeTitle: string,
 *     realm: string,
 *     extrasTitle: string,
 *     etatLabels: Record<string, string>,
 *   },
 * }}
 */
export function resolveFleetCollectorEnv(defaults = {}) {
  const port = Number(
    firstDefined(
      "CREEZIO_FLEET_PORT",
      "FLEET_PORT",
      "TF2_FLEET_PORT",
      "CERTIVAN_FLEET_PORT",
    ) || defaults.port || 8665,
  );

  const ingestToken =
    firstDefined(
      "CREEZIO_FLEET_INGEST_TOKEN",
      "FLEET_INGEST_TOKEN",
      "TF2_FLEET_INGEST_TOKEN",
      "CERTIVAN_FLEET_INGEST_TOKEN",
    ) || defaults.ingestToken || "";

  const opsToken =
    firstDefined(
      "CREEZIO_FLEET_OPS_TOKEN",
      "FLEET_OPS_TOKEN",
      "TF2_FLEET_OPS_TOKEN",
      "CERTIVAN_FLEET_OPS_TOKEN",
    ) || defaults.opsToken || "";

  const opsUser =
    firstDefined(
      "CREEZIO_FLEET_OPS_USER",
      "FLEET_OPS_USER",
      "TF2_FLEET_OPS_USER",
      "CERTIVAN_FLEET_OPS_USER",
    ) || defaults.opsUser || "ops";

  const opsPass =
    firstDefined(
      "CREEZIO_FLEET_OPS_PASS",
      "FLEET_OPS_PASS",
      "TF2_FLEET_OPS_PASS",
      "CERTIVAN_FLEET_OPS_PASS",
    ) || defaults.opsPass || "ops";

  const dataDir = firstDefined(
    "CREEZIO_FLEET_DIR",
    "FLEET_DIR",
    "TF2_FLEET_DIR",
    "CERTIVAN_FLEET_DIR",
  );

  const publicDomain =
    firstDefined(
      "FLEET_PUBLIC_DOMAIN",
      "CREEZIO_FLEET_DOMAIN",
      "FLEET_DOMAIN",
    ) || defaults.publicDomain || "";

  const tunnelSuffix =
    firstDefined(
      "CREEZIO_FLEET_TUNNEL_SUFFIX",
      "FLEET_TUNNEL_SUFFIX",
    ) ||
    defaults.tunnelSuffix ||
    // Si seul le domaine public est fourni, l’utiliser comme suffixe slug.
    publicDomain ||
    "";

  const title =
    firstDefined(
      "CREEZIO_FLEET_UI_TITLE",
      "FLEET_UI_TITLE",
    ) || defaults.uiTitle || "Fleet";

  const mark =
    firstDefined(
      "CREEZIO_FLEET_UI_MARK",
      "FLEET_UI_MARK",
    ) || defaults.uiMark || "FL";

  const homeTitle =
    firstDefined(
      "CREEZIO_FLEET_UI_HOME_TITLE",
      "FLEET_UI_HOME_TITLE",
    ) || defaults.uiHomeTitle || `Flotte ${title}`;

  const realm =
    firstDefined(
      "CREEZIO_FLEET_UI_REALM",
      "FLEET_UI_REALM",
    ) || defaults.uiRealm || title;

  const extrasTitle =
    firstDefined(
      "CREEZIO_FLEET_UI_EXTRAS_TITLE",
      "FLEET_UI_EXTRAS_TITLE",
    ) || defaults.uiExtrasTitle || "Dossiers";

  const etatLabels = parseJsonEnv(
    firstDefined(
      "CREEZIO_FLEET_UI_ETAT_LABELS",
      "FLEET_UI_ETAT_LABELS",
    ),
    defaults.etatLabels || {},
  );

  return {
    port,
    ingestToken,
    opsToken,
    opsUser,
    opsPass,
    dataDir,
    tunnelSuffix,
    publicDomain,
    ui: {
      title,
      mark,
      homeTitle,
      realm,
      extrasTitle,
      etatLabels,
    },
  };
}

export function hostnameForSlug(slug, tunnelHostname, tunnelSuffix) {
  if (tunnelHostname) return String(tunnelHostname).slice(0, 120);
  if (tunnelSuffix) return `${slug}.${tunnelSuffix}`;
  return String(slug);
}
