/**
 * Statut d'envoi réel (send) distinct de la présence des identifiants.
 *
 * Token / secret_ref renseigné = config enregistrable. Un probe send qui
 * échoue (550 Cloudflare « domain not onboarded », etc.) n'invalide pas
 * les identifiants : c'est « config OK, send KO ».
 *
 * Ne pas masquer `nodemailer_absent` ni l'absence de token.
 */

import { randomUUID } from "node:crypto";
import type { SqliteMailsStore } from "./sqlite-store.js";
import type { ResolvedMailTransport } from "./transport-resolve.js";

export type MailSendState =
  | "unconfigured"
  | "unavailable"
  | "ok"
  | "unknown";

export type MailSendStatus = {
  state: MailSendState;
  /** Identifiants présents (token / secret_ref / SMTP / Resend). */
  credentialsPresent: boolean;
  /** Transport résolu (objet construit), pas forcément send-capable. */
  configured: boolean;
  sendOk: boolean | null;
  code: string | null;
  error: string | null;
  message: string;
};

/** Clés internes persistées — hors `MAIL_SETTINGS_KEYS` (PUT les ignore). */
export const MAIL_SEND_STATUS_SETTING_KEYS = [
  "send_status",
  "send_error",
  "send_code",
  "send_probed_at",
] as const;

const HARD_MISSING = [
  "nodemailer_absent",
  "smtp_unconfigured",
  "resend_unconfigured",
  "resend_secret_unresolved",
  "transport_unconfigured",
  "file_sink_dir_required",
];

function envCloudflareEmailToken(): string {
  return (
    (process.env.CLOUDFLARE_EMAIL_API_TOKEN || "").trim() ||
    (process.env.CLOUDFLARE_EMAIL_TOKEN || "").trim()
  );
}

export function publicMailSettings(
  all: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const skip = new Set<string>(MAIL_SEND_STATUS_SETTING_KEYS);
  for (const [k, v] of Object.entries(all)) {
    if (skip.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/** True si un token / secret / SMTP est renseigné (même si le send échoue). */
export function hasMailCredentials(opts: {
  resolved: ResolvedMailTransport;
  store?: SqliteMailsStore | null;
}): boolean {
  const settings = opts.store ? safeSettings(opts.store) : {};
  if ((settings.secret_ref || "").trim()) return true;
  if (envCloudflareEmailToken()) return true;
  if ((process.env.RESEND_API_KEY || "").trim()) return true;
  if ((process.env.SMTP_PASS || "").trim()) return true;
  if ((process.env.SMTP_URL || "").trim()) return true;
  if (opts.resolved.kind === "file-sink" && opts.resolved.transport) {
    return true;
  }
  if (opts.resolved.kind === "resend" && opts.resolved.transport) {
    return true;
  }
  if (opts.resolved.kind === "smtp" && opts.resolved.preset !== "cloudflare") {
    const host =
      (settings.smtp_host || "").trim() ||
      (process.env.SMTP_HOST || "").trim();
    const url =
      (settings.smtp_url || "").trim() ||
      (process.env.SMTP_URL || "").trim();
    return Boolean(host || url);
  }
  return false;
}

function safeSettings(store: SqliteMailsStore): Record<string, string> {
  try {
    return store.getAllSettings();
  } catch {
    return {};
  }
}

export function isHardTransportError(
  error: string | null | undefined,
): boolean {
  const c = (error || "").trim();
  if (!c) return false;
  return HARD_MISSING.some((k) => c === k || c.startsWith(`${k} `) || c.startsWith(`${k}—`) || c.startsWith(`${k} -`));
}

/**
 * Échec d'envoi réel (domaine non onboardé, 550, …) — pas une absence
 * d'identifiants.
 */
export function isSendUnavailableError(
  error: string | null | undefined,
): boolean {
  const c = (error || "").trim();
  if (!c) return false;
  if (isHardTransportError(c)) return false;
  if (/\b550\b/.test(c)) return true;
  if (/\b553\b/.test(c)) return true;
  if (/email sending is not configured/i.test(c)) return true;
  if (/not configured for domain/i.test(c)) return true;
  if (/domain not onboarded/i.test(c)) return true;
  if (/sender address rejected/i.test(c)) return true;
  return false;
}

export function classifyMailSendError(error: string | null | undefined): {
  kind: "hard" | "unavailable" | "unconfigured" | "other";
  code: string;
} {
  const c = (error || "").trim();
  if (!c) return { kind: "other", code: "unknown" };
  if (c === "transport_unconfigured" || c.startsWith("transport_unconfigured")) {
    return { kind: "unconfigured", code: "transport_unconfigured" };
  }
  if (c.includes("nodemailer_absent")) {
    return { kind: "hard", code: "nodemailer_absent" };
  }
  if (c.includes("smtp_unconfigured")) {
    return { kind: "hard", code: "smtp_unconfigured" };
  }
  if (c.includes("resend_secret_unresolved") || c.includes("resend_unconfigured")) {
    return { kind: "unconfigured", code: "resend_secret_unresolved" };
  }
  if (c.startsWith("file_sink_dir_required")) {
    return { kind: "hard", code: "file_sink_dir_required" };
  }
  if (isSendUnavailableError(c)) {
    return { kind: "unavailable", code: "send_unavailable" };
  }
  return { kind: "other", code: "send_failed" };
}

export function summarizeMailSendError(
  error: string | null | undefined,
): string {
  const c = (error || "").trim();
  if (!c) return "";
  if (c.includes("nodemailer_absent")) return "nodemailer_absent";
  if (/email sending is not configured/i.test(c) || /not configured for domain/i.test(c)) {
    const m = c.match(/domain [`']?([^`'\s,]+)/i);
    return m ? `domaine non onboardé : ${m[1]}` : "domaine non onboardé / 550";
  }
  if (/\b550\b/.test(c)) return "550";
  if (c.length > 96) return `${c.slice(0, 93)}…`;
  return c;
}

export function describeMailSendStatus(status: MailSendStatus): string {
  if (status.state === "unconfigured") {
    return "Email Sending non configuré";
  }
  if (status.state === "unavailable") {
    if (status.code === "nodemailer_absent") {
      return "nodemailer_absent — l'envoi SMTP est impossible (dépendance manquante).";
    }
    const detail = summarizeMailSendError(status.error);
    return detail
      ? `Token présent, envoi réel indisponible (${detail}).`
      : "Token présent, envoi réel indisponible (domaine non onboardé / 550).";
  }
  if (status.state === "unknown") {
    return "Token présent — envoi réel pas encore testé.";
  }
  return "";
}

export function persistMailSendStatus(
  store: SqliteMailsStore,
  status: MailSendStatus,
): void {
  if (status.state === "unknown") return;
  store.setSetting("send_status", status.state);
  store.setSetting("send_error", status.error);
  store.setSetting("send_code", status.code);
  store.setSetting("send_probed_at", new Date().toISOString());
}

function readPersistedSendStatus(
  store: SqliteMailsStore | null | undefined,
): {
  state: MailSendState;
  error: string | null;
  code: string | null;
  at: string | null;
} | null {
  if (!store) return null;
  const state = (store.getSetting("send_status") || "").trim() as MailSendState;
  if (!state || !["unconfigured", "unavailable", "ok"].includes(state)) {
    return null;
  }
  return {
    state,
    error: store.getSetting("send_error"),
    code: store.getSetting("send_code"),
    at: store.getSetting("send_probed_at"),
  };
}

function inferFromOutbox(
  store: SqliteMailsStore | null | undefined,
): { error: string; at: string | null; ok: boolean } | null {
  if (!store) return null;
  try {
    const failed = store.listInbox({ folder: "outbox", limit: 30 });
    const sent = store.listInbox({ folder: "sent", limit: 1 });
    type Row = { last_error?: string | null; received_at?: string; status?: string };
    const failRows = (failed.rows || []) as Row[];
    const fail = failRows.find(
      (r) =>
        (r.last_error && isSendUnavailableError(r.last_error)) ||
        (r.status === "failed_permanent" && r.last_error),
    );
    const sentRow = ((sent.rows || []) as Row[])[0];
    if (fail && sentRow) {
      const failAt = fail.received_at || "";
      const sentAt = sentRow.received_at || "";
      if (sentAt && failAt && sentAt > failAt) {
        return { error: "", at: sentAt, ok: true };
      }
    }
    if (fail?.last_error) {
      return {
        error: fail.last_error,
        at: fail.received_at || null,
        ok: false,
      };
    }
    if (sentRow) {
      return { error: "", at: sentRow.received_at || null, ok: true };
    }
  } catch {
    /* store pas prêt */
  }
  return null;
}

function buildStatus(opts: {
  state: MailSendState;
  credentialsPresent: boolean;
  configured: boolean;
  sendOk: boolean | null;
  code: string | null;
  error: string | null;
}): MailSendStatus {
  const status: MailSendStatus = {
    state: opts.state,
    credentialsPresent: opts.credentialsPresent,
    configured: opts.configured,
    sendOk: opts.sendOk,
    code: opts.code,
    error: opts.error,
    message: "",
  };
  status.message = describeMailSendStatus(status);
  return status;
}

/**
 * Statut send à exposer (GET /settings, /meta). `liveProbe` = résultat
 * frais de verify/send (prioritaire, persisté par l'appelant).
 */
export function resolveMailSendStatus(opts: {
  resolved: ResolvedMailTransport;
  store?: SqliteMailsStore | null;
  liveProbe?: { ok: boolean; error?: string | null };
}): MailSendStatus {
  const credentialsPresent = hasMailCredentials({
    resolved: opts.resolved,
    store: opts.store,
  });
  const configured = Boolean(opts.resolved.transport);
  const base = {
    credentialsPresent,
    configured,
  };

  if (opts.liveProbe) {
    const err = opts.liveProbe.error || null;
    const classified = classifyMailSendError(err);
    if (opts.liveProbe.ok) {
      return buildStatus({
        ...base,
        state: "ok",
        sendOk: true,
        code: null,
        error: null,
      });
    }
    if (classified.kind === "hard") {
      return buildStatus({
        ...base,
        state: "unavailable",
        sendOk: false,
        code: classified.code,
        error: err,
      });
    }
    if (!credentialsPresent) {
      return buildStatus({
        ...base,
        state: "unconfigured",
        sendOk: false,
        code: classified.code === "other" ? "transport_unconfigured" : classified.code,
        error: err || "transport_unconfigured",
      });
    }
    return buildStatus({
      ...base,
      state: "unavailable",
      sendOk: false,
      code:
        classified.kind === "unavailable"
          ? "send_unavailable"
          : classified.code,
      error: err,
    });
  }

  if (!credentialsPresent && !configured) {
    return buildStatus({
      ...base,
      state: "unconfigured",
      sendOk: false,
      code: opts.resolved.error || "transport_unconfigured",
      error: opts.resolved.error || "transport_unconfigured",
    });
  }

  const persisted = readPersistedSendStatus(opts.store);
  const inferred = inferFromOutbox(opts.store);

  if (persisted && inferred) {
    const persistAt = persisted.at || "";
    const inferAt = inferred.at || "";
    if (inferAt && persistAt && inferAt > persistAt) {
      if (inferred.ok) {
        return buildStatus({
          ...base,
          state: "ok",
          sendOk: true,
          code: null,
          error: null,
        });
      }
      const classified = classifyMailSendError(inferred.error);
      return buildStatus({
        ...base,
        state: "unavailable",
        sendOk: false,
        code: classified.code,
        error: inferred.error,
      });
    }
  }

  if (persisted) {
    if (persisted.state === "ok") {
      return buildStatus({
        ...base,
        state: "ok",
        sendOk: true,
        code: null,
        error: null,
      });
    }
    if (persisted.state === "unconfigured" && !credentialsPresent) {
      return buildStatus({
        ...base,
        state: "unconfigured",
        sendOk: false,
        code: persisted.code,
        error: persisted.error,
      });
    }
    if (persisted.state === "unavailable" && credentialsPresent) {
      return buildStatus({
        ...base,
        state: "unavailable",
        sendOk: false,
        code: persisted.code,
        error: persisted.error,
      });
    }
  }

  if (inferred) {
    if (inferred.ok) {
      return buildStatus({
        ...base,
        state: "ok",
        sendOk: true,
        code: null,
        error: null,
      });
    }
    const classified = classifyMailSendError(inferred.error);
    return buildStatus({
      ...base,
      state: credentialsPresent ? "unavailable" : "unconfigured",
      sendOk: false,
      code: classified.code,
      error: inferred.error,
    });
  }

  if (credentialsPresent) {
    return buildStatus({
      ...base,
      state: "unknown",
      sendOk: null,
      code: null,
      error: null,
    });
  }

  return buildStatus({
    ...base,
    state: "unconfigured",
    sendOk: false,
    code: "transport_unconfigured",
    error: "transport_unconfigured",
  });
}

/** Probe d'envoi réel (MAIL FROM / DATA) — détecte le 550 Cloudflare. */
export async function probeMailSend(
  resolved: ResolvedMailTransport,
): Promise<{ ok: boolean; error?: string }> {
  if (!resolved.transport) {
    return { ok: false, error: resolved.error || "transport_unconfigured" };
  }
  const from = resolved.from || "noreply@localhost";
  try {
    const result = await resolved.transport.send({
      id: randomUUID(),
      from,
      to: [from],
      subject: "[creezio] probe send",
      text: "probe",
    });
    if (result.ok) return { ok: true };
    return { ok: false, error: result.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
