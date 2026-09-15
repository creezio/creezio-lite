/**
 * Déclarations minimales Electron / electron-updater pour compiler le kit
 * sans installer le binaire Electron (peerDependency côté apps marques).
 */

declare module "electron" {
  export interface WebContents {
    isDestroyed(): boolean;
    send(channel: string, ...args: unknown[]): void;
    loadURL(url: string): Promise<void>;
    getURL(): string;
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
    once(event: string, listener: (...args: unknown[]) => void): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
    removeListener(event: string, listener: (...args: unknown[]) => void): void;
  }

  export interface NativeImage {
    isEmpty(): boolean;
  }

  export type Menu = unknown;

  export interface MenuItemConstructorOptions {
    label?: string;
    type?: string;
    click?: () => void;
    submenu?: MenuItemConstructorOptions[];
  }

  export const app: {
    getVersion: () => string;
    isPackaged: boolean;
    getPath: (name: string) => string;
    setPath: (name: string, path: string) => void;
    setName: (name: string) => void;
    setAppUserModelId: (id: string) => void;
    quit: () => void;
    setLoginItemSettings: (settings: {
      openAtLogin: boolean;
      args?: string[];
    }) => void;
  };

  export const ipcMain: {
    handle: (
      channel: string,
      listener: (...args: unknown[]) => unknown,
    ) => void;
  };

  export const session: {
    fromPartition: (partition: string) => {
      clearStorageData: () => Promise<void>;
      clearCache: () => Promise<void>;
      cookies: {
        remove: (url: string, name: string) => Promise<void>;
        set: (details: Record<string, unknown>) => Promise<void>;
      };
    };
  };

  export const safeStorage: {
    isEncryptionAvailable: () => boolean;
    encryptString: (plain: string) => Buffer;
    decryptString: (buffer: Buffer) => string;
  };

  export const Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => Menu;
  };

  export const nativeImage: {
    createFromPath: (p: string) => NativeImage;
    createFromDataURL: (dataUrl: string) => NativeImage;
  };

  export class Tray {
    constructor(image: NativeImage);
    setToolTip(tip: string): void;
    setContextMenu(menu: Menu): void;
    on(event: string, listener: () => void): void;
    destroy(): void;
  }

  export class BaseWindow {
    constructor(opts: Record<string, unknown>);
    show(): void;
    showInactive(): void;
    hide(): void;
    focus(): void;
    restore(): void;
    destroy(): void;
    isDestroyed(): boolean;
    isVisible(): boolean;
    isMinimized(): boolean;
    setTitle(title: string): void;
    getContentBounds(): {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    contentView: {
      addChildView: (view: WebContentsView) => void;
      removeChildView: (view: WebContentsView) => void;
    };
    on(event: string, listener: (...args: never[]) => void): void;
  }

  export class WebContentsView {
    constructor(opts: Record<string, unknown>);
    setBounds(bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    }): void;
    getBounds(): {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    setVisible(visible: boolean): void;
    getVisible(): boolean;
    setBackgroundColor(color: string): void;
    webContents: WebContents;
  }

  export const shell: {
    openExternal: (url: string) => Promise<void>;
  };
}

declare module "electron-updater" {
  export const autoUpdater: {
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
}

declare namespace NodeJS {
  interface Process {
    resourcesPath: string;
  }
}
