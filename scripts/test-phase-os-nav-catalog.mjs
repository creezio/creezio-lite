#!/usr/bin/env node
/**
 * Gate NAV-3 — chaque segment OS primaire a une entrée catalogue
 * (ou `horsNavJustification`). Factory chrome = loader, zéro literal
 * `"/granola"` / `"/grokbot"`. Plan : docs/plans/PLAN-NAV-CATALOG.md Phase C.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OS_UI_SRC = path.join(ROOT, "packages/os-ui/src/index.ts");
const SHELL_DIST = path.join(ROOT, "packages/shell-ui/dist/nav-catalog.js");
const FACTORY_DIR = path.join(ROOT, "packages/factory");
const FACTORY_OS_UI = path.join(FACTORY_DIR, "src/generators/os-ui.ts");

const PRIMARY = [
  "taches",
  "mails",
  "granola",
  "grokbot",
  "parametres",
  "collaborateurs",
];

function walkFactorySrc(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist" || ent.name === "dist-cjs") {
      continue;
    }
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFactorySrc(full, acc);
    else if (/\.(ts|tsx|js|mjs|md)$/.test(ent.name)) acc.push(full);
  }
  return acc;
}

function extractQuotedList(src, constName) {
  const m = src.match(
    new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\](?: as const)?;`),
  );
  assert.ok(m, `${constName} introuvable dans os-ui/src/index.ts`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function extractJustificationMap(src) {
  const m = src.match(
    /export const OS_UI_HORS_NAV_JUSTIFICATIONS: Record<string, string> = \{([\s\S]*?)\n\};/,
  );
  assert.ok(m, "OS_UI_HORS_NAV_JUSTIFICATIONS introuvable");
  const out = {};
  for (const row of m[1].matchAll(
    /(?:"([^"]+)"|([A-Za-z0-9_-]+))\s*:\s*"((?:\\.|[^"\\])*)"/g,
  )) {
    out[row[1] || row[2]] = row[3];
  }
  return out;
}

test("os-nav-catalog : OS_PRIMARY_NAV_SEGMENTS + horsNavJustification couvrent OS_UI_ROUTE_SEGMENTS", () => {
  const src = fs.readFileSync(OS_UI_SRC, "utf8");
  const segments = extractQuotedList(src, "OS_UI_ROUTE_SEGMENTS");
  const primary = extractQuotedList(src, "OS_PRIMARY_NAV_SEGMENTS");
  const justifications = extractJustificationMap(src);
  assert.ok(segments.length > 0);
  assert.deepEqual(primary, PRIMARY);

  const covered = new Set();
  for (const seg of primary) {
    assert.ok(segments.includes(seg), `primaire ${seg} doit être dans OS_UI_ROUTE_SEGMENTS`);
    assert.equal(
      justifications[seg],
      undefined,
      `${seg} est primaire — pas de horsNavJustification`,
    );
    covered.add(seg);
  }
  for (const [seg, reason] of Object.entries(justifications)) {
    assert.ok(segments.includes(seg), `horsNavJustification ${seg} : segment inconnu`);
    assert.ok(
      typeof reason === "string" && reason.trim().length > 8,
      `horsNavJustification ${seg} trop courte`,
    );
    covered.add(seg);
  }
  for (const seg of segments) {
    assert.ok(
      covered.has(seg),
      `segment OS ${seg} : entrée catalogue (OS_PRIMARY_NAV_SEGMENTS) ou OS_UI_HORS_NAV_JUSTIFICATIONS`,
    );
  }
});

test("os-nav-catalog : chaque primaire a une entrée defaultOsCatalogEntries", async () => {
  assert.ok(
    fs.existsSync(SHELL_DIST),
    "dist @creezio/shell-ui nav-catalog manquant — lancer npm run build -w @creezio/shell-ui",
  );
  const mod = await import(SHELL_DIST);
  mod.resetOsNavRegistryForTests();
  const entries = mod.defaultOsCatalogEntries();
  const hrefs = new Set(entries.map((e) => e.href));
  for (const seg of PRIMARY) {
    assert.ok(
      hrefs.has(`/${seg}`),
      `catalogue OS : entrée href /${seg} manquante`,
    );
  }
  const body = {
    ok: true,
    items: entries.map((e) => ({
      id: e.id,
      href: e.href,
      label: e.label,
      order: e.order,
      group: e.group,
      icon: e.icon,
    })),
  };
  const parsed = mod.parseNavCatalogSessionItems(body);
  assert.equal(parsed.length, entries.length);
  assert.ok(parsed.some((i) => i.href === "/granola"));
  assert.equal(mod.parseNavCatalogSessionItems({}).length, 0);
  assert.equal(mod.parseNavCatalogSessionItems(null).length, 0);
});

test("os-nav-catalog : factory chrome = NavCatalogLoader, zéro literal /granola /grokbot", async () => {
  const src = fs.readFileSync(FACTORY_OS_UI, "utf8");
  assert.doesNotMatch(src, /const OS_NAV/, "plus de const OS_NAV");
  assert.doesNotMatch(src, /const BRAND_NAV/, "plus de BRAND_NAV inline — métier via GET /");
  assert.match(src, /NavCatalogLoader/, "chrome importe NavCatalogLoader");
  assert.match(
    src,
    /from "@creezio\/shell-ui\/ui"/,
    "loader depuis shell-ui/ui (pas @creezio/nav — non publié)",
  );
  assert.doesNotMatch(
    src,
    /from "@creezio\/nav/,
    "factory chrome n'importe pas @creezio/nav",
  );
  assert.match(src, /defaultOsAdminNavItems/, "adminItems consommé, pas recopié");
  assert.match(
    src,
    /defaultOsPrimaryNavItems/,
    "fallback premier paint defaultOsPrimaryNavItems",
  );

  for (const file of walkFactorySrc(FACTORY_DIR)) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(
      text,
      /["']\/granola["']/,
      `${path.relative(ROOT, file)} : literal "/granola" interdit (hrefs via catalogue)`,
    );
    assert.doesNotMatch(
      text,
      /["']\/grokbot["']/,
      `${path.relative(ROOT, file)} : literal "/grokbot" interdit (hrefs via catalogue)`,
    );
  }

  const factoryDist = path.join(FACTORY_DIR, "dist/generators/os-ui.js");
  const modelDist = path.join(FACTORY_DIR, "dist/product-model.js");
  assert.ok(fs.existsSync(factoryDist), "dist factory manquant — npm run build -w @creezio/factory");
  const { renderUiBrandChrome } = await import(factoryDist);
  const { blankAppModel } = await import(modelDist);
  const chrome = renderUiBrandChrome(
    blankAppModel({
      brandId: "acme",
      brandName: "Acme",
      domain: "acme.local",
    }),
  );
  assert.match(chrome, /<NavCatalogLoader/);
  assert.match(chrome, /from "@creezio\/shell-ui\/ui"/);
  assert.doesNotMatch(chrome, /from "@creezio\/nav/);
  assert.doesNotMatch(chrome, /const OS_NAV/);
  assert.doesNotMatch(chrome, /const BRAND_NAV/);
  assert.doesNotMatch(chrome, /["']\/granola["']/);
  assert.doesNotMatch(chrome, /["']\/grokbot["']/);
  assert.match(chrome, /defaultOsAdminNavItems\(\{\s*includePlugins:/);
  assert.match(chrome, /defaultOsPrimaryNavItems\(\)/);
});

test("os-nav-catalog : enregistré dans le script test racine", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.match(
    String(pkg.scripts.test),
    /test-phase-os-nav-catalog\.mjs/,
    "gate listée dans package.json scripts.test",
  );
});
