#!/usr/bin/env node
/**
 * Rollout npm flotte-wide (P3.b) — ouvre une PR de bump `@creezio/*` chez
 * chaque marque configurée après une publication kit.
 *
 * Branche ENFIN `buildAllBrandPrPayloads` (@creezio/propagation, contrat
 * Phase F jamais exécuté) sur un flux réel : le corps de chaque PR est le
 * rapport d'impact `kit:impact` généré par le package propagation.
 *
 * Déclenché par `.github/workflows/propagate.yml` (workflow_run sur Publish)
 * — exécutable aussi à la main depuis un checkout kit :
 *
 *   CREEZIO_PROPAGATE_TOKEN=ghp_xxx node scripts/propagate-brands.mjs [--dry-run] [--force]
 *
 * Config data-driven : `.github/propagate-brands.json` (les canaux marque de
 * P1.c — AUCUN nom de marque en dur dans packages/*, la config est la SoT).
 *
 * Env :
 *   CREEZIO_PROPAGATE_TOKEN  PAT cross-repo (contents+pull_requests write sur
 *                            les repos marque) — requis hors --dry-run.
 *   CREEZIO_NPM_TOKEN        PAT read:packages pour la régénération lockfile
 *                            (défaut : CREEZIO_PROPAGATE_TOKEN).
 *   PROPAGATE_FORCE=1        bypass du garde « commit release changesets ».
 *
 * Garde-fous :
 *   - ne fait rien si HEAD n'est pas un commit release changesets
 *     (`chore(release): version packages`) sauf --force / PROPAGATE_FORCE=1 ;
 *   - GET les PR ouvertes (même titre / même head / package.json déjà au
 *     pin) ou `main` déjà au pin → skip (D7 — `ls-remote` kit-bump-<ver>
 *     ne suffit pas : TF3 #73 doublon après #72 mergée) ;
 *   - POST /pulls HTTP 422 → skip (PR déjà existante), jamais une erreur ;
 *   - marque déjà à jour (tous manifests ^version ET deps SoT présentes) → skip ;
 *   - branche de bump déjà poussée → skip (PR déjà ouverte) ;
 *   - sync = logique PARTAGÉE `planCreezioManifestSync` (@creezio/factory,
 *     packages/factory/src/sync-creezio-deps.ts) : bump des deps existantes
 *     + AJOUT des deps requises par la SoT kit (SERVER/UI/CLIENT_CREEZIO_DEPS)
 *     — le trou historique « bump seul » a cassé des builds marque (os-ui
 *     0.20.0) ; jamais de suppression (dep hors SoT = warning listé dans la
 *     PR) ; puis `npm install --package-lock-only` par lockfile (JAMAIS
 *     npm update) — la CI marque valide le reste.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bumpBranchName,
  bumpPrTitle,
  evaluatePropagateGuard,
  interpretCreatePullResponse,
} from "./lib/propagate-pr-guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(ROOT, ".github/propagate-brands.json");
const MANIFEST_DIRS = [".", "server", "server/ui", "client"];
const RELEASE_COMMIT_PREFIX = "chore(release): version packages";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force") || process.env.PROPAGATE_FORCE === "1";

const token = process.env.CREEZIO_PROPAGATE_TOKEN || process.env.GITHUB_TOKEN || "";
const npmToken = process.env.CREEZIO_NPM_TOKEN || token;

function log(msg) {
  console.log(msg);
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Version lockstep publiée = version du kit dans ce checkout. */
function kitVersion() {
  return readJson(path.join(ROOT, "packages/platform-core/package.json")).version;
}

function bumpKindFor(version) {
  const [, , patch] = version.split(".").map(Number);
  return patch > 0 ? "patch" : "minor";
}

/** Garde : on ne propage que les commits release changesets (sinon no-op). */
function isReleaseHead() {
  const subject = sh("git", ["log", "-1", "--format=%s"], { cwd: ROOT }).trim();
  return subject.startsWith(RELEASE_COMMIT_PREFIX);
}

/**
 * Sync des manifests @creezio/* d'un clone marque via la logique PARTAGÉE du
 * package factory (SoT SERVER/UI/CLIENT_CREEZIO_DEPS) : bump des existantes
 * + ajout des requises manquantes. Retourne { changed, added, extras }.
 */
async function syncManifests(cloneDir, spec) {
  const {
    planCreezioManifestSync,
    applyCreezioManifestSync,
    creezioSyncPlanHasChanges,
  } = await import(path.join(ROOT, "packages/factory/dist/sync-creezio-deps.js"));
  const plans = planCreezioManifestSync(cloneDir, spec);
  const changedPlans = plans.filter(creezioSyncPlanHasChanges);
  for (const plan of changedPlans) applyCreezioManifestSync(plan);
  return {
    changed: changedPlans.map((p) => p.rel),
    added: changedPlans.flatMap((p) =>
      Object.keys(p.adds).map((name) => `${name} (${p.rel})`),
    ),
    extras: plans.flatMap((p) =>
      p.extras.map((name) => `${name} (${p.rel})`),
    ),
  };
}

/** Régénère chaque lockfile présent (racine puis secondaires) — lock-only. */
function regenLockfiles(cloneDir) {
  const regenerated = [];
  for (const dir of MANIFEST_DIRS) {
    const lock = path.join(cloneDir, dir, "package-lock.json");
    if (!fs.existsSync(lock)) continue;
    sh("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"], {
      cwd: path.join(cloneDir, dir),
      env: { ...process.env, CREEZIO_NPM_TOKEN: npmToken },
      stdio: ["ignore", "inherit", "inherit"],
    });
    regenerated.push(path.join(dir, "package-lock.json").replace(/^\.\//, ""));
  }
  return regenerated;
}

async function githubRequest(method, url, body) {
  const res = await fetch(`https://api.github.com${url}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "creezio-propagate",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, link: res.headers.get("link") || "" };
}

function githubApiClient() {
  return {
    request: (method, url) => githubRequest(method, url),
  };
}

async function main() {
  const config = readJson(CONFIG_PATH);
  const brands = config.brands ?? [];
  if (brands.length === 0) {
    log("propagate: aucune marque configurée (.github/propagate-brands.json) — rien à faire.");
    return;
  }
  if (!force && !isReleaseHead()) {
    log(`propagate: HEAD n'est pas un commit release changesets (« ${RELEASE_COMMIT_PREFIX} … ») — no-op. (--force pour bypass)`);
    return;
  }
  if (!token && !dryRun) {
    throw new Error("CREEZIO_PROPAGATE_TOKEN manquant (requis hors --dry-run).");
  }

  const version = kitVersion();
  const spec = `^${version}`;
  const bumpKind = bumpKindFor(version);
  const branch = bumpBranchName(version);
  log(`propagate: kit ${version} (bump ${bumpKind}) → ${brands.length} marque(s)${dryRun ? " [dry-run]" : ""}`);

  // Rapport d'impact via @creezio/propagation (contrat Phase F, branché ici).
  const { impactForPackageBump } = await import(
    path.join(ROOT, "packages/propagation/dist/impact.js")
  );
  const { configureBrandChannels, buildAllBrandPrPayloads } = await import(
    path.join(ROOT, "packages/propagation/dist/channels.js")
  );
  configureBrandChannels(
    brands.map((b) => ({
      brandId: b.brandId,
      label: b.label,
      targetHint: `https://github.com/${b.repo}`,
    })),
  );
  const impact = impactForPackageBump({
    packageName: "@creezio/platform-core",
    bumpKind,
  });
  const payloads = buildAllBrandPrPayloads(impact);

  const results = [];
  for (const brand of brands) {
    const payload = payloads.find((p) => p.brandId === brand.brandId);
    try {
      results.push(await propagateBrand(brand, { version, spec, branch, payload }));
    } catch (err) {
      results.push({ brand: brand.brandId, status: "ERREUR", detail: String(err?.message || err) });
      process.exitCode = 1;
    }
  }

  log("\n=== propagate — récapitulatif ===");
  for (const r of results) {
    log(`- ${r.brand}: ${r.status}${r.detail ? ` — ${r.detail}` : ""}`);
  }
}

async function propagateBrand(brand, { version, spec, branch, payload }) {
  const { brandId, repo, defaultBranch = "main" } = brand;
  log(`\n--- ${brandId} (${repo}) ---`);

  if (token) {
    const guard = await evaluatePropagateGuard(githubApiClient(), {
      repo,
      version,
      brandId,
      branch,
      defaultBranch,
    });
    if (guard.skip) {
      return { brand: brandId, status: "SKIP", detail: guard.reason };
    }
  }

  const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), `propagate-${brandId}-`));
  const cloneUrl = token
    ? `https://x-access-token:${token}@github.com/${repo}.git`
    : `https://github.com/${repo}.git`;
  sh("git", ["clone", "--depth", "1", "--branch", defaultBranch, cloneUrl, cloneDir], {
    stdio: ["ignore", "inherit", "inherit"],
  });

  // Branche de bump déjà poussée → une PR existe (ou a existé) pour cette version.
  const remoteBranch = sh("git", ["ls-remote", "--heads", "origin", branch], { cwd: cloneDir }).trim();
  if (remoteBranch) {
    return { brand: brandId, status: "SKIP", detail: `branche ${branch} déjà poussée (PR existante)` };
  }

  const sync = await syncManifests(cloneDir, spec);
  const changedManifests = sync.changed;
  if (sync.extras.length > 0) {
    log(`⚠ deps @creezio/* hors SoT kit (conservées) : ${sync.extras.join(", ")}`);
  }
  if (changedManifests.length === 0) {
    return { brand: brandId, status: "À JOUR", detail: `déjà en ${spec} (deps SoT présentes)` };
  }
  log(`manifests synchronisés (${spec}) : ${changedManifests.join(", ")}`);
  if (sync.added.length > 0) {
    log(`deps ajoutées (SoT kit) : ${sync.added.join(", ")}`);
  }
  const locks = regenLockfiles(cloneDir);
  log(`lockfiles régénérés : ${locks.join(", ") || "(aucun)"}`);

  if (dryRun) {
    const diff = sh("git", ["diff", "--stat"], { cwd: cloneDir }).trim();
    log(diff);
    return { brand: brandId, status: "DRY-RUN", detail: `${changedManifests.length} manifest(s), ${locks.length} lockfile(s)` };
  }

  sh("git", ["checkout", "-b", branch], { cwd: cloneDir });
  sh("git", ["add", "-A"], { cwd: cloneDir });
  sh(
    "git",
    [
      "-c", "user.name=Creezio",
      "-c", "user.email=creezio@users.noreply.github.com",
      "commit",
      "-m", `chore(deps): bump @creezio/* → ${version}`,
    ],
    { cwd: cloneDir },
  );
  sh("git", ["push", "origin", branch], { cwd: cloneDir, stdio: ["ignore", "inherit", "inherit"] });

  const title = bumpPrTitle(version, brandId);
  const bodyHeader = [
    `Bump automatique des packages \`@creezio/*\` vers **${version}** (rollout npm flotte, workflow \`propagate.yml\` du kit).`,
    "",
    `Manifests : ${changedManifests.map((m) => `\`${m}\``).join(", ")} — lockfiles régénérés en \`--package-lock-only\`.`,
    "",
    ...(sync.added.length > 0
      ? [
          `**Deps ajoutées** (requises par la SoT du kit, manquantes chez la marque) : ${sync.added.map((a) => `\`${a}\``).join(", ")}.`,
          "",
        ]
      : []),
    ...(sync.extras.length > 0
      ? [
          `⚠️ **Deps \`@creezio/*\` hors SoT kit** (conservées, à vérifier) : ${sync.extras.map((a) => `\`${a}\``).join(", ")}.`,
          "",
        ]
      : []),
  ].join("\n");
  const body = bodyHeader + (payload ? `\n${payload.bodyMarkdown}` : "\n_(pas de rapport d'impact disponible)_");
  const created = await githubRequest("POST", `/repos/${repo}/pulls`, {
    title,
    head: branch,
    base: defaultBranch,
    body,
  });
  const outcome = interpretCreatePullResponse(created.status, created.json);
  if (outcome.kind === "skip") {
    log(`PR non ouverte : ${outcome.reason}`);
    return { brand: brandId, status: "SKIP", detail: outcome.reason };
  }
  if (outcome.kind === "error") {
    throw new Error(outcome.reason);
  }
  log(`PR ouverte : ${outcome.url}`);
  return { brand: brandId, status: "PR", detail: outcome.url };
}

main().catch((err) => {
  console.error(`propagate: ÉCHEC — ${err?.stack || err}`);
  process.exit(1);
});
