#!/usr/bin/env node
/**
 * Gate MB1 — outbox durable @creezio/mails.
 *
 *   1. `enqueue()` non bloquant : statut queued + folder outbox + événement,
 *      aucun envoi dans l'appel ;
 *   2. worker : drainOnce envoie via le transport, statut sent + journal ;
 *   3. retries : transport failing retryable → re-queued avec backoff,
 *      puis `failed_permanent` après max ; erreurs non-retryable → permanent
 *      direct ; journal complet (queued/attempt/sent/failed) ;
 *   4. PJ sortante round-trip (enqueue base64 → OutgoingMail Buffer) ;
 *   5. brouillons : createDraft/updateDraft/sendDraft/addAttachment.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mails = await import(path.join(ROOT, "packages/mails/dist/index.js"));

function makeStore(tmp) {
  return mails.createSqliteMailsStore({
    coreDbPath: path.join(tmp, "core.db"),
  });
}

function eventTypes(store, id) {
  return store.listEvents(id).map((e) => e.type);
}

test("outbox.enqueue — non bloquant, queued + journal", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-gate-outbox-"));
  const store = makeStore(tmp);
  try {
    const mail = store.enqueue({
      to: ["client@example.test"],
      subject: "Commande #42 confirmée",
      text: "Merci pour votre commande.",
    });
    assert.equal(mail.status, "queued");
    assert.equal(mail.folder, "outbox");
    assert.equal(mail.userId, "system");
    assert.equal(mail.threadId, mail.id, "nouveau fil = id du mail");
    assert.ok(mail.nextAttemptAt, "next_attempt_at posé (dû immédiatement)");
    assert.deepEqual(eventTypes(store, mail.id), ["queued"]);
    assert.equal(store.countDueOutbox(), 1);

    // Validation d'entrée.
    assert.throws(() => store.enqueue({ to: [], subject: "x" }), /to_required/);
    assert.throws(
      () => store.enqueue({ to: ["a@b.c"], subject: "" }),
      /subject_required/,
    );
  } finally {
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("outbox.worker — envoi, retries backoff, failed_permanent", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-gate-outbox-"));
  const store = makeStore(tmp);
  try {
    // Backoff exponentiel borné.
    assert.equal(mails.computeOutboxBackoffMs(0), 60_000);
    assert.equal(mails.computeOutboxBackoffMs(1), 120_000);
    assert.equal(mails.computeOutboxBackoffMs(10), 3_600_000);

    // Transport contrôlable par la gate.
    const sent = [];
    let mode = "ok";
    const transport = {
      id: "gate-mock",
      capabilities: { attachments: true, idempotency: false, statusWebhooks: false },
      async send(mail) {
        if (mode === "ok") {
          sent.push(mail);
          return { ok: true, providerMessageId: `pm-${mail.id.slice(0, 8)}` };
        }
        return {
          ok: false,
          error: mode === "retryable" ? "tempo_503" : "hard_550",
          retryable: mode === "retryable",
        };
      },
    };
    const worker = mails.startMailOutboxWorker({
      store,
      resolveTransport: () => transport,
      manual: true,
      maxAttempts: 3,
    });

    // 1. Envoi OK.
    const okMail = store.enqueue({
      to: ["a@b.test"],
      subject: "OK",
      text: "corps",
    });
    assert.equal(await worker.drainOnce(), 1);
    const okRow = store.get(okMail.id);
    assert.equal(okRow.status, "sent");
    assert.equal(okRow.folder, "sent");
    assert.ok(okRow.sentAt);
    assert.match(okRow.providerMessageId, /^pm-/);
    assert.deepEqual(eventTypes(store, okMail.id), ["queued", "attempt", "sent"]);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ["a@b.test"]);

    // 2. Échec retryable → re-queued avec backoff futur.
    mode = "retryable";
    const retryMail = store.enqueue({
      to: ["b@c.test"],
      subject: "Retry",
      text: "corps",
    });
    await worker.drainOnce();
    let row = store.get(retryMail.id);
    assert.equal(row.status, "queued");
    assert.equal(row.retryCount, 1);
    assert.equal(row.lastError, "tempo_503");
    assert.ok(
      new Date(row.nextAttemptAt).getTime() > Date.now() + 30_000,
      "backoff planifié dans le futur",
    );
    // Pas dû → le drain suivant ne le reprend pas.
    assert.equal(store.countDueOutbox(), 0);
    assert.equal(await worker.drainOnce(), 0);

    // Forcer l'échéance deux fois → failed_permanent après maxAttempts=3.
    for (const expected of [2, null]) {
      store.scheduleRetry(
        retryMail.id,
        row.lastError,
        new Date(Date.now() - 1000).toISOString(),
      );
      // scheduleRetry incrémente retry_count : compenser pour le test.
      store.db
        .prepare(
          `UPDATE creezio_platform_mails SET retry_count = retry_count - 1 WHERE id = ?`,
        )
        .run(retryMail.id);
      await worker.drainOnce();
      row = store.get(retryMail.id);
      if (expected !== null) {
        assert.equal(row.status, "queued");
        assert.equal(row.retryCount, expected);
      }
    }
    assert.equal(row.status, "failed_permanent");
    assert.equal(row.lastError, "tempo_503");
    const types = eventTypes(store, retryMail.id);
    assert.equal(types[0], "queued");
    assert.ok(types.filter((t) => t === "attempt").length >= 3);
    assert.ok(types.filter((t) => t === "failed").length >= 3);

    // 3. Échec non-retryable → failed_permanent direct.
    mode = "permanent";
    const hardMail = store.enqueue({
      to: ["c@d.test"],
      subject: "Hard fail",
      text: "corps",
    });
    await worker.drainOnce();
    const hardRow = store.get(hardMail.id);
    assert.equal(hardRow.status, "failed_permanent");
    assert.equal(hardRow.lastError, "hard_550");
    assert.equal(hardRow.retryCount, 0);

    // 4. Transport non résolu → failed_permanent transport_unconfigured.
    const noTransportWorker = mails.startMailOutboxWorker({
      store,
      resolveTransport: () => null,
      manual: true,
    });
    const orphan = store.enqueue({
      to: ["d@e.test"],
      subject: "Sans transport",
      text: "corps",
    });
    await noTransportWorker.drainOnce();
    assert.equal(store.get(orphan.id).status, "failed_permanent");
    assert.equal(store.get(orphan.id).lastError, "transport_unconfigured");
    noTransportWorker.stop();
    worker.stop();
  } finally {
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("outbox.attachments — PJ sortante round-trip enqueue → transport", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-gate-outbox-"));
  const store = makeStore(tmp);
  try {
    const pdf = Buffer.from("%PDF-gate-outbox");
    const mail = store.enqueue({
      to: ["client@example.test"],
      subject: "Avec PJ",
      text: "Voir pièce jointe.",
      attachments: [
        {
          filename: "facture.pdf",
          content_type: "application/pdf",
          content_base64: pdf.toString("base64"),
        },
      ],
    });
    const outgoing = store.getOutgoing(mail.id);
    assert.equal(outgoing.attachments.length, 1);
    assert.equal(outgoing.attachments[0].filename, "facture.pdf");
    assert.equal(outgoing.attachments[0].contentType, "application/pdf");
    assert.ok(outgoing.attachments[0].content.equals(pdf), "BLOB intact");

    // Limite totale : refus explicite.
    assert.throws(
      () =>
        store.enqueue({
          to: ["x@y.test"],
          subject: "Trop gros",
          attachments: [
            {
              filename: "gros.bin",
              content_base64: Buffer.alloc(26 * 1024 * 1024).toString("base64"),
            },
          ],
        }),
      /attachments_too_large/,
    );

    // File-sink de bout en bout (transport réel le plus simple).
    const sinkDir = path.join(tmp, "sink");
    const worker = mails.startMailOutboxWorker({
      store,
      resolveTransport: () =>
        mails.createFileSinkMailTransport({ outDir: sinkDir }),
      manual: true,
    });
    await worker.drainOnce();
    worker.stop();
    assert.equal(store.get(mail.id).status, "sent");
    const files = fs.readdirSync(sinkDir).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 1);
    const payload = JSON.parse(
      fs.readFileSync(path.join(sinkDir, files[0]), "utf8"),
    );
    assert.deepEqual(payload.to, ["client@example.test"]);
    assert.equal(payload.subject, "Avec PJ");
  } finally {
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("outbox.drafts — createDraft/updateDraft/addAttachment/sendDraft", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-gate-outbox-"));
  const store = makeStore(tmp);
  try {
    const draft = store.createDraft({
      userId: "user-1",
      to: "client@example.test",
      subject: "Brouillon",
      body: "v1",
    });
    assert.equal(draft.status, "draft");
    assert.equal(draft.folder, "drafts");
    assert.equal(store.listInbox({ folder: "drafts" }).total, 1);

    const updated = store.updateDraft(draft.id, {
      subject: "Brouillon v2",
      text: "v2",
      cc: ["copie@example.test"],
    });
    assert.equal(updated.subject, "Brouillon v2");
    assert.equal(updated.textBody, "v2");
    assert.equal(updated.cc, "copie@example.test");

    const att = store.addAttachment(draft.id, {
      filename: "note.txt",
      contentType: "text/plain",
      data: Buffer.from("hello"),
    });
    assert.equal(att.ok, true);
    assert.equal(store.attachmentsTotalBytes(draft.id), 5);

    // sendDraft d'un autre user → refus.
    assert.throws(() => store.sendDraft(draft.id, "user-2"), /forbidden/);

    const queued = store.sendDraft(draft.id, "user-1");
    assert.equal(queued.status, "queued");
    assert.equal(queued.folder, "outbox");
    assert.equal(queued.threadId, draft.id);
    assert.deepEqual(eventTypes(store, draft.id), ["queued"]);
    // Un draft déjà parti ne se renvoie pas.
    assert.throws(() => store.sendDraft(draft.id, "user-1"), /not_a_draft/);
    // updateDraft sur un mail queued → null.
    assert.equal(store.updateDraft(draft.id, { subject: "x" }), null);
  } finally {
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
