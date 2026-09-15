# packages/mails — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs mails` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `email-worker/`

| Fichier | Rôle |
|---|---|
| [`email-worker/bootstrap.mjs`](../email-worker/bootstrap.mjs) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`email-worker/worker.js`](../email-worker/worker.js) | Cloudflare Email Worker — inbound générique `@creezio/mails`. Catch-all Email Routing → POST vers l'instance client : https://{slug}.{MAIL_ROOT_DOMAIN}/api/v1/email/inbound Destinataires acceptés : *@ {slug}.mail.{MAIL_ROOT_DOMAIN} (recommandé — MX sans conflit CNAME tunnel) *@ {slug}.{MAIL_ROOT_DOMAIN} (si MX un jour compatible) Secrets / vars Worker : EMAIL_INBOUND_SECRET — Bearer partagé avec le CRM MAIL_ROOT_DOMAIN — ex. tempoflow.fr \| certivan.creez.io \| fidu.creez.io MAIL_SUBDOMAIN — défaut "mail" → {slug}.mail.{root} CRM_INBOUND_URL_TEMPLATE — optionn |

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/api-mount.ts`](../src/api-mount.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/config.ts`](../src/config.ts) | Configuration marque pour `@creezio/mails` (domaine public, UI, secrets inbound). Zéro domaine hardcodé dans le package — injecté via configureMails. |
| [`src/email-routes.ts`](../src/email-routes.ts) | Routes Hono boîte mail plateforme — équivalent fonctionnel `/api/v1/email` gold TF. Auth session reste côté marque (montage) ; inbound protégé par secret partagé. |
| [`src/env-bridge.ts`](../src/env-bridge.ts) | Bridge inbound → kit SoT (core.db). Préférer `createEmailInboxRoutes` / `insertInboundFull` ; conservé pour compat scripts / indexation légère sans PJ. |
| [`src/env-store.ts`](../src/env-store.ts) | Store mails SoT via env `CREEZIO_CORE_DB_PATH` / `DB_PATH` (process Next/CRM). |
| [`src/inbound-resend.ts`](../src/inbound-resend.ts) | Ingestion inbound Resend (Receiving API) — opt-in `MAIL_INBOUND_RESEND=1`. |
| [`src/inbox-queries.ts`](../src/inbox-queries.ts) | Requêtes boîte mail plateforme (SoT kit — core.db). Remplace les jumeaux marque `email-queries.ts`. |
| [`src/index.ts`](../src/index.ts) | @creezio/mails — mails plateforme (SoT inbox + providers + UI). Pas de templates TempoFlow/Fidu. |
| [`src/migrate-brand-emails.ts`](../src/migrate-brand-emails.ts) | Migration one-shot tables marque `emails` / `email_attachments` → kit SoT. Idempotent via message_id / brand_email_id. |
| [`src/outbox.ts`](../src/outbox.ts) | Worker outbox durable : drain, claim atomique, retries backoff, journal. |
| [`src/send-status.ts`](../src/send-status.ts) | Statut d'envoi réel (send) distinct des identifiants : token présent + 550 → config OK, send KO. |
| [`src/sqlite-driver.ts`](../src/sqlite-driver.ts) | Driver SQLite minimal — @creezio/mails (I3 + inbox). import { createRequire } from "node:module"; import path from "node:path"; export type SqliteStatement = { run(...params: unknown[]): { changes?: number; lastInsertRowid?: number \| bigint }; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; }; export type SqliteDatabase = { exec(sql: string): unknown; |
| [`src/sqlite-store.ts`](../src/sqlite-store.ts) | Store mails plateforme — sqlite **core** (I3 + inbox SoT complète). |
| [`src/transport-resolve.ts`](../src/transport-resolve.ts) | Résolution du transport actif (settings > env > inférence) + bridge secrets `integration://`. |
| [`src/transport.ts`](../src/transport.ts) | Contrat `MailTransport` / `OutgoingMail` / `MailSendResult` (multi-provider). |
| [`src/types.ts`](../src/types.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |

## `src/imap/`

| Fichier | Rôle |
|---|---|
| [`src/imap/accounts.ts`](../src/imap/accounts.ts) | Comptes IMAP : parsing entrées API (create/patch), vue publique sans secret. |
| [`src/imap/sync.ts`](../src/imap/sync.ts) | Sync IMAP incrémentale (imapflow/mailparser dynamiques) + scheduler + verify. |

## `src/providers/`

| Fichier | Rôle |
|---|---|
| [`src/providers/file-sink.ts`](../src/providers/file-sink.ts) | Transport file-sink : écrit chaque envoi en JSON sous `outDir` (dev/CI). |
| [`src/providers/resend.ts`](../src/providers/resend.ts) | Transport Resend — fetch natif, Idempotency-Key, erreurs 429/5xx réessayables. |
| [`src/providers/smtp.ts`](../src/providers/smtp.ts) | Transport SMTP (nodemailer dynamique) — URL ou champs, préréglage Cloudflare. |

## `src/webhooks/`

| Fichier | Rôle |
|---|---|
| [`src/webhooks/resend.ts`](../src/webhooks/resend.ts) | Webhooks Resend : vérification Svix (timing-safe) + application des statuts delivered/bounced. |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/index.ts`](../ui/index.ts) | @creezio/mails/ui — webmail natif v2 (MailWorkspace, MailSettings, composer…). |
| [`ui/mail-composer.tsx`](../ui/mail-composer.tsx) | Composer modal : Tiptap dynamique (fallback textarea), brouillons auto, PJ. |
| [`ui/mail-display.tsx`](../ui/mail-display.tsx) | Détail mail : iframe sandboxée (HTML entrant), fil, PJ, actions, journal d'envoi. |
| [`ui/mail-folders.tsx`](../ui/mail-folders.tsx) | Navigation dossiers (inbox/sent/drafts/outbox/archive/trash) + bouton composer. |
| [`ui/mail-list.tsx`](../ui/mail-list.tsx) | Liste des mails : recherche, filtre non lus, badges statut sortant. |
| [`ui/mail-settings.tsx`](../ui/mail-settings.tsx) | Page paramètres (owner) : transport, test d'envoi, comptes IMAP. |
| [`ui/mail-types.ts`](../ui/mail-types.ts) | Types partagés UI (rows/detail/meta, dossiers, labels statuts) + helpers format. |
| [`ui/mail-workspace.tsx`](../ui/mail-workspace.tsx) | Webmail 3 panneaux resizable — orchestration dossiers/liste/détail/composer. |
| [`ui/recipients-input.tsx`](../ui/recipients-input.tsx) | Saisie destinataires en chips (validation email, Enter/virgule/collage). |
