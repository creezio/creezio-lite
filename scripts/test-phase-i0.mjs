/**
 * Phase I0 — gouvernance : ARCHITECTURE_VERSION, docs, console kit.
 * (Le contrat « sync vendor » a disparu avec la distribution npm — les
 * marques consomment des packages publiés, plus de vendor à synchroniser.)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function exists(p) {
  return fs.existsSync(path.join(ROOT, p));
}

test("I0 docs livrables présents", () => {
  for (const p of [
    "docs/archive/PHASE-I0.md",
    "docs/archive/BACKLOG-I0.md",
    "docs/archive/REPUBLISH-POLICY.md",
    "docs/archive/gates/POST-H5.md",
  ]) {
    assert.ok(exists(p), `missing ${p}`);
  }
});

test("I0 ARCHITECTURE_VERSION signée (H5+)", () => {
  const f = path.join(
    ROOT,
    "packages/platform-core/src/architecture-version.ts",
  );
  const s = fs.readFileSync(f, "utf8");
  const m = /ARCHITECTURE_VERSION\s*=\s*["']([^"']+)["']/.exec(s);
  assert.ok(m, "ARCHITECTURE_VERSION introuvable");
  assert.match(m[1], /^H([5-9]|\d{2,})$/);
});

test("I0 console expose architectureVersion", () => {
  const kitTs = fs.readFileSync(
    path.join(ROOT, "apps/console/src/lib/kit.ts"),
    "utf8",
  );
  assert.match(kitTs, /architectureVersion/);
  assert.match(kitTs, /readArchitectureVersion/);
  const route = fs.readFileSync(
    path.join(ROOT, "apps/console/src/app/api/kit-versions/route.ts"),
    "utf8",
  );
  assert.match(route, /architectureVersion/);
  const panel = fs.readFileSync(
    path.join(ROOT, "apps/console/src/components/KitVersionsPanel.tsx"),
    "utf8",
  );
  assert.match(panel, /ARCHITECTURE_VERSION/);
});

test("I0 PROPAGATION mappe packages H3–H5", () => {
  const p = fs.readFileSync(path.join(ROOT, "docs/PROPAGATION.md"), "utf8");
  for (const name of ["api-kernel", "mcp-facade", "shell-ui", "auth", "assistant"]) {
    assert.match(p, new RegExp(`\`${name}\``), `PROPAGATION missing ${name}`);
  }
  assert.match(p, /REPUBLISH-POLICY/);
});
