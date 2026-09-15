#!/usr/bin/env node
/**
 * Gate OS — configureMails + file-sink send + schéma inbox prêt.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE_TMP = path.join(ROOT, ".tmp-gates");
fs.mkdirSync(GATE_TMP, { recursive: true });

const mails = await import(path.join(ROOT, "packages/mails/dist/index.js"));

test("mails.configure — domaine + secret inbound", () => {
  mails.resetMailsConfigForTests();
  mails.configureMails({
    rootDomain: "example.test",
    inboundSecretEnvKeys: ["EMAIL_INBOUND_SECRET", "BRAND_EMAIL_INBOUND_SECRET"],
    pageSubtitle: "Boîte probe",
    mailSubdomain: "mail",
  });

  const cfg = mails.getMailsConfig();
  assert.equal(cfg.rootDomain, "example.test");
  assert.deepEqual(cfg.inboundSecretEnvKeys, [
    "EMAIL_INBOUND_SECRET",
    "BRAND_EMAIL_INBOUND_SECRET",
  ]);

  process.env.EMAIL_DOMAIN = "lab.mail.example.test";
  process.env.EMAIL_INBOUND_SECRET = "probe-secret";
  assert.equal(mails.resolveEmailDomain(), "lab.mail.example.test");
  assert.equal(mails.resolveInboundSecret(), "probe-secret");
  assert.match(mails.resolvePageSubtitle(), /Boîte probe/);

  delete process.env.EMAIL_DOMAIN;
  delete process.env.EMAIL_INBOUND_SECRET;
  mails.resetMailsConfigForTests();
});

test("mails.inbox — schema ready + inbound", () => {
  mails.resetMailsConfigForTests();
  mails.configureMails({ rootDomain: "example.test" });

  const tmp = fs.mkdtempSync(path.join(GATE_TMP, "os-mails-config-"));
  const coreDb = path.join(tmp, "core.db");
  try {
    const store = mails.createSqliteMailsStore({ coreDbPath: coreDb });
    assert.equal(store.emailsReady(), true);

    const inbound = store.insertInboundFull({
      message_id: "<probe-1@example.test>",
      from: "Sender <sender@example.test>",
      to: "inbox@lab.mail.example.test",
      subject: "Probe inbound",
      text: "Hello kit mails",
    });
    assert.equal(inbound.ok, true);
    assert.ok(inbound.id);

    const listed = store.listInbox({ folder: "inbox" });
    assert.equal(listed.total, 1);
    assert.equal(listed.rows[0].subject, "Probe inbound");

    store.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    mails.resetMailsConfigForTests();
  }
});

test("mails.file-sink — draft → outbox → JSON local (v2)", async () => {
  mails.resetMailsConfigForTests();
  mails.configureMails({ rootDomain: "example.test" });

  const tmp = fs.mkdtempSync(path.join(GATE_TMP, "os-mails-sink-"));
  const coreDb = path.join(tmp, "core.db");
  const outDir = path.join(tmp, "outbox");
  try {
    const store = mails.createSqliteMailsStore({ coreDbPath: coreDb });

    const draft = store.createDraft({
      userId: "user-1",
      to: "dest@example.test",
      subject: "Probe sortant",
      body: "Contenu probe",
    });
    const queued = store.sendDraft(draft.id, "user-1");
    assert.equal(queued.status, "queued");

    const worker = mails.startMailOutboxWorker({
      store,
      resolveTransport: () =>
        mails.createFileSinkMailTransport({ outDir }),
      manual: true,
    });
    await worker.drainOnce();
    worker.stop();

    const sent = store.get(draft.id);
    assert.equal(sent.status, "sent");
    assert.equal(sent.folder, "sent");

    const files = fs.readdirSync(outDir).filter((f) => f.endsWith(".json"));
    assert.equal(files.length, 1);
    const payload = JSON.parse(
      fs.readFileSync(path.join(outDir, files[0]), "utf8"),
    );
    assert.deepEqual(payload.to, ["dest@example.test"]);
    assert.equal(payload.subject, "Probe sortant");

    store.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    mails.resetMailsConfigForTests();
  }
});
