#!/usr/bin/env node
/**
 * Phase O4r4 — entitySources / formatSearchHit déclaratifs.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createEntitySourcesFromRules,
  createFormatSearchHit,
} from "../packages/assistant/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerRoot = path.resolve(root, "..");

test("O4r4.1 kit exports + moteur", () => {
  const idx = fs.readFileSync(
    path.join(root, "packages/assistant/src/index.ts"),
    "utf8",
  );
  assert.match(idx, /createEntitySourcesFromRules/);
  assert.match(idx, /createFormatSearchHit/);

  const fn = createEntitySourcesFromRules([
    {
      kind: "produit",
      titleFields: ["nom", "ref"],
      type: "produit",
      urlWhenId: "/produits/{id}",
      urlWhenSearch: "/produits?q={q}",
    },
  ]);
  const withId = fn("produit", "x", { id: 42, nom: "Tomate" });
  assert.equal(withId.length, 1);
  assert.equal(withId[0].url, "/produits/42");
  assert.equal(withId[0].title, "Tomate");

  const hit = createFormatSearchHit(["vin"])({
    id: 1,
    title: "A",
    body: "hello world",
    vin: "VF1",
  });
  assert.equal(hit.vin, "VF1");
  assert.match(String(hit.excerpt), /hello/);
});

test("O4r4.2 marques : pas de switch kind, utilise kit", () => {
  for (const id of ["tempoflow2", "certivan-app", "fidu"]) {
    const src = fs.readFileSync(
      path.join(dockerRoot, id, "crm/src/lib/assistant/entity-sources.ts"),
      "utf8",
    );
    assert.match(src, /createEntitySourcesFromRules/);
    assert.match(src, /createFormatSearchHit/);
    assert.doesNotMatch(src, /switch\s*\(\s*kind/);
  }
});

test("O4r4.3 docs PLAN + PHASE + ADR", () => {
  assert.match(
    fs.readFileSync(path.join(root, "docs/archive/PHASE-O4r4.md"), "utf8"),
    /test-phase-o4r4/,
  );
  assert.match(
    fs.readFileSync(path.join(root, "docs/archive/PLAN-O.md"), "utf8"),
    /## O4r4 —/,
  );
  assert.match(
    fs.readFileSync(
      path.join(root, "docs/adr/ADR-assistant-tools-mcp.md"),
      "utf8",
    ),
    /O4r4/,
  );
});

test("O4r4.4 gate npm test", () => {
  assert.match(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
    /test-phase-o4r4\.mjs/,
  );
});
