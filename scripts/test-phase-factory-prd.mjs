#!/usr/bin/env node
/**
 * Gate F0–F5 — factory --from-prd natif (api-kernel + SQLite).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { linkKitNodeModules } from "./lib/link-kit-node-modules.mjs";
import {
  parseProductPrd,
  safeBrandId,
  scaffoldNewApp,
} from "../packages/factory/dist/index.js";

test("F1.2b parseProductPrd Articles → entité articles (pas notes)", () => {
  const model = parseProductPrd(
    `# Probe

## Entités

### Articles
- nom (texte)
- prix (nombre)
`,
    { brandId: "probebrand", brandName: "Probe" },
  );
  assert.deepEqual(
    model.entities.map((e) => e.id),
    ["articles"],
  );
  assert.ok(!model.entities.some((e) => e.id === "notes"));
});

test("F1.2c parseProductPrd stub (à remplir) = error", () => {
  assert.throws(
    () =>
      parseProductPrd(`# Vide

## Entités (à préciser)

- (à remplir)
`),
    /à remplir|stub/i,
  );
});

test("F1.2d parseProductPrd sans Entités ni vertical: chr = error (pas notes)", () => {
  assert.throws(
    () => parseProductPrd(`# App\n\nJuste une phrase.\n`),
    /aucune entité|notes/i,
  );
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRD = path.join(
  ROOT,
  "docs/experiences/tempoflow3/PRD-PRODUIT.md",
);
const FIXTURE_PRD = path.join(
  ROOT,
  "packages/factory/fixtures/prd-tempoflow-produit.md",
);
const EXPECTED = JSON.parse(
  fs.readFileSync(
    path.join(
      ROOT,
      "packages/factory/fixtures/prd-tempoflow-produit.expected.json",
    ),
    "utf8",
  ),
);
const CLI = path.join(ROOT, "packages/factory/bin/creezio.js");
const SMOKE_ENV = {
  ...process.env,
  CREEZIO_KIT_ROOT: ROOT,
  CREEZIO_ROOT: ROOT, // legacy compat (Q8)
  // Gates structurelles : pas de vendor/lock Docker (layout node_modules tmp).
  CREEZIO_SKIP_BRAND_DIST: "1",
  // Hors-ligne : aucun npm install (le lien kit suffit pour tsc + @creezio/*).
  npm_config_offline: "true",
  npm_config_prefer_offline: "true",
  NODE_PATH: path.join(ROOT, "node_modules"),
  PATH: [
    path.join(ROOT, "node_modules", ".bin"),
    process.env.PATH || "",
  ].join(path.delimiter),
};

test("F0.1 factory AGENTS autorise --from-prd", () => {
  const agents = fs.readFileSync(
    path.join(ROOT, "packages/factory/AGENTS.md"),
    "utf8",
  );
  assert.match(agents, /--from-prd/);
  assert.match(agents, /ProductModel/);
});

test("F0.2 ADR factory-from-prd présent", () => {
  const adr = path.join(ROOT, "docs/adr/ADR-factory-from-prd.md");
  assert.ok(fs.existsSync(adr));
  const body = fs.readFileSync(adr, "utf8");
  assert.match(body, /générateurs/);
});

test("F1.1 safeBrandId réserve tempoflow → tempoflow3", () => {
  assert.equal(safeBrandId("TempoFlow"), "tempoflow3");
  assert.equal(safeBrandId("tempoflow"), "tempoflow3");
  assert.equal(safeBrandId("Acme CHR"), "acmechr");
});

test("F1.2 parseProductPrd PRD TempoFlow → cœur achats (pas catalogue oracle)", () => {
  const md = fs.readFileSync(PRD, "utf8");
  const model = parseProductPrd(md, { sourcePath: PRD });
  assert.equal(model.brandId, EXPECTED.brandId);
  assert.deepEqual(
    model.entities.map((e) => e.id),
    EXPECTED.entityIds,
  );
  assert.equal(model.entities.length, 5);
  assert.ok(!model.entities.some((e) => e.id === "stack_items"));
});

test("F1.3 fixture gold = PRD expérience", () => {
  assert.ok(fs.existsSync(FIXTURE_PRD));
  assert.equal(fs.readFileSync(PRD, "utf8"), fs.readFileSync(FIXTURE_PRD, "utf8"));
});

test("F1.4 CLI accepte --from-prd", () => {
  const r = spawnSync(process.execPath, [CLI, "new-app", "--help"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--from-prd/);
  assert.match(r.stdout, /--link-kit/);
  assert.match(r.stdout, /--push/);
  assert.match(
    r.stdout,
    /opt-in|aucun appel GitHub|Défaut \(redondant\)/,
    "help : --push est opt-in, pas le défaut token-si-dispo",
  );
});

test("F1–F4 scaffold --from-prd génère 2 repos (monorepo + admin dédié, runtime natif)", () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-from-prd-"));
  const adminDir = `${outDir}-admin`;
  const r = spawnSync(
    process.execPath,
    [CLI, "new-app", "--from-prd", PRD, "--out", outDir, "--force", "--no-push"],
    { encoding: "utf8", cwd: ROOT, env: SMOKE_ENV },
  );
  assert.equal(r.status, 0, r.stderr + "\n" + r.stdout);
  assert.match(
    r.stdout,
    /repos GitHub non créés \(--push pour les créer\)/,
    "--from-prd sans --push : aucun repo GitHub",
  );

  const mustExist = [
    "package.json",
    ".gitignore",
    "AGENTS.md",
    "scripts/creezio-cli.mjs",
    "server/product-model.json",
    "server/scripts/brand-kernel-harness.mjs",
    "server/scripts/test-metier-parcours.mjs",
    "server/scripts/test-mini-prd-core.mjs",
    "server/scripts/test-meili-config.mjs",
    "server/src/electron/main.ts",
    "server/src/electron/brand-migrations.ts",
    "server/src/electron/brand-module-api.ts",
    "server/src/electron/meili-feed.ts",
    "server/src/electron/preload.ts",
    "server/ui/app/fournisseurs/page.tsx",
    "server/electron-builder.server.json",
    "client/package.json",
    "client/src/electron/main.ts",
    "client/electron-builder.client.json",
    "client/scripts/build-builder-config.mjs",
  ];
  for (const rel of mustExist) {
    assert.ok(fs.existsSync(path.join(outDir, rel)), `manquant: ${rel}`);
  }

  // Repo admin dédié FRÈRE (jamais de admin/ dans le monorepo marque).
  assert.ok(
    !fs.existsSync(path.join(outDir, "admin")),
    "admin/ ne doit plus exister dans le monorepo marque",
  );
  for (const rel of [
    "server-admin.json",
    "docker-compose.admin.yml",
    "README.md",
  ]) {
    assert.ok(
      fs.existsSync(path.join(adminDir, rel)),
      `manquant (repo admin dédié): ${rel}`,
    );
  }
  const server = path.join(outDir, "server");
  assert.ok(
    !fs.existsSync(path.join(server, "crm")),
    "server/crm/ ne doit plus être généré",
  );

  assert.ok(!fs.existsSync(path.join(server, "scripts/metier-api.mjs")));
  assert.ok(!fs.existsSync(path.join(server, "src/lib/brand-module-api.ts")));
  assert.ok(!fs.existsSync(path.join(ROOT, "packages/factory/templates/chr")));

  const main = fs.readFileSync(path.join(server, "src/electron/main.ts"), "utf8");
  assert.match(main, /startBrandDesktop/);
  assert.match(main, /brandMigrations|registerModuleApi/);
  assert.match(main, /@creezio\/app-runtime/);
  assert.doesNotMatch(main, /spawnBrandMetierApi|listenBrandKernelHttp|bootBrandKernel/);
  assert.ok(!fs.existsSync(path.join(server, "src/electron/brand-runtime.ts")));
  assert.ok(!fs.existsSync(path.join(server, "src/lib/host-stack.ts")));
  assert.ok(!fs.existsSync(path.join(server, "src/electron/product-hub-stub.ts")));

  // Client thin remote-only : AUCUN import métier dans le main client.
  const clientMain = fs.readFileSync(
    path.join(outDir, "client/src/electron/main.ts"),
    "utf8",
  );
  assert.match(clientMain, /startBrandDesktop/);
  // Aucun IMPORT métier (le doc-comment du template peut citer les noms).
  assert.doesNotMatch(
    clientMain,
    /from\s+["'][^"']*(brand-migrations|brand-module-api|meili-feed)/,
  );

  // Admin versionné SANS secret (repo dédié frère).
  const adminCfg = JSON.parse(
    fs.readFileSync(path.join(adminDir, "server-admin.json"), "utf8"),
  );
  assert.ok(adminCfg.port && adminCfg.user && Array.isArray(adminCfg.brandRoots));
  assert.equal(adminCfg.pass, undefined, "pas de secret versionné");

  // Mode npm : zéro vendor ni symlink tracké — workspace racine + .npmrc
  // (registre @creezio → GitHub Packages, token via env).
  assert.ok(!fs.existsSync(path.join(server, "vendor")), "server/vendor ne doit plus exister");
  assert.ok(
    !fs.existsSync(path.join(outDir, "client/vendor")),
    "client/vendor ne doit plus exister",
  );
  assert.ok(fs.existsSync(path.join(outDir, ".npmrc")), ".npmrc racine manquant");
  const rootPkgPrd = JSON.parse(
    fs.readFileSync(path.join(outDir, "package.json"), "utf8"),
  );
  assert.deepEqual(rootPkgPrd.workspaces, ["server"], "workspaces racine");

  const mounts = fs.readFileSync(
    path.join(server, "src/electron/brand-module-api.ts"),
    "utf8",
  );
  assert.match(mounts, /registerModuleApi/);
  assert.match(mounts, /createSearchMount|"search"/);
  assert.match(mounts, /collectEntitySpecs/);
  assert.match(mounts, /collectApiMounts/);
  assert.doesNotMatch(mounts, /delegate_to_metier_api/);

  // Registre modules (standard TF3) — entités dans modules/<id>.ts
  assert.ok(
    fs.existsSync(path.join(server, "src/electron/modules/index.ts")),
    "modules/index.ts",
  );
  assert.ok(
    fs.existsSync(path.join(server, "src/electron/modules/types.ts")),
    "modules/types.ts",
  );
  assert.ok(
    fs.existsSync(path.join(server, "src/electron/modules/fournisseurs.ts")),
    "module fournisseurs dans le registre",
  );
  const modIndex = fs.readFileSync(
    path.join(server, "src/electron/modules/index.ts"),
    "utf8",
  );
  assert.match(modIndex, /fournisseursModule/);
  assert.match(modIndex, /collectEntitySpecs/);
  const mig = fs.readFileSync(
    path.join(server, "src/electron/brand-migrations.ts"),
    "utf8",
  );
  assert.match(mig, /collectModuleMigrations/);
  const vertical = fs.readFileSync(
    path.join(server, "src/electron/vertical-slot.ts"),
    "utf8",
  );
  assert.match(vertical, /collectNavItems/);
  const agents = fs.readFileSync(path.join(outDir, "AGENTS.md"), "utf8");
  assert.match(agents, /BrandModuleDef/);
  assert.match(agents, /brand module init/);
  assert.match(agents, /CREATE-MODULE|DOC-STANDARD-MODULE/);
  assert.ok(
    fs.existsSync(path.join(outDir, "brand-spec/modules/_template/prd.md")),
  );
  assert.ok(
    fs.existsSync(path.join(outDir, "brand-spec/modules/fournisseurs/prd.md")),
  );
  // Gates colocalisées (DOC-STANDARD-MODULE : 5ᵉ fichier + runner découvert).
  assert.ok(
    fs.existsSync(
      path.join(outDir, "brand-spec/modules/fournisseurs/gate.mjs"),
    ),
    "gate.mjs colocalisée non scaffoldée",
  );
  assert.ok(
    fs.existsSync(path.join(server, "scripts/run-module-gates.mjs")),
    "runner run-module-gates.mjs non scaffoldé",
  );
  const serverPkg = JSON.parse(
    fs.readFileSync(path.join(server, "package.json"), "utf8"),
  );
  assert.ok(serverPkg.scripts["test:modules"], "runner gates branché npm");
  assert.match(serverPkg.scripts.test, /test:modules/);

  const feed = fs.readFileSync(
    path.join(server, "src/electron/meili-feed.ts"),
    "utf8",
  );
  assert.match(feed, /brandMeiliFeed/);
  assert.doesNotMatch(feed, /createChrCatalogMeiliFeed/);
  assert.doesNotMatch(feed, /tf2_produits|tf2_marketplaces/);

  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(outDir, "package.json"), "utf8"),
  );
  assert.equal(rootPkg.creezio?.nativeKernel, true);
  assert.equal(rootPkg.creezio?.layout, "monorepo");
  assert.ok(rootPkg.scripts["metier:api"], "délégation metier:api racine");
  assert.ok(rootPkg.scripts["pack:linux"].includes("--prefix client"));
  assert.ok(rootPkg.scripts["server-docker:create"], "server-docker racine");

  const pkg = JSON.parse(
    fs.readFileSync(path.join(server, "package.json"), "utf8"),
  );
  assert.equal(pkg.creezio?.nativeKernel, true);
  assert.equal(pkg.creezio?.kind, "server");
  assert.ok(pkg.scripts["metier:api"].includes("brand-kernel-harness"));
  assert.ok(pkg.scripts["test:meili-config"]);
  assert.ok(pkg.scripts["pack:linux:server"], "pack:linux:server");
  assert.ok(pkg.scripts["e2e:browser"], "e2e:browser");
  assert.ok(pkg.scripts["smoke:tunnel-catalog"], "smoke:tunnel-catalog");

  const clientPkg = JSON.parse(
    fs.readFileSync(path.join(outDir, "client/package.json"), "utf8"),
  );
  assert.equal(clientPkg.creezio?.kind, "client");
  assert.ok(clientPkg.scripts["pack:linux"], "pack:linux client");
  assert.ok(clientPkg.scripts["electron:config:client"]);
  assert.ok(clientPkg.scripts["electron:verify-pack"]);

  assert.ok(
    fs.existsSync(path.join(server, "scripts/ensure-linux-icons.mjs")),
    "ensure-linux-icons",
  );
  assert.ok(
    fs.existsSync(path.join(server, "scripts/load-local-env.mjs")),
    "load-local-env",
  );
  assert.ok(
    fs.existsSync(path.join(server, "scripts/e2e-browser-parcours.mjs")),
    "e2e-browser-parcours",
  );
  assert.ok(
    fs.existsSync(path.join(server, "ui/lib/metier-base.ts")),
    "metier-base same-origin",
  );
  const e2eProxy = fs.readFileSync(
    path.join(server, "scripts/e2e-browser-parcours.mjs"),
    "utf8",
  );
  assert.match(e2eProxy, /desktop-tooling\/scripts\/e2e-browser-parcours/);
  const nextCfg = fs.readFileSync(
    path.join(server, "ui/next.config.mjs"),
    "utf8",
  );
  assert.match(nextCfg, /rewrites/);
  assert.match(nextCfg, /\/api\/v1\/:path\*/);
});

test("F3.0 harness généré pose AUTH_DISABLED (anti-401 notes, sans electron)", () => {
  // Ne skip jamais : régression post-F3 (garde mounts) si le template oublie
  // AUTH_DISABLED=1 — visible même sur VPS headless sans electron.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-auth-disabled-"));
  try {
    const model = parseProductPrd(fs.readFileSync(PRD, "utf8"));
    const result = scaffoldNewApp({
      brandId: model.brandId,
      productName: model.brandName,
      domain: model.domain,
      outDir,
      sandbox: true,
      force: true,
      productModel: model,
    });
    const smokePath = path.join(
      result.serverDir,
      "scripts/test-metier-parcours.mjs",
    );
    assert.ok(fs.existsSync(smokePath), "test-metier-parcours.mjs manquant");
    const body = fs.readFileSync(smokePath, "utf8");
    assert.match(
      body,
      /AUTH_DISABLED:\s*["']1["']/,
      "harnessPrelude doit poser AUTH_DISABLED=1 (sinon API notes → 401)",
    );
    // Source générateur (filet si scaffold lit un cache obsolète).
    const gen = fs.readFileSync(
      path.join(ROOT, "packages/factory/src/generators/tests.ts"),
      "utf8",
    );
    assert.match(gen, /AUTH_DISABLED:\s*["']1["']/);
    assert.ok(
      fs.existsSync(
        path.join(
          result.serverDir,
          "plugins/insights-assistant/manifest.json",
        ),
      ),
      "scaffold --from-prd doit installer le template kit insights-assistant",
    );
    const preloadTsconfig = fs.readFileSync(
      path.join(result.serverDir, "tsconfig.preload.json"),
      "utf8",
    );
    assert.match(
      preloadTsconfig,
      /electron-shim\.d\.ts/,
      "tsconfig.preload doit inclure electron-shim.d.ts (tsc hors-ligne sans paquet electron)",
    );
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test("F3 smoke kernel natif sur app générée", () => {
  // Compile via electron-shim.d.ts + @types/node du kit (lien node_modules).
  // Pas de npm install : --link-kit (PR #172) exigerait encore le registre
  // pour electron/typescript/lock — hors-ligne impossible. F3.0 reste
  // obligatoire même si ce smoke échoue.
  if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
    throw new Error(
      "node_modules kit absent — impossible de lier l'app générée pour tsc",
    );
  }
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-metier-"));
  const model = parseProductPrd(fs.readFileSync(PRD, "utf8"));
  const result = scaffoldNewApp({
    brandId: model.brandId,
    productName: model.brandName,
    domain: model.domain,
    outDir,
    sandbox: true,
    force: true,
    productModel: model,
  });
  const server = result.serverDir;
  const link = linkKitNodeModules(server, ROOT);
  assert.ok(
    fs.existsSync(path.join(link.path, "@types/node")),
    "lien kit : @types/node introuvable (tsc hors-ligne impossible)",
  );

  const smoke = spawnSync(
    process.execPath,
    [path.join(server, "scripts/test-metier-parcours.mjs")],
    {
      encoding: "utf8",
      cwd: server,
      timeout: 120000,
      env: SMOKE_ENV,
    },
  );
  assert.equal(smoke.status, 0, smoke.stderr + "\n" + smoke.stdout);
  assert.match(smoke.stdout, /OK test:metier-parcours/);

  const firstRun = spawnSync(
    process.execPath,
    [path.join(server, "scripts/test-first-run-auth.mjs")],
    { encoding: "utf8", cwd: server, env: SMOKE_ENV },
  );
  assert.equal(firstRun.status, 0, firstRun.stderr + "\n" + firstRun.stdout);

  const setupLogin = spawnSync(
    process.execPath,
    [path.join(server, "scripts/test-setup-login.mjs")],
    { encoding: "utf8", cwd: server, timeout: 30000, env: SMOKE_ENV },
  );
  assert.equal(setupLogin.status, 0, setupLogin.stderr + "\n" + setupLogin.stdout);

  const allow = spawnSync(
    process.execPath,
    [path.join(server, "scripts/test-allowlist.mjs")],
    { encoding: "utf8", cwd: server, env: SMOKE_ENV },
  );
  assert.equal(allow.status, 0, allow.stderr + "\n" + allow.stdout);
});

test("F5 AGENTS racine documente brief produit", () => {
  const agents = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
  assert.match(agents, /brief produit/i);
  assert.match(agents, /--from-prd/);
});
