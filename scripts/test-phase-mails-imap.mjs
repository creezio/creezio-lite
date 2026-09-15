#!/usr/bin/env node
/**
 * Gate MC1 — comptes + sync IMAP (@creezio/mails).
 *
 *   1. CRUD comptes : parse inputs (secretRef integration:// obligatoire,
 *      secret en clair via le pont), le secret n'est JAMAIS renvoyé ;
 *   2. moteur de sync contre un serveur IMAP mock in-process (node:net,
 *      dialogue minimal LOGIN/SELECT/UID FETCH) : ingestion + threads,
 *      sync incrémentale par UID, dédup message_id, reset UIDVALIDITY ;
 *   3. erreurs propres : secret irrésoluble, connexion refusée.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mails = await import(path.join(ROOT, "packages/mails/dist/index.js"));

/* ── Serveur IMAP mock (dialogue minimal pour imapflow) ─────────────────── */

function rfc822(msg) {
  return [
    `Message-ID: ${msg.messageId}`,
    `From: ${msg.from}`,
    `To: ${msg.to}`,
    `Subject: ${msg.subject}`,
    `Date: ${msg.date || "Fri, 07 Aug 2026 10:00:00 +0000"}`,
    ...(msg.inReplyTo ? [`In-Reply-To: ${msg.inReplyTo}`] : []),
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    msg.body,
    ``,
  ].join("\r\n");
}

/**
 * Serveur IMAP minimal : greeting, CAPABILITY, LOGIN, SELECT INBOX,
 * UID FETCH n:* (UID + BODY.PEEK[] en littéraux), LOGOUT.
 * `state.messages` : { uid, raw } triés par uid ; `state.uidValidity` mutable.
 */
function startMockImapServer(state) {
  const server = net.createServer((socket) => {
    socket.write("* OK [CAPABILITY IMAP4rev1] creezio-gate-imap ready\r\n");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleLine(line);
      }
    });

    function handleLine(line) {
      const m = line.match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/);
      if (!m) return;
      const [, tag, cmdRaw, rest = ""] = m;
      const cmd = cmdRaw.toUpperCase();
      if (cmd === "CAPABILITY") {
        socket.write("* CAPABILITY IMAP4rev1\r\n");
        socket.write(`${tag} OK CAPABILITY completed\r\n`);
      } else if (cmd === "ID") {
        socket.write("* ID NIL\r\n");
        socket.write(`${tag} OK ID completed\r\n`);
      } else if (cmd === "LOGIN") {
        state.logins.push(rest);
        if (rest.includes(state.expectedPass)) {
          socket.write(`${tag} OK [CAPABILITY IMAP4rev1] LOGIN completed\r\n`);
        } else {
          socket.write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
        }
      } else if (cmd === "LIST") {
        // `LIST "" ""` (délimiteur racine) puis `LIST "" "INBOX"`.
        if (/""\s*$/.test(rest)) {
          socket.write(`* LIST (\\Noselect) "/" ""\r\n`);
        } else {
          socket.write(`* LIST (\\HasNoChildren) "/" "INBOX"\r\n`);
        }
        socket.write(`${tag} OK LIST completed\r\n`);
      } else if (cmd === "SELECT" || cmd === "EXAMINE") {
        const exists = state.messages.length;
        const uidNext =
          state.messages.reduce((mx, msg) => Math.max(mx, msg.uid), 0) + 1;
        socket.write(`* ${exists} EXISTS\r\n`);
        socket.write(`* 0 RECENT\r\n`);
        socket.write(`* FLAGS (\\Seen \\Deleted)\r\n`);
        socket.write(`* OK [PERMANENTFLAGS (\\Seen \\Deleted)] Flags\r\n`);
        socket.write(`* OK [UIDVALIDITY ${state.uidValidity}] UIDs valid\r\n`);
        socket.write(`* OK [UIDNEXT ${uidNext}] Predicted next UID\r\n`);
        socket.write(`${tag} OK [READ-WRITE] SELECT completed\r\n`);
      } else if (cmd === "UID" && /^FETCH/i.test(rest)) {
        const rangeMatch = rest.match(/FETCH\s+(\S+)/i);
        const range = rangeMatch ? rangeMatch[1] : "1:*";
        const [loRaw] = range.split(":");
        const lo = Number(loRaw) || 1;
        let seq = 0;
        for (const msg of state.messages) {
          seq += 1;
          if (msg.uid < lo) continue;
          const raw = Buffer.from(msg.raw, "utf8");
          socket.write(
            `* ${seq} FETCH (UID ${msg.uid} BODY[] {${raw.length}}\r\n`,
          );
          socket.write(raw);
          socket.write(`)\r\n`);
        }
        socket.write(`${tag} OK UID FETCH completed\r\n`);
      } else if (cmd === "LOGOUT") {
        socket.write("* BYE creezio-gate-imap\r\n");
        socket.write(`${tag} OK LOGOUT completed\r\n`);
        socket.end();
      } else if (cmd === "LSUB") {
        socket.write(`* LSUB () "/" "INBOX"\r\n`);
        socket.write(`${tag} OK LSUB completed\r\n`);
      } else if (cmd === "NOOP" || cmd === "CLOSE" || cmd === "UNSELECT") {
        socket.write(`${tag} OK ${cmd} completed\r\n`);
      } else {
        socket.write(`${tag} BAD commande non supportée par le mock: ${cmd}\r\n`);
      }
    }
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

/* ── 1. CRUD comptes ─────────────────────────────────────────────────────── */

test("imap.accounts — CRUD + secret jamais en clair", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-gate-imap-"));
  const store = mails.createSqliteMailsStore({
    coreDbPath: path.join(tmp, "core.db"),
  });
  try {
    // Parse : secretRef arbitraire refusé, integration:// accepté.
    assert.equal(
      mails.parseAccountCreateInput({
        label: "Pro",
        host: "imap.example.test",
        username: "user@example.test",
        secretRef: "mot-de-passe-en-clair",
      }).ok,
      false,
      "secretRef non-integration:// refusé",
    );
    // Secret en clair sans pont → refus explicite.
    mails.configureMailSecretBridge(null);
    const noBridge = mails.parseAccountCreateInput({
      label: "Pro",
      host: "imap.example.test",
      username: "user@example.test",
      secret: "p4ss",
    });
    assert.equal(noBridge.ok, false);
    assert.match(noBridge.error, /intégrations indisponible/);

    // Pont posé → secret stocké, référence renvoyée.
    const stored = [];
    mails.configureMailSecretBridge({
      resolve: (ref) =>
        stored.find((s) => s.ref === ref)?.secret ?? null,
      store: (input) => {
        const ref = `integration://imap-${stored.length + 1}`;
        stored.push({ ref, secret: input.secret });
        return ref;
      },
    });
    const parsed = mails.parseAccountCreateInput({
      label: "Pro",
      host: "imap.example.test",
      port: 1993,
      secure: false,
      username: "user@example.test",
      secret: "p4ss",
    });
    assert.equal(parsed.ok, true);
    assert.match(parsed.input.secretRef, /^integration:\/\//);
    assert.equal(stored[0].secret, "p4ss");

    const account = store.createAccount(parsed.input);
    assert.equal(account.label, "Pro");
    assert.equal(account.port, 1993);
    assert.equal(account.secure, false);
    assert.equal(account.syncState, "idle");

    // Shape publique : la valeur du secret n'apparaît nulle part.
    const pub = mails.toPublicAccount(account);
    assert.equal(JSON.stringify(pub).includes("p4ss"), false);
    assert.match(pub.secretRef, /^integration:\/\//);

    // Update + patch parse.
    const patch = mails.parseAccountPatchInput({ label: "Pro 2", enabled: false });
    assert.equal(patch.ok, true);
    const updated = store.updateAccount(account.id, patch.patch);
    assert.equal(updated.label, "Pro 2");
    assert.equal(updated.enabled, false);

    assert.equal(store.listAccounts().length, 1);
    assert.equal(store.deleteAccount(account.id), true);
    assert.equal(store.listAccounts().length, 0);
  } finally {
    mails.configureMailSecretBridge(null);
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/* ── 2. Sync contre serveur IMAP mock ───────────────────────────────────── */

test("imap.sync — incrémentale par UID + threads + reset UIDVALIDITY", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-gate-imap-"));
  const store = mails.createSqliteMailsStore({
    coreDbPath: path.join(tmp, "core.db"),
  });
  const state = {
    uidValidity: 42,
    expectedPass: "gate-pass",
    logins: [],
    messages: [
      {
        uid: 1,
        raw: rfc822({
          messageId: "<imap-1@ext.test>",
          from: "Fournisseur <fournisseur@ext.test>",
          to: "compte@brand.test",
          subject: "Devis IMAP",
          body: "Bonjour, devis en cours.",
        }),
      },
      {
        uid: 2,
        raw: rfc822({
          messageId: "<imap-2@ext.test>",
          from: "Fournisseur <fournisseur@ext.test>",
          to: "compte@brand.test",
          subject: "Re: Devis IMAP",
          inReplyTo: "<imap-1@ext.test>",
          body: "Relance devis.",
        }),
      },
    ],
  };
  const { server, port } = await startMockImapServer(state);

  mails.configureMailSecretBridge({
    resolve: (ref) => (ref === "integration://imap-gate" ? "gate-pass" : null),
  });

  try {
    const account = store.createAccount({
      label: "Gate",
      host: "127.0.0.1",
      port,
      secure: false,
      username: "compte@brand.test",
      secretRef: "integration://imap-gate",
    });

    // verify() OK.
    const verified = await mails.verifyImapAccount(account);
    assert.equal(verified.ok, true, `verify en échec: ${verified.error}`);

    // Sync 1 : 2 mails ingérés, thread lié par In-Reply-To.
    const s1 = await mails.syncImapAccount(store, account);
    assert.equal(s1.ok, true, `sync en échec: ${s1.error}`);
    assert.equal(s1.inserted, 2);
    assert.equal(s1.lastUid, 2);
    const inbox = store.listInbox({ folder: "inbox" });
    assert.equal(inbox.total, 2);
    const root = inbox.rows.find((r) => r.subject === "Devis IMAP");
    const reply = inbox.rows.find((r) => r.subject === "Re: Devis IMAP");
    assert.equal(reply.thread_id, root.id, "réponse liée au fil de la racine");
    const acc1 = store.getAccount(account.id);
    assert.equal(acc1.lastUid, 2);
    assert.equal(acc1.lastUidvalidity, "42");
    assert.equal(acc1.syncState, "idle");
    assert.ok(acc1.lastSyncAt);

    // Sync 2 (rien de neuf) : incrémentale, aucun doublon.
    const s2 = await mails.syncImapAccount(store, acc1);
    assert.equal(s2.ok, true);
    assert.equal(s2.inserted, 0);
    assert.equal(store.listInbox({ folder: "inbox" }).total, 2);

    // Nouveau message → seul l'UID 3 est ingéré.
    state.messages.push({
      uid: 3,
      raw: rfc822({
        messageId: "<imap-3@ext.test>",
        from: "Client <client@ext.test>",
        to: "compte@brand.test",
        subject: "Nouvelle demande",
        body: "Bonjour.",
      }),
    });
    const s3 = await mails.syncImapAccount(store, store.getAccount(account.id));
    assert.equal(s3.ok, true);
    assert.equal(s3.inserted, 1);
    assert.equal(s3.lastUid, 3);
    assert.equal(store.listInbox({ folder: "inbox" }).total, 3);

    // Reset UIDVALIDITY → resync complète, dédup message_id (0 doublon créé).
    state.uidValidity = 99;
    const s4 = await mails.syncImapAccount(store, store.getAccount(account.id));
    assert.equal(s4.ok, true);
    assert.equal(s4.uidValidityReset, true);
    assert.equal(s4.inserted, 0);
    assert.equal(s4.duplicates, 3);
    assert.equal(store.listInbox({ folder: "inbox" }).total, 3);
    assert.equal(store.getAccount(account.id).lastUidvalidity, "99");

    // Scheduler manuel : syncOnce ne plante pas et saute les comptes disabled.
    store.updateAccount(account.id, { enabled: false });
    const scheduler = mails.startImapSyncScheduler({ store, manual: true });
    await scheduler.syncOnce();
    scheduler.stop();
  } finally {
    mails.configureMailSecretBridge(null);
    server.close();
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/* ── 3. Erreurs propres ─────────────────────────────────────────────────── */

test("imap.erreurs — secret irrésoluble / connexion refusée", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-gate-imap-"));
  const store = mails.createSqliteMailsStore({
    coreDbPath: path.join(tmp, "core.db"),
  });
  try {
    mails.configureMailSecretBridge(null);
    const account = store.createAccount({
      label: "Cassé",
      host: "127.0.0.1",
      port: 1,
      secure: false,
      username: "x@y.test",
      secretRef: "integration://introuvable",
    });

    // Secret irrésoluble → erreur posée sur le compte, pas de crash.
    const s1 = await mails.syncImapAccount(store, account);
    assert.equal(s1.ok, false);
    assert.equal(s1.error, "imap_secret_unresolved");
    assert.equal(store.getAccount(account.id).syncState, "error");
    assert.equal(store.getAccount(account.id).lastError, "imap_secret_unresolved");

    // Secret résolu mais port fermé → erreur réseau propre.
    mails.configureMailSecretBridge({ resolve: () => "pass" });
    const s2 = await mails.syncImapAccount(store, store.getAccount(account.id));
    assert.equal(s2.ok, false);
    assert.ok(s2.error, "erreur réseau remontée");
    assert.equal(store.getAccount(account.id).syncState, "error");
  } finally {
    mails.configureMailSecretBridge(null);
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
