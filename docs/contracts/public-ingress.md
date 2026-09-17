# Entrées publiques — contrat générique (C01)

Proposition, **pas une release**, aucun numéro de version, aucun `runtime/` attribué. Base kit : `0.13.1` SHA `f41f0ed3e1d19091f364df09f1932f9f89c46a0e`. Head précédent C01 : `b0fc580e68b1230732d552db234fdb447e4280a3`. WH-K01 `822fc927` puis correction `7779f770` : **propositions de handoff**, pas une API figée. Les choix mainteneur **priment**. Fixtures d’app, `docs/audit`, `docs/CONVERSION.md` WinHub : **non observés**.

## 1. Rejets

| Proposition (consommateur / C01-0) | Décision mainteneur |
|---|---|
| Admission réduite à HMAC **ou** jeton borné | **Non.** v1 = `signed` + `guest`. Jamais « ouvert ». Pas de bool sur `command()`. |
| `HMAC(secret, ascii(t)\|\|0x2E\|\|rawBytes)` comme **noyau** | **Non.** C’est un **exemple d’adaptateur Stripe**, pas un framing universel. Vérification = **callback serveur** (bindings) sur `rawBytes` intacts. |
| `utf8(bytes)` / `JSON.stringify` dans le MAC | **Non.** |
| Exactly-once métier | **Non.** Timeout/lease n’arrête pas le handler. Effet métier : idempotence **app prouvée** ou K02 équivalent. |
| `bounded` dans les premiers lots | **Non.** Extension **future** (capacité + acquisition K05 / acteur serveur). Pas de table/endpoint jeton à coder maintenant. |
| `rawBody?: string` / `accessJustification` Electron | **Non.** Hors Sites. |
| Regex tenant `^[a-z0-9-]{8,80}$` | **Absente du kit.** Ne pas l’ajouter (`ws_` cassé). POS/SIRET/honeypot = app. |
| DLQ kit, challenge/captcha inventés, preuve CORS/IP | **Non.** |
| 2xx avant handler réussi + `completed` persisté | **Non.** `processing` / `retryable` → **non-2xx**. `permanent_failure` ≠ `completed`. |

## 2. Constat 0.13.1 (inchangé)

SHA-256 identiques à la table 0.12=0.13.0 : `runtime/core/{types,commands,integrations}.ts`, `sites-adapter/src/dispatch.ts`, `api-kernel/src/types.ts`. Adoption 0.13.1 **sans** entrée publique Sites.

`dispatchRequest` : `OPTIONS` MCP ; **`mailInboundRoute` avant auth** (`POST /api/v1/email/inbound/:org`, Bearer / `x-email-inbound-secret` haché, JSON 5 Mio, **pas** HMAC, **pas** Stripe) ; OAuth puis `lite_` ; sans clé machine, `health|bootstrap|session|invites/accept|workspaces|auth/me` passent le 401 dispatcher, mais `handleApi`/`handleNativeApi` exigent l’identité Sites **sauf `GET health`** ; le reste, y compris `source:'app'`, **401 `authentication_required`** ; `checkOrigin` (Origin Site, refus `sec-fetch-site: cross-site`) ; `workspace()` = `lite_orgs` × `lite_members` ; `executeAppOperation` = `readJson` 65 536, `identity` obligatoire, **pas** de `rawBytes`. Bootstrap `ws_`+32 hex ; `POST workspaces` = UUID. `assertUniqueOperations` : id / méthode+forme / `toolName`. `operation()` défaut `mcp`/`tokenAllowed` **true** — une entrée publique **ne doit pas** l’emprunter. Coffre `secret_box` AES-GCM, AAD `org:id` ; `metadata()` `custom` = `headerName` seulement (`meta.webhookSecret` droppé). `mcp-oauth` limite via `cf-connecting-ip` : **pas** une identité. HMAC Sites : **absent**. Stripe ([webhooks](https://docs.stripe.com/webhooks), [signature](https://docs.stripe.com/webhooks/signature)) : corps non muté ; retry **re-signe**, même `evt_…` — **adaptateur**, pas le noyau.

## 3. Bindings serveur (v1)

Registre **distinct** du catalogue `Operation`, unicité au démarrage **plus** collision avec routes privées et `/api/v1/email/inbound/:org`. `mcp` / `tokenAllowed` structurellement faux. Callbacks = **serveur**, jamais du code client.

```ts
export type PublicAdmissionKind = 'signed' | 'guest'; // v1 ; 'bounded' hors lots suivants
export type PublicIngressEntry = {
  id: string;
  method: 'POST' | 'GET'; // GET : guest lecture seulement si déclaré
  path: string;            // /api/v1/… ; :params = idSchema
  admission: PublicAdmissionKind;
  tenantId: string;        // config serveur, ws_… ou UUID déjà en base
  maxBytes: number;        // jamais illimité
  contentTypes: readonly string[];
  timeoutMs: number;
  abuseLimiterRequired?: boolean; // guest : si true, binding absent ⇒ throw au démarrage
  vaultRef?: { integrationId: string }; // signed : secret(org,id) après tenant candidat
};
export type SignedProof = { kind: 'signed'; eventId: string; payloadDigest: Uint8Array };
export type GuestProof = { kind: 'guest' }; // pas d’eventId vérifié
export type AdmissionProof = SignedProof | GuestProof;
export type VerifyInput = {
  entry: PublicIngressEntry;
  tenantCandidate: string;
  rawBytes: Uint8Array; // une lecture readBytes, intacts
  headers: Headers;     // bornés ; pas le corps
  nowMs: number;        // horloge serveur
};
export type VerifyResult = { ok: true; eventId: string } | { ok: false };
export type ClaimKey = { tenantId: string; entryId: string; eventId: string };
export type ClaimToken = { generation: number; token: string };
export type SanitizedSnapshot = { status: 200 | 201 | 202; body: unknown }; // voir §5
export type ClaimStore = {
  claim(key: ClaimKey, digest: Uint8Array): Promise<
    | { kind: 'acquired'; token: ClaimToken }
    | { kind: 'busy' }
    | { kind: 'completed'; snapshot: SanitizedSnapshot }
    | { kind: 'digest_collision' }
  >;
  complete(token: ClaimToken, snapshot: SanitizedSnapshot): Promise<boolean>;
  retry(token: ClaimToken): Promise<boolean>;
  failPermanent(token: ClaimToken): Promise<boolean>;
  renew(token: ClaimToken): Promise<boolean>;
};
export type AbuseLimiter = { admit(input: { entryId: string; tenantId: string }): Promise<'ok' | 'busy'> };
export type PublicIngressBindings = {
  resolveTenant(entry: PublicIngressEntry, request: Request): string;
  verify?(input: VerifyInput): Promise<VerifyResult>;     // obligatoire si signed
  admitGuest?(input: { entry: PublicIngressEntry; tenantId: string; rawBytes: Uint8Array }): Promise<{ ok: boolean }>;
  handle(ctx: PublicAdmissionContext): Promise<{ status?: 200 | 201 | 202; body: unknown }>;
  claimStore: ClaimStore; // signed
  abuseLimiter?: AbuseLimiter;
};
export type PublicAdmissionContext = {
  kind: 'public';
  entryId: string;
  proof: AdmissionProof; // preuve typée, pas Identity/Role/Principal
  tenantId: string;
  requestId: string;
  rawBytes: Uint8Array;
};
```

Primitives `hmacSha256` / `concatBytes` / `timingSafeEqual` : **facultatives**. Aucun `signed_payload` imposé. **Exemple adaptateur Stripe (app)** : parser `Stripe-Signature` → `t` / `v1` ; message = ASCII(`t`) + `0x2E` + `rawBytes` ; MAC coffre ; `eventId` = `id` JSON **après** MAC. Autre fournisseur : autre `verify`.

## 4. Tenant — sans circularité secret

1. `resolveTenant` lit **uniquement** `entry.tenantId` (config/binding). 2. Query/body/`workspace`/`workspaceId`/slug **présents et ≠ candidat** → 403 (geste parasite). Absents → ignorer. 3. **Ensuite seulement**, si `signed` : `resolveIntegration` / decrypt `secret_box` avec AAD `org:id` = **candidat**. 4. `verify` lie la preuve à **ce** tenant + cette entrée. 5. Tenant final **identique** au candidat. Jamais l’espace d’un client. Alphabet : `ws_`+hex et UUID **déjà** stockés ; pas de schéma plus étroit.

## 5. Lease, replay, snapshot

Clé de replay **signed** : `tenantId + entryId (route) + eventId vérifié`. `payloadDigest` (SHA-256 des `rawBytes`) **obligatoire** ; même clé, autre digest → `digest_collision` refusée. Guest : **pas** d’`eventId` inexistant ; anti-abus / dédup **app distincte** ; `idempotencyKey` anonyme **n’est pas** une preuve.

`claim` pose `processing` + `lease_until` + `token` + `generation`. Takeover (lease expirée / `retryable`) : **incrémente `generation`**, nouveau `token`. `complete` / `retry` / `failPermanent` / `renew` : `UPDATE … WHERE generation=? AND token=? AND state='processing'` **atomique**. Un worker obsolète reçoit `false` : il **ne finalise pas** le nouveau lease.

Expiration **ne garantit pas** l’arrêt du handler. Effet métier déjà commis → l’app (ou K02 **prouvé**) doit no-op ; le kit peut ré-entrer.

| État | HTTP | Notes |
|---|---|---|
| `processing` (busy) | **non-2xx** (`admission_busy`) | Pas d’instantané succès |
| `completed` | 2xx + snapshot rejoué | **Seul** 2xx : handler réussi **et** persist `completed` |
| `retryable` | **non-2xx** | Reclaim possible |
| `permanent_failure` | 4xx borné | **Jamais** promu `completed` |

Classification **explicite** (descripteur / handler) : 2xx → `complete` ; 5xx / timeout / throw → `retry` ; refus métier définitif → `failPermanent`. Plafond `attempt_count` : reste `retryable` ou `permanent_failure` selon politique déclarée ; **examen humain** (ops), **pas** de DLQ kit. Snapshot rejoué : statut + corps **déjà** renvoyé par le handler, headers allowlist (`content-type`, `Idempotent-Replayed`). **Interdits** : `Set-Cookie`, `Authorization`, secrets, corps de **requête**. Ne pas stocker e-mail / IBAN / payload fournisseur brut : risques PII **à éviter explicitement** (accusé borné).

Séquence dispatcher : mail inbound inchangé → match méthode+chemin public → type/taille/timeout/`readBytes` une fois → tenant candidat → (signed : vault puis `verify` ; guest : limiteur si requis + `admitGuest`) → claim si signed → `handle` → persist état → HTTP. Hors match : flux actuel, privées **401** sans identité.

## 6. Guest v1, `bounded` futur, kit / app

**Guest** : politique déclarée, zéro secret navigateur, Origin/CORS/nonce/`cf-connecting-ip` **≠** preuve. Aucun paiement/stock. Limiteur = **capacité** `AbuseLimiter` **vérifiable** au démarrage : `abuseLimiterRequired: true` sans binding → **fail-closed**. Le kit ne fournit pas captcha/Turnstile/IP fiable.

**`bounded`** : hors v1. Si, plus tard, un jeton est émis **après** un guest, il **ne confère aucune** autorité paiement/stock. Ne pas inventer ce besoin dans les premiers lots.

| Couche | Kit | App |
|---|---|---|
| Match, `readBytes`, claim fencing, gardes, fail-closed | oui (lots après acceptation) | — |
| `verify` / framing fournisseur / `eventId` | callback | adaptateur (Stripe = exemple) |
| Fiche inscription, honeypot, dédup métier | — | oui |
| Crédit / stock | — | HMAC machine **ou** session ; idempotence **reçue** |

| Étape | Dépend |
|---|---|
| `start` runtime kit | **contrat accepté** ; pas R01 ; pas K02 pour admissions simples |
| `integrate` | preuves CI du lot runtime |
| Exposition **paiement** | idempotence app **reçue** ou K02 **équivalent prouvé** — pas une migration K02 obligatoire pour guest/signed non financiers |
| `publish` / version | **pas** C01 |

**Q restantes.** (1) `claimStore` : table kit additive au lot runtime, D1 injecté — **recommandé** plutôt que SQL app. (2) Clé du limiteur guest : dérivée **serveur** (entrée+tenant+seau horaire), jamais IP cliente — confirmer. (3) Durée de lease / plafond d’essais : constantes du lot runtime, pas ici.
