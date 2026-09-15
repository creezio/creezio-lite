#!/usr/bin/env node
/**
 * Tests Phase F — propagation (semver, impacts, canaux, registre L3, hooks, console).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DOWNWARD_CHAIN,
  EXTENSION_POINTS,
  KIT_PACKAGES,
  KIT_PACKAGE_NAMES,
  PHASE_G_GATES,
  SEMVER_POLICY_SUMMARY,
  UPWARD_CHAIN,
  UPDATE_CHANNELS,
  applyBump,
  assertKitPackage,
  buildAllBrandPrPayloads,
  bumpKindFromCommit,
  bumpKindFromCommits,
  collectKitInventory,
  compareSemver,
  configureBrandChannels,
  createExtensionHookBus,
  createMemoryOrgPluginRegistry,
  formatImpactReport,
  impactForPackageBump,
  publishedHintsFromInventory,
  resetBrandChannelsForTests,
  snapshotOrgPluginRegistry,
  transitiveDependents,
} from "../packages/propagation/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("catalogue packages @creezio/* complet", () => {
  assert.ok(KIT_PACKAGE_NAMES.includes("@creezio/platform-core"));
  assert.ok(KIT_PACKAGE_NAMES.includes("@creezio/propagation"));
  assert.ok(KIT_PACKAGE_NAMES.includes("@creezio/product-hub"));
  assert.ok(KIT_PACKAGES.length >= 8);
  assert.ok(KIT_PACKAGE_NAMES.includes("@creezio/api-kernel"));
  assert.ok(KIT_PACKAGE_NAMES.includes("@creezio/shell-ui"));
  assert.equal(assertKitPackage("@creezio/platform-core"), "@creezio/platform-core");
});

test("semver policy conventional commits", () => {
  assert.equal(bumpKindFromCommit("feat: add X"), "minor");
  assert.equal(bumpKindFromCommit("fix: bug"), "patch");
  assert.equal(bumpKindFromCommit("feat!: break API"), "major");
  assert.equal(bumpKindFromCommit("chore: tidy"), "none");
  assert.equal(
    bumpKindFromCommits(["chore: a", "fix: b", "feat: c"]),
    "minor",
  );
  assert.equal(applyBump("0.1.0", "minor"), "0.2.0");
  assert.equal(applyBump("0.2.3", "major"), "1.0.0");
  assert.equal(compareSemver("0.2.0", "0.1.9"), 1);
  assert.ok(SEMVER_POLICY_SUMMARY.rules.length >= 4);
});

test("impact bump platform-core → surfaces + gates G1-G3", () => {
  const impact = impactForPackageBump({
    packageName: "@creezio/platform-core",
    bumpKind: "minor",
  });
  assert.ok(impact.rebuildPackages.includes("@creezio/electron-shell"));
  assert.ok(impact.surfaces.includes("electron-main"));
  assert.deepEqual(impact.brands, []);
  assert.equal(impact.gates.length, 0);
  const report = formatImpactReport(impact);
  assert.match(report, /platform-core/);
  assert.match(report, /G1/);
});

test("impact factory → demobrand seulement", () => {
  const impact = impactForPackageBump({
    packageName: "@creezio/factory",
    bumpKind: "patch",
  });
  assert.deepEqual(impact.brands, ["demobrand"]);
  assert.equal(impact.gates.length, 0);
});

test("impact propagation → aucune surface marque", () => {
  const impact = impactForPackageBump({
    packageName: "@creezio/propagation",
    bumpKind: "patch",
  });
  assert.equal(impact.surfaces.length, 0);
  assert.equal(impact.brands.length, 0);
});

test("canaux PR marques — data-driven (configureBrandChannels)", () => {
  try {
    configureBrandChannels([
      { brandId: "acme", label: "Acme", targetHint: "acme/acme" },
    ]);
    const impact = impactForPackageBump({
      packageName: "@creezio/electron-shell",
      bumpKind: "minor",
    });
    const prs = buildAllBrandPrPayloads(impact);
    assert.ok(prs.some((p) => p.brandId === "acme"));
    const acme = prs.find((p) => p.brandId === "acme");
    assert.match(acme.bodyMarkdown, /Surfaces/);
    assert.ok(UPDATE_CHANNELS.length >= 3);
  } finally {
    resetBrandChannelsForTests();
  }
});

test("registre plugins org L3 + remontée", () => {
  const reg = createMemoryOrgPluginRegistry([
    {
      pluginId: "plg-meteo",
      brandId: "acme",
      orgId: "org-resto-1",
      createdByUserId: "user-42",
      name: "Météo cuisine",
      version: "0.1.0",
      visibility: "owner_only",
      deployedAt: ["L4-user"],
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    },
  ]);
  const reviewed = reg.submitForOrgReview("plg-meteo");
  assert.equal(reviewed.visibility, "pending_review");
  assert.ok(reviewed.deployedAt.includes("L3-org"));
  const vertical = reg.proposeVerticalPromotion("plg-meteo");
  assert.equal(vertical.visibility, "promoted_vertical");
  const kit = reg.proposeKitPromotion("plg-meteo");
  assert.equal(kit.visibility, "promoted_kit");
  assert.ok(kit.deployedAt.includes("L1-core"));
  const snap = snapshotOrgPluginRegistry(reg);
  assert.equal(snap.count, 1);
});

test("extension points descente + remontée", async () => {
  assert.equal(DOWNWARD_CHAIN.length, 4);
  assert.equal(UPWARD_CHAIN.length, 4);
  assert.ok(EXTENSION_POINTS.length >= 8);
  const bus = createExtensionHookBus();
  const seen = [];
  bus.on("kit.release.published", (p) => {
    seen.push(p.pointId);
  });
  bus.on("user.plugin.created", (p) => {
    seen.push(p.pointId);
  });
  await bus.emit({
    pointId: "kit.release.published",
    direction: "downward",
    levelFrom: "L1-core",
    levelTo: "L2-vertical",
    packageName: "@creezio/platform-core",
    version: "0.2.0",
  });
  await bus.emit({
    pointId: "user.plugin.created",
    direction: "upward",
    levelFrom: "L4-user",
    levelTo: "L3-org",
    pluginId: "plg-x",
    brandId: "certivan",
  });
  assert.deepEqual(seen, ["kit.release.published", "user.plugin.created"]);
  assert.equal(bus.history().length, 2);
});

test("inventaire kit local", () => {
  const inv = collectKitInventory(ROOT);
  assert.ok(inv.packages.length >= 8);
  const prop = inv.packages.find((p) => p.name === "@creezio/propagation");
  assert.ok(prop?.local);
  // Version lue depuis le package (bumpee par changesets a chaque release).
  const propPkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "packages/propagation/package.json"), "utf8"),
  );
  assert.equal(prop.version, propPkg.version);
  const hints = publishedHintsFromInventory(inv);
  assert.ok(hints.every((h) => h.publishChannel === "workspace-local"));
});

test("gates G1→G2→G3 documentées", () => {
  assert.deepEqual(
    PHASE_G_GATES.map((g) => g.id),
    ["G1", "G2", "G3"],
  );
  for (const g of PHASE_G_GATES) {
    const p = path.join(ROOT, g.doc);
    assert.ok(fs.existsSync(p), `missing ${g.doc}`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, "docs/PROPAGATION.md")));
  assert.ok(fs.existsSync(path.join(ROOT, "docs/archive/PHASE-F.md")));
  assert.ok(
    fs.existsSync(
      path.join(ROOT, ".github/PULL_REQUEST_TEMPLATE/kit-bump.md"),
    ),
  );
});

test("CLI kit:version + kit:impact dry-run", () => {
  const r = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/kit-version.mjs"),
      "--impact-only",
      "--package=@creezio/platform-core",
      "--bump=minor",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /platform-core/);
  assert.match(r.stdout, /electron-shell/);
  assert.match(r.stdout, /G1/);

  const r2 = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts/propagation-impact.mjs"),
      "--package=product-hub",
      "--json",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(r2.status, 0, r2.stderr);
  const j = JSON.parse(r2.stdout);
  assert.equal(j.impact.packageName, "@creezio/product-hub");
});

test("console expose API kit-versions + gates", () => {
  const api = path.join(ROOT, "apps/console/src/app/api/kit-versions/route.ts");
  const page = path.join(ROOT, "apps/console/src/app/page.tsx");
  assert.ok(fs.existsSync(api));
  const pageSrc = fs.readFileSync(page, "utf8");
  assert.match(pageSrc, /KitVersionsPanel|kit-versions|PHASE_G_GATES|GatesPanel/);
  assert.match(pageSrc, /G1|PROPAGATION/);
});

test("transitiveDependents brand-config inclut electron-shell", () => {
  const deps = transitiveDependents("@creezio/brand-config");
  assert.ok(deps.includes("@creezio/platform-core"));
  assert.ok(deps.includes("@creezio/electron-shell"));
  assert.ok(deps.includes("@creezio/propagation"));
});
