/**
 * Contrats / helpers pour le lancement du serveur Next embarqué.
 * Le spawn complet (node-runtime, secrets local-config) reste branché
 * par l'app marque — ici le noyau brand-agnostic.
 */

import type { ChildProcess } from "node:child_process";
import type { AppManifest } from "@creezio/brand-config";
import {
  buildNextHostEnv,
  findFreePort,
  waitForHealth,
  type BindHost,
} from "@creezio/platform-core";

export type RunningServer = {
  port: number;
  baseUrl: string;
  child: ChildProcess;
  stop: () => void;
};

export type StartServerPaths = {
  dbPath: string;
  assistantDbPath: string;
  uploadsDir: string;
  nextServerEntry: string;
  nodeBinary: string;
};

export type StartServerCoreOptions = {
  manifest: AppManifest;
  paths: StartServerPaths;
  bindHost?: BindHost;
  preferredPort?: number;
  meiliHost?: string | null;
  meiliMasterKey?: string | null;
  authSecret?: string;
  mcpJwtSecret?: string;
  extraEnv?: Record<string, string>;
  log?: (line: string) => void;
  /**
   * Spawn effectif — fourni par l'app (isole node-runtime / sandbox).
   * Reçoit port + env déjà construits.
   */
  spawnServer: (opts: {
    port: number;
    hostname: string;
    env: Record<string, string>;
    entry: string;
    nodeBinary: string;
  }) => ChildProcess;
};

/**
 * Alloue un port, construit l'env Next, spawn via callback, attend /health.
 */
export async function startNextServerCore(
  opts: StartServerCoreOptions,
): Promise<RunningServer> {
  const log = opts.log ?? ((l: string) => console.log(`[server] ${l}`));
  const bindHost = opts.bindHost ?? "127.0.0.1";
  const port = await findFreePort(opts.preferredPort, bindHost);
  const hostname = bindHost === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
  const baseUrl =
    bindHost === "0.0.0.0"
      ? `http://127.0.0.1:${port}`
      : `http://${hostname}:${port}`;

  const env = buildNextHostEnv({
    manifest: opts.manifest,
    port,
    hostname,
    dbPath: opts.paths.dbPath,
    assistantDbPath: opts.paths.assistantDbPath,
    uploadsDir: opts.paths.uploadsDir,
    meiliHost: opts.meiliHost,
    meiliMasterKey: opts.meiliMasterKey,
    authSecret: opts.authSecret,
    mcpJwtSecret: opts.mcpJwtSecret,
    extra: opts.extraEnv,
  });

  log(`spawn Next sur ${baseUrl} (entry ${opts.paths.nextServerEntry})`);
  const mergedEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...env })) {
    if (typeof v === "string") mergedEnv[k] = v;
  }
  const child = opts.spawnServer({
    port,
    hostname,
    env: mergedEnv,
    entry: opts.paths.nextServerEntry,
    nodeBinary: opts.paths.nodeBinary,
  });

  child.on("error", (e) => {
    log(`spawn error: ${e.message}`);
  });

  await waitForHealth(baseUrl);
  log(`serveur local prêt sur ${baseUrl}`);

  return {
    port,
    baseUrl,
    child,
    stop: () => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    },
  };
}

export { findFreePort, waitForHealth };
