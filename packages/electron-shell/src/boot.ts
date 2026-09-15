/**
 * Façade boot Electron plateforme — structure générique (pas le métier).
 *
 * Les apps marques appellent `prepareDesktopBoot(manifest)` **avant**
 * `app.requestSingleInstanceLock()` pour isoler userData Client/Serveur.
 *
 * Packagé : userData = `{installDir}/data/` (portable, pas Roaming).
 * Dev : remap segment APPDATA historique si kind client/server.
 */

import fs from "node:fs";
import path from "node:path";
import type { AppManifest } from "@creezio/brand-config";
import { appSessionPartition, envKey } from "@creezio/brand-config";
import {
  APP_KIND_FILENAME,
  appKindEnvValue,
  appUserModelIdFor,
  bootBehaviorFor,
  displayNameFor,
  parseProfileArgv,
  readAppKindFile,
  resolveAppKind,
  resolvePackagedDataDir,
  userDataDirForAppKind,
  type BootBehavior,
  type ProfileLaunch,
  type RuntimeAppKind,
} from "@creezio/platform-core";
import { ensureLogsDir } from "@creezio/host-runtime";

export type DesktopBootContext = {
  manifest: AppManifest;
  appKind: RuntimeAppKind;
  bootBehavior: BootBehavior;
  profileLaunch: ProfileLaunch;
  sessionPartition: string;
  /** userData effectif après éventuel setPath. */
  userDataDir: string;
  /** true si ancré sous {installDir}/data. */
  installDataLayout: boolean;
};

export type PrepareDesktopBootOptions = {
  /** Dossiers candidats pour app-kind.json (à côté du main compilé). */
  appKindDirs?: string[];
  argv?: string[];
  env?: NodeJS.ProcessEnv;
};

/**
 * Résout kind + profil + comportement de boot, applique userData / AppUserModelId.
 * À appeler tôt dans main (après import electron, avant single-instance lock).
 */
export async function prepareDesktopBoot(
  manifest: AppManifest,
  options: PrepareDesktopBootOptions = {},
): Promise<DesktopBootContext> {
  const { app } = await import("electron");
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;

  const fileKind = readAppKindFile(
    options.appKindDirs ?? [
      path.dirname(process.execPath),
      path.join(process.resourcesPath || "", "app"),
      path.join(process.resourcesPath || "", "build", "electron"),
    ],
  );
  const appKind = resolveAppKind({
    env: appKindEnvValue(manifest, env) || env[envKey(manifest, "APP_KIND")],
    fileKind,
  });

  const profileLaunch = parseProfileArgv(argv, manifest);
  const bootBehavior = bootBehaviorFor(appKind, profileLaunch);

  let userData = app.getPath("userData");
  let installDataLayout = false;

  // Packagé : ancrer sous {installDir}/data (writable, visible pour l'utilisateur).
  if (app.isPackaged) {
    const dataDir = resolvePackagedDataDir({
      execPath: process.execPath,
      isPackaged: true,
      env,
    });
    if (dataDir) {
      fs.mkdirSync(dataDir, { recursive: true });
      if (path.resolve(dataDir) !== path.resolve(userData)) {
        app.setPath("userData", dataDir);
        userData = dataDir;
      }
      installDataLayout = true;
    }
  } else if (appKind === "server" || appKind === "client") {
    // Dev / unpackaged : remap segment historique (comportement inchangé).
    const target = userDataDirForAppKind(manifest, appKind, userData);
    if (target && path.resolve(target) !== path.resolve(userData)) {
      fs.mkdirSync(target, { recursive: true });
      app.setPath("userData", target);
      userData = target;
    }
  }

  if (appKind === "server" || appKind === "client") {
    app.setName(displayNameFor(manifest, appKind));
    try {
      app.setAppUserModelId(appUserModelIdFor(manifest, appKind));
    } catch {
      /* non-Windows */
    }
  }

  // Premier lancement : créer logs/ + crash-reports/ immédiatement.
  try {
    ensureLogsDir(userData);
    fs.mkdirSync(path.join(userData, "crash-reports"), { recursive: true });
  } catch {
    /* best-effort — initEarlyBootLogger / initLogger ont des fallbacks */
  }

  return {
    manifest,
    appKind,
    bootBehavior,
    profileLaunch,
    sessionPartition: appSessionPartition(manifest),
    userDataDir: userData,
    installDataLayout,
  };
}

/** Écrit `app-kind.json` à côté du main packagé (outil build). */
export function writeAppKindFile(
  outDir: string,
  kind: "server" | "client",
): string {
  // En asar packagé, le dossier n'est pas inscriptible — no-op.
  if (outDir.includes(`${path.sep}app.asar`) || outDir.includes(".asar")) {
    return path.join(outDir, APP_KIND_FILENAME);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, APP_KIND_FILENAME);
  fs.writeFileSync(out, JSON.stringify({ kind }, null, 2) + "\n", "utf8");
  return out;
}
