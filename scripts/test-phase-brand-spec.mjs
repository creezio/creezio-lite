#!/usr/bin/env node
/**
 * Gate BrandSpec — load / doctor / init / onboarding decl.
 * Extract P1.1 : package + ADR (+ CREATE-BRAND doc). CLI brand / TF3 app = vagues suivantes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  doctorBrandSpec,
  formatDoctorReport,
  initBrandSpec,
  loadBrandSpec,
  resolveOnboardingDecl,
  toSetupWizardConfig,
} from "../packages/brand-spec/dist/index.js";
import {
  collectCreatedTablesFromSql,
} from "../packages/brand-spec/dist/meili-table-coherence.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function makeLivrableSpec(specDir, brandName) {
  fs.writeFileSync(
    path.join(specDir, "product.md"),
    `# ${brandName}

Gestion d'articles.

## Entités

### Articles
- nom (texte)
`,
    "utf8",
  );
  const modDir = path.join(specDir, "modules", "articles");
  fs.mkdirSync(modDir, { recursive: true });
  fs.writeFileSync(
    path.join(modDir, "prd.md"),
    `# Module articles — Articles\n\nVision remplie pour le livrable de test.\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(modDir, "interview.md"),
    `# Interview articles\n\nDécisions remplies.\n`,
    "utf8",
  );
}

test("BS1 package brand-spec buildé", () => {
  assert.ok(
    fs.existsSync(path.join(ROOT, "packages/brand-spec/dist/index.js")),
  );
});

test("BS2 initBrandSpec + load + doctor", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-bs2-"));
  const result = initBrandSpec({
    outDir: out,
    brandId: "acmeprobe",
    brandName: "Acme Probe",
    domain: "acmeprobe.local",
    vertical: "generic",
    force: true,
  });
  const spec = loadBrandSpec(result.outDir);
  assert.equal(spec.brand.brandId, "acmeprobe");
  assert.equal(spec.brand.vertical, "generic");
  assert.ok(spec.productMd);
  const doctor = doctorBrandSpec(result.outDir);
  assert.equal(doctor.ok, false, formatDoctorReport(doctor));
  assert.ok(
    doctor.issues.some((i) => i.code === "NO_MODULES"),
    formatDoctorReport(doctor),
  );
  assert.ok(
    doctor.issues.some((i) => i.code === "PRODUCT_MD_STUB"),
    formatDoctorReport(doctor),
  );
});

test("BS3 onboarding decl depuis brand-spec", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-bs3-"));
  const result = initBrandSpec({
    outDir: out,
    brandId: "acmeonb",
    brandName: "Acme Onb",
    domain: "acmeonb.local",
    vertical: "generic",
    force: true,
  });
  const spec = loadBrandSpec(result.outDir);
  const decl = resolveOnboardingDecl(spec);
  assert.ok(decl);
  assert.equal(decl.enabled, true);
  const cfg = toSetupWizardConfig(decl);
  assert.equal(cfg.slugPlaceholder, "mon-espace");
  assert.equal(cfg.afterCompleteHref, "/onboarding");
});

test("BS3b demo-app : onboardingEnabled=false → home", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-bs3b-"));
  const result = initBrandSpec({
    outDir: out,
    brandId: "acmedemo",
    brandName: "Acme Demo",
    domain: "acmedemo.local",
    vertical: "generic",
    force: true,
    onboardingEnabled: false,
  });
  const spec = loadBrandSpec(result.outDir);
  assert.equal(spec.brand.platform?.onboarding, false);
  const decl = resolveOnboardingDecl(spec);
  assert.ok(decl);
  assert.equal(decl.enabled, false);
  assert.equal(toSetupWizardConfig(decl).afterCompleteHref, "/");
  const yaml = fs.readFileSync(path.join(result.outDir, "brand.yaml"), "utf8");
  assert.match(yaml, /onboarding:\s*false/);
  assert.match(yaml, /afterCompleteHref:\s*\//);
});

test("BS4 initBrandSpec écrit squelette", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-init-"));
  const result = initBrandSpec({
    outDir: out,
    brandId: "acmeprobe",
    brandName: "Acme Probe",
    domain: "acmeprobe.local",
    vertical: "generic",
    force: true,
  });
  assert.ok(fs.existsSync(path.join(result.outDir, "brand.yaml")));
  assert.ok(fs.existsSync(path.join(result.outDir, "product.md")));
  assert.ok(fs.existsSync(path.join(result.outDir, "AGENTS.md")));
  assert.ok(fs.existsSync(path.join(result.outDir, "interview.schema.json")));
  const doctor = doctorBrandSpec(result.outDir);
  assert.equal(doctor.ok, false, formatDoctorReport(doctor));
  assert.ok(doctor.issues.some((i) => i.code === "NO_MODULES"));
  assert.ok(doctor.issues.some((i) => i.code === "PRODUCT_MD_STUB"));

  // Le gabarit d'interview module porte les conventions dures du kit :
  // une interview générée ne doit plus POUVOIR proposer « accueil à / »
  // (vécu foove2 — contradiction spec ↔ workspace kit, DOC-STANDARD-MODULE).
  const interviewTpl = fs.readFileSync(
    path.join(result.outDir, "modules/_template/interview.md"),
    "utf8",
  );
  assert.match(
    interviewTpl,
    /## Conventions OS non négociables/,
    "template interview sans section Conventions OS",
  );
  assert.match(
    interviewTpl,
    /Home = `\/dashboard`/,
    "template interview : home = /dashboard absent",
  );
  assert.match(
    interviewTpl,
    /`\/` = pure redirection factory/,
    "template interview : '/' pure redirection absent",
  );
  assert.match(
    interviewTpl,
    /href: "\/dashboard"/,
    "template interview : nav accueil → /dashboard absent",
  );
  assert.match(
    interviewTpl,
    /démo interactive \(\*\*obligatoire\*\*/,
    "template interview : démo interactive obligatoire",
  );
  assert.doesNotMatch(
    interviewTpl,
    /démo interactive \(optionnel\)/,
    "template interview ne doit plus dire démo optionnelle",
  );
});

test("BS5 ADR + CREATE-BRAND docs", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "docs/adr/ADR-brand-spec-app-runtime.md")));
  assert.ok(fs.existsSync(path.join(ROOT, "docs/agents/CREATE-BRAND.md")));
  const create = fs.readFileSync(
    path.join(ROOT, "docs/agents/CREATE-BRAND.md"),
    "utf8",
  );
  assert.match(create, /startBrandDesktop/);
  assert.match(create, /brand apply/);
  assert.match(create, /Démo interactive native obligatoire/);
  assert.ok(fs.existsSync(path.join(ROOT, "docs/agents/CREATE-APP.md")));
  assert.match(
    fs.readFileSync(path.join(ROOT, "docs/agents/CREATE-APP.md"), "utf8"),
    /brand create/,
  );
  const createMod = fs.readFileSync(
    path.join(ROOT, "docs/agents/CREATE-MODULE.md"),
    "utf8",
  );
  assert.doesNotMatch(createMod, /Démo interactive \(optionnel\)/);
  assert.match(createMod, /Démo interactive \(\*\*obligatoire\*\*/);
});

test("BS6 doctor : module sans demo.scenarios = erreur (app scaffoldée)", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-demo-"));
  const result = initBrandSpec({
    outDir: path.join(work, "brand-spec"),
    brandId: "demodoc",
    brandName: "Demo Doc",
    domain: "demodoc.local",
    vertical: "generic",
    force: true,
  });
  makeLivrableSpec(result.outDir, "Demo Doc");
  const modulesDir = path.join(work, "server/src/electron/modules");
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(
    path.join(modulesDir, "articles.ts"),
    `export const articlesModule = { id: "articles" };\n`,
    "utf8",
  );
  const doctor = doctorBrandSpec(result.outDir);
  assert.equal(doctor.ok, false);
  assert.ok(
    doctor.issues.some((i) => i.code === "MODULE_DEMO_MISSING"),
    formatDoctorReport(doctor),
  );
  fs.writeFileSync(
    path.join(modulesDir, "articles.ts"),
    `import { genericOsTourScenario } from "@creezio/interactive-demo";
export const articlesModule = {
  id: "articles",
  demo: { scenarios: [genericOsTourScenario({ productName: "Demo Doc" })] },
};
`,
    "utf8",
  );
  const ok = doctorBrandSpec(result.outDir);
  assert.equal(ok.ok, true, formatDoctorReport(ok));
  fs.rmSync(work, { recursive: true, force: true });
});

test("BS7 doctor : helpers modules ignorés (_lib, shared, mcp-shared, meili-shared, index, types)", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-helpers-"));
  const result = initBrandSpec({
    outDir: path.join(work, "brand-spec"),
    brandId: "helpdoc",
    brandName: "Help Doc",
    domain: "helpdoc.local",
    vertical: "generic",
    force: true,
  });
  makeLivrableSpec(result.outDir, "Help Doc");
  const modulesDir = path.join(work, "server/src/electron/modules");
  fs.mkdirSync(modulesDir, { recursive: true });
  for (const name of [
    "index.ts",
    "types.ts",
    "shared.ts",
    "mcp-shared.ts",
    "meili-shared.ts",
    "_lib.ts",
  ]) {
    fs.writeFileSync(
      path.join(modulesDir, name),
      `export const helper = "${name}";\n`,
      "utf8",
    );
  }
  fs.writeFileSync(
    path.join(modulesDir, "articles.ts"),
    `import { genericOsTourScenario } from "@creezio/interactive-demo";
export const articlesModule = {
  id: "articles",
  demo: { scenarios: [genericOsTourScenario({ productName: "Help Doc" })] },
};
`,
    "utf8",
  );
  const doctor = doctorBrandSpec(result.outDir);
  assert.equal(doctor.ok, true, formatDoctorReport(doctor));
  assert.ok(
    !doctor.issues.some(
      (i) => i.code === "MODULE_DEMO_MISSING" && /shared|_lib|index|types/.test(i.message),
    ),
    formatDoctorReport(doctor),
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("BS8 doctor : démo trop pauvre = warn (pas fail-closed)", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-thin-"));
  const result = initBrandSpec({
    outDir: path.join(work, "brand-spec"),
    brandId: "thindoc",
    brandName: "Thin Doc",
    domain: "thindoc.local",
    vertical: "generic",
    force: true,
  });
  makeLivrableSpec(result.outDir, "Thin Doc");
  const modulesDir = path.join(work, "server/src/electron/modules");
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(
    path.join(modulesDir, "articles.ts"),
    `export const articlesModule = {
  id: "articles",
  demo: {
    scenarios: [{
      id: "tiny",
      title: "Mini",
      steps: [{ kind: "say", id: "s1", title: "Hi" }],
    }],
  },
};
`,
    "utf8",
  );
  const doctor = doctorBrandSpec(result.outDir);
  assert.equal(doctor.ok, true, formatDoctorReport(doctor));
  const thin = doctor.issues.find((i) => i.code === "MODULE_DEMO_THIN");
  assert.ok(thin, formatDoctorReport(doctor));
  assert.equal(thin.level, "warn");
  assert.match(thin.message, /autoStart|steps trop courts/);
  fs.rmSync(work, { recursive: true, force: true });
});

test("BS9 doctor : pin 0.9.2 (Winhub) — hors fenêtre N-2 = warn daté devenu ERROR", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-winhub-"));
  const result = initBrandSpec({
    outDir: path.join(work, "brand-spec"),
    brandId: "winhubdoc",
    brandName: "Winhub Doc",
    domain: "winhubdoc.local",
    vertical: "generic",
    force: true,
  });
  makeLivrableSpec(result.outDir, "Winhub Doc");
  const modulesDir = path.join(work, "server/src/electron/modules");
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(
    path.join(work, "server/package.json"),
    JSON.stringify({
      name: "winhub-server",
      dependencies: { "@creezio/platform-core": "^0.9.2" },
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(modulesDir, "articles.ts"),
    `export const articlesModule = { id: "articles" };\n`,
    "utf8",
  );
  // Politique de seuils DATÉS (P3.a / F4.4c) : un pin 0.9.x a largement plus
  // de 2 versions lockstep de retard sur le kit courant → le warn historique
  // (« warn éternel ») est escaladé en ERROR, avec un message actionnable.
  const doctor = doctorBrandSpec(result.outDir);
  assert.equal(doctor.ok, false, formatDoctorReport(doctor));
  const missing = doctor.issues.find((i) => i.code === "MODULE_DEMO_MISSING");
  assert.ok(missing, formatDoctorReport(doctor));
  assert.equal(missing.level, "error");
  assert.match(missing.message, /politique N-2/);
  assert.match(missing.message, /creezio upgrade/);
  fs.rmSync(work, { recursive: true, force: true });
});

test("BS10 doctor : leftover notes.ts = error (hors allowlist)", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-notes-"));
  const result = initBrandSpec({
    outDir: path.join(work, "brand-spec"),
    brandId: "notesdoc",
    brandName: "Notes Doc",
    domain: "notesdoc.local",
    vertical: "generic",
    force: true,
  });
  makeLivrableSpec(result.outDir, "Notes Doc");
  const modulesDir = path.join(work, "server/src/electron/modules");
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(
    path.join(modulesDir, "articles.ts"),
    `import { genericOsTourScenario } from "@creezio/interactive-demo";
export const articlesModule = {
  id: "articles",
  demo: { scenarios: [genericOsTourScenario({ productName: "Notes Doc" })] },
};
`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(modulesDir, "notes.ts"),
    `export const notesModule = { id: "notes" };\n`,
    "utf8",
  );
  const doctor = doctorBrandSpec(result.outDir);
  assert.equal(doctor.ok, false, formatDoctorReport(doctor));
  assert.ok(
    doctor.issues.some((i) => i.code === "NOTES_LEFTOVER" && i.level === "error"),
    formatDoctorReport(doctor),
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("BS11 doctor : MODULE_SPEC_STUB (à remplir) = error", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-modstub-"));
  const result = initBrandSpec({
    outDir: path.join(work, "brand-spec"),
    brandId: "modstub",
    brandName: "Mod Stub",
    domain: "modstub.local",
    vertical: "generic",
    force: true,
  });
  fs.writeFileSync(
    path.join(result.outDir, "product.md"),
    `# Mod Stub\n\nGestion d'articles.\n\n## Entités\n\n### Articles\n- nom (texte)\n`,
    "utf8",
  );
  const modDir = path.join(result.outDir, "modules", "articles");
  fs.mkdirSync(modDir, { recursive: true });
  fs.writeFileSync(
    path.join(modDir, "prd.md"),
    `# Module articles\n\n(à remplir)\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(modDir, "interview.md"),
    `# Interview articles\n\nDécisions remplies.\n`,
    "utf8",
  );
  const doctor = doctorBrandSpec(result.outDir);
  assert.equal(doctor.ok, false, formatDoctorReport(doctor));
  assert.ok(
    doctor.issues.some((i) => i.code === "MODULE_SPEC_STUB" && i.level === "error"),
    formatDoctorReport(doctor),
  );
  fs.rmSync(work, { recursive: true, force: true });
});

function scaffoldDoctorApp(work, brandId, brandName) {
  const result = initBrandSpec({
    outDir: path.join(work, "brand-spec"),
    brandId,
    brandName,
    domain: `${brandId}.local`,
    vertical: "generic",
    force: true,
  });
  makeLivrableSpec(result.outDir, brandName);
  const modulesDir = path.join(work, "server/src/electron/modules");
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(
    path.join(modulesDir, "articles.ts"),
    `import { genericOsTourScenario } from "@creezio/interactive-demo";
export const articlesModule = {
  id: "articles",
  demo: { scenarios: [genericOsTourScenario({ productName: "${brandName}" })] },
};
`,
    "utf8",
  );
  return { specDir: result.outDir, modulesDir };
}

test("BS13 doctor : types.ts redéclarant BrandModuleDef = MODULE_TYPES_DIVERGENT (P2.c)", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-types-"));
  const { specDir, modulesDir } = scaffoldDoctorApp(work, "typdoc", "Typ Doc");
  fs.writeFileSync(
    path.join(modulesDir, "types.ts"),
    `export type BrandModuleDef = {\n  id: string;\n};\n`,
    "utf8",
  );
  const doctor = doctorBrandSpec(specDir);
  assert.equal(doctor.ok, false, formatDoctorReport(doctor));
  assert.ok(
    doctor.issues.some(
      (i) => i.code === "MODULE_TYPES_DIVERGENT" && i.level === "error",
    ),
    formatDoctorReport(doctor),
  );

  // Forme canonique H9 (ré-export kit) → vert.
  fs.writeFileSync(
    path.join(modulesDir, "types.ts"),
    `export type {\n  BrandMeiliIndex,\n  BrandModuleDef,\n  BrandNavItem,\n} from "@creezio/app-runtime";\n`,
    "utf8",
  );
  const ok = doctorBrandSpec(specDir);
  assert.equal(ok.ok, true, formatDoctorReport(ok));
  assert.ok(
    !ok.issues.some((i) => i.code === "MODULE_TYPES_DIVERGENT"),
    formatDoctorReport(ok),
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("BS14 doctor : apiMount sans permission ni accessJustification = MODULE_PERMISSION_MISSING", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-perm-"));
  const { specDir, modulesDir } = scaffoldDoctorApp(work, "permdoc", "Perm Doc");
  const moduleSrc = (accessLine) => `import { genericOsTourScenario } from "@creezio/interactive-demo";
export const flowModule = {
  id: "flow",
  demo: { scenarios: [genericOsTourScenario({ productName: "Perm Doc" })] },
  horsIndexJustification: "écritures — hors browse",
  apiMounts: {
    flow: {
      dbLayer: "brand",${accessLine}
      operations: [
        { id: "list", method: "GET", path: "/", description: "Lister" },
      ],
      handle: async () => ({ status: 200, body: {} }),
    },
  },
};
`;
  const modPath = path.join(modulesDir, "flow.ts");

  fs.writeFileSync(modPath, moduleSrc(""), "utf8");
  const missing = doctorBrandSpec(specDir);
  assert.equal(missing.ok, false, formatDoctorReport(missing));
  assert.ok(
    missing.issues.some(
      (i) => i.code === "MODULE_PERMISSION_MISSING" && i.level === "error",
    ),
    formatDoctorReport(missing),
  );

  // Dette codemod H9 : "à qualifier" = vert (pas fail-closed) mais warn.
  fs.writeFileSync(
    modPath,
    moduleSrc(`\n      accessJustification: "à qualifier",`),
    "utf8",
  );
  const unqualified = doctorBrandSpec(specDir);
  assert.equal(unqualified.ok, true, formatDoctorReport(unqualified));
  assert.ok(
    unqualified.issues.some(
      (i) => i.code === "MODULE_PERMISSION_UNQUALIFIED" && i.level === "warn",
    ),
    formatDoctorReport(unqualified),
  );

  // Permission déclarée → ni error ni warn.
  fs.writeFileSync(
    modPath,
    moduleSrc(`\n      permission: "nav.flow",`),
    "utf8",
  );
  const qualified = doctorBrandSpec(specDir);
  assert.equal(qualified.ok, true, formatDoctorReport(qualified));
  assert.ok(
    !qualified.issues.some((i) =>
      ["MODULE_PERMISSION_MISSING", "MODULE_PERMISSION_UNQUALIFIED"].includes(
        i.code,
      ),
    ),
    formatDoctorReport(qualified),
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("BS15 doctor : pin < 0.16.0 → contrat P2.c warn dans la fenêtre N-2, error au-delà", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-permpin-"));
  const { specDir, modulesDir } = scaffoldDoctorApp(work, "pindoc", "Pin Doc");
  // Politique datée N-2 : le niveau attendu dépend du retard du pin 0.15.x
  // sur le kit courant (warn tant que ≤ 2 versions lockstep, error après —
  // ce test reste vert quand le kit avance).
  const kitMinor = Number(
    JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "packages/brand-spec/package.json"),
        "utf8",
      ),
    ).version.split(".")[1],
  );
  const expectedLevel = kitMinor - 15 > 2 ? "error" : "warn";
  fs.writeFileSync(
    path.join(work, "server/package.json"),
    JSON.stringify(
      {
        name: "pindoc-server",
        dependencies: { "@creezio/platform-core": "^0.15.0" },
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.writeFileSync(
    path.join(modulesDir, "types.ts"),
    `export type BrandModuleDef = {\n  id: string;\n};\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(modulesDir, "flow.ts"),
    `import { genericOsTourScenario } from "@creezio/interactive-demo";
export const flowModule = {
  id: "flow",
  demo: { scenarios: [genericOsTourScenario({ productName: "Pin Doc" })] },
  horsIndexJustification: "écritures — hors browse",
  apiMounts: {
    flow: {
      dbLayer: "brand",
      operations: [
        { id: "list", method: "GET", path: "/", description: "Lister" },
      ],
      handle: async () => ({ status: 200, body: {} }),
    },
  },
};
`,
    "utf8",
  );
  const doctor = doctorBrandSpec(specDir);
  assert.equal(doctor.ok, expectedLevel === "warn", formatDoctorReport(doctor));
  for (const code of ["MODULE_TYPES_DIVERGENT", "MODULE_PERMISSION_MISSING"]) {
    assert.ok(
      doctor.issues.some((i) => i.code === code && i.level === expectedLevel),
      `${code} attendu en ${expectedLevel} (pin 0.15, kit 0.${kitMinor}) : ${formatDoctorReport(doctor)}`,
    );
  }
  fs.rmSync(work, { recursive: true, force: true });
});

function writeMeiliModule(modulesDir, file, opts) {
  const {
    id,
    table,
    tableProvisionedBy,
    migrationSql,
    extra = "",
  } = opts;
  const provisioned = tableProvisionedBy
    ? `\n      tableProvisionedBy: ${JSON.stringify(tableProvisionedBy)},`
    : "";
  const migrations = migrationSql
    ? `
  migrations: () => [
    { id: "mod_${id}_001_init", sql: ${JSON.stringify(migrationSql)} },
  ],`
    : "";
  fs.writeFileSync(
    path.join(modulesDir, file),
    `import { genericOsTourScenario } from "@creezio/interactive-demo";
export const ${id}Module = {
  id: "${id}",
  demo: { scenarios: [genericOsTourScenario({ productName: "${id}" })] },
  entitySpecs: { ${id}: { table: "${table ?? id}", columns: [{ name: "nom" }] } },
  meiliIndexes: [
    {
      uid: "catalog_${id}",
      countKey: "${id}",
      table: ${JSON.stringify(table)},
      columns: ["id", "nom"],${provisioned}
      settings: { searchableAttributes: ["nom"], filterableAttributes: ["id"] },
    },
  ],${migrations}${extra}
};
`,
    "utf8",
  );
}

test("BS16 parse CREATE TABLE : IF NOT EXISTS + quotes + identifiant nu", () => {
  const names = collectCreatedTablesFromSql(`
    -- ignoré : CREATE TABLE ghost_comment (id TEXT);
    CREATE TABLE IF NOT EXISTS articles (id TEXT);
    CREATE TABLE "quoted_items" (id TEXT);
    CREATE TABLE \`backtick_items\` (id TEXT);
    CREATE TABLE [bracket_items] (id TEXT);
    CREATE TABLE main.schema_items (id TEXT);
    CREATE TEMP TABLE temp_only (id TEXT);
    CREATE TEMPORARY TABLE temp_only_2 (id TEXT);
    /* CREATE TABLE block_commented (id TEXT); */
  `);
  assert.deepEqual(
    [...names].sort(),
    ["articles", "backtick_items", "bracket_items", "quoted_items", "schema_items"].sort(),
  );
});

test("BS17 doctor : meiliIndexes.table OK même module", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-meili-same-"));
  const { specDir, modulesDir } = scaffoldDoctorApp(work, "meilisame", "Meili Same");
  writeMeiliModule(modulesDir, "articles.ts", {
    id: "articles",
    table: "articles",
    migrationSql: "CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, nom TEXT);",
  });
  const doctor = doctorBrandSpec(specDir);
  assert.equal(doctor.ok, true, formatDoctorReport(doctor));
  assert.ok(
    !doctor.issues.some((i) => i.code === "MODULE_MEILI_TABLE_UNKNOWN"),
    formatDoctorReport(doctor),
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("BS18 doctor : meiliIndexes.table OK autre module (cross-module)", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-meili-xmod-"));
  const { specDir, modulesDir } = scaffoldDoctorApp(work, "meilixmod", "Meili Xmod");
  writeMeiliModule(modulesDir, "articles.ts", {
    id: "articles",
    table: "catalog_items",
  });
  fs.writeFileSync(
    path.join(modulesDir, "catalog.ts"),
    `import { genericOsTourScenario } from "@creezio/interactive-demo";
export const catalogModule = {
  id: "catalog",
  demo: { scenarios: [genericOsTourScenario({ productName: "catalog" })] },
  horsIndexJustification: "écritures — hors browse",
  migrations: () => [
    {
      id: "mod_catalog_001_init",
      sql: "CREATE TABLE IF NOT EXISTS catalog_items (id TEXT PRIMARY KEY, nom TEXT);",
    },
  ],
};
`,
    "utf8",
  );
  const doctor = doctorBrandSpec(specDir);
  assert.equal(doctor.ok, true, formatDoctorReport(doctor));
  assert.ok(
    !doctor.issues.some((i) => i.code === "MODULE_MEILI_TABLE_UNKNOWN"),
    formatDoctorReport(doctor),
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("BS19 doctor : meiliIndexes.table OK historique fromprd_brand_*", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-meili-prd-"));
  const { specDir, modulesDir } = scaffoldDoctorApp(work, "meiliprd", "Meili Prd");
  writeMeiliModule(modulesDir, "articles.ts", {
    id: "articles",
    table: "legacy_items",
  });
  fs.writeFileSync(
    path.join(work, "server/src/electron/brand-migrations.ts"),
    `import { composeMigrations, type SqliteMigration } from "@creezio/platform-core";
export const BRAND_SCHEMA_SQL = \`
CREATE TABLE IF NOT EXISTS [legacy_items] (
  id TEXT PRIMARY KEY,
  nom TEXT
);
\`;
export function brandMigrations(): SqliteMigration[] {
  return composeMigrations({
    id: "fromprd_brand_001_schema",
    sql: BRAND_SCHEMA_SQL,
  });
}
`,
    "utf8",
  );
  const doctor = doctorBrandSpec(specDir);
  assert.equal(doctor.ok, true, formatDoctorReport(doctor));
  assert.ok(
    !doctor.issues.some((i) => i.code === "MODULE_MEILI_TABLE_UNKNOWN"),
    formatDoctorReport(doctor),
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("BS20 doctor : meiliIndexes.table inconnue = MODULE_MEILI_TABLE_UNKNOWN", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-meili-unk-"));
  const { specDir, modulesDir } = scaffoldDoctorApp(work, "meiliunk", "Meili Unk");
  writeMeiliModule(modulesDir, "articles.ts", {
    id: "articles",
    table: "ghost_items",
  });
  const doctor = doctorBrandSpec(specDir);
  assert.equal(doctor.ok, false, formatDoctorReport(doctor));
  const unknown = doctor.issues.find(
    (i) => i.code === "MODULE_MEILI_TABLE_UNKNOWN" && i.level === "error",
  );
  assert.ok(unknown, formatDoctorReport(doctor));
  assert.match(unknown.message, /ghost_items/);
  assert.match(unknown.message, /articles/);
  assert.match(unknown.message, /cross-module|fromprd_brand_/);
  assert.match(unknown.message, /tableProvisionedBy/);

  writeMeiliModule(modulesDir, "articles.ts", {
    id: "articles",
    table: "ghost_items",
    tableProvisionedBy: "sync distant au boot (table créée à l'exécution)",
  });
  const justified = doctorBrandSpec(specDir);
  assert.equal(justified.ok, true, formatDoctorReport(justified));
  assert.ok(
    !justified.issues.some((i) => i.code === "MODULE_MEILI_TABLE_UNKNOWN"),
    formatDoctorReport(justified),
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("BS21 doctor : API sans assistantSources = MODULE_ASSISTANT_SOURCES_MISSING (warn)", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-asst-"));
  const { specDir, modulesDir } = scaffoldDoctorApp(work, "asstdoc", "Asst Doc");
  const moduleSrc = (extra) => `import { genericOsTourScenario } from "@creezio/interactive-demo";
export const flowModule = {
  id: "flow",
  demo: { scenarios: [genericOsTourScenario({ productName: "Asst Doc" })] },
  horsIndexJustification: "écritures — hors browse",
  apiMounts: {
    flow: {
      dbLayer: "brand",
      permission: "nav.flow",
      operations: [
        { id: "list", method: "GET", path: "/", description: "Lister" },
      ],
      handle: async () => ({ status: 200, body: {} }),
    },
  },
  ${extra}
};
`;
  const modPath = path.join(modulesDir, "flow.ts");

  fs.writeFileSync(modPath, moduleSrc(""), "utf8");
  const missing = doctorBrandSpec(specDir);
  assert.equal(missing.ok, true, formatDoctorReport(missing));
  assert.ok(
    missing.issues.some(
      (i) => i.code === "MODULE_ASSISTANT_SOURCES_MISSING" && i.level === "warn",
    ),
    formatDoctorReport(missing),
  );

  fs.writeFileSync(
    modPath,
    moduleSrc(`assistantSourcesJustification: "webhook machine — pas de contexte LLM",`),
    "utf8",
  );
  const justified = doctorBrandSpec(specDir);
  assert.equal(justified.ok, true, formatDoctorReport(justified));
  assert.ok(
    !justified.issues.some((i) => i.code === "MODULE_ASSISTANT_SOURCES_MISSING"),
    formatDoctorReport(justified),
  );

  fs.writeFileSync(
    modPath,
    moduleSrc(`assistantSources: [
    { kind: "context", id: "flow-overview", title: "Flux", body: "Module flux." },
  ],`),
    "utf8",
  );
  const sourced = doctorBrandSpec(specDir);
  assert.equal(sourced.ok, true, formatDoctorReport(sourced));
  assert.ok(
    !sourced.issues.some((i) => i.code === "MODULE_ASSISTANT_SOURCES_MISSING"),
    formatDoctorReport(sourced),
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("BS12 doctor : product.md manquant = PRODUCT_MD_MISSING", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-noprod-"));
  const result = initBrandSpec({
    outDir: out,
    brandId: "noprod",
    brandName: "No Prod",
    domain: "noprod.local",
    vertical: "generic",
    force: true,
  });
  fs.unlinkSync(path.join(result.outDir, "product.md"));
  const doctor = doctorBrandSpec(result.outDir);
  assert.equal(doctor.ok, false, formatDoctorReport(doctor));
  assert.ok(
    doctor.issues.some((i) => i.code === "PRODUCT_MD_MISSING" && i.level === "error"),
    formatDoctorReport(doctor),
  );
  fs.rmSync(out, { recursive: true, force: true });
});
