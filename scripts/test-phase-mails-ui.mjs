#!/usr/bin/env node
/**
 * MD2/MD3/MD4 — webmail natif @creezio/mails/ui.
 * Gate statique : composants présents, exports barrel, iframe sandboxée
 * (jamais de dangerouslySetInnerHTML sur du HTML entrant), 3 panneaux
 * resizable, composer Tiptap dynamique + fallback, wrappers os-ui/factory.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiDir = path.join(root, "packages/mails/ui");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("mails-ui.1 composants MD présents + barrel", () => {
  for (const rel of [
    "packages/mails/ui/mail-types.ts",
    "packages/mails/ui/mail-workspace.tsx",
    "packages/mails/ui/mail-folders.tsx",
    "packages/mails/ui/mail-list.tsx",
    "packages/mails/ui/mail-display.tsx",
    "packages/mails/ui/mail-composer.tsx",
    "packages/mails/ui/recipients-input.tsx",
    "packages/mails/ui/mail-settings.tsx",
    "packages/mails/ui/index.ts",
  ]) {
    assert.ok(fs.existsSync(path.join(root, rel)), rel);
  }
  const index = read("packages/mails/ui/index.ts");
  assert.match(index, /export \{ MailWorkspace \}/);
  assert.match(index, /export \{ MailSettings \}/);
  assert.match(index, /export \{ MailComposer \}/);
  // L'ancienne inbox v1 est remplacée — pas de chemin legacy à côté.
  assert.ok(
    !fs.existsSync(path.join(uiDir, "mail-inbox.tsx")),
    "mail-inbox.tsx v1 doit être supprimée",
  );
  assert.doesNotMatch(index, /MailInbox/);
});

test("mails-ui.2 rendu HTML entrant = iframe sandboxée (fix XSS)", () => {
  const display = read("packages/mails/ui/mail-display.tsx");
  assert.match(display, /<iframe/);
  assert.match(display, /sandbox=""/);
  assert.match(display, /srcDoc|srcdoc/);
  // Aucun composant webmail ne doit injecter le HTML entrant directement.
  for (const ent of fs.readdirSync(uiDir)) {
    if (!/\.(ts|tsx)$/.test(ent)) continue;
    const body = fs.readFileSync(path.join(uiDir, ent), "utf8");
    assert.doesNotMatch(
      body,
      /dangerouslySetInnerHTML/,
      `dangerouslySetInnerHTML interdit dans ui/${ent}`,
    );
  }
});

test("mails-ui.3 workspace 3 panneaux resizable + dossiers + threads", () => {
  const ws = read("packages/mails/ui/mail-workspace.tsx");
  assert.match(ws, /ResizablePanelGroup/);
  assert.match(ws, /ResizableHandle/);
  assert.match(ws, /MailFolders/);
  assert.match(ws, /MailList/);
  assert.match(ws, /MailDisplay/);
  assert.match(ws, /MailComposer/);
  assert.match(ws, /parametres\/email/, "bandeau → réglages transport");
  assert.match(ws, /setFolder\("outbox"\)/, "après envoi → file d'attente");
  assert.match(ws, /sendBroken|envoi réel indisponible/, "bandeau send KO");

  const types = read("packages/mails/ui/mail-types.ts");
  for (const folder of ["inbox", "sent", "drafts", "outbox", "archive", "trash"]) {
    assert.match(types, new RegExp(`"${folder}"`), `dossier ${folder}`);
  }

  assert.match(ws, /threads\//, "fetch du thread via /threads/:id");
});

test("mails-ui.4 composer : Tiptap dynamique + fallback textarea + PJ", () => {
  const composer = read("packages/mails/ui/mail-composer.tsx");
  assert.match(composer, /import\("@tiptap\/react"\)/);
  assert.match(composer, /import\("@tiptap\/starter-kit"\)/);
  assert.match(composer, /Textarea/, "fallback textarea si Tiptap absent");
  assert.match(composer, /RecipientsInput/);
  assert.match(composer, /attachments/i);
  assert.match(composer, /drafts/, "brouillons via API /drafts");
  // Peers UI optionnels — pas de dépendance dure du package.
  const pkg = JSON.parse(read("packages/mails/package.json"));
  for (const dep of ["@tiptap/react", "@tiptap/starter-kit"]) {
    assert.ok(pkg.peerDependencies?.[dep], `peer ${dep}`);
    assert.equal(
      pkg.peerDependenciesMeta?.[dep]?.optional,
      true,
      `peer ${dep} optional`,
    );
    assert.ok(!pkg.dependencies?.[dep], `${dep} ne doit pas être une dep dure`);
  }
});

test("mails-ui.5 page paramètres : transport + test d'envoi + comptes IMAP", () => {
  const settings = read("packages/mails/ui/mail-settings.tsx");
  assert.match(settings, /settings\/verify/);
  assert.match(settings, /Tester l'envoi/);
  assert.match(settings, /cloudflare/i);
  assert.match(settings, /resend/i);
  assert.match(settings, /file-sink/);
  assert.match(settings, /accounts/, "gestion comptes IMAP");
  assert.match(settings, /integration:\/\//, "secret par référence");
  assert.match(settings, /Email Sending non configuré/);
  assert.match(settings, /envoi réel indisponible/);
});

test("mails-ui.6 wrappers os-ui + factory alignés MailWorkspace/MailSettings", () => {
  const mailsPage = read("packages/os-ui/routes/mails/page.tsx");
  assert.match(mailsPage, /MailWorkspace/);
  assert.doesNotMatch(mailsPage, /MailInbox/);

  const settingsPage = read("packages/os-ui/routes/parametres/email/page.tsx");
  assert.match(settingsPage, /MailSettings/);

  const factory = read("packages/factory/src/generators/os-ui.ts");
  assert.match(factory, /MailWorkspace/);
  assert.match(factory, /parametres\/email\/page\.tsx/);
  assert.doesNotMatch(factory, /MailInbox/);
  for (const dep of [
    "react-resizable-panels",
    "@radix-ui/react-tooltip",
    "@tiptap/react",
    "@tiptap/starter-kit",
    "@tiptap/extension-link",
  ]) {
    assert.match(factory, new RegExp(dep.replace(/[/@]/g, "\\$&")), `dep scaffold ${dep}`);
  }
});
