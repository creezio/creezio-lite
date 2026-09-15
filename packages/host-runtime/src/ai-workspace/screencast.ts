// @ts-nocheck
/**
 * Screencast des espaces IA — vue live à distance (lecture seule).
 *
 * Capture CDP `Page.startScreencast` (JPEG q55, 1280×800, everyNthFrame:2)
 * sur la surface active de l'IA : son onglet web actif, sinon sa vue CRM.
 * Chaque frame est ACKée immédiatement (`Page.screencastFrameAck` — sinon
 * Chromium arrête d'en émettre), puis POSTée au serveur local (throttle
 * ~3 fps) qui la diffuse aux spectateurs SSE (ai-screencast-hub).
 *
 * Cycle de vie :
 * - start/stop pilotés par le serveur via le bridge
 *   (`ai_workspace_screencast_start` / `_stop`) au 1er / dernier spectateur ;
 * - filets Electron : re-ciblage 1 s (changement d'onglet IA), stop auto si
 *   le serveur répond viewers=0 plusieurs fois, si les POST échouent en
 *   rafale, ou après 30 min (durée max d'une session d'observation).
 */

import type { WebContents } from "electron";
import type { AiWorkspaceManager } from "./manager.js";
import type { AiSupplierTab as SupplierTab } from "./types.js";
import { log, logError } from "../logger.js";

/** Réponse du POST frame (viewers renvoyé par le hub serveur). */
export type PostFrameResult = { ok?: boolean; viewers?: number } | null;

export type AiScreencasterOptions = {
  manager: AiWorkspaceManager;
  /** POST authentifié vers /api/v1/desktop/screencast/frame (bridge). */
  postFrame: (payload: {
    ai_user_id: string;
    data: string;
    ts: number;
  }) => Promise<PostFrameResult>;
};

const THROTTLE_MS = 333; // ~3 fps
const RETARGET_MS = 1000;
const MAX_SESSION_MS = 30 * 60_000;
const MAX_ZERO_VIEWER_POSTS = 3;
const MAX_POST_ERRORS = 10;

type Session = {
  aiUserId: string;
  wc: WebContents | null;
  /** Onglet ciblé si la surface est un onglet web (flag debuggerAttached). */
  tab: SupplierTab | null;
  msgHandler:
    | ((event: unknown, method: string, params: Record<string, unknown>) => void)
    | null;
  retargetTimer: ReturnType<typeof setInterval> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  lastPostAt: number;
  framesAcked: number;
  framesPosted: number;
  zeroViewerPosts: number;
  postErrors: number;
  stopped: boolean;
};

export class AiScreencaster {
  private sessions = new Map<string, Session>();

  constructor(private readonly opts: AiScreencasterOptions) {}

  /** Surface courante de l'IA : onglet web actif sinon vue CRM. */
  private currentSurface(
    aiUserId: string,
  ): { wc: WebContents; tab: SupplierTab | null } | null {
    const tabs = this.opts.manager.getTabs(aiUserId);
    const active = tabs?.getActive() || null;
    if (active && !active.view.webContents.isDestroyed()) {
      return { wc: active.view.webContents, tab: active };
    }
    const view = this.opts.manager.getView(aiUserId);
    if (view && !view.webContents.isDestroyed()) {
      return { wc: view.webContents, tab: null };
    }
    return null;
  }

  async start(aiUserId: string): Promise<Record<string, unknown>> {
    const existing = this.sessions.get(aiUserId);
    if (existing && !existing.stopped) {
      return { ok: true, already: true };
    }
    const surface = this.currentSurface(aiUserId);
    if (!surface) {
      return {
        ok: false,
        error: "Espace IA absent — ensure d’abord",
        code: "ai_workspace_missing",
      };
    }
    const session: Session = {
      aiUserId,
      wc: null,
      tab: null,
      msgHandler: null,
      retargetTimer: null,
      maxTimer: null,
      lastPostAt: 0,
      framesAcked: 0,
      framesPosted: 0,
      zeroViewerPosts: 0,
      postErrors: 0,
      stopped: false,
    };
    this.sessions.set(aiUserId, session);
    try {
      await this.attachTo(session, surface.wc, surface.tab);
    } catch (e) {
      this.sessions.delete(aiUserId);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    session.retargetTimer = setInterval(() => {
      void this.retarget(session);
    }, RETARGET_MS);
    session.maxTimer = setTimeout(() => {
      log("screencast", `durée max atteinte (${aiUserId}) — stop`);
      void this.stop(aiUserId);
    }, MAX_SESSION_MS);
    log("screencast", `démarré pour ${aiUserId}`);
    return { ok: true };
  }

  async stop(aiUserId: string): Promise<Record<string, unknown>> {
    const session = this.sessions.get(aiUserId);
    if (!session) return { ok: true, already: true };
    this.teardown(session);
    this.sessions.delete(aiUserId);
    log(
      "screencast",
      `arrêté pour ${aiUserId} (${session.framesAcked} frames ack, ${session.framesPosted} postées)`,
    );
    return {
      ok: true,
      frames_acked: session.framesAcked,
      frames_posted: session.framesPosted,
    };
  }

  stopAll(): void {
    for (const aiUserId of Array.from(this.sessions.keys())) {
      void this.stop(aiUserId);
    }
  }

  /** Stats pour tests / diagnostic. */
  stats(aiUserId: string): { active: boolean; framesAcked: number; framesPosted: number } {
    const s = this.sessions.get(aiUserId);
    return {
      active: Boolean(s && !s.stopped),
      framesAcked: s?.framesAcked || 0,
      framesPosted: s?.framesPosted || 0,
    };
  }

  /** Attache le debugger + startScreencast sur la surface donnée. */
  private async attachTo(
    session: Session,
    wc: WebContents,
    tab: SupplierTab | null,
  ): Promise<void> {
    this.detachFrom(session);
    const dbg = wc.debugger;
    if (!dbg.isAttached()) {
      dbg.attach("1.3");
    }
    // Partage du debugger avec supplier-driver : signaler l'attache pour que
    // son ensureDebugger ne tente pas un attach() redondant (throw sinon).
    if (tab) tab.debuggerAttached = true;

    const handler = (
      _event: unknown,
      method: string,
      params: Record<string, unknown>,
    ) => {
      if (method !== "Page.screencastFrame") return;
      const sessionId = Number(params.sessionId);
      // ACK OBLIGATOIRE et immédiat, même si la frame est droppée par le
      // throttle : sans ack, Chromium cesse d'émettre des frames.
      dbg
        .sendCommand("Page.screencastFrameAck", { sessionId })
        .catch((e) => logError("screencast", e));
      session.framesAcked += 1;
      const data = typeof params.data === "string" ? params.data : "";
      if (!data || session.stopped) return;
      const now = Date.now();
      if (now - session.lastPostAt < THROTTLE_MS) return;
      session.lastPostAt = now;
      void this.postFrame(session, data);
    };
    // Signature Electron : (event, method, params, sessionId)
    dbg.on("message", handler as never);
    session.msgHandler = handler;
    session.wc = wc;
    session.tab = tab;

    await dbg.sendCommand("Page.startScreencast", {
      format: "jpeg",
      quality: 55,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 2,
    });
  }

  /** Coupe le screencast sur la surface courante (debugger reste attaché). */
  private detachFrom(session: Session): void {
    const wc = session.wc;
    if (wc && !wc.isDestroyed()) {
      try {
        if (wc.debugger.isAttached()) {
          wc.debugger.sendCommand("Page.stopScreencast").catch(() => {});
        }
      } catch {
        /* best-effort */
      }
      if (session.msgHandler) {
        try {
          wc.debugger.removeListener("message", session.msgHandler as never);
        } catch {
          /* ignore */
        }
      }
    }
    session.wc = null;
    session.tab = null;
    session.msgHandler = null;
  }

  /** Changement d'onglet IA (ou onglet fermé) → recibler la capture. */
  private async retarget(session: Session): Promise<void> {
    if (session.stopped) return;
    const surface = this.currentSurface(session.aiUserId);
    if (!surface) {
      // Espace détruit : stop propre.
      void this.stop(session.aiUserId);
      return;
    }
    if (session.wc === surface.wc && !surface.wc.isDestroyed()) return;
    try {
      await this.attachTo(session, surface.wc, surface.tab);
      log("screencast", `re-ciblage ${session.aiUserId}`);
    } catch (e) {
      logError("screencast", e);
    }
  }

  private async postFrame(session: Session, dataB64: string): Promise<void> {
    try {
      const res = await this.opts.postFrame({
        ai_user_id: session.aiUserId,
        data: dataB64,
        ts: Date.now(),
      });
      if (!res) throw new Error("POST frame sans réponse");
      session.postErrors = 0;
      session.framesPosted += 1;
      if (typeof res.viewers === "number" && res.viewers <= 0) {
        session.zeroViewerPosts += 1;
        if (session.zeroViewerPosts >= MAX_ZERO_VIEWER_POSTS) {
          log("screencast", `plus de spectateur (${session.aiUserId}) — stop auto`);
          void this.stop(session.aiUserId);
        }
      } else {
        session.zeroViewerPosts = 0;
      }
    } catch (e) {
      session.postErrors += 1;
      if (session.postErrors >= MAX_POST_ERRORS) {
        logError("screencast", e);
        log("screencast", `POST frames en échec répété (${session.aiUserId}) — stop`);
        void this.stop(session.aiUserId);
      }
    }
  }

  private teardown(session: Session): void {
    session.stopped = true;
    if (session.retargetTimer) clearInterval(session.retargetTimer);
    if (session.maxTimer) clearTimeout(session.maxTimer);
    session.retargetTimer = null;
    session.maxTimer = null;
    this.detachFrom(session);
  }
}
