/**
 * Injection marque pour le runtime plugins kit (N1).
 *
 * Les modules sous `host/plugins/*` dérivent les env du manifest
 * (`${envPrefix}_*`) via `configurePluginHost(bindings)` au boot.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppManifest } from "@creezio/brand-config";
import type {
  PluginControlPlaneAcl,
  PluginControlPlaneAdapters,
  ProductHubStore,
} from "@creezio/product-hub";
import type { HostRuntimeContext } from "../context.js";
import {
  buildIsolatedNodeEnv,
  type EnsureDesktopNodeResult,
} from "../node-runtime.js";
import { applyOsSandboxEnv } from "../sandbox/embed-sandbox.js";
import { findFreePort } from "../server-env.js";

export type PluginLlmKeys = {
  openai?: string | null;
  anthropic?: string | null;
};

export type PluginHostBindings = {
  /** Préfixe env plugins (dérivé du manifest, ex. ACME). */
  envPrefix: string;
  productName: string;
  brandId: string;

  userDataDir: () => string;
  isPackaged: () => boolean;
  nodeBinary: () => string;
  nodeScript: (name: string) => string;
  gitBinary: () => string | null;
  n8nHomeDir: () => string;
  dbPath: () => string;
  nodeModulesPathForScripts?: () => string | null;

  ensureDesktopNode: (opts?: {
    minVersion?: string;
    onLog?: (line: string) => void;
  }) => Promise<EnsureDesktopNodeResult>;
  nodeMinForEmbeds: string;

  /** Défaut kit : `buildIsolatedNodeEnv` exporté par electron-shell. */
  buildIsolatedNodeEnv?: typeof buildIsolatedNodeEnv;
  getN8nBridgeEnv: (opts: {
    homeDir: string;
    localUiUrl: string;
  }) => Record<string, string>;
  n8nDesktopPort: number;
  getLlmKeys: () => PluginLlmKeys;
  /** Défaut kit : `applyOsSandboxEnv`. */
  applyOsSandboxEnv?: typeof applyOsSandboxEnv;
  /** Défaut kit : `findFreePort`. */
  findFreePort?: typeof findFreePort;

  /** Contexte hôte pour control-plane / token. */
  hostRuntimeContext: () => HostRuntimeContext;
  /** Manifest marque (souvent = hostRuntimeContext().manifest). */
  manifest: AppManifest;

  buildControlPlaneAdapters: () => PluginControlPlaneAdapters;
  createControlPlaneAcl: () => PluginControlPlaneAcl;
  ensureProductHubStore: () => ProductHubStore;
  closeProductHubStore: () => void;

  /**
   * Hook extras métier (accept-check, versions, llm…) avant handler kit.
   * Si omis, `handlePluginControlExtras` (control-extras) est utilisé.
   */
  handleBrandExtras?: (
    req: IncomingMessage,
    res: ServerResponse,
    token: string,
  ) => boolean | Promise<boolean>;

  /** Préfixe clés API CRM (ex. `acme_live_`). */
  apiKeyPrefix: string;
  /** Fichier clé plugin sous pluginDir — défaut `.${brandId}-plugin-api-key.json`. */
  crmKeyFileName?: string;
  /** Script DB upsert — défaut `ensure-hermes-crm-key-db.js`. */
  crmKeyDbScriptName?: string;
  /** Libellé DB — défaut `${productName} Plugin ${pluginId}`. */
  crmKeyDisplayName?: (pluginId: string) => string;

  /** Clé CRM hôte (Hermes) pour fetch Product Hub — adapters. */
  readHostCrmApiKey?: () => { apiKey: string } | null;

  gitAuthorName?: string;
  gitAuthorEmail?: string;
  /** Env force MinGit même hors win32 — défaut `${envPrefix}_FORCE_EMBEDDED_GIT`. */
  forceEmbeddedGitEnvKey?: string;
};

let configured: PluginHostBindings | null = null;

export function configurePluginHost(bindings: PluginHostBindings): void {
  configured = bindings;
}

export function getPluginHostBindings(): PluginHostBindings {
  if (!configured) {
    throw new Error(
      "configurePluginHost(bindings) requis avant usage du runtime plugins kit",
    );
  }
  return configured;
}

export function tryGetPluginHostBindings(): PluginHostBindings | null {
  return configured;
}

/** Tests uniquement. */
export function __resetPluginHostBindingsForTests(): void {
  configured = null;
}

export function pluginEnvKeys(
  bindings: PluginHostBindings,
  suffix: string,
): string[] {
  return [`${bindings.envPrefix}_${suffix}`];
}

/** Pose la valeur sur la clé `${envPrefix}_${suffix}` dérivée du manifest. */
export function assignPluginEnv(
  env: Record<string, string | undefined>,
  bindings: PluginHostBindings,
  suffix: string,
  value: string,
): void {
  for (const key of pluginEnvKeys(bindings, suffix)) {
    env[key] = value;
  }
}

export function resolveBuildIsolatedNodeEnv(
  bindings: PluginHostBindings,
): typeof buildIsolatedNodeEnv {
  return bindings.buildIsolatedNodeEnv || buildIsolatedNodeEnv;
}

export function resolveApplyOsSandboxEnv(
  bindings: PluginHostBindings,
): typeof applyOsSandboxEnv {
  return bindings.applyOsSandboxEnv || applyOsSandboxEnv;
}

export function resolveFindFreePort(
  bindings: PluginHostBindings,
): typeof findFreePort {
  return bindings.findFreePort || findFreePort;
}

export function pluginCrmKeyFileName(bindings: PluginHostBindings): string {
  return bindings.crmKeyFileName || `.${bindings.brandId}-plugin-api-key.json`;
}

export function pluginGitIdentity(bindings: PluginHostBindings): {
  name: string;
  email: string;
} {
  return {
    name: bindings.gitAuthorName || `${bindings.productName} Hermes`,
    email:
      bindings.gitAuthorEmail ||
      `hermes@${bindings.brandId.replace(/[^a-z0-9-]/gi, "")}.local`,
  };
}
