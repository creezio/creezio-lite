/**
 * Transport SMTP (nodemailer en peer optionnel, import dynamique).
 * Absorbe l'ancien `smtp-env` : `SMTP_URL` ou `SMTP_HOST/PORT/USER/PASS/
 * SECURE/FROM` restent les clés lues côté env (voir transport-resolve).
 *
 * Préréglage `cloudflare` (Cloudflare Email Service, SMTP bêta 2026) :
 * host/port/user imposés — `smtp.mx.cloudflare.net:465`, TLS implicite,
 * user littéral `api_token`, password = API token (permission
 * Email Sending: Edit). Seuls le token et le `from` sont à fournir.
 */
import type {
  MailSendResult,
  MailTransport,
  OutgoingMail,
} from "../transport.js";

export const CLOUDFLARE_SMTP_PRESET = {
  host: "smtp.mx.cloudflare.net",
  port: 465,
  secure: true,
  user: "api_token",
} as const;

export type SmtpMailTransportConfig = {
  /** URL smtp:// complète (prioritaire sur host/port). */
  url?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  /** Expéditeur par défaut si `mail.from` absent. */
  from?: string;
  /** `cloudflare` impose host/port/secure/user. */
  preset?: "cloudflare" | null;
};

type NodemailerTransport = {
  sendMail: (opts: Record<string, unknown>) => Promise<{
    messageId?: string;
  }>;
  verify: () => Promise<unknown>;
};

type NodemailerModule = {
  createTransport: (config: string | object) => NodemailerTransport;
};

async function loadNodemailer(): Promise<NodemailerModule | null> {
  try {
    // Peer optionnel — éviter résolution tsc stricte sur `nodemailer`.
    const dynImport = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<{
      default?: NodemailerModule;
      createTransport?: NodemailerModule["createTransport"];
    }>;
    const mod = await dynImport("nodemailer");
    return (mod.default || mod) as NodemailerModule;
  } catch {
    return null;
  }
}

function applyPreset(cfg: SmtpMailTransportConfig): SmtpMailTransportConfig {
  if (cfg.preset !== "cloudflare") return cfg;
  return {
    ...cfg,
    url: undefined,
    host: CLOUDFLARE_SMTP_PRESET.host,
    port: CLOUDFLARE_SMTP_PRESET.port,
    secure: CLOUDFLARE_SMTP_PRESET.secure,
    user: CLOUDFLARE_SMTP_PRESET.user,
  };
}

function isRetryableSmtpError(e: unknown): boolean {
  const err = e as {
    responseCode?: number;
    code?: string;
    command?: string;
  };
  if (typeof err?.responseCode === "number") {
    // 4xx SMTP = temporaire, 5xx = permanent.
    return err.responseCode >= 400 && err.responseCode < 500;
  }
  // Erreurs réseau/connexion : retryable.
  const code = String(err?.code || "");
  return [
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ESOCKET",
    "ECONNECTION",
    "EDNS",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EPIPE",
  ].includes(code);
}

export function createSmtpMailTransport(
  rawCfg: SmtpMailTransportConfig,
): MailTransport {
  const cfg = applyPreset(rawCfg);

  function transportConfig():
    | { kind: "url"; url: string }
    | {
        kind: "fields";
        host: string;
        port: number;
        secure: boolean;
        auth?: { user: string; pass: string };
      }
    | null {
    if (cfg.url?.trim()) return { kind: "url", url: cfg.url.trim() };
    const host = (cfg.host || "").trim();
    if (!host) return null;
    const port = Number.isFinite(cfg.port) ? Number(cfg.port) : 587;
    return {
      kind: "fields",
      host,
      port,
      secure: cfg.secure ?? port === 465,
      auth: cfg.user
        ? { user: cfg.user, pass: cfg.pass || "" }
        : undefined,
    };
  }

  async function buildNodemailerTransport(): Promise<
    | { ok: true; transport: NodemailerTransport }
    | { ok: false; error: string; retryable: boolean }
  > {
    const tCfg = transportConfig();
    if (!tCfg) {
      return {
        ok: false,
        error: "smtp_unconfigured (SMTP_URL ou SMTP_HOST requis)",
        retryable: false,
      };
    }
    const nm = await loadNodemailer();
    if (!nm) {
      return {
        ok: false,
        error:
          "nodemailer_absent — npm i nodemailer côté app ou utiliser file-sink",
        retryable: false,
      };
    }
    const transport =
      tCfg.kind === "url"
        ? nm.createTransport(tCfg.url)
        : nm.createTransport({
            host: tCfg.host,
            port: tCfg.port,
            secure: tCfg.secure,
            auth: tCfg.auth,
          });
    return { ok: true, transport };
  }

  return {
    id: "smtp",
    capabilities: {
      attachments: true,
      idempotency: false,
      statusWebhooks: false,
    },
    async send(mail: OutgoingMail): Promise<MailSendResult> {
      const built = await buildNodemailerTransport();
      if (!built.ok) {
        return { ok: false, error: built.error, retryable: built.retryable };
      }
      try {
        const info = await built.transport.sendMail({
          from: mail.from || cfg.from || "noreply@localhost",
          to: mail.to.join(", "),
          cc: mail.cc?.length ? mail.cc.join(", ") : undefined,
          bcc: mail.bcc?.length ? mail.bcc.join(", ") : undefined,
          replyTo: mail.replyTo || undefined,
          subject: mail.subject,
          text: mail.text || undefined,
          html: mail.html || undefined,
          headers: mail.headers,
          inReplyTo: mail.inReplyTo || undefined,
          references: mail.references?.length
            ? mail.references.join(" ")
            : undefined,
          attachments: mail.attachments?.map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            content: a.content,
          })),
        });
        return {
          ok: true,
          providerMessageId: info?.messageId || undefined,
        };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          retryable: isRetryableSmtpError(e),
        };
      }
    },
    async verify() {
      const built = await buildNodemailerTransport();
      if (!built.ok) return { ok: false, error: built.error };
      try {
        await built.transport.verify();
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}
