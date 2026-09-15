// @ts-nocheck — Electron BaseWindow / WebContentsView (shim kit mince)
/**
 * Chrome assistant Electron (FAB) — gold kit paramétré (deepLink / title).
 * Electron chargé via loadElectron (pas d'import top-level — tests kit Node).
 */

import { logError } from "@creezio/host-runtime";
import { loadElectron } from "@creezio/host-runtime";

export const ASSISTANT_FAB_SIZE_PX = 56;
export const ASSISTANT_FAB_MARGIN_PX = 20;

export type AssistantChromeMode = "fab" | "hidden";

export type ContentRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AssistantChromeBrand = {
  productName: string;
  /** Protocole deep-link, ex. `acme-assistant`. */
  assistantProtocol: string;
  accent?: string;
  accentHover?: string;
};

export function assistantFabScreenRect(
  windowWidth: number,
  windowHeight: number,
): ContentRect {
  return {
    x: Math.max(
      0,
      windowWidth - ASSISTANT_FAB_MARGIN_PX - ASSISTANT_FAB_SIZE_PX,
    ),
    y: Math.max(
      0,
      windowHeight - ASSISTANT_FAB_MARGIN_PX - ASSISTANT_FAB_SIZE_PX,
    ),
    width: ASSISTANT_FAB_SIZE_PX,
    height: ASSISTANT_FAB_SIZE_PX,
  };
}

export function rectsOverlap(a: ContentRect, b: ContentRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function fabDataUrl(brand: AssistantChromeBrand): string {
  const accent = brand.accent || "#0284c7";
  const hover = brand.accentHover || "#0369a1";
  const title = String(brand.productName || "Assistant")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
  const proto = brand.assistantProtocol.replace(/[^a-z0-9+-]/gi, "");
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><title>Assistant</title>
<style>
  html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}
  button{
    width:100%;height:100%;border:0;border-radius:9999px;cursor:pointer;
    background:${accent};color:#fff;
    box-shadow:0 10px 15px -3px rgba(12,74,110,.35),0 4px 6px -4px rgba(12,74,110,.25);
    display:grid;place-items:center;
  }
  button:hover{background:${hover}}
  button:focus-visible{outline:2px solid #38bdf8;outline-offset:2px}
  svg{width:24px;height:24px;display:block}
</style></head>
<body>
<button type="button" id="fab" aria-label="Ouvrir l'assistant" title="Assistant ${title}">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
  </svg>
</button>
<script>
document.getElementById('fab').addEventListener('click', function () {
  location.href = '${proto}://open';
});
</script>
</body></html>`)}`;
}

type ElectronWin = InstanceType<typeof import("electron").BaseWindow>;
type ElectronView = InstanceType<typeof import("electron").WebContentsView>;

export class AssistantChromeOverlay {
  private view: ElectronView;
  private mode: AssistantChromeMode = "hidden";
  private openUrlPrefix: string;

  constructor(
    private win: ElectronWin,
    private onOpenRequest: () => void,
    brand: AssistantChromeBrand,
  ) {
    const { WebContentsView } = loadElectron();
    this.openUrlPrefix = `${brand.assistantProtocol.replace(/[^a-z0-9+-]/gi, "")}://open`;
    this.view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    try {
      this.view.setBackgroundColor("#00000000");
    } catch {
      /* anciennes builds Electron */
    }
    this.view.setVisible(false);
    this.win.contentView.addChildView(this.view);
    void this.view.webContents
      .loadURL(fabDataUrl(brand))
      .catch((e) => logError("assistant-chrome", e));

    this.view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.view.webContents.on("will-navigate", (e, url) => {
      e.preventDefault();
      if (url.startsWith(this.openUrlPrefix)) {
        try {
          this.onOpenRequest();
        } catch (err) {
          logError("assistant-chrome", err);
        }
      }
    });

    this.win.on("resize", () => this.applyBounds());
  }

  getView(): ElectronView {
    return this.view;
  }

  getMode(): AssistantChromeMode {
    return this.mode;
  }

  setMode(mode: AssistantChromeMode): void {
    this.mode = mode;
    this.applyBounds();
    if (mode === "fab") this.ensureTop();
  }

  getBounds(): ContentRect {
    try {
      const b = this.view.getBounds();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    } catch {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
  }

  isVisible(): boolean {
    try {
      return this.view.getVisible();
    } catch {
      return false;
    }
  }

  ensureTop(): void {
    if (this.mode !== "fab") return;
    try {
      this.win.contentView.removeChildView(this.view);
    } catch {
      /* pas encore enfant */
    }
    try {
      this.win.contentView.addChildView(this.view);
    } catch (e) {
      logError("assistant-chrome", e);
    }
    this.applyBounds();
  }

  destroy(): void {
    try {
      this.win.contentView.removeChildView(this.view);
    } catch {
      /* ignore */
    }
    try {
      if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
    } catch {
      /* ignore */
    }
  }

  private applyBounds(): void {
    try {
      if (this.mode !== "fab") {
        this.view.setVisible(false);
        return;
      }
      const { width, height } = this.win.getContentBounds();
      const rect = assistantFabScreenRect(width, height);
      this.view.setBounds(rect);
      this.view.setVisible(true);
    } catch (e) {
      logError("assistant-chrome", e);
    }
  }
}
