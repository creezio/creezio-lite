#!/usr/bin/env node
/**
 * Tests Phase H2 — isolation runtime multi-DB + frontières API + MCP scindé
 * + preuve demobrand sandbox.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { demobrandManifest } from "../packages/brand-config/dist/index.js";
import {
  ARCHITECTURE_VERSION,
  composeMigrations,
  createSqliteRuntime,
  ensureDay0SqliteLayout,
  pluginDbExists,
  resolveCoreDbPath,
  resolvePluginDbPath,
} from "../packages/platform-core/dist/index.js";
import {
  CrossLayerWriteDeniedError,
  createApiKernel,
  createScopedDbAccess,
} from "../packages/api-kernel/dist/index.js";
import {
  createMcpFacade,
  signMcpJwt,
} from "../packages/mcp-facade/dist/index.js";
import { AUTH_CORE_SQL } from "../packages/auth/dist/index.js";
import { buildPluginImpactReport } from "../packages/product-hub/dist/index.js";
import { createDemobrandSandbox } from "../apps/demobrand/build/electron/sandbox-runtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tmpCtx() {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-h2-"));
  return {
    manifest: demobrandManifest,
    userDataRoot,
    isPackaged: true,
  };
}

test("H2.0 ARCHITECTURE_VERSION >= H2 (cadre évolutif)", () => {
  assert.match(ARCHITECTURE_VERSION, /^H([2-9]|\d{2,})$/);
});

test("H2.0 SqliteRuntime day0 = core+brand only ; plugin à openPlugin", () => {
  const ctx = tmpCtx();
  const runtime = createSqliteRuntime({
    ctx,
    coreMigrations: composeMigrations({
      id: "h2_001_auth",
      sql: AUTH_CORE_SQL,
    }),
    brandMigrations: composeMigrations({
      id: "h2_brand_001_notes",
      sql: `CREATE TABLE IF NOT EXISTS demobrand_notes (
        id TEXT PRIMARY KEY,
        body TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );`,
    }),
  });

  assert.ok(fs.existsSync(runtime.paths.core));
  assert.ok(fs.existsSync(runtime.paths.brand));
  assert.equal(runtime.listOpenPlugins().length, 0);
  assert.equal(pluginDbExists(ctx, "meteo"), false);
  assert.ok(runtime.getCore().listMigrations().includes("h2_001_auth"));
  assert.ok(runtime.getBrand().listMigrations().includes("h2_brand_001_notes"));

  // Pas de fichier plugin tant qu'on n'installe pas
  const pluginPath = resolvePluginDbPath(ctx, "meteo");
  assert.equal(fs.existsSync(pluginPath), false);

  const opened = runtime.openPlugin("meteo", [
    {
      id: "h2_plugin_001_kv",
      sql: `CREATE TABLE IF NOT EXISTS plugin_kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
      );`,
    },
  ]);
  assert.equal(opened.created, true);
  assert.ok(fs.existsSync(opened.handle.path));
  assert.deepEqual(runtime.listOpenPlugins(), ["meteo"]);
  assert.ok(opened.handle.listMigrations().includes("h2_plugin_001_kv"));

  // Re-open idempotent
  const again = runtime.openPlugin("meteo");
  assert.equal(again.created, false);

  runtime.close();
});

test("H2.1 migrations séparées par fichier (pas de fuite brand→core)", () => {
  const ctx = tmpCtx();
  const runtime = createSqliteRuntime({
    ctx,
    coreMigrations: composeMigrations({
      id: "h2_core_only",
      sql: `CREATE TABLE IF NOT EXISTS core_only_t (id TEXT PRIMARY KEY);`,
    }),
    brandMigrations: composeMigrations({
      id: "h2_brand_only",
      sql: `CREATE TABLE IF NOT EXISTS brand_only_t (id TEXT PRIMARY KEY);`,
    }),
  });

  const coreMigs = runtime.getCore().listMigrations();
  const brandMigs = runtime.getBrand().listMigrations();
  assert.ok(coreMigs.includes("h2_core_only"));
  assert.ok(!coreMigs.includes("h2_brand_only"));
  assert.ok(brandMigs.includes("h2_brand_only"));
  assert.ok(!brandMigs.includes("h2_core_only"));

  runtime.getBrand().exec(`INSERT INTO brand_only_t(id) VALUES ('b1')`);
  assert.throws(() => {
    runtime.getCore().exec(`SELECT * FROM brand_only_t`);
  }, /no such table/i);

  runtime.close();
});

test("H2.2 ScopedDbAccess : brand/plugin ne peuvent pas écrire core", () => {
  const ctx = tmpCtx();
  const runtime = createSqliteRuntime({
    ctx,
    coreMigrations: composeMigrations(),
    brandMigrations: composeMigrations(),
  });
  runtime.openPlugin("sidecarb");

  const brandDb = createScopedDbAccess(runtime, { kind: "brand" });
  assert.throws(
    () => brandDb.access({ kind: "core" }, "write"),
    (err) => err instanceof CrossLayerWriteDeniedError,
  );
  assert.throws(
    () => brandDb.access({ kind: "core" }, "read"),
    (err) => err instanceof CrossLayerWriteDeniedError,
  );

  const pluginDb = createScopedDbAccess(runtime, {
    kind: "plugin",
    pluginId: "sidecarb",
  });
  assert.throws(
    () => pluginDb.access({ kind: "core" }, "write"),
    (err) => err instanceof CrossLayerWriteDeniedError,
  );

  // core → brand OK (admin)
  const coreDb = createScopedDbAccess(runtime, { kind: "core" });
  const brandViaCore = coreDb.access({ kind: "brand" }, "write");
  assert.equal(brandViaCore.layer.kind, "brand");

  runtime.close();
});

test("H2.2 api-kernel intégration : cross-write + attack-core → 403", async () => {
  const ctx = tmpCtx();
  const runtime = createSqliteRuntime({
    ctx,
    coreMigrations: composeMigrations(),
    brandMigrations: composeMigrations({
      id: "h2_brand_notes",
      sql: `CREATE TABLE IF NOT EXISTS demobrand_notes (
        id TEXT PRIMARY KEY, body TEXT, created_at TEXT
      );`,
    }),
  });

  const api = createApiKernel({
    brandId: "demobrand",
    sqliteRuntime: runtime,
  });

  api.registerModuleApi("demo-notes", {
    handle: async ({ req, subPath, db }) => {
      if (subPath === "attack-core" && req.method === "POST") {
        db.access({ kind: "core" }, "write").exec(
          `INSERT INTO _creezio_schema_info(key,value) VALUES('x','1')`,
        );
        return { status: 200, body: { ok: true } };
      }
      if (subPath === "notes" && req.method === "POST") {
        db.prepare(
          `INSERT INTO demobrand_notes(id,body,created_at) VALUES(?,?,?)`,
        ).run("n1", "hello", new Date().toISOString());
        return { status: 201, body: { ok: true, layer: db.layer } };
      }
      return { status: 404, body: { ok: false } };
    },
  });

  const deniedPath = await api.handle({
    method: "POST",
    path: "/api/v1/modules/demo-notes/__cross/core",
    body: {},
  });
  assert.equal(deniedPath.status, 403);
  assert.equal(deniedPath.body.error, "cross_write_denied");

  const deniedDb = await api.handle({
    method: "POST",
    path: "/api/v1/modules/demo-notes/attack-core",
    body: {},
  });
  assert.equal(deniedDb.status, 403);
  assert.equal(deniedDb.body.error, "cross_layer_write_denied");

  const okBrand = await api.handle({
    method: "POST",
    path: "/api/v1/modules/demo-notes/notes",
    body: { body: "hello" },
  });
  assert.equal(okBrand.status, 201);
  assert.equal(okBrand.body.layer, "brand");

  const arch = await api.handle({
    method: "GET",
    path: "/api/v1/core/architecture",
  });
  assert.match(String(arch.body.architectureVersion), /^H([2-9]|\d{2,})$/);
  assert.equal(arch.body.isolation.scopedDb, true);
  assert.equal(arch.body.sqlite.coreOpen, true);

  runtime.close();
});

test("H2.3 mcp-facade listTools by space + listToolsBySpace", async () => {
  const secret = "h2-secret";
  const mcp = createMcpFacade({
    jwtSecret: secret,
    allowUnauthenticated: false,
    brandId: "demobrand",
    discoverToolsBySpace: async () => ({
      module: [
        {
          name: "module.demo.search",
          description: "stub module",
          space: "module",
          ownerId: "demo",
          handler: async () => ({ ok: true, content: { n: 1 } }),
        },
      ],
      plugin: [
        {
          name: "plugin.meteo.forecast",
          description: "stub plugin",
          space: "plugin",
          ownerId: "meteo",
          handler: async () => ({ ok: true, content: { c: 20 } }),
        },
      ],
    }),
  });

  const jwt = signMcpJwt(secret, {
    sub: "tester",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const bySpace = await mcp.listToolsBySpace({ bearerToken: jwt });
  assert.ok(bySpace.core.some((t) => t.name === "creezio.health"));
  assert.ok(
    bySpace.core.some((t) => t.name === "creezio.admin.list_tools_by_space"),
  );
  assert.equal(bySpace.module.length, 1);
  assert.equal(bySpace.plugin.length, 1);

  const onlyModule = await mcp.listTools({
    bearerToken: jwt,
    space: "module",
  });
  assert.equal(onlyModule.tools.length, 1);
  assert.equal(onlyModule.tools[0].name, "module.demo.search");

  const listed = await mcp.callTool(
    "creezio.admin.list_tools_by_space",
    {},
    { bearerToken: jwt },
  );
  assert.equal(listed.ok, true);
  assert.ok(listed.content.bySpace.module.length >= 1);
});

test("H2.4 demobrand sandbox E2E multi-DB + isolation", async () => {
  const sandbox = createDemobrandSandbox();
  try {
    const st = sandbox.runtime.status();
    assert.equal(st.coreOpen, true);
    assert.equal(st.brandOpen, true);
    assert.equal(st.openPlugins.length, 0);

    const note = await sandbox.api.handle({
      method: "POST",
      path: "/api/v1/modules/demo-notes/notes",
      body: { body: "sandbox-note" },
    });
    assert.equal(note.status, 201);
    assert.equal(note.body.layer, "brand");

    const attack = await sandbox.api.handle({
      method: "POST",
      path: "/api/v1/modules/demo-notes/attack-core",
      body: {},
    });
    assert.equal(attack.status, 403);

    const installed = sandbox.installPlugin("meteo-demo");
    assert.equal(installed.created, true);
    assert.ok(fs.existsSync(installed.path));
    assert.ok(installed.path.includes(`${path.sep}plugin${path.sep}`));

    const kv = await sandbox.api.handle({
      method: "POST",
      path: "/api/v1/plugins/meteo-demo/kv",
      body: { key: "city", value: "Paris" },
    });
    assert.equal(kv.status, 201);
    assert.equal(kv.body.layer, "plugin");

    const plugAttack = await sandbox.api.handle({
      method: "POST",
      path: "/api/v1/plugins/meteo-demo/attack-core",
      body: {},
    });
    assert.equal(plugAttack.status, 403);

    // Product Hub sur core
    const impact = buildPluginImpactReport({
      name: "Plugin météo",
      description: "sandbox",
      evidence: [],
    });
    const { product } = sandbox.productHub.createRequest({
      name: "Plugin météo",
      description: "sandbox",
      impact,
    });
    assert.ok(product.id);

    const mcpTools = await sandbox.mcp.listToolsBySpace();
    assert.ok(mcpTools.module.some((t) => t.name === "module.demo-notes.list"));
    assert.ok(
      mcpTools.plugin.some((t) => t.name === "plugin.meteo-demo.kv_list"),
    );

    // Fresh day0 layout helper toujours cohérent
    const day0 = ensureDay0SqliteLayout(sandbox.ctx);
    assert.equal(day0.core, resolveCoreDbPath(sandbox.ctx));
  } finally {
    sandbox.close();
  }
});

test("H2 docs + demobrand sandbox source présents", () => {
  for (const rel of [
    "docs/archive/BACKLOG-H2.md",
    "docs/archive/PHASE-H2.md",
    "apps/demobrand/src/electron/sandbox-runtime.ts",
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);
  }
  const main = fs.readFileSync(
    path.join(ROOT, "apps/demobrand/src/electron/main.ts"),
    "utf8",
  );
  assert.match(main, /startBrandDesktop/);
  assert.match(main, /createDemobrandSandbox/);
  assert.match(main, /setDemobrandProductHubStore/);
  assert.match(main, /bootKernel/);
  assert.doesNotMatch(main, /prepareDesktopBoot/);
});
