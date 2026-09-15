/**
 * Couche supérieure : installBrandDesktopRuntime derrière la façade.
 * Hosts = composeBrandOs (kit). Vertical = adaptateurs kit + no-op métier.
 */
import path from "node:path";
import {
  AssistantChromeOverlay,
  createLocalSplashSteps,
  errorPageDataUrl,
  installBrandDesktopRuntime,
  instrumentWebContents,
  profilePickerHtml,
  type BrandDesktopDeps,
} from "@creezio/electron-shell";
import {
  AiScreencaster,
  AiWorkspaceManager,
  BridgeClient,
  executeAiWorkspaceAction,
  getBootStage,
  getBootTimeline,
  initCrashReporter,
  installGlobalHandlers,
  isAiWorkspaceActionType,
  reportCrash,
  reportCrashDebounced,
  setBootStage,
} from "@creezio/host-runtime";
import type {
  SupplierTabManager,
  SupplierTabManagerOptions,
} from "@creezio/electron-shell/browser-tabs";

/**
 * browser-tabs chargé LAZY (jamais au top-level) : le module tire `electron`
 * (WebContentsView) et casserait les gates kit Node qui importent app-runtime.
 * Même pattern dual ESM/CJS que `loadElectron` (eval pour rester compilable).
 */
type BrowserTabsModule = typeof import("@creezio/electron-shell/browser-tabs");
let browserTabsModule: BrowserTabsModule | null = null;
function loadBrowserTabs(): BrowserTabsModule {
  if (browserTabsModule) return browserTabsModule;
  let req: NodeRequire | null = null;
  try {
    // eslint-disable-next-line no-eval
    req = eval("require") as NodeRequire; // CJS
  } catch {
    // ESM : import.meta est interdit dans eval (SyntaxError). Ne PAS parser
    // la stack pour retrouver l'URL du module : les frames Windows
    // (`file:///C:/…`) contiennent un ':' de lettre de lecteur qui casse tout
    // regex naïf (crash « stack sans file:// » sur client packagé Windows).
    // createAppRequire est l'ancrage asar-safe canonique du kit.
    req = createAppRequire();
  }
  browserTabsModule = req(
    "@creezio/electron-shell/browser-tabs",
  ) as BrowserTabsModule;
  return browserTabsModule;
}
import {
  assertProfileReady,
  buildEmbedEnvPanel,
  createAppRequire,
  consumeInstallerPrefsFile,
  hermesPublicStatus,
  isEmbedEnvService,
  n8nPublicStatus,
  resolveBootProfile,
  sanitizeConnectionProfile,
  sanitizeHermesEmbedConfig,
  sanitizeN8nEmbedConfig,
  shouldSpawnEmbeddedHermes,
  shouldSpawnEmbeddedN8n,
  testRemoteHealth,
} from "@creezio/platform-core";
import type { AppManifest } from "@creezio/brand-config";
import type { BrandOsComposition } from "./compose-brand-os.js";

export type InstallBrandOsDesktopOptions = {
  manifest: AppManifest;
  os: BrandOsComposition;
  electron: BrandDesktopDeps["electron"];
  appKind: string;
  bootBehavior: unknown;
  bootProfileLaunch: unknown;
  sessionPartition: string;
  /** Callback boot métier (kernel HTTP / Next déjà géré hors runtime). */
  bootBrandRuntime?: () => Promise<unknown>;
  shutdownBrandRuntime?: () => Promise<void>;
};

/**
 * Installe le runtime desktop prod (splash/tray/embeds) avec hosts kit.
 * Ne crée pas de fichiers host-stack dans la marque.
 */
export function installBrandOsDesktop(
  opts: InstallBrandOsDesktopOptions,
): void {
  const m = opts.manifest;
  const product = m.client.productName;
  const accent = "#0f3d32";
  const cssPrefix = m.brandId.slice(0, 2) || "cz";
  const stack = opts.os.hostStack;
  const paths = opts.os.paths;

  const errorBrand = {
    productName: product,
    bridgeName: m.bridgeName,
    accent,
    cssPrefix,
  };
  const pickerBrand = {
    productName: product,
    bridgeName: m.bridgeName,
    tunnelRootDomain: m.tunnelRootDomain || "localhost",
    deepLinkScheme: m.deepLinkProtocol,
    accent,
    cssPrefix,
  };
  const assistantBrand = {
    productName: product,
    assistantProtocol: `${m.deepLinkProtocol}-assistant`,
    accent,
  };

  installBrandDesktopRuntime({
    manifest: m,
    bridgeName: m.bridgeName,
    accentColor: accent,
    cssPrefix,
    envPrefix: m.envPrefix,
    sessionCookieName: `${m.brandId}_session`,
    profileArgPrefix: m.envPrefix.toLowerCase(),
    defaultDesktopPort: 18790,
    appKind: opts.appKind,
    bootBehavior: opts.bootBehavior,
    bootProfileLaunch: opts.bootProfileLaunch,
    sessionPartition: opts.sessionPartition,
    deepLinkProtocol: m.deepLinkProtocol,
    store: () => opts.os.store,
    hosts: {
      catalog: () => stack.hostCatalog(),
      factoryReset: () => stack.hostFactoryReset(),
      fleetAgent: () => stack.hostFleetAgent(),
      fleetSamples: () => stack.hostFleetSamples(),
      hermes: () => stack.hostHermes(),
      hermesCrmKey: () => stack.hostHermesCrmKey(),
      hermesSeed: () => stack.hostHermesSeed(),
      meili: () => stack.hostMeili(),
      meiliCoherence: () => stack.hostMeiliCoherence(),
      n8n: () => stack.hostN8n(),
      nodeRuntime: () => stack.hostNodeRuntime(),
      pluginAccept: () => stack.hostPluginAccept(),
      pluginControl: () => stack.hostPluginControl(),
      pluginRuntime: () => stack.hostPluginRuntime(),
      pluginTests: () => stack.hostPluginTests(),
      plugins: () => stack.hostPlugins(),
      server: () => stack.hostServer(),
      tunnel: () => stack.hostTunnel(),
    },
    paths: {
      userDataDir: paths.userDataDir,
      isPackaged: paths.isPackaged,
      resourcesRoot: paths.resourcesRoot,
      dbPath: paths.dbPath,
      meiliDataDir: paths.meiliDataDir,
      nodeBinary: paths.nodeBinary,
      nodeScript: paths.nodeScript,
      nodeModulesPathForScripts: paths.nodeModulesPathForScripts,
      preloadPath: paths.preloadPath,
    },
    vertical: {
      instrumentWebContents,
      googleLoginLoopback: async () => ({ ok: false, detail: "not_configured" }),
      checkLicense: async () => ({ ok: true, licensed: true }),
      parseJoinDeepLink: () => null,
      assertProfileReady,
      resolveBootProfile,
      sanitizeConnectionProfile,
      // Sonde réelle — le client thin (Rejoindre) doit joindre le serveur.
      testRemoteHealth: (url: string, timeoutMs?: number) =>
        testRemoteHealth(url, timeoutMs),
      hermesPublicStatus,
      sanitizeHermesEmbedConfig,
      shouldSpawnEmbeddedHermes,
      n8nPublicStatus,
      sanitizeN8nEmbedConfig,
      shouldSpawnEmbeddedN8n,
      buildEmbedEnvPanel,
      isEmbedEnvService,
      portFromLocalUrl: (url: string) => {
        try {
          return Number(new URL(url).port) || null;
        } catch {
          return null;
        }
      },
      // Onglets sites externes réels (kit browser-tabs) : partitions
      // Chromium persistantes par site — owner ET espaces IA (prefix).
      createSupplierTabs: (
        win: ConstructorParameters<typeof SupplierTabManager>[0],
        view: ConstructorParameters<typeof SupplierTabManager>[1],
        o?: SupplierTabManagerOptions,
      ) => new (loadBrowserTabs().SupplierTabManager)(win, view, o),
      createAiWorkspaces: (
        win: ConstructorParameters<typeof AiWorkspaceManager>[0],
        view: ConstructorParameters<typeof AiWorkspaceManager>[1],
        tabs: ConstructorParameters<typeof AiWorkspaceManager>[2],
        o: ConstructorParameters<typeof AiWorkspaceManager>[3],
      ) => new AiWorkspaceManager(win, view, tabs, o),
      createAssistantChrome: (
        win: ConstructorParameters<typeof AssistantChromeOverlay>[0],
        onOpen: ConstructorParameters<typeof AssistantChromeOverlay>[1],
      ) => new AssistantChromeOverlay(win, onOpen, assistantBrand),
      createBridgeClient: (o: ConstructorParameters<typeof BridgeClient>[0]) =>
        new BridgeClient(o),
      createAiScreencaster: (
        o: ConstructorParameters<typeof AiScreencaster>[0],
      ) => new AiScreencaster(o),
      executeSupplierAction: (
        manager: SupplierTabManager,
        req: Parameters<BrowserTabsModule["executeSupplierAction"]>[1],
        hooks?: Parameters<BrowserTabsModule["executeSupplierAction"]>[2],
      ) => loadBrowserTabs().executeSupplierAction(manager, req, hooks),
      executeAiWorkspaceAction,
      isAiWorkspaceActionType,
      errorPageDataUrl: (title: string, message: string) =>
        errorPageDataUrl(errorBrand, title, message),
      profilePickerHtml: (o: Parameters<typeof profilePickerHtml>[1]) =>
        profilePickerHtml(pickerBrand, o),
      consumeInstallerPrefsFile,
      bootBrandRuntime:
        opts.bootBrandRuntime ||
        (async () => ({ ok: true, kit: true })),
      shutdownBrandRuntime:
        opts.shutdownBrandRuntime || (async () => undefined),
      getActiveBrandRuntime: () => null,
      parseProfileArgv: () => ({ mode: "server" }),
      profileArgFor: () => [],
      profileUserDataDir: () => null,
      isAllowedServerCockpitPath: () => true,
      initCrashReporter,
      installGlobalHandlers,
      reportCrash,
      reportCrashDebounced,
      getBootTimeline,
      getBootStage,
      setBootStage,
    },
    createLocalSplashSteps: (o) =>
      createLocalSplashSteps({
        needIndex: true,
        needNode: o.needNode,
        needHermes: o.needHermes,
        needN8n: o.needN8n,
        needTunnel: o.needTunnel,
        catalogLabel: "Catalogue",
        nodeLabel: `Runtime Node ${product}`,
        includeRuntime: true,
        runtimeLabel: "Runtime plateforme",
      }),
    electron: opts.electron,
  });
}

/** Chemin preload marque. */
export function brandPreloadPath(electronDirname: string): string {
  return path.join(electronDirname, "preload.js");
}
