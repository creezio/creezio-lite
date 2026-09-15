#!/usr/bin/env node
/**
 * Gate kit M7p — getHeartbeatExtras + dual-read CertivanEVENT ;
 * stubs Certivan absents si arbre présent.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const certivan = resolveBrandCrmRoot("certivan-app");
const fidu = resolveBrandCrmRoot("fidu");

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

check("getHeartbeatExtras + OPS_EVENT_PREFIXES dans kit", () => {
  const src = fs.readFileSync(
    path.join(root, "packages/observability/src/ops/fleet-agent.ts"),
    "utf8",
  );
  assert.ok(src.includes("getHeartbeatExtras"));
  const types = fs.readFileSync(
    path.join(root, "packages/observability/src/ops/types.ts"),
    "utf8",
  );
  assert.ok(types.includes("OPS_EVENT_PREFIXES"));
  assert.ok(types.includes("CertivanEVENT"));
  const obs = require(path.join(root, "packages/observability/dist-cjs/index.js"));
  assert.ok(Array.isArray(obs.OPS_EVENT_PREFIXES));
  const parsed = obs.parseOpsLine(
    'CertivanEVENT {"level":"event","kind":"index.done"}',
  );
  assert.equal(parsed?.kind, "index.done");
});

check("PHASE-M7p.md présent", () => {
  assert.ok(fs.existsSync(path.join(root, "docs/archive/PHASE-M7p.md")));
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-M7p.md"), "utf8");
  assert.ok(doc.includes("Certivan"));
  assert.ok(doc.includes("Fidu"));
});

if (fs.existsSync(path.join(certivan, "electron"))) {
  check("Certivan stubs fleet/ops absents", () => {
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
        !fs.existsSync(path.join(certivan, "electron", f)),
        `encore présent: ${f}`,
      );
    }
    assert.ok(
      fs.existsSync(path.join(certivan, "electron/fleet-dossier-samples.ts")),
      "métier dossier samples attendu",
    );
    const ctx = fs.readFileSync(
      path.join(certivan, "electron/host-runtime-ctx.ts"),
      "utf8",
    );
    assert.ok(ctx.includes("cvFleetAgent"));
    // O7 : fleet via createBrandHostRuntime({ fleet: … })
    assert.ok(
      ctx.includes("createFleetSamples") ||
        ctx.includes("createBrandHostRuntime") ||
        ctx.includes("fleet:"),
    );
  });
}

if (fs.existsSync(path.join(fidu, "electron"))) {
  check("Fidu : pas de stubs fleet/ops electron", () => {
    const files = fs.readdirSync(path.join(fidu, "electron"));
    const bad = files.filter(
      (f) =>
        /^(fleet-agent|fleet-telemetry|fleet-activity|fleet-samples|ops-journal|ops-emit|ops-rules|ops-types)\.ts$/.test(
          f,
        ),
    );
    assert.equal(bad.length, 0, `stubs inattendus: ${bad.join(",")}`);
    assert.ok(
      fs.existsSync(
        path.join(fidu, "vendor/creezio/observability/dist-cjs/ops/fleet-activity.js"),
      ),
      "vendor observability M7 attendu",
    );
  });
}

if (failed) {
  console.error(`\n${failed} échec(s) M7p`);
  process.exit(1);
}
console.log("\nOK test-phase-m7p");
