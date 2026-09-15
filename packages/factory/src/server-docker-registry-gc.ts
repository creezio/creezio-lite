/**
 * GC fail-closed du registre Docker local (`registry:2`, `127.0.0.1:5000`).
 *
 * Geste : `creezio server-docker registry-gc`
 *   1. catalogue + tags via API Distribution v2 ;
 *   2. rétention `--keep N` (défaut 2) **par famille** : tags `auto.*`
 *      d'un côté, tags **semver** de l'autre (fenêtre indépendante et plus
 *      large : au moins les 3 derniers — `REGISTRY_SEMVER_KEEP_MIN`). Une
 *      rafale d'`auto.*` n'évince jamais un semver. Tags PROTÉGÉS : jamais
 *      le tag en usage (docker ps) ni celui référencé par
 *      `docker-data/servers.json` (instances, même arrêtées) ni les
 *      releases fleet de l'app admin ;
 *   3. DELETE des manifests non retenus (jamais un tag en usage/référencé) ;
 *   4. `registry garbage-collect` dans le container (`docker exec`).
 *
 * DRY-RUN PAR DÉFAUT : plan uniquement, zéro mutation — `--apply` exécute.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const REGISTRY_GC_KEEP_DEFAULT = 2;
/** Plancher indépendant pour les tags semver (rollback registre). */
export const REGISTRY_SEMVER_KEEP_MIN = 3;
export const REGISTRY_GC_DEFAULT_HOST = "127.0.0.1:5000";
export const REGISTRY_GC_DEFAULT_CONTAINER = "creezio-registry";
export const REGISTRY_GC_CONFIG = "/etc/docker/registry/config.yml";

export const REGISTRY_TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Tags auto-publiés par la CI (`auto.YYYYMMDDHHMM.<sha>`). */
export const REGISTRY_AUTO_TAG_RE = /^auto\./;
/** Tags semver (`0.24.1`, `0.24.1-rc1`) — fenêtre de rétention dédiée. */
export const REGISTRY_SEMVER_TAG_RE = /^\d+\.\d+\.\d+(?:[.+-].*)?$/;

export type RegistryTagFamily = "auto" | "semver" | "other";

export function registryTagFamily(tag: string): RegistryTagFamily {
  if (REGISTRY_AUTO_TAG_RE.test(tag)) return "auto";
  if (REGISTRY_SEMVER_TAG_RE.test(tag)) return "semver";
  return "other";
}

/** `--keep N` pour les semver : max(N, 3) — jamais moins large que le plancher. */
export function resolveSemverKeep(keep: number): number {
  if (!Number.isFinite(keep) || keep < 1) {
    throw new Error(`--keep invalide (${keep}) — entier ≥ 1 requis`);
  }
  return Math.max(Math.floor(keep), REGISTRY_SEMVER_KEEP_MIN);
}

const MANIFEST_ACCEPT =
  "application/vnd.docker.distribution.manifest.v2+json, " +
  "application/vnd.oci.image.manifest.v1+json, " +
  "application/vnd.oci.image.index.v1+json, " +
  "application/vnd.docker.distribution.manifest.list.v2+json";

export type RegistryGcHttpResponse = {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
};

export type RegistryGcHttp = {
  request(url: string, init?: RequestInit): Promise<RegistryGcHttpResponse>;
};

export type InUseImage = {
  ref: string;
  digest?: string;
};

export type RegistryGcDocker = {
  available(): boolean;
  listInUseImages(): InUseImage[];
  containerRunning(name: string): boolean;
  garbageCollect(
    container: string,
    configPath: string,
  ): { status: number; stdout: string; stderr: string };
  /**
   * Brand roots découverts via les labels `creezio.brand-root` de TOUS les
   * conteneurs (`docker ps -a`) — pour charger les `docker-data/servers.json`
   * même quand une instance est arrêtée. Optionnel (mocks de tests).
   */
  listBrandRoots?(): string[];
};

export type ParsedImageRef = {
  host: string;
  repo: string;
  tag: string;
  digest?: string;
};

export type TagInfo = { tag: string; digest: string };

export type RepoGcKeepReason = "recent" | "in-use" | "referenced";

/** Release fleet lue depuis l'app admin (module fleet-releases). */
export type FleetReleaseRef = {
  brandId?: string;
  tag?: string;
  image?: string;
  digest?: string | null;
  variant?: string;
  status?: string;
};

export type RepoGcPlan = {
  repo: string;
  keep: Array<{ tag: string; digest: string; reason: RepoGcKeepReason }>;
  delete: Array<{ tag: string; digest: string }>;
  skipShared: Array<{ tag: string; digest: string }>;
};

export type RegistryGcResult = {
  dryRun: boolean;
  keep: number;
  registry: string;
  container: string;
  repos: string[];
  kept: Array<{ repo: string; tag: string; reason: RepoGcKeepReason }>;
  deleted: Array<{ repo: string; tag: string; digest: string }>;
  skippedShared: Array<{ repo: string; tag: string; digest: string }>;
  gcRan: boolean;
};

export type RegistryGcArgs = {
  registry?: string;
  keepTags?: number;
  /** Exécuter les mutations (défaut : dry-run, plan uniquement). */
  apply?: boolean;
  /** Dry-run explicite — exclusif avec `--apply`. */
  dryRun?: boolean;
  container?: string;
  repo?: string;
  /** Charge `<brandRoot>/docker-data/servers.json` (tags protégés). */
  brandRoot?: string;
  /** App admin (module fleet-releases) — releases protégées. */
  adminApp?: string;
};

export type RegistryGcOpts = {
  registry: string;
  keep: number;
  dryRun: boolean;
  container: string;
  repo?: string;
  /**
   * Fichiers `docker-data/servers.json` à protéger (image du registre +
   * image de chaque instance, même arrêtée). Un fichier ILLISIBLE (JSON
   * invalide) = erreur fail-closed ; un fichier absent = ignoré (loggé).
   */
  serversFiles?: string[];
  /**
   * URL de l'app admin (module fleet-releases). Si posée, les releases
   * déclarées (tous statuts) sont protégées — admin injoignable = erreur
   * fail-closed, jamais de GC « en aveugle ».
   */
  adminApp?: string;
  http?: RegistryGcHttp;
  docker?: RegistryGcDocker;
  log?: (line: string) => void;
};

/**
 * Compare deux tags version segment par segment (0.3.10 > 0.3.9 > 0.3.9-rc1).
 * Segments numériques comparés en nombre, sinon lexicographique.
 */
export function compareVersionTags(a: string, b: string): number {
  const pa = a.split(/[.\-_]/);
  const pb = b.split(/[.\-_]/);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const sa = pa[i] ?? "";
    const sb = pb[i] ?? "";
    const na = /^\d+$/.test(sa) ? Number(sa) : NaN;
    const nb = /^\d+$/.test(sb) ? Number(sb) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else if (sa !== sb) {
      return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

/** Les `n` plus anciens d'une famille (tri version) — candidats à la purge. */
function oldestBeyondKeep(tags: string[], keep: number): string[] {
  const sorted = [...tags].sort(compareVersionTags);
  const n = Math.floor(keep);
  return n >= sorted.length ? [] : sorted.slice(0, sorted.length - n);
}

/**
 * Tags à supprimer : rétention **par famille**.
 *   - `auto.*` : les `keep` plus récents (défaut 2) ;
 *   - semver : fenêtre indépendante `max(keep, 3)` — une rafale d'auto
 *     n'évince jamais un semver ;
 *   - autres (`latest`, …) : même `keep` que les auto.
 * `protect` = tags jamais évincés (in-use, servers.json, just-pushed).
 */
export function selectTagsToPrune(
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
    const family = registryTagFamily(t);
    if (family === "auto") auto.push(t);
    else if (family === "semver") semver.push(t);
    else other.push(t);
  }
  return [
    ...oldestBeyondKeep(auto, Math.floor(keep)),
    ...oldestBeyondKeep(semver, resolveSemverKeep(keep)),
    ...oldestBeyondKeep(other, Math.floor(keep)),
  ].filter((t) => !protectSet.has(t));
}

export function registryBaseUrl(registry: string): string {
  const raw = (registry || "").trim().replace(/\/+$/, "");
  if (!raw) {
    throw new Error(
      `registre invalide — attendu ${REGISTRY_GC_DEFAULT_HOST}`,
    );
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  return `http://${raw}`;
}

export function parseImageRef(ref: string): ParsedImageRef | null {
  const raw = (ref || "").trim();
  if (!raw || raw === "<none>") return null;
  if (/^sha256:[0-9a-f]{64}$/i.test(raw)) {
    return { host: "", repo: "", tag: "", digest: raw.toLowerCase() };
  }
  let digest: string | undefined;
  let rest = raw;
  const at = raw.lastIndexOf("@");
  if (at > 0) {
    digest = raw.slice(at + 1).toLowerCase();
    rest = raw.slice(0, at);
  }
  let tag = "latest";
  const lastColon = rest.lastIndexOf(":");
  const lastSlash = rest.lastIndexOf("/");
  if (lastColon > lastSlash) {
    tag = rest.slice(lastColon + 1);
    rest = rest.slice(0, lastColon);
  }
  if (!rest) return digest ? { host: "", repo: "", tag: "", digest } : null;
  const first = rest.split("/")[0] || "";
  const hasHost =
    first.includes(".") || first.includes(":") || first === "localhost";
  if (hasHost) {
    const repo = rest.slice(first.length + 1);
    if (!repo && !digest) return null;
    return { host: first, repo, tag, digest };
  }
  return { host: "", repo: rest, tag, digest };
}

export function collectInUseKeys(images: InUseImage[]): {
  tags: Set<string>;
  digests: Set<string>;
} {
  const tags = new Set<string>();
  const digests = new Set<string>();
  for (const img of images) {
    if (img.digest && img.digest.startsWith("sha256:")) {
      digests.add(img.digest.toLowerCase());
    }
    const parsed = parseImageRef(img.ref);
    if (!parsed) continue;
    if (parsed.digest && parsed.digest.startsWith("sha256:")) {
      digests.add(parsed.digest);
    }
    if (parsed.repo && parsed.tag) {
      tags.add(`${parsed.repo}:${parsed.tag}`);
    }
  }
  return { tags, digests };
}

/**
 * Réfs image d'un `docker-data/servers.json` : `image` du registre + `image`
 * de CHAQUE instance déclarée (une instance arrêtée reste protégée).
 * Fichier absent → `null` (l'appelant logge) ; JSON invalide → erreur
 * fail-closed (on ne GC jamais avec une SoT illisible).
 */
export function serversFileImageRefs(file: string): string[] | null {
  if (!fs.existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(
      `servers.json illisible (${file}) — ${why} ; GC refusé (fail-closed)`,
    );
  }
  const reg = raw as {
    image?: unknown;
    instances?: Array<{ image?: unknown }>;
  } | null;
  const refs: string[] = [];
  if (reg && typeof reg.image === "string" && reg.image.trim()) {
    refs.push(reg.image.trim());
  }
  for (const inst of reg?.instances || []) {
    if (inst && typeof inst.image === "string" && inst.image.trim()) {
      refs.push(inst.image.trim());
    }
  }
  return refs;
}

/**
 * Releases fleet déclarées dans l'app admin (module fleet-releases) —
 * `GET /api/v1/modules/fleet-releases/releases`. TOUS les statuts sont
 * protégés (un draft peut passer rolling à tout moment). Admin injoignable
 * ou réponse invalide = erreur fail-closed.
 */
export async function fetchFleetReleaseRefs(
  http: RegistryGcHttp,
  adminApp: string,
): Promise<FleetReleaseRef[]> {
  const base = adminApp.trim().replace(/\/+$/, "");
  const url = `${base}/api/v1/modules/fleet-releases/releases`;
  const res = await http.request(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(
      `releases fleet illisibles (${url} HTTP ${res.status}) — GC refusé (fail-closed)`,
    );
  }
  const body = (await res.json()) as {
    ok?: boolean;
    releases?: Array<Record<string, unknown>>;
  };
  if (!body || body.ok !== true || !Array.isArray(body.releases)) {
    throw new Error(
      `releases fleet : réponse invalide (${url}) — GC refusé (fail-closed)`,
    );
  }
  return body.releases.map((r) => ({
    brandId: typeof r.brand_id === "string" ? r.brand_id : undefined,
    tag: typeof r.tag === "string" ? r.tag : undefined,
    image: typeof r.image === "string" ? r.image : undefined,
    digest: typeof r.digest === "string" ? r.digest : undefined,
    variant: typeof r.variant === "string" ? r.variant : undefined,
    status: typeof r.status === "string" ? r.status : undefined,
  }));
}

/** Clés protégées (repo:tag + digests) dérivées des releases fleet. */
export function collectReleaseKeys(releases: FleetReleaseRef[]): {
  tags: Set<string>;
  digests: Set<string>;
} {
  const tags = new Set<string>();
  const digests = new Set<string>();
  for (const rel of releases) {
    if (rel.digest && /^sha256:[0-9a-f]{64}$/i.test(rel.digest)) {
      digests.add(rel.digest.toLowerCase());
    }
    const parsed = rel.image ? parseImageRef(rel.image) : null;
    if (parsed?.repo && parsed.tag) tags.add(`${parsed.repo}:${parsed.tag}`);
    if (parsed?.digest) digests.add(parsed.digest);
    // Ceinture + bretelles : la convention de nommage publish reste
    // protégée même si `image` pointe l'hôte public (registry.{zone}/…).
    if (rel.brandId && rel.tag) {
      const suffix = rel.variant === "browser" ? "-browser" : "";
      tags.add(`creezio-server-${rel.brandId}${suffix}:${rel.tag}`);
    }
  }
  return { tags, digests };
}

export function planRepoGc(opts: {
  repo: string;
  tags: TagInfo[];
  keep: number;
  inUseTags: Set<string>;
  inUseDigests: Set<string>;
  /** Tags/digests référencés (servers.json, releases fleet) — jamais supprimés. */
  referencedTags?: Set<string>;
  referencedDigests?: Set<string>;
}): RepoGcPlan {
  const { repo, keep } = opts;
  if (!Number.isFinite(keep) || keep < 1) {
    throw new Error(`--keep invalide (${keep}) — entier ≥ 1 requis`);
  }
  const unique = new Map<string, TagInfo>();
  for (const t of opts.tags) {
    if (!t.tag || !REGISTRY_TAG_RE.test(t.tag)) continue;
    unique.set(t.tag, t);
  }
  const list = [...unique.values()];
  // Rétention PAR FAMILLE : les N derniers `auto.*` (CI) ET les
  // max(N, 3) derniers semver — une rafale d'auto-publish n'évince
  // jamais la fenêtre de rollback semver. Les tags protégés
  // (in-use / servers.json / releases) s'ajoutent par-dessus.
  const lastOf = (tags: string[], n: number): string[] =>
    [...tags].sort(compareVersionTags).slice(-Math.floor(n));
  const autoKeep = Math.floor(keep);
  const semverKeep = resolveSemverKeep(keep);
  const recent = new Set([
    ...lastOf(
      list.map((t) => t.tag).filter((t) => registryTagFamily(t) === "auto"),
      autoKeep,
    ),
    ...lastOf(
      list.map((t) => t.tag).filter((t) => registryTagFamily(t) === "semver"),
      semverKeep,
    ),
    ...lastOf(
      list.map((t) => t.tag).filter((t) => registryTagFamily(t) === "other"),
      autoKeep,
    ),
  ]);
  const referencedTags = opts.referencedTags || new Set<string>();
  const referencedDigests = opts.referencedDigests || new Set<string>();
  const keepItems: RepoGcPlan["keep"] = [];
  const candidates: TagInfo[] = [];
  for (const t of list) {
    const inUse =
      opts.inUseTags.has(`${repo}:${t.tag}`) ||
      opts.inUseDigests.has(t.digest.toLowerCase());
    const referenced =
      referencedTags.has(`${repo}:${t.tag}`) ||
      referencedDigests.has(t.digest.toLowerCase());
    if (inUse) {
      keepItems.push({ ...t, reason: "in-use" });
    } else if (referenced) {
      keepItems.push({ ...t, reason: "referenced" });
    } else if (recent.has(t.tag)) {
      keepItems.push({ ...t, reason: "recent" });
    } else {
      candidates.push(t);
    }
  }
  const keptDigests = new Set(
    keepItems.map((k) => k.digest.toLowerCase()).filter(Boolean),
  );
  const del: TagInfo[] = [];
  const skipShared: TagInfo[] = [];
  for (const t of candidates) {
    if (t.digest && keptDigests.has(t.digest.toLowerCase())) {
      skipShared.push(t);
    } else {
      del.push(t);
    }
  }
  return { repo, keep: keepItems, delete: del, skipShared };
}

export function resolveRegistryGcKeep(
  args: { keepTags?: number },
  env: NodeJS.ProcessEnv = process.env,
): number {
  const candidates = [
    args.keepTags,
    Number((env.CREEZIO_REGISTRY_GC_KEEP || "").trim()),
    Number((env.CREEZIO_PUBLISH_KEEP_TAGS || "").trim()),
  ];
  for (const raw of candidates) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
      return Math.floor(raw);
    }
  }
  return REGISTRY_GC_KEEP_DEFAULT;
}

export function createDefaultRegistryHttp(): RegistryGcHttp {
  return {
    async request(url, init) {
      let res: Response;
      try {
        res = await fetch(url, init);
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        throw new Error(`registre injoignable (${url}) — ${why}`);
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

function inspectJson(argv: string[]): unknown {
  const r = spawnSync("docker", argv, { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(
      `docker ${argv[0]} KO : ${(r.stderr || r.stdout || "").trim() || "échec"}`,
    );
  }
  try {
    return JSON.parse(r.stdout || "null");
  } catch {
    throw new Error(`docker ${argv[0]} : JSON invalide`);
  }
}

export function createDefaultRegistryDocker(): RegistryGcDocker {
  return {
    available() {
      const r = spawnSync("docker", ["--version"], { encoding: "utf8" });
      return r.status === 0;
    },
    listInUseImages() {
      const ps = spawnSync("docker", ["ps", "-q"], { encoding: "utf8" });
      if (ps.status !== 0) {
        throw new Error(
          `docker ps KO : ${(ps.stderr || "").trim() || "docker absent"}`,
        );
      }
      const ids = (ps.stdout || "").trim().split(/\s+/).filter(Boolean);
      if (!ids.length) return [];
      const containers = inspectJson(["inspect", ...ids]) as Array<{
        Config?: { Image?: string };
        Image?: string;
      }>;
      const out: InUseImage[] = [];
      const imageIds = new Set<string>();
      for (const c of containers) {
        if (c.Config?.Image) out.push({ ref: c.Config.Image });
        if (c.Image) imageIds.add(c.Image);
      }
      if (imageIds.size) {
        const images = inspectJson(["inspect", ...imageIds]) as Array<{
          RepoTags?: string[];
          RepoDigests?: string[];
          Id?: string;
        }>;
        for (const img of images) {
          for (const t of img.RepoTags || []) out.push({ ref: t });
          for (const d of img.RepoDigests || []) {
            const parsed = parseImageRef(d);
            out.push({
              ref: d,
              digest: parsed?.digest,
            });
          }
        }
      }
      return out;
    },
    listBrandRoots() {
      // Labels `creezio.brand-root` de TOUS les conteneurs (même arrêtés) :
      // chaque brand root porte un docker-data/servers.json à protéger.
      const r = spawnSync(
        "docker",
        ["ps", "-a", "--format", '{{.Label "creezio.brand-root"}}'],
        { encoding: "utf8" },
      );
      if (r.status !== 0) {
        throw new Error(
          `docker ps -a KO : ${(r.stderr || "").trim() || "docker absent"}`,
        );
      }
      return [
        ...new Set(
          (r.stdout || "")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
        ),
      ];
    },
    containerRunning(name) {
      const r = spawnSync(
        "docker",
        ["inspect", "-f", "{{.State.Running}}", name],
        { encoding: "utf8" },
      );
      return r.status === 0 && (r.stdout || "").trim() === "true";
    },
    garbageCollect(container, configPath) {
      const r = spawnSync(
        "docker",
        ["exec", container, "registry", "garbage-collect", configPath],
        { encoding: "utf8" },
      );
      return {
        status: r.status ?? 1,
        stdout: r.stdout || "",
        stderr: r.stderr || "",
      };
    },
  };
}

async function registryGetJson(
  http: RegistryGcHttp,
  url: string,
  what: string,
): Promise<unknown> {
  const res = await http.request(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`${what} : HTTP ${res.status} (${url})`);
  }
  return res.json();
}

async function listCatalog(
  http: RegistryGcHttp,
  base: string,
): Promise<string[]> {
  const repos: string[] = [];
  let url = `${base}/v2/_catalog?n=1000`;
  for (let i = 0; i < 50; i++) {
    const res = await http.request(url, { method: "GET" });
    if (!res.ok) {
      throw new Error(`catalogue registre : HTTP ${res.status} (${url})`);
    }
    const body = (await res.json()) as { repositories?: string[] };
    for (const r of body.repositories || []) {
      if (r) repos.push(r);
    }
    const link = res.headers.get("link") || res.headers.get("Link") || "";
    const next = link.match(/<([^>]+)>\s*;\s*rel="next"/i);
    if (!next) break;
    const href = next[1]!;
    url = href.startsWith("http") ? href : `${base}${href}`;
  }
  return repos;
}

async function listTags(
  http: RegistryGcHttp,
  base: string,
  repo: string,
): Promise<string[]> {
  const body = (await registryGetJson(
    http,
    `${base}/v2/${repo}/tags/list`,
    `tags ${repo}`,
  )) as { tags?: string[] | null };
  return (body.tags || []).filter((t) => typeof t === "string" && REGISTRY_TAG_RE.test(t));
}

async function manifestDigest(
  http: RegistryGcHttp,
  base: string,
  repo: string,
  ref: string,
): Promise<string> {
  const res = await http.request(`${base}/v2/${repo}/manifests/${ref}`, {
    method: "HEAD",
    headers: { accept: MANIFEST_ACCEPT },
  });
  if (!res.ok) {
    throw new Error(
      `digest introuvable pour ${repo}:${ref} (HTTP ${res.status})`,
    );
  }
  const digest = (res.headers.get("docker-content-digest") || "").trim();
  if (!digest) {
    throw new Error(
      `digest introuvable pour ${repo}:${ref} (header Docker-Content-Digest absent)`,
    );
  }
  return digest;
}

async function deleteManifest(
  http: RegistryGcHttp,
  base: string,
  repo: string,
  tag: string,
  digest: string,
): Promise<void> {
  const res = await http.request(`${base}/v2/${repo}/manifests/${digest}`, {
    method: "DELETE",
  });
  if (res.ok || res.status === 202) return;
  const hint =
    res.status === 405
      ? " — REGISTRY_STORAGE_DELETE_ENABLED=true requis"
      : "";
  throw new Error(
    `DELETE manifeste KO ${repo}:${tag} (${digest}) HTTP ${res.status}${hint}`,
  );
}

export async function runRegistryGc(
  opts: RegistryGcOpts,
): Promise<RegistryGcResult> {
  const log = opts.log || ((line) => console.log(line));
  if (!Number.isFinite(opts.keep) || opts.keep < 1) {
    throw new Error(`--keep invalide (${opts.keep}) — entier ≥ 1 requis`);
  }
  const keep = Math.floor(opts.keep);
  const docker = opts.docker || createDefaultRegistryDocker();
  const http = opts.http || createDefaultRegistryHttp();
  if (!docker.available()) {
    throw new Error(
      "docker introuvable — installer Docker Engine (requis pour docker ps / exec)",
    );
  }

  const base = registryBaseUrl(opts.registry);
  const ping = await http.request(`${base}/v2/`, { method: "GET" });
  if (!ping.ok) {
    throw new Error(
      `registre down (${base}/v2/ HTTP ${ping.status}) — container ${opts.container} démarré ?`,
    );
  }

  const repos = opts.repo
    ? [opts.repo]
    : await listCatalog(http, base);

  const inUse = collectInUseKeys(docker.listInUseImages());

  // Tags PROTÉGÉS (jamais supprimés, même hors fenêtre de rétention) :
  // 1. docker-data/servers.json — image du registre + image de chaque
  //    instance déclarée (une instance ARRÊTÉE reste protégée) ;
  // 2. releases fleet déclarées dans l'app admin (tous statuts).
  const referenced = { tags: new Set<string>(), digests: new Set<string>() };
  const serversFiles = [...new Set(opts.serversFiles || [])];
  for (const file of serversFiles) {
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
    const releases = await fetchFleetReleaseRefs(http, opts.adminApp);
    const keys = collectReleaseKeys(releases);
    for (const t of keys.tags) referenced.tags.add(t);
    for (const d of keys.digests) referenced.digests.add(d);
    log(
      `  releases fleet (${opts.adminApp}) : ${releases.length} release(s) protégée(s)`,
    );
  } else {
    log(
      "  ⚠ pas d'app admin (--admin-app / CREEZIO_FLEET_ADMIN_URL) — releases fleet non vérifiées",
    );
  }

  const result: RegistryGcResult = {
    dryRun: opts.dryRun,
    keep,
    registry: base,
    container: opts.container,
    repos,
    kept: [],
    deleted: [],
    skippedShared: [],
    gcRan: false,
  };

  log(
    `${opts.dryRun ? "[dry-run] " : ""}registre ${base} keep=${keep} container=${opts.container}`,
  );

  const toDelete: Array<{ repo: string; tag: string; digest: string }> = [];

  for (const repo of repos) {
    const tags = await listTags(http, base, repo);
    const infos: TagInfo[] = [];
    for (const tag of tags) {
      infos.push({
        tag,
        digest: await manifestDigest(http, base, repo, tag),
      });
    }
    const plan = planRepoGc({
      repo,
      tags: infos,
      keep,
      inUseTags: inUse.tags,
      inUseDigests: inUse.digests,
      referencedTags: referenced.tags,
      referencedDigests: referenced.digests,
    });
    log(`  ${repo}: ${infos.length} tag(s)`);
    const keepWhy: Record<RepoGcKeepReason, string> = {
      "in-use": "conteneur en cours",
      referenced: "référencé (servers.json / release fleet)",
      recent: "récent",
    };
    for (const k of plan.keep) {
      result.kept.push({ repo, tag: k.tag, reason: k.reason });
      log(`    KEEP   ${k.tag} (${keepWhy[k.reason]})`);
    }
    for (const s of plan.skipShared) {
      result.skippedShared.push({ repo, tag: s.tag, digest: s.digest });
      log(
        `    SKIP   ${s.tag} (digest partagé avec un tag conservé)`,
      );
    }
    for (const d of plan.delete) {
      toDelete.push({ repo, tag: d.tag, digest: d.digest });
      log(`    DELETE ${d.tag} ${d.digest}`);
    }
  }

  if (opts.dryRun) {
    log(
      `[dry-run] ${toDelete.length} manifeste(s) seraient supprimé(s) — aucune mutation, garbage-collect non lancé (exécuter : --apply)`,
    );
    return result;
  }

  for (const d of toDelete) {
    await deleteManifest(http, base, d.repo, d.tag, d.digest);
    result.deleted.push(d);
    log(`✓ tag supprimé ${d.repo}:${d.tag}`);
  }

  if (!docker.containerRunning(opts.container)) {
    throw new Error(
      `container registry '${opts.container}' absent ou arrêté — garbage-collect impossible`,
    );
  }
  const gc = docker.garbageCollect(opts.container, REGISTRY_GC_CONFIG);
  if (gc.status !== 0) {
    throw new Error(
      `garbage-collect KO dans ${opts.container} (exit ${gc.status}) : ${(gc.stderr || gc.stdout || "").trim() || "échec"}`,
    );
  }
  result.gcRan = true;
  const gcTail = (gc.stdout || "").trim().split("\n").slice(-3).join(" | ");
  log(`✓ garbage-collect ${opts.container}${gcTail ? ` — ${gcTail}` : ""}`);
  return result;
}

/**
 * Fichiers `servers.json` à protéger : `--brand-root` explicite + découverte
 * automatique via les labels `creezio.brand-root` des conteneurs.
 */
export function resolveRegistryGcServersFiles(
  args: { brandRoot?: string },
  docker: RegistryGcDocker,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const roots = new Set<string>();
  const explicit = (args.brandRoot || (env.BRAND_ROOT || "").trim() || "").trim();
  if (explicit) roots.add(path.resolve(explicit));
  // Découverte via docker seulement si le daemon répond — sinon on laisse
  // runRegistryGc échouer avec son erreur canonique « docker introuvable ».
  if (docker.listBrandRoots && docker.available()) {
    for (const root of docker.listBrandRoots()) {
      if (root) roots.add(path.resolve(root));
    }
  }
  return [...roots].map((root) => path.join(root, "docker-data", "servers.json"));
}

export async function runRegistryGcCommand(
  args: RegistryGcArgs,
  env: NodeJS.ProcessEnv = process.env,
  overrides: Pick<RegistryGcOpts, "http" | "docker" | "log"> = {},
): Promise<RegistryGcResult> {
  if (args.apply && args.dryRun) {
    throw new Error(
      "--apply et --dry-run sont exclusifs — dry-run est déjà le défaut",
    );
  }
  const docker = overrides.docker || createDefaultRegistryDocker();
  return runRegistryGc({
    registry:
      args.registry ||
      (env.CREEZIO_REGISTRY || "").trim() ||
      REGISTRY_GC_DEFAULT_HOST,
    keep: resolveRegistryGcKeep(args, env),
    // DRY-RUN PAR DÉFAUT : seul `--apply` mute (delete + garbage-collect).
    dryRun: !args.apply,
    container:
      args.container ||
      (env.CREEZIO_REGISTRY_CONTAINER || "").trim() ||
      REGISTRY_GC_DEFAULT_CONTAINER,
    repo: args.repo,
    serversFiles: resolveRegistryGcServersFiles(args, docker, env),
    adminApp:
      (args.adminApp || "").trim() ||
      (env.CREEZIO_FLEET_ADMIN_URL || "").trim() ||
      undefined,
    docker,
    http: overrides.http,
    log: overrides.log,
  });
}
