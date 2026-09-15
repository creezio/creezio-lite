#!/usr/bin/env node
/**
 * Tests kit Phase D — factory new-app + sandbox DemoBrand.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAppManifest,
  demobrandManifest,
  listProductionBrandIds,
  nsisGuidFromAppId,
  validateAppManifest,
} from "../packages/brand-config/dist/index.js";
import { scaffoldNewApp } from "../packages/factory/dist/index.js";
import { buildElectronBuilderConfig } from "../packages/brand-config/dist/index.js";
import { resolvePublishConfig } from "../packages/desktop-tooling/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PROD_FEED_TOKENS = [
  "e660352fb04dbd5e2519f0e60897c548",
  "3c94d486b0efa7618fad5bdfff410c49",
];

test("nsisGuidFromAppId = UUID.v5 OID (fidu known)", () => {
  assert.equal(
    nsisGuidFromAppId("fr.fidu.desktop"),
    "f124e69d-95f4-5dd2-b199-5b89c875649d",
  );
  assert.equal(
    nsisGuidFromAppId("fr.fidu.desktop.server"),
    "9a6b4565-45b5-5572-a867-74ab1954e3da",
  );
});

test("createAppManifest + validate — Client+Serveur", () => {
  const m = createAppManifest({
    brandId: "acmeapp",
    productName: "AcmeApp",
    domain: "acme.creez.io",
    sandbox: true,
  });
  assert.equal(m.brandId, "acmeapp");
  assert.equal(m.envPrefix, "ACMEAPP");
  assert.equal(m.bridgeName, "acmeappDesktop");
  assert.equal(m.sandbox, true);
  assert.ok(m.client.appId.endsWith(".acmeapp"));
  assert.ok(m.server.appId.endsWith(".acmeapp.server"));
  assert.equal(m.client.nsisGuid, nsisGuidFromAppId(m.client.appId));
  assert.equal(m.server.nsisGuid, nsisGuidFromAppId(m.server.appId));
  assert.notEqual(m.client.nsisGuid, m.server.nsisGuid);
  assert.equal(m.publish.buildServerArtifact, true);
  assert.equal(m.publish.dockerDlName, "dl-acmeapp");
  assert.ok(m.client.feedUrl.includes("sandbox"));
  assert.deepEqual(validateAppManifest(m), []);
});

test("createAppManifest refuse marques prod", () => {
  assert.throws(() =>
    createAppManifest({
      brandId: "tempoflow",
      productName: "X",
      domain: "x.creez.io",
    }),
  );
  assert.throws(() =>
    createAppManifest({
      brandId: "fidu",
      productName: "X",
      domain: "x.creez.io",
    }),
  );
});

test("demobrand sandbox distinct des feeds/GUID prod", () => {
  assert.equal(demobrandManifest.sandbox, true);
  assert.deepEqual(validateAppManifest(demobrandManifest), []);
  for (const tok of PROD_FEED_TOKENS) {
    assert.ok(
      !demobrandManifest.client.feedUrl.includes(tok),
      `feed ne doit pas contenir ${tok}`,
    );
  }
  assert.equal(demobrandManifest.publish.dockerDlName, "dl-demobrand");
  for (const tok of PROD_FEED_TOKENS) {
    assert.ok(
      !demobrandManifest.server.feedUrl.includes(tok),
      `feed serveur ne doit pas contenir ${tok}`,
    );
  }
});

test("listProductionBrandIds exclut demobrand (registre kit = sandbox seule)", () => {
  const prod = listProductionBrandIds();
  assert.deepEqual(prod, []);
  assert.ok(!prod.includes("demobrand"));
});

test("scaffoldNewApp génère structure + builder configs", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-factory-"));
  const outDir = path.join(tmp, "sandboxapp");
  const result = scaffoldNewApp({
    brandId: "sandboxapp",
    productName: "SandboxApp",
    domain: "sandboxapp.creez.io",
    outDir,
    force: true,
  });
  assert.equal(result.manifest.brandId, "sandboxapp");
  // Layout monorepo (server/ client/) + racine orchestrateur ;
  // admin flotte = repo dédié frère `<out>-admin` (factory 2-repos).
  const required = [
    "package.json",
    "README.md",
    ".gitignore",
    "scripts/creezio-cli.mjs",
    "server/package.json",
    "server/README.md",
    "server/src/electron/main.ts",
    "server/src/electron/preload.ts",
    "server/src/electron/nav-core.ts",
    "server/src/electron/vertical-slot.ts",
    "server/src/electron/product-hub-stub.ts",
    "server/src/electron/app-manifest.ts",
    "server/electron-builder.base.json",
    "server/electron-builder.server.json",
    "server/scripts/build-builder-config.mjs",
    "server/plugins/insights-assistant/manifest.json",
    "client/package.json",
    "client/src/electron/main.ts",
    "client/src/electron/preload.ts",
    "client/src/electron/app-manifest.ts",
    "client/electron-builder.base.json",
    "client/electron-builder.client.json",
    "client/scripts/build-builder-config.mjs",
  ];
  for (const rel of required) {
    assert.ok(fs.existsSync(path.join(outDir, rel)), rel);
  }
  for (const rel of [
    "server-admin.json",
    "fleet-hosts.json",
    "docker-compose.admin.yml",
    "README.md",
  ]) {
    assert.ok(fs.existsSync(path.join(`${outDir}-admin`, rel)), `admin: ${rel}`);
  }
  assert.equal(result.serverDir, path.join(outDir, "server"));
  assert.equal(result.clientDir, path.join(outDir, "client"));
  assert.equal(result.adminDir, `${outDir}-admin`);
  assert.ok(!fs.existsSync(path.join(outDir, "admin")));

  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(outDir, "package.json"), "utf8"),
  );
  assert.equal(rootPkg.creezio?.layout, "monorepo");
  assert.equal(rootPkg.creezio?.brandId, "sandboxapp");
  assert.ok(rootPkg.scripts["server-docker:create"]);
  assert.ok(rootPkg.scripts["pack:linux"].includes("--prefix client"));

  const pkg = JSON.parse(
    fs.readFileSync(path.join(outDir, "server/package.json"), "utf8"),
  );
  assert.equal(pkg.creezio?.kind, "server");
  assert.ok(pkg.dependencies["@creezio/product-hub"]);
  assert.ok(pkg.dependencies["@creezio/shell-ui"]);
  assert.ok(pkg.dependencies["@creezio/api-kernel"]);
  assert.ok(pkg.dependencies["@creezio/auth"]);
  assert.ok(pkg.dependencies["@creezio/app-runtime"]);
  assert.match(
    pkg.dependencies["@creezio/app-runtime"],
    /^\^\d+\.\d+\.\d+$/,
    "deps @creezio/* = versions npm publiées (plus de file:vendor)",
  );

  const clientPkg = JSON.parse(
    fs.readFileSync(path.join(outDir, "client/package.json"), "utf8"),
  );
  assert.equal(clientPkg.creezio?.kind, "client");
  assert.ok(clientPkg.scripts["electron:config:client"]);
  assert.ok(clientPkg.scripts["pack:linux"]);

  const main = fs.readFileSync(
    path.join(outDir, "server/src/electron/main.ts"),
    "utf8",
  );
  assert.match(main, /startBrandDesktop/);
  assert.match(main, /desktopShell/);
  assert.doesNotMatch(main, /prepareDesktopBoot/);
  assert.ok(
    fs.existsSync(path.join(outDir, "server/src/electron/brand-migrations.ts")),
  );
  assert.ok(
    fs.existsSync(path.join(outDir, "server/scripts/brand-kernel-harness.mjs")),
  );

  // Client thin : main SANS imports métier (remote-only).
  const clientMain = fs.readFileSync(
    path.join(outDir, "client/src/electron/main.ts"),
    "utf8",
  );
  assert.match(clientMain, /startBrandDesktop/);
  assert.doesNotMatch(
    clientMain,
    /from "\.\/(brand-migrations|brand-module-api|vertical-slot)/,
  );

  const vertical = fs.readFileSync(
    path.join(outDir, "server/src/electron/vertical-slot.ts"),
    "utf8",
  );
  assert.match(vertical, /collectNavItems/);
  assert.match(vertical, /registerBrandNav\(BRAND_NAV\)/);
  assert.match(vertical, /productHub/);
  assert.doesNotMatch(vertical, /catalogue|tempoflow/i);

  // Socle registre modules (standard TF3) — prêt pour brand module init.
  assert.ok(
    fs.existsSync(path.join(outDir, "server/src/electron/modules/index.ts")),
    "registre modules/index.ts",
  );
  assert.ok(
    fs.existsSync(path.join(outDir, "server/src/electron/modules/types.ts")),
    "modules/types.ts BrandModuleDef",
  );
  const modIndex = fs.readFileSync(
    path.join(outDir, "server/src/electron/modules/index.ts"),
    "utf8",
  );
  assert.match(modIndex, /collectEntitySpecs/);
  assert.match(modIndex, /collectAssistantSources/);
  assert.match(modIndex, /collectOnboardingContent/);
  assert.match(modIndex, /collectNavPermissions/);
  assert.match(modIndex, /collectPermissionGroups/);
  assert.match(modIndex, /<creezio:module-imports>/);
  const bareApi = fs.readFileSync(
    path.join(outDir, "server/src/electron/brand-module-api.ts"),
    "utf8",
  );
  assert.match(bareApi, /collectEntitySpecs/);
  const bareMig = fs.readFileSync(
    path.join(outDir, "server/src/electron/brand-migrations.ts"),
    "utf8",
  );
  assert.match(bareMig, /collectModuleMigrations/);
  assert.ok(
    fs.existsSync(path.join(outDir, "brand-spec/modules/_template/prd.md")),
    "brand-spec modules/_template",
  );
  const agentsBare = fs.readFileSync(path.join(outDir, "AGENTS.md"), "utf8");
  assert.match(agentsBare, /BrandModuleDef/);
  assert.match(agentsBare, /brand module init/);
  assert.match(agentsBare, /CREATE-MODULE/);
  const hubStub = fs.readFileSync(
    path.join(outDir, "server/src/electron/product-hub-stub.ts"),
    "utf8",
  );
  assert.match(hubStub, /@creezio\/product-hub/);
  assert.doesNotMatch(hubStub, /TEMPOFLOW_|CERTIVAN_/);
  const nav = fs.readFileSync(
    path.join(outDir, "server/src/electron/nav-core.ts"),
    "utf8",
  );
  assert.match(nav, /PAS de catalogue kit ni d'entrées métier marque/);

  const clientCfg = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "client/electron-builder.client.json"),
      "utf8",
    ),
  );
  const serverCfg = JSON.parse(
    fs.readFileSync(
      path.join(outDir, "server/electron-builder.server.json"),
      "utf8",
    ),
  );
  assert.equal(clientCfg.appId, result.manifest.client.appId);
  assert.equal(serverCfg.appId, result.manifest.server.appId);
  assert.equal(clientCfg.nsis.guid, result.manifest.client.nsisGuid);
  assert.equal(serverCfg.nsis.guid, result.manifest.server.nsisGuid);
  assert.equal(clientCfg.directories.output, "dist-electron");
  assert.equal(serverCfg.directories.output, "dist-electron-server");

  // Admin versionné sans secret (repo dédié frère).
  const adminCfg = JSON.parse(
    fs.readFileSync(path.join(`${outDir}-admin`, "server-admin.json"), "utf8"),
  );
  assert.equal(adminCfg.pass, undefined);
  assert.ok(adminCfg.port && adminCfg.user);
  assert.equal(adminCfg.brandId, "sandboxapp");

  fs.rmSync(tmp, { recursive: true, force: true });
});

test("CLI creezio new-app", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-cli-"));
  const outDir = path.join(tmp, "clipapp");
  const res = spawnSync(
    "node",
    [
      path.join(ROOT, "packages/factory/bin/creezio.js"),
      "new-app",
      "--name",
      "ClipApp",
      "--id",
      "clipapp",
      "--domain",
      "clipapp.creez.io",
      "--out",
      outDir,
      "--force",
      "--no-push",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, CREEZIO_SKIP_BRAND_DIST: "1" },
    },
  );
  assert.equal(res.status, 0, res.stderr + res.stdout);
  assert.match(res.stdout, /AppManifest clipapp/);
  assert.match(
    res.stdout,
    /repos GitHub non créés \(--push pour les créer\)/,
    "clipapp : aucun push GitHub sans --push (même si GITHUB_TOKEN est posé)",
  );
  assert.ok(fs.existsSync(path.join(outDir, "package.json")));
  assert.ok(
    fs.existsSync(path.join(outDir, "server/src/electron/modules/index.ts")),
  );
  assert.match(
    fs.readFileSync(path.join(outDir, "AGENTS.md"), "utf8"),
    /BrandModuleDef/,
  );
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("sandbox demobrand présente et compilée", () => {
  const app = path.join(ROOT, "apps/demobrand");
  assert.ok(fs.existsSync(path.join(app, "package.json")));
  assert.ok(fs.existsSync(path.join(app, "build/electron/main.js")));
  assert.ok(fs.existsSync(path.join(app, "build/electron/preload.js")));
  assert.ok(fs.existsSync(path.join(app, "electron-builder.client.json")));
  assert.ok(fs.existsSync(path.join(app, "electron-builder.server.json")));
  const pkg = JSON.parse(
    fs.readFileSync(path.join(app, "package.json"), "utf8"),
  );
  assert.equal(pkg.name, "@creezio/app-demobrand");
  for (const dep of [
    "@creezio/brand-config",
    "@creezio/shell",
    "@creezio/platform-core",
    "@creezio/electron-shell",
    "@creezio/desktop-tooling",
  ]) {
    assert.ok(pkg.dependencies[dep], dep);
  }
});

test("buildElectronBuilderConfig demobrand", () => {
  const base = {
    files: ["build/electron/**/*", "!node_modules/**/*"],
    extraResources: [{ from: "build/electron", to: "build/electron" }],
  };
  const client = buildElectronBuilderConfig(demobrandManifest, "client", base);
  const server = buildElectronBuilderConfig(demobrandManifest, "server", base);
  assert.equal(client.appId, "io.creezio.demobrand");
  assert.equal(server.appId, "io.creezio.demobrand.server");
  assert.equal(client.publish.url, demobrandManifest.client.feedUrl);
  assert.equal(server.publish.url, demobrandManifest.server.feedUrl);
  assert.deepEqual(client.win?.extraResources || [], []);
  assert.ok(
    (server.win?.extraResources || []).some(
      (e) => e?.to === "bin" && e?.filter?.includes("cloudflared.exe"),
    ),
  );
});

test("resolvePublishConfig demobrand dry-run ready", () => {
  const cfg = resolvePublishConfig({
    brandId: "demobrand",
    kind: "client",
    version: "0.1.0",
    appRoot: demobrandManifest.publish.defaultAppRoot,
  });
  assert.equal(cfg.dockerDlName, "dl-demobrand");
  assert.equal(cfg.exeFileName, "DemoBrand-Setup-0.1.0.exe");
  assert.ok(cfg.feedUrl.includes("sandbox"));
  assert.ok(!cfg.feedUrl.includes("e660352fb04dbd5e2519f0e60897c548"));
});

test("docs PHASE-D.md + factory package", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "docs/archive/PHASE-D.md")));
  assert.ok(
    fs.existsSync(path.join(ROOT, "packages/factory/package.json")),
  );
  assert.ok(fs.existsSync(path.join(ROOT, "packages/factory/bin/creezio.js")));
});

test("npm run factory:new-app --help", () => {
  const res = spawnSync(
    "npm",
    ["run", "factory:new-app", "--", "--help"],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout + res.stderr, /new-app/);
});
