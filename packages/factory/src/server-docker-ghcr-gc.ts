/**
 * Rétention / GC GHCR via l'API GitHub Packages (versions), pas l'API
 * Distribution v2 — `privateRegistryBases("ghcr.io")` reste `[]`.
 *
 * Geste : `creezio server-docker registry-gc --registry ghcr.io/<owner>`
 * et rétention post-`publish` quand le registre cible EST `ghcr.io`
 * (indépendant d'un registre de prod loopback).
 *
 * Règle (dupliquée du chemin local / PR factory-hygiene, pas un rebase) :
 *   - semver : au moins les 3 derniers (`GHCR_SEMVER_KEEP_MIN`) ;
 *   - `auto.*` / autres : fenêtre `--keep` (défaut 2) ;
 *   - jamais un tag référencé (servers.json / instances / in-use docker)
 *     ni une version dont un tag conservé partage le digest.
 *
 * Fail-closed si le token manque (GHCR_TOKEN / GITHUB_TOKEN / .github-token).
 * Dry-run par défaut pour `registry-gc` — `--apply` mute.
 */
import fs from "node:fs";
import path from "node:path";
import {
  collectInUseKeys,
  collectReleaseKeys,
  compareVersionTags,
  createDefaultRegistryDocker,
  createDefaultRegistryHttp,
  fetchFleetReleaseRefs,
  parseImageRef,
  resolveRegistryGcKeep,
  resolveRegistryGcServersFiles,
  serversFileImageRefs,
  type RegistryGcArgs,
  type RegistryGcDocker,
  type RegistryGcHttp,
  type RepoGcKeepReason,
} from "./server-docker-registry-gc.js";

export const GHCR_SEMVER_KEEP_MIN = 3;
export const GHCR_AUTO_TAG_RE = /^auto\./;
export const GHCR_SEMVER_TAG_RE = /^\d+\.\d+\.\d+(?:[.+-].*)?$/;
export const GHCR_API = "https://api.github.com";

export type GhcrTagFamily = "auto" | "semver" | "other";

export type GhcrTarget = {
  owner: string;
  packageName?: string;
};

export type GhcrHttpResponse = {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
};

export type GhcrHttp = {
  request(url: string, init?: RequestInit): Promise<GhcrHttpResponse>;
};

export type GhcrPackageVersion = {
  id: number;
  name: string;
  tags: string[];
};

export type GhcrVersionPlanItem = {
  id: number;
  packageName: string;
  digest: string;
  tags: string[];
  reason?: RepoGcKeepReason | "untagged";
};

export type GhcrGcResult = {
  dryRun: boolean;
  keep: number;
  registry: string;
  owner: string;
  packages: string[];
  kept: Array<{ packageName: string; id: number; tags: string[]; reason: string }>;
  deleted: Array<{ packageName: string; id: number; tags: string[]; digest: string }>;
};

export type GhcrGcOpts = {
  registry: string;
  keep: number;
  dryRun: boolean;
  packageName?: string;
  serversFiles?: string[];
  adminApp?: string;
  extraProtectTags?: string[];
  token?: string;
  tokenFiles?: string[];
  env?: NodeJS.ProcessEnv;
  ghHttp?: GhcrHttp;
  adminHttp?: RegistryGcHttp;
  docker?: RegistryGcDocker;
  log?: (line: string) => void;
};

export function isGhcrRegistry(registry: string): boolean {
  const raw = (registry || "").trim().replace(/^https?:\/\//i, "");
  return /^ghcr\.io(\/|$)/i.test(raw);
}

export function parseGhcrRegistry(registry: string): GhcrTarget {
  const raw = (registry || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  const parts = raw.split("/").filter(Boolean);
  if (parts.length < 2 || !/^ghcr\.io$/i.test(parts[0] || "")) {
    throw new Error(
      "registre GHCR invalide — attendu ghcr.io/<owner>[/<package>]",
    );
  }
  return {
    owner: parts[1]!,
    packageName: parts[2] || undefined,
  };
}

export function ghcrTagFamily(tag: string): GhcrTagFamily {
  if (GHCR_AUTO_TAG_RE.test(tag)) return "auto";
  if (GHCR_SEMVER_TAG_RE.test(tag)) return "semver";
  return "other";
}

export function resolveGhcrSemverKeep(keep: number): number {
  if (!Number.isFinite(keep) || keep < 1) {
    throw new Error(`--keep invalide (${keep}) — entier ≥ 1 requis`);
  }
  return Math.max(Math.floor(keep), GHCR_SEMVER_KEEP_MIN);
}

function oldestBeyondKeep(tags: string[], keep: number): string[] {
  const sorted = [...tags].sort(compareVersionTags);
  const n = Math.floor(keep);
  return n >= sorted.length ? [] : sorted.slice(0, sorted.length - n);
}

/**
 * Tags à supprimer : rétention par famille (3 semver min + keep auto/autres).
 * `protect` = tags jamais évincés (in-use, servers.json, just-pushed).
 */
export function selectGhcrTagsToPrune(
  tags: string[],
  keep: number,
  protect: Iterable<string> = [],
): string[] {
  if (!Number.isFinite(keep) || keep < 1) {
    throw new Error(`--keep invalide (${keep}) — entier ≥ 1 requis`);
  }
  const protectSet = new Set(protect);
  const auto: string[] = [];
  const semver: string[] = [];
  const other: string[] = [];
  for (const t of tags) {
    const family = ghcrTagFamily(t);
    if (family === "auto") auto.push(t);
    else if (family === "semver") semver.push(t);
    else other.push(t);
  }
  return [
    ...oldestBeyondKeep(auto, Math.floor(keep)),
    ...oldestBeyondKeep(semver, resolveGhcrSemverKeep(keep)),
    ...oldestBeyondKeep(other, Math.floor(keep)),
  ].filter((t) => !protectSet.has(t));
}

export function defaultGhcrTokenFiles(
  env: NodeJS.ProcessEnv = process.env,
  brandRoot?: string,
): string[] {
  const files: string[] = [];
  const explicit = (env.CREEZIO_GHCR_TOKEN_FILE || "").trim();
  if (explicit) files.push(explicit);
  if (brandRoot) files.push(path.join(brandRoot, ".github-token"));
  const kit = (env.CREEZIO_KIT_ROOT || "").trim();
  if (kit) files.push(path.join(kit, ".github-token"));
  files.push(path.join(process.cwd(), ".github-token"));
  return [...new Set(files)];
}

export function resolveGhcrToken(
  env: NodeJS.ProcessEnv = process.env,
  tokenFiles: string[] = [],
): string {
  for (const key of ["GHCR_TOKEN", "CREEZIO_GHCR_TOKEN", "GITHUB_TOKEN"]) {
    const raw = (env[key] || "").trim();
    if (raw) return raw;
  }
  for (const file of tokenFiles) {
    if (!file || !fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, "utf8").trim();
    if (raw) return raw;
  }
  throw new Error(
    "GHCR : authentification manquante — poser GHCR_TOKEN / GITHUB_TOKEN " +
      "(scope delete:packages) ou un fichier .github-token. GC refusé (fail-closed).",
  );
}

export function createGhcrHttp(token: string): GhcrHttp {
  return {
    async request(url, init) {
      let res: Response;
      try {
        res = await fetch(url, {
          ...init,
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "creezio-ghcr-gc",
            ...(init?.headers || {}),
          },
        });
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        throw new Error(`GHCR API injoignable (${url}) — ${why}`);
      }
      const raw = Buffer.from(await res.arrayBuffer());
      const text = raw.toString("utf8");
      return {
        status: res.status,
        ok: res.ok,
        headers: { get: (name) => res.headers.get(name) },
        json: async () => (text ? JSON.parse(text) : {}),
        text: async () => text,
      };
    },
  };
}

function packagePath(name: string): string {
  return encodeURIComponent(name);
}

function nextLink(headers: { get(name: string): string | null }): string | null {
  const link = headers.get("link") || headers.get("Link") || "";
  const next = link.match(/<([^>]+)>\s*;\s*rel="next"/i);
  return next?.[1] || null;
}

export function parseGhcrVersion(raw: Record<string, unknown>): GhcrPackageVersion | null {
  const id = Number(raw.id);
  if (!Number.isFinite(id) || id < 1) return null;
  const name = typeof raw.name === "string" ? raw.name : "";
  const meta = raw.metadata as { container?: { tags?: unknown } } | undefined;
  const tags = Array.isArray(meta?.container?.tags)
    ? meta.container.tags.filter((t): t is string => typeof t === "string" && t.length > 0)
    : [];
  return { id, name, tags };
}

export function protectTagsForPackage(
  packageName: string,
  owner: string,
  keys: Set<string>,
): Set<string> {
  const out = new Set<string>();
  const suffixes = [
    packageName,
    `${owner}/${packageName}`,
    `creezio/${packageName}`,
  ];
  for (const key of keys) {
    const colon = key.lastIndexOf(":");
    if (colon < 0) {
      out.add(key);
      continue;
    }
    const repo = key.slice(0, colon);
    const tag = key.slice(colon + 1);
    if (!tag) continue;
    if (suffixes.some((s) => repo === s || repo.endsWith(`/${s}`))) {
      out.add(tag);
    }
  }
  return out;
}

export function planGhcrPackageGc(opts: {
  packageName: string;
  versions: GhcrPackageVersion[];
  keep: number;
  inUseTags: Set<string>;
  referencedTags: Set<string>;
  inUseDigests: Set<string>;
  referencedDigests: Set<string>;
}): { keep: GhcrVersionPlanItem[]; delete: GhcrVersionPlanItem[] } {
  const { packageName, keep } = opts;
  if (!Number.isFinite(keep) || keep < 1) {
    throw new Error(`--keep invalide (${keep}) — entier ≥ 1 requis`);
  }
  const allTags = [
    ...new Set(opts.versions.flatMap((v) => v.tags)),
  ];
  const protect = new Set<string>([
    ...opts.inUseTags,
    ...opts.referencedTags,
  ]);
  const prune = new Set(selectGhcrTagsToPrune(allTags, keep, protect));
  const keepItems: GhcrVersionPlanItem[] = [];
  const deleteItems: GhcrVersionPlanItem[] = [];

  for (const v of opts.versions) {
    const digest = (v.name || "").toLowerCase();
    const item: GhcrVersionPlanItem = {
      id: v.id,
      packageName,
      digest,
      tags: v.tags,
    };
    if (v.tags.length === 0) {
      keepItems.push({ ...item, reason: "untagged" });
      continue;
    }
    const digestInUse = Boolean(digest && opts.inUseDigests.has(digest));
    const digestRef = Boolean(digest && opts.referencedDigests.has(digest));
    const tagInUse = v.tags.some((t) => opts.inUseTags.has(t));
    const tagRef = v.tags.some((t) => opts.referencedTags.has(t));
    if (digestInUse || tagInUse) {
      keepItems.push({ ...item, reason: "in-use" });
      continue;
    }
    if (digestRef || tagRef) {
      keepItems.push({ ...item, reason: "referenced" });
      continue;
    }
    if (v.tags.every((t) => prune.has(t))) {
      deleteItems.push(item);
    } else {
      keepItems.push({ ...item, reason: "recent" });
    }
  }
  return { keep: keepItems, delete: deleteItems };
}

type OwnerKind = "orgs" | "users";

async function ghJson(
  http: GhcrHttp,
  url: string,
  what: string,
): Promise<{ status: number; body: unknown; headers: GhcrHttpResponse["headers"] }> {
  const res = await http.request(url, { method: "GET" });
  const body = await res.json();
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `GHCR : authentification refusée (HTTP ${res.status}) — token scope ` +
        `read:packages + delete:packages requis. GC refusé (fail-closed).`,
    );
  }
  if (!res.ok && res.status !== 404) {
    throw new Error(`${what} : HTTP ${res.status} (${url})`);
  }
  return { status: res.status, body, headers: res.headers };
}

async function detectOwnerKind(
  http: GhcrHttp,
  owner: string,
): Promise<OwnerKind> {
  const probe = await ghJson(
    http,
    `${GHCR_API}/orgs/${owner}/packages?package_type=container&per_page=1`,
    `packages org ${owner}`,
  );
  if (probe.status === 200) return "orgs";
  const user = await ghJson(
    http,
    `${GHCR_API}/users/${owner}/packages?package_type=container&per_page=1`,
    `packages user ${owner}`,
  );
  if (user.status === 200) return "users";
  throw new Error(
    `GHCR : owner '${owner}' introuvable (orgs + users 404) — GC refusé (fail-closed)`,
  );
}

async function paginateJsonArray(
  http: GhcrHttp,
  startUrl: string,
  what: string,
): Promise<unknown[]> {
  const out: unknown[] = [];
  let url: string | null = startUrl;
  for (let i = 0; i < 50 && url; i++) {
    const page = await ghJson(http, url, what);
    if (page.status === 404) {
      throw new Error(`${what} : HTTP 404 (${url})`);
    }
    if (!Array.isArray(page.body)) {
      throw new Error(`${what} : réponse invalide (${url})`);
    }
    out.push(...page.body);
    url = nextLink(page.headers);
  }
  return out;
}

async function listGhcrPackages(
  http: GhcrHttp,
  kind: OwnerKind,
  owner: string,
): Promise<string[]> {
  const rows = await paginateJsonArray(
    http,
    `${GHCR_API}/${kind}/${owner}/packages?package_type=container&per_page=100`,
    `packages ${owner}`,
  );
  return rows
    .map((r) => (r && typeof r === "object" ? (r as { name?: unknown }).name : null))
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

async function listGhcrVersions(
  http: GhcrHttp,
  kind: OwnerKind,
  owner: string,
  packageName: string,
): Promise<GhcrPackageVersion[]> {
  const rows = await paginateJsonArray(
    http,
    `${GHCR_API}/${kind}/${owner}/packages/container/${packagePath(packageName)}/versions?per_page=100`,
    `versions ${packageName}`,
  );
  const versions: GhcrPackageVersion[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const parsed = parseGhcrVersion(row as Record<string, unknown>);
    if (parsed) versions.push(parsed);
  }
  return versions;
}

async function deleteGhcrVersion(
  http: GhcrHttp,
  kind: OwnerKind,
  owner: string,
  packageName: string,
  versionId: number,
): Promise<void> {
  const url = `${GHCR_API}/${kind}/${owner}/packages/container/${packagePath(packageName)}/versions/${versionId}`;
  const res = await http.request(url, { method: "DELETE" });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `GHCR DELETE version ${packageName}#${versionId} HTTP ${res.status} — ` +
        `scope delete:packages requis. GC refusé (fail-closed).`,
    );
  }
  if (!(res.ok || res.status === 204)) {
    throw new Error(
      `GHCR DELETE version ${packageName}#${versionId} HTTP ${res.status}`,
    );
  }
}

export async function runGhcrGc(opts: GhcrGcOpts): Promise<GhcrGcResult> {
  const log = opts.log || ((line) => console.log(line));
  if (!Number.isFinite(opts.keep) || opts.keep < 1) {
    throw new Error(`--keep invalide (${opts.keep}) — entier ≥ 1 requis`);
  }
  const keep = Math.floor(opts.keep);
  const env = opts.env || process.env;
  const token =
    (opts.token || "").trim() ||
    resolveGhcrToken(env, opts.tokenFiles || defaultGhcrTokenFiles(env));
  const http = opts.ghHttp || createGhcrHttp(token);
  const target = parseGhcrRegistry(opts.registry);
  const kind = await detectOwnerKind(http, target.owner);
  const packageName = opts.packageName || target.packageName;
  const packages = packageName
    ? [packageName]
    : await listGhcrPackages(http, kind, target.owner);

  const referenced = { tags: new Set<string>(), digests: new Set<string>() };
  const inUse = { tags: new Set<string>(), digests: new Set<string>() };

  const docker = opts.docker || createDefaultRegistryDocker();
  if (docker.available()) {
    const keys = collectInUseKeys(docker.listInUseImages());
    for (const t of keys.tags) inUse.tags.add(t);
    for (const d of keys.digests) inUse.digests.add(d);
  } else {
    log("  ⚠ docker absent — tags in-use non vérifiés (servers.json reste protégé)");
  }

  for (const file of [...new Set(opts.serversFiles || [])]) {
    const refs = serversFileImageRefs(file);
    if (refs === null) {
      log(`  servers.json absent (${file}) — aucune instance à protéger`);
      continue;
    }
    const keys = collectInUseKeys(refs.map((ref) => ({ ref })));
    for (const t of keys.tags) referenced.tags.add(t);
    for (const d of keys.digests) referenced.digests.add(d);
    log(`  servers.json ${file} : ${refs.length} réf(s) image protégée(s)`);
  }
  if (opts.adminApp) {
    const adminHttp = opts.adminHttp || createDefaultRegistryHttp();
    const releases = await fetchFleetReleaseRefs(adminHttp, opts.adminApp);
    const keys = collectReleaseKeys(releases);
    for (const t of keys.tags) referenced.tags.add(t);
    for (const d of keys.digests) referenced.digests.add(d);
    log(
      `  releases fleet (${opts.adminApp}) : ${releases.length} release(s) protégée(s)`,
    );
  }

  const extra = new Set(opts.extraProtectTags || []);
  const result: GhcrGcResult = {
    dryRun: opts.dryRun,
    keep,
    registry: opts.registry,
    owner: target.owner,
    packages,
    kept: [],
    deleted: [],
  };

  log(
    `${opts.dryRun ? "[dry-run] " : ""}GHCR ${opts.registry} keep=${keep} ` +
      `semver≥${GHCR_SEMVER_KEEP_MIN} owner=${target.owner}`,
  );

  for (const name of packages) {
    const versions = await listGhcrVersions(http, kind, target.owner, name);
    const pkgInUse = protectTagsForPackage(name, target.owner, inUse.tags);
    const pkgRef = protectTagsForPackage(name, target.owner, referenced.tags);
    for (const t of extra) pkgRef.add(t);
    const plan = planGhcrPackageGc({
      packageName: name,
      versions,
      keep,
      inUseTags: pkgInUse,
      referencedTags: pkgRef,
      inUseDigests: inUse.digests,
      referencedDigests: referenced.digests,
    });
    log(`  ${name}: ${versions.length} version(s)`);
    for (const k of plan.keep) {
      result.kept.push({
        packageName: name,
        id: k.id,
        tags: k.tags,
        reason: k.reason || "recent",
      });
      log(
        `    KEEP   #${k.id} [${k.tags.join(", ") || "(untagged)"}] (${k.reason})`,
      );
    }
    for (const d of plan.delete) {
      log(`    DELETE #${d.id} [${d.tags.join(", ")}] ${d.digest}`);
      if (opts.dryRun) continue;
      await deleteGhcrVersion(http, kind, target.owner, name, d.id);
      result.deleted.push({
        packageName: name,
        id: d.id,
        tags: d.tags,
        digest: d.digest,
      });
      log(`✓ version GHCR supprimée ${name}#${d.id}`);
    }
  }

  if (opts.dryRun) {
    const n = result.kept.length;
    log(
      `[dry-run] plan GHCR : ${n} version(s) conservée(s) — aucune mutation ` +
        `(exécuter : --apply)`,
    );
  }
  return result;
}

export async function runGhcrGcCommand(
  args: RegistryGcArgs,
  env: NodeJS.ProcessEnv = process.env,
  overrides: Pick<GhcrGcOpts, "ghHttp" | "adminHttp" | "docker" | "log" | "token"> = {},
): Promise<GhcrGcResult> {
  if (args.apply && args.dryRun) {
    throw new Error(
      "--apply et --dry-run sont exclusifs — dry-run est déjà le défaut",
    );
  }
  const docker = overrides.docker || createDefaultRegistryDocker();
  const registry =
    args.registry ||
    (env.CREEZIO_REGISTRY || "").trim() ||
    "";
  if (!isGhcrRegistry(registry)) {
    throw new Error(
      `registre GHCR attendu (ghcr.io/<owner>) — reçu '${registry || "(vide)"}'`,
    );
  }
  return runGhcrGc({
    registry,
    keep: resolveRegistryGcKeep(args, env),
    dryRun: !args.apply,
    packageName: args.repo,
    serversFiles: resolveRegistryGcServersFiles(args, docker, env),
    adminApp:
      (args.adminApp || "").trim() ||
      (env.CREEZIO_FLEET_ADMIN_URL || "").trim() ||
      undefined,
    token: overrides.token,
    tokenFiles: defaultGhcrTokenFiles(env, args.brandRoot),
    env,
    docker,
    ghHttp: overrides.ghHttp,
    adminHttp: overrides.adminHttp,
    log: overrides.log,
  });
}

/** Rétention post-publish — fail-closed (auth / API), pas un skip silencieux. */
export async function runGhcrPublishRetention(opts: {
  registry: string;
  repo: string;
  justPushedTag: string;
  keepTags: number;
  brandRoot?: string;
  env: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  ghHttp?: GhcrHttp;
  docker?: RegistryGcDocker;
  token?: string;
}): Promise<GhcrGcResult> {
  const serversFiles = opts.brandRoot
    ? [path.join(opts.brandRoot, "docker-data", "servers.json")]
    : [];
  return runGhcrGc({
    registry: opts.registry,
    keep: opts.keepTags,
    dryRun: false,
    packageName: opts.repo,
    serversFiles,
    extraProtectTags: [opts.justPushedTag],
    token: opts.token,
    tokenFiles: defaultGhcrTokenFiles(opts.env, opts.brandRoot),
    env: opts.env,
    ghHttp: opts.ghHttp,
    docker: opts.docker,
    log: opts.log || ((line) => console.log(line)),
  });
}
