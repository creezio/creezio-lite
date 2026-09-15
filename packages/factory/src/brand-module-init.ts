/**
 * `creezio brand module init <id>` — scaffolde une unité de travail module
 * conforme au standard kit (docs/DOC-STANDARD-MODULE.md) :
 *   1. dossier spec 5 fichiers (prd/interview/TODO/CHANGELOG/gate.mjs) sous
 *      `brand-spec/modules/<id>/` (ou `admin-spec/modules/<id>/` pour un
 *      repo admin) — la gate est COLOCALISÉE avec la spec ;
 *   2. stub de wiring `server/src/electron/modules/<id>.ts` (BrandModuleDef) ;
 *   3. ligne d'import + entrée dans le registre `modules/index.ts`
 *      (créé avec `types.ts` s'il n'existe pas encore) ;
 *   4. runner `server/scripts/run-module-gates.mjs` + scripts `test:modules`
 *      / `test:module` dans `server/package.json` → `npm test`.
 */
import fs from "node:fs";
import path from "node:path";
import { renderModuleSpecFiles } from "@creezio/brand-spec";
import {
  MODULES_INDEX_TS,
  MODULES_TYPES_TS,
  camelizeModuleId,
  ensureModulesRegistry,
  registerModuleInIndex,
  renderAssistantAndOnboardingBlocks,
  renderModuleGateStub,
  renderPlayableDemoBlock,
  wireModuleGateInPackageJson,
} from "./generators/modules-registry.js";

export type ModuleInitResult = {
  specDir: string;
  written: string[];
  skipped: string[];
};

function titleize(id: string): string {
  const words = id.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return words
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

function readBrandProductName(appDir: string): string {
  for (const rel of ["brand-spec/brand.yaml", "admin-spec/brand.yaml"]) {
    const p = path.join(appDir, rel);
    if (!fs.existsSync(p)) continue;
    const m = fs
      .readFileSync(p, "utf8")
      .match(/^\s*brandName:\s*["']?(.+?)["']?\s*$/m);
    if (m?.[1]) return m[1].replace(/["']/g, "").trim();
  }
  return "l'application";
}

function renderModuleStub(id: string, productName: string): string {
  const camel = camelizeModuleId(id);
  const title = titleize(id);
  return `/**
 * creezio:owned-by-brand
 * Module ${id} — (décrire la mission en une ligne).
 * Spec : modules/${id}/ (prd + interview + TODO + CHANGELOG).
 */
import { genericOsTourScenario } from "@creezio/interactive-demo";
import type { BrandModuleDef } from "./types.js";

export const ${camel}Module: BrandModuleDef = {
  id: "${id}",
  // entitySpecs: { ${camel}: { table: "${camel}", columns: [/* … */] } },
  // apiMounts: { "${id}": { dbLayer: "brand", permission: "nav.${id}", operations: [/* 1 op = 1 capacité */], handle } },
  // Mount sans permission : accessJustification explicite obligatoire (doctor MODULE_PERMISSION_MISSING).
  navItems: [
    {
      id: "brand.${id}",
      label: "${title}",
      href: "/${id}",
      group: "brand",
      order: 500,
      permission: "nav.${id}",
    },
  ],
  // Tools MCP générés depuis operations[] / EntitySpec — plus de mcpTools().
  // Liste catalogue : déclarer meiliIndexes (UID catalog_*) OU horsIndexJustification.
  // meiliIndexes: [{ uid: "catalog_products", countKey: "produits", table: "${camel}", columns: ["id", "nom"], settings: { searchableAttributes: ["nom"], filterableAttributes: ["id"] } }],
  horsIndexJustification:
    "stub — pas de browse catalogue Meili tant que le métier n'expose pas de liste indexée",
${renderPlayableDemoBlock({ moduleId: id, title, productName, navLabel: title })}
${renderAssistantAndOnboardingBlocks({ moduleId: id, title, navHref: `/${id}` })}
  // migrations: () => [{ id: "mod_${camel}_001_init", sql: \`…\` }],
};
`;
}

/** Livrable serveur d'une marque : `<app>/server` (monorepo) ou `<app>`. */
function resolveServerDir(appDir: string): string {
  const server = path.join(appDir, "server");
  return fs.existsSync(path.join(server, "package.json")) ? server : appDir;
}

export function runBrandModuleInit(
  appDir: string,
  moduleId: string,
  force = false,
): ModuleInitResult {
  if (!/^[a-z][a-z0-9-]*$/.test(moduleId)) {
    throw new Error(`id de module invalide: ${moduleId} ([a-z][a-z0-9-]*)`);
  }
  const written: string[] = [];
  const skipped: string[] = [];
  const write = (filePath: string, body: string) => {
    if (fs.existsSync(filePath) && !force) {
      skipped.push(filePath);
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body, "utf8");
    written.push(filePath);
  };

  // 1. Spec 5 fichiers (admin-spec/ si repo admin, sinon brand-spec/) —
  //    gate.mjs colocalisée incluse.
  const specRootName = fs.existsSync(path.join(appDir, "admin-spec"))
    ? "admin-spec"
    : "brand-spec";
  const specDir = path.join(appDir, specRootName, "modules", moduleId);
  const specFiles = renderModuleSpecFiles(moduleId);
  for (const [name, body] of Object.entries(specFiles)) {
    write(path.join(specDir, name), body);
  }

  // 2. Wiring modules/<id>.ts + registre (créés au besoin).
  const serverDir = resolveServerDir(appDir);
  const modulesDir = path.join(serverDir, "src/electron/modules");
  ensureModulesRegistry(modulesDir, force, (p, body) => {
    // ensureModulesRegistry utilise MODULES_* ; forcer types/index seulement
    // s'ils manquent (sauf --force).
    if (p.endsWith("types.ts")) write(p, body || MODULES_TYPES_TS);
    else if (p.endsWith("index.ts")) write(p, body || MODULES_INDEX_TS);
    else write(p, body);
  });
  write(
    path.join(modulesDir, `${moduleId}.ts`),
    renderModuleStub(moduleId, readBrandProductName(appDir)),
  );

  const registryPath = path.join(modulesDir, "index.ts");
  if (fs.existsSync(registryPath)) {
    registerModuleInIndex(registryPath, moduleId);
  }

  // 3. Gate colocalisée + runner + branchement npm test.
  write(
    path.join(specDir, "gate.mjs"),
    renderModuleGateStub(moduleId, specRootName),
  );
  wireModuleGateInPackageJson(serverDir, moduleId);

  return { specDir, written, skipped };
}
