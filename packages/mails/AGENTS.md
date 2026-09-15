# AGENTS — @creezio/mails

## Mission

Maintenir la capacité mails générique v2 : store SQLite (outbox durable,
threads, comptes IMAP, réglages), transports multi-providers
(smtp/resend/file-sink), worker outbox, webhooks Resend, sync IMAP, routes
Hono, webmail UI et worker Cloudflare. Le package doit rester sans domaine,
template ou transport marque hardcodé.

## Ne pas faire

- Ne pas hardcoder de domaine marque ou de suffixe mail.
- Ne pas stocker/logguer les secrets (inbound, SMTP, API, IMAP) en clair —
  préférer les références `integration://<slug>` résolues via le bridge.
- Ne pas ajouter de template email métier dans le kit.
- Ne pas réintroduire l'ancien `MailProvider`/`registerProvider` — le seul
  contrat d'envoi est `MailTransport` + outbox `enqueue()`.
- Ne pas rendre `/inbound` ni `/webhooks/resend` dépendants d'une session
  UI : secret partagé / signature Svix.
- Ne pas importer `nodemailer`/`imapflow`/`mailparser` statiquement — imports
  dynamiques avec refus propre si absents (peers optionnels).
- Ne pas ajouter `zod` aux dependencies (piège v3/v4 du kit).
- Ne pas rendre du HTML entrant hors iframe sandboxée dans l'UI.
- Ne pas démarrer le worker outbox hors kernel (double envoi multi-process).
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs mails` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Points d'entrée

- `src/index.ts` : surface publique.
- `src/config.ts` : `configureMails`, domaine, secret, textes UI.
- `src/types.ts` : schéma SQL v2 + contrats (`PlatformMail`, `MailEvent`,
  `MailAccount`, statuts, dossiers).
- `src/transport.ts` : contrat `MailTransport` / `OutgoingMail`.
- `src/transport-resolve.ts` : résolution settings > env > inférence +
  `configureMailSecretBridge` (references `integration://`).
- `src/providers/smtp.ts` (préréglage cloudflare), `providers/resend.ts`
  (fetch natif), `providers/file-sink.ts`.
- `src/sqlite-store.ts` : store v2 — enqueue, drafts, PJ, claim outbox,
  events, settings, comptes IMAP.
- `src/outbox.ts` : `startMailOutboxWorker`, backoff.
- `src/webhooks/resend.ts` : Svix + application des statuts.
- `src/inbound-resend.ts` : ingestion Receiving API (opt-in).
- `src/imap/sync.ts` / `src/imap/accounts.ts` : sync incrémentale + CRUD.
- `src/inbox-queries.ts` : inbox, threads, PJ, insertion inbound, migration v1→v2.
- `src/send-status.ts` : classify/persist send (token OK vs send 550).
- `src/email-routes.ts` : routes Hono `/email` (public/session/owner).
- `src/api-mount.ts` : surface platform-core drafts/send.
- `src/migrate-brand-emails.ts` : migration vers le kit.
- `ui/mail-workspace.tsx` : webmail 3 panneaux (+ `mail-list`, `mail-display`,
  `mail-folders`, `mail-composer`, `recipients-input`).
- `ui/mail-settings.tsx` : page paramètres transport + comptes IMAP (owner).
- `email-worker/worker.js` : worker Cloudflare.
- `email-worker/bootstrap.mjs` : déploiement worker.

## Modifier sans casser

- Préserver les tables `creezio_platform_mail*` ; toute colonne ajoutée doit
  être migrable via `ensureMailsInboundColumnsSql` (ALTER idempotents,
  double passe index dans `ensureMailsInboxSchema`).
- Garder la déduplication par `message_id` et le calcul de thread
  (`computeThreadId` — In-Reply-To/References).
- Garder `Authorization: Bearer` et `x-email-inbound-secret` compatibles pour `/inbound`.
- Le claim outbox doit rester atomique (`UPDATE … WHERE status='queued'`).
- Ne pas dépasser les attentes UI snake_case (`from_addr`, `read_at`, `attachments`, etc.).
- Les pièces jointes doivent rester servies avec un `Content-Disposition` sûr.

## Config brand

```ts
configureMails({
  rootDomain: "example.com",
  inboundSecretEnvKeys: ["EMAIL_INBOUND_SECRET", "BRAND_EMAIL_INBOUND_SECRET"],
  mailSubdomain: "mail",
  uiEnabled: true,
});
```

Env côté app : `EMAIL_DOMAIN`, `APP_PUBLIC_URL`, `MCP_PUBLIC_URL`,
`EMAIL_INBOUND_SECRET`, `MAIL_TRANSPORT`, `MAIL_FROM`, `SMTP_*`,
`CLOUDFLARE_EMAIL_API_TOKEN` (alias `CLOUDFLARE_EMAIL_TOKEN`),
`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`,
`MAIL_INBOUND_RESEND`, `MAIL_FILE_SINK_DIR`, `CREEZIO_MAIL_OUTBOX`,
`CREEZIO_MAIL_IMAP`.

Env côté worker : voir `email-worker/README.md`.

## Tests/gates

```bash
npm run typecheck -w @creezio/mails
npm run build -w @creezio/mails
node --test scripts/test-mails-inbox.mjs
node --test scripts/test-phase-mails-transports.mjs
node --test scripts/test-phase-mails-outbox.mjs
node --test scripts/test-phase-mails-webhooks.mjs
node --test scripts/test-phase-mails-imap.mjs
node --test scripts/test-phase-mails-ui.mjs
```

Vérifications hôte utiles :

- `GET /api/v1/email/meta` retourne `ready` et `domain`.
- `POST /api/v1/email/inbound` refuse un secret invalide.
- `POST /api/v1/email/send` répond `202 queued` si un transport est configuré ;
  refuse `503` avec message FR si `transport_unconfigured` (évite un faux
  « envoyé » alors que « Envoyés » reste vide).
- un inbound avec PJ est listé et la PJ est téléchargeable.
- `PATCH /:id` bascule lu/non lu et déplace de dossier.
- `MailWorkspace` reste utilisable si aucun domaine mail n'est configuré.

## Fichiers sensibles

- `src/email-routes.ts` : auth secret inbound + signature Svix + owner gates.
- `src/transport-resolve.ts` : résolution secrets (`integration://`).
- `src/sqlite-store.ts` : claim atomique outbox, BLOB pièces jointes.
- `src/webhooks/resend.ts` : vérification signature (timing-safe, tolérance).
- `src/imap/sync.ts` : credentials IMAP, bornage batch.
- `src/types.ts` : schéma SQL.
- `src/config.ts` : résolution domaines/env.
- `email-worker/worker.js` : parsing MIME et routage slug.
- `email-worker/bootstrap.mjs` : déploiement Cloudflare.

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
- [email-worker/README.md](./email-worker/README.md)
- [../../docs/plans/PLAN-MAILS-NATIF.md](../../docs/plans/PLAN-MAILS-NATIF.md)
