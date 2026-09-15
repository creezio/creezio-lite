#!/usr/bin/env node
/**
 * Gate FLOTTE — factory 2-repos : chaque marque = monorepo (server/ client/)
 * + repo ADMIN dédié `<brand>-admin` (pilotage flotte multi-VPS, sans secret).
 *
 * Partie réseau (création réelle des repos GitHub + suppression) : opt-in
 * derrière CREEZIO_GITHUB_E2E=1 (jamais dans test:kit).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages/factory/bin/creezio.js");

// Les cas « token en env » prouvent que la factory ne contacte JAMAIS GitHub
// sans --push, même quand un token est disponible (on ne désarme rien).
// Sur un runner CI, aucun token n'est exposé en env : on injecte un jeton
// factice pour conserver la même preuve (le compteur réseau reste fail-closed,
// la valeur du token n'est jamais utilisée). Sur une machine dev, le vrai
// token présent est conservé tel quel.
if (!(process.env.GITHUB_TOKEN || process.env.CREEZIO_GITHUB_TOKEN || "").trim()) {
  process.env.CREEZIO_GITHUB_TOKEN = "ghp_gate_dummy_token_never_sent";
}

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    ...opts,
  });
}

test("factory 2-repos : monorepo + repo admin dédié (sans réseau)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-two-repos-"));
  const appDir = path.join(tmp, "proofbrand");
  try {
    const r = runCli(
      [
        "new-app",
        "--name",
        "ProofBrand",
        "--id",
        "proofbrand",
        "--domain",
        "proofbrand.example",
        "--out",
        appDir,
        "--force",
      ],
      { env: { ...process.env, CREEZIO_SKIP_BRAND_DIST: "1" } },
    );
    assert.equal(r.status, 0, r.stderr + "\n" + r.stdout);
    assert.match(
      r.stdout,
      /repos GitHub non créés \(--push pour les créer\)/,
      "sans --push : aucun repo GitHub (défaut)",
    );

    // Monorepo marque : plus de admin/ embarqué.
    assert.ok(fs.existsSync(path.join(appDir, "server/package.json")));
    assert.ok(fs.existsSync(path.join(appDir, "client")));
    assert.ok(!fs.existsSync(path.join(appDir, "admin")));

    // Repo admin dédié frère.
    const adminDir = `${appDir}-admin`;
    for (const f of [
      "server-admin.json",
      "fleet-hosts.json",
      "docker-compose.admin.yml",
      "README.md",
      ".env.example",
      ".gitignore",
    ]) {
      assert.ok(fs.existsSync(path.join(adminDir, f)), `admin repo: ${f}`);
    }

    // Config croisée SANS secrets : admin connaît brandId + domaine.
    const adminCfg = JSON.parse(
      fs.readFileSync(path.join(adminDir, "server-admin.json"), "utf8"),
    );
    assert.equal(adminCfg.brandId, "proofbrand");
    assert.equal(adminCfg.domain, "proofbrand.example");
    assert.ok(!("pass" in adminCfg), "jamais de pass dans la config versionnée");
    const hosts = JSON.parse(
      fs.readFileSync(path.join(adminDir, "fleet-hosts.json"), "utf8"),
    );
    assert.deepEqual(hosts.hosts, []);
    assert.ok(
      !JSON.stringify(hosts).includes("token"),
      "fleet-hosts.json versionné sans tokens",
    );
    const gitignore = fs.readFileSync(path.join(adminDir, ".gitignore"), "utf8");
    assert.match(gitignore, /docker-data\//);
    assert.match(gitignore, /^\.env$/m);

    // Cursor cloud agents : les 2 repos naissent avec l'environnement
    // d'install standard (ajouté à la main sur foove2/* — désormais natif).
    for (const repoDir of [appDir, adminDir]) {
      const envFile = path.join(repoDir, ".cursor", "environment.json");
      assert.ok(
        fs.existsSync(envFile),
        `.cursor/environment.json manquant: ${repoDir}`,
      );
      assert.deepEqual(
        JSON.parse(fs.readFileSync(envFile, "utf8")),
        { install: "npm install --no-audit --no-fund" },
        `contenu .cursor/environment.json inattendu: ${repoDir}`,
      );
    }

    // Le monorepo pointe vers le repo admin frère.
    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(appDir, "package.json"), "utf8"),
    );
    assert.match(
      String(rootPkg.scripts["server-docker:admin"]),
      /--admin-root \.\.\/proofbrand-admin/,
    );

    // README admin : app OS + exploitation flotte.
    const readme = fs.readFileSync(path.join(adminDir, "README.md"), "utf8");
    assert.match(readme, /admin\.proofbrand\.example/);
    assert.match(readme, /ADR-admin-app-os/);
    assert.match(readme, /billing-webhook\/stripe/);
    assert.match(readme, /lp\.proofbrand\.example/);
    assert.doesNotMatch(readme, /reverse proxy TLS en prod/);

    const envEx = fs.readFileSync(path.join(adminDir, ".env.example"), "utf8");
    assert.match(envEx, /CREEZIO_DOMAIN=admin\.proofbrand\.example/);
    assert.match(envEx, /CREEZIO_TUNNEL_EXTRA_HOSTNAMES=lp\.proofbrand\.example/);
    assert.match(envEx, /Pas de NPM/);

    // Repo admin = app OS Creezio COMPLÈTE en mode admin (ADR-admin-app-os).
    for (const f of [
      "server/package.json",
      "server/src/electron/main.ts",
      "server/src/electron/brand-module-api.ts",
      "server/src/electron/brand-migrations.ts",
      "server/scripts/brand-kernel-harness.mjs",
      "server/ui/app/flotte/page.tsx",
      "server/ui/app/tickets/page.tsx",
      "server/ui/app/prospects/page.tsx",
      "client/package.json",
    ]) {
      assert.ok(
        fs.existsSync(path.join(adminDir, f)),
        `app OS admin: ${f}`,
      );
    }
    const adminApi = fs.readFileSync(
      path.join(adminDir, "server/src/electron/brand-module-api.ts"),
      "utf8",
    );
    assert.match(adminApi, /createFleetAdminMount/);
    assert.match(adminApi, /createSupportAdminMount/);
    assert.match(adminApi, /createBillingWebhookMount/);
    const adminMig = fs.readFileSync(
      path.join(adminDir, "server/src/electron/brand-migrations.ts"),
      "utf8",
    );
    assert.match(adminMig, /adminMigrations\(\)/);
    const adminRootPkg = JSON.parse(
      fs.readFileSync(path.join(adminDir, "package.json"), "utf8"),
    );
    assert.equal(adminRootPkg.creezio?.appMode, "admin");
    const brandChrome = fs.readFileSync(
      path.join(appDir, "server/ui/components/brand-chrome.tsx"),
      "utf8",
    );
    assert.match(brandChrome, /from "@creezio\/auth\/ui"/);
    assert.match(
      brandChrome,
      /<RequireSession>[\s\S]*<WorkspaceRoot>\{children\}<\/WorkspaceRoot>[\s\S]*<\/RequireSession>/,
      "chrome marque : RequireSession kit autour de WorkspaceRoot",
    );
    const adminChrome = fs.readFileSync(
      path.join(adminDir, "server/ui/components/brand-chrome.tsx"),
      "utf8",
    );
    assert.match(adminChrome, /from "@creezio\/auth\/ui"/);
    assert.match(
      adminChrome,
      /<RequireSession>[\s\S]*<WorkspaceRoot>\{children\}<\/WorkspaceRoot>[\s\S]*<\/RequireSession>/,
      "chrome admin : RequireSession kit autour de WorkspaceRoot (sinon /flotte 401)",
    );
    assert.doesNotMatch(adminChrome, /function RequireSession/);
    const adminMw = fs.readFileSync(
      path.join(adminDir, "server/ui/middleware.ts"),
      "utf8",
    );
    assert.match(adminMw, /jwtVerify/, "middleware admin : garde session JWT");
    assert.match(adminMw, /loginRedirect/, "middleware admin : redirect /login");
    assert.match(
      adminMw,
      /host\.startsWith\("lp\."\)/,
      "middleware admin : rewrite landing lp.{zone}",
    );
    const flottePage = fs.readFileSync(
      path.join(adminDir, "server/ui/app/flotte/page.tsx"),
      "utf8",
    );
    assert.match(flottePage, /FleetAdminClient/);
    const prospectsPage = fs.readFileSync(
      path.join(adminDir, "server/ui/app/prospects/page.tsx"),
      "utf8",
    );
    assert.match(prospectsPage, /ProspectsKanbanClient/);

    // Vérification E2E canonique (BACKLOG « Scaffold verify-prod factory ») :
    // toute app générée (marque ET admin) matérialise scripts/verify-prod.mjs
    // bien formé (node --check), avec le bon profil + extension locale.
    for (const [repoDir, profile, brand] of [
      [appDir, "brand", "proofbrand"],
      [adminDir, "admin", "proofbrandadmin"],
    ]) {
      const vp = path.join(repoDir, "scripts/verify-prod.mjs");
      assert.ok(fs.existsSync(vp), `verify-prod.mjs manquant: ${repoDir}`);
      const parsed = spawnSync(process.execPath, ["--check", vp], {
        encoding: "utf8",
      });
      assert.equal(parsed.status, 0, `verify-prod mal formé: ${parsed.stderr}`);
      const body = fs.readFileSync(vp, "utf8");
      assert.match(body, new RegExp(`profile: "${profile}"`));
      assert.match(body, new RegExp(`brandId: "${brand}"`));
      assert.match(body, /CREEZIO_E2E_EMAIL/, "SoT credentials secrets.env");
      assert.match(body, /verify-prod\.local\.mjs/, "extension métier locale");
      const pkg = JSON.parse(
        fs.readFileSync(path.join(repoDir, "package.json"), "utf8"),
      );
      assert.equal(
        pkg.scripts["verify:prod"],
        "node scripts/verify-prod.mjs --all",
        `script npm verify:prod manquant: ${repoDir}`,
      );
    }
    // Profil brand : browse Meili + assistant présents dans les checks.
    const brandVp = fs.readFileSync(
      path.join(appDir, "scripts/verify-prod.mjs"),
      "utf8",
    );
    assert.match(brandVp, /engine:"meili"/);
    assert.match(brandVp, /llm-status/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(`${appDir}-admin`, { recursive: true, force: true });
  }
});

test("brand apply : mêmes 2 arbres + --admin-out custom", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-two-repos-ba-"));
  try {
    const specDir = path.join(tmp, "brand-spec");
    const init = runCli([
      "brand",
      "init",
      "--id",
      "twobrand",
      "--name",
      "TwoBrand",
      "--domain",
      "twobrand.example",
      "--out",
      specDir,
    ]);
    assert.equal(init.status, 0, init.stderr + "\n" + init.stdout);
    fs.writeFileSync(
      path.join(specDir, "product.md"),
      `# TwoBrand

Produit: TwoBrand
Domaine: twobrand.example

## Vision

Gestion simple pour test gate factory 2-repos.

## Entités

### Articles
- nom (texte)
`,
      "utf8",
    );
    const artDir = path.join(specDir, "modules", "articles");
    fs.mkdirSync(artDir, { recursive: true });
    fs.writeFileSync(
      path.join(artDir, "prd.md"),
      `# Module articles — Articles\n\nVision remplie pour le livrable de test kit.\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(artDir, "interview.md"),
      `# Interview articles\n\nDécisions remplies.\n`,
      "utf8",
    );
    const appDir = path.join(tmp, "twobrand");
    const adminDir = path.join(tmp, "custom-admin");
    const apply = runCli(
      [
        "brand",
        "apply",
        "--spec",
        specDir,
        "--out",
        appDir,
        "--admin-out",
        adminDir,
        "--force",
      ],
      { env: { ...process.env, CREEZIO_SKIP_BRAND_DIST: "1" } },
    );
    assert.equal(apply.status, 0, apply.stderr + "\n" + apply.stdout);
    assert.ok(fs.existsSync(path.join(adminDir, "server-admin.json")));
    assert.ok(!fs.existsSync(path.join(appDir, "admin")));
    assert.match(
      apply.stdout,
      /repos GitHub non créés \(--push pour les créer\)/,
    );
    const applyAdminChrome = fs.readFileSync(
      path.join(adminDir, "server/ui/components/brand-chrome.tsx"),
      "utf8",
    );
    assert.match(
      applyAdminChrome,
      /<RequireSession>[\s\S]*<WorkspaceRoot>\{children\}<\/WorkspaceRoot>[\s\S]*<\/RequireSession>/,
      "brand apply admin : RequireSession autour de WorkspaceRoot",
    );
    for (const repoDir of [appDir, adminDir]) {
      assert.ok(
        fs.existsSync(path.join(repoDir, ".cursor", "environment.json")),
        `.cursor/environment.json manquant: ${repoDir}`,
      );
      assert.ok(
        fs.existsSync(path.join(repoDir, "scripts", "verify-prod.mjs")),
        `scripts/verify-prod.mjs manquant: ${repoDir}`,
      );
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const GITHUB_NET_PRELOAD = `import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import childProcess from "node:child_process";

const logPath = process.env.CREEZIO_GITHUB_NET_LOG;
function record(kind, url) {
  const line = kind + " " + url + "\\n";
  if (logPath) fs.appendFileSync(logPath, line);
  throw new Error("FAIL-CLOSED: requête GitHub interdite (" + kind + " " + url + ")");
}
function isGithub(url) {
  return /github\\.com/i.test(String(url));
}

const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
  if (isGithub(url)) record("fetch", url);
  return origFetch(input, init);
};

function patchRequest(mod, name) {
  const orig = mod.request;
  mod.request = function (options, cb) {
    const url =
      typeof options === "string"
        ? options
        : (options.protocol || "") +
          "//" +
          (options.host || options.hostname || "") +
          (options.path || "");
    if (isGithub(url)) record(name, url);
    return orig.call(this, options, cb);
  };
}
patchRequest(https, "https.request");
patchRequest(http, "http.request");

const origSpawnSync = childProcess.spawnSync;
childProcess.spawnSync = function (cmd, args, opts) {
  const all = [cmd, ...(Array.isArray(args) ? args : [])].join(" ");
  if (isGithub(all)) record("spawnSync", all);
  return origSpawnSync.apply(this, arguments);
};
`;

test("scaffold SANS --push + token en env : zéro requête GitHub (compteur réseau)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-two-repos-nopush-"));
  const logFile = path.join(tmp, "github-net.log");
  const preload = path.join(tmp, "intercept-github-net.mjs");
  fs.writeFileSync(preload, GITHUB_NET_PRELOAD, "utf8");
  const appDir = path.join(tmp, "silentbrand");
  try {
    assert.ok(
      (process.env.GITHUB_TOKEN || process.env.CREEZIO_GITHUB_TOKEN || "").trim(),
      "ce cas exige un token GitHub en env (preuve : on ne le désarme pas)",
    );
    const r = runCli(
      [
        "new-app",
        "--name",
        "SilentBrand",
        "--id",
        "silentbrand",
        "--domain",
        "silentbrand.example",
        "--out",
        appDir,
        "--force",
      ],
      {
        env: {
          ...process.env,
          CREEZIO_SKIP_BRAND_DIST: "1",
          CREEZIO_GITHUB_NET_LOG: logFile,
          NODE_OPTIONS: [
            process.env.NODE_OPTIONS || "",
            `--import ${pathToFileURL(preload).href}`,
          ]
            .filter(Boolean)
            .join(" ")
            .trim(),
        },
      },
    );
    assert.equal(r.status, 0, r.stderr + "\n" + r.stdout);
    assert.match(
      r.stdout,
      /repos GitHub non créés \(--push pour les créer\)/,
    );
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
    assert.equal(log, "", `requêtes GitHub interdites:\n${log}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(`${appDir}-admin`, { recursive: true, force: true });
  }
});

test("maybePushBrandRepos sans push:true : fetch GitHub jamais appelé (token en env)", async () => {
  const { maybePushBrandRepos, GITHUB_REPOS_SKIPPED_MSG } = await import(
    "../packages/factory/dist/github-repos.js"
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-maybe-push-"));
  const outDir = path.join(tmp, "brandx");
  const adminDir = path.join(tmp, "brandx-admin");
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(adminDir, { recursive: true });
  let githubFetches = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input && typeof input === "object" && "url" in input
          ? String(input.url)
          : String(input);
    if (/github\.com/i.test(url)) {
      githubFetches += 1;
      throw new Error(`FAIL-CLOSED fetch GitHub: ${url}`);
    }
    return origFetch(input, init);
  };
  const prevSkip = process.env.CREEZIO_SKIP_BRAND_DIST;
  process.env.CREEZIO_SKIP_BRAND_DIST = "1";
  const lines = [];
  try {
    assert.ok(
      (process.env.GITHUB_TOKEN || process.env.CREEZIO_GITHUB_TOKEN || "").trim(),
      "token GitHub doit rester en env",
    );
    const res = await maybePushBrandRepos({
      outDir,
      adminDir,
      brandId: "brandx",
      productName: "BrandX",
      log: (l) => lines.push(l),
    });
    assert.equal(res, null);
    assert.equal(githubFetches, 0, "aucune requête GitHub");
    assert.ok(
      lines.some((l) => l.includes(GITHUB_REPOS_SKIPPED_MSG)),
      lines.join("\n"),
    );
  } finally {
    globalThis.fetch = origFetch;
    if (prevSkip === undefined) delete process.env.CREEZIO_SKIP_BRAND_DIST;
    else process.env.CREEZIO_SKIP_BRAND_DIST = prevSkip;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("--push sans token = erreur explicite", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-two-repos-push-"));
  const appDir = path.join(tmp, "needtoken");
  try {
    const r = runCli(
      [
        "new-app",
        "--name",
        "NeedToken",
        "--id",
        "needtoken",
        "--domain",
        "needtoken.example",
        "--out",
        appDir,
        "--force",
        "--push",
      ],
      {
        env: {
          ...process.env,
          CREEZIO_SKIP_BRAND_DIST: "1",
          GITHUB_TOKEN: "",
          CREEZIO_GITHUB_TOKEN: "",
        },
      },
    );
    assert.notEqual(r.status, 0, " --push sans token doit échouer");
    assert.match(
      `${r.stdout}\n${r.stderr}`,
      /token GitHub requis/,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(`${appDir}-admin`, { recursive: true, force: true });
  }
});

test(
  "E2E GitHub : création réelle des 2 repos privés + suppression",
  { skip: process.env.CREEZIO_GITHUB_E2E !== "1" ? "opt-in CREEZIO_GITHUB_E2E=1" : false },
  async () => {
    const { resolveGithubToken, deleteRepo } = await import(
      "../packages/factory/dist/github-repos.js"
    );
    const token = resolveGithubToken([ROOT]);
    assert.ok(token, ".github-token requis pour l'E2E GitHub");
    const org = process.env.CREEZIO_GITHUB_ORG || "creezio";
    const stamp = Date.now().toString(36);
    const brandId = `gatebrand${stamp}`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-two-repos-e2e-"));
    const appDir = path.join(tmp, brandId);
    try {
      const r = runCli(
        [
          "new-app",
          "--name",
          "GateBrand",
          "--id",
          brandId,
          "--domain",
          `${brandId}.example`,
          "--out",
          appDir,
          "--push",
          "--github-org",
          org,
          "--force",
        ],
        { env: { ...process.env, CREEZIO_GITHUB_TOKEN: token } },
      );
      assert.equal(r.status, 0, r.stderr + "\n" + r.stdout);
      assert.match(r.stdout, new RegExp(`github\\.com/${org}/${brandId}`));
      assert.match(r.stdout, new RegExp(`github\\.com/${org}/${brandId}-admin`));
      assert.match(r.stdout, /push main/);
    } finally {
      // Nettoyage : marque jetable → suppression des 2 repos via API.
      for (const name of [brandId, `${brandId}-admin`]) {
        const ok = await deleteRepo(org, name, token).catch(() => false);
        if (!ok) console.log(`⚠ suppression ${org}/${name} à faire à la main`);
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
);
