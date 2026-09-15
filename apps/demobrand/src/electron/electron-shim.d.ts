/**
 * Déclarations Electron minimales — compile sans installer le binaire.
 * Au runtime packagé, le vrai module `electron` est fourni par Electron.
 */
declare module "electron" {
  export const app: {
    requestSingleInstanceLock: () => boolean;
    whenReady: () => Promise<void>;
    quit: () => void;
    exit: (code?: number) => void;
    isPackaged: boolean;
    getPath: (name: string) => string;
    setPath: (name: string, p: string) => void;
    setName: (name: string) => void;
    setAppUserModelId: (id: string) => void;
    getVersion: () => string;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
  };

  export class BrowserWindow {
    constructor(opts: Record<string, unknown>);
    loadFile(filePath: string): Promise<void>;
    webContents: { send(channel: string, ...args: unknown[]): void };
  }

  export const contextBridge: {
    exposeInMainWorld: (apiKey: string, api: unknown) => void;
  };

  export const ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    send: (channel: string, ...args: unknown[]) => void;
    on: (
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => void,
    ) => void;
    removeListener: (
      channel: string,
      listener: (...args: unknown[]) => void,
    ) => void;
  };
}

declare namespace NodeJS {
  interface Process {
    resourcesPath: string;
  }
}
