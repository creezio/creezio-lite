# PLAN — Mails natifs Creezio : multi-transport + webmail (`@creezio/mails` v2)

> Statut : **plan validé, à exécuter** — rédigé le 2026-08-08.
> Périmètre : kit `creezio` (SoT) + vague de migration marque WinHub.
> Principe directeur : **une seule architecture cible**. Le design
> `MailTransport` multi-provider **remplace** l'existant (`MailProvider` v1 /
> `smtp-env`) — pas de chemin legacy maintenu en parallèle. Les breaking
> changes d'API interne kit sont autorisés : la vague de migration marque
> (vague W) les absorbe dans la même fenêtre.
>
> **Note 2026-08-10** : la distribution du kit est passée aux packages npm
> versionnés ([../NPM-DISTRIBUTION.md](../NPM-DISTRIBUTION.md)) — les
> mentions « resync vendor » / `SYNC.json` ci-dessous sont historiques ;
> lire « merge `main` kit → publication npm → `npm update "@creezio/*"`
> côté marque ».

---

## 1. Contexte et objectif

Toutes les apps Creezio (marques générées par la factory) doivent disposer
d'une capacité email **native, identique et configurable** :

1. **Envoi** : choix du transport par configuration — Cloudflare Email
   Service (SMTP `smtp.mx.cloudflare.net:465`), SMTP direct (n'importe quel
   serveur), ou provider API externe (**Resend** en premier).
2. **Réception** : chaîne Cloudflare Email Routing existante conservée
   (worker → `/inbound`), + **IMAP direct** (boîte existante d'un client),
   + optionnellement inbound Resend (webhook `email.received`).
3. **Webmail** dans l'UI des apps : boîte de réception (existe), mais aussi
   **composer/envoyer** (éditeur riche, destinataires multiples, pièces
   jointes, brouillons, fils de discussion), avec fiabilité d'envoi
   (file durable, retries, statuts delivered/bounced via webhooks).

## 2. État des lieux

### 2.1 Kit — `packages/mails` (aujourd'hui)

| Zone | Existant | Verdict v2 |
|---|---|---|
| Contrat provider | `MailProvider { id; send(mail) }` — pas de cc/bcc/PJ/replyTo, résultat `{ok,error}` sans notion de retryable ni providerMessageId | **Remplacé** par `MailTransport` (cf. §4.1) |
| Providers | `smtp-env` (nodemailer en peer optionnel, env `SMTP_*`), `file-sink` (JSON local, tests/CI), `platform-stub` | `smtp-env` **absorbé** comme cas « SMTP direct » du transport unique ; `file-sink` conservé ; stub supprimé |
| Store | `createSqliteMailsStore` sur core.db — tables `creezio_platform_mails` + `creezio_platform_mail_attachments` (PJ en BLOB), dédup `message_id`, `queueSend` = 1 tentative synchrone sans retry ni journal | Schéma **étendu** (threads, cc/bcc, statuts détaillés) ; `queueSend` remplacé par l'**outbox durable** |
| API | Routes Hono `/api/v1/email/*` (inbound secret partagé, meta, liste, détail, PJ, read/delete) + `ApiMount` `platform-mails` (drafts/list/send minimal) | Conservées + **étendues** (send, drafts riches, reply, threads, comptes IMAP, webhooks) |
| Réception | Worker Cloudflare Email Routing (`email-worker/`) : catch-all → parse MIME → `POST /inbound` avec secret | **Conservée telle quelle** (aucun changement de contrat `/inbound`) |
| UI | `MailInbox` (`ui/mail-inbox.tsx`) : liste + lecture + PJ + lu/non-lu + suppression. Pas de compose, pas de dossiers, pas de threads. HTML inbound rendu par `dangerouslySetInnerHTML` (risque XSS) | **Remplacée** par `MailWorkspace` (bloc shadcn Mail adapté) ; rendu HTML durci (iframe sandbox) |
| Config | `configureMails` (rootDomain, secret inbound, textes) + env `EMAIL_DOMAIN`/`SMTP_*` | Conservée + **résolution transport** (env + store integrations + réglage admin) |
| Montage | `create-brand-kernel.ts` (app-runtime) : store + file-sink par défaut + `ApiMount` ; `mount-brand-email-surface.ts` : auth session sur l'inbox, `/inbound` par secret | Conservé, enrichi (boot worker outbox + sync IMAP) |
| Wrappers | `os-ui/routes/mails/page.tsx` (→ `MailInbox`), matérialisé par la factory dans chaque marque ; nav `/mails` factory | Wrapper régénéré (→ `MailWorkspace`) |
| Gates | `test-mails-inbox.mjs` (package), `test-os-mails-config.mjs`, `test-os-email-surface.mjs`, `test-phase-harness-parity.mjs` (inbound), `test-phase-i8.mjs` (mounts) | Mises à jour + nouvelles gates (cf. §6) |

### 2.2 Marque de référence — WinHub (aujourd'hui)

- **5 modules émetteurs** (`server/src/electron/modules/`) : `orders`,
  `payments`, `logistics`, `organizations`, `needs` — chacun instancie
  **directement** `createSmtpEnvMailProvider()` (ou `createFileSinkMailProvider`
  si `WINHUB_MAIL_SINK_DIR` posé) et appelle `provider.send()` en
  fire-and-forget best-effort (échec = warning + audit `email_echec`, jamais
  bloquant). **Aucune persistance** de l'envoi : pas de trace en base, pas de
  retry, pas de statut delivered/bounced.
- Câblage provisoire assumé : `nodemailer` en dep `server/package.json`,
  gate `test-mail-smtp-env.mjs`, doc `docs/EMAILS-PRODUCTION.md`
  (SMTP Cloudflare/SES/Postmark par env `SMTP_*`). **À remplacer** par la
  nouvelle architecture dans la vague W.
- Wrapper `/mails` = wrapper factory standard (`MailInbox`).

### 2.3 Ce qui manque (synthèse)

- Transport par configuration (aujourd'hui : le code de chaque module choisit).
- Envoi fiable : file durable, retries, journal, statuts post-remise.
- Provider API (Resend) et préréglage Cloudflare Email Service.
- Réception IMAP (boîte existante d'un client).
- UI compose/reply/threads/brouillons/PJ + page d'admin de la config email.

## 3. Recherche (état 2026) et recommandations

### 3.1 Resend (recommandé comme premier provider API)

- **Envoi** : `POST https://api.resend.com/emails` — `from`, `to` (≤50),
  `subject`, `html`/`text`, `cc`, `bcc`, `reply_to`, `headers`,
  `attachments`, `scheduled_at`, header `Idempotency-Key` (24 h, ≤256 car.).
  SDK node officiel `resend`, mais l'API est du JSON simple → **implémentation
  par `fetch` natif, zéro dépendance** (cohérent avec la politique deps du kit).
- **Domaines** : vérification SPF/DKIM/DMARC via dashboard/API (`/domains`).
- **Webhooks** : `email.sent|delivered|bounced|complained|opened|clicked` +
  `email.received` — signature **Svix** (`svix-id`/`svix-timestamp`/
  `svix-signature`, HMAC-SHA256 base64 → vérifiable sans dépendance).
- **Réception** : inbound parsing natif ; le webhook `email.received` ne porte
  que les métadonnées → le corps et les PJ se récupèrent par
  `GET /emails/receiving/{email_id}` et `/attachments` (`download_url` valable 1 h).
- **Prix** : Free 3 000 mails/mois (100/j, 1 domaine) ; Pro 20 $/mois
  (50 000) ; Scale dès 90 $/mois. SMTP relay inclus à tous les tiers.

### 3.2 Cloudflare Email Service

- **Email Sending** : bêta publique depuis avril 2026 (REST + binding Workers) ;
  **SMTP authentifié** en bêta depuis juin 2026 : `smtp.mx.cloudflare.net:465`,
  TLS implicite uniquement (pas de 587/STARTTLS), user littéral `api_token`,
  password = API token Cloudflare avec permission *Email Sending: Edit*.
  DKIM/ARC automatiques, domaine à onboarder dans le dashboard. Plan Workers
  Paid requis.
- Conséquence design : Cloudflare Email Service **n'est pas un transport
  distinct** — c'est un **préréglage du transport SMTP** (host/port/user
  imposés). Statut bêta = risque suivi (cf. §8).
- **Email Routing** (réception) : GA, inchangé — notre worker actuel reste la
  chaîne nominale.

### 3.3 IMAP node

- **`imapflow`** (Postal Systems, auteurs de nodemailer) : la référence 2026 —
  ~1,37 M dl/semaine, release active (v1.6.x, 2026-08), API promises,
  IDLE automatique (fallback NOOP), CONDSTORE/QRESYNC pour la resync rapide,
  types TS inclus. **Retenu**, en peer optionnel chargé dynamiquement
  (même pattern que nodemailer aujourd'hui).
- Parsing MIME : **`mailparser`** (même éditeur, déjà éprouvé avec imapflow).

### 3.4 UI webmail — blocs shadcn/ui et éditeur

- **Bloc « Mail » officiel shadcn/ui** : oui, il existe —
  `apps/www/app/(app)/examples/mail` du repo `shadcn-ui/ui`
  (démo <https://v3.shadcn.com/examples/mail>). Structure : `Mail` (layout
  3 panneaux `ResizablePanelGroup` persisté en cookies) + `Nav` (dossiers) +
  `MailList` + `MailDisplay` + `AccountSwitcher`, avec Tabs Tous/Non-lus et
  recherche. **Retenu comme base** : c'est un *example* (pas un composant
  installable) → on l'adapte dans `@creezio/mails/ui` avec les primitives
  `@creezio/shell-ui/ui/kit` et la charte Creezio (l'état Jotai de l'exemple
  est remplacé par du state React local, comme le reste du kit).
- Primitives manquantes dans `shell-ui/ui/kit` à ajouter : **resizable**
  (`react-resizable-panels`), **tooltip**, **textarea** (Tabs, ScrollArea,
  Dialog, Sheet, DropdownMenu, Command, Avatar, Badge, Separator existent déjà).
- **Éditeur riche du composer : Tiptap** (headless, ProseMirror, MIT) —
  consensus 2026 pour un composer email React ; toolbars construites avec les
  primitives shadcn du kit. Extensions minimales : StarterKit + Link +
  Placeholder (pas de collaboration, pas de Tiptap Cloud). Alternatives
  écartées : Plate (React/Slate, très bien pour du Notion-like mais plus
  lourd à câbler pour un simple composer), Novel (UI markdown imposée,
  sur-spécifié pour un mail), Lexical (bas niveau, plus de glue).
- Rendu HTML inbound : **iframe sandboxée** (`srcdoc` + `sandbox=""`,
  `referrerpolicy="no-referrer"`) — standard des webmails, zéro dépendance,
  remplace le `dangerouslySetInnerHTML` actuel (durcissement XSS).

## 4. Architecture cible

### 4.1 Contrat unique `MailTransport` (remplace `MailProvider` v1)

```ts
// packages/mails/src/transport.ts (nouveau)
export type MailAddress = string; // "Nom <a@b.c>" accepté

export type OutgoingMail = {
  id: string;                    // uuid kit = Idempotency-Key Resend
  from?: MailAddress;            // défaut : identité résolue par la config
  to: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  replyTo?: MailAddress;
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  inReplyTo?: string;            // Message-ID cité (threads)
  references?: string[];
  attachments?: Array<{
    filename: string;
    contentType: string;
    content: Buffer;             // servi depuis creezio_platform_mail_attachments
  }>;
};

export type MailSendResult =
  | { ok: true; providerMessageId?: string }
  | { ok: false; error: string; retryable: boolean };

export type MailTransport = {
  id: "smtp" | "resend" | "file-sink";
  capabilities: {
    attachments: boolean;
    idempotency: boolean;        // resend : oui
    statusWebhooks: boolean;     // resend : oui (delivered/bounced)
  };
  send(mail: OutgoingMail): Promise<MailSendResult>;
  /** Test de connexion pour l'UI admin (SMTP verify / Resend GET domains). */
  verify?(): Promise<{ ok: boolean; error?: string }>;
};
```

Transports fournis par le kit :

| id | Implémentation | Config |
|---|---|---|
| `smtp` | nodemailer (peer optionnel, import dynamique — inchangé). Gagne cc/bcc/replyTo/headers/attachments. **Absorbe `smtp-env`** : `SMTP_URL` ou `SMTP_HOST/PORT/USER/PASS/SECURE/FROM` restent les clés lues. **Préréglage `cloudflare`** : host/port/user imposés (`smtp.mx.cloudflare.net:465`, user `api_token`), seul le token + from sont à fournir | env `SMTP_*` ou référence intégration |
| `resend` | `fetch` natif `POST https://api.resend.com/emails` + `Idempotency-Key: <mail.id>` ; erreurs 429/5xx → `retryable: true` | `RESEND_API_KEY` ou `integration://resend` |
| `file-sink` | JSON local (inchangé, adapté au nouveau type) — dev/CI/gates | `outDir` |

Suppressions (breaking, absorbées vague W) : type `MailProvider`,
`createSmtpEnvMailProvider`, `SMTP_ENV_PROVIDER_ID`, provider `platform-stub`,
`PlatformMailsStore.registerProvider`/`queueSend` (remplacés par l'outbox),
`createMemoryMailsStore` (si plus consommé après refonte des tests package).

### 4.2 Résolution du transport par configuration

`resolveMailTransport()` (nouveau `src/transport-resolve.ts`), ordre de
priorité :

1. **Réglage instance** (posé par l'UI admin, persisté dans core.db —
   table `creezio_platform_mail_settings`, clé/valeur JSON : `transport`,
   `preset`, `from`, `secretRef`) ;
2. **Env** : `MAIL_TRANSPORT=resend|smtp|cloudflare|file-sink`
   (+ `RESEND_API_KEY` / `SMTP_*` / `MAIL_FILE_SINK_DIR`) — `cloudflare`
   = alias du preset SMTP Cloudflare ;
3. Rétro-inférence : si `SMTP_URL`/`SMTP_HOST` posés sans `MAIL_TRANSPORT`
   → `smtp` (les instances Docker existantes configurées `SMTP_*`
   continuent d'envoyer sans changement d'env) ; si `RESEND_API_KEY` → `resend` ;
4. Défaut : non configuré → l'outbox marque `failed_permanent`
   (`transport_unconfigured`) sans retry, comme l'actuel `smtp_unconfigured`.

Les secrets peuvent être des **références d'intégration**
(`integration://resend`, `integration://smtp-<slug>`) résolues via
`@creezio/integrations` (AES-256-GCM au repos, jamais de clair dans les
réponses de listing) — nouveaux providers au catalogue : `resend`,
`smtp`, `imap`.

### 4.3 Envoi fiable : outbox durable + journal

**Toute émission passe par l'outbox** — les modules métier n'instancient
plus de transport (c'est le breaking change principal côté marque) :

```ts
// API programmatique (modules marque, côté serveur)
const mails = getKitMailsStore();
mails.enqueue({ to: [...], subject, text, html, attachments? }); // jamais bloquant
```

- Table `creezio_platform_mails` étendue : `cc`, `bcc`, `reply_to`,
  `in_reply_to`, `references`, `thread_id`, `account_id`,
  `provider_message_id`, `retry_count`, `next_attempt_at`, `last_error`,
  `sent_at`, `delivered_at` ; `status` étendu :
  `draft | queued | sending | sent | delivered | bounced | failed |
  failed_permanent | inbound` ; `folder` étendu :
  `inbox | sent | drafts | outbox | archive | trash`.
- Nouvelle table `creezio_platform_mail_events` (journal) :
  `id, mail_id, type (queued|attempt|sent|delivered|bounced|complained|
  failed), detail TEXT, provider TEXT, created_at`.
- **Worker outbox** in-process (app-runtime, harness + desktop) :
  boucle `setInterval` (15 s + jitter), claim des mails
  `queued && next_attempt_at <= now`, backoff exponentiel (1 min → 1 h,
  8 tentatives max → `failed_permanent`), résultats journalisés.
  Opt-out : `CREEZIO_MAIL_OUTBOX=0` (tests d'isolation).
- PJ sortantes : réutilisation de `creezio_platform_mail_attachments`
  (BLOB), liées au mail avant enqueue ; limite kit 25 Mo/mail (configurable).

### 4.4 Statuts post-remise : webhooks

- `POST /api/v1/email/webhooks/resend` — vérification **signature Svix**
  implémentée en HMAC-SHA256 natif (pas de dépendance), secret
  `RESEND_WEBHOOK_SECRET` ou `integration://resend-webhook` ; mapping
  `email.sent|delivered|bounced|complained` → update `status` +
  `delivered_at` par `provider_message_id` + événement journalisé.
- Optionnel (activable) : `email.received` → 3ᵉ source inbound (fetch corps
  + PJ via l'API Receiving Resend, insertion `insertInboundFull` avec dédup
  `message_id`).
- SMTP (Cloudflare/direct) : pas de webhook standard → statut final = `sent`
  (remise au relais) ; documenté comme limite du transport.

### 4.5 Réception multi-source

| Source | Chaîne | Changement |
|---|---|---|
| Cloudflare Email Routing | worker `email-worker/` → `POST /inbound` (secret partagé) → `insertInboundFull` | **Aucun** (contrat gelé) |
| IMAP direct | `imapflow` (peer optionnel) : comptes en base, sync incrémentale, insertion via la même `insertInboundFull` | **Nouveau** |
| Resend inbound | webhook `email.received` (optionnel) | **Nouveau, opt-in** |

IMAP — design :

- Table `creezio_platform_mail_accounts` : `id, label, host, port, secure,
  username, secret_ref (integration://…), folders_json (mapping IMAP→kit),
  last_uidvalidity, last_uid, sync_state, last_sync_at, last_error, enabled`.
- **Sync par poll** (défaut 120 s, `CREEZIO_MAIL_IMAP_POLL_MS`) : fetch des
  UID > `last_uid` (reset si `UIDVALIDITY` change), parsing `mailparser`,
  insertion dédupliquée par `message_id`, PJ en BLOB. IDLE (auto imapflow)
  activé quand la connexion est maintenue (`CREEZIO_MAIL_IMAP_IDLE=1`,
  défaut on en desktop, off en Docker multi-instances pour limiter les
  connexions persistantes).
- Lecture seule côté serveur IMAP en v1 (pas de write-back des flags \Seen —
  décision ouverte §9).
- CRUD comptes : `GET/POST/PATCH/DELETE /api/v1/email/accounts` (owner only),
  secret jamais renvoyé (hint), test de connexion `POST /accounts/:id/verify`.

### 4.6 API `/api/v1/email/*` cible

Conservé tel quel : `POST /inbound`, `GET /meta`, `GET /` (liste, + param
`folder` déjà supporté), `GET /:id`, `GET /:id/attachments/:attId`,
`PATCH /:id`, `DELETE /:id`.

Nouveau :

| Route | Rôle |
|---|---|
| `POST /send` | compose + enqueue direct (to/cc/bcc/subject/html/text/attachmentIds/inReplyTo) |
| `POST /drafts` / `PUT /drafts/:id` / `POST /drafts/:id/send` | brouillons riches |
| `POST /attachments` | upload PJ sortante (multipart ou base64, → BLOB, renvoie `attachmentId`) |
| `GET /threads/:threadId` | messages d'un fil (in+out, tri chrono) |
| `GET /:id/events` | journal d'envoi (UI statut) |
| `GET/POST/PATCH/DELETE /accounts`, `POST /accounts/:id/verify` | comptes IMAP |
| `GET /settings` / `PUT /settings` (owner) | transport actif, from, test `POST /settings/verify` |
| `POST /webhooks/resend` | statuts + inbound Resend (signature Svix) |

Auth : inchangée (session via `mount-brand-email-surface`, `/inbound` et
`/webhooks/*` par secret/signature). L'`ApiMount` `platform-mails`
(drafts/list/send minimal) est **réaligné** sur le store v2 (même surface,
implémentation enqueue) — il reste le canal programmatique interne.

Threading : `thread_id` = racine du fil ; calcul à l'insertion
(`In-Reply-To`/`References` → mail connu ? hériter son `thread_id` : nouveau).

### 4.7 UI webmail — `MailWorkspace`

`@creezio/mails/ui` exporte **`MailWorkspace`** (remplace `MailInbox` ;
le wrapper os-ui/factory est régénéré — les marques n'ont rien à écrire) :

- Layout 3 panneaux redimensionnables (adaptation du bloc shadcn Mail) :
  **dossiers** (Boîte de réception, Envoyés, Brouillons, File d'attente,
  Archive, Corbeille + comptes IMAP), **liste** (tabs Tous/Non-lus, recherche,
  badges PJ/statut), **lecture** (rendu HTML en iframe sandboxée, PJ,
  actions répondre/répondre à tous/transférer/archiver/supprimer,
  timeline des événements d'envoi pour les mails sortants).
- **Composer** (Sheet plein écran ou Dialog large) : chips to/cc/bcc,
  objet, éditeur **Tiptap** (StarterKit + Link + Placeholder, toolbar
  shadcn), PJ (upload → `POST /attachments`), enregistrer brouillon,
  envoyer (→ `POST /send` ou `/drafts/:id/send`). Réponse = pré-remplissage
  + `inReplyTo`/`references` + citation du message.
- Primitives ajoutées à `@creezio/shell-ui/ui/kit` : `resizable`
  (react-resizable-panels), `tooltip`, `textarea`.
- Charte : couleurs/tokens Creezio existants (pas de copie brute du style
  new-york shadcn).

### 4.8 Où vit quoi

| Besoin | Emplacement |
|---|---|
| Contrats, transports, outbox, IMAP, webhooks, routes, UI webmail | `packages/mails` (src + ui) |
| Primitives resizable/tooltip/textarea | `packages/shell-ui/ui/primitives` |
| Boot worker outbox + sync IMAP, montage surfaces, migrations extras | `packages/app-runtime` |
| Wrapper `/mails` + (nouvelle) page paramètres email | `packages/os-ui/routes` + `packages/factory/src/generators/os-ui.ts` |
| Providers `resend`/`smtp`/`imap` au catalogue intégrations | `packages/integrations/src/providers.ts` |
| Worker inbound Cloudflare | `packages/mails/email-worker` (inchangé) |
| Config marque (rootDomain, secret inbound, uiEnabled) | `configureMails` (inchangé) |

Aucune table hors couche `core` (isolation DB respectée), aucun domaine
marque dans le kit (ADR no-brand-domain), pas de zod ajouté (parsing manuel
comme `email-routes.ts` actuel), nodemailer/imapflow/mailparser en **peers
optionnels** chargés dynamiquement (le kit ne les impose pas ; les marques
qui utilisent SMTP/IMAP les installent — la factory les pose par défaut dans
le `server/package.json` scaffoldé).

## 5. Plan d'exécution par vagues

Conventions : phases nommées `M<vague><n>` ; chaque phase = un agent avec
périmètre de fichiers **strict** ; une vague se termine par
`npm run build:packages` + `npm run test:kit` verts. Les phases d'une même
vague sont parallélisables sauf mention contraire.

### Vague MA — Fondations (contrats + schéma + transports)

**MA1 — Contrats & schéma v2** *(bloquant pour tout le reste)*

- Fichiers : `packages/mails/src/types.ts`, `src/transport.ts` (nouveau),
  `src/sqlite-store.ts`, `src/inbox-queries.ts`, `src/memory-store.ts`
  (suppression ou refonte), `src/index.ts`, `src/migrate-brand-emails.ts`
  (alignement colonnes).
- Livrables : types `OutgoingMail`/`MailSendResult`/`MailTransport` ;
  colonnes étendues (`cc`, `bcc`, `reply_to`, `in_reply_to`, `references`,
  `thread_id`, `account_id`, `provider_message_id`, `retry_count`,
  `next_attempt_at`, `last_error`, `sent_at`, `delivered_at`) via
  `ensureMailsInboundColumnsSql` (ALTER idempotents) ; tables
  `creezio_platform_mail_events`, `creezio_platform_mail_accounts`,
  `creezio_platform_mail_settings` dans `PLATFORM_MAILS_CORE_SQL` ;
  calcul `thread_id` à l'insertion ; suppression `MailProvider` v1,
  `registerProvider`, `queueSend`, `platform-stub`.
- Gates : `test-mails-inbox.mjs` mis à jour (schéma, threads, dédup) ;
  typecheck + build `@creezio/mails`.
- Acceptation : une DB v1 existante migre sans perte (ALTER idempotents,
  statuts/folders legacy valides) ; dédup `message_id` intacte.
- Effort : 1,5 j-agent.

**MA2 — Transports smtp / resend / file-sink + résolution config**
*(dépend de MA1 pour les types ; parallélisable avec MA3)*

- Fichiers : `packages/mails/src/providers/smtp.ts` (renommage/refonte de
  `smtp-env.ts` — cc/bcc/replyTo/headers/attachments, préréglage
  `cloudflare`, `verify()`), `src/providers/resend.ts` (nouveau, fetch natif,
  Idempotency-Key, mapping erreurs retryable), `src/providers/file-sink.ts`
  (adapté au type v2), `src/transport-resolve.ts` (nouveau — priorités §4.2),
  `src/index.ts` (exports).
- Gates : nouvelle `scripts/test-phase-mails-transports.mjs` — résolution
  par env (dont rétro-inférence `SMTP_*` seuls), preset cloudflare
  (host/user imposés), envoi SMTP contre serveur local éphémère
  (reprendre la technique de la gate WinHub `test-mail-smtp-env.mjs`),
  Resend contre mock HTTP local (assert payload + Idempotency-Key +
  429 → retryable).
- Acceptation : `MAIL_TRANSPORT` non posé + `SMTP_HOST` posé → transport
  smtp (compat env des instances Docker existantes) ; secret via
  `integration://` résolu.
- Effort : 2 j-agent.

**MA3 — Catalogue intégrations : providers resend/smtp/imap**
*(parallélisable avec MA2)*

- Fichiers : `packages/integrations/src/providers.ts` (+ mapping n8n
  `smtp` credential type pour la sync best-effort), README/AGENTS du package.
- Gates : `test-phase-integrations.mjs` étendue.
- Effort : 0,5 j-agent.

### Vague MB — Fiabilité d'envoi (dépend de MA)

**MB1 — Outbox durable + worker retries + API send/drafts**

- Fichiers : `packages/mails/src/outbox.ts` (nouveau — enqueue, claim,
  backoff, journal), `src/sqlite-store.ts` (méthodes `enqueue`,
  `listOutbox`, `recordEvent`), `src/email-routes.ts` (`POST /send`,
  `/drafts*`, `/attachments`, `GET /threads/:id`, `GET /:id/events`,
  `GET/PUT /settings` + `verify`), `src/api-mount.ts` (réaligné sur
  enqueue), `packages/app-runtime/src/create-brand-kernel.ts` +
  `start-brand-kernel-harness.ts` (boot worker outbox,
  `CREEZIO_MAIL_OUTBOX=0`).
- Gates : nouvelle `scripts/test-phase-mails-outbox.mjs` — enqueue
  non bloquant, retry backoff (transport failing → retryable), passage
  `failed_permanent` après max, journal complet, PJ sortante round-trip ;
  `test-os-email-surface.mjs` étendue (nouvelles routes sous auth).
- Acceptation : un transport down ne bloque jamais l'appelant ; après
  rétablissement, l'outbox draine ; `/send` refuse >25 Mo de PJ.
- Effort : 2,5 j-agent.

**MB2 — Webhooks Resend (statuts + inbound opt-in)**
*(parallélisable avec MB1 après accord sur le schéma events)*

- Fichiers : `packages/mails/src/webhooks/resend.ts` (nouveau — vérif Svix
  HMAC native, mapping events), `src/email-routes.ts` (montage
  `POST /webhooks/resend`), `src/inbound-resend.ts` (nouveau, opt-in —
  fetch corps/PJ via API Receiving → `insertInboundFull`).
- Gates : nouvelle `scripts/test-phase-mails-webhooks.mjs` — signature
  valide/invalide/expirée, `delivered`/`bounced` → statut + événement par
  `provider_message_id`, `email.received` (mock API Receiving) → mail en
  inbox avec PJ, dédup.
- Effort : 1,5 j-agent.

### Vague MC — Réception IMAP (dépend de MA ; parallélisable avec MB)

**MC1 — Comptes + moteur de sync IMAP**

- Fichiers : `packages/mails/src/imap/sync.ts` + `src/imap/accounts.ts`
  (nouveaux — imapflow/mailparser en imports dynamiques, poll + IDLE,
  UIDVALIDITY/UID incrémental, mapping folders), `src/email-routes.ts`
  (CRUD `/accounts` + `verify`), `packages/app-runtime` (boot scheduler
  IMAP, `CREEZIO_MAIL_IMAP_POLL_MS`, `CREEZIO_MAIL_IMAP_IDLE`).
- Gates : nouvelle `scripts/test-phase-mails-imap.mjs` — CRUD comptes
  (secret jamais renvoyé), moteur de sync contre un **serveur IMAP mock
  in-process** (fixture minimale parlant IMAP sur socket local, comme les
  gates SMTP) : sync initiale, incrémentale, reset UIDVALIDITY, dédup.
- Acceptation : compte injoignable = `last_error` visible, jamais de crash ;
  imapflow absent = capacité refusée proprement (`imap_module_absent`).
- Effort : 2,5 j-agent.

### Vague MD — UI webmail (dépend de MA/MB pour les routes ; MC pour les comptes)

**MD1 — Primitives shell-ui** *(peut démarrer dès la vague MA)*

- Fichiers : `packages/shell-ui/ui/primitives/resizable.tsx`, `tooltip.tsx`,
  `textarea.tsx`, `ui/kit.ts`, `package.json` (dep `react-resizable-panels`,
  `@radix-ui/react-tooltip`).
- Gates : `test-phase-p-shell-ui.mjs` étendue (exports).
- Effort : 0,5 j-agent.

**MD2 — `MailWorkspace` lecture (3 panneaux, dossiers, threads)**

- Fichiers : `packages/mails/ui/mail-workspace.tsx` (nouveau),
  `ui/mail-folders.tsx`, `ui/mail-list.tsx`, `ui/mail-display.tsx`
  (iframe sandboxée), `ui/index.ts` (export `MailWorkspace`, suppression
  `MailInbox`), suppression `ui/mail-inbox.tsx`.
- Gates : nouvelle `scripts/test-phase-mails-ui.mjs` (exports, pas de
  `dangerouslySetInnerHTML` sur du contenu inbound, wrappers) ; typecheck.
- Effort : 2 j-agent.

**MD3 — Composer / reply / brouillons / PJ (Tiptap)**

- Fichiers : `packages/mails/ui/mail-composer.tsx` (nouveau),
  `ui/recipients-input.tsx`, `packages/mails/package.json` (peers optionnels
  `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link` — la
  factory les pose dans `server/ui/package.json` scaffoldé).
- Acceptation : envoyer, répondre (fil conservé), brouillon persistant,
  PJ 10 Mo OK ; sans Tiptap installé → fallback textarea (dégradé
  fonctionnel, pas de crash).
- Effort : 2 j-agent.

**MD4 — Page paramètres email (owner)**

- Fichiers : `packages/mails/ui/mail-settings.tsx` (nouveau — choix
  transport, from, secret par référence, bouton « tester l'envoi »,
  comptes IMAP), wrapper `packages/os-ui/routes/parametres/email/page.tsx`
  (ou onglet de la page paramètres existante — à trancher au démarrage de
  la phase selon la structure actuelle de `/parametres`).
- Effort : 1 j-agent.

### Vague ME — Factory / os-ui / docs / propagation (dépend de MD)

**ME1 — Wrappers + scaffold + docs kit**

- Fichiers : `packages/os-ui/routes/mails/page.tsx` (→ `MailWorkspace`),
  `packages/factory/src/generators/os-ui.ts` (wrapper + deps UI scaffoldées
  + nodemailer/imapflow/mailparser dans le `server/package.json` généré),
  `packages/mails/README.md`, `AGENTS.md`, `docs/FILES.md`
  (`node scripts/generate-files-md.mjs mails`), `docs/PACKAGES.md`,
  `packages/os-ui`/`factory` docs.
- Gates : `test-phase-os-ui-scaffold.mjs`, `test-os-mails-config.mjs`,
  `test-os-owned-by-brand.mjs`, `test-phase-docs-freshness.mjs` ;
  `npm run test:kit` complet ; `npm run build:packages`.
- Effort : 1 j-agent.
- Sortie de vague : **PR kit mergée sur `main`** (précondition absolue de
  la vague W — `SYNC.json` pinne le HEAD du kit).

### Vague W — Migration WinHub (après push kit `main` + resync vendor)

**W1 — Resync + bascule des 5 modules + purge du provisoire**

- Préambule (ops, 15 min) :
  `npm update "@creezio/*"` (distribution npm — plus de sync vendor)
  (baseline complète, jamais de sync partiel), puis
  `npm run install:server-deps`.
- Fichiers marque (périmètre strict) :
  - `server/src/electron/modules/orders.ts`, `payments.ts`, `logistics.ts`,
    `organizations.ts`, `needs.ts` : remplacer chaque
    `createSmtpEnvMailProvider()` / `createFileSinkMailProvider()` +
    `provider.send()` par `getKitMailsStore().enqueue({...})`
    (le best-effort est conservé : enqueue non bloquant ; l'audit
    `email_echec` d'orders se rebranche sur l'événement `failed_permanent`
    ou est remplacé par la consultation du journal — au choix de l'agent,
    documenté) ;
  - `server/package.json` : `nodemailer` conservé (requis par le transport
    smtp), + `imapflow`/`mailparser` si la marque active l'IMAP ;
  - `scripts/test-mail-smtp-env.mjs` (gate provisoire) : **supprimée**,
    remplacée par `scripts/test-mail-outbox.mjs` (enqueue → worker →
    serveur SMTP local éphémère → `sent` + journal ; et
    `MAIL_TRANSPORT=file-sink` pour les gates existantes) ;
  - gates existantes qui posaient `WINHUB_MAIL_SINK_DIR`
    (`test-module-payments`, `e1-smoke-intermodules`, `recette-cdc-4lots`) :
    basculer sur `MAIL_TRANSPORT=file-sink` + `MAIL_FILE_SINK_DIR`
    (la variable `WINHUB_MAIL_SINK_DIR` disparaît) ;
  - `docs/EMAILS-PRODUCTION.md` : réécrite — configuration par
    `MAIL_TRANSPORT` (cloudflare/smtp/resend), variables, page paramètres,
    outbox/statuts, IMAP ;
  - env prod : `SMTP_*` existants **continuent de fonctionner**
    (rétro-inférence §4.2) — la doc recommande de poser explicitement
    `MAIL_TRANSPORT=cloudflare` (ou `resend`).
- Gates : `AUTH_DISABLED=1 CREEZIO_ROOT=/home/fidus/winhub npm test`
  (racine WinHub) vert ; `npm run typecheck --prefix server`.
- Acceptation : plus aucune occurrence de `createSmtpEnvMailProvider` dans
  `server/src` ; les 5 flux métier envoient via l'outbox ; un envoi échoué
  est visible dans `/mails` (dossier File d'attente, statut + journal).
- Effort : 1,5 j-agent.

**W2 — Recette marque webmail**

- `npm run build:ui` + `npm run metier:api` : recette manuelle/scriptée —
  inbox CF inchangée (POST /inbound de test), compose + envoi (file-sink
  puis SMTP local), reply avec fil, brouillon, PJ, page paramètres
  (verify transport), compte IMAP de test si dispo.
- Fichiers : uniquement scripts de recette éventuels sous `server/scripts/`.
- Effort : 0,5 j-agent.

### Parallélisation (résumé)

```
MA1 ──► MA2 ──┬─► MB1 ──┬─► MD2 ─► MD3 ─► MD4 ─► ME1 ─► (push main) ─► W1 ─► W2
        MA3 ──┤   MB2 ──┤
              └─► MC1 ───┘
MD1 (dès le début, indépendant)
```

Effort total estimé : **≈ 19 j-agent** (kit ≈ 17, WinHub ≈ 2), soit 4–5
vagues d'agents parallèles.

## 6. Récapitulatif gates/tests

| Gate | Vague | Contenu |
|---|---|---|
| `test-mails-inbox.mjs` (package, màj) | MA1 | schéma v2, threads, dédup, migration colonnes |
| `test-phase-mails-transports.mjs` (nouvelle) | MA2 | résolution config, preset cloudflare, SMTP local, mock Resend |
| `test-phase-integrations.mjs` (màj) | MA3 | providers resend/smtp/imap |
| `test-phase-mails-outbox.mjs` (nouvelle) | MB1 | retries, statuts, journal, PJ |
| `test-phase-mails-webhooks.mjs` (nouvelle) | MB2 | signature Svix, delivered/bounced, inbound Resend |
| `test-phase-mails-imap.mjs` (nouvelle) | MC1 | CRUD comptes, sync mock IMAP |
| `test-phase-p-shell-ui.mjs` (màj) | MD1 | exports resizable/tooltip/textarea |
| `test-phase-mails-ui.mjs` (nouvelle) | MD2 | exports MailWorkspace, iframe sandbox |
| `test-os-mails-config.mjs`, `test-os-email-surface.mjs` (màj) | MB1/ME1 | routes nouvelles sous auth, meta |
| `test-phase-os-ui-scaffold.mjs`, `test-os-owned-by-brand.mjs`, `test-phase-docs-freshness.mjs` (màj) | ME1 | wrappers, docs |
| WinHub : `test-mail-outbox.mjs` (remplace `test-mail-smtp-env.mjs`) + gates existantes basculées `MAIL_TRANSPORT=file-sink` | W1 | envoi bout-en-bout marque |

Règle build : chaque vague kit se conclut par `npm run build:packages`
(gate `test-phase-runtime-dist-freshness` fail-closed) ; resync vendor
**uniquement après merge sur `main`**.

## 7. Impacts marques (au-delà de WinHub)

- **Breaking assumé, absorbé par resync** : `createSmtpEnvMailProvider`,
  `MailProvider` v1, `registerProvider`/`queueSend` disparaissent. Les autres
  marques (tempoflow2/3, certivan, fidu) ne les consomment pas directement
  dans leur métier (à re-vérifier au resync de chacune) ; le montage kit
  (`create-brand-kernel`) est mis à jour dans la même PR — une marque
  resyncée est cohérente par construction.
- Wrappers `/mails` régénérés par la factory (`creezio brand apply` /
  scaffold) ; pour les marques existantes, le resync vendor suffit pour la
  lib, et le wrapper 8 lignes est réécrit à la main ou via le scaffold.
- Env : les instances configurées `SMTP_*` continuent d'envoyer
  (rétro-inférence) ; `EMAIL_INBOUND_SECRET`/worker CF inchangés ; aucune
  migration de données manuelle (ALTER idempotents au boot).
- Fidu : `uiEnabled: false` continue de masquer l'UI sans retirer la capacité.

## 8. Risques et mitigations

| Risque | Impact | Mitigation |
|---|---|---|
| Cloudflare Email Service **encore en bêta** (sending SMTP, juin 2026) | changement de contrat/limites possible | CF = simple préréglage du transport smtp → bascule Resend/SES/Postmark = config, zéro code ; suivre le changelog CF avant GA |
| Deliverabilité (SPF/DKIM/DMARC) | mails en spam | onboarding domaine documenté par transport (dashboard CF / Resend domains) ; `verify()` + bouton test dans la page paramètres |
| PJ en BLOB SQLite (in+out) | croissance core.db | limite 25 Mo/mail, rétention configurable (purge corbeille/archive > N jours, réglage `mail_settings`) ; hors scope v1 : stockage fichier externe |
| XSS via HTML inbound | compromission session | iframe sandboxée (MD2) — supprime le `dangerouslySetInnerHTML` actuel |
| RGPD / rétention | données personnelles en base | rétention paramétrable + suppression définitive effective (DELETE cascade PJ) ; secrets IMAP/API chiffrés au repos (integrations) ; documenter la purge dans le README |
| IMAP hostile (serveurs exotiques, gros historiques) | sync lente/instable | sync incrémentale bornée (batch), `last_error` visible, comptes désactivables ; imapflow gère les extensions automatiquement |
| Poids des peers optionnels (nodemailer/imapflow/mailparser/tiptap) | image Docker/desktop | imports dynamiques + refus propre si absents ; la factory les pose par défaut, une marque peut les retirer |
| Migration WinHub oubliée après push kit | marque cassée au resync | vagues ME1→W1 planifiées dans la même fenêtre ; `SYNC.json` pinne le HEAD — pas de resync avant merge |
| Outbox multi-process (kernel + Next) | double envoi | worker outbox démarré uniquement côté kernel (app-runtime) ; claim transactionnel (`UPDATE … WHERE status='queued'` atomique) |

## 9. Décisions ouvertes (à trancher en début de phase concernée)

1. **Write-back IMAP** (marquer \Seen côté serveur distant, déplacer en
   dossier) — v1 : lecture seule ; à réévaluer après usage (MC1).
2. **Inbound Resend** activé par défaut ou opt-in (`MAIL_INBOUND_RESEND=1`) —
   plan : opt-in (MB2).
3. Page paramètres email : page dédiée `/parametres/email` ou onglet de la
   page paramètres existante (MD4, selon structure os-ui au moment T).
4. Audit `email_echec` WinHub : événement outbox `failed_permanent` relayé
   par hook, ou simple consultation du journal (W1).

## 10. Notes d'exécution (implémentation, août 2026)

Écarts constatés entre le plan et le code livré — la réalité du code prime :

- **Secrets `integration://`** : pour éviter une dépendance circulaire
  `@creezio/mails` → `@creezio/integrations`, la résolution passe par un
  bridge injectable (`configureMailSecretBridge`), câblé par
  `create-brand-kernel.ts` (app-runtime) sur le store integrations.
- **Acteur des routes** : `createEmailInboxRoutes` reçoit un `resolveActor`
  injecté (session → `{ userId, owner }`) plutôt qu'un import direct de
  l'auth ; `mount-brand-email-surface.ts` exempte `/inbound` et
  `/webhooks/*` de session (secret partagé / signature Svix).
- **Migration v1 → v2** : `ensureMailsInboxSchema` exécute le SQL cœur en
  deux passes (tables, ALTERs idempotents, puis index v2) — les index sur
  colonnes nouvelles échoueraient sinon sur une base v1 existante.
- **PJ sortantes** : contenu inline (`Buffer`/base64) à l'enqueue ou via
  `POST /attachments` (qui crée un brouillon implicite si `mailId` absent) —
  pas de PJ orpheline sans mail parent (FK).
- **Décision ouverte n°3 tranchée** : page dédiée
  `packages/os-ui/routes/parametres/email/page.tsx` (la page `/parametres`
  existante est le wrapper `DesktopSettingsPage` du kit, pas extensible par
  onglet sans le modifier).
- **Peers de test** : `nodemailer`/`imapflow`/`mailparser` ajoutés aussi en
  devDependencies de `@creezio/mails` pour que les gates kit tournent sans
  installation manuelle (peers optionnels inchangés côté consommateurs).
- **Ancienne UI** : `ui/mail-inbox.tsx` supprimée (remplacée par
  `MailWorkspace`) ; `memory-store.ts` et `providers/smtp-env.ts` supprimés ;
  gates historiques `test-phase-h1/i3/m8` mises à jour vers l'API v2.
- **Gate MD supplémentaire** : `test-phase-mails-ui.mjs` couvre MD2+MD3+MD4
  (une seule gate au lieu d'une par sous-vague).
- **Vague W (WinHub, livrée)** :
  - `CREEZIO_MAIL_OUTBOX_INTERVAL_MS` ajouté au kernel (app-runtime) — les
    gates marque ont besoin d'un drain outbox rapide (120 ms) car l'envoi est
    devenu asynchrone (avant : `provider.send()` synchrone dans la requête).
  - Sémantique `email_sent` des réponses API marque = **mise en file OK**
    (plus « envoi réussi ») ; `email_echec` (audit) réservé à l'échec
    d'ENQUEUE. Un échec de transport se prouve côté gate par
    `failed_permanent`/`transport_unconfigured` dans `core.db`
    (gate orders) — plus d'event audit pour un échec de transport.
  - Asserts mails des gates marque réécrits en « attendre LE mail attendu »
    (prédicat + poll) au lieu de compter les fichiers sink — le drain
    asynchrone rend les comptages exacts non déterministes.
  - `nodemailer` **conservé** dans les deps server WinHub (transport SMTP du
    kit chargé dynamiquement) + `imapflow`/`mailparser` (réception IMAP).
  - Deps UI webmail (`react-resizable-panels`, `@radix-ui/react-tooltip`,
    `@tiptap/*`) à ajouter dans `server/ui/package.json` des marques
    existantes (les nouvelles marques les reçoivent via la factory) ; après
    resync vendor, forcer le refresh des copies `file:` de
    `server/ui/node_modules/@creezio` (npm ne re-copie pas sans bump).
  - dist kit : `tsc` ne supprime pas les sorties orphelines — purge manuelle
    de `dist*/providers/smtp-env.*` et `dist*/memory-store.*` avant resync
    (sinon le vendor marque garde l'ancien provider).

## 11. Références

- Kit : `packages/mails/*`, `packages/app-runtime/src/create-brand-kernel.ts`,
  `packages/app-runtime/src/mount-brand-email-surface.ts`,
  `packages/os-ui/routes/mails/page.tsx`,
  `packages/factory/src/generators/os-ui.ts`,
  `packages/integrations/*`, `docs/adr/ADR-integrations-store.md`.
- WinHub : `server/src/electron/modules/{orders,payments,logistics,organizations,needs}.ts`,
  `docs/EMAILS-PRODUCTION.md`, `server/scripts/test-mail-outbox.mjs`
  (remplace `test-mail-smtp-env.mjs`).
- Externe (2026) :
  - Resend — API emails <https://resend.com/docs/api-reference/emails>,
    webhooks <https://resend.com/docs/webhooks/introduction>, receiving
    <https://resend.com/docs/dashboard/receiving/introduction>, pricing
    <https://resend.com/pricing>.
  - Cloudflare Email Service — SMTP (bêta 2026-06)
    <https://developers.cloudflare.com/email-service/api/send-emails/smtp/>,
    sending public beta (2026-04)
    <https://developers.cloudflare.com/changelog/post/2026-04-16-email-sending-public-beta/>.
  - imapflow <https://imapflow.com/docs/> (v1.6.x, IDLE auto, QRESYNC).
  - Bloc Mail officiel shadcn/ui
    <https://github.com/shadcn-ui/ui/tree/main/apps/www/app/(app)/examples/mail>
    (démo <https://v3.shadcn.com/examples/mail>).
  - Tiptap <https://tiptap.dev> (composer headless).
