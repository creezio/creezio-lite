# Entrées publiques — contrat générique (C01)

Proposition, **pas une release**, aucun runtime livré. **Provenance / base** kit `0.13.1` `f41f0ed3e1d19091f364df09f1932f9f89c46a0e` (`main`). WH-K01 = handoff. Fixtures d’app **non observées**.

## 1. Rejets

| Proposition | Décision |
|---|---|
| Admission = HMAC **ou** magasin `bounded` kit | **Non.** v1 = `signed` + `guest`. Pas de table/endpoint jetons kit. |
| Framing `ascii(t)\|\|0x2E\|\|rawBytes` **noyau** | **Non.** Exemple adaptateur Stripe. `verify` accepte **toute** signature machine valide (HMAC ou autre). |
| `utf8(bytes)` / re-JSON dans le MAC ; exactly-once | **Non.** |
| `resolveTenant(request)` ; inspecter le **corps** avant `verify` ; **decrypt après preuve** | **Non.** Séquence §4. Conflit JSON **après** `verify`+parse. |
| `handle` 2xx-only ; 2xx si fencing `false` | **Non.** Refus permanent. Worker obsolète / rejeu `completed` → **pas** `complete` sur ancien fence. |
| Algorithme limiteur kit / seau IP universel ; `abuse.policy` **seul** (option silencieuse) | **Non.** Politique app + callbacks. Si la politique **exige** une capacité, absence **ou** panne ⇒ refus déclaration/requête, **jamais** `handle`. |
| `/payer` confirme ou crédite | **Non.** Page **guest** assistée ; le jeton n’est pas une Identity. |
| Regex `^[a-z0-9-]{8,80}$` ; `rawBody` Electron ; bool `public` sur `command()` ; DLQ | **Non.** |

## 2. Constat 0.13.1

SHA identiques 0.12=0.13.0 : `runtime/core/{types,commands,integrations}.ts`, `sites-adapter/src/dispatch.ts`, `api-kernel/src/types.ts`. `dispatchRequest` : inbound mail **avant** auth (jeton haché, JSON 5 Mio, pas HMAC) ; sans clé, `health|bootstrap|session|invites/accept|workspaces|auth/me` passent le 401 dispatcher mais l’identité Sites reste exigée **sauf `GET health`** ; le reste **401** ; `checkOrigin` ; `workspace()` = adhésion ; `readJson` 65 536, pas de `rawBytes`. `ws_`+32 hex / UUID. `operation()` défaut `mcp`/`tokenAllowed` true. Coffre `secret_box`, AAD `org:id` ; `meta.webhookSecret` droppé. HMAC Sites absent. Stripe docs : corps non muté ; retry re-signe — **adaptateur**.

## 3. Bindings (v1)

Registre distinct de `Operation` ; unicité + collision privées / inbound mail. `mcp`/`tokenAllowed` faux. Callbacks **serveur**.

```ts
export type PublicAdmissionKind = 'signed' | 'guest';
export type CapabilityId = 'verify' | 'admitGuest' | 'claimStore' | 'vault' | 'limiter';
export type CapabilityProbe = { ready(): boolean; admit?(): Promise<'ok' | 'unavailable'> };
export type PublicIngressEntry = {
  id: string;
  method: 'POST' | 'GET';
  path: string; // /api/v1/… ; :params = idSchema
  admission: PublicAdmissionKind;
  tenantId: string; // config serveur uniquement
  maxBytes: number; // POST : plafond ; GET lecture : 0, pas de JSON exigé
  contentTypes: readonly string[]; // POST : p.ex. application/json ; GET : []
  timeoutMs: number;
  vaultRef?: { integrationId: string }; // signed : coffre ouvert après tenant, AVANT verify
  abuse: {
    policy: string;
    requires: readonly CapabilityId[]; // preuve de présence ; [] = rien au-delà du kind
  };
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
  secret?: string; // si vaultRef : déjà decrypté pour ce tenant ; jamais après preuve
};
export type ClaimKey = { tenantId: string; entryId: string; eventId: string };
export type ClaimFence = { key: ClaimKey; generation: number; token: string };
export type SanitizedSnapshot =
  | { ok: true; status: 200 | 201 | 202; body: unknown }
  | { ok: false; status: 400 | 403 | 404 | 409 | 410 | 413 | 415 | 422 | 429 | 503; body: unknown };
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
  verify?(input: VerifyInput): Promise<{ ok: true; eventId: string } | { ok: false }>; // OBLIGATOIRE dès ≥1 signed
  admitGuest?(input: {
    entry: PublicIngressEntry;
    tenantId: string;
    params: RouteParams;
    meta: BoundedMeta;
    rawBytes: Uint8Array; // déjà lus ; GET souvent vide ; pas de second reader
  }): Promise<{ ok: true; admission: GuestAdmission } | { ok: false }>; // exigé si une entrée guest
  handle(ctx: PublicAdmissionContext): Promise<HandleResult>;
  claimStore?: ClaimStore; // OBLIGATOIRE si ≥1 signed (comme verify) ; jamais pour guest
  limiter?: CapabilityProbe; // si 'limiter' ∈ abuse.requires
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

Dépendances **requises** = callbacks du kind **plus** `abuse.requires`. **Dès ≥1 entrée `signed` : `verify` et `claimStore` obligatoires** — rejet de **déclaration** si l’un manque (même règle pour les deux). Guest : **pas** de `claimStore`. Absence au démarrage ⇒ rejet déclaration. **En exécution**, dépendance indisponible (`ready()===false`, `unavailable`, throw, coffre) ⇒ **503 fail-closed avant `handle`**. Jamais **200** `signed` sans persistance CAS réussie. Pas d’algorithme de limite ni IP universelle. `signed` : HMAC **ou** autre signature machine. **Exemple Stripe (app)** : `t`/`v1`, ASCII(`t`)+`0x2E`+`rawBytes`. Guest : `admitGuest` `ok: false` ou panne ⇒ pas de `handle`. Jeton de chemin ≠ Identity / `eventId`. `claimStore` abstrait. D1 additif = candidat runtime après inventaire ; pas de numéro réservé. Lease/essais = config serveur.

## 4. Tenant et séquence unique

`resolveTenant(entry)` → `entry.tenantId` (`ws_` / UUID en base). **Pas** de `Request`. Corps **jamais** ouvert pour un tenant client (pas de mutation `rawBytes`). `?workspace=` ignoré.

Ordre **unique**, signed comme guest :

1. Tenant = **config**. 2. Si `vaultRef` / `vault` requis : decrypt `secret_box` AAD `org:id` = candidat — **avant** toute preuve. 3. `verify` (signed) ou `admitGuest` (guest) sur octets **intacts** (secret déjà disponible si besoin de la preuve). 4. Parse app **éventuel** ; champ JSON ≠ tenant ⇒ refus app.

Jamais de preuve **avant** le secret exigé par cette preuve. Tenant final = candidat.

## 5. Claim signed, fencing, snapshot

**Guest : aucune persistance `ClaimStore`**, même si le type TS porte `?`. `claim` / `complete` / `completed` / `claimStore.retry` = **signed uniquement**.

Clé signed : `tenantId + entryId + eventId` + `payloadDigest` ; collision digest refusée. Mutations : CAS atomique `WHERE key=? AND token=? AND generation=? AND state='processing'`. Takeover : `generation+1`. `false` ⇒ **pas de 2xx**. Rejeu `completed` : renvoyer le snapshot, **ne pas** rappeler `complete` sur l’ancien fence. `claim` → `permanent_failure` / `attempts_exhausted` → **non-2xx**, pas de handler succès. **Aucun 200 signed** si `complete(fence)` n’est pas `true`.

Le **timeout n’annule pas** les effets déjà commis ; l’**idempotence app est toujours requise** (K02 équivalent si crédit). Pas d’exactly-once kit.

| État signed | Snapshot | HTTP |
|---|---|---|
| `processing` / `busy` / `retryable` / `attempts_exhausted` | aucun succès | **non-2xx** |
| `completed` | `{ok:true, status:200\|201\|202}` | 2xx **seulement** persist CAS vrai à l’écriture initiale |
| `permanent_failure` | `{ok:false, status:4xx}` | 4xx ; **jamais** promu `completed` |

`handle` **signed** : `success` → `complete(fence)` ; `retry` → `claimStore.retry(fence)` ; `permanent` → `failPermanent`. `handle` **guest** : `success` → 2xx **sans** claim ; `retry` → **non-2xx** (client peut réessayer), **aucun** `claimStore` ; `permanent` → 4xx, **aucun** fence. Snapshot : pas cookie / `Authorization` / secret / corps requête / jeton / PII.

Séquence : inbound mail → match → GET sans JSON/corps ; POST : type/taille/`readBytes` → **tenant config** → **vault si requis** → preuve (`verify`/`admitGuest`) → signed : `claim` puis `handle` puis persist CAS ; guest : `handle` **sans** claim → HTTP. Privées : 401. Dépendance manquante en vol → **503**, pas de `handle`.

## 6. Guest, `/payer`, kit / app

**Cas pilote (page, pas magasin kit).** `/payer/[token]` = page publique de **commande assistée**. Jeton **opaque**, émis **serveur par le staff**, haché, borné tenant+commande+TTL, **stocké par l’app**. Le kit **ne livre pas** ce magasin. `admitGuest` reçoit `:token` dans `params`, contrôle **avant** toute donnée/action ; `ok: false` bloque. `view` (montant affiché, état non créditeur) peut passer au handler. Le jeton **ne confirme ni ne crédite** le paiement. Crédit/stock : `signed` machine **ou** session — jamais l’admission seule.

Autorisation guest minimale : entrée déclarée, tenant config, `admitGuest` présent et `ok`, schéma/lecture bornée. Anti-abus : taille/timeout + `abuse.policy` ; si `requires` contient `limiter` (ou autre), binding `ready` **prouvé** au démarrage et à la requête. Origin/CORS/nonce/IP **≠** preuve. Zéro secret coffre navigateur.

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
