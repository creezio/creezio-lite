/**
 * Résout la config publish / remote-build pour une marque + kind.
 * Consommé par les scripts bash (JSON / export shell) et la console.
 */

import fs from "node:fs";
import path from "node:path";
import {
  type AppKind,
  type AppManifest,
  appKindEnvKey,
  distDirForKind,
  exeForKind,
  feedBaseUrl,
  latestYmlUrl,
  listBrandIds,
  resolveArtifactFileName,
  resolveLatestAlias,
  resolveManifest,
  serverPlatformEnvKey,
} from "@creezio/brand-config";

export type ResolvedPublishConfig = {
  /** brandId registre ou from-prd (string libre si JSON marque). */
  brandId: string;
  kind: AppKind;
  envPrefix: string;
  productName: string;
  title: string;
  version: string;
  appRoot: string;
  distDir: string;
  distAbs: string;
  exeFileName: string;
  latestAlias: string;
  legacyAlias: string | null;
  feedBase: string;
  feedUrl: string;
  latestYmlUrl: string;
  dockerDlName: string;
  dockerDlDir: string;
  hostDlRoot: string;
  hostDlDir: string;
  npmContainer: string;
  statusFile: string;
  statusDist: string;
  remoteLogHint: string;
  remoteBuildHost: string;
  remoteBuildRoot: string;
  remoteCrm: string;
  remoteBinSrc: string;
  remoteLogPrefix: string;
  buildServerArtifact: boolean;
  appKindEnv: string;
  serverPlatformEnv: string;
  defaultAppRoot: string;
  npmPublishCmd: string;
  npmRemoteBuildCmd: string;
  npmBuildStatusCmd: string;
  /** Extension artefact : exe (win) ou AppImage (linux). */
  artifactExt: string;
  /** Manifest updater : latest.yml (win) ou latest-linux.yml. */
  latestYmlName: string;
};

function readAppVersion(appRoot: string): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(appRoot, "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ? String(pkg.version) : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Chemin conteneur NPM aligné sur `hostDlDirDefault`.
 * Ex. host `…/dl-acme/tf3` + dockerDlName `dl-acme`
 * → `/data/dl-acme/tf3` (pas la racine TF2).
 */
export function resolveDockerDlDir(
  dockerDlName: string,
  hostDlRoot: string,
  kind: AppKind,
): string {
  const marker = `/${dockerDlName}`;
  const normalized = hostDlRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = normalized.lastIndexOf(marker);
  const suffix =
    idx >= 0 ? normalized.slice(idx + marker.length).replace(/\/+$/, "") : "";
  const base = `/data/${dockerDlName}${suffix}`;
  return kind === "server" ? `${base}/server` : base;
}

export type ResolvePublishConfigOptions = {
  /** Registre kit ou brandId from-prd (résolu via app-manifest.json). */
  brandId: string;
  kind?: AppKind;
  appRoot?: string;
  version?: string;
  /** Override DL host dir (`{ENV}_DL_DIR`). */
  hostDlRoot?: string;
  /** Artefact publish : Windows NSIS (défaut) ou Linux AppImage. */
  platform?: "win" | "linux";
};

export function resolvePublishConfig(
  opts: ResolvePublishConfigOptions,
): ResolvedPublishConfig {
  const brandId = opts.brandId.trim().toLowerCase();
  if (!brandId) throw new Error("brandId requis");
  // Pré-résoudre appRoot pour fallback JSON hors registre.
  const appRootHint = path.resolve(
    opts.appRoot || process.env.CREEZIO_APP_ROOT || process.cwd(),
  );
  const manifest: AppManifest = resolveManifest(brandId, {
    appRoot: appRootHint,
  });
  const kind: AppKind = opts.kind === "server" ? "server" : "client";
  const platform: "win" | "linux" =
    opts.platform === "linux" ||
    process.env.CREEZIO_PLATFORM === "linux" ||
    process.env.CREEZIO_PLATFORM === "AppImage"
      ? "linux"
      : "win";
  const artifactExt = platform === "linux" ? "AppImage" : "exe";
  const latestYmlName =
    platform === "linux" ? "latest-linux.yml" : "latest.yml";
  const exe = exeForKind(manifest, kind);
  const appRoot = path.resolve(
    opts.appRoot ||
      process.env.CREEZIO_APP_ROOT ||
      manifest.publish.defaultAppRoot,
  );
  const version = opts.version || process.env.VERSION || readAppVersion(appRoot);
  const distRel = distDirForKind(kind);
  const distAbs = path.join(appRoot, distRel);
  const feedBase = feedBaseUrl(exe);
  const hostDlRoot =
    opts.hostDlRoot ||
    process.env[`${manifest.envPrefix}_DL_DIR`] ||
    process.env.CREEZIO_DL_DIR ||
    manifest.publish.hostDlDirDefault;
  // Aligner docker path sur hostDlDirDefault (ex. factory : …/dl-acme/tf3 →
  // /data/dl-acme/tf3). Sans ça, SSH publish écrase le feed kit racine
  // et le public /tf3/ reste stale.
  const dockerDlDir = resolveDockerDlDir(
    manifest.publish.dockerDlName,
    hostDlRoot,
    kind,
  );
  const hostDlDir =
    kind === "server" ? path.join(hostDlRoot, "server") : hostDlRoot;
  const statusFile =
    process.env[`${manifest.envPrefix}_BUILD_STATUS_FILE`] ||
    process.env.CREEZIO_BUILD_STATUS_FILE ||
    manifest.publish.statusFile;
  const statusDist = path.join(
    appRoot,
    "dist-electron",
    "build-status.json",
  );
  const remoteLogPrefix = manifest.publish.remoteLogPrefix;
  const remoteHost =
    process.env[`${manifest.envPrefix}_REMOTE_BUILD_HOST`] ||
    process.env.CREEZIO_REMOTE_BUILD_HOST ||
    manifest.publish.remoteBuildHost;
  const remoteRoot =
    process.env[`${manifest.envPrefix}_REMOTE_BUILD_ROOT`] ||
    process.env.CREEZIO_REMOTE_BUILD_ROOT ||
    manifest.publish.remoteBuildRoot;
  const remoteBinSrc =
    process.env[`${manifest.envPrefix}_REMOTE_BIN_SRC`] ||
    process.env.CREEZIO_REMOTE_BIN_SRC ||
    manifest.publish.remoteBinSrc;

  return {
    brandId,
    kind,
    envPrefix: manifest.envPrefix,
    productName: exe.productName,
    title: kind === "server" ? exe.productName : `${exe.productName} Desktop`,
    version,
    appRoot,
    distDir: distRel,
    distAbs,
    exeFileName: resolveArtifactFileName(exe, version, artifactExt),
    latestAlias: resolveLatestAlias(exe, artifactExt),
    legacyAlias:
      platform === "win" &&
      kind === "client" &&
      manifest.publish.legacyClientAlias
        ? manifest.publish.legacyClientAlias
        : null,
    feedBase,
    feedUrl: feedBase,
    latestYmlUrl:
      platform === "linux"
        ? `${feedBase}/${latestYmlName}`
        : latestYmlUrl(manifest, kind),
    dockerDlName: manifest.publish.dockerDlName,
    dockerDlDir,
    hostDlRoot,
    hostDlDir,
    npmContainer: manifest.publish.npmContainer,
    statusFile,
    statusDist,
    remoteLogHint: `/tmp/${remoteLogPrefix}-${version}.log`,
    remoteBuildHost: remoteHost,
    remoteBuildRoot: remoteRoot,
    remoteCrm: path.posix.join(remoteRoot.replace(/\\/g, "/"), "crm"),
    remoteBinSrc,
    remoteLogPrefix,
    buildServerArtifact: manifest.publish.buildServerArtifact,
    appKindEnv: appKindEnvKey(manifest),
    serverPlatformEnv: serverPlatformEnvKey(manifest),
    defaultAppRoot: manifest.publish.defaultAppRoot,
    npmPublishCmd: `CREEZIO_BRAND=${brandId} bash scripts/electron/publish-desktop.sh`,
    npmRemoteBuildCmd: `CREEZIO_BRAND=${brandId} bash scripts/electron/remote-build-win.sh`,
    npmBuildStatusCmd: `CREEZIO_BRAND=${brandId} npm run electron:build-status`,
    artifactExt,
    latestYmlName,
  };
}

/** Export shell `KEY=value` (échappé) pour `eval "$(… --export-shell)"`. */
export function toShellExports(cfg: ResolvedPublishConfig): string {
  const pairs: Array<[string, string]> = [
    ["CREEZIO_BRAND", cfg.brandId],
    ["CREEZIO_KIND", cfg.kind],
    ["CREEZIO_ENV_PREFIX", cfg.envPrefix],
    ["CREEZIO_PRODUCT_NAME", cfg.productName],
    ["CREEZIO_TITLE", cfg.title],
    ["CREEZIO_VERSION", cfg.version],
    ["CREEZIO_APP_ROOT", cfg.appRoot],
    ["CREEZIO_DIST_DIR", cfg.distDir],
    ["CREEZIO_DIST_ABS", cfg.distAbs],
    ["CREEZIO_EXE", cfg.exeFileName],
    ["CREEZIO_ALIAS", cfg.latestAlias],
    ["CREEZIO_LEGACY_ALIAS", cfg.legacyAlias || ""],
    ["CREEZIO_ARTIFACT_EXT", cfg.artifactExt],
    ["CREEZIO_LATEST_YML", cfg.latestYmlName],
    ["CREEZIO_FEED_URL", cfg.feedUrl],
    ["CREEZIO_LATEST_YML_URL", cfg.latestYmlUrl],
    ["CREEZIO_DOCKER_DL_NAME", cfg.dockerDlName],
    ["CREEZIO_DOCKER_DL_DIR", cfg.dockerDlDir],
    ["CREEZIO_HOST_DL_ROOT", cfg.hostDlRoot],
    ["CREEZIO_HOST_DL_DIR", cfg.hostDlDir],
    ["CREEZIO_NPM_CONTAINER", cfg.npmContainer],
    ["CREEZIO_STATUS_FILE", cfg.statusFile],
    ["CREEZIO_STATUS_DIST", cfg.statusDist],
    ["CREEZIO_REMOTE_LOG_HINT", cfg.remoteLogHint],
    ["CREEZIO_REMOTE_BUILD_HOST", cfg.remoteBuildHost],
    ["CREEZIO_REMOTE_BUILD_ROOT", cfg.remoteBuildRoot],
    ["CREEZIO_REMOTE_CRM", cfg.remoteCrm],
    ["CREEZIO_REMOTE_BIN_SRC", cfg.remoteBinSrc],
    ["CREEZIO_REMOTE_LOG_PREFIX", cfg.remoteLogPrefix],
    ["CREEZIO_BUILD_SERVER", cfg.buildServerArtifact ? "1" : "0"],
    ["CREEZIO_APP_KIND_ENV", cfg.appKindEnv],
    ["CREEZIO_SERVER_PLATFORM_ENV", cfg.serverPlatformEnv],
  ];
  return pairs
    .map(([k, v]) => `${k}=${shellQuote(v)}`)
    .join("\n");
}

function shellQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

/**
 * Parse --brand / CREEZIO_BRAND.
 * Accepte le registre kit OU une marque from-prd si app-manifest.json
 * est trouvable (CREEZIO_APP_ROOT / cwd).
 */
export function parseBrandArg(raw: string | undefined): string {
  const id = (raw || process.env.CREEZIO_BRAND || "").trim().toLowerCase();
  if (!id) {
    throw new Error(
      `Marque requise (--brand=… ou CREEZIO_BRAND). Connues: ${listBrandIds().join(", ")} (+ from-prd via app-manifest.json)`,
    );
  }
  const appRoot = process.env.CREEZIO_APP_ROOT || process.cwd();
  try {
    resolveManifest(id, { appRoot });
  } catch (e) {
    throw new Error(
      e instanceof Error
        ? e.message
        : `Marque inconnue: ${id}. Connues: ${listBrandIds().join(", ")}`,
    );
  }
  return id;
}

export function parseKindArg(raw: string | undefined): AppKind {
  const k = (raw || process.env.CREEZIO_KIND || "client").trim().toLowerCase();
  return k === "server" ? "server" : "client";
}
