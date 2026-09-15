/**
 * Pont serveur local ↔ Electron pour le pilotage bot des onglets fournisseurs.
 *
 * - S'authentifie auprès du serveur Next local (POST /api/v1/auth/login avec
 *   les credentials bootstrappés) et conserve le cookie de session.
 * - S'abonne au flux SSE GET /api/v1/assistant/supplier-actions/stream
 *   (nouvelle route — voir src/server/routes/assistant.ts dans le fork).
 * - Pour chaque événement `supplier_action`, exécute l'action via
 *   supplier-driver puis POST le résultat sur la route EXISTANTE
 *   /api/v1/assistant/ui-actions/:id/result (résout la promesse serveur).
 * - Reconnexion automatique avec backoff.
 */

import type { SupplierActionRequest } from "./ai-workspace/types.js";

export type BridgeOptions = {
  baseUrl: string;
  /** Auth « credentials » (serveur local) : login POST /api/v1/auth/login. */
  authUser?: string;
  authPassword?: string;
  /**
   * Auth « session » (client remote) : lit le cookie session déjà posé par le
   * login UI (partition appView Electron). Prioritaire sur authUser/Password.
   * `null` = pas encore connecté → le loop retente avec backoff.
   */
  getSessionCookie?: () => Promise<string | null>;
  executor: (req: SupplierActionRequest) => Promise<Record<string, unknown>>;
  onLog?: (line: string) => void;
  /** Cookie session CRM (ex. brand_session). */
  sessionCookieName: string;
  /** Méta présence device (headers x-device-id / x-device-label du stream). */
  deviceId?: string;
  deviceLabel?: string;
};

export class BridgeClient {
  private cookie: string | null = null;
  private stopped = false;
  private abort: AbortController | null = null;

  constructor(private opts: BridgeOptions) {}

  private log(line: string): void {
    (this.opts.onLog || ((l: string) => console.log(`[bridge] ${l}`)))(line);
  }

  async start(): Promise<void> {
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.abort?.abort();
  }

  /**
   * POST JSON authentifié avec la session bridge (frames screencast…).
   * Retourne le JSON de réponse, ou null en cas d'échec (l'appelant décide
   * de retenter / s'arrêter — jamais de throw).
   */
  async postJson(
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown> | null> {
    try {
      if (this.cookie === null) await this.login();
      const res = await fetch(`${this.opts.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.cookie ? { Cookie: this.cookie } : {}),
        },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        this.cookie = null; // relogin au prochain appel
        return null;
      }
      if (!res.ok) return null;
      return (await res.json().catch(() => ({}))) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async loop(): Promise<void> {
    let backoffMs = 1000;
    while (!this.stopped) {
      try {
        if (!this.cookie) await this.login();
        await this.consumeStream();
        backoffMs = 1000; // stream terminé proprement → retry rapide
      } catch (e) {
        if (this.stopped) return;
        this.log(`connexion perdue (${e instanceof Error ? e.message : e}) — retry ${backoffMs}ms`);
      }
      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 15000);
    }
  }

  private async login(): Promise<void> {
    // Mode session : réutilise le cookie posé par le login UI (client remote).
    if (this.opts.getSessionCookie) {
      const cookie = await this.opts.getSessionCookie();
      if (!cookie) {
        throw new Error("session CRM absente — en attente du login utilisateur");
      }
      this.cookie = cookie;
      this.log("session bridge reprise (cookie appView)");
      return;
    }
    const res = await fetch(`${this.opts.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.opts.authUser, password: this.opts.authPassword }),
    });
    if (!res.ok) throw new Error(`login bridge échoué (HTTP ${res.status})`);
    const setCookie = res.headers.get("set-cookie") || "";
    const name = this.opts.sessionCookieName;
    const re = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]+)`);
    const m = setCookie.match(re);
    // AUTH_DISABLED=1 : pas de cookie posé, la session n'est pas requise.
    this.cookie = m ? `${name}=${m[1]}` : "";
    this.log("session bridge établie");
  }

  private async consumeStream(): Promise<void> {
    this.abort = new AbortController();
    const res = await fetch(`${this.opts.baseUrl}/api/v1/assistant/supplier-actions/stream`, {
      headers: {
        Accept: "text/event-stream",
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(this.opts.deviceId ? { "x-device-id": this.opts.deviceId } : {}),
        ...(this.opts.deviceLabel
          ? { "x-device-label": this.opts.deviceLabel }
          : {}),
      },
      signal: this.abort.signal,
    });
    if (res.status === 401) {
      this.cookie = null;
      throw new Error("session expirée");
    }
    if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);
    this.log("abonné au flux supplier-actions");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Découpage SSE : événements séparés par une ligne vide.
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        this.handleSseEvent(rawEvent);
      }
    }
  }

  private handleSseEvent(raw: string): void {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (event !== "supplier_action" || dataLines.length === 0) return;
    let req: SupplierActionRequest;
    try {
      req = JSON.parse(dataLines.join("\n")) as SupplierActionRequest;
    } catch {
      return;
    }
    if (!req?.actionId || !req.type) return;
    void this.execute(req);
  }

  private async execute(req: SupplierActionRequest): Promise<void> {
    let result: Record<string, unknown>;
    try {
      result = await this.opts.executor(req);
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : "erreur exécuteur" };
    }
    try {
      await fetch(
        `${this.opts.baseUrl}/api/v1/assistant/ui-actions/${encodeURIComponent(req.actionId)}/result`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.cookie ? { Cookie: this.cookie } : {}),
          },
          body: JSON.stringify(result),
        },
      );
    } catch {
      this.log(`POST résultat ${req.actionId} échoué — le serveur timeoutera`);
    }
  }
}
