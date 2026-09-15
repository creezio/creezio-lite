/**
 * Routes Hono boîte mail plateforme `/api/v1/email/*` (v2).
 * Auth session côté montage (mount-brand-email-surface) ; `/inbound` et
 * `/webhooks/*` restent protégés par secret partagé / signature.
 * Routes owner-only (`/settings*`, `/accounts*`) : le montage pose
 * `x-creezio-mail-owner: 1` quand la session est owner.
 */

import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import {
  getMailsConfig,
  resolveEmailDomain,
  resolveEmptyStateNoDomainHint,
  resolveInboundSecret,
  resolvePageSubtitle,
} from "./config.js";
import { getKitMailsStore } from "./env-store.js";
import type { SqliteMailsStore } from "./sqlite-store.js";
import type { EnqueueMailInput, InboundEmailInput } from "./types.js";
import { MAIL_MAX_ATTACHMENT_TOTAL_BYTES } from "./transport.js";
import {
  MAIL_SETTINGS_KEYS,
  describeMailTransportError,
  isMailTransportConfigured,
  resolveMailTransport,
} from "./transport-resolve.js";
import {
  hasMailCredentials,
  isHardTransportError,
  persistMailSendStatus,
  probeMailSend,
  publicMailSettings,
  resolveMailSendStatus,
  type MailSendStatus,
} from "./send-status.js";
import {
  applyResendWebhookEvent,
  resolveResendWebhookSecret,
  verifySvixSignature,
  type ResendWebhookEvent,
} from "./webhooks/resend.js";
import {
  ingestResendInboundEmail,
  resendInboundEnabled,
} from "./inbound-resend.js";
import {
  parseAccountCreateInput,
  parseAccountPatchInput,
  toPublicAccount,
} from "./imap/accounts.js";
import { syncImapAccount, verifyImapAccount } from "./imap/sync.js";
import { resolveMailSecret } from "./transport-resolve.js";

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function parseInboundBody(body: unknown):
  | { ok: true; data: InboundEmailInput }
  | { ok: false; error: string; details?: unknown } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Requête invalide" };
  }
  const b = body as Record<string, unknown>;
  const from = String(b.from || "").trim();
  const to = String(b.to || "").trim();
  if (!from || !to) {
    return { ok: false, error: "Requête invalide", details: "from et to requis" };
  }
  const attachments = Array.isArray(b.attachments)
    ? b.attachments
        .map((raw) => {
          if (!raw || typeof raw !== "object") return null;
          const a = raw as Record<string, unknown>;
          const content_base64 = String(a.content_base64 || "");
          if (!content_base64) return null;
          return {
            filename: a.filename != null ? String(a.filename) : undefined,
            content_type:
              a.content_type != null ? String(a.content_type) : undefined,
            content_base64,
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x))
    : undefined;

  let headers: Record<string, string> | null = null;
  if (b.headers && typeof b.headers === "object" && !Array.isArray(b.headers)) {
    headers = {};
    for (const [k, v] of Object.entries(b.headers as Record<string, unknown>)) {
      headers[k] = String(v ?? "");
    }
  }

  return {
    ok: true,
    data: {
      message_id:
        b.message_id == null ? null : String(b.message_id),
      from,
      to,
      subject: b.subject != null ? String(b.subject) : undefined,
      text: b.text == null ? null : String(b.text),
      html: b.html == null ? null : String(b.html),
      received_at: b.received_at == null ? null : String(b.received_at),
      headers,
      attachments,
    },
  };
}

function addrList(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) {
    return v.map((s) => String(s || "").trim()).filter(Boolean);
  }
  const s = String(v).trim();
  if (!s) return undefined;
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

type ComposeParse =
  | { ok: true; input: Omit<EnqueueMailInput, "userId"> }
  | { ok: false; error: string };

function parseComposeBody(body: unknown): ComposeParse {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Requête invalide" };
  }
  const b = body as Record<string, unknown>;
  const to = addrList(b.to) || [];
  const attachments = Array.isArray(b.attachments)
    ? b.attachments
        .map((raw) => {
          if (!raw || typeof raw !== "object") return null;
          const a = raw as Record<string, unknown>;
          const content_base64 = String(a.content_base64 || "");
          if (!content_base64) return null;
          return {
            filename: a.filename != null ? String(a.filename) : undefined,
            content_type:
              a.content_type != null ? String(a.content_type) : undefined,
            content_base64,
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x))
    : undefined;
  const totalBytes = (attachments || []).reduce(
    (sum, a) => sum + Math.ceil(a.content_base64.length * 0.75),
    0,
  );
  if (totalBytes > MAIL_MAX_ATTACHMENT_TOTAL_BYTES) {
    return { ok: false, error: "attachments_too_large (max 25 Mo)" };
  }
  let headers: Record<string, string> | undefined;
  if (b.headers && typeof b.headers === "object" && !Array.isArray(b.headers)) {
    headers = {};
    for (const [k, v] of Object.entries(b.headers as Record<string, unknown>)) {
      headers[k] = String(v ?? "");
    }
  }
  return {
    ok: true,
    input: {
      from: b.from != null ? String(b.from) : undefined,
      to,
      cc: addrList(b.cc),
      bcc: addrList(b.bcc),
      replyTo: b.replyTo != null ? String(b.replyTo) : undefined,
      subject: String(b.subject || ""),
      text: b.text == null ? null : String(b.text),
      html: b.html == null ? null : String(b.html),
      headers,
      inReplyTo: b.inReplyTo == null ? null : String(b.inReplyTo),
      references: Array.isArray(b.references)
        ? b.references.map((r) => String(r)).filter(Boolean)
        : null,
      attachments,
    },
  };
}

export type MailRouteActor = {
  userId: string | null;
  owner: boolean;
};

export type EmailInboxRouteDeps = {
  /** Store kit (défaut : getKitMailsStore via CREEZIO_CORE_DB_PATH). */
  getStore?: () => SqliteMailsStore | null;
  /**
   * Acteur de la requête (session côté montage). Défaut : headers
   * `x-creezio-user-id` / `x-creezio-mail-owner` (canal interne).
   */
  resolveActor?: (c: {
    req: { header: (name: string) => string | undefined };
  }) => Promise<MailRouteActor> | MailRouteActor;
};

const OWNER_HEADER = "x-creezio-mail-owner";

function effectiveTransportPayload(
  store: SqliteMailsStore | null,
  resolved: ReturnType<typeof resolveMailTransport>,
  send?: MailSendStatus,
) {
  const sendStatus =
    send ??
    resolveMailSendStatus({
      resolved,
      store,
    });
  return {
    kind: resolved.kind,
    source: resolved.source,
    preset: resolved.preset,
    from: resolved.from,
    configured: Boolean(resolved.transport),
    credentialsPresent: hasMailCredentials({ resolved, store }),
    error: resolved.transport
      ? null
      : resolved.error ?? null,
    send: sendStatus,
  };
}

function headerActor(c: {
  req: { header: (name: string) => string | undefined };
}): MailRouteActor {
  return {
    userId: (c.req.header("x-creezio-user-id") || "").trim() || null,
    owner: c.req.header(OWNER_HEADER) === "1",
  };
}

/**
 * Factory Hono `/email` — marques montent :
 *   `api.route("/email", createEmailInboxRoutes())`
 */
export function createEmailInboxRoutes(deps: EmailInboxRouteDeps = {}): Hono {
  const app = new Hono();
  const resolveStore = deps.getStore || getKitMailsStore;
  const resolveActor = deps.resolveActor || headerActor;

  function requireStore(c: {
    json: (body: unknown, status?: number) => Response;
  }):
    | { ok: true; store: SqliteMailsStore }
    | { ok: false; res: Response } {
    const store = resolveStore();
    if (!store || !store.emailsReady()) {
      return {
        ok: false,
        res: c.json({ error: "Store mails indisponible" }, 503),
      };
    }
    return { ok: true, store };
  }

  app.post("/inbound", async (c) => {
    const expected = resolveInboundSecret();
    if (!expected) {
      return c.json({ error: "EMAIL_INBOUND_SECRET non configuré" }, 503);
    }
    const auth = c.req.header("authorization") || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const alt = c.req.header("x-email-inbound-secret") || "";
    const got = bearer || alt;
    if (!got || !safeEqual(got, expected)) {
      return c.json({ error: "Non autorisé" }, 401);
    }

    const store = resolveStore();
    if (!store || !store.emailsReady()) {
      return c.json({ error: "Schema emails kit absent" }, 503);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = parseInboundBody(body);
    if (!parsed.ok) {
      return c.json({ error: parsed.error, details: parsed.details }, 400);
    }
    const result = store.insertInboundFull(parsed.data);
    if (!result.ok) return c.json({ error: result.error }, 422);
    return c.json(
      { ok: true, id: result.id, duplicate: Boolean(result.duplicate) },
      result.duplicate ? 200 : 201,
    );
  });

  // ── Webhooks Resend (signature Svix, pas de session) ─────────────────
  app.post("/webhooks/resend", async (c) => {
    const secret = resolveResendWebhookSecret() || resolveMailSecret(
      "integration://resend-webhook",
    ) || "";
    if (!secret) {
      return c.json({ error: "RESEND_WEBHOOK_SECRET non configuré" }, 503);
    }
    const payload = await c.req.text().catch(() => "");
    const verify = verifySvixSignature({
      secret,
      headers: {
        id: c.req.header("svix-id") || "",
        timestamp: c.req.header("svix-timestamp") || "",
        signature: c.req.header("svix-signature") || "",
      },
      payload,
    });
    if (!verify.ok) {
      return c.json({ error: verify.error || "signature invalide" }, 401);
    }
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    let event: ResendWebhookEvent;
    try {
      event = JSON.parse(payload) as ResendWebhookEvent;
    } catch {
      return c.json({ error: "payload invalide" }, 400);
    }

    if (event.type === "email.received") {
      if (!resendInboundEnabled()) {
        return c.json({ ok: true, handled: false, reason: "inbound_opt_out" });
      }
      const apiKey =
        (process.env.RESEND_API_KEY || "").trim() ||
        resolveMailSecret("integration://resend") ||
        "";
      if (!apiKey) {
        return c.json({ error: "RESEND_API_KEY requis pour l'inbound" }, 503);
      }
      const emailId = String(event.data?.email_id || "").trim();
      if (!emailId) return c.json({ error: "email_id manquant" }, 400);
      const result = await ingestResendInboundEmail({
        store: gate.store,
        apiKey,
        emailId,
      });
      if (!result.ok) return c.json({ error: result.error }, 422);
      return c.json({
        ok: true,
        handled: true,
        id: result.id,
        duplicate: Boolean(result.duplicate),
      });
    }

    const outcome = applyResendWebhookEvent(gate.store, event);
    if (!outcome.ok) return c.json({ error: outcome.error }, 400);
    return c.json({
      ok: true,
      handled: outcome.handled,
      mailId: outcome.mailId ?? null,
    });
  });

  app.get("/meta", async (c) => {
    const store = resolveStore();
    const cfg = getMailsConfig();
    const resolved = resolveMailTransport({ store });
    return c.json({
      ready: Boolean(store?.emailsReady()),
      domain: resolveEmailDomain(),
      inboundConfigured: Boolean(resolveInboundSecret()),
      uiEnabled: cfg.uiEnabled !== false,
      pageSubtitle: resolvePageSubtitle(),
      emptyStateNoDomainHint: resolveEmptyStateNoDomainHint(),
      transport: {
        kind: resolved.kind,
        source: resolved.source,
        preset: resolved.preset,
        configured: Boolean(resolved.transport),
        error: resolved.transport
          ? null
          : describeMailTransportError(resolved.error),
        errorCode: resolved.transport ? null : resolved.error || "transport_unconfigured",
        send: resolveMailSendStatus({ resolved, store }),
      },
    });
  });

  app.get("/", async (c) => {
    const store = resolveStore();
    if (!store?.emailsReady()) return c.json({ rows: [], total: 0, unread: 0 });
    const q = c.req.query("q") || undefined;
    const folder = c.req.query("folder") || "inbox";
    const unreadOnly = c.req.query("unread") === "1";
    const limit = Number(c.req.query("limit") || "50");
    const offset = Number(c.req.query("offset") || "0");
    return c.json(store.listInbox({ folder, q, unreadOnly, limit, offset }));
  });

  // ── Envoi / brouillons ────────────────────────────────────────────────
  app.post("/send", async (c) => {
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    // Ne pas mettre en file un mail condamné à failed_permanent immédiat :
    // l'UI affichait « envoyé » alors que « Envoyés » restait vide.
    const transportGate = isMailTransportConfigured(gate.store);
    if (!transportGate.ok) {
      return c.json(
        { error: transportGate.error, code: transportGate.code },
        503,
      );
    }
    const body = await c.req.json().catch(() => null);
    const userId = (await resolveActor(c)).userId || "system";

    const draftId =
      body && typeof body === "object"
        ? String((body as { draftId?: unknown }).draftId || "").trim()
        : "";
    if (draftId) {
      try {
        const mail = gate.store.sendDraft(draftId);
        return c.json({ ok: true, mail }, 202);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "error";
        return c.json(
          { error: msg },
          msg === "not_found" ? 404 : 422,
        );
      }
    }

    const parsed = parseComposeBody(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    if (!parsed.input.to.length) return c.json({ error: "to requis" }, 400);
    if (!String(parsed.input.subject || "").trim()) {
      return c.json({ error: "subject requis" }, 400);
    }
    try {
      const mail = gate.store.enqueue({ ...parsed.input, userId });
      return c.json({ ok: true, mail }, 202);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "attachments_too_large" ? 413 : 422);
    }
  });

  app.post("/drafts", async (c) => {
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    const body = await c.req.json().catch(() => null);
    const parsed = parseComposeBody(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const userId = (await resolveActor(c)).userId || "system";
    const draft = gate.store.createDraft({
      userId,
      to: parsed.input.to,
      cc: parsed.input.cc,
      bcc: parsed.input.bcc,
      replyTo: parsed.input.replyTo,
      subject: parsed.input.subject,
      text: parsed.input.text,
      html: parsed.input.html,
      inReplyTo: parsed.input.inReplyTo,
      references: parsed.input.references,
    });
    for (const att of parsed.input.attachments || []) {
      const data = Buffer.from(
        String(att.content_base64 || "").replace(/\s/g, ""),
        "base64",
      );
      if (!data.length) continue;
      gate.store.addAttachment(draft.id, {
        filename: att.filename,
        contentType: att.content_type,
        data,
      });
    }
    return c.json({ ok: true, mail: draft }, 201);
  });

  app.put("/drafts/:id", async (c) => {
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    const id = String(c.req.param("id") || "").trim();
    const body = await c.req.json().catch(() => null);
    const parsed = parseComposeBody(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const b = (body || {}) as Record<string, unknown>;
    const mail = gate.store.updateDraft(id, {
      to: b.to !== undefined ? parsed.input.to : undefined,
      cc: b.cc !== undefined ? parsed.input.cc : undefined,
      bcc: b.bcc !== undefined ? parsed.input.bcc : undefined,
      replyTo: b.replyTo !== undefined ? parsed.input.replyTo : undefined,
      subject: b.subject !== undefined ? parsed.input.subject : undefined,
      text: b.text !== undefined ? parsed.input.text : undefined,
      html: b.html !== undefined ? parsed.input.html : undefined,
      inReplyTo: b.inReplyTo !== undefined ? parsed.input.inReplyTo : undefined,
      references:
        b.references !== undefined ? parsed.input.references : undefined,
    });
    if (!mail) return c.json({ error: "Brouillon introuvable" }, 404);
    return c.json({ ok: true, mail });
  });

  app.post("/drafts/:id/send", async (c) => {
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    const transportGate = isMailTransportConfigured(gate.store);
    if (!transportGate.ok) {
      return c.json(
        { error: transportGate.error, code: transportGate.code },
        503,
      );
    }
    const id = String(c.req.param("id") || "").trim();
    try {
      const mail = gate.store.sendDraft(id);
      return c.json({ ok: true, mail }, 202);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      return c.json({ error: msg }, msg === "not_found" ? 404 : 422);
    }
  });

  // Upload PJ sortante — mailId optionnel (sinon brouillon créé).
  app.post("/attachments", async (c) => {
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    const body = (await c.req.json().catch(() => null)) as {
      mailId?: unknown;
      filename?: unknown;
      content_type?: unknown;
      content_base64?: unknown;
    } | null;
    const contentB64 = String(body?.content_base64 || "").replace(/\s/g, "");
    if (!contentB64) return c.json({ error: "content_base64 requis" }, 400);
    let data: Buffer;
    try {
      data = Buffer.from(contentB64, "base64");
    } catch {
      return c.json({ error: "content_base64 invalide" }, 400);
    }
    if (!data.length) return c.json({ error: "content_base64 vide" }, 400);
    let mailId = String(body?.mailId || "").trim();
    if (!mailId) {
      const userId = (await resolveActor(c)).userId || "system";
      mailId = gate.store.createDraft({ userId }).id;
    }
    const result = gate.store.addAttachment(mailId, {
      filename: body?.filename != null ? String(body.filename) : undefined,
      contentType:
        body?.content_type != null ? String(body.content_type) : undefined,
      data,
    });
    if (!result.ok) {
      return c.json(
        { error: result.error },
        result.error === "attachments_too_large"
          ? 413
          : result.error === "not_found"
            ? 404
            : 422,
      );
    }
    return c.json(
      { ok: true, attachmentId: result.id, mailId, sizeBytes: result.sizeBytes },
      201,
    );
  });

  app.get("/threads/:threadId", async (c) => {
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    const threadId = String(c.req.param("threadId") || "").trim();
    if (!threadId) return c.json({ error: "threadId invalide" }, 400);
    return c.json({ rows: gate.store.listThread(threadId) });
  });

  // ── Réglages transport (owner) ────────────────────────────────────────
  app.get("/settings", async (c) => {
    const actor = await resolveActor(c);
    if (!actor.owner) return c.json({ error: "Réservé au owner" }, 403);
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    const settings = publicMailSettings(gate.store.getAllSettings());
    const resolved = resolveMailTransport({ store: gate.store });
    const effective = effectiveTransportPayload(gate.store, resolved);
    return c.json({
      settings,
      effective,
      send: effective.send,
    });
  });

  app.put("/settings", async (c) => {
    const actor = await resolveActor(c);
    if (!actor.owner) return c.json({ error: "Réservé au owner" }, 403);
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    const body = (await c.req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object") {
      return c.json({ error: "Requête invalide" }, 400);
    }
    const allowed = new Set<string>(MAIL_SETTINGS_KEYS);
    for (const [key, value] of Object.entries(body)) {
      if (!allowed.has(key)) continue;
      gate.store.setSetting(
        key,
        value == null || value === "" ? null : String(value),
      );
    }
    const resolved = resolveMailTransport({ store: gate.store });
    const send = resolveMailSendStatus({ resolved, store: gate.store });
    if (!hasMailCredentials({ resolved, store: gate.store })) {
      persistMailSendStatus(gate.store, send);
    }
    const effective = effectiveTransportPayload(gate.store, resolved, send);
    return c.json({
      ok: true,
      settings: publicMailSettings(gate.store.getAllSettings()),
      effective,
      send: effective.send,
    });
  });

  app.post("/settings/verify", async (c) => {
    const actor = await resolveActor(c);
    if (!actor.owner) return c.json({ error: "Réservé au owner" }, 403);
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    const resolved = resolveMailTransport({ store: gate.store });
    const credentials = hasMailCredentials({
      resolved,
      store: gate.store,
    });

    if (!resolved.transport) {
      const send = resolveMailSendStatus({
        resolved,
        store: gate.store,
        liveProbe: {
          ok: false,
          error: resolved.error || "transport_unconfigured",
        },
      });
      persistMailSendStatus(gate.store, send);
      return c.json({
        ok: false,
        configured: false,
        credentialsPresent: credentials,
        error: resolved.error || "transport_unconfigured",
        send,
        kind: resolved.kind,
        source: resolved.source,
      });
    }

    const verify = resolved.transport.verify
      ? await resolved.transport.verify()
      : { ok: true as const };

    if (isHardTransportError(verify.error)) {
      const send = resolveMailSendStatus({
        resolved,
        store: gate.store,
        liveProbe: { ok: false, error: verify.error },
      });
      persistMailSendStatus(gate.store, send);
      return c.json({
        ok: false,
        configured: true,
        credentialsPresent: credentials,
        error: verify.error,
        send,
        kind: resolved.kind,
        source: resolved.source,
        preset: resolved.preset,
      });
    }

    let probe: { ok: boolean; error?: string } = {
      ok: verify.ok,
      error: verify.error,
    };
    if (credentials) {
      const sent = await probeMailSend(resolved);
      if (!sent.ok) {
        probe = sent;
      } else if (verify.ok) {
        probe = sent;
      }
    }

    const send = resolveMailSendStatus({
      resolved,
      store: gate.store,
      liveProbe: probe,
    });
    persistMailSendStatus(gate.store, send);

    if (isHardTransportError(send.error)) {
      return c.json({
        ok: false,
        configured: true,
        credentialsPresent: credentials,
        error: send.error,
        send,
        kind: resolved.kind,
        source: resolved.source,
        preset: resolved.preset,
      });
    }

    // Token / secret présent : la config est OK même si le send est KO.
    if (credentials) {
      return c.json({
        ok: true,
        configured: true,
        credentialsPresent: true,
        sendOk: send.sendOk === true,
        error: send.sendOk ? null : send.error,
        send,
        kind: resolved.kind,
        source: resolved.source,
        preset: resolved.preset,
      });
    }

    return c.json({
      ok: probe.ok,
      configured: Boolean(resolved.transport),
      credentialsPresent: false,
      sendOk: probe.ok,
      error: probe.ok ? null : probe.error || "verification échouée",
      send,
      kind: resolved.kind,
      source: resolved.source,
      preset: resolved.preset,
    });
  });

  // ── Comptes IMAP (owner) ──────────────────────────────────────────────
  app.get("/accounts", async (c) => {
    const actor = await resolveActor(c);
    if (!actor.owner) return c.json({ error: "Réservé au owner" }, 403);
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    return c.json({ rows: gate.store.listAccounts().map(toPublicAccount) });
  });

  app.post("/accounts", async (c) => {
    const actor = await resolveActor(c);
    if (!actor.owner) return c.json({ error: "Réservé au owner" }, 403);
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    const body = await c.req.json().catch(() => null);
    const parsed = parseAccountCreateInput(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const account = gate.store.createAccount(parsed.input);
    return c.json({ ok: true, account: toPublicAccount(account) }, 201);
  });

  app.patch("/accounts/:id", async (c) => {
    const actor = await resolveActor(c);
    if (!actor.owner) return c.json({ error: "Réservé au owner" }, 403);
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    const id = String(c.req.param("id") || "").trim();
    const body = await c.req.json().catch(() => null);
    const parsed = parseAccountPatchInput(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const account = gate.store.updateAccount(id, parsed.patch);
    if (!account) return c.json({ error: "Compte introuvable" }, 404);
    return c.json({ ok: true, account: toPublicAccount(account) });
  });

  app.delete("/accounts/:id", async (c) => {
    const actor = await resolveActor(c);
    if (!actor.owner) return c.json({ error: "Réservé au owner" }, 403);
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    const id = String(c.req.param("id") || "").trim();
    if (!gate.store.deleteAccount(id)) {
      return c.json({ error: "Compte introuvable" }, 404);
    }
    return c.json({ ok: true });
  });

  app.post("/accounts/:id/verify", async (c) => {
    const actor = await resolveActor(c);
    if (!actor.owner) return c.json({ error: "Réservé au owner" }, 403);
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    const id = String(c.req.param("id") || "").trim();
    const account = gate.store.getAccount(id);
    if (!account) return c.json({ error: "Compte introuvable" }, 404);
    const result = await verifyImapAccount(account);
    return c.json(result);
  });

  app.post("/accounts/:id/sync", async (c) => {
    const actor = await resolveActor(c);
    if (!actor.owner) return c.json({ error: "Réservé au owner" }, 403);
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    const id = String(c.req.param("id") || "").trim();
    const account = gate.store.getAccount(id);
    if (!account) return c.json({ error: "Compte introuvable" }, 404);
    const result = await syncImapAccount(gate.store, account);
    return c.json(result);
  });

  // ── Détail / PJ / events / actions ────────────────────────────────────
  app.get("/:id/attachments/:attId", async (c) => {
    const id = String(c.req.param("id") || "").trim();
    const attId = String(c.req.param("attId") || "").trim();
    if (!id || !attId) return c.json({ error: "id invalide" }, 400);
    const store = resolveStore();
    if (!store) return c.json({ error: "Store mails indisponible" }, 503);
    const att = store.getAttachment(id, attId);
    if (!att) return c.json({ error: "Pièce jointe introuvable" }, 404);
    return new Response(new Uint8Array(att.data), {
      status: 200,
      headers: {
        "Content-Type": att.content_type || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${att.filename.replace(/"/g, "")}"`,
        "Content-Length": String(att.data.length),
      },
    });
  });

  app.get("/:id/events", async (c) => {
    const gate = requireStore(c);
    if (!gate.ok) return gate.res;
    const id = String(c.req.param("id") || "").trim();
    if (!id) return c.json({ error: "id invalide" }, 400);
    if (!gate.store.get(id)) return c.json({ error: "Mail introuvable" }, 404);
    return c.json({ events: gate.store.listEvents(id) });
  });

  app.get("/:id", async (c) => {
    const id = String(c.req.param("id") || "").trim();
    if (!id) return c.json({ error: "id invalide" }, 400);
    const store = resolveStore();
    if (!store) return c.json({ error: "Store mails indisponible" }, 503);
    const row = store.getInbox(id);
    if (!row) return c.json({ error: "Mail introuvable" }, 404);
    return c.json(row);
  });

  app.patch("/:id", async (c) => {
    const id = String(c.req.param("id") || "").trim();
    if (!id) return c.json({ error: "id invalide" }, 400);
    const store = resolveStore();
    if (!store) return c.json({ error: "Store mails indisponible" }, 503);
    const body = await c.req.json().catch(() => ({}));
    if (typeof (body as { read?: unknown }).read === "boolean") {
      if (!store.markRead(id, (body as { read: boolean }).read)) {
        return c.json({ error: "Mail introuvable" }, 404);
      }
    }
    const folder = (body as { folder?: unknown }).folder;
    if (typeof folder === "string" && folder.trim()) {
      if (!store.moveMail(id, folder.trim())) {
        return c.json({ error: "Dossier invalide ou mail introuvable" }, 422);
      }
    }
    const row = store.getInbox(id);
    if (!row) return c.json({ error: "Mail introuvable" }, 404);
    return c.json(row);
  });

  app.delete("/:id", async (c) => {
    const id = String(c.req.param("id") || "").trim();
    if (!id) return c.json({ error: "id invalide" }, 400);
    const store = resolveStore();
    if (!store) return c.json({ error: "Store mails indisponible" }, 503);
    if (!store.deleteMail(id)) return c.json({ error: "Mail introuvable" }, 404);
    return c.json({ ok: true });
  });

  return app;
}
