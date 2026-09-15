/**
 * Résolution du transport mail par configuration (§4.2 plan mails natifs).
 *
 * Ordre de priorité :
 *   1. Réglage instance (table `creezio_platform_mail_settings`, posé par
 *      l'UI admin) ;
 *   2. Env `MAIL_TRANSPORT=resend|smtp|cloudflare|file-sink`
 *      (+ `RESEND_API_KEY` / `SMTP_*` / `MAIL_FILE_SINK_DIR`) —
 *      `cloudflare` = alias du preset SMTP Cloudflare ;
 *   3. Rétro-inférence : `CLOUDFLARE_EMAIL_API_TOKEN` (ou
 *      `CLOUDFLARE_EMAIL_TOKEN`) → preset cloudflare ; `SMTP_URL`/`SMTP_HOST`
 *      posés → smtp ; `RESEND_API_KEY` → resend ;
 *   4. Défaut : non configuré (l'outbox marque `failed_permanent`
 *      `transport_unconfigured`).
 *
 * Secrets : valeurs directes ou références `integration://<slug>` résolues
 * via le pont enregistré par app-runtime (`configureMailSecretBridge`) —
 * pas de dépendance directe mails → integrations (évite un cycle build).
 */

import type { MailTransport } from "./transport.js";
import { createSmtpMailTransport } from "./providers/smtp.js";
import { createResendMailTransport } from "./providers/resend.js";
import { createFileSinkMailTransport } from "./providers/file-sink.js";
import type { SqliteMailsStore } from "./sqlite-store.js";

export type MailSecretBridge = {
  /** `integration://slug` → secret en clair (null si introuvable/illisible). */
  resolve: (reference: string) => string | null;
  /**
   * Stocke un secret en clair (ex. mot de passe IMAP saisi dans l'UI) et
   * renvoie sa référence `integration://…`. Optionnel.
   */
  store?: (input: {
    provider: string;
    label: string;
    secret: string;
    meta?: Record<string, unknown>;
  }) => string;
};

let secretBridge: MailSecretBridge | null = null;

export function configureMailSecretBridge(
  bridge: MailSecretBridge | null,
): void {
  secretBridge = bridge;
}

export function getMailSecretBridge(): MailSecretBridge | null {
  return secretBridge;
}

const INTEGRATION_SCHEME = "integration://";

/** Valeur directe passthrough ; `integration://…` résolu via le pont. */
export function resolveMailSecret(
  raw: string | null | undefined,
): string | null {
  const value = (raw || "").trim();
  if (!value) return null;
  if (!value.startsWith(INTEGRATION_SCHEME)) return value;
  if (!secretBridge) return null;
  try {
    return secretBridge.resolve(value);
  } catch {
    return null;
  }
}

export type MailTransportKind = "smtp" | "resend" | "file-sink";

export type ResolvedMailTransport = {
  transport: MailTransport | null;
  kind: MailTransportKind | null;
  source: "settings" | "env" | "inferred" | "none";
  preset: "cloudflare" | null;
  from: string | null;
  /** Raison si non configuré / mal configuré. */
  error?: string;
};

/** Clés `mail_settings` utilisées par la page paramètres email. */
export const MAIL_SETTINGS_KEYS = [
  "transport",
  "preset",
  "from",
  "secret_ref",
  "smtp_url",
  "smtp_host",
  "smtp_port",
  "smtp_secure",
  "smtp_user",
  "file_sink_dir",
] as const;

function envFrom(): string | null {
  return (
    (process.env.MAIL_FROM || "").trim() ||
    (process.env.SMTP_FROM || "").trim() ||
    (process.env.EMAIL_FROM || "").trim() ||
    null
  );
}

/**
 * Token Cloudflare Email Sending (permission « Email Sending: Edit »).
 * Les deux noms historiques sont acceptés — la doc kit a longtemps cité
 * `CLOUDFLARE_EMAIL_TOKEN` alors que le code ne lisait que `..._API_TOKEN`.
 */
function envCloudflareEmailToken(): string {
  return (
    (process.env.CLOUDFLARE_EMAIL_API_TOKEN || "").trim() ||
    (process.env.CLOUDFLARE_EMAIL_TOKEN || "").trim()
  );
}

function envSmtpConfig(preset: "cloudflare" | null): {
  url?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
} {
  if (preset === "cloudflare") {
    return {
      pass: (process.env.SMTP_PASS || "").trim() || envCloudflareEmailToken(),
    };
  }
  const url = (process.env.SMTP_URL || "").trim();
  if (url) return { url };
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    host: host || undefined,
    port: Number.isFinite(port) ? port : 587,
    secure: process.env.SMTP_SECURE === "1" || port === 465,
    user: (process.env.SMTP_USER || "").trim() || undefined,
    pass: (process.env.SMTP_PASS || "").trim() || undefined,
  };
}

function buildSmtp(opts: {
  source: ResolvedMailTransport["source"];
  preset: "cloudflare" | null;
  from: string | null;
  cfg: {
    url?: string;
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
  };
}): ResolvedMailTransport {
  return {
    transport: createSmtpMailTransport({
      ...opts.cfg,
      from: opts.from || undefined,
      preset: opts.preset,
    }),
    kind: "smtp",
    source: opts.source,
    preset: opts.preset,
    from: opts.from,
  };
}

function buildResend(opts: {
  source: ResolvedMailTransport["source"];
  apiKey: string | null;
  from: string | null;
}): ResolvedMailTransport {
  if (!opts.apiKey) {
    return {
      transport: null,
      kind: "resend",
      source: opts.source,
      preset: null,
      from: opts.from,
      error: "resend_secret_unresolved",
    };
  }
  return {
    transport: createResendMailTransport({
      apiKey: opts.apiKey,
      from: opts.from || undefined,
    }),
    kind: "resend",
    source: opts.source,
    preset: null,
    from: opts.from,
  };
}

function buildFileSink(opts: {
  source: ResolvedMailTransport["source"];
  outDir: string | null;
  from: string | null;
}): ResolvedMailTransport {
  if (!opts.outDir) {
    return {
      transport: null,
      kind: "file-sink",
      source: opts.source,
      preset: null,
      from: opts.from,
      error: "file_sink_dir_required (MAIL_FILE_SINK_DIR)",
    };
  }
  return {
    transport: createFileSinkMailTransport({ outDir: opts.outDir }),
    kind: "file-sink",
    source: opts.source,
    preset: null,
    from: opts.from,
  };
}

export function resolveMailTransport(opts?: {
  store?: SqliteMailsStore | null;
}): ResolvedMailTransport {
  const store = opts?.store || null;

  // 1. Réglage instance (UI admin, mail_settings).
  const settings = store ? safeSettings(store) : {};
  const settingsTransport = (settings.transport || "").trim();
  if (settingsTransport) {
    const preset =
      (settings.preset || "").trim() === "cloudflare" ? "cloudflare" : null;
    const from = (settings.from || "").trim() || envFrom();
    if (settingsTransport === "resend") {
      const apiKey =
        resolveMailSecret(settings.secret_ref) ||
        (process.env.RESEND_API_KEY || "").trim() ||
        null;
      return buildResend({ source: "settings", apiKey, from });
    }
    if (settingsTransport === "file-sink") {
      const outDir =
        (settings.file_sink_dir || "").trim() ||
        (process.env.MAIL_FILE_SINK_DIR || "").trim() ||
        null;
      return buildFileSink({ source: "settings", outDir, from });
    }
    if (settingsTransport === "smtp" || settingsTransport === "cloudflare") {
      const effectivePreset =
        settingsTransport === "cloudflare" ? "cloudflare" : preset;
      const pass =
        resolveMailSecret(settings.secret_ref) ||
        envSmtpConfig(effectivePreset).pass;
      return buildSmtp({
        source: "settings",
        preset: effectivePreset,
        from,
        cfg: effectivePreset
          ? { pass }
          : {
              url: (settings.smtp_url || "").trim() || undefined,
              host: (settings.smtp_host || "").trim() || undefined,
              port: settings.smtp_port
                ? Number(settings.smtp_port)
                : undefined,
              secure:
                settings.smtp_secure != null
                  ? settings.smtp_secure === "1" ||
                    settings.smtp_secure === "true"
                  : undefined,
              user: (settings.smtp_user || "").trim() || undefined,
              pass,
            },
      });
    }
    return {
      transport: null,
      kind: null,
      source: "settings",
      preset: null,
      from,
      error: `transport_inconnu:${settingsTransport}`,
    };
  }

  // 2. Env MAIL_TRANSPORT.
  const envTransport = (process.env.MAIL_TRANSPORT || "").trim().toLowerCase();
  if (envTransport) {
    const from = envFrom();
    if (envTransport === "resend") {
      return buildResend({
        source: "env",
        apiKey: (process.env.RESEND_API_KEY || "").trim() || null,
        from,
      });
    }
    if (envTransport === "file-sink") {
      return buildFileSink({
        source: "env",
        outDir: (process.env.MAIL_FILE_SINK_DIR || "").trim() || null,
        from,
      });
    }
    if (envTransport === "cloudflare") {
      return buildSmtp({
        source: "env",
        preset: "cloudflare",
        from,
        cfg: envSmtpConfig("cloudflare"),
      });
    }
    if (envTransport === "smtp") {
      return buildSmtp({
        source: "env",
        preset: null,
        from,
        cfg: envSmtpConfig(null),
      });
    }
    return {
      transport: null,
      kind: null,
      source: "env",
      preset: null,
      from,
      error: `transport_inconnu:${envTransport}`,
    };
  }

  // 3. Rétro-inférence. Cloudflare d'abord : c'est l'infra par défaut du kit
  // (tunnel + Email Routing), un token Email Sending posé suffit à envoyer.
  if (envCloudflareEmailToken()) {
    return buildSmtp({
      source: "inferred",
      preset: "cloudflare",
      from: envFrom(),
      cfg: envSmtpConfig("cloudflare"),
    });
  }
  if ((process.env.SMTP_URL || "").trim() || (process.env.SMTP_HOST || "").trim()) {
    return buildSmtp({
      source: "inferred",
      preset: null,
      from: envFrom(),
      cfg: envSmtpConfig(null),
    });
  }
  if ((process.env.RESEND_API_KEY || "").trim()) {
    return buildResend({
      source: "inferred",
      apiKey: (process.env.RESEND_API_KEY || "").trim(),
      from: envFrom(),
    });
  }

  // 4. Non configuré.
  return {
    transport: null,
    kind: null,
    source: "none",
    preset: null,
    from: envFrom(),
    error: "transport_unconfigured",
  };
}

function safeSettings(store: SqliteMailsStore): Record<string, string> {
  try {
    return store.getAllSettings();
  } catch {
    return {};
  }
}

/**
 * Message FR pour l'UI / les réponses API quand le transport n'est pas
 * utilisable. Les codes techniques restent en `error` machine.
 */
export function describeMailTransportError(
  code: string | null | undefined,
): string {
  const c = (code || "transport_unconfigured").trim();
  if (c === "transport_unconfigured") {
    return "Aucun transport d'envoi configuré. Ouvrez Paramètres → Email pour configurer SMTP, Resend ou Cloudflare.";
  }
  if (c === "resend_secret_unresolved") {
    return "Clé Resend manquante ou illisible. Vérifiez Paramètres → Email.";
  }
  if (c.startsWith("file_sink_dir_required")) {
    return "Répertoire file-sink manquant (MAIL_FILE_SINK_DIR ou Paramètres → Email).";
  }
  if (c.startsWith("transport_inconnu:")) {
    return "Transport inconnu. Choisissez smtp, resend, cloudflare ou file-sink.";
  }
  if (c === "smtp_unconfigured" || c.startsWith("smtp_unconfigured")) {
    return "SMTP incomplet (SMTP_URL ou SMTP_HOST requis).";
  }
  if (c.includes("nodemailer_absent")) {
    return "nodemailer_absent — installez nodemailer côté app ou utilisez file-sink.";
  }
  if (c === "send_unavailable") {
    return "Token présent, envoi réel indisponible (domaine non onboardé / 550).";
  }
  return c;
}

/** True si un transport d'envoi est résolu et utilisable. */
export function isMailTransportConfigured(
  store?: SqliteMailsStore | null,
): { ok: true } | { ok: false; error: string; code: string } {
  const resolved = resolveMailTransport({ store: store ?? null });
  if (resolved.transport) return { ok: true };
  const code = resolved.error || "transport_unconfigured";
  return { ok: false, error: describeMailTransportError(code), code };
}
