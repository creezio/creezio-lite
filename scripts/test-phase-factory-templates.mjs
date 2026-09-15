#!/usr/bin/env node
/**
 * Gate — templates factory : substitution des entités RÉELLES du spec.
 *
 * Régressions foove2-admin (2026-08-13) : test-metier-parcours généré sur
 * POST /api/v1/modules/notes alors que l'app déclare prospects/roadmap/clients
 * (404 → CI rouge) ; feed Meili indexant la table notes absente du schema
 * généré ; meili-launcher.js résolu par sondage d'un chemin monorepo kit
 * (packages/electron-shell/dist) inexistant dans une app npm.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadGenerators() {
  const testsPath = path.join(
    ROOT,
    "packages/factory/dist/generators/tests.js",
  );
  const nativePath = path.join(
    ROOT,
    "packages/factory/dist/generators/native-runtime.js",
  );
  assert.ok(
    fs.existsSync(testsPath) && fs.existsSync(nativePath),
    "dist factory manquant — npm run build -w @creezio/factory",
  );
  return {
    tests: await import(pathToFileURL(testsPath).href),
    native: await import(pathToFileURL(nativePath).href),
  };
}

const PLATFORM_NEEDS = {
  auth: true,
  desktop: true,
  pluginApi: true,
  chat: true,
  sync: false,
};

/** Modèle générique type foove2-admin (aucune entité « notes »). */
const GENERIC_MODEL = {
  brandId: "probebrand",
  brandName: "ProbeBrand",
  domain: "probebrand.example",
  tagline: "sonde",
  vertical: "generic",
  entities: [
    {
      id: "prospects",
      label: "Prospect",
      labelPlural: "Prospects",
      archivable: true,
      fields: [
        { name: "nom", type: "text", required: true, label: "Nom" },
        { name: "email", type: "text", label: "Email" },
        { name: "position", type: "number", label: "Position" },
      ],
    },
    {
      id: "roadmap",
      label: "Élément roadmap",
      labelPlural: "Roadmap",
      fields: [{ name: "titre", type: "text", required: true, label: "Titre" }],
    },
  ],
  pages: [],
  flows: [],
  platformNeeds: PLATFORM_NEEDS,
};

/** Modèle avec notes en tête (compat foove2 / demobrand). */
const NOTES_FIRST_MODEL = {
  ...GENERIC_MODEL,
  entities: [
    {
      id: "notes",
      label: "Note",
      labelPlural: "Notes",
      fields: [
        { name: "titre", type: "text", required: true, label: "Titre" },
        { name: "contenu", type: "text", label: "Contenu" },
      ],
    },
    ...GENERIC_MODEL.entities,
  ],
};

/** Modèle CHR (branche riche préservée). */
const CHR_MODEL = {
  ...GENERIC_MODEL,
  vertical: "chr",
  entities: [
    {
      id: "fournisseurs",
      label: "Fournisseur",
      labelPlural: "Fournisseurs",
      fields: [{ name: "nom", type: "text", required: true }],
    },
    {
      id: "panier_lignes",
      label: "Ligne",
      labelPlural: "Lignes",
      fields: [{ name: "quantite", type: "number" }],
    },
    {
      id: "commandes",
      label: "Commande",
      labelPlural: "Commandes",
      fields: [{ name: "statut", type: "text" }],
    },
  ],
};

test("metier-parcours générique : première entité du spec, jamais « notes »", async () => {
  const { tests } = await loadGenerators();
  const out = tests.renderMetierParcoursSmoke(GENERIC_MODEL);
  assert.match(out, /POST", "\/api\/v1\/modules\/prospects"/);
  // La liste prospects est bien requêtée — via le helper de polling
  // (cohérence éventuelle Meili), plus par un GET immédiat naïf.
  assert.match(
    out,
    /pollModuleListUntilVisible\(\s*\n\s*json,\s*\n\s*"\/api\/v1\/modules\/prospects"/,
  );
  assert.doesNotMatch(out, /modules\/notes/);
  // Payload issu des champs déclarés (nom requis, email texte, position).
  assert.match(out, /\{"nom":"Hello","email":"world"\}/);
});

test("metier-parcours générique : cohérence éventuelle Meili (?ids= + polling borné)", async () => {
  const { tests } = await loadGenerators();
  const out = tests.renderMetierParcoursSmoke(GENERIC_MODEL);
  // Helper SoT publié (subpath ./scripts/* autorisé par exports).
  assert.match(
    out,
    /from "@creezio\/desktop-tooling\/scripts\/meili-list-poll\.mjs"/,
  );
  // Read-after-write déterministe par hydratation PK (chemin SQL légitime).
  assert.match(out, /assertModuleRowHydratedById\(/);
  // Visibilité liste : polling borné (engine:"indexing" → retry), jamais
  // d'assertion naïve « GET immédiat post-create ».
  assert.match(out, /pollModuleListUntilVisible\(/);
  assert.doesNotMatch(
    out,
    /const list = await json\("GET", "\/api\/v1\/modules\/prospects"\);/,
    "assertion naïve GET liste immédiat encore générée",
  );
});

test("metier-parcours CHR : recherche « tom » pollée jusqu'à sortie d'indexation", async () => {
  const { tests } = await loadGenerators();
  const out = tests.renderMetierParcoursSmoke(CHR_MODEL);
  assert.match(
    out,
    /from "@creezio\/desktop-tooling\/scripts\/meili-list-poll\.mjs"/,
  );
  assert.match(out, /pollModuleListUntilVisible\(\s*\n\s*json,\s*\n\s*"\/api\/v1\/modules\/search\?q=tom"/);
  // Assertions d'origine conservées (engine sql|meili + ≥ 1 hit).
  assert.match(out, /assert\.ok\(search\.engine === "sql" \|\| search\.engine === "meili"\)/);
  assert.match(out, /assert\.ok\(Array\.isArray\(search\.items\) && search\.items\.length >= 1\)/);
});

test("mini-prd-core CHR : listes fournisseurs Meili-bound pollées, archived=1 reste SQL", async () => {
  const { tests } = await loadGenerators();
  const out = tests.renderMiniPrdCoreSmoke(CHR_MODEL);
  assert.match(
    out,
    /from "@creezio\/desktop-tooling\/scripts\/meili-list-poll\.mjs"/,
  );
  assert.match(out, /"\/api\/v1\/modules\/fournisseurs\?archived=0",\s*\n\s*\(items\)/);
  assert.match(out, /"\/api\/v1\/modules\/fournisseurs\?q=metro&archived=0",\s*\n\s*\(items\)/);
  // archived=1 = hors index par contrat → GET direct conservé (SQL).
  assert.match(out, /const archives = await json\("GET", "\/api\/v1\/modules\/fournisseurs\?archived=1"\);/);
  // Assertions d'origine conservées.
  assert.match(out, /assert\.equal\(actifs\.items\.length, 1\)/);
  assert.match(out, /assert\.equal\(search\.items\.length, 1\)/);
});

test("metier-parcours : notes en première entité → notes conservé", async () => {
  const { tests } = await loadGenerators();
  const out = tests.renderMetierParcoursSmoke(NOTES_FIRST_MODEL);
  assert.match(out, /modules\/notes/);
  assert.match(out, /"titre":"Hello"/);
});

test("metier-parcours CHR : parcours fournisseurs → commande préservé", async () => {
  const { tests } = await loadGenerators();
  const out = tests.renderMetierParcoursSmoke(CHR_MODEL);
  assert.match(out, /modules\/fournisseurs/);
  assert.match(out, /modules\/commandes\/from-panier/);
});

test("meili-feed générique : table de la première entité (jamais « notes »)", async () => {
  const { native } = await loadGenerators();
  const out = native.renderMeiliFeedTs(GENERIC_MODEL);
  assert.match(out, /table: "prospects"/);
  assert.doesNotMatch(out, /table: "notes"/);
  assert.match(out, /searchableAttributes: \["nom","email"\]/);
  assert.match(out, /id: "probebrand-prospects"/);
});

test("meili-feed CHR : preset catalogue inliné (H7, plus d'import déprécié)", async () => {
  const { native } = await loadGenerators();
  const out = native.renderMeiliFeedTs(CHR_MODEL);
  assert.doesNotMatch(out, /createChrCatalogMeiliFeed/);
  assert.match(out, /uid: "catalog_products"/);
  assert.match(out, /uid: "catalog_sites"/);
  assert.match(out, /countTables: \{ produits: "produits", fournisseurs: "fournisseurs" \}/);
  assert.match(out, /configureMeiliBrandFeed\(brandMeiliFeed\)/);
});

test("meili-config : import public @creezio/search + fixture entité réelle", async () => {
  const { tests } = await loadGenerators();
  const out = tests.renderMeiliConfigSmoke(GENERIC_MODEL);
  // P1.b : import public bare (node_modules-first PAR CONSTRUCTION — même
  // invariant que le helper electronShellDist porté de winhub, en plus fort :
  // plus AUCUN sondage de dist interne, ni kit ni node_modules).
  assert.match(out, /await import\("@creezio\/search"\)/);
  assert.match(out, /startMeili/);
  assert.match(out, /runFeedIndexation, searchMeiliIndexes/);
  assert.doesNotMatch(out, /electronShellDist/);
  assert.doesNotMatch(out, /dist\/host|dist", "host|"host", "meili/);
  assert.doesNotMatch(out, /creezioRoot \|\| path\.join\(root, "\.\.\/\.\."\)/);
  // Fixture : INSERT dans la table réelle de la première entité.
  assert.match(out, /INSERT INTO prospects \(id, created_at, updated_at, nom, email, position\)/);
  assert.match(out, /"Tomates"/);
  assert.doesNotMatch(out, /INSERT INTO notes/);
});
