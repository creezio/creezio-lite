/**
 * Phase M2p — Admin UI Database Certivan puis Fidu (vision stricte).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const certivan = resolveBrandCrmRoot("certivan-app");
const fidu = resolveBrandCrmRoot("fidu");

test("M2p.1 PHASE-M2p.md séquentiel Certivan→Fidu", () => {
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-M2p.md"), "utf8");
  assert.match(doc, /Certivan/);
  assert.match(doc, /Fidu/);
  assert.match(doc, /@creezio\/database\/ui/);
  assert.match(doc, /createAdminDatabaseRoutes/);
});

test("M2p.2 Certivan : panels absents + kit UI/route", () => {
  assert.equal(
    fs.existsSync(path.join(certivan, "src/components/admin/database-client.tsx")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(certivan, "src/components/admin/database")),
    false,
  );
  const page = fs.readFileSync(
    path.join(certivan, "src/app/admin/database/page.tsx"),
    "utf8",
  );
  assert.match(page, /@creezio\/database\/ui/);
  const route = fs.readFileSync(
    path.join(certivan, "src/server/routes/admin-database.ts"),
    "utf8",
  );
  assert.match(route, /createAdminDatabaseRoutes/);
  assert.ok(route.split("\n").length <= 150);
  assert.ok(
    fs.existsSync(path.join(certivan, "vendor/creezio/database/ui/database-client.tsx")),
  );
});

test("M2p.3 Fidu : UI kit branchée + pas de panel local", () => {
  assert.equal(
    fs.existsSync(path.join(fidu, "src/components/admin/database-client.tsx")),
    false,
  );
  const page = fs.readFileSync(
    path.join(fidu, "src/app/admin/database/page.tsx"),
    "utf8",
  );
  assert.match(page, /@creezio\/database\/ui/);
  const route = fs.readFileSync(
    path.join(fidu, "src/server/routes/admin-database.ts"),
    "utf8",
  );
  assert.match(route, /createAdminDatabaseRoutes/);
  const app = fs.readFileSync(path.join(fidu, "src/server/app.ts"), "utf8");
  assert.match(app, /adminDatabaseRoutes/);
  assert.ok(
    fs.existsSync(path.join(fidu, "vendor/creezio/database/ui/database-client.tsx")),
  );
});
