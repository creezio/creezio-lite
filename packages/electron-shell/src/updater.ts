/**
 * Auto-update via electron-updater (provider generic).
 * Port de electron/updater.ts — feed URL fourni par l'appelant (manifest).
 *
 * Les apps marques appellent `setupAutoUpdater({ feedUrl, … })` après boot UI.
 */

import {
  initialUpdateStatus,
  reduceUpdateEvent,
  type UpdateStatus,
} from "@creezio/platform-core";
import { IpcChannels } from "@creezio/shell";
import fs from "node:fs";
import path from "node:path";

export type { UpdateStatus } from "@creezio/platform-core";
export { reduceUpdateEvent } from "@creezio/platform-core";

export type UpdaterSend = (channel: string, payload: UpdateStatus) => void;

export type SetupAutoUpdaterOptions = {
  /** URL feed (manifest.client.feedUrl ou server.feedUrl). */
  feedUrl?: string;
  log?: (line: string) => void;
  send?: UpdaterSend;
  /**
   * Hook optionnel (ops / fleet) — pas de dépendance hard au journal marque.
   */
  onTrack?: (event: {
    kind: string;
    outcome?: string;
    reason?: string;
    ctx?: Record<string, unknown>;
  }) => void;
};

type AutoUpdaterLike = {
  logger: unknown;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  setFeedURL?: (opts: { provider: string; url: string }) => void;
  on: (event: string, listener: (...args: never[]) => void) => void;
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
};

const CHECK_INTERVAL_MS = 4 * 3600 * 1000;

let status: UpdateStatus = initialUpdateStatus();
let autoUpdater: AutoUpdaterLike | null = null;
let sendToRenderer: UpdaterSend | null = null;
let checkTimer: ReturnType<typeof setInterval> | null = null;
let ipcRegistered = false;
let downloading = false;
let updaterSetupDone = false;
let trackHook: SetupAutoUpdaterOptions["onTrack"] | undefined;

function publish(next: UpdateStatus): void {
  status = next;
  try {
    sendToRenderer?.(IpcChannels.update.changed, status);
  } catch {
    /* renderer pas prêt */
  }
}

function apply(
  event: Parameters<typeof reduceUpdateEvent>[1],
  log?: (line: string) => void,
): void {
  const next = reduceUpdateEvent(status, event);
  if (event.type === "available" || event.type === "not-available") {
    trackHook?.({
      kind: "updater.check",
      outcome: event.type,
      ctx: event.type === "available" ? { version: event.version } : undefined,
    });
  } else if (event.type === "downloaded") {
    trackHook?.({
      kind: "updater.downloaded",
      ctx: { version: event.version },
    });
  } else if (event.type === "error") {
    trackHook?.({
      kind: "updater.check",
      outcome: "error",
      reason: event.message.slice(0, 300),
    });
  }
  if (log) {
    if (event.type === "available")
      log(`mise à jour disponible : ${event.version}`);
    else if (event.type === "downloaded")
      log(`mise à jour ${event.version} prête à installer`);
    else if (event.type === "error")
      log(`erreur auto-update : ${event.message}`);
    else if (event.type === "not-available") log("à jour");
  }
  publish(next);
}

export function getUpdaterStatus(): UpdateStatus {
  return { ...status };
}

export async function checkForUpdatesNow(): Promise<UpdateStatus> {
  if (!autoUpdater) return getUpdaterStatus();
  if (status.state === "downloading" || status.state === "ready")
    return getUpdaterStatus();
  apply({ type: "checking" });
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    apply({
      type: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  }
  return getUpdaterStatus();
}

export async function downloadAndInstallUpdate(): Promise<UpdateStatus> {
  if (!autoUpdater) {
    apply({ type: "error", message: "Auto-update indisponible" });
    return getUpdaterStatus();
  }
  if (downloading) return getUpdaterStatus();
  if (status.state === "ready") {
    autoUpdater.quitAndInstall(false, true);
    return getUpdaterStatus();
  }
  if (status.state !== "available") {
    await checkForUpdatesNow();
  }
  if (status.state !== "available") {
    if (status.state !== "error") {
      apply({
        type: "error",
        message: "Aucune mise à jour à télécharger",
      });
    }
    return getUpdaterStatus();
  }
  downloading = true;
  apply({ type: "progress", percent: 0 });
  try {
    await autoUpdater.downloadUpdate();
    autoUpdater.quitAndInstall(false, true);
  } catch (e) {
    downloading = false;
    apply({
      type: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  }
  return getUpdaterStatus();
}

export async function registerUpdateIpc(): Promise<void> {
  if (ipcRegistered) return;
  ipcRegistered = true;
  const { ipcMain } = await import("electron");
  const C = IpcChannels.update;
  ipcMain.handle(C.getStatus, () => getUpdaterStatus());
  ipcMain.handle(C.status, () => getUpdaterStatus());
  ipcMain.handle(C.check, () => checkForUpdatesNow());
  ipcMain.handle(C.downloadInstall, () => downloadAndInstallUpdate());
}

export async function setupAutoUpdater(
  options: SetupAutoUpdaterOptions = {},
): Promise<void> {
  const log = options.log ?? ((l: string) => console.log(`[updater] ${l}`));
  if (options.send) sendToRenderer = options.send;
  trackHook = options.onTrack;
  await registerUpdateIpc();

  if (updaterSetupDone) {
    if (options.send) log("updater déjà actif — canal renderer mis à jour");
    return;
  }
  updaterSetupDone = true;

  const { app } = await import("electron");
  status = {
    state: "idle",
    currentVersion: app.getVersion(),
    updateAvailable: false,
  };

  if (!app.isPackaged) {
    apply({ type: "disabled", reason: "App non packagée (dev)" }, log);
    log("app non packagée — auto-update désactivé (dev).");
    return;
  }

  const updateYml = path.join(process.resourcesPath, "app-update.yml");
  if (!fs.existsSync(updateYml)) {
    apply(
      {
        type: "disabled",
        reason: "Aucun feed de releases (app-update.yml manquant)",
      },
      log,
    );
    log("auto-update désactivé : app-update.yml manquant.");
    return;
  }

  try {
    // electron-updater est publié en CJS : selon l'interop ESM (import()
    // depuis un bundle CJS Electron vs ESM pur), l'export vit sur `mod`
    // ou sur `mod.default`.
    const mod = (await import("electron-updater")) as {
      autoUpdater?: unknown;
      default?: { autoUpdater?: unknown };
    };
    const au = mod.autoUpdater ?? mod.default?.autoUpdater;
    if (!au) {
      apply(
        {
          type: "disabled",
          reason: "electron-updater sans export autoUpdater (interop ESM)",
        },
        log,
      );
      log("auto-update désactivé : export autoUpdater introuvable dans electron-updater.");
      return;
    }
    autoUpdater = au as AutoUpdaterLike;
    autoUpdater.logger = {
      info: log,
      warn: log,
      error: log,
      debug: log,
    } as never;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;

    if (options.feedUrl && typeof autoUpdater.setFeedURL === "function") {
      autoUpdater.setFeedURL({
        provider: "generic",
        url: options.feedUrl,
      });
    }

    autoUpdater.on("checking-for-update", (() => {
      apply({ type: "checking" }, log);
    }) as never);
    autoUpdater.on("update-available", ((info: { version?: string }) => {
      apply({ type: "available", version: String(info?.version ?? "") }, log);
    }) as never);
    autoUpdater.on("update-not-available", (() => {
      apply({ type: "not-available" }, log);
    }) as never);
    autoUpdater.on(
      "download-progress",
      ((p: {
        percent?: number;
        bytesPerSecond?: number;
        transferred?: number;
        total?: number;
      }) => {
        apply(
          {
            type: "progress",
            percent: Number(p?.percent ?? 0),
            bytesPerSecond: p?.bytesPerSecond,
            transferred: p?.transferred,
            total: p?.total,
          },
          log,
        );
      }) as never,
    );
    autoUpdater.on("update-downloaded", ((info: { version?: string }) => {
      downloading = false;
      apply(
        {
          type: "downloaded",
          version: String(info?.version ?? status.availableVersion ?? ""),
        },
        log,
      );
    }) as never);
    autoUpdater.on("error", ((e: Error) => {
      downloading = false;
      apply({ type: "error", message: e?.message || String(e) }, log);
    }) as never);

    void checkForUpdatesNow();
    if (checkTimer) clearInterval(checkTimer);
    checkTimer = setInterval(() => {
      if (status.state === "downloading" || status.state === "ready") return;
      void checkForUpdatesNow();
    }, CHECK_INTERVAL_MS);

    log(
      `auto-update actif (v${app.getVersion()})${
        options.feedUrl ? ` — feed ${options.feedUrl}` : " — feed generic"
      }.`,
    );
  } catch (e) {
    autoUpdater = null;
    apply(
      {
        type: "disabled",
        reason: e instanceof Error ? e.message : String(e),
      },
      log,
    );
    log(
      `auto-update indisponible (${e instanceof Error ? e.message : e})`,
    );
  }
}

export function setUpdaterRenderer(send: UpdaterSend | null): void {
  sendToRenderer = send;
}

export function sendUpdateToWebContents(wc: {
  isDestroyed: () => boolean;
  send: (channel: string, ...args: unknown[]) => void;
} | null | undefined): UpdaterSend {
  return (channel, payload) => {
    try {
      if (wc && !wc.isDestroyed()) wc.send(channel, payload);
    } catch {
      /* ignore */
    }
  };
}
