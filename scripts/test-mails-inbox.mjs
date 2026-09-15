/**
 * Tests inbox SoT @creezio/mails v2 (insert/list/read/delete/PJ +
 * configureMails + threads + migration schéma v1 → v2).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  configureMails,
  resetMailsConfigForTests,
  resolveEmailDomain,
  createSqliteMailsStore,
  createEmailInboxRoutes,
} = await import(path.join(root, "packages/mails/dist/index.js"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-mails-inbox-"));
const coreDb = path.join(tmp, "core.db");

resetMailsConfigForTests();
configureMails({
  rootDomain: "example.test",
  inboundSecretEnvKeys: ["EMAIL_INBOUND_SECRET", "BRAND_EMAIL_INBOUND_SECRET"],
  pageSubtitle: "Boîte test",
});

process.env.EMAIL_DOMAIN = "lab.mail.example.test";
process.env.EMAIL_INBOUND_SECRET = "secret-test-xyz";
assert.equal(resolveEmailDomain(), "lab.mail.example.test");

const store = createSqliteMailsStore({ coreDbPath: coreDb });
assert.equal(store.emailsReady(), true);

// ── Schéma v2 : colonnes outbox/threads présentes ────────────────────────
{
  const db = new DatabaseSync(coreDb);
  const cols = db
    .prepare(`PRAGMA table_info(creezio_platform_mails)`)
    .all()
    .map((c) => c.name);
  for (const col of [
    "cc",
    "bcc",
    "reply_to",
    "in_reply_to",
    "references_list",
    "thread_id",
    "account_id",
    "provider_message_id",
    "retry_count",
    "next_attempt_at",
    "last_error",
    "sent_at",
    "delivered_at",
  ]) {
    assert.ok(cols.includes(col), `colonne v2 ${col}`);
  }
  for (const table of [
    "creezio_platform_mail_events",
    "creezio_platform_mail_accounts",
    "creezio_platform_mail_settings",
  ]) {
    const row = db
      .prepare(
        `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`,
      )
      .get(table);
    assert.ok(row?.ok, `table v2 ${table}`);
  }
  db.close();
}

const a = store.insertInboundFull({
  message_id: "<msg-1@test>",
  from: "Fournisseur <fournisseur@example.com>",
  to: "achats@lab.mail.example.test",
  subject: "Devis mars",
  text: "Bonjour, voici le devis.",
  attachments: [
    {
      filename: "devis.pdf",
      content_type: "application/pdf",
      content_base64: Buffer.from("%PDF-fake").toString("base64"),
    },
  ],
});
assert.equal(a.ok, true);
assert.ok(typeof a.id === "string" && a.id.length > 0);

const dup = store.insertInboundFull({
  message_id: "<msg-1@test>",
  from: "Fournisseur <fournisseur@example.com>",
  to: "achats@lab.mail.example.test",
  subject: "Devis mars",
  text: "Bonjour, voici le devis.",
});
assert.equal(dup.ok, true);
assert.equal(dup.duplicate, true);
assert.equal(dup.id, a.id);

// ── Threads : une réponse hérite du thread du mail cité ─────────────────
{
  const reply = store.insertInboundFull({
    message_id: "<msg-2@test>",
    from: "Fournisseur <fournisseur@example.com>",
    to: "achats@lab.mail.example.test",
    subject: "Re: Devis mars",
    text: "Relance.",
    headers: { "In-Reply-To": "<msg-1@test>" },
  });
  assert.equal(reply.ok, true);
  const rootDetail = store.getInbox(a.id);
  const replyDetail = store.getInbox(reply.id);
  assert.equal(rootDetail.thread_id, a.id, "thread racine = id du mail");
  assert.equal(replyDetail.thread_id, a.id, "réponse hérite du thread");
  const thread = store.listThread(a.id);
  assert.equal(thread.length, 2);
  assert.equal(thread[0].id, a.id, "tri chrono : racine d'abord");
  // Envoi kit dans le même fil (enqueue avec inReplyTo)
  const out = store.enqueue({
    to: ["fournisseur@example.com"],
    subject: "Re: Devis mars — validé",
    text: "OK pour nous.",
    inReplyTo: "<msg-2@test>",
  });
  assert.equal(out.threadId, a.id, "sortant rejoint le fil");
  assert.equal(store.listThread(a.id).length, 3);
  store.deleteMail(out.id);
  assert.equal(store.deleteMail(reply.id), true);
}

const listed = store.listInbox({ folder: "inbox" });
assert.equal(listed.total, 1);
assert.equal(listed.unread, 1);
assert.equal(listed.rows[0].subject, "Devis mars");
assert.equal(listed.rows[0].has_attachments, 1);
assert.equal(listed.rows[0].status, "inbound");

const detail = store.getInbox(a.id);
assert.ok(detail);
assert.equal(detail.attachments.length, 1);
assert.equal(detail.attachments[0].filename, "devis.pdf");

const att = store.getAttachment(a.id, detail.attachments[0].id);
assert.ok(att);
assert.equal(att.filename, "devis.pdf");
assert.ok(att.data.length > 0);

assert.equal(store.markRead(a.id, true), true);
assert.equal(store.listInbox({}).unread, 0);
assert.equal(store.markRead(a.id, false), true);
assert.equal(store.listInbox({}).unread, 1);

// ── Dossiers : archive / corbeille ───────────────────────────────────────
assert.equal(store.moveMail(a.id, "archive"), true);
assert.equal(store.listInbox({ folder: "archive" }).total, 1);
assert.equal(store.listInbox({ folder: "inbox" }).total, 0);
assert.equal(store.moveMail(a.id, "dossier-invalide"), false);
assert.equal(store.moveMail(a.id, "inbox"), true);

assert.equal(store.deleteMail(a.id), true);
assert.equal(store.listInbox({}).total, 0);

const routes = createEmailInboxRoutes({ getStore: () => store });
assert.ok(routes);

// meta via app.request
const metaRes = await routes.request("/meta");
assert.equal(metaRes.status, 200);
const meta = await metaRes.json();
assert.equal(meta.domain, "lab.mail.example.test");
assert.equal(meta.inboundConfigured, true);
assert.equal(meta.uiEnabled, true);
assert.ok(meta.transport, "meta expose l'état transport");

store.close();

// ── Migration : une DB v1 existante migre sans perte ─────────────────────
{
  const v1Db = path.join(tmp, "core-v1.db");
  const db = new DatabaseSync(v1Db);
  db.exec(`
CREATE TABLE creezio_platform_mails (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  provider_id TEXT,
  from_addr TEXT NOT NULL DEFAULT '',
  message_id TEXT,
  folder TEXT NOT NULL DEFAULT 'outbox',
  read_at TEXT,
  brand_email_id TEXT,
  text_body TEXT,
  html_body TEXT,
  received_at TEXT,
  raw_headers TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE creezio_platform_mail_attachments (
  id TEXT PRIMARY KEY,
  mail_id TEXT NOT NULL REFERENCES creezio_platform_mails(id) ON DELETE CASCADE,
  filename TEXT NOT NULL DEFAULT 'piece-jointe',
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  data BLOB NOT NULL
);
INSERT INTO creezio_platform_mails
  (id, user_id, to_addr, subject, body, status, provider_id, from_addr,
   message_id, folder, created_at, updated_at)
VALUES
  ('m-inbound', 'system', 'inbox@lab', 'Ancien inbound', 'corps', 'inbound',
   NULL, 'x@y.z', '<legacy-1@test>', 'inbox', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'),
  ('m-sent', 'u1', 'a@b.c', 'Ancien envoyé', 'corps', 'sent',
   'file-sink', '', NULL, 'outbox', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'),
  ('m-draft', 'u1', 'a@b.c', 'Ancien brouillon', 'corps', 'draft',
   NULL, '', NULL, 'outbox', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');
`);
  db.close();

  const migrated = createSqliteMailsStore({ coreDbPath: v1Db });
  assert.equal(migrated.emailsReady(), true);
  // Inbound v1 toujours listé (dédup message_id intacte)
  assert.equal(migrated.listInbox({ folder: "inbox" }).total, 1);
  const dupLegacy = migrated.insertInboundFull({
    message_id: "<legacy-1@test>",
    from: "x@y.z",
    to: "inbox@lab",
    subject: "Ancien inbound",
  });
  assert.equal(dupLegacy.duplicate, true);
  // Statuts/folders legacy réalignés : sent → sent, draft → drafts
  assert.equal(migrated.get("m-sent").folder, "sent");
  assert.equal(migrated.get("m-draft").folder, "drafts");
  assert.equal(migrated.listInbox({ folder: "sent" }).total, 1);
  assert.equal(migrated.listInbox({ folder: "drafts" }).total, 1);
  migrated.close();
}

resetMailsConfigForTests();
delete process.env.EMAIL_DOMAIN;
delete process.env.EMAIL_INBOUND_SECRET;
fs.rmSync(tmp, { recursive: true, force: true });
console.log("OK mails-inbox");
