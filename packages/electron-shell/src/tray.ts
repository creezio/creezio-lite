/**
 * Icône Tray générique — labels depuis AppManifest.productName.
 * Port de electron/tray.ts (historique) — setup/refresh sync (require electron).
 */

import fs from "node:fs";
import path from "node:path";
import { log, logError } from "@creezio/host-runtime";
import { loadElectron } from "@creezio/host-runtime";

const TRAY_ICON_FALLBACK_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACAklEQVR42u2X2U7CQBSGeZwCgkvdtUAv+gx9g8IENC5xiUsUA/SKt5qkEMAoRmtcohKBtO/QHHMSLswMygytd/7Jd9P2XxISOo3F/iUhxfIMxfLqiuVRxfJ8xfKCEf7oGt4zIi+O54cknh+68fwQBMFnSejiRGGgJgoDmigMYErQq05VniR9M0n6QZL0ISSYYUqVzxQ/zZniJ0SM2IhUqaemSr0gVepBxGDm5J8jvfVB01sf8EfQ38u330l6+x2+E1ZsHnb8OGB2582d3XmD74QVm4cdY8vndl+Nud1XYAmrcZnYxQ2Y33upz++9AEtYjcvELm7Awv4zXdh/BlFYyXixixugHjz56sETiMJKxotd3IDFw8dg8fARRGEl48UubsDSkRssHbkgCisZL3ZxA5aPH/zl4wcQhZWMF7u4ASsn93Tl5B5EYSXjxS5uwOrpXX319A5EYSXjxS5uwNpZ11g764IorGS82DX233D9/NZdP78FEViJ+rDjx3fBxsUN2bi4ARFYifqw49c34ublNd28vIZJsBLxYPbE84BW7qhauRNo5Q5EDGaKnQ+1q7apXbUhYuTOhZlKy8xUWkGm0oLQYIY51ck4W22qWWqTZqtNmBL0qqG/D3K1BsnVGm6u1gBB8FkS+ReSbjuGbjt13Xaobju+bjvBCH90De8ZsX9J6AvaetnzgauSsgAAAABJRU5ErkJggg==";

export type TrayAiWorkspaceEntry = {
  userId: string;
  label: string;
  visible: boolean;
};

export type TrayControllerOptions = {
  productName: string;
  /** Chemin icône tray (PNG) — optionnel. */
  iconPath?: string;
  resourcesRoot?: string;
  isPackaged?: boolean;
  showWindow: () => void;
  quit: () => void;
  listAiWorkspaces?: () => TrayAiWorkspaceEntry[];
  openAiWorkspace?: (userId: string) => void;
  closeAiWorkspace?: (userId: string) => void;
};

export class TrayController {
  private tray: InstanceType<typeof import("electron").Tray> | null = null;

  constructor(private readonly opts: TrayControllerOptions) {}

  get active(): boolean {
    return this.tray !== null;
  }

  private resolveIconPath(): string | null {
    if (this.opts.iconPath) return this.opts.iconPath;
    const root = this.opts.resourcesRoot;
    if (!root) return null;
    if (this.opts.isPackaged) {
      return path.join(process.resourcesPath, "tray-icon.png");
    }
    return path.join(root, "resources", "tray-icon.png");
  }

  private loadTrayIcon(): import("electron").NativeImage {
    const { nativeImage } = loadElectron();
    try {
      const p = this.resolveIconPath();
      if (p && fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) return img;
      }
    } catch (e) {
      logError("tray", e);
    }
    return nativeImage.createFromDataURL(
      `data:image/png;base64,${TRAY_ICON_FALLBACK_B64}`,
    );
  }

  private buildMenu(): import("electron").Menu {
    const { Menu } = loadElectron();
    const name = this.opts.productName;
    const aiEntries = (() => {
      try {
        return this.opts.listAiWorkspaces?.() ?? [];
      } catch (e) {
        logError("tray", e);
        return [];
      }
    })();
    const aiSubmenu = aiEntries.map((entry) => ({
      label: `${entry.label}${entry.visible ? "" : " (masqué)"}`,
      submenu: [
        {
          label: "Ouvrir",
          click: () => this.opts.openAiWorkspace?.(entry.userId),
        },
        {
          label: "Fermer réellement",
          click: () => this.opts.closeAiWorkspace?.(entry.userId),
        },
      ],
    }));
    return Menu.buildFromTemplate([
      {
        label: `Ouvrir ${name}`,
        click: () => this.opts.showWindow(),
      },
      ...(aiSubmenu.length
        ? ([
            { type: "separator" },
            { label: "Workspaces IA", submenu: aiSubmenu },
          ] as import("electron").MenuItemConstructorOptions[])
        : []),
      { type: "separator" },
      {
        label: `Quitter ${name}`,
        click: () => this.opts.quit(),
      },
    ]);
  }

  refresh(): void {
    try {
      this.tray?.setContextMenu(this.buildMenu());
    } catch (e) {
      logError("tray", e);
    }
  }

  /** true si le tray est opérationnel (close → hide possible). */
  setup(): boolean {
    if (this.tray) return true;
    try {
      const { Tray } = loadElectron();
      const tray = new Tray(this.loadTrayIcon());
      tray.setToolTip(`${this.opts.productName} — actif en arrière-plan`);
      tray.setContextMenu(this.buildMenu());
      tray.on("click", () => this.opts.showWindow());
      this.tray = tray;
      log("tray", "icône tray active (fermer la fenêtre = arrière-plan)");
      return true;
    } catch (e) {
      logError("tray", e);
      log(
        "tray",
        "création du tray impossible — fermer la fenêtre quittera l'app",
      );
      this.tray = null;
      return false;
    }
  }

  destroy(): void {
    try {
      this.tray?.destroy();
    } catch {
      /* ignore */
    }
    this.tray = null;
  }
}

export function installCloseToTray(
  win: InstanceType<typeof import("electron").BaseWindow>,
  opts: {
    trayActive: () => boolean;
    isQuitting: () => boolean;
    closeToTrayEnabled: () => boolean;
    productName?: string;
    /** Si true (ex. boot raté), X / Alt+F4 quitte vraiment au lieu de masquer. */
    forceQuitOnClose?: () => boolean;
  },
): void {
  // 2ᵉ fermeture (fenêtre déjà masquée, ou double Alt+F4 < 2s) → quit réel.
  // Évite les zombies XFCE/RDP quand le tray est peu visible et le boot a planté.
  let lastHideAt = 0;
  win.on("close", ((e: { preventDefault: () => void }) => {
    if (opts.isQuitting()) return;
    if (!opts.trayActive()) return;
    if (!opts.closeToTrayEnabled()) return;
    if (opts.forceQuitOnClose?.()) {
      log("tray", "fermeture forcée (boot/état non prêt) — quit");
      return;
    }
    let alreadyHidden = false;
    try {
      alreadyHidden = !win.isVisible();
    } catch {
      alreadyHidden = false;
    }
    const now = Date.now();
    if (alreadyHidden || (lastHideAt > 0 && now - lastHideAt < 2000)) {
      log(
        "tray",
        `2ᵉ fermeture — quit réel (${opts.productName ?? "app"})`,
      );
      return;
    }
    e.preventDefault();
    win.hide();
    lastHideAt = now;
    log(
      "tray",
      `fenêtre masquée — ${opts.productName ?? "app"} reste actif en arrière-plan (re-fermer = quitter)`,
    );
  }) as never);
}

export function applyLaunchAtStartup(enabled: boolean): void {
  try {
    const { app } = loadElectron();
    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: [],
    });
    log("tray", `launchAtStartup → ${enabled ? "activé" : "désactivé"}`);
  } catch (e) {
    logError("tray", e);
  }
}
