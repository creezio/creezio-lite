#!/usr/bin/env node
/**
 * Phase P25 — fleet-collector SoT dans `@creezio/observability` (D-P25).
 * Vérifie présence binaire neutre + lance le smoke spawn.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const collectorDir = path.join(root, "packages/observability/fleet-collector");

function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}:`, e.message || e);
    process.exitCode = 1;
  }
}

check("fleet-collector présent (server + ops-api + ui + test)", () => {
  for (const f of [
    "server.mjs",
    "ops-api.mjs",
    "env.mjs",
    "test-fleet-collector.mjs",
    "public/index.html",
    "README.md",
  ]) {
    const p = path.join(collectorDir, f);
    assert.ok(fs.existsSync(p), p);
  }
});

check("0 domaine marque hardcodé (server + ops-api + env)", () => {
  const blob = ["server.mjs", "ops-api.mjs", "env.mjs"]
    .map((f) => fs.readFileSync(path.join(collectorDir, f), "utf8"))
    .join("\n");
  assert.ok(!/tempoflow\.fr/i.test(blob), "tempoflow.fr interdit");
  assert.ok(!/certivan\.creez\.io/i.test(blob), "certivan.creez.io interdit");
  assert.ok(
    /CREEZIO_FLEET_|FLEET_PUBLIC_DOMAIN|TF2_FLEET_|CERTIVAN_FLEET_/.test(blob),
    "injection env attendue",
  );
});

check("package.json expose bin + files fleet-collector", () => {
  const pkg = JSON.parse(
    fs.readFileSync(
      path.join(root, "packages/observability/package.json"),
      "utf8",
    ),
  );
  assert.ok(pkg.files?.includes("fleet-collector"));
  assert.equal(
    pkg.bin?.["creezio-fleet-collector"],
    "./fleet-collector/server.mjs",
  );
  assert.ok(pkg.scripts?.["test:fleet-collector"]);
});

check("tarball npm observability embarque fleet-collector", () => {
  // Distribution npm : files du package publié (plus de sync vendor).
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "packages/observability/package.json"), "utf8"),
  );
  assert.ok(pkg.files?.includes("fleet-collector"), "files sans fleet-collector");
  assert.equal(
    pkg.publishConfig?.registry,
    "https://registry.npmjs.org",
    "observability non publiable npm",
  );
});

check("README observability documente collector", () => {
  const md = fs.readFileSync(
    path.join(root, "packages/observability/README.md"),
    "utf8",
  );
  assert.ok(md.includes("fleet-collector"));
  assert.ok(md.includes("configureUsageAnalytics"));
});

check("smoke test-fleet-collector.mjs", () => {
  const r = spawnSync(
    process.execPath,
    [path.join(collectorDir, "test-fleet-collector.mjs")],
    { encoding: "utf8", timeout: 30_000 },
  );
  if (r.status !== 0) {
    throw new Error(
      `exit ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
    );
  }
  assert.ok(/OK — fleet-collector/.test(r.stdout));
});

if (!process.exitCode) {
  console.log("OK — phase P25 (fleet-collector SoT)");
}
