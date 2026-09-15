/**
 * Scaffold d'une marque = **2 repos** consommant @creezio/*.
 *
 * Layout généré (LA norme — plus de layout plat) :
 *   <out>/server/   livrable serveur (métier, harness, UI, electron-builder.server)
 *   <out>/client/   livrable desktop thin remote-only (main client-only)
 *   <out>/          package.json orchestrateur (workspace npm racine) + brand-spec/
 *   <out>-admin/    repo ADMIN dédié (pilotage flotte multi-VPS, sans secrets)
 *
 * Mode classique (`--name/--id/--domain`) : OS shell + slot métier vide.
 * Mode `--from-prd` : ProductModel → schéma / API / UI / nav / wiring / smokes.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AppManifest,
  buildElectronBuilderConfig,
  createAppManifest,
  renderNsisInstallerInclude,
  validateAppManifest,
} from "@creezio/brand-config";
import { initBrandSpec } from "@creezio/brand-spec";
import { ARCHITECTURE_VERSION } from "@creezio/platform-core";
import { MINIMAL_PNG_BASE64 } from "./minimal-png.js";
import type { ProductModel } from "./product-model.js";
import { writeFromPrdArtifacts } from "./scaffold-from-prd.js";
import { writeAppFile } from "./write-app-file.js";
import {
  serverDockerNpmScripts,
  renderCreezioCliProxyMjs,
  renderCreezioDevProxyMjs,
} from "./generators/server-docker-scripts.js";
import {
  CLIENT_CREEZIO_DEPS,
  SERVER_CREEZIO_DEPS,
  creezioNpmDeps,
  renderCreezioNpmrc,
} from "./kit-release.js";
import {
  renderEnsureLinuxIconsMjs,
  ensureModulesRegistry,
  MODULES_INDEX_TS,
  MODULES_TYPES_TS,
  renderBrandAgentsMd,
  renderBrandPlatformBindingsTs,
  renderBrandWorkflowFiles,
} from "./generators/index.js";
import { scaffoldAdminApp } from "./admin-repo.js";
import { renderVerifyProdMjs } from "./generators/verify-prod.js";
import { installKitPluginTemplate } from "./plugin-templates.js";

export type NewAppOptions = {
  brandId: string;
  productName: string;
  domain: string;
  outDir: string;
  envPrefix?: string;
  feedToken?: string;
  sandbox?: boolean;
  force?: boolean;
  kitRoot?: string;
  /**
   * Dossier d'icônes marque (`client.png`, `server.png`, optionnel `tray-icon.png`).
   * Sinon : `brand-spec/icons/` sous outDir / à côté, sinon placeholder minimal.
   */
  iconsDir?: string;
  /** Présent si `creezio new-app --from-prd` */
  productModel?: ProductModel;
  /** URL serveur pré-provisionnée dans le picker client join-only. */
  defaultServerUrl?: string;
  /** Dossier du repo admin dédié (défaut : `<outDir>-admin`). */
  adminOut?: string;
  /**
   * Interne : ce scaffold EST l'app admin d'une marque (appel depuis
   * scaffoldAdminApp) — ne pas générer récursivement un repo admin.
   */
  adminApp?: boolean;
};

export type ScaffoldResult = {
  outDir: string;
  /** Livrable serveur : `<outDir>/server`. */
  serverDir: string;
  /** Livrable client desktop : `<outDir>/client`. */
  clientDir: string;
  /** Repo ADMIN dédié (hors monorepo) : `<outDir>-admin` par défaut. */
  adminDir: string;
  /** Fichiers du repo admin dédié (sous-ensemble hors writtenFiles). */
  adminFiles: string[];
  manifest: AppManifest;
  writtenFiles: string[];
  productModel?: ProductModel;
};

/** Racine kit par défaut : packages/factory/{src,dist} → ../../.. */
function scaffoldKitRootDefault(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..");
}

/**
 * Matérialise dans la marque les artefacts « clone autonome » npm (SoT kit
 * docker/server/) : Dockerfile serveur, pré-flight lockfiles, .dockerignore.
 * Packages @creezio/* publics (npmjs.org) — aucun token.
 */
function materializeStandaloneDistribution(
  outDir: string,
  kitRoot: string | undefined,
  written: string[],
): void {
  const kit = path.resolve(
    kitRoot || process.env.CREEZIO_KIT_ROOT || scaffoldKitRootDefault(),
  );
  const dockerServer = path.join(kit, "docker/server");
  const copies: Array<[src: string, dest: string]> = [
    ["ensure-server-lock.mjs", "scripts/ensure-server-lock.mjs"],
    ["Dockerfile", "docker/server.Dockerfile"],
  ];
  for (const [src, dest] of copies) {
    const from = path.join(dockerServer, src);
    if (!fs.existsSync(from)) continue; // kit incomplet (tests partiels) — non bloquant
    const to = path.join(outDir, dest);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    written.push(to);
  }
  const dockerignoreSrc = path.join(dockerServer, "brand.dockerignore");
  const dockerignoreDest = path.join(outDir, ".dockerignore");
  if (
    fs.existsSync(dockerignoreSrc) &&
    (!fs.existsSync(dockerignoreDest) ||
      !fs.readFileSync(dockerignoreDest, "utf8").includes("creezio-dockerignore"))
  ) {
    fs.copyFileSync(dockerignoreSrc, dockerignoreDest);
    written.push(dockerignoreDest);
  }
}

/** Symlink relatif idempotent (dangling accepté — cible synchronisée plus tard). */
function ensureRelativeSymlink(linkPath: string, target: string): void {
  try {
    const st = fs.lstatSync(linkPath);
    if (st.isSymbolicLink() || st.isDirectory() || st.isFile()) return;
  } catch {
    /* absent → créer */
  }
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath);
}

function writeFile(
  filePath: string,
  content: string | Buffer,
  force: boolean,
  written: string[],
): void {
  writeAppFile(filePath, content, force, written);
}

function exportName(m: AppManifest): string {
  const id = m.brandId.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return `${id}Manifest`;
}

/** Sérialise un AppManifest en module TS exporté. */
export function renderManifestTs(
  manifest: AppManifest,
  name: string,
): string {
  const body = JSON.stringify(manifest, null, 2);
  return `import type { AppManifest } from "@creezio/brand-config";

/**
 * AppManifest généré par \`creezio new-app\` (Phase D).
 * Ne pas recycler les GUID / feeds des marques prod.
 */
export const ${name}: AppManifest = ${body} as AppManifest;
`;
}

function renderPackageJson(m: AppManifest): string {
  return (
    JSON.stringify(
      {
        name: `@creezio/app-${m.brandId}`,
        private: true,
        version: "0.1.0",
        description: `${m.client.productName} — livrable SERVEUR (métier + OS Creezio)`,
        type: "module",
        main: "./build/electron/main.js",
        scripts: {
          build: "npm run build:runtime",
          // build:runtime = TS main+preload (alias historique build:electron).
          "build:runtime":
            "tsc -p tsconfig.electron.json && tsc -p tsconfig.preload.json",
          "build:electron": "npm run build:runtime",
          typecheck: "tsc -p tsconfig.electron.json --noEmit",
          "electron:config:server":
            "node scripts/build-builder-config.mjs server",
          "electron:stage-win-bins":
            "bash ../node_modules/@creezio/desktop-tooling/scripts/stage-win-bins.sh",
          "pack:win:server":
            "npm run electron:stage-win-bins && npm run electron:config:server && npm run build:electron && CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --config electron-builder.server.json --win nsis --x64 -c.win.signAndEditExecutable=false",
          "pack:linux:server":
            "node scripts/ensure-linux-icons.mjs && npm run electron:config:server && npm run build:electron && electron-builder --config electron-builder.server.json --linux AppImage dir --x64",
        },
        dependencies: {
          // Deps npm publiées (npmjs.org, lockstep) — clôture explicite.
          ...creezioNpmDeps(SERVER_CREEZIO_DEPS),
          "electron-updater": "^6.3.9",
          // Deps npm runtime main (asar FileSets kit) — pas seulement transitifs
          "hono": "^4.12.30",
          "zod": "^4.0.0",
          "jose": "^6.0.0",
          "better-sqlite3": "^12.11.1",
          // Mails natifs v2 (@creezio/mails) : transport SMTP + comptes IMAP.
          // Peers optionnels du kit, posés par défaut côté serveur marque.
          "nodemailer": "^7.0.9",
          "imapflow": "^1.0.191",
          "mailparser": "^3.7.5",
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
          brandId: m.brandId,
          kind: "server",
        },
        license: "UNLICENSED",
      },
      null,
      2,
    ) + "\n"
  );
}

function renderClientPackageJson(m: AppManifest): string {
  return (
    JSON.stringify(
      {
        name: `@creezio/app-${m.brandId}-client`,
        private: true,
        version: "0.1.0",
        description: `${m.client.productName} — livrable CLIENT desktop thin (remote-only, kit Creezio)`,
        type: "module",
        main: "./build/electron/main.js",
        scripts: {
          build: "npm run build:runtime",
          "build:runtime":
            "tsc -p tsconfig.electron.json && tsc -p tsconfig.preload.json",
          "build:electron": "npm run build:runtime",
          typecheck: "tsc -p tsconfig.electron.json --noEmit",
          "electron:config:client":
            "node scripts/build-builder-config.mjs client",
          "desktop:dev":
            "npm run electron:config:client && npm run build:electron && electron .",
          "pack:linux":
            "node scripts/ensure-linux-icons.mjs && npm run electron:ensure-linux-native && npm run electron:config:client && npm run build:electron && electron-builder --config electron-builder.client.json --linux AppImage dir --x64",
          "pack:linux:dir":
            "node scripts/ensure-linux-icons.mjs && npm run electron:ensure-linux-native && npm run electron:config:client && npm run build:electron && electron-builder --config electron-builder.client.json --linux dir --x64",
          "pack:win":
            "npm run electron:ensure-win-native && npm run electron:config:client && npm run build:electron && CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --config electron-builder.client.json --win nsis --x64 -c.win.signAndEditExecutable=false",
          "pack:win:zip":
            "npm run electron:config:client && npm run build:electron && CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --config electron-builder.client.json --win zip --x64 -c.win.signAndEditExecutable=false",
          "electron:publish": `CREEZIO_BRAND=${m.brandId} CREEZIO_APP_ROOT=. bash node_modules/@creezio/desktop-tooling/scripts/publish-desktop.sh`,
          "electron:publish:linux": `CREEZIO_BRAND=${m.brandId} CREEZIO_APP_ROOT=. bash node_modules/@creezio/desktop-tooling/scripts/publish-desktop.sh --platform=linux`,
          "electron:publish:dry": `CREEZIO_BRAND=${m.brandId} CREEZIO_APP_ROOT=. bash node_modules/@creezio/desktop-tooling/scripts/publish-desktop.sh --dry-run`,
          "electron:ensure-win-native":
            "node node_modules/@creezio/desktop-tooling/scripts/ensure-win-native-modules.mjs",
          "electron:ensure-linux-native":
            "node node_modules/@creezio/desktop-tooling/scripts/ensure-linux-native-modules.mjs",
          "electron:verify-pack":
            "node node_modules/@creezio/desktop-tooling/scripts/verify-pack-runtime.mjs . --kind=client",
        },
        dependencies: {
          ...creezioNpmDeps(CLIENT_CREEZIO_DEPS),
          "better-sqlite3": "^12.11.1",
          "electron-updater": "^6.3.9",
          "hono": "^4.12.30",
          "jose": "^6.0.0",
          "zod": "^4.0.0",
        },
        devDependencies: {
          "@types/node": "^22.15.3",
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
          brandId: m.brandId,
          kind: "client",
        },
        license: "UNLICENSED",
      },
      null,
      2,
    ) + "\n"
  );
}

function renderTsconfigBase(): string {
  // Copie locale — l’app générée doit compiler hors monorepo (/tmp smokes, extraction).
  return `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false
  }
}
`;
}

function renderTsconfigElectron(): string {
  return `{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "outDir": "build/electron",
    "rootDir": "src/electron",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["src/electron/**/*.ts", "src/electron/**/*.d.ts"],
  "exclude": ["src/electron/preload.ts"]
}
`;
}

/** Preload sandbox Electron = CommonJS (pas ESM). */
function renderTsconfigPreload(): string {
  return `{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "build/electron",
    "rootDir": "src/electron",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "skipLibCheck": true,
    "declaration": false,
    "declarationMap": false
  },
  "include": ["src/electron/preload.ts", "src/electron/electron-shim.d.ts"]
}
`;
}

function renderElectronShimDts(): string {
  return `/**
 * Déclarations Electron minimales — compile sans installer le binaire.
 * Au runtime packagé, le vrai module \`electron\` est fourni par Electron.
 */
declare module "electron" {
  export const app: {
    requestSingleInstanceLock: () => boolean;
    whenReady: () => Promise<void>;
    quit: () => void;
    exit: (code?: number) => void;
    isPackaged: boolean;
    getPath: (name: string) => string;
    setPath: (name: string, p: string) => void;
    setName: (name: string) => void;
    setAppUserModelId: (id: string) => void;
    getVersion: () => string;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
  };

  export class BrowserWindow {
    constructor(opts: Record<string, unknown>);
    loadFile(filePath: string): Promise<void>;
    webContents: { send(channel: string, ...args: unknown[]): void };
  }

  export const contextBridge: {
    exposeInMainWorld: (apiKey: string, api: unknown) => void;
  };

  export const ipcMain: {
    handle: (
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>,
    ) => void;
  };

  export const ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    send: (channel: string, ...args: unknown[]) => void;
    on: (
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => void,
    ) => void;
    removeListener: (
      channel: string,
      listener: (...args: unknown[]) => void,
    ) => void;
  };
}

declare namespace NodeJS {
  interface Process {
    resourcesPath: string;
  }
}
`;
}

function renderElectronBuilderBase(m: AppManifest): string {
  return (
    JSON.stringify(
      {
        appId: m.client.appId,
        productName: m.client.productName,
        copyright: m.copyright,
        directories: {
          output: "dist-electron",
          buildResources: "resources",
        },
        // parité kit : exclure node_modules (sinon bins kit + deps → asar ~450 Mo).
        // @creezio/* runtime ré-inclus via buildElectronBuilderConfig (FileSets
        // résolus npm : ../node_modules/@creezio/* — hoisting workspace racine).
        files: [
          "build/electron/**/*",
          "package.json",
          "!node_modules/**/*",
          "../node_modules/electron-updater/**/*",
          "../node_modules/builder-util-runtime/**/*",
          "../node_modules/fs-extra/**/*",
          "../node_modules/jsonfile/**/*",
          "../node_modules/universalify/**/*",
          "../node_modules/graceful-fs/**/*",
          "../node_modules/js-yaml/**/*",
          "../node_modules/argparse/**/*",
          "../node_modules/semver/**/*",
          "../node_modules/lazy-val/**/*",
          "../node_modules/lodash.escaperegexp/**/*",
          "../node_modules/lodash.isequal/**/*",
          "../node_modules/tiny-typed-emitter/**/*",
          "../node_modules/debug/**/*",
          "../node_modules/ms/**/*",
          "../node_modules/sax/**/*",
        ],
        extraResources: [
          {
            from: "build/electron",
            to: "build/electron",
            filter: ["**/*"],
          },
          {
            from: "resources/renderer",
            to: "renderer",
          },
        ],
        asar: true,
        nsis: {
          oneClick: false,
          allowToChangeInstallationDirectory: true,
          include: "installer.nsh",
        },
        win: {
          target: [{ target: "nsis", arch: ["x64"] }],
        },
      },
      null,
      2,
    ) + "\n"
  );
}

function renderBuildBuilderConfigMjs(brandId: string): string {
  return `#!/usr/bin/env node
/**
 * Génère electron-builder.client.json / .server.json via buildElectronBuilderConfig.
 * SoT manifest = repo marque (src/electron/app-manifest.json) — le kit ne
 * connaît pas ses consommateurs (H11 : plus de fallback registre kit).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildElectronBuilderConfig,
  renderNsisInstallerInclude,
} from "@creezio/brand-config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const kind = process.argv[2] === "server" ? "server" : "client";
const brandId = process.env.CREEZIO_BRAND || "${brandId}";

const genPath = path.join(root, "src/electron/app-manifest.json");
if (!fs.existsSync(genPath)) {
  throw new Error(
    \`Manifest introuvable pour \${brandId} — src/electron/app-manifest.json requis (H11)\`,
  );
}
const manifest = JSON.parse(fs.readFileSync(genPath, "utf8"));
if (manifest.brandId !== brandId) {
  throw new Error(
    \`app-manifest.json brandId=\${manifest.brandId} ≠ CREEZIO_BRAND=\${brandId}\`,
  );
}

const base = JSON.parse(
  fs.readFileSync(path.join(root, "electron-builder.base.json"), "utf8"),
);
const cfg = buildElectronBuilderConfig(manifest, kind, base);
const out = path.join(root, \`electron-builder.\${kind}.json\`);
fs.writeFileSync(out, JSON.stringify(cfg, null, 2) + "\\n");
console.log("wrote", out);

// Options install (démarrage auto) + désinstall profonde.
const nsh = path.join(root, "installer.nsh");
fs.writeFileSync(nsh, renderNsisInstallerInclude(manifest));
console.log("wrote", nsh);

// Marker packagé lu par prepareDesktopBoot (asar build/electron/app-kind.json).
const kindOutDir = path.join(root, "build", "electron");
fs.mkdirSync(kindOutDir, { recursive: true });
const kindOut = path.join(kindOutDir, "app-kind.json");
fs.writeFileSync(kindOut, JSON.stringify({ kind }, null, 2) + "\\n");
console.log("wrote", kindOut);
`;
}

function renderInstallerNsh(m: AppManifest): string {
  return renderNsisInstallerInclude(m);
}

function renderBareBrandMigrationsTs(): string {
  return `/**
 * Migrations brand — squelette \`brand create\` / new-app sans --from-prd.
 * Même câblage que from-prd : interactive-demo + registre modules.
 */
import { composeMigrations, type SqliteMigration } from "@creezio/platform-core";
import { interactiveDemoMigrations } from "@creezio/interactive-demo";
import { onboardingContentMigrations } from "@creezio/onboarding";
import { collectModuleMigrations } from "./modules/index.js";

export function brandMigrations(): SqliteMigration[] {
  return composeMigrations(
    interactiveDemoMigrations(),
    onboardingContentMigrations(),
    collectModuleMigrations(),
  );
}
`;
}

function renderBareBrandModuleApiTs(productName: string): string {
  return `/**
 * Mounts métier — squelette. Consommateur du registre \`modules/\`.
 * \`creezio brand module init <id>\` branche EntitySpecs / mounts sans
 * refactor ici. Interactive-demo câblé dès le jour 1 (même contrat from-prd).
 */
import type { ApiKernel } from "@creezio/api-kernel";
import { registerEntityMounts } from "@creezio/api-kernel";
import { mergeAssistantBrandConfig } from "@creezio/assistant";
import {
  collectInteractiveDemoDefaults,
  createInteractiveDemoMount,
  genericOsTourScenario,
} from "@creezio/interactive-demo";
import { createOnboardingContentMount } from "@creezio/onboarding";
import {
  collectApiMounts,
  collectAssistantSources,
  collectDemoScenarios,
  collectEntitySpecs,
  collectOnboardingContent,
} from "./modules/index.js";

export function registerBrandModuleApi(api: ApiKernel): void {
  mergeAssistantBrandConfig({ moduleSources: collectAssistantSources() });
  registerEntityMounts(api, collectEntitySpecs());
  for (const [id, mount] of collectApiMounts()) {
    api.registerModuleApi(id, mount);
  }
  api.registerModuleApi(
    "onboarding",
    createOnboardingContentMount({ defaults: collectOnboardingContent() }),
  );
  api.registerModuleApi(
    "interactive-demo",
    createInteractiveDemoMount({
      defaults: collectInteractiveDemoDefaults([
        {
          moduleId: "os",
          scenarios: [
            genericOsTourScenario({
              productName: ${JSON.stringify(productName)},
            }),
          ],
        },
        { moduleId: "brand", scenarios: collectDemoScenarios() },
      ]),
    }),
  );
}
`;
}

function renderBareBrandHarnessMjs(m: AppManifest): string {
  return `#!/usr/bin/env node
/**
 * Harness Node — façade @creezio/app-runtime (OS natif P&P).
 * Fichier GÉNÉRÉ par la factory creezio (template kit — même façade pour
 * toutes les marques ; modules optionnels chargés s'ils existent).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  applyBrandCatalogEnvDefaults,
  startBrandKernelHarness,
} from "@creezio/app-runtime";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.METIER_PORT || process.env.PORT || 18791);
const electron = path.join(root, "build/electron");

// Catalogue : léger par défaut (tests/CI) — Docker prod : CREEZIO_CATALOG=1.
applyBrandCatalogEnvDefaults(${JSON.stringify(m.envPrefix)});

const importMod = (name) =>
  import(pathToFileURL(path.join(electron, name)).href);
const importOptional = (name) =>
  fs.existsSync(path.join(electron, name)) ? importMod(name) : null;

const manifestMod = await importMod("app-manifest.js");
const migMod = await importMod("brand-migrations.js");
const apiMod = await importMod("brand-module-api.js");
const catalogMod = await importOptional("catalog-sync.js");
const mcpMod = await importOptional("brand-mcp-tools.js");
const bindMod = await importOptional("brand-platform-bindings.js");

const manifestExport = Object.keys(manifestMod).find((k) =>
  k.endsWith("Manifest"),
);
if (!manifestExport) throw new Error("AppManifest introuvable");

const dataDir = process.env.METIER_DATA_DIR || undefined;

await startBrandKernelHarness({
  brandId: ${JSON.stringify(m.brandId)},
  appRoot: root,
  port: PORT,
  manifest: manifestMod[manifestExport],
  brandMigrations: migMod.brandMigrations(),
  registerModuleApi: apiMod.registerBrandModuleApi,
  beforeBoot: () => {
    bindMod?.applyBrandPlatformBindings?.();
  },
  ...(catalogMod?.createBrandCatalogHost
    ? { catalogHost: catalogMod.createBrandCatalogHost(dataDir) }
    : {}),
  ...(mcpMod?.createBrandModuleMcpTools
    ? { discoverModuleTools: mcpMod.createBrandModuleMcpTools }
    : {}),
});
`;
}

function renderMainTs(m: AppManifest): string {
  const name = exportName(m);
  return `/**
 * Main Electron — déclaration marque uniquement.
 * Orchestration OS = @creezio/app-runtime (P&P natif).
 * Opt-out shell : CREEZIO_DESKTOP_SHELL=window
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { startBrandDesktop } from "@creezio/app-runtime";
import { ${name} as manifest } from "./app-manifest.js";
import { verticalSlot } from "./vertical-slot.js";
import { brandMigrations } from "./brand-migrations.js";
import { registerBrandModuleApi } from "./brand-module-api.js";
import { applyBrandPlatformBindings } from "./brand-platform-bindings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

startBrandDesktop({
  manifest,
  electronDirname: __dirname,
  brandMigrations: brandMigrations(),
  registerModuleApi: registerBrandModuleApi,
  beforeBoot: applyBrandPlatformBindings,
  navItems: verticalSlot.items,
  desktopShell:
    process.env.CREEZIO_DESKTOP_SHELL === "window" ? "window" : "runtime",
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
`;
}

/**
 * Main Electron CLIENT — thin, remote-only (livrable `client/`).
 * SANS imports métier (brand-migrations / brand-module-api restent en `server/`).
 */
function renderClientMainTs(m: AppManifest): string {
  const name = exportName(m);
  return `/**
 * Main Electron CLIENT — thin, remote-only (livrable \`client/\` du monorepo).
 *
 * Le kind packagé (\`build/electron/app-kind.json\` → \`client\`, écrit par
 * \`electron:config:client\`) force \`requireRemoteProfile\` : picker
 * « Rejoindre un serveur » puis CRM du serveur distant. AUCUNE stack locale.
 *
 * PAS d'imports métier ici : \`brand-migrations\` / \`brand-module-api\`
 * vivent dans le livrable serveur (\`../server\`).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import { startBrandDesktop } from "@creezio/app-runtime";
import { ${name} as manifest } from "./app-manifest.js";
import { loadLocalEnv } from "./load-local-env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Secrets ops éventuels (dev) : \`.env\` gitignoré — jamais embarqué.
loadLocalEnv(path.resolve(__dirname, "../.."));

startBrandDesktop({
  manifest,
  electronDirname: __dirname,
  // Client thin : toujours le shell runtime (le mode fenêtre seule exigerait
  // une stack locale que ce livrable n'embarque pas).
  desktopShell: "runtime",
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
`;
}

function renderLoadLocalEnvTs(): string {
  return `/**
 * Charge \`.env\` gitignoré à la racine du livrable (symlink → ../.env racine).
 * N'écrase pas les variables déjà présentes dans process.env.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function loadLocalEnv(appRoot?: string): {
  loaded: boolean;
  path: string;
  keys: string[];
} {
  const root =
    appRoot ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const envPath = path.join(root, ".env");
  const keys: string[] = [];
  if (!fs.existsSync(envPath)) {
    return { loaded: false, path: envPath, keys };
  }
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\\r?\\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!key) continue;
    if (process.env[key] === undefined) {
      process.env[key] = val;
      keys.push(key);
    }
  }
  return { loaded: true, path: envPath, keys };
}
`;
}

/**
 * package.json racine orchestrateur : délègue aux livrables `server/` /
 * `client/` et porte les scripts `server-docker:*` (brandRoot = racine repo).
 */
function renderRootPackageJson(
  m: AppManifest,
  opts: { serverPkgJson: string; model?: ProductModel },
): string {
  const serverPkg = JSON.parse(opts.serverPkgJson) as {
    scripts?: Record<string, string>;
  };
  const scripts: Record<string, string> = {};
  for (const name of Object.keys(serverPkg.scripts || {})) {
    // Les scripts pack/publish/dev serveur restent invocables via --prefix,
    // mais on ne délègue à la racine que le flux courant.
    if (name.startsWith("electron:stage") || name === "desktop:dev") continue;
    scripts[name] = `npm run ${name} --prefix server`;
  }
  // Livrable client — pack + publish + config.
  for (const name of [
    "electron:config:client",
    "pack:linux",
    "pack:linux:dir",
    "pack:win",
    "pack:win:zip",
    "electron:publish",
    "electron:publish:linux",
    "electron:publish:dry",
    "electron:verify-pack",
  ]) {
    scripts[name] = `npm run ${name} --prefix client`;
  }
  scripts["client:build"] = "npm run build:runtime --prefix client";
  scripts.typecheck =
    "npm run typecheck --prefix server && npm run typecheck --prefix client";
  // Clone autonome npm (repo GitHub sans kit) : ensure-server-lock
  // (lock racine workspace + ui/client) AVANT docker build + secret BuildKit
  // pour le token registre (jamais en ARG — hors historique image).
  scripts["docker:build"] =
    `node scripts/ensure-server-lock.mjs && docker build -f docker/server.Dockerfile --build-arg SERVER_DIR=server --secret id=CREEZIO_NPM_TOKEN,env=CREEZIO_NPM_TOKEN -t ${m.brandId}-server:local .`;
  // Serveur Docker headless : brandRoot = racine monorepo (scripts kit SoT).
  Object.assign(scripts, serverDockerNpmScripts(m.brandId));

  // Dev local standard (Q1/Q6) : clone → npm run setup → npm run dev.
  // Orchestrateur unique dans le kit (@creezio/app-runtime/scripts/dev-stack)
  // exposé via le proxy scripts/creezio-dev.mjs — zéro copie divergente.
  scripts["dev"] = "node scripts/creezio-dev.mjs dev";
  scripts["stop"] = "node scripts/creezio-dev.mjs stop";
  scripts["status"] = "node scripts/creezio-dev.mjs status";
  scripts["setup"] = "node scripts/creezio-dev.mjs setup";
  // Vérification E2E canonique des instances prod (skill fleet-ops §3b).
  scripts["verify:prod"] = "node scripts/verify-prod.mjs --all";

  const creezio: Record<string, unknown> = {
    brandId: m.brandId,
    layout: "monorepo",
    // Marqueur lu par `creezio upgrade` (détection de la version courante
    // avant chaîne de codemods) — re-stampé par le runner à chaque montée.
    architectureVersion: ARCHITECTURE_VERSION,
  };
  if (opts.model) {
    creezio.fromPrd = true;
    creezio.nativeKernel = true;
    creezio.vertical = opts.model.vertical || "generic";
    creezio.entities = opts.model.entities.map((e) => e.id);
    creezio.flows = opts.model.flows.map((f) => f.id);
  }

  return (
    JSON.stringify(
      {
        name: m.brandId,
        private: true,
        version: "0.1.0",
        description: `${m.client.productName} — monorepo marque (server/ client/) sur OS Creezio ; admin flotte = repo dédié ${m.brandId}-admin`,
        type: "module",
        scripts,
        workspaces: ["server"],
        creezio,
        engines: { node: ">=22.5" },
        license: "UNLICENSED",
      },
      null,
      2,
    ) + "\n"
  );
}

function renderRootGitignore(): string {
  return `node_modules/
**/ui/.next/
build/
**/build/
dist-electron/
dist-electron-server/
**/dist-electron/
**/dist-electron-server/
.data-metier/
.tmp/
.creezio/
.artifacts/
*.log
.DS_Store
*.tsbuildinfo
.env
.env.local
# Surfaces OS matérialisées depuis @creezio/os-ui — jamais versionnées dans la marque
**/ui/app/(creezio-os)/

# Runtime serveurs Docker (registre servers.json, volumes, secrets admin)
docker-data/
`;
}

/**
 * Cursor cloud agents : tout repo factory naît avec son environnement
 * d'install déclaré (reproductible, adossé au lockfile commité).
 */
function renderCursorEnvironmentJson(): string {
  return (
    JSON.stringify({ install: "npm install --no-audit --no-fund" }, null, 2) +
    "\n"
  );
}

function renderRootReadme(m: AppManifest): string {
  return `# ${m.client.productName}

Monorepo marque sur OS Creezio (\`creezio new-app\` / \`brand apply\`).
Le pilotage de flotte vit dans le **repo admin dédié** \`${m.brandId}-admin\`
(généré par la factory à côté de ce monorepo).

## Structure

\`\`\`
brand-spec/     # SoT marque (brand.yaml, product.md, modules/)
server/         # livrable serveur : métier, harness, UI Next, Docker
                  # (workspace npm racine — deps @creezio/* publiées, ^lockstep)
client/         # livrable desktop thin remote-only (picker serveur)
docker-data/    # runtime gitignoré (registre servers.json, volumes)
\`\`\`

## Identité

| Champ | Valeur |
|-------|--------|
| brandId | \`${m.brandId}\` |
| client appId | \`${m.client.appId}\` |
| server appId | \`${m.server.appId}\` |
| client NSIS GUID | \`${m.client.nsisGuid}\` |
| feed client | \`${m.client.feedUrl}\` |
| sandbox | \`${Boolean(m.sandbox)}\` |

## Quickstart dev (5 lignes)

\`\`\`bash
npm run setup                   # deps racine + ui + client, build kernel
npm run dev                     # kernel + Next dev — URL affichée
npm run status                  # état des processus (PID files .creezio/)
npm run stop                    # arrêt propre (process group)
\`\`\`

## Flux courants (racine)

\`\`\`bash
npm test                        # gates métier (délègue server/)
npm run build:runtime           # TS main+preload serveur
CREEZIO_TUNNEL_LOCAL=1 npm run server-docker:create -- demo   # local
# VPS : .env CREEZIO_CF_API_TOKEN/_ACCOUNT_ID/_ZONE_ID + CREEZIO_OWNER_EMAIL/_PASSWORD + npm run server-docker:create -- acme -- --profile prod
npm run pack:linux              # client desktop (délègue client/)
npm run server-docker:admin     # admin web flotte (repo ${m.brandId}-admin)
npm run verify:prod             # vérification E2E canonique des instances
                                #   (scripts/verify-prod.mjs — login E2E,
                                #    auth/me, browse Meili, llm-status ;
                                #    checks métier : verify-prod.local.mjs)
\`\`\`

Docs : \`server/README.md\`, repo admin \`${m.brandId}-admin/README.md\`,
kit \`docker/server/README.md\`.

## Clone autonome (sans le kit creezio)

**npmjs.org** : \`@creezio/*\` sont des packages publics (org \`creezio\`).
Distribution npm (docs/NPM-DISTRIBUTION.md du kit) — aucun vendor, aucun
token. Le \`.npmrc\` racine (commité) pointe \`registry.npmjs.org\`. Post-clone :

\`\`\`bash
npm ci                          # workspace racine (server/) — lock commité
npm ci --prefix server/ui && npm ci --prefix client
npm run build:runtime && npm run build:ui
npm run docker:build            # ensure-server-lock + image via docker/server.Dockerfile
\`\`\`

### Layout \`node_modules\` (hôte vs Docker)

- **Docker** : le Dockerfile \`npm ci --workspace=server\` pose
  \`/app/node_modules\` (walk-up standard — packages npm réels).
- **Clone hôte** : même layout — \`npm ci\` à la racine (workspace) hoiste
  dans \`node_modules/\` racine ; \`server/\` résout par walk-up.

Les binaires fat (Meili, cloudflared) ne sont pas dans les tarballs npm :
l'image Docker les télécharge au build, le desktop au premier run
(\`ensure-kit-binaries\`). Les gestes \`server-docker:*\` (registre
d'instances, admin flotte, enroll) restent outillés par le CLI kit
(\`CREEZIO_KIT_ROOT\`).
`;
}

function renderPreloadTs(m: AppManifest): string {
  return `/**
 * Preload — bridge desktop générique (pas d'API catalogue TF).
 *
 * Zéro import @creezio/* : ce fichier est copié hors asar (extraResources).
 * Le bridge name est figé au scaffold (manifest.bridgeName = ${JSON.stringify(m.bridgeName)}).
 */
import { contextBridge, ipcRenderer } from "electron";

const BRIDGE_NAME = ${JSON.stringify(m.bridgeName)};

/** Sous-ensemble générique — étendre localement selon la marque. */
const api = {
  isDesktop: true as const,
  getInfo: () => ipcRenderer.invoke("desktop:info"),
  getConnectionProfile: () => ipcRenderer.invoke("connection:get"),
  testConnection: (url: string) => ipcRenderer.invoke("connection:test", url),
  chooseConnection: (profile: unknown) =>
    ipcRenderer.invoke("connection:choose", profile),
  forgetRememberedServer: (id: string) =>
    ipcRenderer.invoke("profiles:forget-server", id),
  getSetupStatus: () => ipcRenderer.invoke("setup:status"),
  completeSetup: (payload: unknown) =>
    ipcRenderer.invoke("setup:complete", payload),
};

contextBridge.exposeInMainWorld(BRIDGE_NAME, api);
`;
}

function renderNavCoreTs(): string {
  return `/**
 * Navigation cœur plateforme — délègue à \`@creezio/shell-ui\`.
 * PAS de catalogue kit ni d'entrées métier marque.
 */
export type { CoreNavItem as NavItem } from "@creezio/shell-ui";
export { CORE_NAV_ITEMS, coreNavItems } from "@creezio/shell-ui";
`;
}

function brandPascal(brandId: string): string {
  return brandId
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

function renderProductHubStubTs(m: AppManifest): string {
  const manifestExport = exportName(m);
  const pascal = brandPascal(m.brandId);
  return `/**
 * Stub Product Hub sandbox — store mémoire + jetons marque.
 * Pas de SQLite / UI Admin (vertical Phase G).
 */

import {
  buildPluginImpactReport,
  createMemoryProductHubStore,
  productHubTokensFromManifest,
  type ProductHubStore,
} from "@creezio/product-hub";
import { ${manifestExport} as manifest } from "./app-manifest.js";

export const ${m.brandId.replace(/-/g, "")}ProductHubTokens =
  productHubTokensFromManifest(manifest);

let store: ProductHubStore | null = null;

export function get${pascal}ProductHubStore(): ProductHubStore {
  if (!store) {
    store = createMemoryProductHubStore({ conversationPrefix: "${m.brandId}" });
  }
  return store;
}

export function createDemoPluginRequest(input: {
  name: string;
  description?: string;
}) {
  const hub = get${pascal}ProductHubStore();
  const impact = buildPluginImpactReport({
    name: input.name,
    description: input.description || "",
    evidence: [],
  });
  return hub.createRequest({
    name: input.name,
    description: input.description,
    impact,
  });
}
`;
}

function renderVerticalSlotTs(m: AppManifest): string {
  const pascal = brandPascal(m.brandId);
  const tokensName = `${m.brandId.replace(/-/g, "")}ProductHubTokens`;
  return `/**
 * Slot métier vertical — ${m.client.productName}.
 * Consommateur du registre modules (\`collectNavItems\`) + Product Hub stub.
 */
import {
  createNavRegistry,
  type CoreNavItem,
  type NavRegistry,
} from "@creezio/shell-ui";
import {
  createDemoPluginRequest,
  ${tokensName},
  get${pascal}ProductHubStore,
} from "./product-hub-stub.js";
import { collectNavItems } from "./modules/index.js";

export type VerticalSlot = {
  /** Identifiant marque. */
  brandId: string;
  /** Entrées de nav métier (vide = squelette factory). */
  items: CoreNavItem[];
  /** Registre slots shell-ui. */
  nav: NavRegistry;
  /** Accès Product Hub sandbox. */
  productHub: {
    tokens: typeof ${tokensName};
    getStore: typeof get${pascal}ProductHubStore;
    createRequest: typeof createDemoPluginRequest;
  };
};

const BRAND_NAV: CoreNavItem[] = collectNavItems().map(
  ({ order: _order, ...item }) => item,
);

const nav = createNavRegistry();
nav.registerBrandNav(BRAND_NAV);

export const verticalSlot: VerticalSlot = {
  brandId: "${m.brandId}",
  items: nav.getBrandNav(),
  nav,
  productHub: {
    tokens: ${tokensName},
    getStore: get${pascal}ProductHubStore,
    createRequest: createDemoPluginRequest,
  },
};
`;
}

function renderRendererHtml(m: AppManifest): string {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'" />
    <title>${m.client.productName}</title>
    <style>
      :root { color-scheme: light; font-family: "Segoe UI", system-ui, sans-serif; }
      body { margin: 0; min-height: 100vh; background: linear-gradient(160deg, #e8f1f0, #f7f4ee 55%, #eef2f7); color: #1a2421; }
      main { max-width: 42rem; margin: 0 auto; padding: 3rem 1.5rem; }
      h1 { font-size: 2rem; letter-spacing: -0.02em; margin: 0 0 0.5rem; }
      p { line-height: 1.5; opacity: 0.85; }
      code { font-size: 0.9em; background: rgba(0,0,0,0.06); padding: 0.1em 0.35em; border-radius: 4px; }
      ul { padding-left: 1.2rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>${m.client.productName}</h1>
      <p>Sandbox factory Creezio — squelette Client + Serveur (<code>${m.brandId}</code>).</p>
      <p>Nav cœur placeholder · slot métier vide · kit <code>@creezio/*</code>.</p>
      <ul>
        <li>bridge <code>${m.bridgeName}</code></li>
        <li>env <code>${m.envPrefix}_*</code></li>
        <li>deep-link <code>${m.deepLinkProtocol}://</code></li>
      </ul>
    </main>
  </body>
</html>
`;
}

function renderReadme(m: AppManifest): string {
  return `# ${m.client.productName}

Squelette desktop **Client + Serveur** généré par \`creezio new-app\` (Phase D).

## Identité

| Champ | Valeur |
|-------|--------|
| brandId | \`${m.brandId}\` |
| bridgeName | \`${m.bridgeName}\` |
| envPrefix | \`${m.envPrefix}\` |
| deepLink | \`${m.deepLinkProtocol}://\` |
| tunnel | \`*.${m.tunnelRootDomain}\` |
| client appId | \`${m.client.appId}\` |
| server appId | \`${m.server.appId}\` |
| client NSIS GUID | \`${m.client.nsisGuid}\` |
| server NSIS GUID | \`${m.server.nsisGuid}\` |
| feed client | \`${m.client.feedUrl}\` |
| feed server | \`${m.server.feedUrl}\` |
| sandbox | \`${Boolean(m.sandbox)}\` |

## Structure

\`\`\`
src/electron/
  app-manifest.ts       # AppManifest embarqué
  main.ts               # boot mince (@creezio/electron-shell)
  preload.ts            # bridge (@creezio/shell)
  nav-core.ts           # nav via @creezio/shell-ui
  vertical-slot.ts      # slots shell-ui + Product Hub stub
  product-hub-stub.ts   # store mémoire @creezio/product-hub
  (wiring H1)           # deps api-kernel / mcp-facade / auth
resources/
  icons/{client,server}.png
  renderer/index.html
scripts/build-builder-config.mjs
electron-builder.{base,client,server}.json
\`\`\`

## Build

\`\`\`bash
cd /opt/docker/creezio
npm install
npm run build -w @creezio/app-${m.brandId}
\`\`\`

Configs electron-builder :

\`\`\`bash
cd apps/${m.brandId}
npm run electron:config:client
npm run electron:config:server
\`\`\`

## Publish (sandbox — dry-run)

Les feeds sandbox sont **jetables** et distincts des feeds des marques déjà en flotte.
Tant que le vhost \`dl-${m.brandId}\` n'existe pas sur NPM, utiliser uniquement le dry-run :

\`\`\`bash
npm run desktop:resolve-config -- --brand=${m.brandId} --kind=client --pretty
npm run desktop:publish -- --brand=${m.brandId} --kind=client --dry-run --app-root /opt/docker/creezio/apps/${m.brandId}
\`\`\`

Ne **jamais** recycler \`dockerDlName\` / feedToken d'une marque déjà en flotte.

## Suite (kit H6 / I*)

- Remplir \`vertical-slot.ts\` via \`registerBrandNav\` (\`brand.*\` only)
- Brancher demobrand-like : SqliteRuntime + auth/assistant/tasks/mails sqlite
- Control plane : \`startHostPluginControlPlane\` + \`createPluginControlPlaneAclFromStore\`
- Admin plugins L3 : helpers \`upsertPluginAclAdmin\`
- Voir \`docs/archive/FEATURE-PARITY-DEMOBRAND-H6.md\`
`;
}

/** PNG 1×1 = placeholder factory (à remplacer avant publish). */
const MINIMAL_PNG = Buffer.from(MINIMAL_PNG_BASE64, "base64");

function resolveIconsDir(rootDir: string, iconsDir?: string): string | null {
  const candidates = [
    iconsDir,
    path.join(rootDir, "brand-spec", "icons"),
    path.join(rootDir, "resources", "brand-icons"),
  ].filter(Boolean) as string[];
  for (const dir of candidates) {
    const abs = path.resolve(dir);
    if (
      fs.existsSync(path.join(abs, "client.png")) ||
      fs.existsSync(path.join(abs, "server.png"))
    ) {
      return abs;
    }
  }
  return null;
}

function isSubstantialPng(filePath: string): boolean {
  try {
    const st = fs.statSync(filePath);
    if (st.size < 2000) return false;
    const buf = fs.readFileSync(filePath);
    if (buf.length < 24 || buf[0] !== 0x89) return false;
    return buf.readUInt32BE(16) >= 128;
  } catch {
    return false;
  }
}

/**
 * Pose client/server (+ tray) marque si fournis ; sinon conserve des PNG
 * déjà substantiels ; sinon placeholder minimal (ne pas publier tel quel).
 */
function writeBrandIcons(
  baseDir: string,
  rootDir: string,
  opts: NewAppOptions,
  force: boolean,
  written: string[],
): void {
  const iconsOut = path.join(baseDir, "resources", "icons");
  fs.mkdirSync(iconsOut, { recursive: true });
  const srcDir = resolveIconsDir(rootDir, opts.iconsDir);
  const names = ["client.png", "server.png"] as const;

  for (const name of names) {
    const dest = path.join(iconsOut, name);
    const fromSrc = srcDir ? path.join(srcDir, name) : "";
    if (fromSrc && fs.existsSync(fromSrc)) {
      fs.copyFileSync(fromSrc, dest);
      written.push(dest);
      continue;
    }
    if (isSubstantialPng(dest)) {
      // Ne pas écraser une icône marque déjà en place par le placeholder 1×1.
      continue;
    }
    writeFile(dest, MINIMAL_PNG, force, written);
  }

  const trayDest = path.join(baseDir, "resources", "tray-icon.png");
  const trayCandidates = srcDir
    ? [
        path.join(srcDir, "tray-icon.png"),
        path.join(srcDir, "..", "tray-icon.png"),
      ]
    : [];
  for (const traySrc of trayCandidates) {
    if (fs.existsSync(traySrc)) {
      fs.copyFileSync(traySrc, trayDest);
      written.push(trayDest);
      break;
    }
  }
}

/**
 * Génère l'arborescence app + configs Client/Serveur.
 */
export function scaffoldNewApp(opts: NewAppOptions): ScaffoldResult {
  const onboardingNeed = opts.productModel?.platformNeeds?.onboarding;
  const manifest = createAppManifest({
    brandId: opts.brandId,
    productName: opts.productName,
    domain: opts.domain,
    envPrefix: opts.envPrefix,
    feedToken: opts.feedToken,
    sandbox: opts.sandbox !== false,
    defaultAppRoot: opts.outDir,
    defaultServerUrl: opts.defaultServerUrl,
    // demo-app / blankAppModel : onboarding off → post-setup home.
    ...(onboardingNeed === false
      ? { features: { onboarding: false } }
      : onboardingNeed === true
        ? { features: { onboarding: true } }
        : {}),
  });

  const errors = validateAppManifest(manifest);
  if (errors.length) {
    throw new Error(`Manifest invalide:\n- ${errors.join("\n- ")}`);
  }

  const outDir = path.resolve(opts.outDir);
  const serverDir = path.join(outDir, "server");
  const clientDir = path.join(outDir, "client");
  const adminDir = path.resolve(opts.adminOut || `${outDir}-admin`);
  const force = Boolean(opts.force);
  const written: string[] = [];
  const name = exportName(manifest);
  // Mode --from-prd : les fichiers métier (package.json, main, preload,
  // migrations, harness…) sont rendus par writeFromPrdArtifacts — ne pas
  // écrire les variantes squelette pour éviter double écriture.
  const prd = Boolean(opts.productModel);

  /* ── Livrable SERVEUR ─────────────────────────────────────────────── */
  if (!prd) {
    writeFile(
      path.join(serverDir, "package.json"),
      renderPackageJson(manifest),
      force,
      written,
    );
  }
  writeFile(
    path.join(serverDir, "tsconfig.base.json"),
    renderTsconfigBase(),
    force,
    written,
  );
  writeFile(
    path.join(serverDir, "tsconfig.electron.json"),
    renderTsconfigElectron(),
    force,
    written,
  );
  writeFile(
    path.join(serverDir, "tsconfig.preload.json"),
    renderTsconfigPreload(),
    force,
    written,
  );
  writeFile(
    path.join(serverDir, "electron-builder.base.json"),
    renderElectronBuilderBase(manifest),
    force,
    written,
  );
  writeFile(
    path.join(serverDir, "installer.nsh"),
    renderInstallerNsh(manifest),
    force,
    written,
  );
  writeFile(
    path.join(serverDir, "scripts/build-builder-config.mjs"),
    renderBuildBuilderConfigMjs(manifest.brandId),
    force,
    written,
  );
  if (!prd) {
    writeFile(
      path.join(serverDir, "scripts/ensure-linux-icons.mjs"),
      renderEnsureLinuxIconsMjs(),
      force,
      written,
    );
  }
  writeFile(
    path.join(serverDir, "src/electron/electron-shim.d.ts"),
    renderElectronShimDts(),
    force,
    written,
  );
  writeFile(
    path.join(serverDir, "src/electron/app-manifest.ts"),
    renderManifestTs(manifest, name),
    force,
    written,
  );
  writeFile(
    path.join(serverDir, "src/electron/app-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    force,
    written,
  );
  if (!prd) {
    // Registre modules vide (marqueurs) — \`brand module init\` branche sans refactor.
    ensureModulesRegistry(
      path.join(serverDir, "src/electron/modules"),
      force,
      (filePath, body) => writeFile(filePath, body, force, written),
    );
    writeFile(
      path.join(serverDir, "src/electron/modules/types.ts"),
      MODULES_TYPES_TS,
      force,
      written,
    );
    writeFile(
      path.join(serverDir, "src/electron/modules/index.ts"),
      MODULES_INDEX_TS,
      force,
      written,
    );
    writeFile(
      path.join(serverDir, "src/electron/brand-migrations.ts"),
      renderBareBrandMigrationsTs(),
      force,
      written,
    );
    writeFile(
      path.join(serverDir, "src/electron/brand-module-api.ts"),
      renderBareBrandModuleApiTs(opts.productName),
      force,
      written,
    );
    writeFile(
      path.join(serverDir, "scripts/brand-kernel-harness.mjs"),
      renderBareBrandHarnessMjs(manifest),
      force,
      written,
    );
    writeFile(
      path.join(serverDir, "scripts/creezio-cli.mjs"),
      renderCreezioCliProxyMjs(),
      force,
      written,
    );
    writeFile(
      path.join(serverDir, "src/electron/brand-platform-bindings.ts"),
      renderBrandPlatformBindingsTs(manifest.brandId),
      force,
      written,
    );
    writeFile(
      path.join(serverDir, "src/electron/main.ts"),
      renderMainTs(manifest),
      force,
      written,
    );
    writeFile(
      path.join(serverDir, "src/electron/preload.ts"),
      renderPreloadTs(manifest),
      force,
      written,
    );
    writeFile(
      path.join(serverDir, "src/electron/nav-core.ts"),
      renderNavCoreTs(),
      force,
      written,
    );
    writeFile(
      path.join(serverDir, "src/electron/product-hub-stub.ts"),
      renderProductHubStubTs(manifest),
      force,
      written,
    );
    writeFile(
      path.join(serverDir, "src/electron/vertical-slot.ts"),
      renderVerticalSlotTs(manifest),
      force,
      written,
    );
    writeFile(
      path.join(serverDir, "resources/renderer/index.html"),
      renderRendererHtml(manifest),
      force,
      written,
    );
    writeFile(
      path.join(serverDir, "README.md"),
      renderReadme(manifest),
      force,
      written,
    );
  }
  writeBrandIcons(serverDir, outDir, opts, force, written);

  // Plugin kit générique embarqué — seedé au boot via seedPluginsFromDirs
  // (`<serverDir>/plugins/<id>/` → runtime). Sans cet appel, une marque
  // scaffoldée part avec 0 plugins (audit 4a42617d).
  const kitPlugin = installKitPluginTemplate({
    templateId: "insights-assistant",
    pluginsDir: path.join(serverDir, "plugins"),
    enable: true,
    force,
  });
  written.push(
    path.join(kitPlugin.dir, "manifest.json"),
    ...kitPlugin.files.map((f) => path.join(kitPlugin.dir, f)),
  );

  /* ── Livrable CLIENT (desktop thin remote-only) ───────────────────── */
  writeFile(
    path.join(clientDir, "package.json"),
    renderClientPackageJson(manifest),
    force,
    written,
  );
  writeFile(
    path.join(clientDir, "tsconfig.base.json"),
    renderTsconfigBase(),
    force,
    written,
  );
  writeFile(
    path.join(clientDir, "tsconfig.electron.json"),
    renderTsconfigElectron(),
    force,
    written,
  );
  writeFile(
    path.join(clientDir, "tsconfig.preload.json"),
    renderTsconfigPreload(),
    force,
    written,
  );
  writeFile(
    path.join(clientDir, "electron-builder.base.json"),
    renderElectronBuilderBase(manifest),
    force,
    written,
  );
  writeFile(
    path.join(clientDir, "installer.nsh"),
    renderInstallerNsh(manifest),
    force,
    written,
  );
  writeFile(
    path.join(clientDir, "scripts/build-builder-config.mjs"),
    renderBuildBuilderConfigMjs(manifest.brandId),
    force,
    written,
  );
  writeFile(
    path.join(clientDir, "scripts/ensure-linux-icons.mjs"),
    renderEnsureLinuxIconsMjs(),
    force,
    written,
  );
  writeFile(
    path.join(clientDir, "src/electron/electron-shim.d.ts"),
    renderElectronShimDts(),
    force,
    written,
  );
  writeFile(
    path.join(clientDir, "src/electron/app-manifest.ts"),
    renderManifestTs(manifest, name),
    force,
    written,
  );
  writeFile(
    path.join(clientDir, "src/electron/app-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    force,
    written,
  );
  writeFile(
    path.join(clientDir, "src/electron/load-local-env.ts"),
    renderLoadLocalEnvTs(),
    force,
    written,
  );
  writeFile(
    path.join(clientDir, "src/electron/main.ts"),
    renderClientMainTs(manifest),
    force,
    written,
  );
  writeFile(
    path.join(clientDir, "src/electron/preload.ts"),
    renderPreloadTs(manifest),
    force,
    written,
  );
  writeFile(
    path.join(clientDir, "resources/renderer/index.html"),
    renderRendererHtml(manifest),
    force,
    written,
  );
  writeBrandIcons(clientDir, outDir, opts, force, written);

  /* ── Repo ADMIN dédié (app OS mode admin + config flotte, hors monorepo) ── */
  let adminFiles: string[] = [];
  if (!opts.adminApp) {
    const adminRepo = scaffoldAdminApp({
      outDir: adminDir,
      brandId: manifest.brandId,
      productName: manifest.client.productName,
      domain: manifest.tunnelRootDomain || manifest.domains.primary,
      force,
    });
    adminFiles = adminRepo.writtenFiles;
    written.push(...adminRepo.writtenFiles);
  }

  /* ── Configs electron-builder par livrable ────────────────────────── */
  const base = JSON.parse(
    fs.readFileSync(path.join(serverDir, "electron-builder.base.json"), "utf8"),
  );
  writeFile(
    path.join(serverDir, "electron-builder.server.json"),
    JSON.stringify(buildElectronBuilderConfig(manifest, "server", base), null, 2) +
      "\n",
    force,
    written,
  );
  writeFile(
    path.join(clientDir, "electron-builder.client.json"),
    JSON.stringify(buildElectronBuilderConfig(manifest, "client", base), null, 2) +
      "\n",
    force,
    written,
  );

  /* ── Métier --from-prd (écrit dans server/, racine pour AGENTS/env) ── */
  if (opts.productModel) {
    writeFromPrdArtifacts({
      outDir: serverDir,
      rootDir: outDir,
      manifest,
      model: opts.productModel,
      force,
      written,
    });
    // BrandSpec SoT : demo-app (onboarding off) / from-prd (onboarding on par défaut).
    const specDir = path.join(outDir, "brand-spec");
    const specResult = initBrandSpec({
      outDir: specDir,
      brandId: opts.brandId,
      brandName: opts.productName,
      domain: opts.domain,
      tagline: opts.productModel.tagline,
      vertical: opts.productModel.vertical || "generic",
      force,
      onboardingEnabled: opts.productModel.platformNeeds?.onboarding !== false,
    });
    written.push(...specResult.written);
  } else {
    // Squelette technique : brand-spec (_template modules) + AGENTS standard.
    const specResult = initBrandSpec({
      outDir: path.join(outDir, "brand-spec"),
      brandId: opts.brandId,
      brandName: opts.productName,
      domain: opts.domain,
      tagline: `${opts.productName} — métier sur OS Creezio`,
      vertical: "generic",
      force,
      onboardingEnabled: true,
    });
    written.push(...specResult.written);
    writeFile(
      path.join(outDir, "AGENTS.md"),
      renderBrandAgentsMd(opts.productName),
      force,
      written,
    );
  }

  /* ── Racine orchestrateur ─────────────────────────────────────────── */
  const serverPkgJson = fs.readFileSync(
    path.join(serverDir, "package.json"),
    "utf8",
  );
  writeFile(
    path.join(outDir, "package.json"),
    renderRootPackageJson(manifest, {
      serverPkgJson,
      model: opts.productModel,
    }),
    force,
    written,
  );
  writeFile(
    path.join(outDir, ".gitignore"),
    renderRootGitignore(),
    force,
    written,
  );
  // Cursor cloud agents : environnement d'install standard dès la naissance
  // (marque ET repo admin — les deux passent par scaffoldNewApp).
  writeFile(
    path.join(outDir, ".cursor/environment.json"),
    renderCursorEnvironmentJson(),
    force,
    written,
  );
  // Node 22.5+ (node:sqlite) — nvm/fnm + engines (Q4).
  writeFile(path.join(outDir, ".nvmrc"), "22\n", force, written);
  writeFile(
    path.join(outDir, "README.md"),
    renderRootReadme(manifest),
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
    path.join(outDir, "scripts/creezio-dev.mjs"),
    renderCreezioDevProxyMjs(),
    force,
    written,
  );
  // Vérification E2E canonique de prod (skill fleet-ops §3b) : checks
  // plateforme générés (version/login/me/browse Meili/llm-status) ; les
  // checks métier vivent dans scripts/verify-prod.local.mjs (jamais généré).
  writeFile(
    path.join(outDir, "scripts/verify-prod.mjs"),
    renderVerifyProdMjs({
      brandId: manifest.brandId,
      profile: opts.adminApp ? "admin" : "brand",
      meiliModule:
        !opts.adminApp && opts.productModel?.vertical === "chr"
          ? "produits"
          : null,
      assistant: opts.productModel
        ? opts.productModel.platformNeeds?.chat !== false
        : true,
    }),
    force,
    written,
  );

  // CI/CD flotte : chaque marque naît avec le filet complet (CI push/PR,
  // rapport d'impact kit npm + mise à jour décidée kit-update, CD sur CI
  // verte). Intégrité = `npm ci` (lockfile commité + registre).
  for (const [rel, body] of Object.entries(
    renderBrandWorkflowFiles({ brandId: manifest.brandId }),
  )) {
    writeFile(path.join(outDir, rel), body, force, written);
  }

  // .npmrc (registre @creezio → npmjs.org, aucun token) : racine
  // (workspace) + client/ (install indépendante — npm ne remonte pas
  // chercher le .npmrc parent hors workspaces). server/ui/.npmrc est
  // posé par le scaffold UI (from-prd) quand une UI existe.
  writeFile(path.join(outDir, ".npmrc"), renderCreezioNpmrc(), force, written);
  writeFile(path.join(clientDir, ".npmrc"), renderCreezioNpmrc(), force, written);
  // .env partagé racine (runtime server + client).
  ensureRelativeSymlink(path.join(serverDir, ".env"), "../.env");
  ensureRelativeSymlink(path.join(clientDir, ".env"), "../.env");

  // Distribution autonome npm (clone GitHub sans kit) : matérialiser le
  // Dockerfile serveur + ensure-server-lock + .dockerignore (SoT kit
  // docker/server/).
  materializeStandaloneDistribution(outDir, opts.kitRoot, written);

  return {
    outDir,
    serverDir,
    clientDir,
    adminDir,
    adminFiles,
    manifest,
    writtenFiles: written,
    productModel: opts.productModel,
  };
}
