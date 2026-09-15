#!/usr/bin/env node
/**
 * Gate MB2 — webhooks Resend (@creezio/mails).
 *
 *   1. signature Svix (HMAC-SHA256 natif) : valide / invalide / expirée /
 *      secret manquant ;
 *   2. `email.delivered` / `email.bounced` → statut + événement journalisé,
 *      corrélé par `provider_message_id` ;
 *   3. inbound opt-in : `email.received` + mock API Receiving → mail en base
 *      avec PJ (dédup message_id) ;
 *   4. route HTTP `/webhooks/resend` : 401 sans signature, 200 signée.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mails = await import(path.join(ROOT, "packages/mails/dist/index.js"));

const SECRET_RAW = crypto.randomBytes(24);
const WEBHOOK_SECRET = `whsec_${SECRET_RAW.toString("base64")}`;

function signPayload(payload, { id = "msg_gate_1", timestamp } = {}) {
  const ts = timestamp ?? String(Math.floor(Date.now() / 1000));
  const sig = crypto
    .createHmac("sha256", SECRET_RAW)
    .update(`${id}.${ts}.${payload}`)
    .digest("base64");
  return { id, timestamp: ts, signature: `v1,${sig}` };
}

test("webhooks.svix — valide / invalide / expirée", () => {
  const payload = JSON.stringify({ type: "email.delivered" });
  const headers = signPayload(payload);

  assert.deepEqual(
    mails.verifySvixSignature({ secret: WEBHOOK_SECRET, headers, payload }),
    { ok: true },
  );

  // Payload altéré → mismatch.
  const tampered = mails.verifySvixSignature({
    secret: WEBHOOK_SECRET,
    headers,
    payload: payload + "x",
  });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.error, "svix_signature_mismatch");

  // Mauvais secret → mismatch.
  const wrongSecret = mails.verifySvixSignature({
    secret: `whsec_${crypto.randomBytes(24).toString("base64")}`,
    headers,
    payload,
  });
  assert.equal(wrongSecret.ok, false);

  // Timestamp expiré (> 5 min).
  const old = String(
    Math.floor(Date.now() / 1000) - mails.SVIX_TIMESTAMP_TOLERANCE_S - 60,
  );
  const expired = mails.verifySvixSignature({
    secret: WEBHOOK_SECRET,
    headers: signPayload(payload, { timestamp: old }),
    payload,
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.error, "svix_timestamp_expired");

  // Secret absent / headers absents.
  assert.equal(
    mails.verifySvixSignature({ secret: "", headers, payload }).error,
    "webhook_secret_unconfigured",
  );
  assert.equal(
    mails.verifySvixSignature({
      secret: WEBHOOK_SECRET,
      headers: { id: "", timestamp: "", signature: "" },
      payload,
    }).error,
    "svix_headers_missing",
  );

  // Plusieurs signatures dans le header (rotation) : une valide suffit.
  const multi = mails.verifySvixSignature({
    secret: WEBHOOK_SECRET,
    headers: {
      ...headers,
      signature: `v1,AAAA ${headers.signature}`,
    },
    payload,
  });
  assert.equal(multi.ok, true);
});

test("webhooks.statuts — delivered/bounced par provider_message_id", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-gate-webhooks-"));
  const store = mails.createSqliteMailsStore({
    coreDbPath: path.join(tmp, "core.db"),
  });
  try {
    const mail = store.enqueue({
      to: ["client@example.test"],
      subject: "Suivi statut",
      text: "corps",
    });
    store.markSent(mail.id, "re_prov_123");

    // delivered.
    const delivered = mails.applyResendWebhookEvent(store, {
      type: "email.delivered",
      data: { email_id: "re_prov_123" },
    });
    assert.deepEqual(delivered, {
      ok: true,
      handled: true,
      mailId: mail.id,
      kind: "email.delivered",
    });
    let row = store.get(mail.id);
    assert.equal(row.status, "delivered");
    assert.ok(row.deliveredAt);

    // bounced avec détail.
    const bounced = mails.applyResendWebhookEvent(store, {
      type: "email.bounced",
      data: {
        email_id: "re_prov_123",
        bounce: { type: "Permanent", subType: "General", message: "550 no user" },
      },
    });
    assert.equal(bounced.handled, true);
    row = store.get(mail.id);
    assert.equal(row.status, "bounced");
    const events = store.listEvents(mail.id);
    const bounceEvent = events.find((e) => e.type === "bounced");
    assert.match(bounceEvent.detail, /Permanent \/ General \/ 550 no user/);
    assert.equal(bounceEvent.provider, "resend");

    // provider_message_id inconnu → non handled, pas de crash.
    const unknown = mails.applyResendWebhookEvent(store, {
      type: "email.delivered",
      data: { email_id: "re_inconnu" },
    });
    assert.equal(unknown.ok, true);
    assert.equal(unknown.handled, false);

    // Type non mappé → ignoré proprement.
    const other = mails.applyResendWebhookEvent(store, {
      type: "email.opened",
      data: { email_id: "re_prov_123" },
    });
    assert.equal(other.handled, false);
  } finally {
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("webhooks.inbound — email.received via mock API Receiving", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-gate-webhooks-"));
  const store = mails.createSqliteMailsStore({
    coreDbPath: path.join(tmp, "core.db"),
  });

  // Mock API Receiving Resend : détail + PJ + download_url.
  const server = http.createServer((req, res) => {
    if (req.url === "/emails/receiving/re_in_1") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          message_id: "<inbound-1@ext.test>",
          from: "Client <client@ext.test>",
          to: ["contact@brand.test"],
          subject: "Demande entrante",
          text: "Bonjour, question sur le produit.",
          html: "<p>Bonjour</p>",
          created_at: "2026-08-08T10:00:00Z",
          headers: [{ name: "In-Reply-To", value: "<parent@ext.test>" }],
        }),
      );
      return;
    }
    if (req.url === "/emails/receiving/re_in_1/attachments") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: [
            {
              filename: "photo.png",
              content_type: "image/png",
              download_url: `http://127.0.0.1:${server.address().port}/dl/photo`,
            },
          ],
        }),
      );
      return;
    }
    if (req.url === "/dl/photo") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(Buffer.from("PNG-gate"));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // Opt-in par env.
    delete process.env.MAIL_INBOUND_RESEND;
    assert.equal(mails.resendInboundEnabled(), false);
    process.env.MAIL_INBOUND_RESEND = "1";
    assert.equal(mails.resendInboundEnabled(), true);

    const result = await mails.ingestResendInboundEmail({
      store,
      apiKey: "re_key",
      emailId: "re_in_1",
      baseUrl,
    });
    assert.equal(result.ok, true);
    const detail = store.getInbox(result.id);
    assert.equal(detail.subject, "Demande entrante");
    assert.equal(detail.folder, "inbox");
    assert.equal(detail.attachments.length, 1);
    assert.equal(detail.attachments[0].filename, "photo.png");
    const att = store.getAttachment(result.id, detail.attachments[0].id);
    assert.equal(att.data.toString(), "PNG-gate");

    // Redélivraison du même webhook → dédup message_id.
    const dup = await mails.ingestResendInboundEmail({
      store,
      apiKey: "re_key",
      emailId: "re_in_1",
      baseUrl,
    });
    assert.equal(dup.ok, true);
    assert.equal(dup.duplicate, true);
    assert.equal(store.listInbox({ folder: "inbox" }).total, 1);
  } finally {
    delete process.env.MAIL_INBOUND_RESEND;
    server.close();
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("webhooks.route — /webhooks/resend refuse sans signature, accepte signée", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-gate-webhooks-"));
  const store = mails.createSqliteMailsStore({
    coreDbPath: path.join(tmp, "core.db"),
  });
  const prevSecret = process.env.RESEND_WEBHOOK_SECRET;
  process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
  try {
    const mail = store.enqueue({
      to: ["client@example.test"],
      subject: "Route webhook",
      text: "corps",
    });
    store.markSent(mail.id, "re_prov_route");

    const routes = mails.createEmailInboxRoutes({ getStore: () => store });
    const payload = JSON.stringify({
      type: "email.delivered",
      data: { email_id: "re_prov_route" },
    });

    // Sans signature → 401.
    const denied = await routes.request("/webhooks/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    assert.equal(denied.status, 401);

    // Signature valide → 200 + statut appliqué.
    const svix = signPayload(payload);
    const ok = await routes.request("/webhooks/resend", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "svix-id": svix.id,
        "svix-timestamp": svix.timestamp,
        "svix-signature": svix.signature,
      },
      body: payload,
    });
    assert.equal(ok.status, 200);
    assert.equal(store.get(mail.id).status, "delivered");
  } finally {
    if (prevSecret === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET = prevSecret;
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
