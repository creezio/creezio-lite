/**
 * Façades supplémentaires pour un `main.ts` mince (Phase B.2 / G).
 *
 * `prepareDesktopBoot` (boot.ts) + ces helpers couvrent le shell platform
 * avant le métier vertical (catalogue, tabs, AI workspace…).
 */

import path from "node:path";
import type { AppManifest } from "@creezio/brand-config";
import {
  resolveLocalConfigPath,
  resolveResourcesRoot,
  type PathsContext,
} from "@creezio/platform-core";
import type { DesktopBootContext } from "./boot.js";
import type { HostRuntimeContext } from "@creezio/host-runtime";
import { createLocalConfigStore, type LocalConfigStore } from "@creezio/host-runtime";
import { createHostStack, type HostStack } from "@creezio/host-runtime";
import { log as shellLog } from "@creezio/host-runtime";

export type CreateHostRuntimeOptions = {
  boot: DesktopBootContext;
  /** Racine ressources (resourcesPath ou repo crm/). */
  resourcesRoot?: string;
  getInstallId?: () => string;
  seedHermesSkills?: HostRuntimeContext["seedHermesSkills"];
  getHermesBridgeEnv?: HostRuntimeContext["getHermesBridgeEnv"];
  getPluginControlBridgeEnv?: HostRuntimeContext["getPluginControlBridgeEnv"];
};

/** Construit PathsContext depuis un boot déjà préparé. */
export function pathsContextFromBoot(
  boot: DesktopBootContext,
  resourcesRoot?: string,
): PathsContext {
  return {
    manifest: boot.manifest,
    userDataRoot: boot.userDataDir,
    isPackaged: false, // l'appelant peut override via createHostRuntime
    resourcesRoot:
      resourcesRoot ||
      (typeof process !== "undefined" && process.resourcesPath
        ? process.resourcesPath
        : boot.userDataDir),
  };
}

/** Contexte host + store local-config prêts pour createHostStack. */
export async function createHostRuntime(
  opts: CreateHostRuntimeOptions,
): Promise<{
  ctx: HostRuntimeContext;
  store: LocalConfigStore;
  paths: PathsContext;
}> {
  const { boot } = opts;
  let isPackaged = false;
  try {
    const electron = await import("electron");
    isPackaged = Boolean(electron.app?.isPackaged);
  } catch {
    isPackaged = false;
  }

  const paths: PathsContext = {
    manifest: boot.manifest,
    userDataRoot: boot.userDataDir,
    isPackaged,
    resourcesRoot:
      opts.resourcesRoot ||
      resolveResourcesRoot({
        manifest: boot.manifest,
        userDataRoot: boot.userDataDir,
        isPackaged,
        resourcesRoot: process.resourcesPath,
      }),
  };

  const configPath = resolveLocalConfigPath(paths);
  const store = await createLocalConfigStore({
    configPath,
    manifest: boot.manifest,
  });

  const ctx: HostRuntimeContext = {
    manifest: boot.manifest,
    userDataDir: boot.userDataDir,
    resourcesRoot: paths.resourcesRoot || boot.userDataDir,
    isPackaged,
    appKind: boot.appKind,
    log: (scope, line) => shellLog(scope, line),
    getInstallId: opts.getInstallId,
    seedHermesSkills: opts.seedHermesSkills,
    getHermesBridgeEnv: opts.getHermesBridgeEnv,
    getPluginControlBridgeEnv: opts.getPluginControlBridgeEnv,
  };

  return { ctx, store, paths };
}

/**
 * Boot + local-config + host stack (si allowLocalStack).
 * Point d'entrée recommandé pour un main mince Phase G.
 */
export async function prepareHostDesktop(opts: {
  manifest: AppManifest;
  prepareBoot: () => Promise<DesktopBootContext>;
  getInstallId?: () => string;
  seedHermesSkills?: HostRuntimeContext["seedHermesSkills"];
  getHermesBridgeEnv?: HostRuntimeContext["getHermesBridgeEnv"];
  resourcesRoot?: string;
}): Promise<{
  boot: DesktopBootContext;
  ctx: HostRuntimeContext;
  store: LocalConfigStore;
  host: HostStack | null;
}> {
  const boot = await opts.prepareBoot();
  const { ctx, store } = await createHostRuntime({
    boot,
    resourcesRoot: opts.resourcesRoot,
    getInstallId: opts.getInstallId,
    seedHermesSkills: opts.seedHermesSkills,
    getHermesBridgeEnv: opts.getHermesBridgeEnv,
  });

  const host = boot.bootBehavior.allowLocalStack
    ? createHostStack({ ctx, store })
    : null;

  return { boot, ctx, store, host };
}

/** Chemin config locale pour un boot donné. */
export function localConfigPathForBoot(boot: DesktopBootContext): string {
  return resolveLocalConfigPath({
    manifest: boot.manifest,
    userDataRoot: boot.userDataDir,
    isPackaged: true,
  });
}

/** Helper : dossier vendor sous resources. */
export function vendorDir(
  resourcesRoot: string,
  name: string,
): string {
  return path.join(resourcesRoot, "vendor", name);
}
