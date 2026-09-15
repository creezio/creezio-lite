#!/usr/bin/env node
/**
 * Gate NAV-2 — module hybride `@creezio/nav` (overrides admin).
 *
 * Migrations, GET/PUT overrides, feature-off, 403 sans permission,
 * masquer os.granola → GET / ne le renvoie plus (non-owner + owner).
 * Plan : docs/plans/PLAN-NAV-CATALOG.md Phase B.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "packages/nav/dist/index.js");
const KERNEL = path.join(ROOT, "packages/api-kernel/dist/index.js");

async function loadNav() {
  assert.ok(
    fs.existsSync(DIST),
    "dist @creezio/nav manquant — lancer npm run build -w @creezio/nav",
  );
  return import(pathToFileURL(DIST).href);
}

async function createDb(migrations) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  for (const m of migrations) db.exec(m.sql);
  return db;
}

function call(mount, { method, subPath = "", body, headers, query, db }) {
  return mount.handle({
    req: {
      method,
      path: `/api/v1/modules/nav/${subPath}`,
      body,
      headers,
      query,
    },
    space: "module",
    mountId: "nav",
    subPath,
    db,
  });
}

const granolaOs = {
  id: "os.granola",
  href: "/granola",
  label: "Granola",
  icon: "NotebookPen",
  group: "core",
  order: 30,
  defaultVisible: true,
  source: "os",
  available: true,
};

const mailsOs = {
  id: "os.mails",
  href: "/mails",
  label: "Mails",
  icon: "Mail",
  group: "core",
  order: 20,
  defaultVisible: true,
  source: "os",
  available: true,
};

const pluginEntry = {
  id: "plugin.demo",
  href: "/plugins/demo",
  label: "Demo plugin",
  icon: "Package",
  group: "plugin",
  order: 90,
  defaultVisible: true,
  source: "plugin",
  available: true,
};

test("nav-module : exports publics + migrations", async () => {
  const nav = await loadNav();
  assert.equal(typeof nav.createNavMount, "function");
  assert.equal(typeof nav.navMigrations, "function");
  assert.equal(typeof nav.registerOsNavAdminEntry, "function");
  assert.equal(typeof nav.brandNavItemsToCatalog, "function");
  const migrations = nav.navMigrations();
  assert.ok(migrations.length >= 1);
  assert.equal(migrations[0].id, "nav_001_overrides");
  assert.match(migrations[0].sql, /CREATE TABLE IF NOT EXISTS nav_overrides/);
  assert.match(migrations[0].sql, /entry_id/);
  assert.match(migrations[0].sql, /sort_order/);
  assert.doesNotMatch(
    migrations[0].sql,
    /CREATE TABLE IF NOT EXISTS nav_entries/,
    "ne pas persister le catalogue entier",
  );
});

test("nav-module : GET / + PUT override hidden retire os.granola", async () => {
  const nav = await loadNav();
  const db = await createDb(nav.navMigrations());
  let actor = {
    role: "collaborator",
    permissions: ["nav.mails"],
    sub: "user-1",
  };
  const mount = nav.createNavMount({
    osEntries: [granolaOs, mailsOs],
    getSession: () => actor,
  });

  const before = await call(mount, { method: "GET", db });
  assert.equal(before.status, 200);
  const idsBefore = before.body.items.map((i) => i.id);
  assert.ok(idsBefore.includes("os.granola"));
  assert.ok(idsBefore.includes("os.mails"));

  actor = { role: "owner", permissions: [], impersonating: false, sub: "owner-1" };
  const put = await call(mount, {
    method: "PUT",
    subPath: "overrides",
    body: { entryId: "os.granola", hidden: true },
    db,
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.override.hidden, true);

  actor = {
    role: "collaborator",
    permissions: ["nav.mails"],
    sub: "user-1",
  };
  const after = await call(mount, { method: "GET", db });
  assert.equal(after.status, 200);
  const idsAfter = after.body.items.map((i) => i.id);
  assert.ok(
    !idsAfter.includes("os.granola"),
    "hidden granola absent de GET / (non-owner)",
  );
  assert.ok(idsAfter.includes("os.mails"));
});

test("nav-module : owner — hidden s'applique quand même", async () => {
  const nav = await loadNav();
  const db = await createDb(nav.navMigrations());
  const mount = nav.createNavMount({
    osEntries: [granolaOs, mailsOs],
    getSession: () => ({
      role: "owner",
      permissions: [],
      impersonating: false,
      sub: "owner-1",
    }),
  });
  await call(mount, {
    method: "PUT",
    subPath: "overrides",
    body: { entryId: "os.granola", hidden: true },
    db,
  });
  const res = await call(mount, { method: "GET", db });
  assert.ok(
    !res.body.items.some((i) => i.id === "os.granola"),
    "owner : hidden s'applique quand même",
  );
  assert.ok(res.body.items.some((i) => i.id === "os.mails"));
});

test("nav-module : GET /catalog + rename + reorder + DELETE retour défaut", async () => {
  const nav = await loadNav();
  const db = await createDb(nav.navMigrations());
  const mount = nav.createNavMount({
    osEntries: [granolaOs, mailsOs],
    getSession: () => ({ role: "owner", permissions: [], sub: "owner-1" }),
  });

  await call(mount, {
    method: "PUT",
    subPath: "overrides",
    body: { entryId: "os.granola", label: "Notes", order: 5 },
    db,
  });
  const catalog = await call(mount, { method: "GET", subPath: "catalog", db });
  assert.equal(catalog.status, 200);
  const granola = catalog.body.entries.find((e) => e.id === "os.granola");
  assert.equal(granola.label, "Notes");
  assert.equal(granola.order, 5);
  assert.ok(catalog.body.overrides.some((o) => o.entryId === "os.granola"));

  const reorder = await call(mount, {
    method: "PUT",
    subPath: "overrides/reorder",
    body: { ids: ["os.granola", "os.mails"] },
    db,
  });
  assert.equal(reorder.status, 200);
  const session = await call(mount, { method: "GET", db });
  assert.deepEqual(
    session.body.items.map((i) => i.id),
    ["os.granola", "os.mails"],
  );

  const del = await call(mount, {
    method: "DELETE",
    subPath: "overrides/os.granola",
    db,
  });
  assert.equal(del.status, 200);
  const reset = await call(mount, { method: "GET", subPath: "catalog", db });
  const after = reset.body.entries.find((e) => e.id === "os.granola");
  assert.equal(after.label, "Granola");
  assert.equal(after.order, 30);
});

test("nav-module : feature-off — plugin absent de GET / même si override visible", async () => {
  const nav = await loadNav();
  const db = await createDb(nav.navMigrations());
  const mount = nav.createNavMount({
    osEntries: [mailsOs],
    collectPluginEntries: () => [pluginEntry],
    features: { plugins: false },
    getSession: () => ({ role: "owner", permissions: [], sub: "owner-1" }),
  });
  await call(mount, {
    method: "PUT",
    subPath: "overrides",
    body: { entryId: "plugin.demo", hidden: false },
    db,
  });
  const session = await call(mount, { method: "GET", db });
  assert.ok(!session.body.items.some((i) => i.id === "plugin.demo"));
  const catalog = await call(mount, { method: "GET", subPath: "catalog", db });
  const demo = catalog.body.entries.find((e) => e.id === "plugin.demo");
  assert.ok(demo, "admin voit l'entrée feature-off");
  assert.equal(demo.available, false);
});

test("nav-module : 403 sans permission + 401 sans session", async () => {
  const nav = await loadNav();
  const db = await createDb(nav.navMigrations());
  const mount = nav.createNavMount({
    osEntries: [granolaOs],
    getSession: () => ({
      role: "collaborator",
      permissions: ["nav.mails"],
      sub: "collab-1",
    }),
  });
  const catalog = await call(mount, { method: "GET", subPath: "catalog", db });
  assert.equal(catalog.status, 403, "collaborateur sans platform.access.manage");
  const put = await call(mount, {
    method: "PUT",
    subPath: "overrides",
    body: { entryId: "os.granola", hidden: true },
    db,
  });
  assert.equal(put.status, 403);

  const anon = nav.createNavMount({
    osEntries: [granolaOs],
    getSession: () => null,
  });
  const denied = await call(anon, { method: "GET", db });
  assert.equal(denied.status, 401);
  const catalogAnon = await call(anon, { method: "GET", subPath: "catalog", db });
  assert.equal(catalogAnon.status, 401);
});

test("nav-module : kernel authorizeModuleAccess 403 sur /catalog", async () => {
  assert.ok(fs.existsSync(KERNEL), "dist api-kernel manquant");
  const { createApiKernel } = await import(pathToFileURL(KERNEL).href);
  const nav = await loadNav();
  const api = createApiKernel({
    brandId: "demobrand",
    authorizeModuleAccess: async ({ permission }) => {
      if (!permission) return { allow: true };
      return {
        allow: false,
        reason: `permission_denied: ${permission}`,
        status: 403,
      };
    },
  });
  api.registerModuleApi("nav", nav.createNavMount({ osEntries: [granolaOs] }));
  const denied = await api.handle({
    method: "GET",
    path: "/api/v1/modules/nav/catalog",
  });
  assert.equal(denied.status, 403);
  const listed = await api.handle({
    method: "GET",
    path: "/api/v1/modules/nav",
  });
  assert.notEqual(listed.status, 403, "GET / n'exige pas platform.access.manage");
});

test("nav-module : db absente → 503", async () => {
  const nav = await loadNav();
  const mount = nav.createNavMount({ osEntries: [granolaOs] });
  const res = await call(mount, { method: "GET", db: undefined });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, "db_unavailable");
});

test("nav-module : entrée admin os.admin.nav + wrapper os-ui", async () => {
  const nav = await loadNav();
  nav.registerOsNavAdminEntry();
  assert.equal(nav.OS_ADMIN_NAV_ENTRY.id, "os.admin.nav");
  assert.equal(nav.OS_ADMIN_NAV_ENTRY.href, "/admin/nav");
  assert.equal(nav.OS_ADMIN_NAV_ENTRY.group, "admin");
  const page = path.join(ROOT, "packages/os-ui/routes/admin/nav/page.tsx");
  assert.ok(fs.existsSync(page), "wrapper os-ui /admin/nav");
  const src = fs.readFileSync(page, "utf8");
  assert.match(src, /NavAdminClient/);
  assert.match(src, /@creezio\/nav\/ui/);
  const native = fs.readFileSync(
    path.join(ROOT, "packages/shell-ui/ui/layout/native-os-nav.ts"),
    "utf8",
  );
  assert.match(native, /href:\s*["']\/admin\/nav["']/);
  assert.match(native, /label:\s*["']Navigation["']/);
});

test("nav-module : câblage app-runtime + pas de vocabulaire marque", () => {
  const kernel = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/create-brand-kernel.ts"),
    "utf8",
  );
  assert.match(kernel, /navMigrations/);
  assert.match(kernel, /registerModuleApi\(\s*["']nav["']/);
  assert.match(kernel, /createNavMount/);
  const desktop = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/start-brand-desktop.ts"),
    "utf8",
  );
  assert.match(desktop, /navItems:\s*config\.navItems/);
  const srcDir = path.join(ROOT, "packages/nav/src");
  const uiDir = path.join(ROOT, "packages/nav/ui");
  for (const dir of [srcDir, uiDir]) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (!fs.statSync(p).isFile()) continue;
      const text = fs.readFileSync(p, "utf8");
      assert.doesNotMatch(
        text,
        /tempoflow|certivan|\bfidu\b|winhub|\bfoove\b|TF3|chr-catalog/i,
        `vocabulaire marque dans ${name}`,
      );
    }
  }
});

test("nav-module : enregistré dans le script test racine", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.match(
    String(pkg.scripts.test),
    /test-phase-nav-module\.mjs/,
    "gate listée dans package.json scripts.test",
  );
});
