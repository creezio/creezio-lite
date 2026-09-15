/**
 * Façade desktop marque — absorbe l'orchestration OS.
 * Profile `full` : hosts Hermes/n8n/tunnel + MCP HTTP + tasks/mails.
 * Profile `lite` : kernel + Meili seulement.
 */
import fs from "node:fs";
import path from "node:path";
import {
  guessPackagedDataDir,
  pluginsRootDir,
  resolvePackagedDataDir,
} from "@creezio/platform-core";
import {
  prepareDesktopBoot,
  writeAppKindFile,
  createDesktopSessionStore,
  registerDesktopSessionIpc,
  splashDataUrl,
} from "@creezio/electron-shell";
import {
  initLogger,
  initEarlyBootLogger,
  ensureLogsDir,
  log,
  listenBrandKernelHttp,
  ensureKitOsBinaries,
  kitBinaryPaths,
  configureCrashReporter,
  initCrashReporter,
  installEarlyCrashWriter,
  installGlobalHandlers,
  reportCrash,
  crashEndpoint,
  crashLogHint,
  crashReportsDir,
} from "@creezio/host-runtime";
import { maybeBootBrandMeili } from "@creezio/search";
import {
  createMcpFacade,
  discoverModuleToolsFromKernel,
} from "@creezio/mcp-facade";
import { configureEntityMeiliFromFeed } from "@creezio/api-kernel";
import { createNavShellAdapter } from "@creezio/shell-ui";
import {
  brandKernelBooter,
  type BrandKernelBoot,
} from "./create-brand-kernel.js";
import { composeBrandOs } from "./compose-brand-os.js";
import { listenBrandOsHttp } from "./listen-brand-os-http.js";
import {
  anyModuleMachineKeyVerifier,
  createBrandApiKeyModuleVerifier,
  createPluginDiskKeyModuleVerifier,
} from "./module-mount-auth.js";
import {
  mcpSurfaceHandlesPath,
  mountBrandMcpSurface,
} from "./mount-brand-mcp-surface.js";
import { startBrandUiPlane } from "./start-brand-ui-plane.js";
import { installBrandOsDesktop } from "./install-brand-os-desktop.js";
import {
  resolveNativeWarmFlags,
  warmBrandNativeHosts,
} from "./warm-brand-native-hosts.js";
import { createPluginAclMcpWiring } from "./plugin-acl-wiring.js";
import {
  createApiKeyBearerActorResolver,
  registerHermesHostMcpTools,
} from "./hermes-mcp-host-tools.js";
import { wireAssistantMcp } from "./wire-assistant-mcp.js";
import { createPluginProxyMount } from "./plugin-proxy-mount.js";
import {
  createPluginToolsDiscovery,
  type PluginToolsHostLike,
} from "./plugin-tools-discovery.js";
import type {
  BrandDesktopHandle,
  BootBrandKernelFn,
  StartBrandDesktopConfig,
} from "./types.js";

function resolveBootKernel(config: StartBrandDesktopConfig): BootBrandKernelFn {
  if (config.bootKernel) return config.bootKernel;
  if (config.brandMigrations && config.registerModuleApi) {
    return brandKernelBooter({
      manifest: config.manifest,
      brandMigrations: config.brandMigrations,
      registerModuleApi: config.registerModuleApi,
      beforeBoot: config.beforeBoot,
      enablePlatformServices: config.enablePlatformServices,
      // Mount `@creezio/nav` auto-enregistré dans createBrandKernel
      // (migrations brand.db + registerModuleApi("nav", …)).
      navItems: config.navItems,
      ownerPermissions: config.ownerPermissions,
      permissionGroups: config.permissionGroups,
    });
  }
  throw new Error(
    "startBrandDesktop: fournir bootKernel OU brandMigrations+registerModuleApi",
  );
}

type ElectronApp = {
  isPackaged: boolean;
  requestSingleInstanceLock: () => boolean;
  whenReady: () => Promise<void>;
  quit: () => void;
  on: (event: string, cb: () => void) => void;
  getVersion?: () => string;
  resourcesPath?: string;
  getPath?: (name: string) => string;
  setPath?: (name: string, p: string) => void;
};

/** Ancre userData sous {installDir}/data — avant crash-reporter / sqlite. */
function anchorPackagedUserData(app: ElectronApp): string | null {
  if (!app.isPackaged || typeof app.setPath !== "function") return null;
  const dataDir = resolvePackagedDataDir({
    execPath: process.execPath,
    isPackaged: true,
    env: process.env,
  });
  if (!dataDir) return null;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    ensureLogsDir(dataDir);
    fs.mkdirSync(path.join(dataDir, "crash-reports"), { recursive: true });
    app.setPath("userData", dataDir);
    return dataDir;
  } catch {
    return null;
  }
}

type ElectronIpcMain = unknown;

type ElectronBrowserWindow = new (opts: Record<string, unknown>) => {
  loadFile: (p: string) => Promise<void>;
  loadURL: (u: string) => Promise<void>;
};

async function loadElectron(): Promise<{
  app: ElectronApp;
  BrowserWindow: ElectronBrowserWindow;
  ipcMain: ElectronIpcMain;
}> {
  const mod = await import("electron");
  return mod as unknown as {
    app: ElectronApp;
    BrowserWindow: ElectronBrowserWindow;
    ipcMain: ElectronIpcMain;
  };
}

type BootSplashHandle = {
  status: (headline: string, detail: string, percent: number) => void;
  close: () => void;
};

/**
 * Fenêtre IMMÉDIATE avant tout travail lourd (parité kit `main.ts`).
 *
 * Le kernel (core.db + brand.db), la surface HTTP OS et MCP se montent avant
 * que le shell runtime ne crée sa fenêtre : sur un poste Windows froid
 * (Defender + grosse base) cela laissait plusieurs dizaines de secondes sans
 * aucune fenêtre — l'utilisateur ne voyait « rien ». Ce splash de transition
 * est remplacé par la coquille du shell runtime dès qu'elle existe.
 *
 * Opt-out : `CREEZIO_BOOT_SPLASH=0`.
 */
async function openEarlyBootSplash(
  app: ElectronApp,
  BrowserWindowCtor: ElectronBrowserWindow,
  opts: { productName: string; bridgeName: string },
): Promise<BootSplashHandle | null> {
  if (process.env.CREEZIO_BOOT_SPLASH === "0") return null;
  try {
    await app.whenReady();
    const Ctor = BrowserWindowCtor as unknown as new (
      o: Record<string, unknown>,
    ) => {
      loadURL: (u: string) => Promise<void>;
      close: () => void;
      isDestroyed: () => boolean;
      webContents: {
        isDestroyed: () => boolean;
        executeJavaScript: (code: string) => Promise<unknown>;
      };
    };
    const win = new Ctor({
      width: 860,
      height: 560,
      center: true,
      resizable: false,
      frame: false,
      show: true,
      backgroundColor: "#14182f",
      title: opts.productName,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    await win.loadURL(
      splashDataUrl({
        productName: opts.productName,
        bridgeName: opts.bridgeName,
      }),
    );
    const startedAt = Date.now();
    const status = (headline: string, detail: string, percent: number) => {
      const model = {
        headline,
        bootStartedAt: startedAt,
        overallPercent: percent,
        footer: "Préparation du poste — la fenêtre principale suit.",
        steps: [
          {
            id: "runtime",
            label: "Runtime plateforme",
            status: "running",
            detail,
            percent,
            startedAt,
            endedAt: null,
          },
        ],
      };
      try {
        if (win.isDestroyed() || win.webContents.isDestroyed()) return;
        void win.webContents
          .executeJavaScript(
            `window.__setBoot && window.__setBoot(${JSON.stringify(model)})`,
          )
          .catch(() => undefined);
      } catch {
        /* fenêtre déjà remplacée */
      }
    };
    status("Démarrage…", "Initialisation du runtime plateforme", 5);
    return {
      status,
      close: () => {
        try {
          if (!win.isDestroyed()) win.close();
        } catch {
          /* déjà fermée */
        }
      },
    };
  } catch {
    // Pas d'affichage (CI headless, harness) : le boot continue sans splash.
    return null;
  }
}

function resolveResourcesRoot(
  app: ElectronApp,
  electronDirname: string,
  resourcesRel?: string,
): string {
  if (app.isPackaged) {
    return (
      app.resourcesPath ||
      path.join(path.dirname(process.execPath), "resources")
    );
  }
  return path.join(electronDirname, resourcesRel || "../../resources");
}

export async function startBrandDesktop(
  config: StartBrandDesktopConfig,
): Promise<BrandDesktopHandle> {
  // Filet minimal AVANT toute résolution de chemins : un crash dans les
  // premières lignes du boot laisse au moins un JSON early-*.json à côté de
  // l'exécutable ({dirname(execPath)}/data/crash-reports/).
  installEarlyCrashWriter();

  const manifest = config.manifest;
  const logBasename = config.logBasename || manifest.logBasename;

  // Ultra-early : {install}/data/logs si arbre packagé détecté, sinon early-logs/tmpdir.
  const guessedData = guessPackagedDataDir({ execPath: process.execPath });
  const early = initEarlyBootLogger({
    basename: logBasename,
    userDataDir: guessedData,
    exePath: process.execPath,
  });

  const { app, BrowserWindow, ipcMain } = await loadElectron();
  const __dirname = config.electronDirname;
  const desktopProfile = config.desktopProfile || "full";
  // P&P : runtime kit par défaut (splash/tray/embeds). Opt-out = "window".
  const desktopShell = config.desktopShell || "runtime";

  // 1) Ancrer userData sous {installDir}/data AVANT crash-reporter / sqlite.
  const anchored =
    anchorPackagedUserData(app as ElectronApp) ||
    (() => {
      try {
        return typeof app.getPath === "function" ? app.getPath("userData") : "";
      } catch {
        return "";
      }
    })();

  // 2) Crash reporter + logger sur le vrai chemin (install/data).
  const prefix = manifest.envPrefix;
  const crashEp =
    (config.crashEndpoint || "").trim() ||
    (process.env[`${prefix}_CRASH_ENDPOINT`] || "").trim() ||
    (process.env.CREEZIO_CRASH_ENDPOINT || "").trim() ||
    "";
  configureCrashReporter({
    brandId: manifest.brandId,
    endpointEnvKey: `${prefix}_CRASH_ENDPOINT`,
    defaultEndpoint: crashEp || "http://127.0.0.1/crash-disabled",
  });
  installGlobalHandlers();
  if (anchored) {
    initEarlyBootLogger({
      basename: logBasename,
      userDataDir: anchored,
      exePath: process.execPath,
    });
    initCrashReporter(
      anchored,
      process.env.npm_package_version || app.getVersion?.() || "0.0.0",
    );
    log(
      "boot",
      `userData=${anchored} layout=${app.isPackaged ? "install-data" : "dev"}`,
    );
  } else if (early.logFile) {
    log("early", `log=${early.logFile} source=${early.source}`);
  }

  try {
    return await startBrandDesktopBody({
      config,
      app,
      BrowserWindow,
      ipcMain,
      manifest,
      __dirname,
      desktopProfile,
      desktopShell,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    reportCrash("boot-failure", {
      step: "startBrandDesktop",
      message,
      stack: e instanceof Error ? e.stack : undefined,
      logHint: crashLogHint(),
      earlyLog: early.logFile || null,
      earlySource: early.source,
      userData: anchored || null,
    });
    try {
      const electronMod = (await import("electron")) as unknown as {
        dialog?: { showErrorBox?: (title: string, content: string) => void };
      };
      const product =
        manifest.server?.productName ||
        manifest.client?.productName ||
        manifest.brandId;
      const dataHint =
        anchored ||
        guessedData ||
        path.join(path.dirname(process.execPath), "data");
      electronMod.dialog?.showErrorBox?.(
        `${product} — démarrage impossible`,
        `${message}\n\n` +
          `Journal : ${crashLogHint() || path.join(dataHint, "logs")}\n` +
          `Rapports : ${crashReportsDir() || path.join(dataHint, "crash-reports")}\n` +
          `Données : ${dataHint}\n` +
          `\nUn rapport a été enregistré localement et envoyé au support si le réseau est disponible.`,
      );
    } catch {
      /* headless / dialog indisponible */
    }
    throw e;
  }
}

async function startBrandDesktopBody(args: {
  config: StartBrandDesktopConfig;
  app: ElectronApp;
  BrowserWindow: ElectronBrowserWindow;
  ipcMain: ElectronIpcMain;
  manifest: StartBrandDesktopConfig["manifest"];
  __dirname: string;
  desktopProfile: "full" | "lite";
  desktopShell: "runtime" | "window";
}): Promise<BrandDesktopHandle> {
  const {
    config,
    app,
    BrowserWindow,
    ipcMain,
    manifest,
    __dirname,
    desktopProfile,
    desktopShell,
  } = args;

  // Binaires OS kit (Meili/cloudflared) : leur téléchargement ne doit jamais
  // retarder la création du shell/splash. Les launchers vérifient eux-mêmes
  // leur présence et basculent en mode dégradé si nécessaire.
  if (process.env.CREEZIO_SKIP_KIT_BINARIES !== "1") {
    void ensureKitOsBinaries()
      .then((bins) => {
        if (!bins.ok) {
          console.warn(
            `[creezio-os] binaires kit incomplets: ${bins.errors.join("; ") || "meili/cloudflared manquants"}`,
          );
        }
      })
      .catch((e) =>
        console.warn(
          `[creezio-os] téléchargement binaires différé: ${e instanceof Error ? e.message : e}`,
        ),
      );
  }

  const resourcesPath =
    typeof (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ===
    "string"
      ? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || ""
      : "";
  const boot = await prepareDesktopBoot(manifest, {
    appKindDirs: [
      __dirname,
      path.dirname(process.execPath),
      path.join(resourcesPath, "app"),
      path.join(resourcesPath, "build", "electron"),
    ],
  });
  // Segment server/client : logs/ dès le premier setPath (pas attendre whenReady).
  try {
    ensureLogsDir(boot.userDataDir);
  } catch {
    /* best-effort */
  }
  initLogger(boot.userDataDir, config.logBasename || manifest.logBasename);
  // Ré-init sur le vrai userData (server vs client peuvent différer).
  initCrashReporter(
    boot.userDataDir,
    process.env.npm_package_version || app.getVersion?.() || "0.0.0",
  );
  log(
    "boot",
    `kind=${boot.appKind} product=${manifest.client.productName} facade=startBrandDesktop profile=${desktopProfile} shell=${desktopShell} crashUpload=${/crash-disabled/i.test(crashEndpoint()) ? "off" : "on"} kitBin=${JSON.stringify(kitBinaryPaths())}`,
  );

  writeAppKindFile(
    __dirname,
    boot.appKind === "legacy" ? "client" : boot.appKind,
  );

  const session = createDesktopSessionStore({
    userDataDir: boot.userDataDir,
    manifest,
  });

  /*
   * Client thin (kind=client → requireRemoteProfile) : AUCUNE stack locale.
   * Pas de kernel SQLite, pas de HTTP OS, pas de MCP/Meili/tunnel : le shell
   * runtime affiche le picker Rejoindre puis setupAndStartRemote() charge le
   * CRM du serveur distant (cookie session sur l'origin remote) et démarre le
   * bridge computer-use en auth session. Les hosts composés restent lazy et la
   * garde allowLocalStack du runtime interdit tout démarrage local.
   */
  const bootBehavior = boot.bootBehavior as {
    requireRemoteProfile?: boolean;
    allowLocalStack?: boolean;
  } | null;
  if (desktopShell === "runtime" && bootBehavior?.requireRemoteProfile) {
    const resourcesRootThin = resolveResourcesRoot(
      app,
      __dirname,
      config.resourcesRel,
    );
    const osThin = composeBrandOs({
      manifest,
      userDataDir: boot.userDataDir,
      isPackaged: app.isPackaged,
      resourcesRoot: resourcesRootThin,
      electronDirname: __dirname,
      ...(config.pluginsFeatureOff !== undefined
        ? { pluginsFeatureOff: config.pluginsFeatureOff }
        : {}),
      ...(config.crashEndpoint ? { crashEndpoint: config.crashEndpoint } : {}),
    });
    const closeThin = async () => {
      osThin.close();
    };
    const gotLockThin = app.requestSingleInstanceLock();
    if (!gotLockThin) {
      await closeThin();
      app.quit();
      return {
        baseUrl: "",
        port: 0,
        searchEngine: "off",
        desktopProfile,
        close: closeThin,
      };
    }
    const electronModThin = await import("electron");
    installBrandOsDesktop({
      manifest,
      os: osThin,
      appKind: boot.appKind,
      bootBehavior: boot.bootBehavior,
      bootProfileLaunch: boot.profileLaunch,
      sessionPartition: boot.sessionPartition,
      electron: electronModThin as unknown as Parameters<
        typeof installBrandOsDesktop
      >[0]["electron"],
      bootBrandRuntime: async () => {
        throw new Error(
          "client thin (requireRemoteProfile) : stack locale interdite",
        );
      },
      shutdownBrandRuntime: closeThin,
    });
    log(
      "boot",
      "client thin remote-only : kernel/OS-HTTP/MCP/Meili/tunnel locaux SKIPPÉS (requireRemoteProfile)",
    );
    app.on("will-quit", () => {
      void closeThin();
    });
    return {
      baseUrl: "",
      port: 0,
      searchEngine: "off",
      desktopProfile,
      close: closeThin,
    };
  }

  // Fenêtre AVANT le travail lourd (parité kit) : le kernel SQLite, la surface
  // HTTP OS et MCP prennent des dizaines de secondes sur un poste Windows
  // froid. Remplacée par la coquille du shell runtime (installBrandOsDesktop).
  const bootSplash =
    desktopShell === "runtime"
      ? await openEarlyBootSplash(app, BrowserWindow, {
          productName:
            boot.appKind === "server"
              ? manifest.server.productName
              : manifest.client.productName,
          bridgeName: manifest.bridgeName,
        })
      : null;

  const bootKernel = resolveBootKernel(config);
  bootSplash?.status(
    "Base de données…",
    "Migrations core + brand (SQLite)",
    15,
  );
  const kernelBoot = bootKernel({
    userDataDir: boot.userDataDir,
    isPackaged: app.isPackaged,
  }) as BrandKernelBoot;
  const { api, runtime, close: closeKernel, mails } = kernelBoot;
  process.env.CREEZIO_CORE_DB_PATH = runtime.paths.core;
  // Chemin brand exposé aux hosts marque (import catalogue, outils Node).
  process.env.CREEZIO_BRAND_DB_PATH = runtime.paths.brand;

  const resourcesRoot = resolveResourcesRoot(
    app,
    __dirname,
    config.resourcesRel,
  );

  let os = null as ReturnType<typeof composeBrandOs> | null;
  // Host plugins actif (compose) — découverte tools MCP + mounts proxy.
  const pluginsHostGetter = (): PluginToolsHostLike | null => {
    if (!os) return null;
    try {
      if (os.status().hosts.plugins !== "enabled") return null;
      return os.hostStack.hostPlugins() as PluginToolsHostLike;
    } catch {
      return null;
    }
  };
  if (desktopProfile === "full") {
    os = composeBrandOs({
      manifest,
      userDataDir: boot.userDataDir,
      isPackaged: app.isPackaged,
      resourcesRoot,
      electronDirname: __dirname,
      ...(config.pluginsFeatureOff !== undefined
        ? { pluginsFeatureOff: config.pluginsFeatureOff }
        : {}),
      // P5 : plugins livrés par la marque (`<appRoot>/plugins/<id>/`,
      // électron compilé sous <appRoot>/build/electron) — install au boot.
      pluginSeedDirs: [path.resolve(__dirname, "..", "..", "plugins")],
      // P3 : mount proxy /api/v1/plugins/<id> pendant la vie du sidecar.
      pluginHostHooks: {
        onPluginStarted: (p) => {
          // DB plugin/<id> ouverte (isolation H2 — ctx.db scopé du mount).
          try {
            runtime.openPlugin(p.id);
          } catch {
            /* DB plugin optionnelle */
          }
          api.registerPluginApi(
            p.id,
            createPluginProxyMount({
              pluginId: p.id,
              getPort: () =>
                pluginsHostGetter()
                  ?.getRunningPlugins()
                  .find((r) => r.id === p.id)?.port ?? null,
            }),
          );
        },
        onPluginStopped: (id) => {
          api.unregisterPluginApi(id);
          try {
            runtime.closePlugin(id);
          } catch {
            /* déjà fermée */
          }
        },
      },
      ...(config.catalogHost ? { catalogHost: config.catalogHost } : {}),
      ...(config.crashEndpoint ? { crashEndpoint: config.crashEndpoint } : {}),
    });
  }

  let searchEngine: BrandDesktopHandle["searchEngine"] = "off";
  let meiliStop: (() => void) | null = null;

  if (config.meiliFeed) {
    configureEntityMeiliFromFeed(config.meiliFeed);
  }

  // Le shell runtime démarre Meili depuis le splash. Le faire ici aussi
  // produisait un second spawn pré-UI et réintroduisait un chemin legacy.
  if (config.meiliFeed && desktopShell !== "runtime") {
    // P&P : binaire kit d'abord (resources/bin/meili), jamais requis dans la marque.
    const kitMeili = kitBinaryPaths().meili;
    const meiliCandidates = [
      kitMeili,
      process.platform === "win32"
        ? path.join(resourcesRoot, "bin", "meilisearch-win.exe")
        : path.join(resourcesRoot, "bin", "meili"),
      // Compatibilité avec les anciens stages Windows.
      ...(process.platform === "win32"
        ? [
            path.join(resourcesRoot, "bin", "meili.exe"),
            path.join(resourcesRoot, "meili.exe"),
          ]
        : [path.join(resourcesRoot, "meili")]),
    ];
    const meiliBin = meiliCandidates.find(
      (candidate): candidate is string =>
        typeof candidate === "string" && fs.existsSync(candidate),
    );
    try {
      const meiliBoot = await maybeBootBrandMeili({
        binaryPath: meiliBin || null,
        dataDir: path.join(boot.userDataDir, "meili"),
        userDataDir: boot.userDataDir,
        dbPath: runtime.getBrand().path,
        feed: config.meiliFeed,
        log: (line) => log("meili", line),
        // Réindexation complète possiblement longue (bump schemaVersion) :
        // jamais bloquante pour l'ouverture de la fenêtre.
        backgroundIndex: true,
      });
      searchEngine = meiliBoot.engine;
      if (meiliBoot.meili) {
        meiliStop = () => meiliBoot.meili?.stop();
      }
    } catch (err) {
      // Meili core fail-closed : binaire absent / start KO avec un feed
      // indexé = échec de boot explicite (comme une DB absente).
      if ((err as { code?: string })?.code === "MEILI_REQUIRED") throw err;
      log(
        "meili",
        `boot skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      searchEngine = "off";
    }
  }

  // P2 : tools plugins découverts par défaut + ACL Product Hub fail-closed.
  const discoverPluginTools = createPluginToolsDiscovery({
    pluginsHost: pluginsHostGetter,
  });
  const aclWiring = createPluginAclMcpWiring({
    getPolicy: kernelBoot.getPluginAclPolicy,
  });
  // H1 « Hermes cerveau unique » — Bearer opaque (clé CRM service Hermes)
  // vérifié contre `api_keys` et mappé owner (voir hermes-mcp-host-tools.ts).
  // Owner résolu via getTasksBrandConfig (applyBrandPlatformBindings marque).
  const resolveBearerActor = createApiKeyBearerActorResolver({
    getBrandDb: () => {
      try {
        return runtime.getBrand() as unknown as {
          prepare(sql: string): { get(...args: unknown[]): unknown };
        };
      } catch {
        return null;
      }
    },
  });
  const mcp = createMcpFacade({
    brandId: manifest.brandId,
    allowUnauthenticated: true,
    // Secret posé par composeBrandOs (ensureMcpJwtSecret) — acteurs JWT réels.
    jwtSecret: process.env.MCP_JWT_SECRET || null,
    resolveBearerActor,
    listApiMounts: () => api.listMounts(),
    authorizeToolCall: aclWiring.authorizeToolCall,
    filterPluginToolsForActor: aclWiring.filterPluginToolsForActor,
    discoverToolsBySpace: async () => {
      const health = api
        .listMounts()
        .filter((m) => m.space === "module")
        .map((m) => ({
          name: `module.${m.id}.health`,
          description: `Health module ${m.id}`,
          space: "module" as const,
          ownerId: m.id,
          handler: async () => ({
            ok: true,
            content: { module: m.id },
          }),
        }));
      const brandTools = config.discoverModuleTools
        ? await config.discoverModuleTools(api)
        : [];
      return {
        module: discoverModuleToolsFromKernel(api, [...health, ...brandTools]),
        plugin: discoverPluginTools(),
      };
    },
  });
  mcp.registerTool({
    name: "module.platform.list_mounts",
    description: "Liste les mounts API kernel",
    space: "module",
    ownerId: "platform",
    handler: async () => ({
      ok: true,
      content: { mounts: api.listMounts() },
    }),
  });
  // Assistant chat découvre les tools métier via MCP.
  wireAssistantMcp(mcp);
  // H1/H4 — tools host tasks + workspace pour Hermes (gate acteur interne).
  registerHermesHostMcpTools({ mcp, log: (line) => log("mcp", line) });
  if (os) {
    mcp.registerTool({
      name: "module.os.status",
      description: "Statut hosts OS Creezio (Hermes/n8n/tunnel)",
      space: "module",
      ownerId: "os",
      handler: async () => ({ ok: true, content: os!.status() }),
    });
  }

  let mcpSurface: ReturnType<typeof mountBrandMcpSurface> | null = null;
  bootSplash?.status("Services plateforme…", "API locale + façade MCP", 45);
  const httpServer =
    desktopProfile === "full"
      ? await listenBrandOsHttp({
          api,
          mcp,
          os,
          getMailsStore: () => mails ?? null,
          // Clé machine acceptée sur /api/v1/modules/* : clé API brand
          // (table api_keys) ou clé service plugin sur disque.
          moduleMountMachineKey: anyModuleMachineKeyVerifier(
            createBrandApiKeyModuleVerifier(() => runtime.getBrand()),
            createPluginDiskKeyModuleVerifier(() =>
              pluginsRootDir(boot.userDataDir),
            ),
          ),
          mcpSurfaceFetch: async (request) => {
            if (!mcpSurface) {
              return new Response(
                JSON.stringify({ error: "mcp_surface_pending" }),
                {
                  status: 503,
                  headers: { "content-type": "application/json" },
                },
              );
            }
            return mcpSurface.app.fetch(request);
          },
          mcpSurfaceHandlesPath,
        })
      : await listenBrandKernelHttp({ api });
  process.env.METIER_BASE_URL = httpServer.baseUrl;
  process.env.MCP_PUBLIC_URL = httpServer.baseUrl;
  process.env.APP_PUBLIC_URL = httpServer.baseUrl;
  if (os && desktopProfile === "full") {
    mcpSurface = mountBrandMcpSurface({
      manifest,
      runtime,
      os,
      mcp,
      publicBaseUrl: () => httpServer.baseUrl,
      listKernelMounts: () => api.listMounts(),
      listKernelOperations: () => api.listOperations(),
    });
    log(
      "mcp",
      `oauth ready=${mcpSurface.oauthReady()} public=${mcpSurface.publicUrl()}`,
    );
  }

  // Fullstack natif kit (n8n + Hermes) — flags indépendants.
  // shell=runtime : le splash (installBrandOsDesktop) ensure/start n8n+Hermes
  // avec UI — un warm bloquant ICI laisse l'utilisateur sans fenêtre ("rien").
  const skipWarmForRuntimeShell =
    desktopShell === "runtime" && process.env.CREEZIO_NATIVE_WARM !== "1";
  const warmFlags = resolveNativeWarmFlags();
  if (
    os &&
    desktopProfile === "full" &&
    (warmFlags.n8n || warmFlags.hermes) &&
    !skipWarmForRuntimeShell
  ) {
    const warm = await warmBrandNativeHosts(os, {
      start: process.env.CREEZIO_NATIVE_START !== "0",
      n8n: warmFlags.n8n,
      hermes: warmFlags.hermes,
    });
    log(
      "native",
      `warm n8n.started=${warm.n8n.started} entry=${warm.n8n.entry} hermes.started=${warm.hermes.started} binary=${warm.hermes.binary}`,
    );
  } else if (skipWarmForRuntimeShell && os && desktopProfile === "full") {
    log(
      "native",
      "warm différé au shell runtime (splash) — pas de blocage pré-UI",
    );
  }

  if (os && desktopProfile === "full" && process.env.CREEZIO_TUNNEL_LOCAL !== "0") {
    const tunnel = os.hostRuntime.tunnelService() as unknown as {
      enableLocalPublicSurface: (o: {
        localPort: number;
        slug?: string;
      }) => { publicMcp: string };
    };
    const local = tunnel.enableLocalPublicSurface({
      localPort: httpServer.port,
      slug: manifest.brandId,
    });
    log("tunnel", `surface locale mcp=${local.publicMcp}`);
  }

  const navShell = createNavShellAdapter();
  if (config.navItems?.length) {
    navShell.registerBrandNav(config.navItems);
  }
  navShell.registerBrandNav([
    { id: "os.setup", label: "Setup", href: "/setup", group: "core" },
    { id: "os.login", label: "Login", href: "/login", group: "core" },
    { id: "os.taches", label: "Tâches", href: "/taches", group: "core" },
    { id: "os.mails", label: "Mails", href: "/mails", group: "core" },
    { id: "os.granola", label: "Granola", href: "/granola", group: "core" },
    { id: "os.grokbot", label: "GrokBot", href: "/grokbot", group: "core" },
    {
      id: "os.developers",
      label: "Developers",
      href: "/developers",
      group: "core",
    },
  ]);
  const navModel = navShell.getRenderModel();

  // Le shell runtime démarre son serveur Next après l'affichage du splash.
  // Pré-démarrer un second plan UI ici retardait la première fenêtre jusqu'au
  // timeout Next puis basculait inutilement vers la SPA.
  const uiPlane =
    desktopShell === "runtime"
      ? {
          kind: "spa" as const,
          baseUrl: null,
          child: null,
          close: async () => undefined,
        }
      : await startBrandUiPlane({
          appRoot: path.resolve(__dirname, "../.."),
          metierBaseUrl: httpServer.baseUrl,
        });

  const cleanup = async () => {
    bootSplash?.close();
    meiliStop?.();
    await uiPlane.close();
    await httpServer.close();
    os?.close();
    closeKernel();
  };

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    await cleanup();
    app.quit();
    return {
      baseUrl: httpServer.baseUrl,
      port: httpServer.port,
      searchEngine,
      desktopProfile,
      close: cleanup,
    };
  }

  // Shell runtime prod (splash/tray/embeds) — hosts déjà composés dans le kit.
  if (desktopShell === "runtime" && os) {
    const electronMod = await import("electron");
    // La coquille du shell runtime prend le relais immédiatement.
    bootSplash?.close();
    installBrandOsDesktop({
      manifest,
      os,
      appKind: boot.appKind,
      bootBehavior: boot.bootBehavior,
      bootProfileLaunch: boot.profileLaunch,
      sessionPartition: boot.sessionPartition,
      electron: electronMod as unknown as Parameters<
        typeof installBrandOsDesktop
      >[0]["electron"],
      // Le shell runtime démarre lui-même le CRM Next (host server-launcher,
      // health 120 s) : le plan UI de cette façade n'est pas utilisé ici.
      bootBrandRuntime: async () => ({
        ok: true,
        metierBaseUrl: httpServer.baseUrl,
        ui: "next-runtime",
        uiBaseUrl: null,
      }),
      shutdownBrandRuntime: cleanup,
    });
    log(
      "nav",
      `shell=runtime mounts=${api.listMounts().length} os=full ui=next-runtime api=${httpServer.baseUrl}`,
    );
    app.on("will-quit", () => {
      void cleanup();
    });
    return {
      baseUrl: httpServer.baseUrl,
      port: httpServer.port,
      searchEngine,
      desktopProfile,
      close: cleanup,
    };
  }

  await app.whenReady();

  registerDesktopSessionIpc({
    ipcMain: ipcMain as Parameters<typeof registerDesktopSessionIpc>[0]["ipcMain"],
    session,
    info: {
      brandId: manifest.brandId,
      productName: manifest.client.productName,
      appKind: boot.appKind,
      metierPort: httpServer.port,
    },
  });

  const win = new BrowserWindow({
    width: config.window?.width ?? 1180,
    height: config.window?.height ?? 760,
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

  if (uiPlane.kind === "next" && uiPlane.baseUrl) {
    await win.loadURL(uiPlane.baseUrl);
  } else {
    const renderer = path.join(resourcesRoot, "renderer", "index.html");
    await win.loadFile(renderer);
  }

  const mounts = api.listMounts();
  const mcpTools = await mcp.listTools();
  log(
    "nav",
    `merged=${navModel.items.length} mounts=${mounts.length} mcp=${mcpTools.tools.length} os=${desktopProfile} ui=${uiPlane.kind} shell=${desktopShell} setup=${session.isSetupComplete()} api=${httpServer.baseUrl} search=${searchEngine}`,
  );

  app.on("will-quit", () => {
    void cleanup();
  });

  return {
    baseUrl: httpServer.baseUrl,
    port: httpServer.port,
    searchEngine,
    desktopProfile,
    close: cleanup,
  };
}
