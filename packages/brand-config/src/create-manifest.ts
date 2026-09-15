/**
 * Fabrique un AppManifest Client+Serveur à partir d'un spec minimal.
 * Utilisé par `@creezio/factory` (Phase D) — jamais pour écraser
 * un manifest de production déjà en flotte.
 */

import { nsisGuidFromAppId } from "./nsis-guid.js";
import type {
  AppManifest,
  BrandFeatures,
  BrandPublishInfra,
  ExeIdentity,
} from "./types.js";

export type AppManifestSpec = {
  /** Identifiant court (`demobrand`). */
  brandId: string;
  /** Nom produit affiché (`DemoBrand`). */
  productName: string;
  /** Domaine principal / feed / tunnel (ex. `demobrand.creez.io`). */
  domain: string;
  /** Préfixe env (défaut = brandId upper). */
  envPrefix?: string;
  /** Token path feed `/dl-<token>/` (défaut = dérivé déterministe). */
  feedToken?: string;
  /** Copyright electron-builder. */
  copyright?: string;
  /** Marque sandbox / démo (exclue des asserts feeds prod). */
  sandbox?: boolean;
  /** Racine app locale (défaut `/opt/docker/creezio/apps/<brandId>`). */
  defaultAppRoot?: string;
  /** Préfixe reverse-DNS appId (défaut `io.creezio`). */
  appIdPrefix?: string;
  /** Hôte remote-build (défaut parc Creezio). */
  remoteBuildHost?: string;
  /**
   * URL serveur pré-provisionnée dans le picker client join-only
   * (installateur cabinet). Optionnel — laissé vide sinon.
   */
  defaultServerUrl?: string;
  /**
   * Mode hostnames tunnel : `flat` pour zones Universal SSL
   * (`n8n-{slug}.{zone}`). Défaut nested. Override : CREEZIO_TUNNEL_FLAT_HOSTS.
   */
  tunnelHostMode?: "nested" | "flat";
  /**
   * Capacités optionnelles. `onboarding: false` pour demo-app / apps sans
   * étapes produit (post-setup → home).
   */
  features?: BrandFeatures;
};

function assertBrandId(id: string): string {
  const s = id.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(s)) {
    throw new Error(
      `brandId invalide "${id}" — attendu [a-z][a-z0-9-]{1,31}`,
    );
  }
  if (["tempoflow", "certivan", "fidu"].includes(s)) {
    throw new Error(
      `brandId réservé (marque prod): ${s} — ne pas régénérer via factory`,
    );
  }
  return s;
}

function toEnvPrefix(brandId: string, override?: string): string {
  if (override?.trim()) {
    const p = override.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(p)) {
      throw new Error(`envPrefix invalide: ${override}`);
    }
    return p;
  }
  return brandId.toUpperCase().replace(/-/g, "_");
}

/** Token feed sandbox déterministe (≠ tokens prod déjà en flotte). */
export function defaultFeedToken(brandId: string): string {
  // Préfixe sandbox + empreinte courte — jamais les tokens prod.
  const digest = nsisGuidFromAppId(`creezio-feed:${brandId}`).replace(
    /-/g,
    "",
  );
  return `sandbox${digest.slice(0, 24)}`;
}

function bridgeNameFor(brandId: string): string {
  const camel = brandId.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return `${camel}Desktop`;
}

function exeIdentity(opts: {
  appId: string;
  productName: string;
  executableName: string;
  artifactName: string;
  packageName: string;
  userDataSegment: string;
  feedUrl: string;
}): ExeIdentity {
  return {
    appId: opts.appId,
    productName: opts.productName,
    executableName: opts.executableName,
    artifactName: opts.artifactName,
    packageName: opts.packageName,
    userDataSegment: opts.userDataSegment,
    feedUrl: opts.feedUrl,
    nsisGuid: nsisGuidFromAppId(opts.appId),
    appUserModelId: opts.appId,
  };
}

/**
 * Construit un AppManifest complet (Client + Serveur + publish).
 */
export function createAppManifest(spec: AppManifestSpec): AppManifest {
  const brandId = assertBrandId(spec.brandId);
  const productName = spec.productName.trim();
  if (!productName) throw new Error("productName requis");

  const domain = spec.domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (!domain.includes(".")) {
    throw new Error(`domain invalide: ${spec.domain}`);
  }

  const envPrefix = toEnvPrefix(brandId, spec.envPrefix);
  const feedToken = (spec.feedToken || defaultFeedToken(brandId)).replace(
    /^dl-/,
    "",
  );
  const appIdPrefix = (spec.appIdPrefix || "io.creezio").replace(/\.$/, "");
  const clientAppId = `${appIdPrefix}.${brandId}`;
  const serverAppId = `${appIdPrefix}.${brandId}.server`;
  const feedBase = `https://${domain}/dl-${feedToken}/`;
  const defaultAppRoot =
    spec.defaultAppRoot || `/opt/docker/creezio/apps/${brandId}`;
  const remoteBuildHost = spec.remoteBuildHost || "deploy@104.168.10.36";

  const publish: BrandPublishInfra = {
    dockerDlName: `dl-${brandId}`,
    hostDlDirDefault: `/var/lib/docker/volumes/nginx-proxy-manager_npm_data/_data/dl-${brandId}`,
    npmContainer: "nginx-proxy-manager",
    remoteBuildHost,
    remoteBuildRoot: `/opt/docker/${brandId}-build`,
    remoteBinSrc: `/opt/docker/creezio/apps/${brandId}`,
    statusFile: `/tmp/${brandId}-build-status.json`,
    remoteLogPrefix: `${brandId}-remote-build`,
    buildServerArtifact: true,
    defaultAppRoot,
  };

  return {
    brandId,
    envPrefix,
    bridgeName: bridgeNameFor(brandId),
    dbFileName: `${brandId}.db`,
    localConfigFileName: `${brandId}-config.json`,
    deepLinkProtocol: brandId,
    sessionPartition: `${brandId}-app`,
    logBasename: `${brandId}-main`,
    tunnelRootDomain: domain,
    ...(spec.tunnelHostMode === "flat" || spec.tunnelHostMode === "nested"
      ? { tunnelHostMode: spec.tunnelHostMode }
      : {}),
    domains: {
      primary: domain,
      feedHost: domain,
    },
    copyright: spec.copyright || `© ${productName}`,
    client: exeIdentity({
      appId: clientAppId,
      productName,
      executableName: productName.replace(/\s+/g, ""),
      artifactName: `${productName.replace(/\s+/g, "")}-Setup-\${version}.\${ext}`,
      packageName: brandId,
      userDataSegment: brandId,
      feedUrl: feedBase,
    }),
    server: exeIdentity({
      appId: serverAppId,
      productName: `${productName} Server`,
      executableName: `${productName.replace(/\s+/g, "")}-Server`,
      artifactName: `${productName.replace(/\s+/g, "")}-Server-Setup-\${version}.\${ext}`,
      packageName: `${brandId}-server`,
      userDataSegment: `${productName} Server`,
      feedUrl: `${feedBase}server/`,
    }),
    publish,
    ...(spec.defaultServerUrl?.trim()
      ? { defaultServerUrl: spec.defaultServerUrl.trim() }
      : {}),
    ...(spec.sandbox ? { sandbox: true as const } : {}),
    ...(spec.features ? { features: { ...spec.features } } : {}),
  };
}

/** Valide qu'un objet ressemble à un AppManifest Client+Serveur. */
export function validateAppManifest(m: AppManifest): string[] {
  const errors: string[] = [];
  const req = (cond: unknown, msg: string) => {
    if (!cond) errors.push(msg);
  };
  req(m.brandId, "brandId manquant");
  req(m.envPrefix, "envPrefix manquant");
  req(m.bridgeName, "bridgeName manquant");
  req(m.client?.appId, "client.appId manquant");
  req(m.server?.appId, "server.appId manquant");
  req(m.client?.nsisGuid, "client.nsisGuid manquant");
  req(m.server?.nsisGuid, "server.nsisGuid manquant");
  req(
    m.client?.nsisGuid !== m.server?.nsisGuid,
    "GUID client/serveur doivent être distincts",
  );
  req(m.client?.feedUrl?.endsWith("/"), "client.feedUrl doit finir par /");
  req(
    m.server?.feedUrl?.includes("/server/"),
    "server.feedUrl doit contenir /server/",
  );
  req(m.publish?.dockerDlName, "publish.dockerDlName manquant");
  req(m.publish?.buildServerArtifact === true, "buildServerArtifact doit être true pour une new-app");
  if (m.client?.appId) {
    req(
      m.client.nsisGuid === nsisGuidFromAppId(m.client.appId),
      "client.nsisGuid ≠ UUID.v5(appId)",
    );
  }
  if (m.server?.appId) {
    req(
      m.server.nsisGuid === nsisGuidFromAppId(m.server.appId),
      "server.nsisGuid ≠ UUID.v5(appId)",
    );
  }
  const reservedProdFeedTokens = [
    "dl-e660352fb04dbd5e2519f0e60897c548",
    "dl-3c94d486b0efa7618fad5bdfff410c49",
  ];
  if (
    m.sandbox &&
    reservedProdFeedTokens.some((tok) => m.client?.feedUrl?.includes(tok))
  ) {
    errors.push("sandbox ne doit pas recycler un feedToken prod");
  }
  return errors;
}
