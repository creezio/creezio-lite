#!/usr/bin/env node
/**
 * Allowlist anti-dérive — une app fraîche (brand create) et les générateurs
 * factory ne doivent plus poser notes / crm / glue OS / mount hors registre.
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
const FACTORY_SRC = path.join(ROOT, "packages/factory/src");

const SMOKE_ENV = {
  ...process.env,
  CREEZIO_KIT_ROOT: ROOT,
  CREEZIO_SKIP_BRAND_DIST: "1",
  NODE_PATH: path.join(ROOT, "node_modules"),
};

function walkTs(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkTs(p, acc);
    else if (name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".mjs")) {
      acc.push(p);
    }
  }
  return acc;
}

function assertAppAllowlist(appDir, label) {
  const server = path.join(appDir, "server");
  assert.ok(!fs.existsSync(path.join(server, "crm")), `${label}: pas de server/crm/`);
  assert.ok(
    !fs.existsSync(path.join(server, "src/electron/modules/notes.ts")),
    `${label}: pas de modules/notes.ts`,
  );
  assert.ok(
    !fs.existsSync(path.join(appDir, "brand-spec/modules/notes")),
    `${label}: pas de brand-spec/modules/notes`,
  );
  assert.ok(
    !fs.existsSync(path.join(server, "src/lib/host-stack.ts")),
    `${label}: pas de host-stack.ts`,
  );
  assert.ok(
    fs.existsSync(path.join(server, "src/electron/modules/index.ts")),
    `${label}: registre modules/index.ts requis`,
  );
  const brandApi = fs.readFileSync(
    path.join(server, "src/electron/brand-module-api.ts"),
    "utf8",
  );
  assert.match(brandApi, /collectDemoScenarios/, `${label}: mount collectDemoScenarios`);
  assert.match(brandApi, /collectAssistantSources/, `${label}: collectAssistantSources`);
  assert.match(brandApi, /collectOnboardingContent/, `${label}: collectOnboardingContent`);
  const modulesIndex = fs.readFileSync(
    path.join(server, "src/electron/modules/index.ts"),
    "utf8",
  );
  assert.match(modulesIndex, /collectNavPermissions/, `${label}: collectNavPermissions`);
  assert.match(modulesIndex, /collectPermissionGroups/, `${label}: collectPermissionGroups`);
  assert.match(modulesIndex, /collectOnboardingContent/, `${label}: F3.4 collectOnboardingContent`);
  const bindings = fs.readFileSync(
    path.join(server, "src/electron/brand-platform-bindings.ts"),
    "utf8",
  );
  assert.match(bindings, /applyBrandModuleAuth/, `${label}: applyBrandModuleAuth`);
  assert.match(bindings, /collectNavPermissions/, `${label}: bindings collectNavPermissions`);
  assert.match(brandApi, /createInteractiveDemoMount/, `${label}: mount interactive-demo`);
  assert.match(brandApi, /createOnboardingContentMount/, `${label}: mount onboarding`);
  assert.doesNotMatch(brandApi, /brandDemoScenarios\s*\(/);
  const main = fs.readFileSync(path.join(server, "src/electron/main.ts"), "utf8");
  assert.doesNotMatch(main, /listenBrandKernelHttp/);
  const srcFiles = walkTs(path.join(server, "src"));
  for (const f of srcFiles) {
    const rel = path.relative(server, f);
    const body = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(
      body,
      /new Hono\s*\(/,
      `${label}: Hono app parallèle interdit dans ${rel}`,
    );
  }
}

test("AL0 factory src : pas de brandDemoScenarios(", () => {
  for (const f of walkTs(FACTORY_SRC)) {
    const body = fs.readFileSync(f, "utf8");
    assert.doesNotMatch(
      body,
      /brandDemoScenarios\s*\(/,
      `factory ${path.relative(ROOT, f)} contient brandDemoScenarios(`,
    );
  }
});

test("AL1 brand create — allowlist (notes / crm / glue / registre)", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-allowlist-"));
  const appDir = path.join(work, "acme");
  const r = spawnSync(
    process.execPath,
    [
      CLI,
      "brand",
      "create",
      "--id",
      "acme",
      "--name",
      "Acme",
      "--domain",
      "acme.local",
      "--out",
      appDir,
      "--force",
      "--no-push",
    ],
    { encoding: "utf8", cwd: ROOT, env: SMOKE_ENV },
  );
  assert.equal(r.status, 0, r.stderr + "\n" + r.stdout);
  assertAppAllowlist(appDir, "brand create");
  assert.ok(fs.existsSync(path.join(`${appDir}-admin`, "server-admin.json")));
});
