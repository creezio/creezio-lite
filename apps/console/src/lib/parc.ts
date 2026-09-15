import {
  type BrandId,
  getManifest,
  listBrandIds,
  listProductionBrandIds,
} from "@creezio/brand-config";
import {
  collectDesktopBuildStatus,
  fetchBrandFeeds,
  type BrandFeedsSnapshot,
  type FeedSnapshot,
} from "@creezio/desktop-tooling";

export type BrandParcRow = {
  brandId: BrandId;
  label: string;
  envPrefix: string;
  defaultAppRoot: string;
  buildServerArtifact: boolean;
  sandbox: boolean;
  feeds: BrandFeedsSnapshot;
  buildStatus: ReturnType<typeof collectDesktopBuildStatus>;
};

const LABELS: Record<string, string> = {
  tempoflow: "TempoFlow",
  certivan: "Certivan",
  fidu: "Fidu",
  demobrand: "DemoBrand (sandbox)",
};

export function brandLabel(id: BrandId): string {
  return LABELS[id] || id;
}

function emptyFeed(brandId: BrandId, kind: "client" | "server"): FeedSnapshot {
  const m = getManifest(brandId);
  const feedUrl = m[kind].feedUrl;
  return {
    kind,
    feedUrl,
    latestYmlUrl: `${feedUrl.replace(/\/+$/, "")}/latest.yml`,
    ok: false,
    httpStatus: null,
    error: "sandbox — feed jetable (pas de fetch live)",
    meta: { version: null, path: null, sha512: null, releaseDate: null, size: null },
    downloadUrl: null,
    rawPreview: null,
  };
}

export function loadParc(): BrandParcRow[] {
  return listBrandIds().map((brandId) => {
    const manifest = getManifest(brandId);
    const sandbox = Boolean(manifest.sandbox);
    const feeds = sandbox
      ? {
          brandId,
          generatedAt: new Date().toISOString(),
          client: emptyFeed(brandId, "client"),
          server: emptyFeed(brandId, "server"),
        }
      : fetchBrandFeeds(brandId);
    const buildStatus = collectDesktopBuildStatus({
      brandId,
      appRoot: manifest.publish.defaultAppRoot,
    });
    return {
      brandId,
      label: brandLabel(brandId),
      envPrefix: manifest.envPrefix,
      defaultAppRoot: manifest.publish.defaultAppRoot,
      buildServerArtifact: manifest.publish.buildServerArtifact,
      sandbox,
      feeds,
      buildStatus,
    };
  });
}

export { listBrandIds, listProductionBrandIds };
