/**
 * Screencast des sessions IA sidecar — parité AiScreencaster Electron :
 * capture `Page.startScreencast` (JPEG q55, 1280×800), throttle ~3 fps,
 * publication IN-PROCESS (publishScreencastFrame), re-ciblage 1 s sur la
 * surface active (onglet web actif sinon page CRM), stop auto si plus de
 * spectateurs ou après 30 min.
 */

import type { CdpPage } from "./browser-host.js";

const THROTTLE_MS = 333; // ~3 fps
const RETARGET_MS = 1000;
const MAX_SESSION_MS = 30 * 60_000;
const MAX_ZERO_VIEWER_TICKS = 3;

export type BrowserScreencasterOptions = {
  /** Surface courante de l'IA (onglet actif sinon CRM) — null si absente. */
  surfaceOf: (aiUserId: string) => CdpPage | null;
  /** Publication in-process (hub) ; retourne le nombre de spectateurs. */
  publishFrame: (
    aiUserId: string,
    dataB64: string,
  ) => { viewers: number; seq: number };
  onLog?: (line: string) => void;
};

type Session = {
  aiUserId: string;
  page: CdpPage | null;
  retargetTimer: ReturnType<typeof setInterval> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  lastPublishAt: number;
  framesPublished: number;
  zeroViewerTicks: number;
  stopped: boolean;
};

export class BrowserScreencaster {
  private sessions = new Map<string, Session>();

  constructor(private readonly opts: BrowserScreencasterOptions) {}

  private log(line: string): void {
    this.opts.onLog?.(`[screencast] ${line}`);
  }

  async start(aiUserId: string): Promise<Record<string, unknown>> {
    const existing = this.sessions.get(aiUserId);
    if (existing && !existing.stopped) {
      return { ok: true, already: true };
    }
    const surface = this.opts.surfaceOf(aiUserId);
    if (!surface) {
      return {
        ok: false,
        error: "Espace IA absent — ensure d’abord",
        code: "ai_workspace_missing",
      };
    }
    const session: Session = {
      aiUserId,
      page: null,
      retargetTimer: null,
      maxTimer: null,
      lastPublishAt: 0,
      framesPublished: 0,
      zeroViewerTicks: 0,
      stopped: false,
    };
    this.sessions.set(aiUserId, session);
    try {
      await this.attachTo(session, surface);
    } catch (e) {
      this.sessions.delete(aiUserId);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    session.retargetTimer = setInterval(() => {
      void this.retarget(session);
    }, RETARGET_MS);
    session.maxTimer = setTimeout(() => {
      this.log(`durée max atteinte (${aiUserId}) — stop`);
      void this.stop(aiUserId);
    }, MAX_SESSION_MS);
    this.log(`démarré pour ${aiUserId}`);
    return { ok: true };
  }

  async stop(aiUserId: string): Promise<Record<string, unknown>> {
    const session = this.sessions.get(aiUserId);
    if (!session) return { ok: true, already: true };
    await this.teardown(session);
    this.sessions.delete(aiUserId);
    this.log(`arrêté pour ${aiUserId} (${session.framesPublished} frames publiées)`);
    return { ok: true, frames_published: session.framesPublished };
  }

  stopAll(): void {
    for (const aiUserId of Array.from(this.sessions.keys())) {
      void this.stop(aiUserId);
    }
  }

  stats(aiUserId: string): { active: boolean; framesPublished: number } {
    const s = this.sessions.get(aiUserId);
    return {
      active: Boolean(s && !s.stopped),
      framesPublished: s?.framesPublished || 0,
    };
  }

  private async attachTo(session: Session, page: CdpPage): Promise<void> {
    await this.detachFrom(session);
    await page.startScreencast((dataB64) => {
      if (session.stopped) return;
      const now = Date.now();
      if (now - session.lastPublishAt < THROTTLE_MS) return;
      session.lastPublishAt = now;
      try {
        const { viewers } = this.opts.publishFrame(session.aiUserId, dataB64);
        session.framesPublished += 1;
        if (viewers <= 0) {
          session.zeroViewerTicks += 1;
          if (session.zeroViewerTicks >= MAX_ZERO_VIEWER_TICKS) {
            this.log(`plus de spectateur (${session.aiUserId}) — stop auto`);
            void this.stop(session.aiUserId);
          }
        } else {
          session.zeroViewerTicks = 0;
        }
      } catch {
        /* hub indisponible — frame droppée */
      }
    });
    session.page = page;
  }

  private async detachFrom(session: Session): Promise<void> {
    const page = session.page;
    session.page = null;
    if (page && !page.closed) {
      await page.stopScreencast().catch(() => {});
    }
  }

  /** Changement d'onglet IA (ou onglet fermé) → recibler la capture. */
  private async retarget(session: Session): Promise<void> {
    if (session.stopped) return;
    const surface = this.opts.surfaceOf(session.aiUserId);
    if (!surface) {
      void this.stop(session.aiUserId);
      return;
    }
    if (session.page === surface && !surface.closed) return;
    try {
      await this.attachTo(session, surface);
      this.log(`re-ciblage ${session.aiUserId}`);
    } catch {
      /* retenté au tick suivant */
    }
  }

  private async teardown(session: Session): Promise<void> {
    session.stopped = true;
    if (session.retargetTimer) clearInterval(session.retargetTimer);
    if (session.maxTimer) clearTimeout(session.maxTimer);
    session.retargetTimer = null;
    session.maxTimer = null;
    await this.detachFrom(session);
  }
}
