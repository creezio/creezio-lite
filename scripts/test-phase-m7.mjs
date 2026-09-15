#!/usr/bin/env node
/**
 * Gate kit M7 — fleet-activity / fleet-samples dans @creezio/observability ;
 * stubs TF absents (vérif chemin TF si présent).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tfRoot = resolveBrandCrmRoot("tempoflow2");

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`✗ ${name}:`, e instanceof Error ? e.message : e);
  }
}

check("exports fleet-activity + createFleetSamples", () => {
  const obs = require(path.join(root, "packages/observability/dist-cjs/index.js"));
  assert.equal(typeof obs.recordFleetAction, "function");
  assert.equal(typeof obs.setFleetSessionContext, "function");
  assert.equal(typeof obs.sampleFleetActions, "function");
  assert.equal(typeof obs.createFleetSamples, "function");
  assert.equal(typeof obs.createFleetAgent, "function");
  assert.equal(typeof obs.initOpsJournal, "function");
});

check("fleet-activity ring + dedupe", () => {
  const obs = require(path.join(root, "packages/observability/dist-cjs/index.js"));
  obs._resetFleetActivityForTests();
  obs.setFleetSessionContext({ userId: "u1", username: "a", sessionId: "s1" });
  const a = obs.recordFleetAction({
    name: "page.view",
    type: "page.view",
    label: "X",
    path: "/x",
  });
  assert.ok(a);
  assert.equal(a.userId, "u1");
  assert.equal(
    obs.recordFleetAction({
      name: "page.view",
      type: "page.view",
      label: "X",
      path: "/x",
    }),
    null,
  );
});

check("src ops/fleet-activity + fleet-samples présents", () => {
  assert.ok(
    fs.existsSync(path.join(root, "packages/observability/src/ops/fleet-activity.ts")),
  );
  assert.ok(
    fs.existsSync(path.join(root, "packages/observability/src/ops/fleet-samples.ts")),
  );
  const idx = fs.readFileSync(
    path.join(root, "packages/observability/src/index.ts"),
    "utf8",
  );
  assert.ok(idx.includes("createFleetSamples"));
  assert.ok(idx.includes("recordFleetAction"));
});

check("PHASE-M7.md présent", () => {
  assert.ok(fs.existsSync(path.join(root, "docs/archive/PHASE-M7.md")));
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-M7.md"), "utf8");
  assert.ok(doc.includes("fleet-agent"));
  assert.ok(doc.includes("@creezio/observability"));
});

if (fs.existsSync(path.join(tfRoot, "electron"))) {
  check("TF stubs fleet/ops absents", () => {
    for (const f of [
      "fleet-agent.ts",
      "ops-journal.ts",
      "ops-emit.ts",
      "ops-rules.ts",
      "ops-types.ts",
      "fleet-telemetry.ts",
      "fleet-activity.ts",
      "fleet-samples.ts",
    ]) {
      assert.ok(
        !fs.existsSync(path.join(tfRoot, "electron", f)),
        `stub encore présent: ${f}`,
      );
    }
  });

  check("TF host-runtime-ctx wiring fleet", () => {
    const src = fs.readFileSync(
      path.join(tfRoot, "electron/host-runtime-ctx.ts"),
      "utf8",
    );
    assert.ok(src.includes("tfFleetAgent"));
    assert.ok(src.includes("tfFleetSamples"));
    // O7 : fleet via createBrandHostRuntime({ fleet: … }) dans le kit
    assert.ok(
      src.includes("createFleetAgent") ||
        src.includes("createBrandHostRuntime"),
    );
    assert.ok(
      src.includes("createFleetSamples") || src.includes("fleet:"),
    );
  });
}

if (failed) {
  console.error(`\n${failed} échec(s) M7`);
  process.exit(1);
}
console.log("\nOK test-phase-m7");
