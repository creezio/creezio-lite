/**
 * Tests Phase H3 — cadre kit (métier reste dans tempoflow2).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ARCHITECTURE_VERSION } from "@creezio/platform-core";
import { createNavRegistry, CORE_NAV_ITEMS } from "@creezio/shell-ui";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("H3.0 docs H3 présents (version bumpée en H4+)", () => {
  // ARCHITECTURE_VERSION est bumpée au sign-off de chaque phase ;
  // H3 reste prouvée par les docs + contrats shell-ui ci-dessous.
  // Contrat : Hn avec n >= 3 (chaque bump s'accompagne de ses codemods —
  // gate test-phase-arch-codemod).
  const m = /^H(\d+)$/.exec(ARCHITECTURE_VERSION);
  assert.ok(
    m && Number(m[1]) >= 3,
    `ARCHITECTURE_VERSION inattendue: ${ARCHITECTURE_VERSION}`,
  );
});

test("H3 docs BACKLOG + PHASE présents", () => {
  for (const f of ["docs/archive/BACKLOG-H3.md", "docs/archive/PHASE-H3.md"]) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});

test("H3 shell-ui : brand.panier + href /panier autorisé ; id nu refusé", () => {
  const reg = createNavRegistry();
  assert.throws(() =>
    reg.registerBrandNav([{ id: "panier", label: "Panier", href: "/x" }]),
  );
  reg.registerBrandNav([
    { id: "brand.panier", label: "Panier", href: "/panier" },
  ]);
  assert.equal(reg.getBrandNav()[0]?.href, "/panier");
  assert.ok(CORE_NAV_ITEMS.every((i) => i.id.startsWith("core.")));
});

test("H3 kit packages : pas de mount métier panier/dispatch/releves", () => {
  const packagesDir = path.join(root, "packages");
  for (const name of fs.readdirSync(packagesDir)) {
    const srcDir = path.join(packagesDir, name, "src");
    if (!fs.existsSync(srcDir)) continue;
    const files = walkTs(srcDir);
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(
        src,
        /registerModuleApi\s*\(\s*["'](panier|dispatch|releves)["']/,
        `${file} ne doit pas monter un module métier TF`,
      );
    }
  }
});

function walkTs(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkTs(p));
    else if (ent.name.endsWith(".ts")) out.push(p);
  }
  return out;
}
