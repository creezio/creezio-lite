/**
 * Lazy host-stack marque — composition mince du kit (O7).
 * Remplace ~220 LOC dupliqués marques par une factory + table de config.
 */

import path from "node:path";
import { spawn } from "node:child_process";
import type { AppManifest } from "@creezio/brand-config";
import { factoryResetTargets } from "@creezio/platform-core";
import { wipeLocalUserData } from "./factory-reset-runtime.js";
import { lazyHost } from "./host-stack.js";
import { applyOsSandboxEnv } from "./sandbox/embed-sandbox.js";
import { startMeili } from "@creezio/search";
import { findFreePort, startBrandNextServer } from "./server-launcher.js";
import { buildIsolatedNodeEnv } from "./node-runtime.js";
import {
  crashEndpoint,
  getInstallId,
  reportCrash,
} from "./crash-reporter.js";
import {
  configureMeiliCoherencePaths,
  decideMeiliReady,
  INDEX_SCHEMA_VERSION,
} from "@creezio/search";
import { createFeatureOffHost } from "./feature-off-host.js";
import { loadElectron } from "./load-electron.js";

export type BrandHostPathsModule = {
  dbPath: () => string;
  assistantDbPath: () => string;
  uploadsDir: () => string;
  nextServerEntry: () => string;
  nodeBinary: () => string;
  nodeScript: (rel: string) => string;
  nodeModulesPathForScripts?: () => string | null | undefined;
  meiliDataDir: () => string;
  meiliBinary: () => string;
  userDataDir: () => string;
  isPackaged: () => boolean;
  resourcesRoot: () => string;
};

export type BrandLocalConfigStoreLike = {
  ensureAuthSecret: () => string;
  ensureMcpJwtSecret: () => string;
  getLocalAuth: () => { authUser: string; authPassword: string } | null;
  getLlmKeys: () => Record<string, string | undefined>;
  isSetupComplete: () => boolean;
};

export type BrandHostStackConfig = {
  ensureN2Configured: () => void;
  getManifest: () => AppManifest;
  getStore: () => BrandLocalConfigStoreLike;
  getPaths: () => BrandHostPathsModule;
  portEnvKey: string;
  defaultPort?: number;
  /** Préfixe env crash/install/version : kit | CERTIVAN | FIDU */
  envPrefix: string;
  includeFleetOpsDirs?: boolean;
  extraEnv?: (ctx: {
    appVersion: string;
    userDataDir: string;
    appUserData: string;
  }) => Record<string, string>;
  getHermesHost: () => unknown;
  getHermesCrmKeySurface: () => unknown;
  getN8nHost: () => unknown;
  getTunnelService: () => unknown;
  getFleetAgent?: () => unknown;
  getFleetSamples?: () => unknown;
  getNodeRuntime: () => Record<string, unknown>;
  getHermesSeed: () => unknown;
  /** `kit` = decideMeiliReady ; sinon getter module marque. */
  meiliCoherence: "kit" | (() => unknown);
  getCatalog: () => unknown;
  /**
   * Si true : ensureCatalogPresent = present si DB existe, sinon seed no-op
   * (Fidu — pas de catalogue distant). `getCatalog` doit exposer
   * RateEstimator / formatEta / ensureCatalogPresent du module marque.
   */
  catalogPresentIfDbExists?: boolean;
  /**
   * Plugins : getter module kit (après ensurePluginHost) OU `feature-off`.
   * Contrôle / runtime / tests / accept partagent le même getter sauf overrides.
   */
  getPlugins?: () => unknown;
  pluginsFeatureOff?: boolean;
  featureOffBrandLabel?: string;
  getPluginControl?: () => unknown;
  getPluginRuntime?: () => unknown;
  getPluginTests?: () => unknown;
  getPluginAccept?: () => unknown;
};

function loadElectronApp(): {
  getVersion: () => string;
  getPath: (name: "userData") => string;
} {
  return loadElectron().app;
}

/**
 * Construit les accesseurs lazy `host*` (contrat brand-desktop-runtime).
 */
export function createBrandHostStack(cfg: BrandHostStackConfig) {
  const lazy = lazyHost;
  const defaultPort = cfg.defaultPort ?? 18790;
  const bootN2 = () => cfg.ensureN2Configured();

  const featureOff = () => {
    bootN2();
    const paths = cfg.getPaths();
    return createFeatureOffHost({
      brandLabel: cfg.featureOffBrandLabel || cfg.envPrefix,
      userDataDir: () => paths.userDataDir(),
      features: { plugins: false, fleet: false },
    });
  };

  const hostServer = lazy(() => {
    bootN2();
    const paths = cfg.getPaths();
    const store = cfg.getStore();
    const manifest = cfg.getManifest();
    const app = loadElectronApp();
    return {
      findFreePort,
      startNextServer: (
        opts: Parameters<typeof startBrandNextServer>[1] = {},
      ) =>
        startBrandNextServer(
          {
            manifest,
            paths: {
              dbPath: paths.dbPath(),
              assistantDbPath: paths.assistantDbPath(),
              uploadsDir: paths.uploadsDir(),
              nextServerEntry: paths.nextServerEntry(),
              nodeBinary: paths.nodeBinary(),
            },
            preferredPort: Number(process.env[cfg.portEnvKey] || defaultPort),
            ensureAuthSecret: () => store.ensureAuthSecret(),
            ensureMcpJwtSecret: () => store.ensureMcpJwtSecret(),
            getLocalAuth: () => store.getLocalAuth(),
            getLlmKeys: () =>
              store.getLlmKeys() as Record<string, string | undefined>,
            buildExtraEnv: () => {
              const portHint = Number(
                process.env[cfg.portEnvKey] || defaultPort,
              );
              const p = cfg.envPrefix;
              const base: Record<string, string> = {
                APP_BASE_URL: `http://127.0.0.1:${portHint}`,
                DESKTOP_LOCAL: "1",
                SETUP_COMPLETE: store.isSetupComplete() ? "1" : "0",
                CREEZIO_CORE_DB_PATH: path.join(
                  paths.userDataDir(),
                  "sqlite",
                  "core.db",
                ),
                [`${p}_CRASH_ENDPOINT`]: crashEndpoint(),
                [`${p}_INSTALL_ID`]: getInstallId(),
                [`${p}_APP_VERSION`]: app.getVersion(),
              };
              if (cfg.includeFleetOpsDirs) {
                const ud = app.getPath("userData");
                base[`${p}_FLEET_STATE_DIR`] = path.join(ud, "fleet-state");
                base[`${p}_OPS_DIR`] = path.join(ud, "ops");
              }
              const more = cfg.extraEnv?.({
                appVersion: app.getVersion(),
                userDataDir: paths.userDataDir(),
                appUserData: app.getPath("userData"),
              });
              return more ? { ...base, ...more } : base;
            },
            spawnServer: ({ env, entry, nodeBinary }) => {
              const childEnv = buildIsolatedNodeEnv({
                nodeBin: nodeBinary,
                baseEnv: env,
              });
              delete childEnv.ELECTRON_RUN_AS_NODE;
              delete childEnv.OPENAI_API_KEY;
              delete childEnv.ANTHROPIC_API_KEY;
              delete childEnv.AUTH_DISABLED;
              const llm = store.getLlmKeys();
              if (llm.openai) childEnv.OPENAI_API_KEY = llm.openai;
              if (llm.anthropic) childEnv.ANTHROPIC_API_KEY = llm.anthropic;
              if (env.PORT) {
                childEnv.APP_BASE_URL = `http://127.0.0.1:${env.PORT}`;
              }
              return spawn(nodeBinary, [entry], {
                cwd: path.dirname(entry),
                env: childEnv,
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
              });
            },
          },
          opts,
        ),
    };
  });

  const hostMeili = lazy(() => {
    bootN2();
    const paths = cfg.getPaths();
    return {
      startMeili: (log?: (line: string) => void) => {
        const dataDir = paths.meiliDataDir();
        return startMeili({
          binaryPath: paths.meiliBinary(),
          dataDir,
          userDataDir: paths.userDataDir(),
          log,
          buildEnv: (base) =>
            applyOsSandboxEnv({
              env: base,
              profileHome: path.join(dataDir, "os-home"),
              userData: paths.userDataDir(),
              toolDirs: [],
            }),
          onCrash: (info) => reportCrash("child-exit", info),
        });
      },
    };
  });

  const hostMeiliCoherence = lazy(() => {
    if (cfg.meiliCoherence === "kit") {
      bootN2();
      const paths = cfg.getPaths();
      configureMeiliCoherencePaths({
        dbPath: () => paths.dbPath(),
        nodeBinary: () => paths.nodeBinary(),
        nodeScript: (rel) => paths.nodeScript(rel),
        nodeModulesPathForScripts: () =>
          paths.nodeModulesPathForScripts?.() ?? null,
      });
      return { decideMeiliReady, INDEX_SCHEMA_VERSION };
    }
    return cfg.meiliCoherence();
  });

  const hostCatalog = lazy(() => {
    const cat = cfg.getCatalog() as {
      RateEstimator: unknown;
      formatEta: unknown;
      ensureCatalogPresent: (
        onProgress: (p: {
          phase: string;
          percent: number;
          detail: string;
        }) => void,
      ) => Promise<"present" | string>;
    };
    if (!cfg.catalogPresentIfDbExists) return cat;
    const fs = require("node:fs") as typeof import("node:fs");
    const paths = cfg.getPaths();
    return {
      RateEstimator: cat.RateEstimator,
      formatEta: cat.formatEta,
      ensureCatalogPresent: async (
        onProgress: Parameters<typeof cat.ensureCatalogPresent>[0],
      ) => {
        if (fs.existsSync(paths.dbPath())) return "present" as const;
        onProgress({
          phase: "download",
          percent: 100,
          detail: "Seed local (migrations) — pas de catalogue distant",
        });
        return "present" as const;
      },
    };
  });
  const hostHermes = lazy(() => cfg.getHermesHost());
  const hostHermesCrmKey = lazy(() => cfg.getHermesCrmKeySurface());
  const hostHermesSeed = lazy(() => cfg.getHermesSeed());
  const hostN8n = lazy(() => cfg.getN8nHost());
  const hostNodeRuntime = lazy(() => cfg.getNodeRuntime());
  const hostTunnel = lazy(() => cfg.getTunnelService());

  const hostPlugins = lazy(() => {
    if (cfg.pluginsFeatureOff) return featureOff().plugins;
    return cfg.getPlugins!();
  });
  const hostPluginControl = lazy(() => {
    if (cfg.getPluginControl) return cfg.getPluginControl();
    if (cfg.pluginsFeatureOff) {
      return { ...featureOff().pluginControlExtras };
    }
    return cfg.getPlugins!();
  });
  const hostPluginRuntime = lazy(() => {
    if (cfg.getPluginRuntime) return cfg.getPluginRuntime();
    if (cfg.pluginsFeatureOff) return featureOff().pluginRuntime;
    return cfg.getPlugins!();
  });
  const hostPluginTests = lazy(() => {
    if (cfg.getPluginTests) return cfg.getPluginTests();
    if (cfg.pluginsFeatureOff) return featureOff().pluginTests;
    return cfg.getPlugins!();
  });
  const hostPluginAccept = lazy(() => {
    if (cfg.getPluginAccept) return cfg.getPluginAccept();
    if (cfg.pluginsFeatureOff) return featureOff().pluginAccept;
    return cfg.getPlugins!();
  });

  const hostFleetAgent = lazy(() => {
    if (cfg.getFleetAgent) return cfg.getFleetAgent();
    return featureOff().fleetAgent;
  });
  const hostFleetSamples = lazy(() => {
    if (cfg.getFleetSamples) return cfg.getFleetSamples();
    return featureOff().fleetSamples;
  });

  const hostFactoryReset = lazy(() => {
    bootN2();
    const paths = cfg.getPaths();
    const manifest = cfg.getManifest();
    const ctx = () => ({
      manifest,
      userDataRoot: paths.userDataDir(),
      isPackaged: paths.isPackaged(),
      resourcesRoot: paths.resourcesRoot(),
    });
    return {
      wipeLocalUserData: () => wipeLocalUserData(ctx()),
      factoryResetTargets: () => factoryResetTargets(ctx()),
    };
  });

  return {
    hostServer,
    hostMeili,
    hostMeiliCoherence,
    hostCatalog,
    hostHermes,
    hostHermesCrmKey,
    hostHermesSeed,
    hostN8n,
    hostNodeRuntime,
    hostPlugins,
    hostPluginControl,
    hostPluginRuntime,
    hostPluginTests,
    hostPluginAccept,
    hostTunnel,
    hostFleetAgent,
    hostFleetSamples,
    hostFactoryReset,
  };
}

export type BrandHostStack = ReturnType<typeof createBrandHostStack>;
