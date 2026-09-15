/**
 * Garde anti-doublon des PR de bump kit (`scripts/propagate-brands.mjs`).
 *
 * `git ls-remote` sur `creezio/kit-bump-<ver>` ne suffit pas : après merge
 * la branche disparaît et un second run rouvre une PR (vécu TF3 #73 après
 * #72). Avant d'ouvrir : GET les PR ouvertes (même titre / même head /
 * package.json déjà au pin) + pin de `main`. POST /pulls HTTP 422 = skip.
 */
export const CREEZIO_PIN_PACKAGE = "@creezio/platform-core";

export function bumpBranchName(version) {
  return `creezio/kit-bump-${version}`;
}

export function bumpPrTitle(version, brandId) {
  return `chore(deps): bump @creezio/* → ${version} [${brandId}]`;
}

export function pinSpec(version) {
  return `^${version}`;
}

/** True si le manifest pinne déjà `@creezio/platform-core` à la version cible. */
export function manifestAtTargetPin(manifest, version) {
  if (!manifest || typeof manifest !== "object") return false;
  const want = new Set([`^${version}`, String(version)]);
  for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const spec = manifest[key]?.[CREEZIO_PIN_PACKAGE];
    if (typeof spec === "string" && want.has(spec)) return true;
  }
  return false;
}

export function decodeGithubFileContent(json) {
  if (!json || typeof json.content !== "string") return null;
  const raw = Buffer.from(json.content.replace(/\n/g, ""), "base64").toString("utf8");
  return JSON.parse(raw);
}

/**
 * Décision pure (pas d'I/O) — mockable en gate.
 * @returns {{ skip: true, reason: string } | { skip: false }}
 */
export function decidePropagateSkip(opts) {
  const {
    version,
    brandId,
    branch,
    defaultBranch = "main",
    openPrs = [],
    defaultBranchManifest = null,
    openPrManifests = [],
  } = opts;
  if (defaultBranchManifest && manifestAtTargetPin(defaultBranchManifest, version)) {
    return { skip: true, reason: `${defaultBranch} déjà au pin ${pinSpec(version)}` };
  }
  const title = bumpPrTitle(version, brandId);
  for (const pr of openPrs) {
    if ((pr.title || "") === title) {
      const where = pr.html_url || `#${pr.number ?? "?"}`;
      return { skip: true, reason: `PR ouverte (même titre) : ${where}` };
    }
    const head = pr.head?.ref || "";
    if (head === branch) {
      const where = pr.html_url || `#${pr.number ?? "?"}`;
      return { skip: true, reason: `PR ouverte (même head ${head}) : ${where}` };
    }
  }
  for (const entry of openPrManifests) {
    const pr = entry?.pr;
    const manifest = entry?.manifest;
    if (!pr || !manifestAtTargetPin(manifest, version)) continue;
    const where = pr.html_url || `#${pr.number ?? "?"}`;
    return { skip: true, reason: `PR #${pr.number ?? "?"} déjà au pin ${pinSpec(version)} : ${where}` };
  }
  return { skip: false };
}

export async function fetchRepoPackageJson(gh, repo, ref) {
  const url = `/repos/${repo}/contents/package.json?ref=${encodeURIComponent(ref)}`;
  const res = await gh.request("GET", url);
  if (res.status === 404) return null;
  if (res.status >= 400) {
    throw new Error(`GitHub GET package.json@${ref} → ${res.status}`);
  }
  try {
    return decodeGithubFileContent(res.json);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(`package.json@${ref} illisible — ${why}`);
  }
}

export async function listOpenPulls(gh, repo) {
  const prs = [];
  let url = `/repos/${repo}/pulls?state=open&per_page=100`;
  for (let page = 0; page < 5; page++) {
    const res = await gh.request("GET", url);
    if (res.status >= 400) {
      throw new Error(`GitHub GET /repos/${repo}/pulls → ${res.status}`);
    }
    const batch = Array.isArray(res.json) ? res.json : [];
    prs.push(...batch);
    const link = res.link || res.headers?.link || "";
    const next = String(link).match(/<([^>]+)>\s*;\s*rel="next"/i);
    if (!next || batch.length < 100) break;
    const href = next[1];
    url = href.startsWith("https://api.github.com")
      ? href.slice("https://api.github.com".length)
      : href;
  }
  return prs;
}

/**
 * GET PR ouvertes + package.json (default branch et heads) puis décide.
 * `gh.request(method, url)` → `{ status, json, link? }`.
 */
export async function evaluatePropagateGuard(gh, opts) {
  const openPrs = await listOpenPulls(gh, opts.repo);
  const defaultBranchManifest = await fetchRepoPackageJson(
    gh,
    opts.repo,
    opts.defaultBranch || "main",
  );
  const openPrManifests = [];
  for (const pr of openPrs) {
    const ref = pr.head?.ref;
    if (!ref) continue;
    const manifest = await fetchRepoPackageJson(gh, opts.repo, ref);
    if (manifest) openPrManifests.push({ pr, manifest });
  }
  return decidePropagateSkip({
    version: opts.version,
    brandId: opts.brandId,
    branch: opts.branch,
    defaultBranch: opts.defaultBranch,
    openPrs,
    defaultBranchManifest,
    openPrManifests,
  });
}

export function interpretCreatePullResponse(status, json) {
  if (status === 201 || (status === 200 && json?.html_url)) {
    return { kind: "created", url: String(json.html_url) };
  }
  if (status === 422) {
    const hint = JSON.stringify(json ?? {}).slice(0, 240);
    return { kind: "skip", reason: `PR déjà existante (HTTP 422)${hint ? ` — ${hint}` : ""}` };
  }
  return {
    kind: "error",
    reason: `GitHub POST /pulls → ${status}: ${JSON.stringify(json ?? {}).slice(0, 400)}`,
  };
}
