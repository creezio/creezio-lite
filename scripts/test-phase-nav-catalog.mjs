#!/usr/bin/env node
/**
 * Gate NAV-1 — catalogue de nav OS unique (sans admin).
 *
 * Merge pur, collision id/href, feature-off, seed registre, factory chrome
 * sans `const OS_NAV` ni literal `"/granola"`.
 * Plan : docs/plans/PLAN-NAV-CATALOG.md Phase A.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "packages/shell-ui/dist/nav-catalog.js");
const FACTORY_OS_UI = path.join(
  ROOT,
  "packages/factory/src/generators/os-ui.ts",
);
const NATIVE_OS_NAV = path.join(
  ROOT,
  "packages/shell-ui/ui/layout/native-os-nav.ts",
);
const NAV_ICONS = path.join(ROOT, "packages/shell-ui/ui/layout/nav-icons.ts");

test("nav-catalog : dist + exports publics", async () => {
  assert.ok(
    fs.existsSync(DIST),
    "dist @creezio/shell-ui nav-catalog manquant — lancer npm run build -w @creezio/shell-ui",
  );
  const mod = await import(DIST);
  assert.equal(typeof mod.resolveNavCatalog, "function");
  assert.equal(typeof mod.registerOsNavEntry, "function");
  assert.equal(typeof mod.listOsNavEntries, "function");
  assert.equal(typeof mod.registerDefaultOsNavEntries, "function");
  assert.equal(typeof mod.defaultOsCatalogEntries, "function");
  assert.ok(Array.isArray(mod.NAV_ICON_ALLOWLIST));
  assert.ok(mod.NAV_ICON_ALLOWLIST.includes("NotebookPen"));
  assert.ok(mod.NAV_ICON_ALLOWLIST.includes("Bot"));
  assert.ok(mod.NAV_ICON_ALLOWLIST.includes("Circle"));
});

test("nav-catalog : seed OS (taches, mails, granola, grokbot, parametres, collaborateurs)", async () => {
  const mod = await import(DIST);
  mod.resetOsNavRegistryForTests();
  const entries = mod.defaultOsCatalogEntries();
  const ids = entries.map((e) => e.id);
  assert.deepEqual(ids, [
    "os.taches",
    "os.mails",
    "os.granola",
    "os.grokbot",
    "os.parametres",
    "os.collaborateurs",
  ]);
  const granola = entries.find((e) => e.id === "os.granola");
  assert.equal(granola.href, "/granola");
  assert.equal(granola.icon, "NotebookPen");
  assert.equal(granola.source, "os");
  assert.equal(granola.available, true);
  const again = mod.defaultOsCatalogEntries();
  assert.equal(again.length, entries.length, "seed idempotent");
  const listed = mod.listOsNavEntries();
  assert.deepEqual(
    listed.map((e) => e.id),
    ids,
  );
});

test("nav-catalog : merge pur + override label/order", async () => {
  const { resolveNavCatalog, resetOsNavRegistryForTests, defaultOsCatalogEntries } =
    await import(DIST);
  resetOsNavRegistryForTests();
  const os = defaultOsCatalogEntries();
  const modules = [
    {
      id: "module.articles",
      href: "/articles",
      label: "Articles",
      icon: "List",
      group: "brand",
      order: 5,
      defaultVisible: true,
      source: "module",
      available: true,
    },
  ];
  const extras = [
    {
      id: "extra.help",
      href: "/help",
      label: "Aide",
      icon: "Circle",
      group: "brand",
      order: 90,
      defaultVisible: true,
      source: "extra",
      available: true,
    },
  ];
  const { entries, errors, warnings } = resolveNavCatalog({
    os,
    modules,
    extras,
    overrides: [
      { entryId: "os.mails", label: "Boîte mail", order: 1 },
    ],
  });
  assert.equal(errors.length, 0);
  assert.equal(warnings.length, 0);
  const mails = entries.find((e) => e.id === "os.mails");
  assert.equal(mails.label, "Boîte mail");
  assert.equal(mails.order, 1);
  assert.equal(mails.href, "/mails", "override ne touche pas href");
  assert.equal(entries[0].id, "os.mails");
  assert.ok(entries.some((e) => e.id === "module.articles"));
  assert.ok(entries.some((e) => e.id === "extra.help"));
});

test("nav-catalog : collision id = throw en strict / errors[] runtime", async () => {
  const { resolveNavCatalog } = await import(DIST);
  const a = {
    id: "os.dup",
    href: "/a",
    label: "A",
    icon: "Circle",
    group: "core",
    order: 1,
    defaultVisible: true,
    source: "os",
    available: true,
  };
  const b = { ...a, href: "/b", source: "module" };
  assert.throws(
    () => resolveNavCatalog({ os: [a], modules: [b], throwOnIdCollision: true }),
    /collision d'id/,
  );
  const runtime = resolveNavCatalog({ os: [a], modules: [b] });
  assert.ok(runtime.errors.some((e) => e.code === "id_collision"));
  assert.equal(
    runtime.entries.filter((e) => e.id === "os.dup").length,
    1,
    "le doublon est ignoré au runtime",
  );
});

test("nav-catalog : collision href = module gagne + warning", async () => {
  const { resolveNavCatalog } = await import(DIST);
  const os = {
    id: "os.notes",
    href: "/notes",
    label: "Notes OS",
    icon: "NotebookPen",
    group: "core",
    order: 10,
    defaultVisible: true,
    source: "os",
    available: true,
  };
  const modEntry = {
    id: "module.notes",
    href: "/notes",
    label: "Notes métier",
    icon: "List",
    group: "brand",
    order: 4,
    defaultVisible: true,
    source: "module",
    available: true,
  };
  const { entries, warnings, errors } = resolveNavCatalog({
    os: [os],
    modules: [modEntry],
  });
  assert.equal(errors.length, 0);
  assert.ok(warnings.some((w) => w.code === "href_collision"));
  assert.ok(entries.some((e) => e.id === "module.notes"));
  assert.ok(
    !entries.some((e) => e.id === "os.notes"),
    "module gagne sur os pour le même href",
  );
});

test("nav-catalog : feature-off plugins gagne sur hidden:false", async () => {
  const { resolveNavCatalog } = await import(DIST);
  const plugin = {
    id: "plugin.demo",
    href: "/plugins/demo",
    label: "Demo",
    icon: "Package",
    group: "plugin",
    order: 80,
    defaultVisible: true,
    source: "plugin",
    available: true,
  };
  const adminPlugins = {
    id: "os.admin.plugins",
    href: "/admin/plugins",
    label: "Plugins",
    icon: "Package",
    group: "admin",
    order: 70,
    defaultVisible: true,
    source: "os",
    available: true,
  };
  const { entries } = resolveNavCatalog({
    os: [adminPlugins],
    plugins: [plugin],
    features: { plugins: false },
    overrides: [{ entryId: "plugin.demo", hidden: false }],
  });
  const demo = entries.find((e) => e.id === "plugin.demo");
  const admin = entries.find((e) => e.id === "os.admin.plugins");
  assert.equal(demo?.available, false, "source plugin feature-off");
  assert.equal(admin?.available, false, "href /admin/plugins feature-off");
});

test("nav-catalog : override hidden retire l'entrée (sidebar)", async () => {
  const { resolveNavCatalog, resetOsNavRegistryForTests, defaultOsCatalogEntries } =
    await import(DIST);
  resetOsNavRegistryForTests();
  const { entries } = resolveNavCatalog({
    os: defaultOsCatalogEntries(),
    overrides: [{ entryId: "os.granola", hidden: true }],
  });
  assert.ok(!entries.some((e) => e.id === "os.granola"));
  const catalog = resolveNavCatalog({
    os: defaultOsCatalogEntries(),
    overrides: [{ entryId: "os.granola", hidden: true }],
    includeHidden: true,
  });
  assert.ok(catalog.entries.some((e) => e.id === "os.granola"));
});

test("nav-catalog : adapter + resolveNavIcon (source, pas de throw)", () => {
  const native = fs.readFileSync(NATIVE_OS_NAV, "utf8");
  assert.match(native, /defaultOsCatalogEntries/);
  assert.match(native, /resolveNavIcon/);
  assert.match(native, /PLAN-NAV-CATALOG/);
  assert.match(
    native,
    /adaptateur|registre|catalogue/i,
    "native-os-nav documente l'adaptateur catalogue",
  );
  const icons = fs.readFileSync(NAV_ICONS, "utf8");
  assert.match(icons, /export function resolveNavIcon/);
  assert.match(icons, /NotebookPen/);
  assert.match(icons, /Bot/);
  assert.match(icons, /\bCircle\b/);
  assert.match(icons, /console\.warn/);
});

test("nav-catalog : factory chrome sans const OS_NAV ni literal /granola", async () => {
  const src = fs.readFileSync(FACTORY_OS_UI, "utf8");
  assert.doesNotMatch(src, /const OS_NAV/, "générateur : plus de const OS_NAV");
  assert.doesNotMatch(
    src,
    /href:\s*["']\/granola["']/,
    "générateur : plus de href /granola inline",
  );
  assert.doesNotMatch(
    src,
    /href:\s*["']\/grokbot["']/,
    "générateur : plus de href /grokbot inline",
  );
  assert.match(src, /NavCatalogLoader/);
  assert.match(src, /defaultOsPrimaryNavItems/);
  assert.match(src, /defaultOsAdminNavItems/);

  const factoryDist = path.join(
    ROOT,
    "packages/factory/dist/generators/os-ui.js",
  );
  const modelDist = path.join(ROOT, "packages/factory/dist/product-model.js");
  assert.ok(
    fs.existsSync(factoryDist),
    "dist factory manquant — lancer npm run build -w @creezio/factory",
  );
  const { renderUiBrandChrome } = await import(factoryDist);
  const { blankAppModel } = await import(modelDist);
  const chrome = renderUiBrandChrome(
    blankAppModel({
      brandId: "acme",
      brandName: "Acme",
      domain: "acme.local",
    }),
  );
  assert.doesNotMatch(chrome, /const OS_NAV/);
  assert.doesNotMatch(chrome, /["']\/granola["']/);
  assert.doesNotMatch(chrome, /["']\/grokbot["']/);
  assert.match(chrome, /<NavCatalogLoader/);
  assert.match(chrome, /defaultOsPrimaryNavItems\(\)/);
  assert.match(chrome, /defaultOsAdminNavItems\(\{\s*includePlugins:\s*true/);
});

test("nav-catalog : factory installe granola, grokbot et nav (jamais retirer)", () => {
  const sot = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/kit-release.ts"),
    "utf8",
  );
  const gen = fs.readFileSync(FACTORY_OS_UI, "utf8");
  for (const name of ["granola", "grokbot", "nav"]) {
    assert.match(
      sot,
      new RegExp(`"${name}"`),
      `kit-release.ts liste ${name} (SERVER/CLIENT_CREEZIO_DEPS)`,
    );
    assert.match(
      gen,
      new RegExp(`"@creezio/${name}"`),
      `os-ui.ts installe @creezio/${name} (deps + transpilePackages)`,
    );
  }
});

test("nav-catalog : enregistré dans le script test racine", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.match(
    String(pkg.scripts.test),
    /test-phase-nav-catalog\.mjs/,
    "gate listée dans package.json scripts.test",
  );
});
