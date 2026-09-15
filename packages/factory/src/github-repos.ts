/**
 * Création + push des repos GitHub d'une marque factory (2 repos privés :
 * monorepo marque + `<brand>-admin`).
 *
 * Push GitHub **opt-in** : `maybePushBrandRepos` ne résout un token et
 * n'appelle l'API que si `push: true` (`--push`). Sans ce flag : zéro réseau.
 * Token (uniquement si `--push`) : env GITHUB_TOKEN / CREEZIO_GITHUB_TOKEN,
 * ou fichier `.github-token` (jamais commité). Auteur des commits : Creezio
 * via flags `-c` par commande — JAMAIS de `git config` global/local persistant.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { prepareBrandDistribution } from "./prepare-brand-distribution.js";

export type GithubRepoSpec = {
  /** Dossier local à pousser (doit exister). */
  dir: string;
  /** Nom du repo GitHub (ex. tempoflow3, tempoflow3-admin). */
  name: string;
  description?: string;
};

export type CreateReposOptions = {
  org: string;
  repos: GithubRepoSpec[];
  token: string;
  /** Créer les repos via l'API mais ne pas pousser (debug). */
  skipPush?: boolean;
  log?: (line: string) => void;
};

export type CreateRepoResult = {
  name: string;
  url: string;
  created: boolean;
  pushed: boolean;
};

/** Résout un token GitHub : env, puis .github-token dans les dossiers donnés. */
export function resolveGithubToken(searchDirs: string[]): string | null {
  for (const key of ["CREEZIO_GITHUB_TOKEN", "GITHUB_TOKEN"]) {
    const v = (process.env[key] || "").trim();
    if (v) return v;
  }
  for (const dir of searchDirs) {
    const f = path.join(dir, ".github-token");
    try {
      const v = fs.readFileSync(f, "utf8").trim();
      if (v) return v;
    } catch {
      /* pas de fichier */
    }
  }
  return null;
}

async function githubApi(
  method: string,
  apiPath: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "creezio-factory",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

/** Crée un repo privé (org d'abord, fallback user). 422 name exists = ok. */
export async function createPrivateRepo(
  org: string,
  name: string,
  token: string,
  description?: string,
): Promise<{ created: boolean; url: string }> {
  const body = {
    name,
    private: true,
    description: description || "",
    has_issues: true,
    has_wiki: false,
  };
  let r = await githubApi("POST", `/orgs/${org}/repos`, token, body);
  if (r.status === 404) {
    // Pas une org (compte user) → endpoint user.
    r = await githubApi("POST", "/user/repos", token, body);
  }
  if (r.status === 201) {
    return { created: true, url: String(r.json.html_url || `https://github.com/${org}/${name}`) };
  }
  const errors = JSON.stringify(r.json.errors || r.json.message || "");
  if (r.status === 422 && /already exists/i.test(errors)) {
    return { created: false, url: `https://github.com/${org}/${name}` };
  }
  throw new Error(`création repo ${org}/${name} → HTTP ${r.status}: ${errors}`);
}

/** Supprime un repo (nettoyage marque jetable / tests E2E). */
export async function deleteRepo(
  org: string,
  name: string,
  token: string,
): Promise<boolean> {
  const r = await githubApi("DELETE", `/repos/${org}/${name}`, token);
  return r.status === 204;
}

function git(
  dir: string,
  args: string[],
  opts?: { allowFail?: boolean },
): string {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (r.status !== 0 && !opts?.allowFail) {
    throw new Error(
      `git ${args.join(" ")} (${dir}) exit ${r.status}: ${(r.stderr || r.stdout || "").slice(0, 500)}`,
    );
  }
  return (r.stdout || "").trim();
}

/**
 * Init + commit + push `main` d'un dossier vers GitHub.
 * Auteur Creezio par flags -c (aucun git config persistant), token dans
 * l'URL de push uniquement (jamais stocké en remote).
 */
export function pushInitialCommit(opts: {
  dir: string;
  org: string;
  name: string;
  token: string;
  message?: string;
}): void {
  const { dir, org, name, token } = opts;
  if (!fs.existsSync(path.join(dir, ".git"))) {
    git(dir, ["init", "--initial-branch=main"]);
  }
  git(dir, ["add", "-A"]);
  const status = git(dir, ["status", "--porcelain"]);
  if (status) {
    git(dir, [
      "-c",
      "user.name=Creezio",
      "-c",
      "user.email=bot@creez.io",
      "commit",
      "-m",
      opts.message || `chore: bootstrap ${name} (creezio factory)`,
    ]);
  }
  // Remote nominal SANS token (l'utilisateur pushe ensuite avec ses creds).
  const remote = `https://github.com/${org}/${name}.git`;
  const hasOrigin = git(dir, ["remote"], { allowFail: true })
    .split("\n")
    .includes("origin");
  if (hasOrigin) {
    git(dir, ["remote", "set-url", "origin", remote]);
  } else {
    git(dir, ["remote", "add", "origin", remote]);
  }
  const pushUrl = `https://x-access-token:${token}@github.com/${org}/${name}.git`;
  git(dir, ["push", pushUrl, "HEAD:main"]);
}

export type MaybePushOptions = {
  /** Racine monorepo marque. */
  outDir: string;
  /** Racine repo admin dédié. */
  adminDir: string;
  brandId: string;
  productName: string;
  /** --push : seul opt-in réseau ; exige un token. */
  push?: boolean;
  /** --no-push : défaut (redondant) ; gagne sur --push si les deux sont posés. */
  noPush?: boolean;
  org?: string;
  log?: (line: string) => void;
};

/** Message CLI quand les repos GitHub ne sont pas créés (défaut, sans --push). */
export const GITHUB_REPOS_SKIPPED_MSG =
  "repos GitHub non créés (--push pour les créer)";

/**
 * Politique factory 2-repos : crée + pousse `<brand>` et `<brand>-admin`
 * **uniquement** si `push: true` (flag CLI `--push`).
 *
 * Sans `--push` : aucun appel réseau, aucune résolution de token
 * (env / `.github-token` ignorés). `--no-push` est le défaut (flag accepté,
 * redondant). `--push` sans token = erreur explicite.
 */
export async function maybePushBrandRepos(
  o: MaybePushOptions,
): Promise<CreateRepoResult[] | null> {
  const log = o.log || ((l: string) => console.log(l));
  // Toujours préparer les locks (même sans push) : une marque locale
  // doit pouvoir `docker:build` immédiatement.
  prepareBrandDistribution(o.outDir, { log });
  // Le repo admin est une app OS complète (scaffoldAdminApp → scaffoldNewApp)
  // avec les mêmes cibles de locks (racine workspace + server/ui + client) :
  // sans ça il naît SANS package-lock.json (vécu foove2-admin, 2026-08-13).
  prepareBrandDistribution(o.adminDir, { log });

  const wantPush = o.push === true && o.noPush !== true;
  if (!wantPush) {
    log(GITHUB_REPOS_SKIPPED_MSG);
    return null;
  }
  const token = resolveGithubToken([o.outDir, path.dirname(o.outDir)]);
  if (!token) {
    throw new Error(
      "--push : token GitHub requis (env GITHUB_TOKEN/CREEZIO_GITHUB_TOKEN ou .github-token)",
    );
  }
  const org = o.org || process.env.CREEZIO_GITHUB_ORG || "creezio";
  return createBrandGithubRepos({
    org,
    token,
    repos: [
      {
        dir: o.outDir,
        name: o.brandId,
        description: `${o.productName} — monorepo marque (OS Creezio)`,
      },
      {
        dir: o.adminDir,
        name: `${o.brandId}-admin`,
        description: `${o.productName} — admin flotte multi-VPS`,
      },
    ],
    log,
  });
}

/**
 * Crée les repos GitHub privés d'une marque et pousse les arbres locaux.
 * Idempotent : repo existant = pas d'erreur, push best-effort.
 */
export async function createBrandGithubRepos(
  opts: CreateReposOptions,
): Promise<CreateRepoResult[]> {
  const log = opts.log || (() => {});
  const out: CreateRepoResult[] = [];
  for (const repo of opts.repos) {
    if (!fs.existsSync(repo.dir)) {
      throw new Error(`dossier à pousser introuvable: ${repo.dir}`);
    }
    const created = await createPrivateRepo(
      opts.org,
      repo.name,
      opts.token,
      repo.description,
    );
    log(
      `${created.created ? "+ repo créé" : "= repo existant"} ${created.url}`,
    );
    let pushed = false;
    if (!opts.skipPush) {
      pushInitialCommit({
        dir: repo.dir,
        org: opts.org,
        name: repo.name,
        token: opts.token,
      });
      pushed = true;
      log(`✓ push main → ${created.url}`);
    }
    out.push({
      name: repo.name,
      url: created.url,
      created: created.created,
      pushed,
    });
  }
  return out;
}
