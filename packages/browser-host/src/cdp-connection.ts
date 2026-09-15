/**
 * Client CDP websocket minimal (protocole plat, sessions Target.attachToTarget
 * flatten:true) — WebSocket natif Node ≥ 22, zéro dépendance.
 */

type CdpEventHandler = (
  params: Record<string, unknown>,
  sessionId?: string,
) => void;

type PendingCommand = {
  resolve: (result: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

export class CdpConnection {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, PendingCommand>();
  private handlers = new Map<string, Set<CdpEventHandler>>();
  private closed = false;
  private closeListeners = new Set<() => void>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      this.onMessage(String((ev as MessageEvent).data));
    });
    const onClose = () => {
      this.closed = true;
      const err = new Error("Connexion CDP fermée");
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
      for (const fn of this.closeListeners) {
        try {
          fn();
        } catch {
          /* ignore */
        }
      }
    };
    ws.addEventListener("close", onClose);
    ws.addEventListener("error", onClose);
  }

  static async connect(
    wsUrl: string,
    timeoutMs = 15_000,
  ): Promise<CdpConnection> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout connexion CDP (${wsUrl})`)),
        timeoutMs,
      );
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`Connexion CDP impossible (${wsUrl})`));
      });
    });
    return new CdpConnection(ws);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  onClose(fn: () => void): () => void {
    this.closeListeners.add(fn);
    return () => this.closeListeners.delete(fn);
  }

  private onMessage(raw: string): void {
    let msg: {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      sessionId?: string;
      result?: Record<string, unknown>;
      error?: { message?: string; code?: number };
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) {
        pending.reject(
          new Error(msg.error.message || `Erreur CDP (code ${msg.error.code})`),
        );
      } else {
        pending.resolve(msg.result || {});
      }
      return;
    }
    if (msg.method) {
      const set = this.handlers.get(msg.method);
      if (set) {
        for (const fn of set) {
          try {
            fn(msg.params || {}, msg.sessionId);
          } catch {
            /* un handler mort ne bloque pas les autres */
          }
        }
      }
    }
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    if (this.closed) {
      return Promise.reject(new Error("Connexion CDP fermée"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout CDP ${method} (${timeoutMs}ms)`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  on(method: string, handler: CdpEventHandler): () => void {
    let set = this.handlers.get(method);
    if (!set) {
      set = new Set();
      this.handlers.set(method, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  close(): void {
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
