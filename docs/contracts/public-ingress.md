# Entrées publiques — contrat générique (C01)

Proposition, **pas une release**, aucun runtime livré. Base kit `0.13.1` `f41f0ed3e1d19091f364df09f1932f9f89c46a0e`. Head reçu : `26e4fec81986dba66d9168831f9348837a951138`. WH-K01 = handoff, pas API figée. Fixtures d’app **non observées**.

## 1. Rejets

| Proposition | Décision |
|---|---|
| Admission = HMAC **ou** magasin `bounded` kit | **Non.** v1 = `signed` + `guest`. Pas de table/endpoint jetons kit. |
| Framing `ascii(t)\|\|0x2E\|\|rawBytes` **noyau** | **Non.** Exemple adaptateur Stripe. `verify` accepte **toute** signature machine valide (HMAC ou autre). |
| `utf8(bytes)` / re-JSON dans le MAC ; exactly-once | **Non.** |
| `resolveTenant(request)` ; inspecter le **corps** pour un tenant client **avant** `verify` | **Non.** Config souveraine. Conflit éventuel **après** preuve + parse, sans relire le corps. |
| `handle` 2xx-only ; 2xx si `complete`/`fail*` = `false` | **Non.** Refus permanent déclaré. Worker obsolète → **non-2xx**. |
| `AbuseLimiter` kit / seau IP horaire universel | **Non.** Politique anti-abus **déclarée** ; l’interface n’apporte pas de limiteur. |
| `/payer` confirme ou crédite | **Non.** Page **guest** assistée ; le jeton n’est pas une Identity. |
| Regex `^[a-z0-9-]{8,80}$` ; `rawBody` Electron ; bool `public` sur `command()` ; DLQ | **Non.** |

## 2. Constat 0.13.1

SHA identiques 0.12=0.13.0 : `runtime/core/{types,commands,integrations}.ts`, `sites-adapter/src/dispatch.ts`, `api-kernel/src/types.ts`. `dispatchRequest` : inbound mail **avant** auth (jeton haché, JSON 5 Mio, pas HMAC) ; sans clé, `health|bootstrap|session|invites/accept|workspaces|auth/me` passent le 401 dispatcher mais l’identité Sites reste exigée **sauf `GET health`** ; le reste **401** ; `checkOrigin` ; `workspace()` = adhésion ; `readJson` 65 536, pas de `rawBytes`. `ws_`+32 hex / UUID. `operation()` défaut `mcp`/`tokenAllowed` true. Coffre `secret_box`, AAD `org:id` ; `meta.webhookSecret` droppé. HMAC Sites absent. Stripe docs : corps non muté ; retry re-signe — **adaptateur**.

## 3. Bindings (v1)

Registre distinct de `Operation` ; unicité + collision privées / inbound mail. `mcp`/`tokenAllowed` faux. Callbacks **serveur**.

```ts
export type PublicAdmissionKind = 'signed' | 'guest';
export type PublicIngressEntry = {
  id: string;
  method: 'POST' | 'GET';
  path: string; // /api/v1/… ; :params = idSchema
  admission: PublicAdmissionKind;
  tenantId: string; // config serveur uniquement
  maxBytes: number; // POST : plafond ; GET lecture : 0, pas de JSON exigé
  contentTypes: readonly string[]; // POST : p.ex. application/json ; GET : []
  timeoutMs: number;
  vaultRef?: { integrationId: string }; // signed, après tenant candidat
  abuse: { policy: string }; // texte de politique ; pas un limiteur fourni
};
export type RouteParams = Readonly<Record<string, string>>;
export type BoundedMeta = Readonly<{
  headers: Readonly<Record<string, string>>; // allowlist
  query: Readonly<Record<string, string>>;  // hors tenant
}>;
export type SignedProof = { kind: 'signed'; eventId: string; payloadDigest: Uint8Array };
export type GuestAdmission = {
  kind: 'guest';
  view?: Readonly<Record<string, unknown>>; // accusé / vue commande ; jamais secret ni jeton clair
};
export type VerifyInput = {
  entry: PublicIngressEntry;
  tenantCandidate: string;
  rawBytes: Uint8Array;
  headers: Headers;
  nowMs: number;
};
export type ClaimKey = { tenantId: string; entryId: string; eventId: string };
export type ClaimFence = { key: ClaimKey; generation: number; token: string };
export type SanitizedSnapshot = { status: number; body: unknown }; // pas 2xx si échec
export type HandleResult =
  | { outcome: 'success'; status: 200 | 201 | 202; body: unknown }
  | { outcome: 'retry' }
  | { outcome: 'permanent'; status: 400 | 403 | 404 | 409 | 410 | 422; body: unknown };
export type ClaimOutcome =
  | { kind: 'acquired'; fence: ClaimFence }
  | { kind: 'busy' }
  | { kind: 'completed'; snapshot: SanitizedSnapshot }
  | { kind: 'digest_collision' }
  | { kind: 'permanent_failure'; snapshot?: SanitizedSnapshot }
  | { kind: 'attempts_exhausted' };
export type ClaimStore = {
  claim(key: ClaimKey, digest: Uint8Array): Promise<ClaimOutcome>;
  complete(fence: ClaimFence, snapshot: SanitizedSnapshot): Promise<boolean>;
  retry(fence: ClaimFence): Promise<boolean>;
  failPermanent(fence: ClaimFence, snapshot?: SanitizedSnapshot): Promise<boolean>;
  renew(fence: ClaimFence): Promise<boolean>;
};
export type PublicIngressBindings = {
  resolveTenant(entry: PublicIngressEntry): string;
  verify?(input: VerifyInput): Promise<{ ok: true; eventId: string } | { ok: false }>; // exigé si une entrée signed
  admitGuest?(input: {
    entry: PublicIngressEntry;
    tenantId: string;
    params: RouteParams;
    meta: BoundedMeta;
    rawBytes: Uint8Array; // déjà lus ; GET souvent vide ; pas de second reader
  }): Promise<{ ok: true; admission: GuestAdmission } | { ok: false }>; // exigé si une entrée guest
  handle(ctx: PublicAdmissionContext): Promise<HandleResult>;
  claimStore?: ClaimStore; // exigé si signed
};
export type PublicAdmissionContext = {
  kind: 'public';
  entryId: string;
  proof: SignedProof | GuestAdmission;
  tenantId: string;
  requestId: string;
  rawBytes: Uint8Array;
  params: RouteParams;
};
```

Kind déclaré sans son callback (`verify` / `admitGuest` / `claimStore`) ⇒ fail-closed au démarrage. `signed` : HMAC-SHA256 **ou** autre signature machine que `verify` accepte. **Exemple Stripe (app)** : `t`/`v1`, ASCII(`t`)+`0x2E`+`rawBytes`. `guest` : refus `admitGuest` ⇒ **`handle` non appelé**. Jeton de chemin ≠ Identity/Role / `eventId` signé. `claimStore` **abstrait** ; adaptateur D1 kit additif = candidat runtime **après inventaire** des migrations ; **aucun** numéro réservé. Lease / essais / TTL = config serveur + tests déterministes futurs. `entry.abuse` documente la politique ; le type **n’injecte pas** de limiteur (pas de seau IP universel).

## 4. Tenant

`resolveTenant(entry)` → `entry.tenantId` (`ws_` ou UUID déjà en base). **Pas** de `Request`. Le kit **n’ouvre pas** le corps pour y chercher un workspace (mutation de `rawBytes` interdite). `?workspace=` n’alimente pas le tenant. Après preuve, l’app peut parser et refuser un champ JSON divergent. Puis seulement, `signed` : decrypt `secret_box` AAD `org:id` = candidat. Tenant final = candidat.

## 5. Claim, fencing, snapshot

Clé signed : `tenantId + entryId + eventId` vérifié + `payloadDigest` obligatoire ; collision digest refusée. Mutations fenceées : `complete`/`retry`/`failPermanent`/`renew` prennent le **`ClaimFence` entier** (`key` + `generation` + `token` opaque). Takeover : `generation+1`, nouveau `token`. `false` (worker obsolète) ⇒ **interdire 2xx**. `claim` peut renvoyer `permanent_failure` / `attempts_exhausted` (déjà saturé) → **non-2xx**, pas de handler succès. Guest : pas d’`eventId` ; pas d’`idempotencyKey` anonyme comme preuve.

| État | HTTP |
|---|---|
| `processing` / `busy` / `retryable` / `attempts_exhausted` | **non-2xx** |
| `completed` | 2xx snapshot **si** `complete(fence)=true` |
| `permanent_failure` | 4xx ; **jamais** promu `completed` |

`handle` `success` → `complete` ; `retry` → `retry` ; `permanent` → `failPermanent`. **Aucun** 2xx avant succès handler **et** persist `completed` **et** fencing vrai. Snapshot : statut+corps handler ; pas `Set-Cookie`/`Authorization`/secret/corps requête/jeton clair/PII.

Séquence : inbound mail → match → GET : pas de JSON ni corps ; POST : type/taille/`readBytes` une fois → tenant config → signed : vault + `verify` + `claim` ; guest : `admitGuest` (params+meta) → `handle` → persist → HTTP. Privées : 401.

## 6. Guest, `/payer`, kit / app

**Cas pilote (page, pas magasin kit).** `/payer/[token]` = page publique de **commande assistée**. Jeton **opaque**, émis **serveur par le staff**, haché, borné tenant+commande+TTL, **stocké par l’app**. Le kit **ne livre pas** ce magasin. `admitGuest` reçoit `:token` dans `params`, contrôle **avant** toute donnée/action ; `ok: false` bloque. `view` (montant affiché, état non créditeur) peut passer au handler. Le jeton **ne confirme ni ne crédite** le paiement. Crédit/stock : `signed` machine **ou** session — jamais l’admission seule.

Autorisation app minimale guest : entrée déclarée, tenant config, `admitGuest` ok, schéma/lecture bornée. Anti-abus : taille/timeout + politique app (honeypot, débit **si** l’app l’implémente). Origin/CORS/nonce/IP **≠** preuve. Zéro secret navigateur coffre.

**`bounded` kit** : hors v1. Un jeton guest **n’acquiert pas** d’autorité paiement.

| Couche | Kit (après acceptation) | App |
|---|---|---|
| Match, `readBytes`, fencing signed, GET sans JSON | oui | — |
| `verify` / jetons `/payer` / fiche POS | — | oui |
| Crédit / stock | — | hors admission |

| Étape | Dépend |
|---|---|
| `start` runtime | contrat **accepté** |
| `integrate` | CI du lot runtime |
| Exposition paiement | idempotence app **reçue** (K02 équivalent **prouvé** si crédit) |
| `publish` | **pas** C01 |
