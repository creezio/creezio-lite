/**
 * Phase I7 — createNavShellAdapter + demobrand conso.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createNavShellAdapter,
  CORE_NAV_ITEMS,
} from "../packages/shell-ui/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("I7 adapter registerBrandNav + render model", () => {
  const shell = createNavShellAdapter();
  shell.registerBrandNav([
    { id: "brand.notes", label: "Notes", href: "/notes" },
  ]);
  shell.setActiveHref("/notes");
  const model = shell.getRenderModel();
  assert.ok(model.items.length > CORE_NAV_ITEMS.length);
  const brand = model.groups.find((g) => g.id === "brand");
  assert.ok(brand);
  assert.equal(brand.items.length, 1);
  assert.equal(brand.items[0].active, true);
  const html = shell.renderNavHtml();
  assert.match(html, /data-creezio-shell-ui="i7"/);
  assert.match(html, /Notes/);
  assert.match(html, /aria-current="page"/);
});

test("I7 refuse id métier nu", () => {
  const shell = createNavShellAdapter();
  assert.throws(
    () => shell.registerBrandNav([{ id: "panier", label: "Panier", href: "/panier" }]),
    /brand\./,
  );
});

test("I7 demobrand consomme adapter", async () => {
  const { demobrandNavShell } = await import(
    "../apps/demobrand/build/electron/nav-shell.js"
  );
  const model = demobrandNavShell.getRenderModel();
  assert.ok(model.groups.some((g) => g.id === "core" && g.items.length > 0));
  assert.ok(
    model.groups.some(
      (g) => g.id === "brand" && g.items.some((i) => i.id === "brand.notes"),
    ),
  );
});

test("I7 docs + README contrat", () => {
  const readme = fs.readFileSync(
    path.join(ROOT, "packages/shell-ui/README.md"),
    "utf8",
  );
  assert.match(readme, /registerBrandNav only|registerBrandNav/i);
  assert.ok(fs.existsSync(path.join(ROOT, "docs/archive/PHASE-I7.md")));
});
