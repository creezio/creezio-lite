export type {
  AppKind,
  AppManifest,
  BrandFeatures,
  BrandPublishInfra,
  ExeIdentity,
} from "./types.js";
export {
  appKindEnvKey,
  appSessionPartition,
  distDirForKind,
  envKey,
  exeForKind,
  feedBaseUrl,
  isFeatureEnabled,
  latestYmlUrl,
  profileArgPrefix,
  profileDirArgPrefix,
  resolveArtifactFileName,
  resolveLatestAlias,
  serverPlatformEnvKey,
} from "./types.js";

export { demobrandManifest } from "./manifests/demobrand.js";

export {
  ASAR_EXCLUDE_KIT_BINS,
  CREEZIO_ASAR_NPM_INSTALL_ONLY,
  CREEZIO_ASAR_NPM_RUNTIME_PACKAGES,
  CREEZIO_ASAR_RUNTIME_PACKAGES,
  CREEZIO_ASAR_TOOLING_ONLY,
  CREEZIO_ASAR_UNPACK_NATIVE,
  DEFAULT_HOST_ONLY_ELECTRON_MODULES,
  DEFAULT_WIN_BIN_STAGE,
  WIN_SERVER_BIN_FILTER,
  buildElectronBuilderConfig,
  collectCreezioRuntimePackages,
  collectNpmRuntimePackages,
  isKitBinExtraResource,
} from "./build-builder-config.js";
export type { BuildBuilderConfigOptions } from "./build-builder-config.js";

export {
  ELECTRON_BUILDER_NS_OID,
  nsisGuidFromAppId,
  uuidV5,
} from "./nsis-guid.js";
export { renderNsisInstallerInclude } from "./render-nsis-installer.js";
export {
  createAppManifest,
  defaultFeedToken,
  validateAppManifest,
} from "./create-manifest.js";
export type { AppManifestSpec } from "./create-manifest.js";

import fs from "node:fs";
import path from "node:path";
import { demobrandManifest } from "./manifests/demobrand.js";
import { validateAppManifest } from "./create-manifest.js";
import type { AppManifest } from "./types.js";

/**
 * Registre des manifests connus par le kit.
 *
 * H11 — « le kit ne connaît pas ses consommateurs » (docs/PROPAGATION.md) :
 * le manifest d'une marque vit dans SON repo (`src/electron/app-manifest.ts`
 * + `.json`, généré par la factory) et se résout via `resolveManifest`
 * (fallback disque). Seul `demobrand` (sandbox kit) reste enregistré.
 */
export const manifests = {
  demobrand: demobrandManifest,
} as const;

export type BrandId = keyof typeof manifests;

export function getManifest(brandId: BrandId): AppManifest {
  return manifests[brandId];
}

export function listBrandIds(opts?: { includeSandbox?: boolean }): BrandId[] {
  const ids = Object.keys(manifests) as BrandId[];
  if (opts?.includeSandbox === false) {
    return ids.filter((id) => !manifests[id].sandbox);
  }
  return ids;
}

/** Marques parc prod uniquement (feeds live). */
export function listProductionBrandIds(): BrandId[] {
  return listBrandIds({ includeSandbox: false });
}

export function isSandboxBrand(brandId: BrandId): boolean {
  return Boolean(manifests[brandId]?.sandbox);
}

export function isRegisteredBrandId(brandId: string): boolean {
  return listBrandIds().includes(brandId.trim().toLowerCase() as BrandId);
}

export type ResolveManifestOptions = {
  /** Racine app marque (src/electron/app-manifest.json). */
  appRoot?: string;
  /** Ignore validateAppManifest (lecture best-effort). */
  lenient?: boolean;
};

/**
 * Résout un AppManifest : registre typé, sinon JSON marque (from-prd).
 * Permet electron:publish sans hardcoder chaque brandId dans le kit.
 */
export function resolveManifest(
  brandId: string,
  opts: ResolveManifestOptions = {},
): AppManifest {
  const id = brandId.trim().toLowerCase();
  if (!id) throw new Error("brandId requis pour resolveManifest");

  if (isRegisteredBrandId(id)) {
    return getManifest(id as BrandId);
  }

  const appRoot = path.resolve(
    opts.appRoot || process.env.CREEZIO_APP_ROOT || process.cwd(),
  );
  const candidates = [
    path.join(appRoot, "src/electron/app-manifest.json"),
    path.join(appRoot, "build/electron/app-manifest.json"),
  ];
  let fromDisk: AppManifest | null = null;
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      fromDisk = JSON.parse(fs.readFileSync(file, "utf8")) as AppManifest;
      break;
    } catch {
      /* next */
    }
  }
  if (!fromDisk) {
    throw new Error(
      `Marque inconnue « ${id} » — absente du registre (${listBrandIds().join(", ")}) ` +
        `et pas de src/electron/app-manifest.json sous ${appRoot}`,
    );
  }
  if (String(fromDisk.brandId || "").toLowerCase() !== id) {
    throw new Error(
      `app-manifest.json brandId=${fromDisk.brandId} ≠ demandé ${id} (${appRoot})`,
    );
  }
  if (!opts.lenient) {
    const errors = validateAppManifest(fromDisk).filter(
      (e) => !e.includes("sandbox ne doit pas recycler"),
    );
    if (errors.length) {
      throw new Error(
        `app-manifest.json invalide (${appRoot}): ${errors.join("; ")}`,
      );
    }
  }
  return fromDisk;
}
