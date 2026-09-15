#!/usr/bin/env node
/**
 * brand apply --force ne doit pas wipe les fichiers creezio:owned-by-brand.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages/factory/bin/creezio.js");
const SMOKE_ENV = {
  ...process.env,
  CREEZIO_KIT_ROOT: ROOT,
  CREEZIO_ROOT: ROOT, // legacy compat (Q8)
  CREEZIO_SKIP_BRAND_DIST: "1",
  NODE_PATH: path.join(ROOT, "node_modules"),
};

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: SMOKE_ENV,
  });
}

test("owned-by-brand survit à brand apply --force", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "os-owned-"));
  const specDir = path.join(work, "brand-spec");
  const appDir = path.join(work, "app");

  assert.equal(
    runCli([
      "brand",
      "init",
      "--id",
      "ownedprobe",
      "--name",
      "OwnedProbe",
      "--domain",
      "ownedprobe.local",
      "--vertical",
      "generic",
      "--out",
      specDir,
      "--force",
    ]).status,
    0,
  );
  fs.writeFileSync(
    path.join(specDir, "product.md"),
    `# OwnedProbe\n\n## Entités\n\n### Articles\n- titre (texte)\n`,
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
  assert.equal(
    runCli(["brand", "apply", "--spec", specDir, "--out", appDir, "--force", "--no-push"])
      .status,
    0,
  );

  // Layout monorepo : métier sous server/.
  const serverDir = path.join(appDir, "server");
  const modPath = path.join(serverDir, "src/electron/brand-module-api.ts");
  const marker = "creezio:owned-by-brand";
  const custom = `/** ${marker} */\nexport const OWNED_PROBE = "keep-me";\nexport function registerBrandModuleApi() {}\n`;
  fs.writeFileSync(modPath, custom, "utf8");

  const bonusPath = path.join(serverDir, "src/electron/brand-bonus-api.ts");
  fs.writeFileSync(
    bonusPath,
    `/** ${marker} */\nexport function registerBrandBonusApi() { return "bonus"; }\n`,
    "utf8",
  );

  const reapply = runCli([
    "brand",
    "apply",
    "--spec",
    specDir,
    "--out",
    appDir,
    "--force",
    "--no-push",
  ]);
  assert.equal(reapply.status, 0, reapply.stderr + reapply.stdout);
  assert.match(reapply.stdout + reapply.stderr, /skip owned-by-brand/);

  const after = fs.readFileSync(modPath, "utf8");
  assert.match(after, /OWNED_PROBE/);
  assert.match(after, /keep-me/);
  assert.ok(fs.existsSync(bonusPath));

  // package.json ownedByBrand : merge (conserve scripts métier + flag)
  const pkgPath = path.join(serverDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.creezio = { ...(pkg.creezio || {}), ownedByBrand: true };
  pkg.scripts = { ...(pkg.scripts || {}), "proof:custom": "node -e \"console.log(1)\"" };
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

  const reapplyPkg = runCli([
    "brand",
    "apply",
    "--spec",
    specDir,
    "--out",
    appDir,
    "--force",
    "--no-push",
  ]);
  assert.equal(reapplyPkg.status, 0, reapplyPkg.stderr + reapplyPkg.stdout);
  assert.match(
    reapplyPkg.stdout + reapplyPkg.stderr,
    /merge owned-by-brand package\.json|skip owned-by-brand/,
  );
  const pkgAfter = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  assert.equal(pkgAfter.creezio?.ownedByBrand, true);
  assert.equal(pkgAfter.scripts?.["proof:custom"], 'node -e "console.log(1)"');
});
