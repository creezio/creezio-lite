/**
 * Preload — bridge desktop générique (pas d'API catalogue TF).
 *
 * Zéro import @creezio/* : ce fichier est copié hors asar (extraResources).
 */
import { contextBridge, ipcRenderer } from "electron";

const BRIDGE_NAME = "demobrandDesktop";

/** Sous-ensemble générique — étendre localement selon la marque. */
const api = {
  isDesktop: true as const,
  getInfo: () => ipcRenderer.invoke("desktop:info"),
  getConnectionProfile: () => ipcRenderer.invoke("connection:get"),
  chooseConnection: (profile: unknown) =>
    ipcRenderer.invoke("connection:choose", profile),
  getSetupStatus: () => ipcRenderer.invoke("setup:status"),
  completeSetup: (payload: unknown) =>
    ipcRenderer.invoke("setup:complete", payload),
};

contextBridge.exposeInMainWorld(BRIDGE_NAME, api);
