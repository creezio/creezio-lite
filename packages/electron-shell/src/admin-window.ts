/**
 * Fenêtre « app admin » (cockpit serveur → /dashboard).
 * Port paramétré de electron/admin-window.ts.
 */

import fs from "node:fs";
import { logError } from "@creezio/host-runtime";

type AdminWindowState = {
  win: InstanceType<typeof import("electron").BaseWindow>;
  view: InstanceType<typeof import("electron").WebContentsView>;
};

let current: AdminWindowState | null = null;

export function adminWindowVisible(): boolean {
  return Boolean(current && !current.win.isDestroyed());
}

export async function openAdminWindow(opts: {
  baseUrl: string;
  partition: string;
  productName: string;
  preloadPath?: string;
  path?: string;
  instrument?: (
    view: InstanceType<typeof import("electron").WebContentsView>,
  ) => void;
}): Promise<{ ok: boolean; focused?: boolean }> {
  const electron = await import("electron");
  const BaseWindow = electron.BaseWindow;
  const WebContentsView = electron.WebContentsView;

  if (current && !current.win.isDestroyed()) {
    current.win.show();
    current.win.focus();
    return { ok: true, focused: true };
  }

  const win = new BaseWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: `${opts.productName} — App admin`,
    backgroundColor: "#14182f",
    autoHideMenuBar: true,
  });

  const preload =
    opts.preloadPath && fs.existsSync(opts.preloadPath)
      ? opts.preloadPath
      : undefined;

  const view = new WebContentsView({
    webPreferences: {
      partition: opts.partition,
      ...(preload ? { preload } : {}),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.contentView.addChildView(view);
  const fit = () => {
    const { width, height } = win.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  fit();
  win.on("resize", fit as never);
  win.on("closed", (() => {
    current = null;
  }) as never);

  opts.instrument?.(view);
  current = { win, view };

  const adminPath = opts.path ?? "/dashboard";
  const target = `${opts.baseUrl.replace(/\/+$/, "")}${adminPath.startsWith("/") ? adminPath : `/${adminPath}`}`;
  try {
    await view.webContents.loadURL(target);
  } catch (e) {
    logError("admin-window", e);
  }
  return { ok: true };
}

export function closeAdminWindow(): void {
  try {
    if (current && !current.win.isDestroyed()) {
      // BaseWindow n'expose pas toujours destroy dans le shim — hide + drop.
      current.win.hide();
    }
  } catch {
    /* ignore */
  }
  current = null;
}
