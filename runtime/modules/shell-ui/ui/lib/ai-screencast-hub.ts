/**
 * Hub screencast des espaces IA — côté serveur Next (mémoire process).
 *
 * L'app desktop POSTe des frames JPEG (base64) via
 * POST /api/v1/desktop/screencast/frame ; les spectateurs s'abonnent en SSE
 * via GET /api/v1/tasks/screencast/:aiUserId/stream.
 *
 * Backpressure : on ne garde QUE la dernière frame par IA. Chaque spectateur
 * a un slot « latest » écrasé à chaque publication ; la livraison est
 * planifiée (setImmediate) et n'envoie que la frame la plus récente — un
 * spectateur lent saute des frames au lieu d'accumuler une file.
 *
 * Singleton globalThis : survit au HMR dev, simple module en prod.
 */

export type ScreencastFrame = {
  /** JPEG base64 (sans préfixe data:). */
  data: string;
  seq: number;
  ts: number;
};

type Viewer = {
  id: number;
  onFrame: (frame: ScreencastFrame) => void;
  latest: ScreencastFrame | null;
  scheduled: boolean;
};

type Channel = {
  viewers: Map<number, Viewer>;
  lastFrame: ScreencastFrame | null;
  seq: number;
};

const g = globalThis as unknown as {
  __tf2ScreencastHub?: Map<string, Channel>;
  __tf2ScreencastViewerId?: number;
};

function hub(): Map<string, Channel> {
  if (!g.__tf2ScreencastHub) g.__tf2ScreencastHub = new Map();
  return g.__tf2ScreencastHub;
}

function channel(aiUserId: string): Channel {
  const h = hub();
  let ch = h.get(aiUserId);
  if (!ch) {
    ch = { viewers: new Map(), lastFrame: null, seq: 0 };
    h.set(aiUserId, ch);
  }
  return ch;
}

function nextViewerId(): number {
  g.__tf2ScreencastViewerId = (g.__tf2ScreencastViewerId || 0) + 1;
  return g.__tf2ScreencastViewerId;
}

/** Planifie la livraison de la dernière frame au spectateur (skip si déjà planifiée). */
function scheduleDeliver(viewer: Viewer): void {
  if (viewer.scheduled) return;
  viewer.scheduled = true;
  setImmediate(() => {
    viewer.scheduled = false;
    const frame = viewer.latest;
    viewer.latest = null;
    if (!frame) return;
    try {
      viewer.onFrame(frame);
    } catch {
      /* spectateur mort — l'unsubscribe SSE fera le ménage */
    }
  });
}

/**
 * Publie une frame (appelé par la route desktop). Retourne le nombre de
 * spectateurs — l'app desktop s'auto-arrête si 0 plusieurs fois de suite.
 */
export function publishScreencastFrame(
  aiUserId: string,
  dataB64: string,
): { viewers: number; seq: number } {
  const ch = channel(aiUserId);
  ch.seq += 1;
  const frame: ScreencastFrame = { data: dataB64, seq: ch.seq, ts: Date.now() };
  ch.lastFrame = frame;
  ch.viewers.forEach((viewer) => {
    viewer.latest = frame;
    scheduleDeliver(viewer);
  });
  return { viewers: ch.viewers.size, seq: ch.seq };
}

/**
 * Abonne un spectateur. La dernière frame connue est livrée immédiatement
 * (affichage instantané si le screencast tourne déjà). Retourne l'unsubscribe.
 */
export function subscribeScreencast(
  aiUserId: string,
  onFrame: (frame: ScreencastFrame) => void,
): () => void {
  const ch = channel(aiUserId);
  const viewer: Viewer = {
    id: nextViewerId(),
    onFrame,
    latest: ch.lastFrame,
    scheduled: false,
  };
  ch.viewers.set(viewer.id, viewer);
  if (viewer.latest) scheduleDeliver(viewer);
  return () => {
    ch.viewers.delete(viewer.id);
  };
}

export function screencastViewerCount(aiUserId: string): number {
  return hub().get(aiUserId)?.viewers.size || 0;
}

/** Purge la dernière frame (fin de session — évite une image périmée). */
export function clearScreencastFrame(aiUserId: string): void {
  const ch = hub().get(aiUserId);
  if (ch) ch.lastFrame = null;
}
