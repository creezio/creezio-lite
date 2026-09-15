/** Peer Electron optionnel — types minimaux pour la façade. */
declare module "electron" {
  export const app: {
    isPackaged: boolean;
    requestSingleInstanceLock: () => boolean;
    whenReady: () => Promise<void>;
    quit: () => void;
    on: (event: string, cb: () => void) => void;
    resourcesPath: string;
    exit: (code?: number) => void;
  };
  export const ipcMain: unknown;
  export class BrowserWindow {
    constructor(opts: Record<string, unknown>);
    loadFile(p: string): Promise<void>;
  }
}
