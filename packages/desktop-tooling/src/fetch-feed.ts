/**
 * Lecture HTTP des feeds `latest.yml` (client + serveur) pour une marque.
 */

import { spawnSync } from "node:child_process";
import {
  type AppKind,
  type BrandId,
  latestYmlUrl,
  listBrandIds,
  resolveManifest,
} from "@creezio/brand-config";
import { type LatestYmlMeta, parseLatestYml } from "./parse-latest-yml.js";

export type FeedSnapshot = {
  kind: AppKind;
  feedUrl: string;
  latestYmlUrl: string;
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
  meta: LatestYmlMeta;
  downloadUrl: string | null;
  rawPreview: string | null;
};

export type BrandFeedsSnapshot = {
  brandId: string;
  generatedAt: string;
  client: FeedSnapshot;
  server: FeedSnapshot;
};

function curlGet(url: string, maxTime = 12): {
  status: number | null;
  body: string;
  error: string | null;
} {
  const res = spawnSync(
    "curl",
    ["-sS", "-w", "\n%{http_code}", "--max-time", String(maxTime), url],
    { encoding: "utf8" },
  );
  if (res.error) {
    return { status: null, body: "", error: res.error.message };
  }
  const out = (res.stdout || "").replace(/\r/g, "");
  const nl = out.lastIndexOf("\n");
  if (nl < 0) {
    return {
      status: res.status === 0 ? 200 : null,
      body: out,
      error: (res.stderr || "").trim() || null,
    };
  }
  const body = out.slice(0, nl);
  const code = Number(out.slice(nl + 1).trim());
  return {
    status: Number.isFinite(code) ? code : null,
    body,
    error: res.status === 0 ? null : (res.stderr || "curl failed").trim(),
  };
}

export function fetchFeedSnapshot(
  brandId: string,
  kind: AppKind,
): FeedSnapshot {
  const manifest = resolveManifest(brandId);
  const ymlUrl = latestYmlUrl(manifest, kind);
  const feedUrl = manifest[kind].feedUrl.replace(/\/+$/, "") + "/";
  const { status, body, error } = curlGet(ymlUrl);
  const ok = status === 200 && Boolean(body);
  const meta = parseLatestYml(ok ? body : null);
  return {
    kind,
    feedUrl,
    latestYmlUrl: ymlUrl,
    ok,
    httpStatus: status,
    error: ok ? null : error || `HTTP ${status ?? "?"}`,
    meta,
    downloadUrl:
      ok && meta.path
        ? `${feedUrl.replace(/\/+$/, "")}/${meta.path}`
        : null,
    rawPreview: ok ? body.trim().slice(0, 500) : null,
  };
}

export function fetchBrandFeeds(brandId: string): BrandFeedsSnapshot {
  resolveManifest(brandId);
  return {
    brandId,
    generatedAt: new Date().toISOString(),
    client: fetchFeedSnapshot(brandId, "client"),
    server: fetchFeedSnapshot(brandId, "server"),
  };
}

export function fetchAllBrandFeeds(): BrandFeedsSnapshot[] {
  return listBrandIds().map((id) => fetchBrandFeeds(id));
}
