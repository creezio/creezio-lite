/**
 * Feature-off host — contrat kit pour marques sans runtime plugins / flotte
 * (Phase N5, extraits des signatures feature-off `host-na-stubs.ts`).
 *
 * Ne pas inventer de produit : réponses `ok: false` / listes vides honnêtes.
 * Les marques à plugins réels (TF/CV) utilisent `createPluginsHost` / fleet.
 */

import fs from "node:fs";
import path from "node:path";

export type FeatureOffHostOptions = {
  /** Libellé marque dans les messages (ex. `feature-off`). */
  brandLabel: string;
  /** Résolveur userData (dossier `plugins/` sous cette racine). */
  userDataDir: () => string;
  /**
   * Surfaces concernées. `false` (défaut) = feature-off.
   * Passer `true` lève — ce factory n’active jamais un runtime réel.
   */
  features?: {
    plugins?: boolean;
    fleet?: boolean;
  };
};

export type FeatureOffPluginsStatus = {
  plugins: unknown[];
  rootDir: string;
  detail: string;
};

export type FeatureOffPluginsHost = {
  pluginsRootDir: () => string;
  pluginsStatusPayload: () => FeatureOffPluginsStatus;
  pluginsStatusPayloadWithGit: () => Promise<FeatureOffPluginsStatus>;
  enablePlugin: (
    id: string,
    enabled: boolean,
  ) => { ok: false; detail: string };
  startEnabledPlugins: (opts?: {
    onLog?: (line: string) => void;
  }) => Promise<{ started: string[]; errors: string[]; detail: string }>;
  stopAllPlugins: () => void;
  setPluginsCrmPort: (port: number) => void;
  createPluginScaffoldWithGit: (
    opts?: unknown,
  ) => Promise<{ ok: false; plugin: null; detail: string }>;
  deletePlugin: (id: string) => { ok: false; detail: string };
  restartPlugin: (id: string) => Promise<{ ok: false; detail: string }>;
  getPluginVersions: (
    id: string,
  ) => Promise<{ ok: false; versions: string[]; detail: string }>;
  restorePluginToVersion: (
    id: string,
    ref: string,
  ) => Promise<{ ok: false; detail: string }>;
  resolvePluginPanel: (id: string) => null;
};

export type FeatureOffPluginControlExtras = {
  archivePluginRuntime: (id: string) => Promise<{ ok: false; detail: string }>;
  createPluginExecutionGrant: (opts?: unknown) => {
    token: string;
    expiresAt: number;
  };
  migratePluginData: (id: string) => Promise<{ ok: false; detail: string }>;
  validatePluginExecutionGrant: (
    opts?: unknown,
  ) => { ok: false; detail: string };
};

export type FeatureOffPluginTestsHost = {
  runPluginTests: (id: string) => Promise<{ ok: false; detail: string }>;
};

export type FeatureOffPluginAcceptHost = {
  runPluginAcceptCheck: (id: string) => Promise<{ ok: false; detail: string }>;
};

export type FeatureOffFleetAgentHost = {
  startFleetAgent: (opts?: unknown) => void;
  notifyFleetConfigChanged: () => void;
  sendFleetHeartbeat: () => Promise<boolean>;
  uploadFleetDiagnostics: (
    reason?: string,
  ) => Promise<{ ok: false; detail: string }>;
};

export type FeatureOffFleetSamplesHost = {
  sampleAssistantChats: (n?: number) => unknown[];
  sampleHermesChats: (n?: number) => unknown[];
  sampleRequestLogs: (n?: number) => unknown[];
  sampleSessions: (n?: number) => unknown[];
  sampleUsers: (n?: number) => unknown[];
};

export type FeatureOffHost = {
  plugins: FeatureOffPluginsHost;
  pluginControlExtras: FeatureOffPluginControlExtras;
  pluginTests: FeatureOffPluginTestsHost;
  pluginAccept: FeatureOffPluginAcceptHost;
  pluginRuntime: { pluginsRootDir: () => string };
  fleetAgent: FeatureOffFleetAgentHost;
  fleetSamples: FeatureOffFleetSamplesHost;
};

function assertFeatureOff(
  features: FeatureOffHostOptions["features"],
  key: "plugins" | "fleet",
): void {
  if (features?.[key] === true) {
    throw new Error(
      `createFeatureOffHost: features.${key}=true interdit — utiliser le host réel`,
    );
  }
}

/**
 * Construit les surfaces host feature-off (plugins + flotte).
 * Signatures alignées sur l’ancien `host-na-stubs`.
 */
export function createFeatureOffHost(
  opts: FeatureOffHostOptions,
): FeatureOffHost {
  assertFeatureOff(opts.features, "plugins");
  assertFeatureOff(opts.features, "fleet");

  const brand = opts.brandLabel.trim() || "brand";
  const pluginsDetail = `Plugins runtime N/A ${brand}`;
  const acceptDetail = `Plugins accept N/A ${brand}`;
  const testsDetail = `Plugins tests N/A ${brand}`;
  const naDetail = `N/A ${brand}`;
  const fleetDetail = `Flotte N/A ${brand}`;

  function pluginsRoot(): string {
    const root = path.join(opts.userDataDir(), "plugins");
    try {
      fs.mkdirSync(root, { recursive: true });
    } catch {
      /* best-effort */
    }
    return root;
  }

  const emptyStatus = (): FeatureOffPluginsStatus => ({
    plugins: [],
    rootDir: pluginsRoot(),
    detail: pluginsDetail,
  });

  const plugins: FeatureOffPluginsHost = {
    pluginsRootDir: () => pluginsRoot(),
    pluginsStatusPayload: () => emptyStatus(),
    pluginsStatusPayloadWithGit: async () => emptyStatus(),
    enablePlugin: (_id, _enabled) => ({
      ok: false as const,
      detail: pluginsDetail,
    }),
    startEnabledPlugins: async (_o?) => ({
      started: [],
      errors: [],
      detail: pluginsDetail,
    }),
    stopAllPlugins: () => undefined,
    setPluginsCrmPort: (_port) => undefined,
    createPluginScaffoldWithGit: async (_o?) => ({
      ok: false as const,
      plugin: null,
      detail: pluginsDetail,
    }),
    deletePlugin: (_id) => ({
      ok: false as const,
      detail: pluginsDetail,
    }),
    restartPlugin: async (_id) => ({
      ok: false as const,
      detail: pluginsDetail,
    }),
    getPluginVersions: async (_id) => ({
      ok: false as const,
      versions: [],
      detail: pluginsDetail,
    }),
    restorePluginToVersion: async (_id, _ref) => ({
      ok: false as const,
      detail: pluginsDetail,
    }),
    resolvePluginPanel: (_id) => null,
  };

  const pluginControlExtras: FeatureOffPluginControlExtras = {
    archivePluginRuntime: async (_id) => ({
      ok: false as const,
      detail: naDetail,
    }),
    createPluginExecutionGrant: (_o?) => ({
      token: "",
      expiresAt: 0,
    }),
    migratePluginData: async (_id) => ({
      ok: false as const,
      detail: naDetail,
    }),
    validatePluginExecutionGrant: (_o?) => ({
      ok: false as const,
      detail: naDetail,
    }),
  };

  const pluginTests: FeatureOffPluginTestsHost = {
    runPluginTests: async (_id) => ({
      ok: false as const,
      detail: testsDetail,
    }),
  };

  const pluginAccept: FeatureOffPluginAcceptHost = {
    runPluginAcceptCheck: async (_id) => ({
      ok: false as const,
      detail: acceptDetail,
    }),
  };

  const fleetAgent: FeatureOffFleetAgentHost = {
    startFleetAgent: (_o?) => undefined,
    notifyFleetConfigChanged: () => undefined,
    sendFleetHeartbeat: async () => false,
    uploadFleetDiagnostics: async (_reason?) => ({
      ok: false as const,
      detail: fleetDetail,
    }),
  };

  const fleetSamples: FeatureOffFleetSamplesHost = {
    sampleAssistantChats: (_n?) => [],
    sampleHermesChats: (_n?) => [],
    sampleRequestLogs: (_n?) => [],
    sampleSessions: (_n?) => [],
    sampleUsers: (_n?) => [],
  };

  return {
    plugins,
    pluginControlExtras,
    pluginTests,
    pluginAccept,
    pluginRuntime: { pluginsRootDir: () => pluginsRoot() },
    fleetAgent,
    fleetSamples,
  };
}
