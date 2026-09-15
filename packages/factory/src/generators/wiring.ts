/**
 * Templates wiring générique (F4) — twins minces générés dans le repo marque.
 */
import type { AppManifest } from "@creezio/brand-config";
import type { ProductModel } from "../product-model.js";

export function renderPathsTs(m: AppManifest): string {
  return `/**
 * Paths marque — généré par factory (twin générique).
 * Ne contient aucun domaine métier.
 */
import path from "node:path";
import fs from "node:fs";
import { app } from "electron";

const ENV_PREFIX = ${JSON.stringify(m.envPrefix)};

export function userDataDir(): string {
  return app.getPath("userData");
}

export function isPackaged(): boolean {
  return app.isPackaged;
}

export function resourcesRoot(): string {
  return isPackaged()
    ? process.resourcesPath
    : path.resolve(__dirname, "../../resources");
}

export function dbPath(): string {
  return path.join(userDataDir(), "${m.brandId}.sqlite");
}

export function assistantDbPath(): string {
  return path.join(userDataDir(), "assistant.sqlite");
}

export function uploadsDir(): string {
  const dir = path.join(userDataDir(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function meiliDataDir(): string {
  return path.join(userDataDir(), "meili");
}

export function nextServerEntry(): string {
  return path.join(
    isPackaged() ? process.resourcesPath : path.resolve(__dirname, "../.."),
    "server.js",
  );
}

export function nodeBinary(): string {
  return process.execPath;
}

export function nodeScript(rel: string): string {
  return path.join(path.resolve(__dirname, "../.."), rel);
}

export function nodeModulesPathForScripts(): string | null {
  const p = path.resolve(__dirname, "../../node_modules");
  return fs.existsSync(p) ? p : null;
}

export function preloadPath(name: string): string {
  return path.join(__dirname, name);
}

export function portEnvKey(): string {
  return \`\${ENV_PREFIX}_PORT\`;
}

export const brandPaths = {
  userDataDir,
  isPackaged,
  resourcesRoot,
  dbPath,
  assistantDbPath,
  uploadsDir,
  meiliDataDir,
  meiliBinary: () => path.join(resourcesRoot(), "meili"),
  nextServerEntry,
  nodeBinary,
  nodeScript,
  nodeModulesPathForScripts,
  preloadPath,
  portEnvKey,
};
`;
}

export function renderConnectionProfileTs(m: AppManifest): string {
  return `/**
 * Profil de connexion — généré factory (local / remote).
 */
export type ConnectionProfile = {
  mode: "local" | "remote";
  localBind: string;
  remoteUrl?: string;
  chosen: boolean;
};

export function defaultConnectionProfile(): ConnectionProfile {
  return {
    mode: "local",
    localBind: "127.0.0.1",
    chosen: false,
  };
}

export function tunnelRootDomain(): string {
  return ${JSON.stringify(m.tunnelRootDomain)};
}
`;
}

export function renderTunnelServiceUrlsTs(m: AppManifest): string {
  return `/**
 * URLs services tunnel — généré factory.
 */
export function publicUrlForService(
  publicBase: string | null | undefined,
  service: string,
): string | null {
  if (!publicBase) return null;
  const base = publicBase.replace(/\\/$/, "");
  return \`\${base}/\${service}\`;
}

export const TUNNEL_ROOT = ${JSON.stringify(m.tunnelRootDomain)};
`;
}

export function renderBrandModuleApiTs(model: ProductModel): string {
  return `/**
 * Surface module API brand — enregistre les mounts métier.
 */
import type { ApiKernel } from "@creezio/api-kernel";

const ENTITIES = ${JSON.stringify(model.entities.map((e) => e.id))};

export function registerBrandModuleApi(api: ApiKernel): void {
  for (const entity of ENTITIES) {
    api.registerModuleApi(entity, {
      dbLayer: "brand",
      handle: async () => ({
        status: 501,
        body: {
          error: "delegate_to_metier_api",
          hint: "npm run metier:api",
          entity,
        },
      }),
    });
  }
}
`;
}

export function renderCreezioBootTs(m: AppManifest): string {
  const camel = m.brandId.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const exportName = `${camel}Manifest`;
  return `/**
 * Boot plateforme mince — généré factory (F2/F4).
 * Prépare userData + kind avant installBrandDesktopRuntime.
 */
import { initLogger, log } from "@creezio/host-runtime";
import { prepareDesktopBoot, writeAppKindFile } from "@creezio/electron-shell";
import { ${exportName} as manifest } from "../electron/app-manifest.js";

export async function creezioBoot(opts: { electronDir: string }) {
  const boot = await prepareDesktopBoot(manifest);
  initLogger(boot.userDataDir, manifest.logBasename);
  log("boot", \`kind=\${boot.appKind} product=\${manifest.client.productName}\`);
  writeAppKindFile(
    opts.electronDir,
    boot.appKind === "legacy" ? "client" : boot.appKind,
  );
  return { boot, manifest };
}
`;
}

export function renderHostStackBindingsTs(m: AppManifest): string {
  return `/**
 * Bindings host-stack marque — généré factory.
 * Compose createBrandHostStack quand les hosts verticaux sont prêts.
 */
import type { AppManifest } from "@creezio/brand-config";
import { createBrandHostStack } from "@creezio/host-runtime";
import { brandPaths } from "./paths.js";

export type LocalConfigStoreLike = {
  ensureAuthSecret: () => string;
  ensureMcpJwtSecret: () => string;
  getLocalAuth: () => { authUser: string; authPassword: string } | null;
  getLlmKeys: () => Record<string, string | undefined>;
  isSetupComplete: () => boolean;
};

export type MemoryLocalConfigStore = LocalConfigStoreLike & {
  completeSetup: (user: string, password: string) => void;
};

/** Store mémoire minimal pour sandbox / first-run. */
export function createMemoryLocalConfigStore(): MemoryLocalConfigStore {
  let setup = false;
  let authSecret = "dev-auth-secret";
  let mcpSecret = "dev-mcp-secret";
  let localAuth: { authUser: string; authPassword: string } | null = null;
  return {
    ensureAuthSecret: () => authSecret,
    ensureMcpJwtSecret: () => mcpSecret,
    getLocalAuth: () => localAuth,
    getLlmKeys: () => ({}),
    isSetupComplete: () => setup,
    completeSetup(user: string, password: string) {
      localAuth = { authUser: user, authPassword: password };
      setup = true;
    },
  };
}

export function buildHostStack(opts: {
  manifest: AppManifest;
  store: LocalConfigStoreLike;
  stubs?: Record<string, () => unknown>;
}) {
  const stub = (name: string) => () => {
    if (opts.stubs?.[name]) return opts.stubs[name]!();
    return {
      start: async () => ({ ok: true, stub: name }),
      stop: async () => undefined,
      publicUrlForEmbedService: () => null,
    };
  };
  return createBrandHostStack({
    ensureN2Configured: () => undefined,
    getManifest: () => opts.manifest,
    getStore: () => opts.store,
    getPaths: () => brandPaths as never,
    portEnvKey: ${JSON.stringify(`${m.envPrefix}_PORT`)},
    defaultPort: 18790,
    envPrefix: ${JSON.stringify(m.envPrefix)},
    getHermesHost: stub("hermes"),
    getHermesCrmKeySurface: stub("hermesCrmKey"),
    getN8nHost: stub("n8n"),
    getTunnelService: stub("tunnel"),
    getNodeRuntime: () => ({ ready: true }),
    getHermesSeed: stub("hermesSeed"),
    meiliCoherence: "kit",
    getCatalog: stub("catalog"),
    pluginsFeatureOff: true,
    featureOffBrandLabel: ${JSON.stringify(m.client.productName)},
  });
}
`;
}

export function renderDesktopPresenceTs(m: AppManifest): string {
  return `/**
 * Présence desktop — généré factory.
 */
export function desktopPresencePayload(opts: {
  online: boolean;
  appKind: string;
}) {
  return {
    brandId: ${JSON.stringify(m.brandId)},
    online: opts.online,
    appKind: opts.appKind,
    at: new Date().toISOString(),
  };
}
`;
}

export function renderMainFromPrdTs(m: AppManifest, model: ProductModel): string {
  const exportName = m.brandId.replace(/-([a-z])/g, (_, c: string) =>
    c.toUpperCase(),
  );
  const manifestExport = `${exportName}Manifest`;
  return `/**
 * Main Electron — boot OS kit (session + runtime) + nav métier.
 * Généré par creezio new-app --from-prd. Zéro store/IPC custom marque.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { initLogger, log } from "@creezio/host-runtime";
import {
  prepareDesktopBoot,
  writeAppKindFile,
  installBrandDesktopRuntime,
  createDesktopSessionStore,
  registerDesktopSessionIpc,
  spawnBrandMetierApi,
} from "@creezio/electron-shell";
import { ${manifestExport} as manifest } from "./app-manifest.js";
import { createApiKernel } from "@creezio/api-kernel";
import { createMcpFacade } from "@creezio/mcp-facade";
import { createMemoryAuthStore } from "@creezio/auth";
import { createNavShellAdapter } from "@creezio/shell-ui";
import { verticalSlot } from "./vertical-slot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const METIER_PORT = Number(process.env.METIER_PORT || 18791);

async function main(): Promise<void> {
  const boot = await prepareDesktopBoot(manifest);
  initLogger(boot.userDataDir, manifest.logBasename);
  log("boot", \`kind=\${boot.appKind} product=\${manifest.client.productName} fromPrd=1\`);

  writeAppKindFile(
    __dirname,
    boot.appKind === "legacy" ? "client" : boot.appKind,
  );

  const session = createDesktopSessionStore({
    userDataDir: boot.userDataDir,
    manifest,
  });

  const api = createApiKernel({ brandId: manifest.brandId });
  const mcp = createMcpFacade({
    brandId: manifest.brandId,
    allowUnauthenticated: true,
    listApiMounts: () => api.listMounts(),
    discoverToolsBySpace: async () => ({ module: [], plugin: [] }),
  });
  const auth = createMemoryAuthStore();
  const navShell = createNavShellAdapter();
  navShell.registerBrandNav(verticalSlot.items);
  const navModel = navShell.getRenderModel();
  void mcp;
  void auth;
  // Référence runtime production — hosts via src/lib/host-stack.ts.
  void installBrandDesktopRuntime;

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  await app.whenReady();

  registerDesktopSessionIpc({
    ipcMain,
    session,
    info: {
      brandId: manifest.brandId,
      productName: manifest.client.productName,
      appKind: boot.appKind,
      metierPort: METIER_PORT,
    },
  });

  const metierChild = spawnBrandMetierApi({
    scriptPath: path.join(__dirname, "../../scripts/metier-api.mjs"),
    userDataDir: boot.userDataDir,
    port: METIER_PORT,
    log,
  });

  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    title:
      boot.appKind === "server"
        ? manifest.server.productName
        : manifest.client.productName,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      partition: boot.sessionPartition,
    },
  });

  const renderer = app.isPackaged
    ? path.join(process.resourcesPath, "renderer", "index.html")
    : path.join(__dirname, "../../resources/renderer/index.html");
  await win.loadFile(renderer);

  log(
    "nav",
    \`merged=\${navModel.items.length} brand=\${navModel.groups.find((g) => g.id === "brand")?.items.length || 0} entities=${model.entities.length} pages=${model.pages.length} setup=\${session.isSetupComplete()} metierPort=\${METIER_PORT}\`,
  );

  app.on("will-quit", () => {
    if (metierChild && !metierChild.killed) metierChild.kill("SIGTERM");
  });
}

main().catch((err) => {
  console.error(err);
  app.exit(1);
});
`;
}

export function renderPreloadFromPrdTs(m: AppManifest): string {
  return `/**
 * Preload — bridge desktop OS kit (setup / auth / connexion / apiBaseUrl).
 * Généré par creezio new-app --from-prd.
 */
import { contextBridge, ipcRenderer } from "electron";

const BRIDGE_NAME = ${JSON.stringify(m.bridgeName)};

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
  login: (payload: unknown) => ipcRenderer.invoke("auth:login", payload),
  logout: () => ipcRenderer.invoke("auth:logout"),
  getSession: () => ipcRenderer.invoke("auth:session"),
};

contextBridge.exposeInMainWorld(BRIDGE_NAME, api);
contextBridge.exposeInMainWorld("creezioDesktop", api);
`;
}
