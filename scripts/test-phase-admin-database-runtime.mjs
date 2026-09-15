/**
 * Gate — Admin Database auto-monté sur le kernel marque (core + brand).
 *
 * ADR.1b (dist anti-stale) est généralisé dans
 * scripts/test-phase-runtime-dist-freshness.mjs +
 * scripts/lib/assert-runtime-dist.mjs — ce fichier garde le contrat
 * database ciblé et délègue au SoT partagé.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { assertContentContracts } from "./lib/assert-runtime-dist.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("ADR.1 mount-brand-admin-database + proxy path database", () => {
  const src = fs.readFileSync(
    path.join(
      root,
      "packages/app-runtime/src/mount-brand-admin-database.ts",
    ),
    "utf8",
  );
  assert.match(src, /registerRuntimeDatabaseStores/);
  assert.match(src, /registerDatabaseStore/);
  assert.match(src, /id:\s*"brand"/);
  assert.match(src, /id:\s*"core"/);
  assert.match(src, /createAdminDatabaseRoutes/);

  const mcp = fs.readFileSync(
    path.join(root, "packages/app-runtime/src/mount-brand-mcp-surface.ts"),
    "utf8",
  );
  assert.match(mcp, /createBrandAdminDatabaseRoutes/);
  assert.match(mcp, /adminDatabaseHandlesPath/);

  const pkg = JSON.parse(
    fs.readFileSync(
      path.join(root, "packages/app-runtime/package.json"),
      "utf8",
    ),
  );
  const dbVersion = JSON.parse(
    fs.readFileSync(path.join(root, "packages/database/package.json"), "utf8"),
  ).version;
  assert.equal(pkg.dependencies["@creezio/database"], `^${dbVersion}`);
});

test("ADR.1b dist app-runtime câble database (anti dist stale)", () => {
  // Régression prod 0.3.15 : src montait Database mais dist gitignoré
  // n'avait pas été rebuild → mcpSurfaceHandlesPath n'interceptait pas
  // /api/v1/admin/database → fallthrough Next twin → « Route inconnue ».
  // SoT généralisé : assert-runtime-dist.mjs (content + mtime) — ici on
  // ancre encore le sous-ensemble Admin Database.
  const r = assertContentContracts(root, {
    contracts: [
      {
        id: "ADR.1b-app-runtime-admin-database",
        package: "app-runtime",
        src: "src/mount-brand-mcp-surface.ts",
        dist: "dist/mount-brand-mcp-surface.js",
        tokens: [
          "createBrandAdminDatabaseRoutes",
          "adminDatabaseHandlesPath",
          "MCP + database + analytics + request-logs",
        ],
      },
      {
        id: "ADR.1b-app-runtime-admin-database-handles",
        package: "app-runtime",
        src: "src/mount-brand-admin-database.ts",
        dist: "dist/mount-brand-admin-database.js",
        tokens: [
          "registerRuntimeDatabaseStores",
          "/api/v1/admin/database",
        ],
      },
    ],
  });
  assert.equal(r.ok, true, r.errors.join("\n") || "ADR.1b KO");
});

test("ADR.2 registre + GET /database/dbs liste core+brand", async () => {
  // Build dist requis (gate après npm run build -w @creezio/database|app-runtime).
  const dbDist = path.join(root, "packages/database/dist/index.js");
  const rtDist = path.join(
    root,
    "packages/app-runtime/dist/mount-brand-admin-database.js",
  );
  assert.ok(fs.existsSync(dbDist), "build @creezio/database manquant");
  assert.ok(fs.existsSync(rtDist), "build @creezio/app-runtime manquant");

  const { createSqliteRuntime } = await import(
    path.join(root, "packages/platform-core/dist/index.js")
  );
  const { demobrandManifest } = await import(
    path.join(root, "packages/brand-config/dist/index.js")
  );
  const {
    clearDatabaseStores,
    listDatabaseStores,
  } = await import(dbDist);
  const {
    createBrandAdminDatabaseRoutes,
    registerRuntimeDatabaseStores,
  } = await import(rtDist);

  const userDataRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "creezio-admin-db-"),
  );

  const runtime = createSqliteRuntime({
    ctx: {
      manifest: demobrandManifest,
      userDataRoot,
      isPackaged: true,
      env: {},
    },
  });

  try {
    clearDatabaseStores();
    registerRuntimeDatabaseStores(runtime);
    const listed = listDatabaseStores();
    assert.deepEqual(
      listed.map((s) => s.id).sort(),
      ["brand", "core"],
    );

    const routes = createBrandAdminDatabaseRoutes({
      runtime,
      brandId: "demo",
    });
    const dbsRes = await routes.request("/database/dbs");
    assert.equal(dbsRes.status, 200);
    const dbsBody = await dbsRes.json();
    assert.equal(dbsBody.ok, true);
    assert.ok(dbsBody.dbs.some((d) => d.id === "brand"));
    assert.ok(dbsBody.dbs.some((d) => d.id === "core"));
    assert.equal(dbsBody.defaultStoreId, "brand");

    // brand.db reçoit une table métier minimale
    runtime.getBrand().exec(
      `CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY,
        title TEXT
      );`,
    );
    const tablesRes = await routes.request(
      "/database/tables?db=brand&includeSystem=0",
    );
    assert.equal(tablesRes.status, 200);
    const tablesBody = await tablesRes.json();
    assert.equal(tablesBody.db, "brand");
    assert.ok(
      (tablesBody.tables || []).some((t) => t.name === "notes"),
      "notes attendu dans brand",
    );
  } finally {
    runtime.close();
    clearDatabaseStores();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});
