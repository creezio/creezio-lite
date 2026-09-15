/**
 * Orchestration scaffold --from-prd.
 * Chemin natif OS : SQLite + api-kernel (pas de sidecar JSON métier).
 */
import fs from "node:fs";
import {
  SERVER_CREEZIO_DEPS,
  creezioNpmDeps,
  renderCreezioNpmrc,
} from "./kit-release.js";
import path from "node:path";
import type { AppManifest } from "@creezio/brand-config";
import { renderModuleSpecFiles } from "@creezio/brand-spec";
import {
  ensureDashboardPage,
  isChrModel,
  type ProductModel,
} from "./product-model.js";
import {
  renderNextHomePage,
  renderNextEntityPage,
  renderUiEntityTable,
  renderUiPrimitiveReexport,
  UI_PRIMITIVE_NAMES,
  renderMetierRendererHtml,
  renderUiBrandChrome,
  renderUiAuthMiddleware,
  renderUiGlobalsCss,
  renderUiPackageJson,
  renderUiPostcssConfig,
  renderUiTailwindConfig,
  renderUiNextConfig,
  renderUiTsconfig,
  renderNextLayoutWithOsNav,
  renderMaterializeOsUiScript,
  renderVerticalSlotFromModel,
  renderPreloadFromPrdTs,
  renderBrandMigrationsTs,
  renderBrandModuleApiTs,
  renderBrandKernelHarnessMjs,
  renderBrandPlatformBindingsTs,
  renderMainFromPrdNativeTs,
  renderMeiliFeedTs,
  renderMetierParcoursSmoke,
  renderFirstRunAuthSmoke,
  renderSetupLoginSmoke,
  renderAllowlistSmoke,
  renderMiniPrdCoreSmoke,
  renderMeiliConfigSmoke,
  renderMetierBaseTs,
  renderLoadLocalEnvMjs,
  renderEnvExample,
  renderEnsureLinuxIconsMjs,
  renderE2eBrowserParcoursMjs,
  renderCreezioCliProxyMjs,
  writeProductModelModules,
  renderBrandAgentsMd,
  renderModuleGateStub,
  wireModuleGateInPackageJson,
  entityToModuleId,
} from "./generators/index.js";

import { writeAppFile, writeOsUiAppFile } from "./write-app-file.js";

function writeFile(
  filePath: string,
  content: string | Buffer,
  force: boolean,
  written: string[],
): void {
  writeAppFile(filePath, content, force, written);
}

function renderPackageJsonFromPrd(m: AppManifest, model: ProductModel): string {
  const chr = isChrModel(model);
  const scripts: Record<string, string> = {
    build: "npm run build:runtime && npm run build:ui",
    // build:runtime = TS main+preload (nom historique build:electron gardé en alias).
    "build:runtime":
      "tsc -p tsconfig.electron.json && tsc -p tsconfig.preload.json",
    "build:electron": "npm run build:runtime",
    "build:ui": "npm run build --prefix ui",
    "os-ui:materialize": "node scripts/materialize-os-ui.mjs",
    typecheck: "tsc -p tsconfig.electron.json --noEmit",
    "metier:api": "npm run build:electron && node scripts/brand-kernel-harness.mjs",
    "test:metier-parcours": "node scripts/test-metier-parcours.mjs",
    "test:first-run-auth": "node scripts/test-first-run-auth.mjs",
    "test:setup-login": "node scripts/test-setup-login.mjs",
    "test:desktop-smoke-profile": "node scripts/test-desktop-smoke-profile.mjs",
    "test:allowlist": "node scripts/test-allowlist.mjs",
    "test:meili-config": "node scripts/test-meili-config.mjs",
    "electron:config:server": "node scripts/build-builder-config.mjs server",
    "electron:stage-win-bins":
      "bash ../node_modules/@creezio/desktop-tooling/scripts/stage-win-bins.sh",
    "pack:win:server":
      "npm run electron:stage-win-bins && npm run electron:config:server && npm run build:electron && CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --config electron-builder.server.json --win nsis --x64 -c.win.signAndEditExecutable=false",
    "pack:linux:server":
      "node scripts/ensure-linux-icons.mjs && npm run electron:ensure-linux-native && npm run electron:config:server && npm run build:electron && electron-builder --config electron-builder.server.json --linux AppImage dir --x64",
    "e2e:browser": "node scripts/e2e-browser-parcours.mjs",
    "e2e:browser:keep": "node scripts/e2e-browser-parcours.mjs --keep",
    "test:e2e-browser": "node scripts/e2e-browser-parcours.mjs",
    "smoke:tunnel": "node scripts/smoke-tunnel.mjs",
    "smoke:tunnel-catalog": "node scripts/smoke-tunnel-catalog.mjs",
    "electron:ensure-linux-native":
      "node ../node_modules/@creezio/desktop-tooling/scripts/ensure-linux-native-modules.mjs",
    "desktop:dev": "npm run build:electron && electron .",
  };
  if (chr) {
    scripts["test:mini-prd-core"] = "node scripts/test-mini-prd-core.mjs";
    scripts.test =
      "npm run test:metier-parcours && npm run test:mini-prd-core && npm run test:first-run-auth && npm run test:setup-login && npm run test:allowlist && npm run test:meili-config && npm run test:desktop-smoke-profile";
  } else {
    scripts.test =
      "npm run test:metier-parcours && npm run test:first-run-auth && npm run test:setup-login && npm run test:allowlist && npm run test:meili-config && npm run test:desktop-smoke-profile";
  }

  return (
    JSON.stringify(
      {
        name: `@creezio/app-${m.brandId}`,
        private: true,
        version: "0.1.0",
        description: `${m.client.productName} — livrable SERVEUR métier sur OS Creezio (api-kernel + SQLite)`,
        type: "module",
        main: "./build/electron/main.js",
        scripts,
        dependencies: {
          // Deps npm publiées (npmjs.org, lockstep ^<version>) —
          // SoT unique : SERVER_CREEZIO_DEPS (kit-release.ts). Plus de file:vendor.
          ...creezioNpmDeps(SERVER_CREEZIO_DEPS),
          "electron-updater": "^6.3.9",
          // Deps npm runtime main (asar FileSets kit) — pas seulement transitifs
          "hono": "^4.12.30",
          "zod": "^4.0.0",
          "jose": "^6.0.0",
          "better-sqlite3": "^12.11.1",
        },
        devDependencies: {
          "@types/node": "^22.15.3",
          // Requis par build:electron (types preload) même en flux Docker-only.
          electron: "35.7.5",
          "electron-builder": "^25.1.8",
          typescript: "^5.8.3",
        },
        peerDependencies: {
          electron: ">=28",
        },
        peerDependenciesMeta: {
          electron: { optional: true },
        },
        creezio: {
          fromPrd: true,
          nativeKernel: true,
          brandId: m.brandId,
          kind: "server",
          vertical: model.vertical || (chr ? "chr" : "generic"),
          entities: model.entities.map((e) => e.id),
          flows: model.flows.map((f) => f.id),
        },
        license: "UNLICENSED",
      },
      null,
      2,
    ) + "\n"
  );
}

function renderReadmeFromPrd(m: AppManifest, model: ProductModel): string {
  const chr = isChrModel(model);
  return `# ${m.client.productName}

Marque métier sur **OS Creezio** (\`creezio new-app --from-prd\`).

## Architecture

| Couche | Technologie |
|--------|-------------|
| OS | \`@creezio/api-kernel\` + \`createSqliteRuntime\` + session desktop |
| Métier | schema brand + mounts \`/api/v1/modules/*\` |
| Desktop | \`@creezio/app-runtime\` \`startBrandDesktop\` (main mince) |
| Smoke | \`scripts/brand-kernel-harness.mjs\` → \`startBrandKernelHarness\` |

**Interdit** : sidecar \`metier-api.mjs\` / \`store.json\` comme source de vérité.
**Interdit** : jumeau d'orchestration OS dans \`main.ts\` (utiliser la façade).

## Identité

| Champ | Valeur |
|-------|--------|
| brandId | \`${m.brandId}\` |
| entities | ${model.entities.map((e) => e.id).join(", ")} |
| vertical | \`${model.vertical || (chr ? "chr" : "generic")}\` |

## Tests

\`\`\`bash
npm test
npm run metier:api   # harness kernel natif
\`\`\`
`;
}

function renderDesktopSmokeGeneric(model: ProductModel): string {
  return `#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const main = fs.readFileSync(path.join(root, "src/electron/main.ts"), "utf8");
assert.match(main, /startBrandDesktop/);
assert.match(main, /brandMigrations|registerModuleApi/);
assert.match(main, /@creezio\\/app-runtime/);
assert.doesNotMatch(main, /spawnBrandMetierApi|listenBrandKernelHttp|prepareDesktopBoot|bootBrandKernel|brand-runtime/);
assert.ok(!fs.existsSync(path.join(root, "src/lib/host-stack.ts")), "glue OS host-stack interdit");
assert.ok(!fs.existsSync(path.join(root, "src/electron/brand-runtime.ts")), "brand-runtime interdit");
assert.ok(!fs.existsSync(path.join(root, "src/electron/product-hub-stub.ts")), "product-hub-stub interdit");
const harness = fs.readFileSync(
  path.join(root, "scripts/brand-kernel-harness.mjs"),
  "utf8",
);
assert.match(harness, /startBrandKernelHarness/);
assert.match(harness, /brandMigrations|registerModuleApi/);
const renderer = fs.readFileSync(
  path.join(root, "resources/renderer/index.html"),
  "utf8",
);
assert.match(renderer, /modules\\/search|global-search/);
assert.match(renderer, /metierBaseUrl|creezioDesktop/);
console.log("OK test:desktop-smoke-profile (${model.brandId} native)");
`;
}

export function writeFromPrdArtifacts(opts: {
  /** Livrable serveur (`<racine>/server`) — reçoit métier, UI, scripts. */
  outDir: string;
  /** Racine monorepo — reçoit AGENTS.md et .env.example. */
  rootDir: string;
  manifest: AppManifest;
  model: ProductModel;
  force: boolean;
  written: string[];
}): void {
  const { outDir, rootDir, manifest, force, written } = opts;
  // CONVENTION OS : le workspace kit canonise "/" → /dashboard — toute app
  // générée doit exposer une page /dashboard (ensureDashboardPage).
  const model = ensureDashboardPage(opts.model);
  const chr = isChrModel(model);

  // Purge glue OS / stubs / sidecar — marque = métier + déclaration.
  if (force) {
    for (const rel of [
      "scripts/metier-api.mjs",
      "src/lib/brand-module-api.ts",
      "src/lib/paths.ts",
      "src/lib/connection-profile.ts",
      "src/lib/tunnel-service-urls.ts",
      "src/lib/creezio-boot.ts",
      "src/lib/host-stack.ts",
      "src/lib/desktop-presence.ts",
      "src/electron/brand-runtime.ts",
      "src/electron/product-hub-stub.ts",
      "src/electron/nav-core.ts",
      "scripts/test-oracle-mvp.mjs",
    ]) {
      const p = path.join(outDir, rel);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    const crmDir = path.join(outDir, "crm");
    if (fs.existsSync(crmDir)) {
      fs.rmSync(crmDir, { recursive: true, force: true });
    }
    // src/lib vide après purge
    const libDir = path.join(outDir, "src/lib");
    if (fs.existsSync(libDir) && fs.readdirSync(libDir).length === 0) {
      fs.rmdirSync(libDir);
    }
  }

  writeFile(
    path.join(outDir, "product-model.json"),
    JSON.stringify(model, null, 2) + "\n",
    force,
    written,
  );
  writeFile(
    path.join(outDir, "package.json"),
    renderPackageJsonFromPrd(manifest, model),
    force,
    written,
  );

  writeFile(
    path.join(outDir, "scripts/brand-kernel-harness.mjs"),
    renderBrandKernelHarnessMjs(manifest, model),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "scripts/creezio-cli.mjs"),
    renderCreezioCliProxyMjs(),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "scripts/test-metier-parcours.mjs"),
    renderMetierParcoursSmoke(model),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "scripts/test-first-run-auth.mjs"),
    renderFirstRunAuthSmoke(model),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "scripts/test-setup-login.mjs"),
    renderSetupLoginSmoke(model),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "scripts/test-desktop-smoke-profile.mjs"),
    renderDesktopSmokeGeneric(model),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "scripts/test-allowlist.mjs"),
    renderAllowlistSmoke(model),
    force,
    written,
  );
  if (chr) {
    writeFile(
      path.join(outDir, "scripts/test-mini-prd-core.mjs"),
      renderMiniPrdCoreSmoke(model),
      force,
      written,
    );
  }

  // Infra UI OS (deps kit + boot) — écrasable même si marque a pollué.
  writeOsUiAppFile(
    path.join(outDir, "ui/package.json"),
    renderUiPackageJson(manifest),
    written,
  );
  // Projet npm indépendant hors workspace : npm ne remonte pas chercher le
  // .npmrc racine → copie locale (token via env, jamais commité).
  writeOsUiAppFile(
    path.join(outDir, "ui/.npmrc"),
    renderCreezioNpmrc(),
    written,
  );
  writeOsUiAppFile(
    path.join(outDir, "ui/next.config.mjs"),
    renderUiNextConfig(),
    written,
  );
  writeOsUiAppFile(
    path.join(outDir, "ui/tsconfig.json"),
    renderUiTsconfig(),
    written,
  );
  writeFile(
    path.join(outDir, "ui/lib/metier-base.ts"),
    renderMetierBaseTs(),
    force,
    written,
  );
  // Thin wrappers → SoT @creezio/desktop-tooling/scripts/*
  const toolingProxy = (rel: string) => `#!/usr/bin/env node
/** Thin → @creezio/desktop-tooling/scripts/${rel} (SoT kit). */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
// Mode npm : le package vit dans node_modules (walk-up — workspaces racine :
// hoisting au node_modules racine, d'où la remontée).
function resolvePkgScript(pkg, relScript) {
  let dir = root;
  for (;;) {
    const cand = path.join(dir, "node_modules", pkg, relScript);
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
const script = resolvePkgScript("@creezio/desktop-tooling", "scripts/${rel}");
if (!script) throw new Error("${rel} kit manquant — npm install à la racine (workspaces)");
const r = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, CREEZIO_APP_ROOT: root },
  stdio: "inherit",
});
process.exit(r.status ?? 1);
`;
  writeFile(
    path.join(outDir, "scripts/ensure-linux-icons.mjs"),
    renderEnsureLinuxIconsMjs(),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "scripts/load-local-env.mjs"),
    renderLoadLocalEnvMjs(),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "scripts/smoke-tunnel.mjs"),
    toolingProxy("smoke-tunnel.mjs"),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "scripts/smoke-tunnel-catalog.mjs"),
    toolingProxy("smoke-tunnel-catalog.mjs"),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "scripts/e2e-browser-parcours.mjs"),
    renderE2eBrowserParcoursMjs(model),
    force,
    written,
  );
  writeFile(
    path.join(rootDir, ".env.example"),
    renderEnvExample(model),
    force,
    written,
  );
  writeOsUiAppFile(
    path.join(outDir, "ui/app/layout.tsx"),
    renderNextLayoutWithOsNav(model),
    written,
  );
  // Chrome kit : Tailwind obligatoire (classes @creezio/shell-ui/ui) —
  // configs écrasables (infra), tokens + wiring nav = fichiers marque.
  writeOsUiAppFile(
    path.join(outDir, "ui/tailwind.config.ts"),
    renderUiTailwindConfig(),
    written,
  );
  writeOsUiAppFile(
    path.join(outDir, "ui/postcss.config.js"),
    renderUiPostcssConfig(),
    written,
  );
  writeFile(
    path.join(outDir, "ui/app/globals.css"),
    renderUiGlobalsCss(),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "ui/components/brand-chrome.tsx"),
    renderUiBrandChrome(model),
    force,
    written,
  );
  // Parité factory : pages CRM inaccessibles sans cookie session marque.
  writeFile(
    path.join(outDir, "ui/middleware.ts"),
    renderUiAuthMiddleware(model.brandId),
    force,
    written,
  );
  // Design system kit obligatoire : table métier générique + convention
  // `@/components/ui/*` (re-exports @creezio/shell-ui) — plus de HTML brut.
  writeFile(
    path.join(outDir, "ui/components/entity-table.tsx"),
    renderUiEntityTable(),
    force,
    written,
  );
  for (const primitive of UI_PRIMITIVE_NAMES) {
    writeFile(
      path.join(outDir, `ui/components/ui/${primitive}.tsx`),
      renderUiPrimitiveReexport(primitive),
      force,
      written,
    );
  }
  writeFile(
    path.join(outDir, "ui/app/page.tsx"),
    renderNextHomePage(model),
    force,
    written,
  );
  for (const page of model.pages) {
    const seg = page.path.replace(/^\//, "") || page.id;
    writeFile(
      path.join(outDir, `ui/app/${seg}/page.tsx`),
      renderNextEntityPage(model, page.id),
      force,
      written,
    );
  }
  // Surfaces OS = @creezio/os-ui (matérialisées hors git). Pas de dossier OS versionné.
  writeFile(
    path.join(outDir, "scripts/materialize-os-ui.mjs"),
    renderMaterializeOsUiScript(),
    force,
    written,
  );

  writeFile(
    path.join(outDir, "resources/renderer/index.html"),
    renderMetierRendererHtml(model).replaceAll(
      "/api/v1/brand/",
      "/api/v1/modules/",
    ),
    force,
    written,
  );

  // Registre modules + un BrandModuleDef par entité (notes / CHR…).
  const moduleIds = writeProductModelModules(
    outDir,
    model,
    force,
    (filePath, body) => writeFile(filePath, body, force, written),
  );

  writeFile(
    path.join(outDir, "src/electron/vertical-slot.ts"),
    renderVerticalSlotFromModel(model),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "src/electron/brand-migrations.ts"),
    renderBrandMigrationsTs(model),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "src/electron/brand-module-api.ts"),
    renderBrandModuleApiTs(model),
    force,
    written,
  );

  // Specs 4 fichiers + gate structurelle branchée dans npm test.
  for (const moduleId of moduleIds) {
    const specFiles = renderModuleSpecFiles(moduleId);
    for (const [name, body] of Object.entries(specFiles)) {
      writeFile(
        path.join(rootDir, "brand-spec", "modules", moduleId, name),
        body,
        force,
        written,
      );
    }
    // Gate colocalisée avec la spec (5ᵉ fichier — DOC-STANDARD-MODULE.md).
    writeFile(
      path.join(rootDir, "brand-spec", "modules", moduleId, "gate.mjs"),
      renderModuleGateStub(moduleId, "brand-spec"),
      force,
      written,
    );
    wireModuleGateInPackageJson(outDir, moduleId);
  }
  writeFile(
    path.join(outDir, "src/electron/meili-feed.ts"),
    renderMeiliFeedTs(model),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "scripts/test-meili-config.mjs"),
    renderMeiliConfigSmoke(model),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "src/electron/brand-platform-bindings.ts"),
    renderBrandPlatformBindingsTs(model.brandId),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "src/electron/main.ts"),
    renderMainFromPrdNativeTs(manifest, model),
    force,
    written,
  );
  writeFile(
    path.join(outDir, "src/electron/preload.ts"),
    renderPreloadFromPrdTs(manifest),
    force,
    written,
  );

  writeFile(
    path.join(outDir, "README.md"),
    renderReadmeFromPrd(manifest, model),
    force,
    written,
  );

  writeFile(
    path.join(rootDir, "AGENTS.md"),
    renderBrandAgentsMd(manifest.client.productName),
    force,
    written,
  );
}
