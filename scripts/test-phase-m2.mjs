/**
 * Phase M2 — Admin UI Database hors TF (vision stricte).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tfCrm = resolveBrandCrmRoot("tempoflow2");
const dbPkg = path.join(root, "packages/database");

test("M2.1 PHASE-M2.md exige panels kit + route mince", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-M2.md"), "utf8");
  assert.match(doc, /@creezio\/database\/ui/);
  assert.match(doc, /createAdminDatabaseRoutes/);
  assert.match(doc, /≤\s*~?150|mince/i);
  assert.doesNotMatch(doc, /stub = done|façade OK/);
});

test("M2.2 kit expose UI source + createAdminDatabaseRoutes", () => {
  assert.ok(fs.existsSync(path.join(dbPkg, "ui/database-client.tsx")));
  assert.ok(
    fs.existsSync(path.join(dbPkg, "ui/database-automations-panel.tsx")),
  );
  assert.ok(fs.existsSync(path.join(dbPkg, "ui/index.ts")));
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dbPkg, "package.json"), "utf8"),
  );
  assert.ok(pkg.exports?.["./ui"]);
  const idx = fs.readFileSync(path.join(dbPkg, "src/index.ts"), "utf8");
  assert.match(idx, /createAdminDatabaseRoutes/);
  assert.ok(fs.existsSync(path.join(dbPkg, "dist/http/admin-routes.js")));
});

test("M2.3 tarball npm @creezio/database embarque ui/", () => {
  // Distribution npm : le champ `files` du package publie ui/ (consommé par
  // les apps via @creezio/database/ui depuis node_modules).
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dbPkg, "package.json"), "utf8"),
  );
  assert.ok(
    Array.isArray(pkg.files) && pkg.files.includes("ui"),
    "@creezio/database: files sans ui/ — les apps npm ne verraient pas database/ui",
  );
});

test("M2.4 TF : panels absents, page + route kit", () => {
  assert.equal(
    fs.existsSync(path.join(tfCrm, "src/components/admin/database-client.tsx")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(tfCrm, "src/components/admin/database")),
    false,
  );

  const page = fs.readFileSync(
    path.join(tfCrm, "src/app/admin/database/page.tsx"),
    "utf8",
  );
  assert.match(page, /from ["']@creezio\/database\/ui["']/);
  assert.doesNotMatch(page, /@\/components\/admin\/database-client/);

  const route = fs.readFileSync(
    path.join(tfCrm, "src/server/routes/admin-database.ts"),
    "utf8",
  );
  assert.match(route, /createAdminDatabaseRoutes/);
  assert.match(route, /brand-host|installDatabaseHost/);
  const loc = route.split("\n").length;
  assert.ok(loc <= 150, `admin-database.ts trop long: ${loc}`);
});
