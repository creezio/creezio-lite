#!/usr/bin/env node
/**
 * Tests Phase H1 — sqlite layout, api-kernel, mcp-facade, auth, shell-ui,
 * assistant, tasks, mails, product-hub sqlite store.
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
  ensureDay0SqliteLayout,
  ensurePluginDb,
  pluginDbExists,
  resolveBrandDbPath,
  resolveCoreDbPath,
  resolveDbPath,
  resolvePluginDbPath,
  resolveSqliteRoot,
} from "../packages/platform-core/dist/index.js";
import { createApiKernel } from "../packages/api-kernel/dist/index.js";
import {
  createMcpFacade,
  signMcpJwt,
} from "../packages/mcp-facade/dist/index.js";
import {
  bindAuthIpcHandlers,
  createMemoryAuthStore,
} from "../packages/auth/dist/index.js";
import {
  CORE_NAV_ITEMS,
  createNavRegistry,
  mergeNav,
} from "../packages/shell-ui/dist/index.js";
import { createMemoryAssistantStore } from "../packages/assistant/dist/index.js";
import {
  createMemoryTasksStore,
  createTasksApiMount,
} from "../packages/tasks/dist/index.js";
import {
  createSqliteMailsStore,
  createMailsApiMount,
} from "../packages/mails/dist/index.js";
import {
  buildPluginImpactReport,
  createSqliteProductHubStore,
} from "../packages/product-hub/dist/index.js";
import { KIT_PACKAGE_NAMES } from "../packages/propagation/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tmpCtx() {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-h1-"));
  return {
    manifest: demobrandManifest,
    userDataRoot,
    isPackaged: true,
  };
}

test("H1.0 ARCHITECTURE_VERSION >= H1 (cadre évolutif)", () => {
  // H1 a introduit la constante ; H2+ la bump — on vérifie qu'elle reste définie.
  assert.match(ARCHITECTURE_VERSION, /^H[1-9]\d*$/);
});

test("H1.0 sqlite paths core/brand/plugin + soft alias resolveDbPath", () => {
  const ctx = tmpCtx();
  const core = resolveCoreDbPath(ctx);
  const brand = resolveBrandDbPath(ctx);
  const legacy = resolveDbPath(ctx);
  assert.equal(brand, legacy);
  assert.match(core, /sqlite[/\\]core\.db$/);
  assert.equal(path.basename(brand), demobrandManifest.dbFileName);
  assert.equal(resolveSqliteRoot(ctx), path.join(ctx.userDataRoot, "sqlite"));

  const day0 = ensureDay0SqliteLayout(ctx, { touchBrand: true });
  assert.ok(fs.existsSync(day0.core));
  assert.ok(fs.existsSync(day0.brand));
  assert.equal(pluginDbExists(ctx, "demo-plugin"), false);

  const ensured = ensurePluginDb(ctx, "demo-plugin");
  assert.equal(ensured.created, true);
  assert.ok(fs.existsSync(ensured.path));
  assert.equal(resolvePluginDbPath(ctx, "demo-plugin"), ensured.path);
  assert.throws(() => resolvePluginDbPath(ctx, "BAD"), /invalide/);
});

test("H1.1 api-kernel health/version/architecture + mounts + cross-write deny", async () => {
  const api = createApiKernel({ brandId: "demobrand", appVersion: "0.1.0" });
  const health = await api.handle({
    method: "GET",
    path: "/api/v1/core/health",
  });
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);

  const version = await api.handle({
    method: "GET",
    path: "/api/v1/core/version",
  });
  assert.match(version.body.architectureVersion, /^H[1-9]\d*$/);

  const arch = await api.handle({
    method: "GET",
    path: "/api/v1/core/architecture",
  });
  assert.deepEqual(arch.body.sqliteLayout, ["core", "brand", "plugin/<id>"]);

  api.registerModuleApi("catalog", {
    handle: async ({ subPath }) => ({
      status: 200,
      body: { ok: true, subPath },
    }),
  });
  const mod = await api.handle({
    method: "GET",
    path: "/api/v1/modules/catalog/items",
  });
  assert.equal(mod.body.subPath, "items");

  api.registerPluginApi("meteo", {
    handle: async () => ({ status: 200, body: { ok: true } }),
  });
  const denied = await api.handle({
    method: "POST",
    path: "/api/v1/plugins/meteo/__cross/core",
    body: {},
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, "cross_write_denied");

  assert.equal(api.listMounts().length, 2);
  // Zéro route métier TF hardcodée (éviter faux positifs type dispatchMount)
  const src = fs.readFileSync(
    path.join(ROOT, "packages/api-kernel/src/kernel.ts"),
    "utf8",
  );
  assert.doesNotMatch(src, /\bpanier\b|\btempoflow\b|\/dispatch\b/i);
  assert.doesNotMatch(src, /registerModuleApi\(["']panier["']/);
});

test("H1.2 mcp-facade découverte vide + stub + JWT", async () => {
  const secret = "test-secret-h1";
  const api = createApiKernel({ brandId: "demobrand" });
  const mcp = createMcpFacade({
    jwtSecret: secret,
    brandId: "demobrand",
    listApiMounts: () => api.listMounts(),
    discoverTools: async () => [],
  });
  const jwt = signMcpJwt(secret, { sub: "tester", exp: Math.floor(Date.now() / 1000) + 3600 });
  const empty = await mcp.listTools({ bearerToken: jwt });
  assert.ok(empty.tools.some((t) => t.name === "creezio.health"));
  assert.equal(
    empty.tools.filter((t) => t.space !== "core").length,
    0,
  );

  mcp.setDiscoverTools(async () => [
    {
      name: "module.catalog.search",
      description: "stub",
      space: "module",
      ownerId: "catalog",
      handler: async () => ({ ok: true, content: { hits: 1 } }),
    },
  ]);
  const withStub = await mcp.listTools({ bearerToken: secret });
  assert.ok(withStub.tools.some((t) => t.name === "module.catalog.search"));
  const call = await mcp.callTool("module.catalog.search", {}, { bearerToken: jwt });
  assert.equal(call.ok, true);
  assert.equal(call.content.hits, 1);

  await assert.rejects(
    () => mcp.listTools({ bearerToken: "bad" }),
    /invalid|unauthorized/,
  );
});

test("H1.3 auth login/logout mémoire + IPC bind", async () => {
  const store = createMemoryAuthStore();
  await store.register({
    email: "user@demo.test",
    password: "secret-pass",
    displayName: "Demo",
  });
  const session = await store.login({
    email: "user@demo.test",
    password: "secret-pass",
    stayLoggedIn: true,
  });
  assert.ok(session.token);
  assert.equal(session.user.email, "user@demo.test");
  const account = await store.getAccount(session.token);
  assert.equal(account.displayName, "Demo");
  assert.equal(await store.logout(session.token), true);
  assert.equal(await store.getSession(session.token), null);

  const channels = [];
  bindAuthIpcHandlers((ch) => {
    channels.push(ch);
  }, store);
  assert.ok(channels.includes("auth:logout"));
  assert.ok(channels.includes("auth:account"));
});

test("H1.4 shell-ui nav + slots sans métier hardcodé", () => {
  assert.ok(CORE_NAV_ITEMS.some((i) => i.id === "core.home"));
  assert.ok(CORE_NAV_ITEMS.every((i) => i.id.startsWith("core.")));
  const reg = createNavRegistry();
  reg.registerBrandNav([
    { id: "brand.custom", label: "Custom", href: "/brand/custom" },
  ]);
  const merged = mergeNav(CORE_NAV_ITEMS, reg.getBrandNav());
  assert.ok(merged.length > CORE_NAV_ITEMS.length);
  assert.throws(() =>
    reg.registerBrandNav([{ id: "panier", label: "Panier", href: "/panier" }]),
  );
  // H3 : href produit réel OK si id préfixé brand.*
  reg.registerBrandNav([
    { id: "brand.panier", label: "Panier", href: "/panier" },
  ]);
  assert.equal(reg.getBrandNav()[0]?.href, "/panier");
});

test("H1.5 assistant store", () => {
  const a = createMemoryAssistantStore();
  const c = a.createConversation({ title: "Hi" });
  a.appendMessage(c.id, { role: "user", content: "bonjour" });
  assert.equal(a.listMessages(c.id).length, 1);
});

test("H1.6 tasks CRUD + api mount ACL user", async () => {
  const store = createMemoryTasksStore();
  const t = store.create({ userId: "u1", title: "Faire X" });
  assert.equal(store.list("u1").length, 1);
  assert.throws(() => store.update(t.id, { status: "done" }, "u2"), /forbidden/);
  store.update(t.id, { status: "done" }, "u1");

  const api = createApiKernel();
  api.registerPlatformApi("platform-tasks", createTasksApiMount(store));
  const res = await api.handle({
    method: "GET",
    path: "/api/v1/platform/platform-tasks/list",
    headers: { "x-creezio-user-id": "u1" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.tasks.length, 1);
});

test("H1.7 mails draft + envoi outbox (v2, jamais bloquant)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-h1-mails-"));
  const store = createSqliteMailsStore({
    coreDbPath: path.join(dir, "core.db"),
  });
  const draft = store.createDraft({
    userId: "u1",
    to: "a@b.c",
    subject: "Hello",
    body: "world",
  });
  const queued = store.sendDraft(draft.id, "u1");
  assert.equal(queued.status, "queued");

  const api = createApiKernel();
  api.registerPlatformApi("platform-mails", createMailsApiMount(store));
  const list = await api.handle({
    method: "GET",
    path: "/api/v1/platform/platform-mails/list",
    headers: { "x-creezio-user-id": "u1" },
  });
  assert.equal(list.body.mails.length, 1);
  store.close();
});

test("H1.8 product-hub sqlite core + ACL + ensurePluginDb", () => {
  const ctx = tmpCtx();
  ensureDay0SqliteLayout(ctx);
  const hub = createSqliteProductHubStore({
    coreDbPath: resolveCoreDbPath(ctx),
    conversationPrefix: "demobrand",
  });
  const impact = buildPluginImpactReport({
    name: "Météo",
    description: "Prévisions",
    evidence: [],
  });
  const { product } = hub.createRequest({ name: "Météo", impact });
  assert.ok(product.id);
  hub.upsertAcl({
    pluginId: "meteo-demo",
    orgIds: ["org-1"],
    userIds: ["user-1"],
  });
  const acl = hub.getAcl("meteo-demo");
  assert.deepEqual(acl.orgIds, ["org-1"]);
  assert.deepEqual(acl.userIds, ["user-1"]);
  hub.close();

  const plug = ensurePluginDb(ctx, "meteo-demo");
  assert.equal(plug.created, true);
  assert.ok(fs.existsSync(plug.path));
});

test("H1 inventaire packages + demobrand shell-ui", () => {
  for (const name of [
    "@creezio/api-kernel",
    "@creezio/mcp-facade",
    "@creezio/auth",
    "@creezio/shell-ui",
    "@creezio/assistant",
    "@creezio/tasks",
    "@creezio/mails",
  ]) {
    assert.ok(KIT_PACKAGE_NAMES.includes(name), name);
    const dir = name.replace("@creezio/", "");
    assert.ok(
      fs.existsSync(path.join(ROOT, "packages", dir, "package.json")),
      dir,
    );
  }
  const demobrandPkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "apps/demobrand/package.json"), "utf8"),
  );
  assert.ok(demobrandPkg.dependencies["@creezio/shell-ui"]);
  assert.ok(demobrandPkg.dependencies["@creezio/api-kernel"]);
  const nav = fs.readFileSync(
    path.join(ROOT, "apps/demobrand/src/electron/nav-core.ts"),
    "utf8",
  );
  assert.match(nav, /@creezio\/shell-ui/);
  assert.match(nav, /PAS de catalogue TempoFlow/);
});
