/**
 * Phase I6 — createFileOrgPluginRegistry persisté + reopen.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createFileOrgPluginRegistry,
  snapshotOrgPluginRegistry,
} from "../packages/propagation/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("I6 file registry upsert/review survit au reopen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-i6-reg-"));
  const filePath = path.join(dir, "org-plugin-registry.json");
  const r1 = createFileOrgPluginRegistry({ filePath });
  r1.upsert({
    pluginId: "meteo",
    brandId: "tempoflow",
    orgId: "org-1",
    createdByUserId: "u1",
    name: "Météo",
    version: "0.1.0",
    visibility: "owner_only",
    deployedAt: ["L4-user"],
    createdAt: new Date().toISOString(),
  });
  r1.submitForOrgReview("meteo");
  assert.equal(r1.get("meteo")?.visibility, "pending_review");
  assert.ok(fs.existsSync(filePath));

  const r2 = createFileOrgPluginRegistry({ filePath });
  const restored = r2.get("meteo");
  assert.ok(restored);
  assert.equal(restored.visibility, "pending_review");
  assert.equal(restored.brandId, "tempoflow");
  r2.proposeVerticalPromotion("meteo");
  assert.equal(r2.get("meteo")?.visibility, "promoted_vertical");

  const r3 = createFileOrgPluginRegistry({ filePath });
  assert.equal(r3.get("meteo")?.visibility, "promoted_vertical");
  const snap = snapshotOrgPluginRegistry(r3);
  assert.equal(snap.count, 1);
});

test("I6 console API + panel sources présents", () => {
  for (const p of [
    "apps/console/src/app/api/org-plugins/route.ts",
    "apps/console/src/lib/org-plugin-registry.ts",
    "apps/console/src/components/OrgPluginsPanel.tsx",
    "docs/archive/PHASE-I6.md",
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), p);
  }
});
