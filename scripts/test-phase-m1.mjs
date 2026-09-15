/**
 * Phase M1 — cutover Database TF sans shims (vision stricte).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tfCrm = resolveBrandCrmRoot("tempoflow2");

test("M1.1 PHASE-M1.md existe et exige suppression shims", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-M1.md"), "utf8");
  assert.match(doc, /sans shims|src\/lib\/database/i);
  assert.match(doc, /@creezio\/database/);
  assert.match(doc, /brand-database-host|brand-host/);
  assert.doesNotMatch(doc, /stub = done|façade OK/);
});

test("M1.2 TF n’a plus de dossier src/lib/database", () => {
  assert.equal(
    fs.existsSync(path.join(tfCrm, "src/lib/database")),
    false,
    "crm/src/lib/database doit être absent (vision M1)",
  );
});

test("M1.3 TF consumers importent @creezio/database (pas lib/database)", () => {
  const route = fs.readFileSync(
    path.join(tfCrm, "src/server/routes/admin-database.ts"),
    "utf8",
  );
  assert.match(route, /from ["']@creezio\/database["']/);
  assert.doesNotMatch(route, /from ["']@\/lib\/database/);

  const host = fs.readFileSync(
    path.join(tfCrm, "src/lib/brand-host.ts"),
    "utf8",
  );
  assert.match(host, /configureDatabasePolicy|installDatabaseHost/);
  assert.match(host, /from ["']@creezio\/database["']/);

  const db = fs.readFileSync(path.join(tfCrm, "src/lib/db.ts"), "utf8");
  assert.match(db, /@creezio\/database/);
  assert.doesNotMatch(db, /\.\/database\//);
});

test("M1.4 package @creezio/database buildable / exports présents", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "packages/database/package.json"), "utf8"),
  );
  assert.equal(pkg.name, "@creezio/database");
  assert.ok(fs.existsSync(path.join(root, "packages/database/dist/index.js")));
  const idx = fs.readFileSync(
    path.join(root, "packages/database/src/index.ts"),
    "utf8",
  );
  assert.match(idx, /listCatalog/);
  assert.match(idx, /configureDatabasePolicy/);
});
