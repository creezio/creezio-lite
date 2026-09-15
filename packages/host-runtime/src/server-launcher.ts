/**
 * Spawn serveur Next standalone — wrapper marque autour de `startNextServerCore` (N2).
 * Secrets / ports / paths / spawn injectés (plus de hardcode TF2_*).
 */

import fs from "node:fs";
import type { ChildProcess } from "node:child_process";
import type { AppManifest } from "@creezio/brand-config";
import {
  startNextServerCore,
  type RunningServer,
  type StartServerCoreOptions,
  type StartServerPaths,
} from "./server-env.js";

export type { RunningServer } from "./server-env.js";
export type { BindHost } from "@creezio/platform-core";
export { findFreePort, waitForHealth } from "./server-env.js";

export type BrandServerLauncherDeps = {
  manifest: AppManifest;
  paths: StartServerPaths;
  preferredPort: number;
  ensureAuthSecret: () => string;
  ensureMcpJwtSecret: () => string;
  getLocalAuth: () => { authUser: string; authPassword: string } | null;
  getLlmKeys: () => Record<string, string | undefined>;
  /** Env additionnels (crash endpoint, plugins dir, …). */
  buildExtraEnv?: () => Record<string, string>;
  /**
   * Spawn effectif (node isolé / sandbox marque).
   * Requis — le kit ne spawn pas lui-même sans ce hook.
   */
  spawnServer: StartServerCoreOptions["spawnServer"];
};

export type StartBrandServerOptions = {
  meiliHost?: string | null;
  meiliMasterKey?: string | null;
  extraEnv?: Record<string, string>;
  onLog?: (line: string) => void;
  bindHost?: "127.0.0.1" | "0.0.0.0";
};

/**
 * Démarre Next via le noyau kit + injection marque.
 */
export async function startBrandNextServer(
  deps: BrandServerLauncherDeps,
  opts: StartBrandServerOptions = {},
): Promise<RunningServer> {
  const entry = deps.paths.nextServerEntry;
  if (!fs.existsSync(entry)) {
    throw new Error(
      `Serveur Next standalone introuvable : ${entry}\n` +
        `Lancer d'abord : npm run build && npm run electron:server`,
    );
  }
  const auth = deps.getLocalAuth();
  const llm = deps.getLlmKeys();
  const extra: Record<string, string> = {
    AUTH_USER: auth?.authUser ?? "",
    AUTH_PASSWORD: auth?.authPassword ?? "",
    ...(deps.buildExtraEnv?.() || {}),
    ...(opts.extraEnv || {}),
  };
  for (const [k, v] of Object.entries(llm)) {
    if (v) extra[k] = v;
  }
  return startNextServerCore({
    manifest: deps.manifest,
    paths: deps.paths,
    bindHost: opts.bindHost,
    preferredPort: deps.preferredPort,
    meiliHost: opts.meiliHost,
    meiliMasterKey: opts.meiliMasterKey,
    authSecret: deps.ensureAuthSecret(),
    mcpJwtSecret: deps.ensureMcpJwtSecret(),
    extraEnv: extra,
    log: opts.onLog,
    spawnServer: deps.spawnServer,
  });
}

/** Helper typé pour les marques qui re-exportent le spawn. */
export type ServerSpawnFn = (opts: {
  port: number;
  hostname: string;
  env: Record<string, string>;
  entry: string;
  nodeBinary: string;
}) => ChildProcess;
