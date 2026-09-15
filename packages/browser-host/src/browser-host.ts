/**
 * Hôte Chromium sidecar : un process Chromium PAR PROFIL (user-data-dir
 * persistant), pages pilotées en CDP websocket (protocole plat).
 *
 * `CdpPage` implémente `CdpTransport` — le driver partagé (shared-driver.ts)
 * fonctionne à l'identique de la version Electron (mêmes HELPERS, mêmes
 * entrées trusted Input.*).
 */

import { CdpConnection } from "./cdp-connection.js";
import {
  launchChromium,
  type ChromiumHandle,
  type ChromiumLaunchOptions,
} from "./chromium-process.js";
import { chromeUaForProduct } from "./chrome-ua.js";
import { DRIVER_HELPERS, FAKE_CURSOR_INJECT } from "./driver-scripts.js";
import type { CdpTransport } from "./shared-driver.js";

const ISOLATED_WORLD_NAME = "creezio_driver";

export type ScreencastFrameHandler = (dataB64: string) => void;

export class CdpPage implements CdpTransport {
  private isolatedContextId: number | null = null;
  private mainFrameId: string;
  private lastUrl = "about:blank";
  private screencastHandlerOff: (() => void) | null = null;
  private navListenerOff: (() => void) | null = null;
  closed = false;

  constructor(
    private readonly conn: CdpConnection,
    readonly targetId: string,
    readonly sessionId: string,
    mainFrameId: string,
  ) {
    this.mainFrameId = mainFrameId;
    // Navigation main frame → le monde isolé est détruit, invalider le cache.
    this.navListenerOff = conn.on("Page.frameNavigated", (params, sid) => {
      if (sid !== this.sessionId) return;
      const frame = params.frame as { id?: string; url?: string } | undefined;
      if (frame?.id === this.mainFrameId) {
        this.isolatedContextId = null;
        if (frame.url) this.lastUrl = frame.url;
      }
    });
  }

  cdp(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.conn.send(method, params, this.sessionId);
  }

  private async ensureIsolatedContext(): Promise<number> {
    if (this.isolatedContextId != null) return this.isolatedContextId;
    const res = await this.cdp("Page.createIsolatedWorld", {
      frameId: this.mainFrameId,
      worldName: ISOLATED_WORLD_NAME,
      grantUniveralAccess: false,
    });
    const id = Number(res.executionContextId);
    if (!Number.isFinite(id)) {
      throw new Error("Page.createIsolatedWorld sans executionContextId");
    }
    this.isolatedContextId = id;
    return id;
  }

  async evalIsolated<T>(expression: string): Promise<T> {
    const wrapped = `${DRIVER_HELPERS}\n${FAKE_CURSOR_INJECT}\n(async () => (${expression}))()`;
    const attempt = async (): Promise<T> => {
      const contextId = await this.ensureIsolatedContext();
      const res = await this.cdp("Runtime.evaluate", {
        expression: wrapped,
        contextId,
        awaitPromise: true,
        returnByValue: true,
      });
      const details = res.exceptionDetails as
        | { text?: string; exception?: { description?: string } }
        | undefined;
      if (details) {
        throw new Error(
          details.exception?.description || details.text || "Erreur eval monde isolé",
        );
      }
      return (res.result as { value?: unknown } | undefined)?.value as T;
    };
    try {
      return await attempt();
    } catch (e) {
      // Contexte détruit entre-temps (navigation) → recréer une fois.
      const msg = e instanceof Error ? e.message : String(e);
      if (/context/i.test(msg)) {
        this.isolatedContextId = null;
        return attempt();
      }
      throw e;
    }
  }

  async viewport(): Promise<{ width: number; height: number }> {
    try {
      const res = await this.cdp("Page.getLayoutMetrics");
      const vv = res.cssVisualViewport as
        | { clientWidth?: number; clientHeight?: number }
        | undefined;
      const width = Math.round(vv?.clientWidth || 1280);
      const height = Math.round(vv?.clientHeight || 800);
      return { width, height };
    } catch {
      return { width: 1280, height: 800 };
    }
  }

  async fallbackPage(): Promise<{ url: string; title: string }> {
    try {
      const res = await this.cdp("Runtime.evaluate", {
        expression: "({ url: location.href, title: document.title })",
        returnByValue: true,
      });
      const value = (res.result as { value?: { url?: string; title?: string } })
        ?.value;
      return {
        url: value?.url || this.lastUrl,
        title: value?.title || "",
      };
    } catch {
      return { url: this.lastUrl, title: "" };
    }
  }

  /** Navigue et attend le load (ou timeout) — parité loadCrm Electron. */
  async navigate(url: string, timeoutMs = 30_000): Promise<void> {
    this.lastUrl = url;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        off();
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      const off = this.conn.on("Page.loadEventFired", (_params, sid) => {
        if (sid === this.sessionId) finish();
      });
      this.cdp("Page.navigate", { url }).catch(() => finish());
    });
    this.isolatedContextId = null;
  }

  async setCookie(opts: {
    url: string;
    name: string;
    value: string;
    httpOnly?: boolean;
  }): Promise<void> {
    await this.cdp("Network.setCookie", {
      url: opts.url,
      name: opts.name,
      value: opts.value,
      httpOnly: opts.httpOnly !== false,
      sameSite: "Lax",
    });
  }

  async screenshot(format: "png" | "jpeg" = "jpeg", quality = 60): Promise<string> {
    const res = await this.cdp("Page.captureScreenshot", {
      format,
      ...(format === "jpeg" ? { quality } : {}),
    });
    return String(res.data || "");
  }

  /**
   * Capture continue CDP — chaque frame est ACKée immédiatement (sinon
   * Chromium cesse d'émettre) ; le throttle/backpressure vit chez l'appelant.
   */
  async startScreencast(onFrame: ScreencastFrameHandler): Promise<void> {
    await this.stopScreencast();
    this.screencastHandlerOff = this.conn.on(
      "Page.screencastFrame",
      (params, sid) => {
        if (sid !== this.sessionId) return;
        const sessionId = Number(params.sessionId);
        this.cdp("Page.screencastFrameAck", { sessionId }).catch(() => {});
        const data = typeof params.data === "string" ? params.data : "";
        if (data) onFrame(data);
      },
    );
    // everyNthFrame: 1 obligatoire — une page statique headless ne produit
    // qu'une frame compositor ; avec 2 elle serait sautée (0 frame émise).
    // Le throttle/backpressure vit chez l'appelant (BrowserScreencaster).
    await this.cdp("Page.startScreencast", {
      format: "jpeg",
      quality: 55,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    });
  }

  async stopScreencast(): Promise<void> {
    if (this.screencastHandlerOff) {
      this.screencastHandlerOff();
      this.screencastHandlerOff = null;
      await this.cdp("Page.stopScreencast").catch(() => {});
    }
  }

  async bringToFront(): Promise<void> {
    await this.cdp("Page.bringToFront").catch(() => {});
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.navListenerOff?.();
    await this.stopScreencast().catch(() => {});
    await this.conn
      .send("Target.closeTarget", { targetId: this.targetId })
      .catch(() => {});
  }
}

export type BrowserHostOptions = Omit<ChromiumLaunchOptions, "userAgent"> & {
  /** UA forcé — défaut : UA « humain » dérivé de la version du binaire. */
  userAgent?: string;
};

export class BrowserHost {
  private constructor(
    readonly chromium: ChromiumHandle,
    readonly conn: CdpConnection,
    readonly userAgent: string,
    readonly userDataDir: string,
  ) {}

  static async launch(opts: BrowserHostOptions): Promise<BrowserHost> {
    const chromium = await launchChromium(opts);
    let conn: CdpConnection;
    try {
      conn = await CdpConnection.connect(chromium.wsUrl);
    } catch (e) {
      chromium.kill();
      throw e;
    }
    const version = (await conn
      .send("Browser.getVersion")
      .catch(() => ({}))) as Record<string, unknown>;
    const userAgent =
      opts.userAgent || chromeUaForProduct(String(version.product || ""));
    return new BrowserHost(chromium, conn, userAgent, opts.userDataDir);
  }

  get alive(): boolean {
    return !this.conn.isClosed && this.chromium.child.exitCode === null;
  }

  async newPage(url = "about:blank"): Promise<CdpPage> {
    const created = await this.conn.send("Target.createTarget", { url: "about:blank" });
    const targetId = String(created.targetId || "");
    const attached = await this.conn.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const sessionId = String(attached.sessionId || "");
    await this.conn.send("Page.enable", {}, sessionId);
    await this.conn.send("Runtime.enable", {}, sessionId);
    await this.conn.send("Network.enable", {}, sessionId);
    // UA propre (supprime le token HeadlessChrome le cas échéant).
    await this.conn
      .send(
        "Network.setUserAgentOverride",
        { userAgent: this.userAgent },
        sessionId,
      )
      .catch(() => {});
    const tree = await this.conn.send("Page.getFrameTree", {}, sessionId);
    const mainFrameId = String(
      (tree.frameTree as { frame?: { id?: string } } | undefined)?.frame?.id || "",
    );
    const page = new CdpPage(this.conn, targetId, sessionId, mainFrameId);
    if (url && url !== "about:blank") {
      await page.navigate(url);
    }
    return page;
  }

  async close(): Promise<void> {
    this.conn.close();
    this.chromium.kill();
    await this.chromium.exited.catch(() => null);
  }
}
