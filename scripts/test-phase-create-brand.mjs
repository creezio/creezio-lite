#!/usr/bin/env node
/**
 * Sonde E2E CREATE-BRAND — init → doctor → apply → smoke façade.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages/factory/bin/creezio.js");
const SMOKE_ENV = {
  ...process.env,
  CREEZIO_KIT_ROOT: ROOT,
  CREEZIO_ROOT: ROOT, // legacy compat (Q8)
  // Gates structurelles : pas de vendor/lock Docker (layout node_modules tmp).
  CREEZIO_SKIP_BRAND_DIST: "1",
  NODE_PATH: path.join(ROOT, "node_modules"),
  PATH: [
    path.join(ROOT, "node_modules", ".bin"),
    process.env.PATH || "",
  ].join(path.delimiter),
};

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: SMOKE_ENV,
    ...opts,
  });
}

function writeFilledModuleSpec(specDir, moduleId, title) {
  const dir = path.join(specDir, "modules", moduleId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "prd.md"),
    `# Module ${moduleId} — ${title}

## Vision

Module ${title} pour le livrable de test kit.

## Utilisateurs & parcours

Opérateurs.

## Capacités (fonctionnel)

- Lister / créer des ${title.toLowerCase()}

## Modèle de données

Table ${moduleId} (id, created_at, updated_at, nom).

## API

CRUD EntitySpec.

## UI

Page /${moduleId}

## Tools MCP

Aucun extra.

## Logique métier non triviale

Aucune

## Seeds & données initiales

Aucun

## Cas limites & règles de gestion

Aucune

## Hors périmètre

Rien
`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "interview.md"),
    `# Interview module ${moduleId}

## 1. Identité & pages

- id : \`${moduleId}\`
- titre : ${title}
- routes UI : /${moduleId}

## 2. Données & migrations

Table ${moduleId}.

## 3. API

EntitySpec CRUD.

## 4. UI

Page /${moduleId}

## 5. Tools MCP & policies

Aucun

## 6. Rôles

## 7. Meili

Aucun

## 8. Seeds

Aucun

## 9. Gates

gate.mjs structurelle

## 10. i18n

fr
`,
    "utf8",
  );
}

test("CB0 demo-app déprécié — exit 1, pointer brand create", () => {
  const r = runCli(["demo-app", "--name", "Nope"]);
  assert.notEqual(r.status, 0, "demo-app doit échouer");
  const out = `${r.stdout}\n${r.stderr}`;
  assert.match(out, /déprécié|brand create/i);
});

test("CB0b help déprécie demo-app et documente brand create", () => {
  const root = runCli(["--help"]);
  assert.equal(root.status, 0, root.stderr);
  assert.match(root.stdout, /brand create/);
  assert.match(root.stdout, /DÉPRÉCIÉ|déprécié|brand create/);
  const brand = runCli(["brand", "--help"]);
  assert.equal(brand.status, 0, brand.stderr);
  assert.match(brand.stdout, /brand create/);
  assert.match(brand.stdout, /--push/);
});

test("CB1 help brand documente init/doctor/apply/smoke", () => {
  const r = runCli(["brand", "--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /brand init/);
  assert.match(r.stdout, /brand doctor/);
  assert.match(r.stdout, /brand apply/);
  assert.match(r.stdout, /brand create/);
  assert.match(r.stdout, /startBrandDesktop/);
});

test("CB-create brand create --id acme (pas notes, pas crm, admin frère)", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-create-"));
  const appDir = path.join(work, "acme");
  const created = runCli([
    "brand",
    "create",
    "--id",
    "acme",
    "--name",
    "Acme",
    "--domain",
    "acme.local",
    "--out",
    appDir,
    "--force",
  ]);
  assert.equal(created.status, 0, created.stderr + "\n" + created.stdout);
  assert.match(
    created.stdout,
    /repos GitHub non créés \(--push pour les créer\)/,
  );
  const serverDir = path.join(appDir, "server");
  assert.ok(fs.existsSync(path.join(serverDir, "src/electron/modules/index.ts")));
  assert.ok(!fs.existsSync(path.join(serverDir, "src/electron/modules/notes.ts")));
  assert.ok(!fs.existsSync(path.join(serverDir, "crm")));
  assert.ok(fs.existsSync(path.join(`${appDir}-admin`, "server-admin.json")));
  const brandApi = fs.readFileSync(
    path.join(serverDir, "src/electron/brand-module-api.ts"),
    "utf8",
  );
  assert.match(brandApi, /createInteractiveDemoMount/);
  assert.match(brandApi, /collectDemoScenarios/);
  assert.match(brandApi, /collectAssistantSources/);
  assert.match(brandApi, /collectOnboardingContent/);
  assert.match(brandApi, /mergeAssistantBrandConfig/);
  const createBindings = fs.readFileSync(
    path.join(serverDir, "src/electron/brand-platform-bindings.ts"),
    "utf8",
  );
  assert.match(createBindings, /applyBrandModuleAuth/);
  assert.match(createBindings, /collectNavPermissions\(\)/);
  assert.match(createBindings, /collectPermissionGroups\(\)/);
  assert.match(
    fs.readFileSync(path.join(serverDir, "src/electron/main.ts"), "utf8"),
    /applyBrandPlatformBindings/,
  );
  assert.match(
    fs.readFileSync(
      path.join(serverDir, "src/electron/modules/index.ts"),
      "utf8",
    ),
    /collectNavPermissions/,
  );
  assert.match(
    fs.readFileSync(
      path.join(serverDir, "src/electron/modules/index.ts"),
      "utf8",
    ),
    /collectOnboardingContent/,
  );
  assert.match(brandApi, /createOnboardingContentMount/);
  const createChrome = fs.readFileSync(
    path.join(serverDir, "ui/components/brand-chrome.tsx"),
    "utf8",
  );
  assert.match(createChrome, /from "@creezio\/auth\/ui"/);
  assert.match(
    createChrome,
    /<RequireSession>[\s\S]*<WorkspaceRoot>\{children\}<\/WorkspaceRoot>[\s\S]*<\/RequireSession>/,
    "brand create : RequireSession kit dès le jour 1 (pas attendre apply)",
  );
  const createAdminChrome = fs.readFileSync(
    path.join(`${appDir}-admin`, "server/ui/components/brand-chrome.tsx"),
    "utf8",
  );
  assert.match(
    createAdminChrome,
    /<RequireSession>[\s\S]*<WorkspaceRoot>\{children\}<\/WorkspaceRoot>[\s\S]*<\/RequireSession>/,
    "brand create admin : RequireSession autour de WorkspaceRoot",
  );
  if (fs.existsSync(path.join(serverDir, "ui/app/page.tsx"))) {
    assert.doesNotMatch(
      fs.readFileSync(path.join(serverDir, "ui/app/page.tsx"), "utf8"),
      /redirect\(["']\/notes["']\)/,
    );
  }
  const modInit = runCli([
    "brand",
    "module",
    "init",
    "articles",
    "--app",
    appDir,
    "--force",
  ]);
  assert.equal(modInit.status, 0, modInit.stderr + "\n" + modInit.stdout);
  assert.ok(
    fs.existsSync(path.join(serverDir, "src/electron/modules/articles.ts")),
  );
  const articlesMod = fs.readFileSync(
    path.join(serverDir, "src/electron/modules/articles.ts"),
    "utf8",
  );
  assert.match(articlesMod, /permission:\s*"nav\.articles"/);
  assert.match(articlesMod, /horsIndexJustification/);
  assert.doesNotMatch(articlesMod, /à qualifier/);
  const runner = path.join(serverDir, "scripts/run-module-gates.mjs");
  if (fs.existsSync(runner)) {
    const gates = spawnSync(process.execPath, [runner], {
      encoding: "utf8",
      cwd: serverDir,
      env: SMOKE_ENV,
    });
    assert.equal(gates.status, 0, gates.stderr + "\n" + gates.stdout);
  }
});

test("CB-apply-stub product.md stub = error (plus notes)", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-apply-stub-"));
  const specDir = path.join(work, "brand-spec");
  const init = runCli([
    "brand",
    "init",
    "--id",
    "stubbrand",
    "--name",
    "StubBrand",
    "--domain",
    "stubbrand.local",
    "--out",
    specDir,
    "--force",
  ]);
  assert.equal(init.status, 0, init.stderr + "\n" + init.stdout);
  const apply = runCli([
    "brand",
    "apply",
    "--spec",
    specDir,
    "--out",
    path.join(work, "app"),
    "--force",
    "--no-push",
  ]);
  assert.notEqual(apply.status, 0, "apply sur stub doit error");
  const out = `${apply.stdout}\n${apply.stderr}`;
  assert.match(out, /PRODUCT_MD_STUB|à remplir|doctor|error/i);
});

test("CB2 init → doctor → apply → main façade", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "create-brand-"));
  const specDir = path.join(work, "brand-spec");
  const appDir = path.join(work, "app");

  const init = runCli([
    "brand",
    "init",
    "--id",
    "probebrand",
    "--name",
    "ProbeBrand",
    "--domain",
    "probebrand.local",
    "--vertical",
    "generic",
    "--out",
    specDir,
    "--force",
  ]);
  assert.equal(init.status, 0, init.stderr + "\n" + init.stdout);
  assert.ok(fs.existsSync(path.join(specDir, "brand.yaml")));

  // product.md minimal avec indices parseProductPrd
  fs.writeFileSync(
    path.join(specDir, "product.md"),
    `# ProbeBrand

Gestion simple d'articles.

## Utilisateurs

- Opérateurs

## Parcours

1. Créer un article
2. Consulter la liste

## Entités

### Articles
- nom (texte)
- prix (nombre)

## Plateforme

Desktop Creezio.
`,
    "utf8",
  );

  writeFilledModuleSpec(specDir, "articles", "Articles");

  const doctor = runCli(["brand", "doctor", "--spec", specDir]);
  assert.equal(doctor.status, 0, doctor.stderr + "\n" + doctor.stdout);

  const apply = runCli([
    "brand",
    "apply",
    "--spec",
    specDir,
    "--out",
    appDir,
    "--force",
    "--no-push",
  ]);
  assert.equal(apply.status, 0, apply.stderr + "\n" + apply.stdout);
  assert.match(
    apply.stdout,
    /repos GitHub non créés \(--push pour les créer\)/,
  );
  // Layout monorepo : métier sous server/, client thin sous client/ ;
  // admin flotte = repo dédié frère `<app>-admin` (factory 2-repos).
  const serverDir = path.join(appDir, "server");
  assert.ok(fs.existsSync(path.join(serverDir, "src/electron/main.ts")));
  assert.ok(fs.existsSync(path.join(appDir, "client/src/electron/main.ts")));
  assert.ok(fs.existsSync(path.join(`${appDir}-admin`, "server-admin.json")));
  assert.ok(!fs.existsSync(path.join(appDir, "admin")));
  assert.ok(!fs.existsSync(path.join(serverDir, "crm")));
  assert.ok(
    !fs.existsSync(path.join(serverDir, "src/electron/modules/notes.ts")),
    "apply Articles ne doit pas poser notes.ts",
  );
  assert.ok(
    fs.existsSync(path.join(serverDir, "src/electron/modules/articles.ts")),
    "fixture Articles → modules/articles.ts",
  );
  assert.match(
    fs.readFileSync(
      path.join(serverDir, "src/electron/modules/articles.ts"),
      "utf8",
    ),
    /permission:\s*"nav\.articles"/,
    "from-prd / apply : permission nav.<id> forcée",
  );
  if (fs.existsSync(path.join(serverDir, "ui/app/page.tsx"))) {
    assert.doesNotMatch(
      fs.readFileSync(path.join(serverDir, "ui/app/page.tsx"), "utf8"),
      /redirect\(["']\/notes["']\)/,
    );
  }
  assert.ok(fs.existsSync(path.join(appDir, "brand-spec/brand.yaml")));
  assert.ok(
    fs.existsSync(
      path.join(serverDir, "plugins/insights-assistant/manifest.json"),
    ),
    "brand apply doit installer server/plugins/insights-assistant",
  );

  const main = fs.readFileSync(
    path.join(serverDir, "src/electron/main.ts"),
    "utf8",
  );
  assert.match(main, /startBrandDesktop/);
  assert.doesNotMatch(main, /listenBrandKernelHttp/);

  const clientMain = fs.readFileSync(
    path.join(appDir, "client/src/electron/main.ts"),
    "utf8",
  );
  assert.match(clientMain, /startBrandDesktop/);
  assert.doesNotMatch(
    clientMain,
    /from "\.\/(brand-migrations|brand-module-api|vertical-slot)/,
  );

  // Socle registre modules (même standard que TempoFlow3).
  assert.ok(
    fs.existsSync(path.join(serverDir, "src/electron/modules/index.ts")),
  );
  assert.match(
    fs.readFileSync(
      path.join(serverDir, "src/electron/brand-module-api.ts"),
      "utf8",
    ),
    /collectEntitySpecs/,
  );
  assert.match(
    fs.readFileSync(
      path.join(serverDir, "src/electron/brand-migrations.ts"),
      "utf8",
    ),
    /collectModuleMigrations/,
  );

  // Registre : collecteurs délégués au kit (P2.c / H9 — plus de copie du
  // contrat) + types.ts = ré-export @creezio/app-runtime.
  const modulesIndex = fs.readFileSync(
    path.join(serverDir, "src/electron/modules/index.ts"),
    "utf8",
  );
  assert.match(modulesIndex, /collectDemoScenarios/);
  assert.match(modulesIndex, /collectAssistantSources/);
  assert.match(modulesIndex, /collectOnboardingContent/);
  assert.match(modulesIndex, /collectNavPermissions/);
  assert.match(modulesIndex, /collectPermissionGroups/);
  assert.match(modulesIndex, /createBrandModuleRegistry/);
  const fromPrdBindings = fs.readFileSync(
    path.join(serverDir, "src/electron/brand-platform-bindings.ts"),
    "utf8",
  );
  assert.match(fromPrdBindings, /applyBrandModuleAuth/);
  assert.match(fromPrdBindings, /collectNavPermissions\(\)/);
  const fromPrdMain = fs.readFileSync(
    path.join(serverDir, "src/electron/main.ts"),
    "utf8",
  );
  assert.match(fromPrdMain, /applyBrandPlatformBindings/);
  const modulesTypes = fs.readFileSync(
    path.join(serverDir, "src/electron/modules/types.ts"),
    "utf8",
  );
  assert.match(
    modulesTypes,
    /export type \{[\s\S]*BrandModuleDef[\s\S]*\} from "@creezio\/app-runtime"/,
    "modules/types.ts doit être le ré-export du contrat kit (P2.c)",
  );
  assert.doesNotMatch(
    modulesTypes,
    /type BrandModuleDef =/,
    "modules/types.ts ne doit plus redéclarer BrandModuleDef localement",
  );
  const npmrc = fs.readFileSync(path.join(appDir, ".npmrc"), "utf8");
  assert.match(
    npmrc,
    /@creezio:registry=https:\/\/registry\.npmjs\.org/,
    "brand apply : .npmrc doit pointer npmjs.org",
  );
  assert.doesNotMatch(
    npmrc,
    /npm\.pkg\.github\.com/,
    "brand apply : .npmrc encore GitHub Packages",
  );
  assert.doesNotMatch(
    npmrc,
    /CREEZIO_NPM_TOKEN/,
    "brand apply : .npmrc ne doit plus exiger CREEZIO_NPM_TOKEN",
  );
  const scaffoldedServerPkg = JSON.parse(
    fs.readFileSync(path.join(serverDir, "package.json"), "utf8"),
  );
  assert.ok(
    scaffoldedServerPkg.dependencies?.["@creezio/interactive-demo"],
    "dep @creezio/interactive-demo absente du serveur scaffoldé",
  );

  // 4 branchements natifs (issue #88) — plus optionnels.
  const brandApi = fs.readFileSync(
    path.join(serverDir, "src/electron/brand-module-api.ts"),
    "utf8",
  );
  assert.match(brandApi, /createInteractiveDemoMount/, "mount interactive-demo");
  assert.match(brandApi, /genericOsTourScenario/, "OS tour dans les défauts du mount");
  assert.match(brandApi, /collectAssistantSources/, "sources assistant depuis le registre");
  assert.match(brandApi, /createOnboardingContentMount/, "mount onboarding depuis le registre");
  const brandMig = fs.readFileSync(
    path.join(serverDir, "src/electron/brand-migrations.ts"),
    "utf8",
  );
  assert.match(brandMig, /interactiveDemoMigrations/, "migrations interactive-demo");
  assert.match(brandMig, /onboardingContentMigrations/, "migrations onboarding hybride");
  const layout = fs.readFileSync(
    path.join(serverDir, "ui/app/layout.tsx"),
    "utf8",
  );
  assert.match(
    layout,
    /@creezio\/interactive-demo\/ui\/interactive-demo\.css/,
    "layout importe le CSS démo",
  );
  const uiPkg = JSON.parse(
    fs.readFileSync(path.join(serverDir, "ui/package.json"), "utf8"),
  );
  assert.ok(
    uiPkg.dependencies?.["@creezio/interactive-demo"],
    "dep UI @creezio/interactive-demo absente",
  );
  const chrome = fs.readFileSync(
    path.join(serverDir, "ui/components/brand-chrome.tsx"),
    "utf8",
  );
  assert.match(chrome, /InteractiveDemoRoot/, "BrandChrome monte le lecteur dans SessionProvider");
  assert.match(chrome, /SessionProvider/);
  assert.match(chrome, /from "@creezio\/auth\/ui"/);
  assert.match(
    chrome,
    /<RequireSession>[\s\S]*<WorkspaceRoot>\{children\}<\/WorkspaceRoot>[\s\S]*<\/RequireSession>/,
    "RequireSession kit enveloppe WorkspaceRoot (marque)",
  );
  const adminChrome = fs.readFileSync(
    path.join(`${appDir}-admin`, "server/ui/components/brand-chrome.tsx"),
    "utf8",
  );
  assert.match(adminChrome, /from "@creezio\/auth\/ui"/);
  assert.match(
    adminChrome,
    /<RequireSession>[\s\S]*<WorkspaceRoot>\{children\}<\/WorkspaceRoot>[\s\S]*<\/RequireSession>/,
    "RequireSession kit enveloppe WorkspaceRoot (admin flotte — sinon /flotte creuse)",
  );
  const boot = fs.readFileSync(
    path.join(ROOT, "packages/os-ui/src/boot.tsx"),
    "utf8",
  );
  assert.doesNotMatch(
    boot,
    /<InteractiveDemoRoot/,
    "boot ne remonte plus un second lecteur",
  );
  const entityMod = fs
    .readdirSync(path.join(serverDir, "src/electron/modules"))
    .find((f) => f.endsWith(".ts") && f !== "types.ts" && f !== "index.ts");
  assert.ok(entityMod, "au moins un module entité généré");
  assert.match(
    fs.readFileSync(
      path.join(serverDir, "src/electron/modules", entityMod),
      "utf8",
    ),
    /genericOsTourScenario/,
    "module factory : stub demo.scenarios jouable",
  );
  assert.match(
    fs.readFileSync(path.join(appDir, "AGENTS.md"), "utf8"),
    /BrandModuleDef/,
  );

  // brand module init branche sans refactor des consommateurs.
  const modInit = runCli([
    "brand",
    "module",
    "init",
    "clients",
    "--app",
    appDir,
    "--force",
  ]);
  assert.equal(modInit.status, 0, modInit.stderr + "\n" + modInit.stdout);
  assert.ok(
    fs.existsSync(path.join(serverDir, "src/electron/modules/clients.ts")),
  );
  assert.match(
    fs.readFileSync(
      path.join(serverDir, "src/electron/modules/index.ts"),
      "utf8",
    ),
    /clientsModule/,
  );
  const clientsMod = fs.readFileSync(
    path.join(serverDir, "src/electron/modules/clients.ts"),
    "utf8",
  );
  assert.match(clientsMod, /genericOsTourScenario/, "module init : OS tour");
  assert.match(clientsMod, /demo:\s*\{/, "module init : demo.scenarios (plus un commentaire)");
  assert.match(clientsMod, /assistantSources:/, "module init : assistantSources");
  assert.match(clientsMod, /onboarding:/, "module init : onboarding");
  assert.match(clientsMod, /permission:\s*"nav\.clients"/, "module init : permission nav");
  assert.match(clientsMod, /horsIndexJustification/, "module init : horsIndexJustification stub");
  assert.doesNotMatch(clientsMod, /à qualifier/, "module init : pas de à qualifier silencieux");
  assert.doesNotMatch(
    clientsMod,
    /\/\/ demo: \{ scenarios:/,
    "module init ne doit plus laisser demo en commentaire",
  );
  writeFilledModuleSpec(path.join(appDir, "brand-spec"), "articles", "Articles");
  writeFilledModuleSpec(path.join(appDir, "brand-spec"), "clients", "Clients");
  const appDoctor = runCli([
    "brand",
    "doctor",
    "--spec",
    path.join(appDir, "brand-spec"),
  ]);
  assert.equal(
    appDoctor.status,
    0,
    appDoctor.stderr + "\n" + appDoctor.stdout,
  );
  // Gate colocalisée (DOC-STANDARD-MODULE : 5ᵉ fichier) + runner découvert.
  const gatePath = path.join(appDir, "brand-spec/modules/clients/gate.mjs");
  assert.ok(fs.existsSync(gatePath), "gate.mjs colocalisée non scaffoldée");
  assert.ok(
    fs.existsSync(path.join(serverDir, "scripts/run-module-gates.mjs")),
    "runner run-module-gates.mjs non scaffoldé",
  );
  const serverPkg = JSON.parse(
    fs.readFileSync(path.join(serverDir, "package.json"), "utf8"),
  );
  assert.ok(
    serverPkg.scripts?.["test:modules"],
    "script test:modules absent du package.json scaffoldé",
  );
  const gate = spawnSync(process.execPath, [gatePath], {
    encoding: "utf8",
    cwd: serverDir,
    env: SMOKE_ENV,
  });
  assert.equal(gate.status, 0, gate.stderr + "\n" + gate.stdout);

  const firstRun = spawnSync(
    process.execPath,
    [path.join(serverDir, "scripts/test-first-run-auth.mjs")],
    { encoding: "utf8", cwd: serverDir, env: SMOKE_ENV },
  );
  assert.equal(firstRun.status, 0, firstRun.stderr + "\n" + firstRun.stdout);
});
