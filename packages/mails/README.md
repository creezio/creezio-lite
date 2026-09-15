# @creezio/mails

## Rôle

`@creezio/mails` fournit la capacité mails native Creezio (v2 — multi-transport) :

- **outbox durable** : tout envoi passe par `enqueue()` (jamais bloquant),
  worker de drain avec retries backoff, journal `mail_events`, statuts
  `queued → sending → sent → delivered/bounced` ;
- **transports** : SMTP direct (préréglage Cloudflare Email Service),
  Resend (fetch natif), file-sink (dev/CI) — résolus par configuration
  (réglages instance > env `MAIL_TRANSPORT` > rétro-inférence `SMTP_*`) ;
- **réception** : chaîne Cloudflare Email Routing (`POST /inbound`),
  webhooks Resend signés Svix (statuts + inbound opt-in), comptes IMAP
  (`imapflow` + `mailparser`, chargés dynamiquement) ;
- **webmail** : `MailWorkspace` (3 panneaux resizable, dossiers, threads,
  composer Tiptap, brouillons, PJ, HTML entrant en iframe sandboxée) +
  `MailSettings` (transport, test d'envoi, comptes IMAP) ;
- routes Hono `/email` complètes + `ApiMount` mince pour les modules métier ;
- worker Cloudflare Email Routing dans `email-worker/`.

Le package ne contient aucun template métier ni domaine marque hardcodé.

## Périmètre kit vs marque

**Kit**

- Schéma SQLite v2 : `creezio_platform_mails` (dossiers, threads, statuts,
  retries), `creezio_platform_mail_attachments`, `creezio_platform_mail_events`,
  `creezio_platform_mail_accounts` (IMAP), `creezio_platform_mail_settings`.
- `resolveMailTransport()` + transports `smtp` / `resend` / `file-sink`.
- `startMailOutboxWorker()` (drain + backoff) et
  `startImapSyncScheduler()` — démarrés par `@creezio/app-runtime` côté kernel.
- `createEmailInboxRoutes()` (API complète) et `createMailsApiMount()`.
- Vérification Svix des webhooks Resend (`verifySvixSignature`).
- UI `MailWorkspace` / `MailSettings` et worker Cloudflare générique.

**Marque**

- Appelle `configureMails` avec `rootDomain`, secrets et préférences UI.
- Monte `/api/v1/email` (fait par `mountBrandEmailSurface` d'app-runtime).
- Envoie via `getKitMailsStore().enqueue({...})` depuis ses modules métier.
- Déploie/configure le worker Cloudflare et les MX, ou route les webhooks
  Resend vers `/api/v1/email/webhooks/resend`.
- Pose `nodemailer` (SMTP) et `imapflow`/`mailparser` (IMAP) dans les deps
  server — peers optionnels du kit, la factory les scaffolde par défaut.

## Installation/build

```bash
npm run build -w @creezio/mails
npm run typecheck -w @creezio/mails
npm run test:inbox -w @creezio/mails
```

Exports :

- `@creezio/mails` : config, store SQLite v2, transports, résolution
  transport, outbox worker, webhooks Resend, comptes/sync IMAP, routes,
  queries inbox, migration.
- `@creezio/mails/ui` : `MailWorkspace`, `MailSettings`, `MailComposer`…
- `email-worker/` : worker Cloudflare et bootstrap de déploiement.

## Configuration du transport

Priorité de résolution (`resolveMailTransport`) :

1. **Réglages instance** (`creezio_platform_mail_settings`, édités par la
   page `/parametres/email` — owner only) ;
2. **Env** : `MAIL_TRANSPORT=cloudflare|smtp|resend|file-sink` ;
3. **Rétro-inférence** : `CLOUDFLARE_EMAIL_API_TOKEN` → cloudflare ;
   `SMTP_URL`/`SMTP_HOST` → smtp ; `RESEND_API_KEY`
   → resend ;
4. sinon : non configuré — les mails restent `queued` puis passent
   `failed_permanent` avec erreur explicite.

Variables par transport :

| Transport | Variables |
|---|---|
| `cloudflare` | `CLOUDFLARE_EMAIL_API_TOKEN` / `CLOUDFLARE_EMAIL_TOKEN` (ou `SMTP_PASS`) — token API avec la permission **Email Sending: Edit**, domaine onboardé sous Email Service ; host/port/user imposés (`smtp.mx.cloudflare.net:465`, TLS implicite, user `api_token`) |
| `smtp` | `SMTP_URL` **ou** `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`/`SMTP_USER`/`SMTP_PASS` |
| `resend` | `RESEND_API_KEY`, opt. `RESEND_WEBHOOK_SECRET` (Svix), `MAIL_INBOUND_RESEND=1` (inbound opt-in) |
| `file-sink` | `MAIL_FILE_SINK_DIR` (défaut `{data}/mails-out`) |

Commun : `MAIL_FROM` (expéditeur par défaut). Les secrets peuvent être des
références `integration://<slug>` résolues via le store `@creezio/integrations`
(bridge injecté par app-runtime — `configureMailSecretBridge`).

## Envoi (outbox durable)

```ts
import { getKitMailsStore } from "@creezio/mails";

const store = getKitMailsStore();
const { id } = store.enqueue({
  to: ["client@example.com"],
  subject: "Votre commande",
  text: "Merci !",
  html: "<p>Merci !</p>",
  attachments: [{ filename: "facture.pdf", contentType: "application/pdf", content: buf }],
});
// Non bloquant : le worker outbox draine, retries backoff, journal mail_events.
```

Cycle de vie : `queued` → `sending` → `sent` → (`delivered` | `bounced`
via webhook Resend). Échec réessayable → backoff exponentiel
(1 min → 5 min → 15 min → 1 h → 6 h, max 8 tentatives) ; échec permanent →
`failed_permanent` + événement.

Worker : `startMailOutboxWorker({ store, resolve })` — démarré par
app-runtime **côté kernel uniquement** (`CREEZIO_MAIL_OUTBOX=0` pour couper).

## Réception

- **Cloudflare Email Routing** (inchangé) : worker → `POST /inbound` avec
  secret partagé (`EMAIL_INBOUND_SECRET`).
- **Webhooks Resend** : `POST /webhooks/resend` signé Svix
  (`RESEND_WEBHOOK_SECRET`) — statuts delivered/bounced/complained +
  `email.received` (inbound opt-in `MAIL_INBOUND_RESEND=1`).
- **IMAP** : comptes CRUD via `/accounts` (owner), sync incrémentale par UID
  (`startImapSyncScheduler`, `CREEZIO_MAIL_IMAP=0` pour couper). Secrets
  stockés en clair jamais — référence `integration://` ou champ chiffré store.

## API `/email` (montée sous `/api/v1/email`)

- Public (secret/signature) : `POST /inbound`, `POST /webhooks/resend`.
- Session : `GET /meta`, `GET /` (dossiers `inbox|sent|drafts|outbox|archive|trash`),
  `GET /:id`, `GET /:id/attachments/:attId`, `GET /:id/events`,
  `GET /threads/:threadId`, `PATCH /:id` (lu / dossier), `DELETE /:id`,
  `POST /send`, `POST /drafts`, `PUT /drafts/:id`, `POST /drafts/:id/send`,
  `POST /attachments`.
- Owner : `GET|PUT /settings`, `POST /settings/verify`
  (`ok: true` si identifiants présents même si le send est KO — voir `send.state`).
  `GET|POST /accounts`, `PATCH|DELETE /accounts/:id`,
  `POST /accounts/:id/verify`, `POST /accounts/:id/sync`.

## UI

```tsx
import { MailWorkspace, MailSettings } from "@creezio/mails/ui";

// /mails
<MailWorkspace />
// /parametres/email (owner)
<MailSettings />
```

Sécurité rendu : le HTML entrant est rendu dans une **iframe sandboxée**
(`sandbox=""`, sans `allow-scripts` ni `allow-same-origin`) — jamais
d'injection directe dans le DOM de l'app.

Peers UI optionnels : `@tiptap/react`, `@tiptap/starter-kit`,
`@tiptap/extension-link` (fallback textarea si absents),
`react-resizable-panels` + `@radix-ui/react-tooltip` via `@creezio/shell-ui`.

## Dépendances

- Runtime : `@creezio/api-kernel`, `@creezio/auth`, `@creezio/platform-core`,
  `@creezio/shell-ui`, `hono`.
- Peers optionnels (chargés dynamiquement) : `nodemailer` (smtp),
  `imapflow` + `mailparser` (IMAP), Tiptap (UI). Resend = fetch natif,
  zéro dépendance.
- Worker : Cloudflare Workers / Email Routing, `wrangler` côté déploiement.

## Gates

```bash
node --test scripts/test-mails-inbox.mjs           # schéma v2 + threads + migration v1
node --test scripts/test-phase-mails-transports.mjs # résolution + SMTP local + mock Resend
node --test scripts/test-phase-mails-outbox.mjs     # enqueue/retries/PJ/brouillons
node --test scripts/test-phase-mails-webhooks.mjs   # Svix + statuts + inbound opt-in
node --test scripts/test-phase-mails-imap.mjs       # comptes + sync mock IMAP
node --test scripts/test-phase-mails-ui.mjs         # webmail + iframe sandbox + wrappers
```

## Voir aussi

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md)
- [email-worker/README.md](./email-worker/README.md)
- [docs/plans/PLAN-MAILS-NATIF.md](../../docs/plans/PLAN-MAILS-NATIF.md)
