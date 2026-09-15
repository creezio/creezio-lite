/**
 * Hub screencast des espaces IA — jumeau headless du hub kit
 * `@creezio/shell-ui/ui/lib/ai-screencast-hub.ts` (celui-ci vit dans le
 * process Next des forks historiques ; ce module vit dans le process harness/serveur).
 *
 * MÊME clé globalThis (`__tf2ScreencastHub`) : si les deux modules cohabitent
 * un jour dans un même process, ils partagent l'état au lieu de diverger.
 *
 * Backpressure : on ne garde QUE la dernière frame par IA — un spectateur
 * lent saute des frames au lieu d'accumuler une file.
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

/** Publie une frame ; retourne le nombre de spectateurs (auto-stop producteur). */
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

/** Abonne un spectateur (dernière frame livrée immédiatement). */
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
