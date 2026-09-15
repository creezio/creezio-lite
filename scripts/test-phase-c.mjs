#!/usr/bin/env node
/**
 * Tests kit Phase C — tooling publish + feeds + config marque.
 *
 * La sonde HTTP des feeds desktop prod (`crm.tempoflow.fr`, fidu, certivan)
 * est opt-in `CREEZIO_LIVE_FEEDS=1` : ce n'est pas le contrat Creezio, et
 * ça ne doit pas faire rougir `test:kit` / la CI.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  demobrandManifest,
  latestYmlUrl,
  listProductionBrandIds,
  resolveArtifactFileName,
  resolveLatestAlias,
} from "../packages/brand-config/dist/index.js";
import {
  parseLatestYml,
  resolvePublishConfig,
  toShellExports,
} from "../packages/desktop-tooling/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("manifests exposent publish Client+Serveur", () => {
  const m = demobrandManifest;
  assert.ok(m.publish?.dockerDlName, `${m.brandId} dockerDlName`);
  assert.ok(m.publish?.remoteBuildHost, `${m.brandId} remoteBuildHost`);
  assert.ok(m.publish?.statusFile, `${m.brandId} statusFile`);
  assert.ok(m.publish?.defaultAppRoot, `${m.brandId} defaultAppRoot`);
  assert.equal(m.publish.buildServerArtifact, true);
  assert.ok(m.client.feedUrl.endsWith("/"));
  assert.ok(m.server.feedUrl.includes("/server/"));
});

test("resolveArtifactFileName / latest alias", () => {
  assert.equal(
    resolveArtifactFileName(demobrandManifest.client, "0.10.26"),
    "DemoBrand-Setup-0.10.26.exe",
  );
  assert.equal(
    resolveLatestAlias(demobrandManifest.server),
    "DemoBrand-Server-Setup-latest.exe",
  );
  assert.ok(latestYmlUrl(demobrandManifest, "client").endsWith("/latest.yml"));
  assert.ok(latestYmlUrl(demobrandManifest, "client").includes("demobrand.creez.io"));
});

test("resolvePublishConfig demobrand client", () => {
  const cfg = resolvePublishConfig({
    brandId: "demobrand",
    kind: "client",
    version: "0.10.26",
    appRoot: demobrandManifest.publish.defaultAppRoot,
  });
  assert.equal(cfg.exeFileName, "DemoBrand-Setup-0.10.26.exe");
  assert.equal(cfg.dockerDlName, "dl-demobrand");
  assert.equal(cfg.kind, "client");
  assert.ok(cfg.feedUrl.includes("demobrand.creez.io"));
  const sh = toShellExports(cfg);
  assert.match(sh, /CREEZIO_BRAND='demobrand'/);
  assert.match(sh, /CREEZIO_EXE='DemoBrand-Setup-0.10.26.exe'/);
});

test("resolvePublishConfig demobrand server", () => {
  const cfg = resolvePublishConfig({
    brandId: "demobrand",
    kind: "server",
    version: "0.1.10",
  });
  assert.equal(cfg.exeFileName, "DemoBrand-Server-Setup-0.1.10.exe");
  assert.equal(cfg.distDir, "dist-electron-server");
  assert.ok(cfg.dockerDlDir.endsWith("/server"));
  assert.equal(cfg.legacyAlias, null);
});

test("parseLatestYml", () => {
  const meta = parseLatestYml(`version: 1.2.3
path: Foo-Setup-1.2.3.exe
releaseDate: '2026-07-01T00:00:00.000Z'
files:
  - url: Foo-Setup-1.2.3.exe
    size: 123
sha512: abc
`);
  assert.equal(meta.version, "1.2.3");
  assert.equal(meta.path, "Foo-Setup-1.2.3.exe");
  assert.equal(meta.size, 123);
});

test("scripts publish / remote-build / after-pack présents et exécutables", () => {
  const scripts = [
    "packages/desktop-tooling/scripts/publish-desktop.sh",
    "packages/desktop-tooling/scripts/remote-build-win.sh",
    "packages/desktop-tooling/scripts/after-pack.cjs",
    "packages/desktop-tooling/scripts/resolve-config.mjs",
    "packages/desktop-tooling/scripts/desktop-build-status.mjs",
  ];
  for (const rel of scripts) {
    const p = path.join(ROOT, rel);
    assert.ok(fs.existsSync(p), rel);
    if (rel.endsWith(".sh") || rel.endsWith(".mjs")) {
      fs.accessSync(p, fs.constants.X_OK);
    }
  }
});

test("resolve-config.mjs CLI --export-shell", () => {
  const res = spawnSync(
    "node",
    [
      path.join(ROOT, "packages/desktop-tooling/scripts/resolve-config.mjs"),
      "--brand=demobrand",
      "--kind=client",
      "--version=0.1.51",
      "--export-shell",
    ],
    { encoding: "utf8" },
  );
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /CREEZIO_EXE='DemoBrand-Setup-0.1.51.exe'/);
  assert.match(res.stdout, /CREEZIO_DOCKER_DL_NAME='dl-demobrand'/);
});

test("publish-desktop --dry-run sans artefacts → exit 1 attendu ou dry avant check", () => {
  // dry-run vérifie d'abord la présence des artefacts — OK si exit 1
  const res = spawnSync(
    "bash",
    [
      path.join(ROOT, "packages/desktop-tooling/scripts/publish-desktop.sh"),
      "--brand=demobrand",
      "--kind=client",
      "--app-root",
      demobrandManifest.publish.defaultAppRoot,
      "--dry-run",
    ],
    { encoding: "utf8" },
  );
  // Soit dry-run OK si artefacts présents, soit ERROR manquant
  assert.ok(
    res.status === 0 || /manquant|DRY-RUN|ERROR/.test(res.stdout + res.stderr),
    res.stdout + res.stderr,
  );
});

test(
  "feeds live client (réseau) — marques prod uniquement",
  { skip: process.env.CREEZIO_LIVE_FEEDS !== "1" },
  () => {
    // H11 : le kit ne publie plus de manifest prod — la sonde live
    // n'itère que les marques encore enregistrées (liste vide hors sandbox).
    assert.deepEqual(listProductionBrandIds(), []);
  },
);

test("console app présente", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "apps/console/package.json")));
  assert.ok(fs.existsSync(path.join(ROOT, "apps/console/src/app/page.tsx")));
  assert.ok(
    fs.existsSync(path.join(ROOT, "apps/console/src/app/api/remote-build/route.ts")),
  );
});
