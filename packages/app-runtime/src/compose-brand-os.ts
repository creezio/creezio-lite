/**
 * Composition OS complète derrière la façade marque.
 * Absorbe createBrandHostRuntime + createBrandHostStack — zéro host-stack
 * dans apps/<marque>.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_AUTH_SECRET_FALLBACK } from "@creezio/auth";
import {
  isFeatureEnabled,
  type AppManifest,
} from "@creezio/brand-config";
import { createLocalSplashSteps } from "@creezio/electron-shell";
import {
  brandHermesSkillsDirCandidates,
  configureCrashReporter,
  createBrandHostRuntime,
  createBrandHostStack,
  createLocalConfigStoreSync,
  createPluginsHost,
  kitHermesSkillsDir,
  log,
  logFileTail,
  seedHermesSkillsFromDirs,
  type BrandHostSingletons,
  type BrandHostStack,
  type LocalConfigStore,
} from "@creezio/host-runtime";
import {
  pluginsRootDir,
  resolveBrandDbPath,
  resolveCoreDbPath,
  resolveLocalConfigPath,
  type PathsContext,
  createAppRequire,
} from "@creezio/platform-core";
import { seedPluginsFromDirs } from "./plugin-seed.js";

export type ComposeBrandOsOptions = {
  manifest: AppManifest;
  userDataDir: string;
  isPackaged?: boolean;
  resourcesRoot: string;
  /** __dirname electron compilé (preload / scripts). */
  electronDirname: string;
  /**
   * Host plugins réel — **activé par défaut** (P&P).
   * Feature-off si `manifest.features.plugins === false` (feature-off) ou
   * kill-switch `CREEZIO_PLUGINS=0`. `CREEZIO_PLUGINS=1` reste accepté
   * (no-op — c'est déjà le défaut).
   */
  pluginsFeatureOff?: boolean;
  /**
   * Hooks lifecycle sidecars (P3) — registerPluginApi/unregisterPluginApi
   * côté harness/desktop. Ignorés si feature-off.
   */
  pluginHostHooks?: {
    onPluginStarted?: (plugin: {
      id: string;
      dir: string;
      port: number | null;
    }) => void;
    onPluginStopped?: (id: string) => void;
  };
  /**
   * Plugins embarqués marque (P5) — répertoires source copiés dans
   * `pluginsRootDir(userDataDir)` au premier accès au host (idempotent,
   * jamais d'écrasement). Convention : `<appRoot>/plugins/<id>/manifest.json`.
   */
  pluginSeedDirs?: readonly string[];
  /**
   * Host catalogue distant (marque CHR). Sans = seed local (DB déjà présente).
   */
  catalogHost?: {
    RateEstimator: unknown;
    formatEta: (seconds: number | null | undefined) => string;
    ensureCatalogPresent: (
      onProgress: (p: {
        phase: string;
        percent: number | null;
        detail?: string;
      }) => void,
    ) => Promise<"present" | "installed" | string>;
  };
  /**
   * URL collecteur de crash (POST JSON). Sinon env
   * `CREEZIO_CRASH_ENDPOINT` / `{PREFIX}_CRASH_ENDPOINT`, sinon désactivé.
   */
  crashEndpoint?: string;
};

export type BrandOsComposition = {
  store: LocalConfigStore;
  hostRuntime: BrandHostSingletons;
  hostStack: BrandHostStack;
  paths: ReturnType<typeof buildBrandPaths>;
  pathsCtx: PathsContext;
  /** Splash steps kit (pour installBrandDesktopRuntime ultérieur). */
  createLocalSplashSteps: typeof createLocalSplashSteps;
  status: () => BrandOsStatus;
  close: () => void;
};

export type BrandOsStatus = {
  ok: true;
  brandId: string;
  setupComplete: boolean;
  hosts: {
    hermes: boolean;
    n8n: boolean;
    tunnel: boolean;
    meili: boolean;
    plugins: "feature-off" | "enabled";
    fleet: "feature-off" | "enabled";
  };
  paths: {
    userDataDir: string;
    brandDb: string;
    coreDb: string;
    resourcesRoot: string;
  };
};

function shellPackageRoot(): string {
  try {
    const req = createAppRequire();
    const entry = req.resolve("@creezio/electron-shell");
    // …/packages/electron-shell/dist/index.js → package root
    return path.resolve(path.dirname(entry), "..");
  } catch {
    return path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../electron-shell",
    );
  }
}

function ensureCrmKeyDbScript(): string {
  const root = shellPackageRoot();
  const candidates = [
    path.join(root, "dist/host/hermes/ensure-crm-key-db.js"),
    path.join(root, "dist-cjs/host/hermes/ensure-crm-key-db.js"),
    path.join(root, "src/host/hermes/ensure-crm-key-db.ts"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0]!;
}

/**
 * Le lecteur SQLite de cohérence Meili appartient au kit, pas au build
 * Electron de la marque. Les anciens builds le cherchaient sous
 * `build/electron/meili-coherence-query.js`, un chemin absent de l'asar.
 */
function meiliCoherenceQueryScript(opts: ComposeBrandOsOptions): string {
  const root = shellPackageRoot();
  const candidates = [
    // Packagé : Node vanilla ne sait pas exécuter un .js dans app.asar.
    // electron-builder copie ce script autonome sous resources/scripts.
    path.join(
      opts.resourcesRoot,
      "scripts",
      "meili-coherence-query.cjs",
    ),
    // Dev / tests : ressource du package kit.
    path.join(root, "resources/scripts/meili-coherence-query.cjs"),
    path.join(root, "dist/host/meili/coherence-query.js"),
    path.join(root, "dist-cjs/host/meili/coherence-query.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

function buildBrandPaths(opts: ComposeBrandOsOptions) {
  const pathsCtx: PathsContext = {
    manifest: opts.manifest,
    userDataRoot: opts.userDataDir,
    isPackaged: Boolean(opts.isPackaged),
    resourcesRoot: opts.resourcesRoot,
  };
  const brandDb = resolveBrandDbPath(pathsCtx);
  const coreDb = resolveCoreDbPath(pathsCtx);
  const m = opts.manifest;
  return {
    ctx: pathsCtx,
    userDataDir: () => opts.userDataDir,
    isPackaged: () => Boolean(opts.isPackaged),
    resourcesRoot: () => opts.resourcesRoot,
    dbPath: () => brandDb,
    assistantDbPath: () => path.join(opts.userDataDir, "assistant.db"),
    uploadsDir: () => path.join(opts.userDataDir, "uploads"),
    nextServerEntry: () => {
      // Packagé (parité kit) : afterPack → resources/server/server.js
      if (opts.isPackaged) {
        return path.join(opts.resourcesRoot, "server", "server.js");
      }
      const candidates = [
        path.join(opts.electronDirname, "../../build/server/server.js"),
        path.join(
          opts.electronDirname,
          "../../ui/.next/standalone/server.js",
        ),
        path.join(opts.electronDirname, "../../.next/standalone/server.js"),
        path.join(opts.electronDirname, "../../ui/server.js"),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) return c;
      }
      return candidates[0]!;
    },
    nodeBinary: () => process.execPath,
    meiliDataDir: () => path.join(opts.userDataDir, "meili"),
    meiliBinary: () => {
      // parité kit : meilisearch-win.exe sous Windows ; meili en Linux kit.
      const winName = "meilisearch-win.exe";
      const unixName = "meili";
      const name = process.platform === "win32" ? winName : unixName;
      const candidates = [
        path.join(opts.resourcesRoot, "bin", name),
        path.join(opts.resourcesRoot, name),
        path.join(shellPackageRoot(), "resources", "bin", name),
        // Fallbacks legacy (anciens stages / ensure-kit).
        ...(process.platform === "win32"
          ? [
              path.join(opts.resourcesRoot, "bin", "meili.exe"),
              path.join(shellPackageRoot(), "resources", "bin", "meili.exe"),
            ]
          : [path.join(opts.resourcesRoot, "meili")]),
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) return c;
      }
      return candidates[0]!;
    },
    // SoT segments = launchers electron-shell / platform-core
    // (resolveN8nHomeDir / resolveHermesHomeDir). Un mauvais segment ici casse
    // silencieusement le bridge Hermes→n8n : getN8nBridgeEnv ne trouve pas
    // `.{brand}-n8n-api-key.json` → N8N_API_KEY absent de l'env Hermes.
    n8nHomeDir: () => path.join(opts.userDataDir, "n8n-home"),
    hermesHomeDir: () => path.join(opts.userDataDir, "hermes-home"),
    nodeModulesPathForScripts: () => {
      const cand = path.join(opts.electronDirname, "../../../node_modules");
      return fs.existsSync(cand) ? cand : null;
    },
    nodeScript: (rel: string) =>
      rel === "meili-coherence-query.js"
        ? meiliCoherenceQueryScript(opts)
        : path.join(opts.electronDirname, rel),
    preloadPath: (name: string) => path.join(opts.electronDirname, name),
    gitBinary: () => null as string | null,
    envPrefix: m.envPrefix,
  };
}

/**
 * Compose hosts OS natifs (Hermes, n8n, tunnel, Meili stack, factory-reset…)
 * à partir du seul AppManifest — rien dans la marque.
 */
export function composeBrandOs(
  opts: ComposeBrandOsOptions,
): BrandOsComposition {
  const paths = buildBrandPaths(opts);
  const m = opts.manifest;
  const configPath = resolveLocalConfigPath(paths.ctx);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  const store = createLocalConfigStoreSync({
    configPath,
    manifest: m,
    encryption: "plain",
  });

  // Sécurité : sessions JWT (@creezio/auth) et chiffrement BYOK
  // (@creezio/assistant chat-db) lisent process.env.AUTH_SECRET. Sans
  // injection (harness Docker headless), tous les serveurs signaient avec le
  // fallback dev public → secret unique par serveur, persistant dans
  // `{dataDir}/{brand}-config.json` (même mécanisme que le launcher Electron),
  // exporté ici AVANT tout mount de routes / spawn UI Next.
  const envAuthSecret = (process.env.AUTH_SECRET || "").trim();
  if (!envAuthSecret || envAuthSecret === DEV_AUTH_SECRET_FALLBACK) {
    process.env.AUTH_SECRET = store.ensureAuthSecret();
  }
  if (!(process.env.MCP_JWT_SECRET || "").trim()) {
    process.env.MCP_JWT_SECRET = store.ensureMcpJwtSecret();
  }

  const prefix = m.envPrefix;
  const product = m.client.productName;
  const domain = m.tunnelRootDomain || m.domains?.primary || "localhost";
  // Plugins ON par défaut — OFF si features.plugins=false (feature-off) ou
  // kill-switch CREEZIO_PLUGINS=0 (l'ancien opt-in =1 reste un no-op).
  const pluginsFeatureOff =
    opts.pluginsFeatureOff !== undefined
      ? opts.pluginsFeatureOff
      : !isFeatureEnabled(m, "plugins") ||
        process.env.CREEZIO_PLUGINS === "0";
  /** Fleet = manifest.features.fleet (Fidu false ; marques true). */
  const fleetEnabled = isFeatureEnabled(m, "fleet");
  const fleetDefaultEndpoint =
    process.env.CREEZIO_FLEET_ENDPOINT ||
    process.env[`${prefix}_FLEET_ENDPOINT`] ||
    `https://fleet.${domain}/ingest-disabled`;

  const crashDefaultEndpoint = (
    opts.crashEndpoint ||
    process.env.CREEZIO_CRASH_ENDPOINT ||
    process.env[`${prefix}_CRASH_ENDPOINT`] ||
    "http://127.0.0.1/crash-disabled"
  ).trim();

  const hostRuntime = createBrandHostRuntime({
    manifest: m,
    store: () => store,
    paths: {
      userDataDir: paths.userDataDir,
      resourcesRoot: paths.resourcesRoot,
      isPackaged: paths.isPackaged,
      dbPath: paths.dbPath,
      n8nHomeDir: paths.n8nHomeDir,
      nodeBinary: paths.nodeBinary,
      nodeModulesPathForScripts: paths.nodeModulesPathForScripts,
      gitBinary: paths.gitBinary,
      hermesHomeDir: paths.hermesHomeDir,
      assistantDbPath: paths.assistantDbPath,
    },
    hermesCrm: {
      apiKeyPrefix: `${m.brandId.replace(/-/g, "_")}_live_`,
      fileName: `.${m.brandId}-hermes-crm-api-key.json`,
      keyName: `${product} Hermes (service)`,
      apiKeyEnv: `${prefix}_API_KEY`,
      apiUrlEnv: `${prefix}_API_URL`,
    },
    n8nApiKey: {
      label: `${product} Hermes`,
      fileName: `.${m.brandId}-n8n-api-key.json`,
    },
    n8nAgent: {
      keysFileName: `.${m.brandId}-n8n-agent-keys.json`,
      labelPrefix: `${product} Agent`,
      tagPrefix: `${m.brandId}-agent`,
      productName: product,
    },
    ...(fleetEnabled
      ? {
          fleet: {
            envEndpointKey: `${prefix}_FLEET_ENDPOINT`,
            defaultEndpoint: fleetDefaultEndpoint,
            getAppVersion: () => {
              try {
                const req = createAppRequire();
                return req("electron").app.getVersion() as string;
              } catch {
                return process.env.npm_package_version || "0.0.0";
              }
            },
            log: (scope: string, line: string) => log(scope, line),
            logFileTail: (maxBytes?: number) => logFileTail(maxBytes),
          },
        }
      : {}),
    npmUserDataSegment: `${m.brandId}-npm`,
    secretFilePrefix: m.brandId,
    hermesBridge: "full",
    nodeEnsure: "desktop",
    ensureDbScriptPath: () => ensureCrmKeyDbScript(),
    // Skills Hermes par défaut (parité kit) : génériques kit (creezio-n8n,
    // creezio-plugins) + skills marque (`vendor/hermes-skills` de l'app).
    // Toute app composée par le kit les reçoit sans wiring marque.
    seedHermesSkills: (hermesHome: string) => {
      seedHermesSkillsFromDirs({
        hermesHome,
        dirs: [
          kitHermesSkillsDir(),
          ...brandHermesSkillsDirCandidates(paths.resourcesRoot()),
        ],
        log: (line) => log("hermes", line),
      });
    },
    log: (scope, line) => log(scope, line),
  });

  // Miroir flotte + brandId (startBrandDesktop a déjà fixé l'endpoint tôt).
  // Ne pas écraser un endpoint valide avec crash-disabled.
  configureCrashReporter({
    brandId: m.brandId,
    endpointEnvKey: `${prefix}_CRASH_ENDPOINT`,
    ...(/crash-disabled/i.test(crashDefaultEndpoint)
      ? {}
      : { defaultEndpoint: crashDefaultEndpoint }),
    ...(fleetEnabled && hostRuntime.fleetAgent
      ? {
          sendFleetCrash: (report) => {
            try {
              hostRuntime.fleetAgent!().sendFleetCrash(report);
            } catch {
              /* best-effort */
            }
          },
        }
      : {}),
  });
  if (/crash-disabled/i.test(crashDefaultEndpoint)) {
    log("crash", "collecteur distant désactivé (pas d'endpoint marque/env)");
  } else {
    log(
      "crash",
      `collecteur=${crashDefaultEndpoint.replace(/\/crash-[^/?]+/, "/crash-…")}`,
    );
  }

  const hostStack = createBrandHostStack({
    ensureN2Configured: () => undefined,
    getManifest: () => m,
    getStore: () => ({
      ensureAuthSecret: () => store.ensureAuthSecret(),
      ensureMcpJwtSecret: () => store.ensureMcpJwtSecret(),
      getLocalAuth: () => store.getLocalAuth(),
      getLlmKeys: () => {
        const k = store.getLlmKeys();
        return {
          openai: k.openai ?? undefined,
          anthropic: k.anthropic ?? undefined,
        };
      },
      isSetupComplete: () => store.isSetupComplete(),
    }),
    getPaths: () => paths as never,
    portEnvKey: `${prefix}_DESKTOP_PORT`,
    defaultPort: 18790,
    envPrefix: prefix,
    includeFleetOpsDirs: fleetEnabled,
    getHermesHost: () => hostRuntime.hermesHost(),
    getHermesCrmKeySurface: () => hostRuntime.hermesCrmKeySurface(),
    getN8nHost: () => hostRuntime.n8nHost(),
    getTunnelService: () => hostRuntime.tunnelService(),
    ...(fleetEnabled && hostRuntime.fleetAgent
      ? {
          getFleetAgent: () => hostRuntime.fleetAgent!(),
          getFleetSamples: () =>
            hostRuntime.fleetSamples
              ? hostRuntime.fleetSamples()
              : {
                  sampleAssistantChats: () => [],
                  sampleHermesChats: () => [],
                  sampleRequestLogs: () => [],
                  sampleUsers: () => [],
                  sampleSessions: () => [],
                },
        }
      : {}),
    getNodeRuntime: () => ({
      ensureDesktopNode: hostRuntime.ensureNode,
      ready: true,
    }),
    getHermesSeed: () => ({
      seedHermesSkills: async () => ({ ok: true, seeded: 0 }),
    }),
    meiliCoherence: "kit",
    getCatalog: () =>
      opts.catalogHost || {
        RateEstimator: class {
          sample() {
            return 0;
          }
        },
        formatEta: () => "",
        ensureCatalogPresent: async () =>
          fs.existsSync(paths.dbPath()) ? "present" : "present",
      },
    catalogPresentIfDbExists: !opts.catalogHost,
    // P&P : plugins activés par défaut. Feature-off si
    // manifest.features.plugins=false (feature-off) ou CREEZIO_PLUGINS=0.
    pluginsFeatureOff,
    featureOffBrandLabel: product,
    ...(!pluginsFeatureOff
      ? {
          getPlugins: (() => {
            let host: ReturnType<typeof createPluginsHost> | null = null;
            return () => {
              if (!host && opts.pluginSeedDirs?.length) {
                // Install au boot des plugins livrés par la marque (P5).
                seedPluginsFromDirs({
                  seedDirs: opts.pluginSeedDirs,
                  pluginsRoot: pluginsRootDir(opts.userDataDir),
                  log: (line) => log("plugins", line),
                });
              }
              return (host ??= createPluginsHost({
                ctx: hostRuntime.hostRuntimeContext(),
                ...(opts.pluginHostHooks?.onPluginStarted
                  ? { onPluginStarted: opts.pluginHostHooks.onPluginStarted }
                  : {}),
                ...(opts.pluginHostHooks?.onPluginStopped
                  ? { onPluginStopped: opts.pluginHostHooks.onPluginStopped }
                  : {}),
              }));
            };
          })(),
        }
      : {}),
  });

  const pluginsMode = pluginsFeatureOff ? "feature-off" : "enabled";
  const fleetMode = fleetEnabled ? "enabled" : "feature-off";

  const status = (): BrandOsStatus => ({
    ok: true,
    brandId: m.brandId,
    setupComplete: store.isSetupComplete(),
    hosts: {
      hermes: typeof hostRuntime.hermesHost === "function",
      n8n: typeof hostRuntime.n8nHost === "function",
      tunnel: typeof hostRuntime.tunnelService === "function",
      meili: true,
      plugins: pluginsMode,
      fleet: fleetMode,
    },
    paths: {
      userDataDir: opts.userDataDir,
      brandDb: paths.dbPath(),
      coreDb: resolveCoreDbPath(paths.ctx),
      resourcesRoot: opts.resourcesRoot,
    },
  });

  log(
    "os",
    `composeBrandOs brand=${m.brandId} hermes/n8n/tunnel fleet=${fleetMode} ready setup=${store.isSetupComplete()}`,
  );

  return {
    store,
    hostRuntime,
    hostStack,
    paths,
    pathsCtx: paths.ctx,
    createLocalSplashSteps,
    status,
    close: () => {
      hostRuntime.resetForTests();
    },
  };
}
