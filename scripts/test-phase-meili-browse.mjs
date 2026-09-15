#!/usr/bin/env node
/**
 * Gate Meili browse — contrat plateforme « Meili = composant CORE » :
 * - browse q vide = Meili (POST q:"") ;
 * - 0 hit = engine meili (jamais 0-hit → SQL) ;
 * - boot fail-closed : feed indexé + binaire absent = throw MeiliRequiredError
 *   (échappatoire unique CREEZIO_ALLOW_NO_MEILI=1, dev/tests hors-browse) ;
 * - entité indexée + Meili KO = 503 meili_unavailable (ou engine:"indexing"
 *   pendant l'indexation initiale) — zéro LIKE SQL de secours ;
 * - filtre rejeté = SQL VISIBLE (cas hors index) ;
 * - factory search mount fail-closed (503 dans le catch, SQL sous flag only) ;
 * - module catalogue généré déclare meiliIndexes OU horsIndexJustification ;
 * - doctor brand-spec MODULE_MEILI_MISSING (entité listable sans schéma) ;
 * - searchMeiliIndexes n'est PAS le helper de browse (retourne [] si q vide).
 */
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("source : browseMeiliIndex accepte q vide (kit)", () => {
  const api = read("packages/api-kernel/src/meili-browse.ts");
  assert.match(api, /export async function browseMeiliIndex/);
  assert.match(api, /q:\s*req\.query \?\? ""/);
  assert.match(api, /numberOfDocuments/);
  assert.doesNotMatch(api, /if\s*\(\s*!q|if\s*\(\s*!opts\.query/);

  const shell = read("packages/search/src/meili/browse.ts");
  assert.match(shell, /export async function browseMeiliIndex/);
  assert.match(shell, /q:\s*req\.query \?\? ""/);
  assert.match(shell, /searchMeiliIndexes/);
});

test("source : searchMeiliIndexes refuse q vide (pas un browse)", () => {
  const gen = read("packages/search/src/meili/generic-indexer.ts");
  assert.match(gen, /export async function searchMeiliIndexes/);
  assert.match(gen, /if\s*\(\s*!q\s*\|\|/);
});

test("source : searchMeiliIndexes fail-closed — seul le 404 index absent est toléré", () => {
  const gen = read("packages/search/src/meili/generic-indexer.ts");
  const start = gen.indexOf("export async function searchMeiliIndexes");
  assert.ok(start >= 0);
  const chunk = gen.slice(start, start + 1600);
  assert.match(
    chunk,
    /Meili HTTP 404/,
    "le catch doit distinguer l'index absent (404)",
  );
  assert.match(
    chunk,
    /throw err/,
    "Meili down / 5xx / timeout doivent être RETHROW (pas de [] silencieux)",
  );
  assert.doesNotMatch(
    chunk,
    /catch\s*\{/,
    "catch vide interdit — il avalait Meili down en [] (200 silencieux)",
  );
});

test("source : factory search — 0 hit reste meili, fail-closed dans le catch", () => {
  const native = read("packages/factory/src/generators/native-runtime.ts");
  const start = native.indexOf("function createSearchMount()");
  assert.ok(start >= 0, "createSearchMount absent");
  const chunk = native.slice(start, start + 4500);
  assert.doesNotMatch(
    chunk,
    /if\s*\(\s*hits\.length\s*>\s*0\s*\)/,
    "piège 0-hit → SQL encore présent dans createSearchMount",
  );
  assert.match(chunk, /engine:\s*"meili"/);
  assert.match(chunk, /0 hit Meili EST la réponse/);
  assert.match(chunk, /hits:\s*mapped/);
  // Fail-closed : Meili KO = 503 meili_unavailable ; SQL uniquement sous
  // CREEZIO_ALLOW_NO_MEILI=1 ; engine indexing pendant l'indexation initiale.
  assert.match(chunk, /meili_unavailable/);
  assert.match(chunk, /CREEZIO_ALLOW_NO_MEILI/);
  assert.match(chunk, /engine:\s*"indexing"/);
});

test("source : boot Meili fail-closed (MeiliRequiredError + échappatoire unique)", () => {
  const boot = read("packages/search/src/brand-meili-boot.ts");
  assert.match(boot, /class MeiliRequiredError/);
  assert.match(boot, /MEILI_REQUIRED/);
  assert.match(boot, /CREEZIO_ALLOW_NO_MEILI/);
  assert.match(
    boot,
    /throw new MeiliRequiredError/,
    "feed indexé + binaire absent doit throw (fail-closed)",
  );
  // Le harness desktop doit propager l'erreur fail-closed (pas de swallow).
  const desktop = read("packages/app-runtime/src/start-brand-desktop.ts");
  assert.match(desktop, /MEILI_REQUIRED/);
});

test("source : Meili pagination.maxTotalHits plancher (pas de cap 1000 silencieux)", () => {
  const settings = read("packages/search/src/meili/pagination-settings.ts");
  assert.match(settings, /DEFAULT_MEILI_MAX_TOTAL_HITS\s*=\s*100_000/);
  assert.match(settings, /export function mergeMeiliIndexSettings/);
  assert.match(settings, /CREEZIO_MEILI_MAX_TOTAL_HITS/);

  const indexer = read("packages/search/src/meili/generic-indexer.ts");
  assert.match(indexer, /mergeMeiliIndexSettings\(settings\)/);
  assert.match(indexer, /export async function ensureMeiliPaginationSettings/);

  const boot = read("packages/search/src/brand-meili-boot.ts");
  assert.match(boot, /ensureMeiliPaginationSettings/);
  assert.match(
    boot,
    /indexSkipped:\s*true/,
    "le PATCH settings doit tourner sur le chemin fingerprint à jour (pas seulement à la réindexation)",
  );

  const factoryMod = read("packages/factory/src/generators/modules-registry.ts");
  assert.match(factoryMod, /maxTotalHits:\s*100000/);
  const factoryFeed = read("packages/factory/src/generators/meili-feed-presets.ts");
  assert.match(factoryFeed, /maxTotalHits:\s*100000/);
});

test("isolé : mergeMeiliIndexSettings lève le défaut 1000 sans écraser un plafond plus haut", async () => {
  const { mergeMeiliIndexSettings, DEFAULT_MEILI_MAX_TOTAL_HITS } = await import(
    path.join(ROOT, "packages/search/dist/meili/pagination-settings.js")
  );
  assert.equal(DEFAULT_MEILI_MAX_TOTAL_HITS, 100_000);
  const raised = mergeMeiliIndexSettings({
    searchableAttributes: ["nom"],
    pagination: { maxTotalHits: 1000 },
  });
  assert.equal(raised.pagination.maxTotalHits, 100_000);
  assert.deepEqual(raised.searchableAttributes, ["nom"]);
  const kept = mergeMeiliIndexSettings({
    pagination: { maxTotalHits: 250_000 },
  });
  assert.equal(kept.pagination.maxTotalHits, 250_000);
  const empty = mergeMeiliIndexSettings({});
  assert.equal(empty.pagination.maxTotalHits, 100_000);
});

test("source : entity-mount fail-closed (503 meili_unavailable, indexing)", () => {
  const mount = read("packages/api-kernel/src/entity-mount.ts");
  assert.match(mount, /meili_unavailable/);
  assert.match(mount, /engine:\s*"indexing"/);
  assert.match(mount, /CREEZIO_ALLOW_NO_MEILI/);
  assert.match(mount, /browseMeiliIndexOutcome/);
  const browse = read("packages/api-kernel/src/meili-browse.ts");
  assert.match(browse, /export async function browseMeiliIndexOutcome/);
  assert.match(browse, /filter_rejected/);
});

test("source : doctor brand-spec impose meiliIndexes ou horsIndexJustification", () => {
  const doctor = read("packages/brand-spec/src/doctor.ts");
  assert.match(doctor, /MODULE_MEILI_MISSING/);
  assert.match(doctor, /doctorBrandModuleMeili/);
  assert.match(doctor, /horsIndexJustification/);
});

test("source : factory module catalogue déclare meiliIndexes ou hors-index", () => {
  const reg = read("packages/factory/src/generators/modules-registry.ts");
  assert.match(reg, /horsIndexJustification/);
  assert.match(reg, /function renderMeiliOrHorsIndexBlock/);
  assert.match(reg, /catalog_products/);
  assert.match(reg, /CATALOG_BROWSE_IDS/);
  const init = read("packages/factory/src/brand-module-init.ts");
  assert.match(init, /meiliIndexes/);
  assert.match(init, /horsIndexJustification/);
  const guide = read("docs/agents/CREATE-MODULE.md");
  assert.match(guide, /horsIndexJustification/);
  assert.match(guide, /browseMeiliIndex/);
});

test("isolé : browse q vide = Meili, 0 hit = meili, filtre rejeté = null", async () => {
  const { browseMeiliIndex } = await import(
    path.join(ROOT, "packages/api-kernel/dist/meili-browse.js")
  );

  const docs = [{ id: "p1", title: "Tomates", categorie_id: 12 }];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const json = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname.endsWith("/stats")) {
      return json(200, { numberOfDocuments: docs.length });
    }
    if (req.method === "POST" && url.pathname.includes("/search")) {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        const filter = Array.isArray(body.filter)
          ? body.filter.join(" AND ")
          : String(body.filter || "");
        if (filter.includes("unknown_field")) {
          return json(400, { message: "invalid filter" });
        }
        const q = String(body.q ?? "");
        let hits = docs;
        if (q === "nomatch") hits = [];
        else if (filter.includes("categorie_id = 12")) hits = docs;
        else if (q === "" || q === "tom") hits = docs;
        json(200, { hits, totalHits: hits.length });
      });
      return;
    }
    json(404, {});
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const host = `http://127.0.0.1:${port}`;
  try {
    const emptyQ = await browseMeiliIndex({
      host,
      indexUid: "catalog_products",
      query: "",
      filters: ["categorie_id = 12"],
    });
    assert.ok(emptyQ, "q vide + filtre doit servir Meili");
    assert.equal(emptyQ.hits.length, 1);
    assert.equal(emptyQ.total, 1);

    const zero = await browseMeiliIndex({
      host,
      indexUid: "catalog_products",
      query: "nomatch",
    });
    assert.ok(zero, "0 hit = succès Meili (pas null)");
    assert.equal(zero.hits.length, 0);
    assert.equal(zero.total, 0);

    const rejected = await browseMeiliIndex({
      host,
      indexUid: "catalog_products",
      query: "",
      filters: ["unknown_field = 1"],
    });
    assert.equal(rejected, null, "filtre rejeté → null (compat)");
  } finally {
    server.close();
  }
});

test("isolé : browseMeiliIndexOutcome discrimine incident vs hors-index", async () => {
  const { browseMeiliIndexOutcome } = await import(
    path.join(ROOT, "packages/api-kernel/dist/meili-browse.js")
  );

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const json = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname.includes("/indexes/missing_index/")) return json(404, {});
    if (url.pathname.endsWith("/stats")) {
      return json(200, { numberOfDocuments: 1 });
    }
    if (req.method === "POST" && url.pathname.includes("/search")) {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        const filter = Array.isArray(body.filter)
          ? body.filter.join(" AND ")
          : String(body.filter || "");
        if (filter.includes("bad_attr")) {
          return json(400, { message: "invalid filter" });
        }
        json(200, { hits: [{ id: "p1" }], totalHits: 1 });
      });
      return;
    }
    json(404, {});
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const host = `http://127.0.0.1:${port}`;
  try {
    const ok = await browseMeiliIndexOutcome({
      host,
      indexUid: "catalog_products",
      query: "",
    });
    assert.equal(ok.kind, "ok");
    assert.equal(ok.result.total, 1);

    const missing = await browseMeiliIndexOutcome({
      host,
      indexUid: "missing_index",
      query: "",
    });
    assert.equal(missing.kind, "index_missing");

    const rejected = await browseMeiliIndexOutcome({
      host,
      indexUid: "catalog_products",
      query: "",
      filters: ["bad_attr = 1"],
    });
    assert.equal(rejected.kind, "filter_rejected", "400 = hors index (SQL visible)");
  } finally {
    server.close();
  }

  // Meili down (port fermé) = incident → unavailable (503 côté entity-list).
  const down = await browseMeiliIndexOutcome({
    host,
    indexUid: "catalog_products",
    query: "",
    timeoutMs: 500,
  });
  assert.equal(down.kind, "unavailable", "Meili down doit être un incident");

  const unconfigured = await browseMeiliIndexOutcome({
    host: "",
    indexUid: "catalog_products",
  });
  assert.equal(unconfigured.kind, "unconfigured");
});

test("isolé : doctor MODULE_MEILI_MISSING sur entité listable sans schéma", async () => {
  const os = await import("node:os");
  const { doctorBrandSpec } = await import(
    path.join(ROOT, "packages/brand-spec/dist/doctor.js")
  );
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-meili-doctor-"));
  try {
    const specDir = path.join(tmp, "brand-spec");
    const modDir = path.join(specDir, "modules", "articles");
    fs.mkdirSync(modDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, "brand.yaml"),
      'brandId: acme\nbrandName: Acme\ndomain: acme.local\n',
    );
    fs.writeFileSync(path.join(specDir, "product.md"), "# Produit Acme\n");
    fs.writeFileSync(path.join(modDir, "prd.md"), "# Articles\n");
    fs.writeFileSync(path.join(modDir, "interview.md"), "# Interview\n");
    // Pin lockstep ≥ 0.10.13 → fail-closed.
    fs.mkdirSync(path.join(tmp, "server"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "server", "package.json"),
      JSON.stringify({
        dependencies: { "@creezio/app-runtime": "^0.10.13" },
      }),
    );
    const modulesDir = path.join(tmp, "server", "src", "electron", "modules");
    fs.mkdirSync(modulesDir, { recursive: true });
    const moduleTs = (extra) => `
export const articlesModule = {
  id: "articles",
  entitySpecs: { articles: { table: "articles", columns: [{ name: "nom" }] } },
${extra}
  demo: { scenarios: [genericOsTourScenario({ productName: "Acme" })] },
};
`;
    // Sans schéma data/index → error.
    fs.writeFileSync(path.join(modulesDir, "articles.ts"), moduleTs(""));
    const bad = doctorBrandSpec(specDir);
    assert.ok(
      bad.issues.some(
        (i) => i.code === "MODULE_MEILI_MISSING" && i.level === "error",
      ),
      `MODULE_MEILI_MISSING attendu: ${JSON.stringify(bad.issues)}`,
    );
    // Justification hors-index → plus d'issue Meili.
    fs.writeFileSync(
      path.join(modulesDir, "articles.ts"),
      moduleTs('  horsIndexJustification: "écritures internes — hors browse catalogue",'),
    );
    const good = doctorBrandSpec(specDir);
    assert.ok(
      !good.issues.some((i) => i.code === "MODULE_MEILI_MISSING"),
      `pas d'issue attendue: ${JSON.stringify(good.issues)}`,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
