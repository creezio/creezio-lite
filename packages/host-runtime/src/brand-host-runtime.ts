/**
 * Factories host-runtime-ctx marque (O7) — singletons, fleet, CRM key surface,
 * contexte HostRuntimeContext. Les brand opts restent dans la marque.
 */

import path from "node:path";
import type { AppManifest } from "@creezio/brand-config";
import {
  createFleetAgent,
  createFleetSamples,
  type FleetAgent,
  type FleetSamples,
} from "@creezio/observability";
import {
  isFleetScopeActive,
  N8N_DESKTOP_PORT,
  type FleetScopeId,
  type FleetTelemetryConfig,
} from "@creezio/platform-core";
import type { HostRuntimeContext } from "./context.js";
import type { LocalConfigStore } from "./local-config.js";
import { createHermesHost, type HermesHost } from "./hermes/launcher.js";
import { createN8nHost, type N8nHost, type N8nAgentKeysHooks } from "./n8n/launcher.js";
import { createTunnelService, type TunnelService } from "./tunnel/tunnel.js";
import type { N8nApiKeyBrand } from "./n8n/api-key.js";
import {
  ensureN8nApiKey,
  getN8nBridgeEnv,
} from "./n8n/api-key.js";
import type { N8nAgentIsolationBrand } from "./n8n/agent-isolation.js";
import {
  ensureN8nAgentApiKey,
  readStoredN8nAgentKeys,
  revokeN8nAgentApiKey,
  writeStoredN8nAgentKeys,
} from "./n8n/agent-isolation.js";
import type { HermesCrmKeyBrand, HermesCrmKeyPaths } from "./hermes/crm-key.js";
import {
  ensureHermesCrmApiKey,
  generateHermesCrmApiKey,
  getHermesFullBridgeEnv,
  hermesCrmKeyPath,
  readHermesCrmApiKey,
  writeHermesCrmApiKey,
} from "./hermes/crm-key.js";
import { getPluginControlBridgeEnv } from "./plugins/control-extras.js";
import {
  ensureDesktopNode,
  type EnsureDesktopNodeResult,
} from "./node-runtime.js";
import { getInstallId } from "./crash-reporter.js";

export type BrandRuntimePaths = {
  userDataDir: () => string;
  resourcesRoot: () => string;
  isPackaged: () => boolean;
  dbPath: () => string;
  n8nHomeDir: () => string;
  nodeBinary: () => string;
  nodeModulesPathForScripts: () => string | null | undefined;
  gitBinary?: () => string | null;
  hermesHomeDir?: () => string;
  assistantDbPath?: () => string;
};

export type BrandFleetInput = {
  envEndpointKey: string;
  defaultEndpoint: string;
  getAppVersion: () => string;
  log: (scope: string, line: string) => void;
  logFileTail: (maxBytes?: number) => string | null;
};

export type BrandHostRuntimeConfig = {
  manifest: AppManifest;
  store: () => LocalConfigStore;
  paths: BrandRuntimePaths;
  hermesCrm: HermesCrmKeyBrand;
  n8nApiKey?: N8nApiKeyBrand;
  n8nAgent?: N8nAgentIsolationBrand;
  fleet?: BrandFleetInput;
  npmUserDataSegment: string;
  secretFilePrefix: string;
  /** `full` = Hermes+n8n bridge ; `crm-only` =. */
  hermesBridge: "full" | "crm-only";
  nodeEnsure: "desktop";
  /** Chemin absolu script ensure-crm-key-db.js (marque). */
  ensureDbScriptPath: () => string;
  seedHermesSkills?: (hermesHome: string) => void | Promise<void>;
  log: (scope: string, line: string) => void;
};

export function createHermesCrmKeyPaths(
  paths: BrandRuntimePaths,
  ensureDbScriptPath: string,
): HermesCrmKeyPaths {
  return {
    userDataDir: paths.userDataDir(),
    dbPath: paths.dbPath(),
    n8nHomeDir: paths.n8nHomeDir(),
    nodeBinary: paths.nodeBinary(),
    ensureDbScriptPath,
    nodeModulesPathForScripts: paths.nodeModulesPathForScripts() ?? null,
  };
}

export function createN8nAgentKeysHooks(
  brand: N8nAgentIsolationBrand,
): N8nAgentKeysHooks {
  return {
    provision: (opts) => ensureN8nAgentApiKey({ ...opts, brand }),
    revoke: (opts) => revokeN8nAgentApiKey({ ...opts, brand }),
    readStored: (home) =>
      readStoredN8nAgentKeys(home, brand) as Record<string, unknown>,
    writeStored: (home, keys) =>
      writeStoredN8nAgentKeys(
        home,
        brand,
        keys as Parameters<typeof writeStoredN8nAgentKeys>[2],
      ),
  };
}

/** Bridge CRM-only (Fidu — pas de N8N_*). */
export function createHermesCrmOnlyBridgeEnv(opts: {
  brand: HermesCrmKeyBrand;
  paths: () => HermesCrmKeyPaths;
  crmPort?: number | null;
}): Record<string, string> {
  const out: Record<string, string> = {};
  const crm = readHermesCrmApiKey(opts.brand, opts.paths());
  if (crm?.apiKey) out[opts.brand.apiKeyEnv] = crm.apiKey;
  if (opts.crmPort && opts.crmPort > 0) {
    out[opts.brand.apiUrlEnv] = `http://127.0.0.1:${opts.crmPort}`;
  }
  return out;
}

export function createHermesCrmKeySurface(opts: {
  brand: HermesCrmKeyBrand;
  paths: () => HermesCrmKeyPaths;
  n8nBrand?: N8nApiKeyBrand;
  mode: "full" | "crm-only";
}) {
  const paths = opts.paths;
  return {
    hermesCrmKeyPath: () => hermesCrmKeyPath(opts.brand, paths()),
    readHermesCrmApiKey: () => readHermesCrmApiKey(opts.brand, paths()),
    writeHermesCrmApiKey: (
      data: Parameters<typeof writeHermesCrmApiKey>[2],
    ) => writeHermesCrmApiKey(opts.brand, paths(), data),
    generateHermesCrmApiKey: () => generateHermesCrmApiKey(opts.brand),
    getHermesFullBridgeEnv: (bridgeOpts?: { crmPort?: number | null }) => {
      if (opts.mode === "crm-only" || !opts.n8nBrand) {
        return createHermesCrmOnlyBridgeEnv({
          brand: opts.brand,
          paths,
          crmPort: bridgeOpts?.crmPort,
        });
      }
      return getHermesFullBridgeEnv({
        brand: opts.brand,
        n8nBrand: opts.n8nBrand,
        paths: {
          userDataDir: paths().userDataDir,
          n8nHomeDir: paths().n8nHomeDir,
        },
        n8nUiUrl: `http://127.0.0.1:${N8N_DESKTOP_PORT}`,
        crmPort: bridgeOpts?.crmPort,
      });
    },
    ensureHermesCrmApiKey: (ensureOpts?: { log?: (line: string) => void }) =>
      ensureHermesCrmApiKey({
        brand: opts.brand,
        paths: paths(),
        log: ensureOpts?.log,
      }),
  };
}

export function createBrandHostRuntimeContext(
  cfg: BrandHostRuntimeConfig,
  overrides?: Partial<HostRuntimeContext>,
): HostRuntimeContext {
  let packaged = false;
  try {
    packaged = cfg.paths.isPackaged();
  } catch {
    packaged = false;
  }
  const hermesPaths = () =>
    createHermesCrmKeyPaths(cfg.paths, cfg.ensureDbScriptPath());

  const getHermesBridgeEnv = (opts?: { crmPort?: number | null }) => {
    if (cfg.hermesBridge === "crm-only" || !cfg.n8nApiKey) {
      return createHermesCrmOnlyBridgeEnv({
        brand: cfg.hermesCrm,
        paths: hermesPaths,
        crmPort: opts?.crmPort,
      });
    }
    return getHermesFullBridgeEnv({
      brand: cfg.hermesCrm,
      n8nBrand: cfg.n8nApiKey,
      paths: {
        userDataDir: cfg.paths.userDataDir(),
        n8nHomeDir: cfg.paths.n8nHomeDir(),
      },
      n8nUiUrl: `http://127.0.0.1:${N8N_DESKTOP_PORT}`,
      crmPort: opts?.crmPort,
    });
  };

  // H1 « Hermes cerveau unique » — bloc mcp_servers du config.yaml Hermes :
  // URL /mcp du serveur OS kit (loopback via METIER_BASE_URL/MCP_PUBLIC_URL,
  // posés par listenBrandOsHttp AVANT le start Hermes) + Bearer clé CRM
  // Hermes. null tant que la clé ou l'URL n'existent pas (aucun bloc écrit).
  const getHermesMcpServerConfig = (_opts?: { crmPort?: number | null }) => {
    try {
      const crm = readHermesCrmApiKey(cfg.hermesCrm, {
        userDataDir: cfg.paths.userDataDir(),
      });
      if (!crm?.apiKey) return null;
      const base = String(
        process.env.METIER_BASE_URL || process.env.MCP_PUBLIC_URL || "",
      )
        .trim()
        .replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(base)) return null;
      return {
        serverName: cfg.manifest.brandId,
        url: `${base}/mcp`,
        bearerToken: crm.apiKey,
      };
    } catch {
      return null;
    }
  };

  const ctx: HostRuntimeContext = {
    manifest: cfg.manifest,
    userDataDir: cfg.paths.userDataDir(),
    resourcesRoot: cfg.paths.resourcesRoot(),
    isPackaged: packaged,
    log: (scope, line) => cfg.log(scope, line),
    getInstallId: () => getInstallId(),
    getHermesBridgeEnv,
    getHermesMcpServerConfig,
    npmUserDataSegment: cfg.npmUserDataSegment,
    secretFilePrefix: cfg.secretFilePrefix,
    ...overrides,
  };

  if (cfg.seedHermesSkills) {
    ctx.seedHermesSkills = cfg.seedHermesSkills;
  }
  if (cfg.n8nApiKey) {
    const brand = cfg.n8nApiKey;
    ctx.getPluginControlBridgeEnv = () => getPluginControlBridgeEnv();
    if (cfg.paths.gitBinary) {
      ctx.getGitBinary = () => cfg.paths.gitBinary!() ?? null;
    }
    ctx.onN8nReady = async ({ uiUrl, homeDir, email, password, log }) => {
      const keyRes = await ensureN8nApiKey({
        uiUrl,
        homeDir,
        email,
        password,
        brand,
        log,
      });
      if (!keyRes.ok) log(`api-key: ${keyRes.detail}`);
    };
    ctx.getN8nNextEnvExtra = ({ homeDir, localUiUrl }) =>
      getN8nBridgeEnv({
        homeDir,
        localUiUrl: localUiUrl || "",
        brand,
      });
  }

  return ctx;
}

export type BrandHostSingletons = {
  hostRuntimeContext: (
    overrides?: Partial<HostRuntimeContext>,
  ) => HostRuntimeContext;
  hermesCrmPaths: () => HermesCrmKeyPaths;
  hermesCrmKeySurface: () => ReturnType<typeof createHermesCrmKeySurface>;
  hermesHost: () => HermesHost;
  n8nHost: () => N8nHost;
  tunnelService: () => TunnelService;
  fleetAgent?: () => FleetAgent;
  fleetSamples?: () => FleetSamples;
  ensureNode: (opts?: {
    minVersion?: string;
    pin?: string;
    onLog?: (line: string) => void;
    platform?: NodeJS.Platform;
  }) => Promise<EnsureDesktopNodeResult>;
  resetForTests: () => void;
};

/**
 * Singletons + surfaces host-runtime pour une marque.
 */
export function createBrandHostRuntime(
  cfg: BrandHostRuntimeConfig,
): BrandHostSingletons {
  let hermesHost: HermesHost | null = null;
  let n8nHost: N8nHost | null = null;
  let tunnelHost: TunnelService | null = null;
  let fleetAgent: FleetAgent | null = null;
  let fleetSamples: FleetSamples | null = null;

  const hostRuntimeContext = (overrides?: Partial<HostRuntimeContext>) =>
    createBrandHostRuntimeContext(cfg, overrides);

  const hermesCrmPaths = () =>
    createHermesCrmKeyPaths(cfg.paths, cfg.ensureDbScriptPath());

  const hermesCrmKeySurface = () =>
    createHermesCrmKeySurface({
      brand: cfg.hermesCrm,
      paths: hermesCrmPaths,
      n8nBrand: cfg.n8nApiKey,
      mode: cfg.hermesBridge,
    });

  const agentKeys = cfg.n8nAgent
    ? createN8nAgentKeysHooks(cfg.n8nAgent)
    : undefined;

  const out: BrandHostSingletons = {
    hostRuntimeContext,
    hermesCrmPaths,
    hermesCrmKeySurface,
    hermesHost: () =>
      (hermesHost ??= createHermesHost({
        ctx: hostRuntimeContext(),
        store: cfg.store(),
      })),
    n8nHost: () =>
      (n8nHost ??= createN8nHost({
        ctx: hostRuntimeContext(),
        store: cfg.store(),
        ...(agentKeys ? { agentKeys } : {}),
      })),
    tunnelService: () =>
      (tunnelHost ??= createTunnelService({
        ctx: hostRuntimeContext(),
        store: cfg.store(),
      })),
    ensureNode: async (opts) => {
      const ctx = opts?.onLog
        ? hostRuntimeContext({
            log: (_scope, line) => opts.onLog!(line),
          })
        : hostRuntimeContext();
      return ensureDesktopNode(ctx, {
        minVersion: opts?.minVersion,
        pin: opts?.pin,
        platform: opts?.platform,
      });
    },
    resetForTests: () => {
      hermesHost = null;
      n8nHost = null;
      tunnelHost = null;
      fleetAgent = null;
      fleetSamples = null;
    },
  };

  if (cfg.fleet) {
    const fleet = cfg.fleet;
    out.fleetAgent = () =>
      (fleetAgent ??= createFleetAgent({
        baseUrl:
          process.env[fleet.envEndpointKey] || fleet.defaultEndpoint,
        getConfig: () => cfg.store().getFleetTelemetry(),
        isScopeActive: (c, scope) =>
          isFleetScopeActive(
            c as FleetTelemetryConfig,
            scope as FleetScopeId,
          ),
        getInstallId: () => getInstallId(),
        getAppVersion: () => {
          try {
            return fleet.getAppVersion();
          } catch {
            return "0.0.0";
          }
        },
        getTunnelInfo: () => {
          const t = cfg.store().getTunnelConfig();
          return t ? { slug: t.slug, hostname: t.hostname } : null;
        },
        log: (scope, line) => fleet.log(scope, line),
        logFileTail: (maxBytes) => fleet.logFileTail(maxBytes),
      }));

    if (
      cfg.paths.assistantDbPath &&
      cfg.paths.hermesHomeDir
    ) {
      const p = cfg.paths;
      out.fleetSamples = () =>
        (fleetSamples ??= createFleetSamples({
          assistantDbPath: p.assistantDbPath!,
          dbPath: p.dbPath,
          hermesHomeDir: p.hermesHomeDir!,
          nodeBinary: p.nodeBinary,
          nodeModulesPathForScripts: () =>
            p.nodeModulesPathForScripts() ?? undefined,
          userDataDir: p.userDataDir,
        }));
    }
  }

  return out;
}

/** Helper chemin script ensure-crm-key-db depuis __dirname electron marque. */
export function brandEnsureCrmKeyDbScript(electronDirname: string): string {
  return path.join(
    electronDirname,
    "../vendor/creezio/electron-shell/dist-cjs/host/hermes/ensure-crm-key-db.js",
  );
}
