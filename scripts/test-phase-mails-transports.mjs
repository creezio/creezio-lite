#!/usr/bin/env node
/**
 * Gate MA2 — transports mails v2 (@creezio/mails).
 *
 * Sans réseau externe :
 *   1. résolution par configuration (§4.2 plan) : réglage store > env
 *      MAIL_TRANSPORT > rétro-inférence SMTP_x / RESEND_API_KEY > non configuré ;
 *   2. preset Cloudflare Email Service : host/port/user imposés ;
 *   3. envoi SMTP réel contre un serveur SMTP local éphémère (node:net) ;
 *   4. envoi Resend contre un mock HTTP local (payload + Idempotency-Key,
 *      429 → retryable, 422 → permanent).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mails = await import(path.join(ROOT, "packages/mails/dist/index.js"));

const MAIL_ENV_KEYS = [
  "MAIL_TRANSPORT",
  "MAIL_FROM",
  "MAIL_FILE_SINK_DIR",
  "RESEND_API_KEY",
  "SMTP_URL",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_SECURE",
  "SMTP_FROM",
  "EMAIL_FROM",
  "CLOUDFLARE_EMAIL_API_TOKEN",
  "CLOUDFLARE_EMAIL_TOKEN",
];

function withCleanMailEnv(fn) {
  const saved = new Map(MAIL_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of MAIL_ENV_KEYS) delete process.env[k];
  const restore = () => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  const out = fn();
  if (out && typeof out.finally === "function") return out.finally(restore);
  restore();
  return out;
}

/* ── 1. Résolution par configuration ─────────────────────────────────────── */

test("transports.resolve — env MAIL_TRANSPORT + rétro-inférence", () =>
  withCleanMailEnv(() => {
    // Rien de posé → non configuré.
    let r = mails.resolveMailTransport();
    assert.equal(r.transport, null);
    assert.equal(r.source, "none");
    assert.equal(r.error, "transport_unconfigured");
    assert.match(
      mails.describeMailTransportError(r.error),
      /Paramètres → Email/,
    );
    const gate = mails.isMailTransportConfigured();
    assert.equal(gate.ok, false);
    assert.equal(gate.code, "transport_unconfigured");

    // MAIL_TRANSPORT=file-sink + dossier.
    process.env.MAIL_TRANSPORT = "file-sink";
    process.env.MAIL_FILE_SINK_DIR = "/tmp/creezio-gate-sink";
    r = mails.resolveMailTransport();
    assert.equal(r.kind, "file-sink");
    assert.equal(r.source, "env");
    assert.equal(r.transport.id, mails.FILE_SINK_TRANSPORT_ID);

    // file-sink sans dossier → erreur explicite, pas de crash.
    delete process.env.MAIL_FILE_SINK_DIR;
    r = mails.resolveMailTransport();
    assert.equal(r.transport, null);
    assert.match(r.error, /file_sink_dir_required/);

    // MAIL_TRANSPORT=resend + clé.
    process.env.MAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "re_test_123";
    process.env.MAIL_FROM = "noreply@brand.test";
    r = mails.resolveMailTransport();
    assert.equal(r.kind, "resend");
    assert.equal(r.source, "env");
    assert.equal(r.from, "noreply@brand.test");
    assert.equal(r.transport.id, "resend");
    assert.equal(r.transport.capabilities.statusWebhooks, true);

    // resend sans clé → erreur explicite.
    delete process.env.RESEND_API_KEY;
    r = mails.resolveMailTransport();
    assert.equal(r.transport, null);
    assert.equal(r.error, "resend_secret_unresolved");

    // Transport inconnu → erreur explicite.
    process.env.MAIL_TRANSPORT = "pigeon";
    r = mails.resolveMailTransport();
    assert.equal(r.transport, null);
    assert.match(r.error, /transport_inconnu:pigeon/);

    // Rétro-inférence : SMTP_HOST seul (instances Docker existantes).
    delete process.env.MAIL_TRANSPORT;
    delete process.env.MAIL_FROM;
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_FROM = "noreply@winhub.test";
    r = mails.resolveMailTransport();
    assert.equal(r.kind, "smtp");
    assert.equal(r.source, "inferred");
    assert.equal(r.from, "noreply@winhub.test");
    assert.equal(r.transport.id, "smtp");

    // Rétro-inférence : RESEND_API_KEY seul.
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
    process.env.RESEND_API_KEY = "re_test_456";
    r = mails.resolveMailTransport();
    assert.equal(r.kind, "resend");
    assert.equal(r.source, "inferred");

    // Rétro-inférence Cloudflare : le token Email Sending suffit (infra par
    // défaut du kit), sous ses deux noms historiques, et prime sur Resend.
    delete process.env.RESEND_API_KEY;
    for (const key of ["CLOUDFLARE_EMAIL_API_TOKEN", "CLOUDFLARE_EMAIL_TOKEN"]) {
      process.env[key] = "cf_email_token_test";
      r = mails.resolveMailTransport();
      assert.equal(r.kind, "smtp", key);
      assert.equal(r.source, "inferred", key);
      assert.equal(r.preset, "cloudflare", key);
      delete process.env[key];
    }
  }));

test("transports.resolve — réglage store prioritaire sur env", () =>
  withCleanMailEnv(async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-gate-transports-"));
    const store = mails.createSqliteMailsStore({
      coreDbPath: path.join(tmp, "core.db"),
    });
    try {
      // Env dit smtp, le store dit file-sink → le store gagne.
      process.env.MAIL_TRANSPORT = "smtp";
      process.env.SMTP_HOST = "smtp.example.test";
      store.setSetting("transport", "file-sink");
      store.setSetting("file_sink_dir", path.join(tmp, "sink"));
      store.setSetting("from", "owner@brand.test");
      const r = mails.resolveMailTransport({ store });
      assert.equal(r.kind, "file-sink");
      assert.equal(r.source, "settings");
      assert.equal(r.from, "owner@brand.test");

      // Réglage effacé → retombe sur l'env.
      store.setSetting("transport", null);
      const r2 = mails.resolveMailTransport({ store });
      assert.equal(r2.kind, "smtp");
      assert.equal(r2.source, "env");
    } finally {
      store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }));

/* ── 2. Preset Cloudflare ────────────────────────────────────────────────── */

test("transports.cloudflare — host/port/user imposés", () =>
  withCleanMailEnv(() => {
    assert.equal(mails.CLOUDFLARE_SMTP_PRESET.host, "smtp.mx.cloudflare.net");
    assert.equal(mails.CLOUDFLARE_SMTP_PRESET.port, 465);
    assert.equal(mails.CLOUDFLARE_SMTP_PRESET.secure, true);
    assert.equal(mails.CLOUDFLARE_SMTP_PRESET.user, "api_token");

    process.env.MAIL_TRANSPORT = "cloudflare";
    process.env.CLOUDFLARE_EMAIL_API_TOKEN = "cf-token-test";
    process.env.MAIL_FROM = "noreply@brand.test";
    const r = mails.resolveMailTransport();
    assert.equal(r.kind, "smtp");
    assert.equal(r.preset, "cloudflare");
    assert.equal(r.source, "env");
    assert.ok(r.transport, "preset cloudflare → transport construit");
  }));

/* ── 3. SMTP contre serveur local éphémère ───────────────────────────────── */

function startEphemeralSmtpServer() {
  const received = { mailFrom: "", rcptTo: [], data: "" };
  const server = net.createServer((socket) => {
    let inData = false;
    let buffer = "";
    socket.write("220 creezio-gate ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (inData) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end === -1) return;
        received.data = buffer.slice(0, end);
        buffer = buffer.slice(end + 5);
        inData = false;
        socket.write("250 OK queued\r\n");
      }
      let idx;
      while (!inData && (idx = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const upper = line.toUpperCase();
        if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
          socket.write("250 creezio-gate\r\n");
        } else if (upper.startsWith("MAIL FROM:")) {
          received.mailFrom = line.slice("MAIL FROM:".length).trim();
          socket.write("250 OK\r\n");
        } else if (upper.startsWith("RCPT TO:")) {
          received.rcptTo.push(line.slice("RCPT TO:".length).trim());
          socket.write("250 OK\r\n");
        } else if (upper.startsWith("DATA")) {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (upper.startsWith("QUIT")) {
          socket.write("221 bye\r\n");
          socket.end();
        } else {
          socket.write("250 OK\r\n");
        }
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port, received });
    });
  });
}

test("transports.smtp — envoi complet (cc/replyTo/PJ) via serveur local", async () => {
  const { server, port, received } = await startEphemeralSmtpServer();
  try {
    const transport = mails.createSmtpMailTransport({
      host: "127.0.0.1",
      port,
      secure: false,
      from: "noreply@brand.test",
    });
    assert.equal(transport.id, "smtp");
    assert.equal(transport.capabilities.attachments, true);

    const result = await transport.send({
      id: randomUUID(),
      to: ["client@example.test"],
      cc: ["copie@example.test"],
      replyTo: "achats@brand.test",
      subject: "Gate transports SMTP",
      text: "Preuve fonctionnelle transport SMTP v2.",
      attachments: [
        {
          filename: "note.txt",
          contentType: "text/plain",
          content: Buffer.from("piece jointe gate"),
        },
      ],
    });
    assert.equal(result.ok, true, `envoi smtp en échec: ${result.error}`);
    assert.match(received.mailFrom, /noreply@brand\.test/);
    assert.equal(received.rcptTo.length, 2, "to + cc dans l'enveloppe");
    assert.match(received.data, /Subject: Gate transports SMTP/);
    assert.match(received.data, /Reply-To: achats@brand\.test/);
    assert.match(received.data, /Preuve fonctionnelle transport SMTP v2/);
    assert.match(received.data, /note\.txt/);
  } finally {
    server.close();
  }
});

test("transports.smtp — erreurs propres (unconfigured, connexion refusée)", async () => {
  const unconfigured = mails.createSmtpMailTransport({});
  const r1 = await unconfigured.send({
    id: randomUUID(),
    to: ["x@y.test"],
    subject: "x",
    text: "x",
  });
  assert.equal(r1.ok, false);
  assert.match(r1.error, /smtp_unconfigured/);
  assert.equal(r1.retryable, false);

  // Port fermé → erreur réseau retryable.
  const closed = mails.createSmtpMailTransport({
    host: "127.0.0.1",
    port: 1,
    secure: false,
  });
  const r2 = await closed.send({
    id: randomUUID(),
    to: ["x@y.test"],
    subject: "x",
    text: "x",
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.retryable, true, `erreur connexion doit être retryable: ${r2.error}`);
});

/* ── 4. Resend contre mock HTTP local ────────────────────────────────────── */

function startResendMock() {
  const calls = [];
  let nextStatus = 200;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: body ? JSON.parse(body) : null,
      });
      const status = nextStatus;
      nextStatus = 200;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(
        status === 200
          ? JSON.stringify({ id: "re_msg_mock_1" })
          : JSON.stringify({ message: `mock ${status}` }),
      );
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        calls,
        setNextStatus: (s) => (nextStatus = s),
      });
    });
  });
}

test("transports.resend — payload + Idempotency-Key + mapping erreurs", async () => {
  const mock = await startResendMock();
  try {
    const transport = mails.createResendMailTransport({
      apiKey: "re_test_key",
      from: "noreply@brand.test",
      baseUrl: mock.baseUrl,
    });
    assert.equal(transport.capabilities.idempotency, true);

    const mailId = randomUUID();
    const ok = await transport.send({
      id: mailId,
      to: ["client@example.test"],
      cc: ["copie@example.test"],
      subject: "Gate transports Resend",
      html: "<p>Bonjour</p>",
      inReplyTo: "<parent@brand.test>",
      attachments: [
        {
          filename: "devis.pdf",
          contentType: "application/pdf",
          content: Buffer.from("%PDF-mock"),
        },
      ],
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.providerMessageId, "re_msg_mock_1");
    assert.equal(mock.calls.length, 1);
    const call = mock.calls[0];
    assert.equal(call.url, "/emails");
    assert.equal(call.headers.authorization, "Bearer re_test_key");
    assert.equal(call.headers["idempotency-key"], mailId);
    assert.equal(call.body.from, "noreply@brand.test");
    assert.deepEqual(call.body.to, ["client@example.test"]);
    assert.deepEqual(call.body.cc, ["copie@example.test"]);
    assert.equal(call.body.subject, "Gate transports Resend");
    assert.equal(call.body.headers["In-Reply-To"], "<parent@brand.test>");
    assert.equal(call.body.attachments[0].filename, "devis.pdf");
    assert.equal(
      Buffer.from(call.body.attachments[0].content, "base64").toString(),
      "%PDF-mock",
    );

    // 429 → retryable.
    mock.setNextStatus(429);
    const throttled = await transport.send({
      id: randomUUID(),
      to: ["x@y.test"],
      subject: "x",
      text: "x",
    });
    assert.equal(throttled.ok, false);
    assert.equal(throttled.retryable, true);
    assert.match(throttled.error, /resend_http_429/);

    // 422 → permanent.
    mock.setNextStatus(422);
    const invalid = await transport.send({
      id: randomUUID(),
      to: ["x@y.test"],
      subject: "x",
      text: "x",
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.retryable, false);
    assert.match(invalid.error, /resend_http_422/);

    // verify() → GET /domains.
    const verify = await transport.verify();
    assert.equal(verify.ok, true);
    assert.equal(mock.calls.at(-1).url, "/domains");
  } finally {
    mock.server.close();
  }
});

/* ── 5. Secrets integration:// via le pont ───────────────────────────────── */

test("transports.secret-bridge — integration:// résolu via le pont", () =>
  withCleanMailEnv(() => {
    try {
      assert.equal(mails.resolveMailSecret("valeur-directe"), "valeur-directe");
      // Pas de pont → référence irrésoluble, pas de crash.
      assert.equal(mails.resolveMailSecret("integration://mail-key"), null);
      mails.configureMailSecretBridge({
        resolve: (ref) => (ref === "integration://mail-key" ? "s3cret" : null),
      });
      assert.equal(mails.resolveMailSecret("integration://mail-key"), "s3cret");
    } finally {
      mails.configureMailSecretBridge(null);
    }
  }));

test("transports.http-send — 503 sans transport, 202 avec file-sink", async () =>
  withCleanMailEnv(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-gate-send-"));
    const store = mails.createSqliteMailsStore({
      coreDbPath: path.join(tmp, "core.db"),
    });
    try {
      const routes = mails.createEmailInboxRoutes({ getStore: () => store });
      const denied = await routes.request("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: ["client@example.test"],
          subject: "Sans transport",
          text: "corps",
        }),
      });
      assert.equal(denied.status, 503);
      const deniedBody = await denied.json();
      assert.match(deniedBody.error, /Paramètres → Email/);
      assert.equal(deniedBody.code, "transport_unconfigured");
      assert.equal(
        store.listInbox({ folder: "outbox" }).total,
        0,
        "aucun mail mis en file si transport absent",
      );

      process.env.MAIL_TRANSPORT = "file-sink";
      process.env.MAIL_FILE_SINK_DIR = path.join(tmp, "sink");
      const ok = await routes.request("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: ["client@example.test"],
          subject: "Avec file-sink",
          text: "corps",
        }),
      });
      assert.equal(ok.status, 202);
      assert.equal(store.listInbox({ folder: "outbox" }).total, 1);
    } finally {
      store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }));

/* ── 6. Send status : token OK / send KO (550) vs non configuré ───────── */

test("transports.send-status — classification 550 vs nodemailer_absent", () => {
  const cf550 =
    "Can't send mail - all recipients were rejected: 550 Email sending is not configured for domain `demo.mail.crm.foove.io`";
  const c550 = mails.classifyMailSendError(cf550);
  assert.equal(c550.kind, "unavailable");
  assert.equal(c550.code, "send_unavailable");
  assert.equal(mails.isSendUnavailableError(cf550), true);
  assert.equal(mails.isHardTransportError(cf550), false);
  assert.match(mails.summarizeMailSendError(cf550), /domaine non onboardé/);

  const hard = mails.classifyMailSendError(
    "nodemailer_absent — npm i nodemailer côté app ou utiliser file-sink",
  );
  assert.equal(hard.kind, "hard");
  assert.equal(hard.code, "nodemailer_absent");
  assert.equal(mails.isHardTransportError(hard.code), true);

  const none = mails.classifyMailSendError("transport_unconfigured");
  assert.equal(none.kind, "unconfigured");
});

test("transports.send-status — verify bypass 550, save OK, meta expose send", async () =>
  withCleanMailEnv(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-gate-send-status-"));
    const store = mails.createSqliteMailsStore({
      coreDbPath: path.join(tmp, "core.db"),
    });
    const { server, port } = await startEphemeralSmtp550();
    try {
      const owner = { "x-creezio-mail-owner": "1" };
      const routes = mails.createEmailInboxRoutes({ getStore: () => store });

      const empty = await routes.request("/settings", { headers: owner });
      assert.equal(empty.status, 200);
      const emptyBody = await empty.json();
      assert.equal(emptyBody.send.state, "unconfigured");
      assert.match(emptyBody.send.message, /Email Sending non configuré/);

      const saved = await routes.request("/settings", {
        method: "PUT",
        headers: { ...owner, "Content-Type": "application/json" },
        body: JSON.stringify({
          transport: "smtp",
          from: "noreply@brand.test",
          smtp_host: "127.0.0.1",
          smtp_port: String(port),
          smtp_secure: "0",
          smtp_user: "api_token",
          secret_ref: "cfat_test_token_not_a_real_secret",
        }),
      });
      assert.equal(saved.status, 200);
      const savedBody = await saved.json();
      assert.equal(savedBody.ok, true);
      assert.equal(savedBody.effective.credentialsPresent, true);
      assert.ok(!savedBody.settings.send_status, "clés internes absentes du form");

      const verified = await routes.request("/settings/verify", {
        method: "POST",
        headers: owner,
      });
      assert.equal(verified.status, 200);
      const v = await verified.json();
      assert.equal(v.ok, true, `verify doit bypasser le 550: ${v.error}`);
      assert.equal(v.credentialsPresent, true);
      assert.equal(v.sendOk, false);
      assert.equal(v.send.state, "unavailable");
      assert.match(v.send.message, /envoi réel indisponible/);

      const meta = await routes.request("/meta");
      assert.equal(meta.status, 200);
      const metaBody = await meta.json();
      assert.equal(metaBody.transport.send.state, "unavailable");
      assert.match(metaBody.transport.send.message, /envoi réel indisponible/);

      const reget = await routes.request("/settings", { headers: owner });
      const regetBody = await reget.json();
      assert.equal(regetBody.send.state, "unavailable");
    } finally {
      server.close();
      store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }));

function startEphemeralSmtp550() {
  const server = net.createServer((socket) => {
    let inData = false;
    let buffer = "";
    socket.write("220 creezio-gate ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (inData) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end === -1) return;
        buffer = buffer.slice(end + 5);
        inData = false;
        socket.write(
          "550 Email sending is not configured for domain brand.test\r\n",
        );
      }
      let idx;
      while (!inData && (idx = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const upper = line.toUpperCase();
        if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
          socket.write("250 creezio-gate\r\n");
        } else if (upper.startsWith("MAIL FROM:")) {
          socket.write(
            "550 Email sending is not configured for domain brand.test\r\n",
          );
        } else if (upper.startsWith("DATA")) {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (upper.startsWith("QUIT")) {
          socket.write("221 bye\r\n");
          socket.end();
        } else {
          socket.write("250 OK\r\n");
        }
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}
