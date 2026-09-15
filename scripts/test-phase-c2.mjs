/**
 * Phase C2 — docs cutover Certivan.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("C2 PHASE-C2 + matrice / POST-H5", () => {
  const c2 = fs.readFileSync(path.join(ROOT, "docs/archive/PHASE-C2.md"), "utf8");
  assert.match(c2, /wrapMcpFacadeWithHonoProxy|setMcpUpstream/);
  assert.match(c2, /kit-core|cutover/);
  const post = fs.readFileSync(path.join(ROOT, "docs/archive/gates/POST-H5.md"), "utf8");
  assert.match(post, /C2.*fermées|dualités MCP\+stores fermées/i);
  const mat = fs.readFileSync(
    path.join(ROOT, "docs/archive/MATRICE-NATIVE-METIER-PLUGIN.md"),
    "utf8",
  );
  assert.match(mat, /Certivan C2|C2.*MCP/);
});
