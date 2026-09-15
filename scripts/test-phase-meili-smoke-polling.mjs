#!/usr/bin/env node
/**
 * Gate — smokes kit/marques compatibles avec la cohérence éventuelle Meili
 * (contrat délibéré : pas de write-through ; liste d'une entité indexée
 * servie `engine:"indexing"` + 0 item pendant l'indexation initiale, le
 * client réessaie).
 *
 * Couvre le helper SoT `packages/desktop-tooling/scripts/meili-list-poll.mjs`
 * (comportement, sans réseau — `json` simulé) et son branchement dans les
 * smokes embarqués/générés :
 *
 * - `assertModuleRowHydratedById` : read-after-write déterministe par
 *   `GET ?ids=<id>` (hydratation PK = chemin SQL légitime, jamais Meili) ;
 * - `pollModuleListUntilVisible` : polling borné jusqu'à visibilité dans la
 *   liste ; échec explicite IMMÉDIAT si `engine:"meili"` (index figé) sans
 *   le doc ; échec borné explicite si jamais visible ;
 * - `e2e-browser-parcours.mjs` (desktop-tooling) et les templates factory
 *   (`renderMetierParcoursSmoke` générique + CHR, `renderMiniPrdCoreSmoke`)
 *   utilisent le helper — plus d'assertion naïve « GET liste immédiat
 *   post-create » (régression prouvée en CI marque : assertion ~40 ms après
 *   le POST, zéro retry, liste encore `engine:"indexing"`).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELPER = path.join(
  ROOT,
  "packages/desktop-tooling/scripts/meili-list-poll.mjs",
);

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

async function loadHelper() {
  assert.ok(fs.existsSync(HELPER), "meili-list-poll.mjs manquant");
  return import(pathToFileURL(HELPER).href);
}

/* ── Comportement du helper (json simulé, zéro réseau) ────────────────── */

test("polling : engine indexing puis visible → succès après retries", async () => {
  const { pollModuleListUntilVisible } = await loadHelper();
  let calls = 0;
  const json = async () => {
    calls += 1;
    return calls < 3
      ? { items: [], total: 0, engine: "indexing" }
      : { items: [{ id: "a1" }], total: 1, engine: "meili" };
  };
  const list = await pollModuleListUntilVisible(
    json,
    "/api/v1/modules/widgets",
    (items) => items.some((x) => x.id === "a1"),
    { intervalMs: 5 },
  );
  assert.equal(list.engine, "meili");
  assert.equal(calls, 3, "2 polls indexing puis succès");
});

test("polling : engine meili sans le doc → échec explicite IMMÉDIAT", async () => {
  const { pollModuleListUntilVisible } = await loadHelper();
  let calls = 0;
  const json = async () => {
    calls += 1;
    return { items: [], total: 0, engine: "meili" };
  };
  await assert.rejects(
    pollModuleListUntilVisible(json, "/x", (items) => items.length >= 1, {
      intervalMs: 5,
    }),
    /engine:"meili".*indexation terminée|indexation terminée/,
  );
  assert.equal(calls, 1, "index figé = échec sans attendre la borne");
});

test("polling : jamais visible → échec borné explicite avec diagnostics", async () => {
  const { pollModuleListUntilVisible } = await loadHelper();
  let calls = 0;
  const json = async () => {
    calls += 1;
    return { items: [], total: 0, engine: "indexing" };
  };
  const t0 = Date.now();
  await assert.rejects(
    pollModuleListUntilVisible(json, "/x", () => false, {
      timeoutMs: 200,
      intervalMs: 20,
    }),
    /après 0s de polling \(engine=indexing/,
  );
  assert.ok(Date.now() - t0 < 5_000, "borne respectée");
  assert.ok(calls >= 2, "au moins une relance avant la borne");
});

test("polling : liste SQL déterministe (engine sql / absent) → succès immédiat", async () => {
  const { pollModuleListUntilVisible } = await loadHelper();
  for (const engine of ["sql", undefined]) {
    let calls = 0;
    const json = async () => {
      calls += 1;
      return { items: [{ id: "a1" }], total: 1, ...(engine ? { engine } : {}) };
    };
    const list = await pollModuleListUntilVisible(
      json,
      "/x",
      (items) => items.length >= 1,
      { intervalMs: 5 },
    );
    assert.equal(list.items.length, 1);
    assert.equal(calls, 1, "read-your-writes SQL : un seul appel");
  }
});

test("hydratation ?ids= : URL encodée, row rendue, échec explicite sinon", async () => {
  const { assertModuleRowHydratedById } = await loadHelper();
  const seen = [];
  const okJson = async (method, urlPath) => {
    seen.push(`${method} ${urlPath}`);
    return { items: [{ id: "a b" }], total: 1 };
  };
  await assertModuleRowHydratedById(
    okJson,
    "/api/v1/modules/widgets",
    "a b",
    "widgets",
  );
  assert.match(
    seen[0],
    /GET \/api\/v1\/modules\/widgets\?ids=a%20b$/,
    "hydratation par PK via ?ids= (encodé)",
  );

  const koJson = async () => ({ items: [], total: 0 });
  await assert.rejects(
    assertModuleRowHydratedById(koJson, "/x", "zz", "widgets"),
    /hydratation \?ids= doit rendre la row créée/,
  );
});

/* ── Branchement dans les smokes embarqués / générés ──────────────────── */

test("source : e2e-browser-parcours branche le helper (plus d'assert naïve)", () => {
  const src = read("packages/desktop-tooling/scripts/e2e-browser-parcours.mjs");
  assert.match(src, /from "\.\/meili-list-poll\.mjs"/);
  assert.match(src, /assertModuleRowHydratedById\(/);
  assert.match(src, /pollModuleListUntilVisible\(/);
  // L'indexation doit tourner pour que la visibilité liste soit testable :
  // MEILI_SKIP_INDEX ne peut plus être « 1 » par défaut.
  assert.match(
    src,
    /MEILI_SKIP_INDEX:\s*process\.env\.MEILI_SKIP_INDEX \|\| "0"/,
    "indexation ON par défaut (sinon engine indexing indéfini)",
  );
  assert.doesNotMatch(
    src,
    /const list = await json\("GET", `\/api\/v1\/modules\/\$\{primary\}`\);\s*assert\.ok\(/,
    "assertion naïve GET liste immédiat post-create encore présente",
  );
});

test("source : templates factory branchés (générique + CHR + mini-prd)", () => {
  const src = read("packages/factory/src/generators/tests.ts");
  // Import du helper publié (subpath ./scripts/* autorisé par exports).
  assert.match(
    src,
    /@creezio\/desktop-tooling\/scripts\/meili-list-poll\.mjs/,
  );
  // Générique : ?ids= déterministe + polling borné.
  assert.match(src, /assertModuleRowHydratedById\(\s*\n?\s*json,/);
  // CHR parcours : recherche « tom » pollée jusqu'à sortie d'indexation.
  assert.match(src, /\/api\/v1\/modules\/search\?q=tom",\s*\n?\s*\(items, list\)/);
  // Mini-PRD : listes fournisseurs Meili-bound pollées.
  assert.match(src, /fournisseurs\?archived=0",\s*\n?\s*\(items\)/);
  // Le pattern naïf « GET immédiat + assert items.length » a disparu du
  // smoke générique (il ne reste que des GET sur mounts SQL déterministes).
  assert.doesNotMatch(
    src,
    /const list = await json\("GET", "\/api\/v1\/modules\/\$\{entity\.id\}"\);/,
  );
});
