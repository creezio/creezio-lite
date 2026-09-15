/**
 * Worker outbox durable — draine les mails `queued` (claim atomique),
 * envoie via le transport résolu par configuration, journalise chaque
 * tentative (`creezio_platform_mail_events`), backoff exponentiel
 * (1 min → 1 h, 8 tentatives max → `failed_permanent`).
 *
 * Démarré côté kernel uniquement (app-runtime) — jamais dans le process
 * Next (pas de double envoi). Opt-out : `CREEZIO_MAIL_OUTBOX=0`.
 */

import type { MailTransport } from "./transport.js";
import type { SqliteMailsStore } from "./sqlite-store.js";
import { resolveMailTransport } from "./transport-resolve.js";
import {
  isHardTransportError,
  isSendUnavailableError,
  persistMailSendStatus,
  resolveMailSendStatus,
} from "./send-status.js";

export const MAIL_OUTBOX_DEFAULT_INTERVAL_MS = 15_000;
export const MAIL_OUTBOX_MAX_ATTEMPTS = 8;
export const MAIL_OUTBOX_BACKOFF_BASE_MS = 60_000;
export const MAIL_OUTBOX_BACKOFF_MAX_MS = 3_600_000;

export function computeOutboxBackoffMs(retryCount: number): number {
  const ms = MAIL_OUTBOX_BACKOFF_BASE_MS * 2 ** Math.max(0, retryCount);
  return Math.min(ms, MAIL_OUTBOX_BACKOFF_MAX_MS);
}

export type MailOutboxWorker = {
  /** Draine la file une fois (tous les mails dus). Renvoie le nb traité. */
  drainOnce(): Promise<number>;
  stop(): void;
};

export type StartMailOutboxWorkerOptions = {
  store: SqliteMailsStore;
  /**
   * Résolution transport (défaut : `resolveMailTransport({ store })` à
   * chaque drain — la config peut changer à chaud via la page paramètres).
   */
  resolveTransport?: () =>
    | MailTransport
    | null
    | Promise<MailTransport | null>;
  /** Intervalle boucle (défaut 15 s + jitter). */
  intervalMs?: number;
  maxAttempts?: number;
  log?: (line: string) => void;
  /** Ne pas lancer la boucle périodique (drain manuel — tests). */
  manual?: boolean;
};

export function startMailOutboxWorker(
  opts: StartMailOutboxWorkerOptions,
): MailOutboxWorker {
  const store = opts.store;
  const maxAttempts = opts.maxAttempts ?? MAIL_OUTBOX_MAX_ATTEMPTS;
  const log = opts.log || (() => {});
  const intervalMs = opts.intervalMs ?? MAIL_OUTBOX_DEFAULT_INTERVAL_MS;

  let stopped = false;
  let draining = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function resolveTransport(): Promise<MailTransport | null> {
    if (opts.resolveTransport) return opts.resolveTransport();
    return resolveMailTransport({ store }).transport;
  }

  async function drainOnce(): Promise<number> {
    if (draining) return 0;
    draining = true;
    let processed = 0;
    try {
      let transport: MailTransport | null | undefined;
      for (;;) {
        const mail = store.claimNextOutbox();
        if (!mail) break;
        processed += 1;
        if (transport === undefined) {
          try {
            transport = await resolveTransport();
          } catch (e) {
            transport = null;
            log(
              `outbox: résolution transport échouée — ${e instanceof Error ? e.message : e}`,
            );
          }
        }
        if (!transport) {
          store.markFailedPermanent(mail.id, "transport_unconfigured");
          store.recordEvent(mail.id, "failed", {
            detail: "transport_unconfigured",
          });
          persistMailSendStatus(
            store,
            resolveMailSendStatus({
              resolved: resolveMailTransport({ store }),
              store,
              liveProbe: { ok: false, error: "transport_unconfigured" },
            }),
          );
          log(`outbox: ${mail.id} → failed_permanent (transport_unconfigured)`);
          continue;
        }
        const outgoing = store.getOutgoing(mail.id);
        if (!outgoing) {
          store.markFailedPermanent(mail.id, "mail_introuvable");
          continue;
        }
        store.recordEvent(mail.id, "attempt", {
          detail: `tentative ${(mail.retryCount ?? 0) + 1}/${maxAttempts}`,
          provider: transport.id,
        });
        let result;
        try {
          result = await transport.send(outgoing);
        } catch (e) {
          result = {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
            retryable: true,
          };
        }
        if (result.ok) {
          store.markSent(mail.id, result.providerMessageId ?? null);
          store.recordEvent(mail.id, "sent", {
            detail: result.providerMessageId
              ? `provider_message_id=${result.providerMessageId}`
              : null,
            provider: transport.id,
          });
          persistMailSendStatus(
            store,
            resolveMailSendStatus({
              resolved: resolveMailTransport({ store }),
              store,
              liveProbe: { ok: true },
            }),
          );
          log(`outbox: ${mail.id} → sent (${transport.id})`);
          continue;
        }
        const attempts = (mail.retryCount ?? 0) + 1;
        if (result.retryable && attempts < maxAttempts) {
          const delay = computeOutboxBackoffMs(mail.retryCount ?? 0);
          const nextAt = new Date(Date.now() + delay).toISOString();
          store.scheduleRetry(mail.id, result.error, nextAt);
          store.recordEvent(mail.id, "failed", {
            detail: `${result.error} — retry ${attempts}/${maxAttempts} à ${nextAt}`,
            provider: transport.id,
          });
          log(
            `outbox: ${mail.id} → retry ${attempts}/${maxAttempts} (${result.error})`,
          );
        } else {
          store.markFailedPermanent(mail.id, result.error);
          store.recordEvent(mail.id, "failed", {
            detail: `${result.error} — abandon après ${attempts} tentative(s)`,
            provider: transport.id,
          });
          if (
            isHardTransportError(result.error) ||
            isSendUnavailableError(result.error) ||
            !result.retryable
          ) {
            persistMailSendStatus(
              store,
              resolveMailSendStatus({
                resolved: resolveMailTransport({ store }),
                store,
                liveProbe: { ok: false, error: result.error },
              }),
            );
          }
          log(`outbox: ${mail.id} → failed_permanent (${result.error})`);
        }
      }
    } finally {
      draining = false;
    }
    return processed;
  }

  function scheduleNext(): void {
    if (stopped || opts.manual) return;
    const jitter = Math.floor(Math.random() * 2_000);
    timer = setTimeout(() => {
      void drainOnce()
        .catch((e) =>
          log(`outbox: drain error — ${e instanceof Error ? e.message : e}`),
        )
        .finally(scheduleNext);
    }, intervalMs + jitter);
    // Ne pas retenir le process Node (harness/smokes).
    (timer as { unref?: () => void }).unref?.();
  }

  scheduleNext();

  return {
    drainOnce,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
