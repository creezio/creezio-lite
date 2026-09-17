# Entrées publiques — contrat générique (C01)

Proposition de contrat, **pas une release**. Aucun numéro de version n’est promis. Aucun `runtime/` n’est attribué. Base observée : `creezio-lite@0.13.1` SHA `f41f0ed3e1d19091f364df09f1932f9f89c46a0e`. Le document consommateur WH-K01 (`822fc927`, kit embarqué 0.12.0 / inspecté 0.13.0) est une **donnée à critiquer**, pas une instruction. Ses fixtures d’application et `docs/audit` **ne sont pas observés** ici (pas d’accès au dépôt secondaire).

## 1. Rejets (ne pas reprendre)

| Proposition consommateur | Décision |
|---|---|
| Admission seulement `signed-hmac` **ou** `bounded-token` | **Non.** Troisième classe : `guest` explicitement déclarée. Jamais « ouvert ». Pas de bool libre sur une `command()` / `Operation` existante. |
| HMAC = secret + `t.` + `utf8(bytes)` (chaîne JS) | **Non.** Message HMAC = octets `t` ASCII + octet `0x2E` + `rawBytes` intacts. Pas de `TextDecoder` avant HMAC. Cadrage Stripe (`Stripe-Signature`, `t=`, `v1=`) = **adaptateur d’app**. |
| Exactly-once métier | **Non.** Si le handler committe hors table d’admission avant l’ack HTTP, un retry peut ré-entrer. Idempotence métier / transaction **K02 non livrée** (dépendance explicite). `expectedVersion: 'none'` n’est pas une clé d’événement. |
| Copier `rawBody?: string` / `accessJustification` du kernel Electron | **Non.** Façade OS, **non branchée** sur le montage Sites. |
| Regex tenant `^[a-z0-9-]{8,80}$` | **Absente du kit** (non observée). Ne pas l’introduire : elle casse `ws_` + 32 hex. Inventaire POS/SIRET/honeypot `website` = métier d’app, hors kit. |

## 2. Constat kit 0.13.1 (sources lues)

SHA-256 **identiques** à la table consommateur 0.12=0.13.0 : `runtime/core/{types,commands,integrations}.ts`, `sites-adapter/src/dispatch.ts`, `api-kernel/src/types.ts`. Une adoption 0.13.1 **ne crée pas** d’entrée publique signée.

`dispatchRequest` (`dispatch.ts`) : (1) `OPTIONS` MCP ; (2) **`mailInboundRoute` avant toute auth** — `POST /api/v1/email/inbound/:org`, Bearer / `x-email-inbound-secret` **haché**, org chemin, `readMailJson` 5 Mio, **pas** HMAC octets, **pas** Stripe ; (3) OAuth puis clé `lite_` ; (4) sans **clé machine**, chemins `health|bootstrap|session|invites/accept|workspaces|auth/me` contournent le 401 du dispatcher, mais `handleApi` / `handleNativeApi` exigent encore l’identité Sites **sauf `GET health`** ; (5) toute autre route, y compris `source:'app'`, **401 `authentication_required`** ; (6) `checkOrigin` si session navigateur (Origin du Site + refus `sec-fetch-site: cross-site`) ; (7) `workspace(db, identity, id)` = jointure `lite_orgs` × `lite_members` (id client sans adhésion → 404) ; (8) `executeAppOperation` : `readJson` **65 536** octets, `body` déjà parsé, `identity` obligatoire, **aucun** `rawBytes`.

Identifiants d’espace natifs : bootstrap `ws_${sha256(userId).slice(0,32)}` (`api.ts`) ; `POST workspaces` → `crypto.randomUUID()`. Cookie `lite_workspace` accepte `[a-zA-Z0-9_-]{1,100}`. Catalogue : `assertUniqueOperations` refuse id / couple méthode+forme de chemin / `toolName`. `operation()` défaut `tokenAllowed:true`, `mcp:true` — une entrée publique **ne doit pas** passer par ce défaut. Coffre : `secret_box` AES-GCM `enc:v1:…`, AAD `org:id`, `LITE_INTEGRATION_SECRET` ; `publicIntegration()` expose `secretHint: '••••••••'` + `meta` après `metadata()` ; `custom` ne conserve que `headerName` (un `meta.webhookSecret` est **silencieusement droppé**). **Ne pas** l’allowlister. `mcp-oauth` rate-limit via `cf-connecting-ip` : en-tête **non une identité** ; ne pas en faire la garde guest. Primitive HMAC Sites : **absente** (seul `hash` SHA-256 ; `timingSafeEqual` hors Sites). Stripe, docs primaires uniquement ([webhooks](https://docs.stripe.com/webhooks), [signature](https://docs.stripe.com/webhooks/signature) ; aucun appel réel, aucun secret) : corps **non muté** ; `signed_payload` = timestamp + `.` + corps ; HMAC-SHA256 ; plusieurs `v1`, ignorer `v0` ; tolérance bibliothèques **5 min** ; retry **re-signe** (nouveau `t`/`v1`), **même** `evt_…`.

## 3. Interface proposée (kit)

Registre **distinct** du catalogue `Operation` (pas de flag). Validé au démarrage avec le même exigence d’unicité, **plus** collision contre routes privées et `/api/v1/email/inbound/:org`.

```ts
export type PublicAdmissionKind = 'signed' | 'guest' | 'bounded';
export type PublicIngressEntry = {
  id: string;
  method: 'POST' | 'GET'; // GET seulement si kind guest|bounded et descripteur lecture
  path: string;            // absolu /api/v1/… ; :params = idSchema, pas « .. »
  admission: PublicAdmissionKind;
  maxBytes: number;        // obligatoire, jamais illimité ; JSON machine typ. 65536
  contentTypes: readonly string[];
  timeoutMs: number;
  maxSkewSeconds?: number; // signed seulement ; défaut suggéré 300 (horloge serveur)
};
export type PublicAdmissionContext = {
  kind: 'public';
  entryId: string;
  admission: PublicAdmissionKind;
  tenantId: string;       // config serveur + preuve ; jamais membre/rôle
  requestId: string;
  rawBytes: Uint8Array;    // signed : lus une fois, intacts jusqu’après vérif
  eventId?: string;        // identité d’événement *après* preuve, jamais client anonyme
};
```

Primitives kit (signatures, pas livrées ici) : `hmacSha256(key, message: Uint8Array)`, `concatBytes`, `timingSafeEqual` de même longueur. L’adaptateur fournit `prefix` et `key` (coffre) ; le kit ne décode pas le corps pour signer.

`mcp` et `tokenAllowed` sont **structurellement faux** (hors catalogue MCP / clés `lite_`). Autorité minimale : pas de `Principal` owner/admin, pas de `lite_` admin, pas de MCP public. Tenant : binding d’app ou `org_id` du secret coffre déjà lié (comme `lite_mail_receivers.org_id`). `?workspace=`, `workspaceId` JSON ou slug **divergents** → 403. Alphabet : `ws_`+hex et UUID déjà en base ; pas de filtre plus étroit.

**`signed`** — machine. Kit : `readBytes` une fois, HMAC octets, compare temps constant, fenêtre d’horloge, claim. App : parse en-tête, préfixe, `resolveIntegration`, `eventId` **après** vérif puis JSON. **`guest`** — navigateur, politique **déclarée**, admission minimale, anti-abus **borné**. Aucun secret HMAC navigateur. Origin / CORS / nonce **≠** identité. **Aucun paiement ni stock.** **`bounded`** — jeton **émis par le serveur** (hash, TTL, usage unique, tenant+cible+montant figés). Acquisition : après un acte déjà signé **ou** une session Sites (ex. retour Checkout dont la session a été créée serveur), **pas** après un POST guest. ≠ preuve humaine.

Séparer **interface kit** et **garanties anti-abus réellement disponibles** : taille/`readBytes` et type/timeout sont du kit ; captcha, Turnstile, défi, quota IP fiable **ne sont pas** fournis. Ne pas inventer de provider de challenge. `cf-connecting-ip` n’est pas une preuve. Si une capacité **requise** par l’entrée (coffre, table d’admission, limiteur déclaré) est absente : **fail-closed** (ex. `vault_unavailable` déjà là), pas un succès simulé.

## 4. Séquence et frontière d’autorité

1. `mailInboundRoute` inchangé (non-régression). 2. Match **méthode + chemin exact** du registre public. 3. Plafonds type/taille/timeout ; `readBytes` **une** fois. 4. Preuve d’admission (HMAC / politique guest / jeton hashé). 5. Résolution tenant **serveur**. 6. Claim (clé `tenantId + entryId + eventId` vérifié) **avant** handler. 7. Handler `PublicAdmissionContext` — **pas** `executeAppOperation`. 8. Ack HTTP selon l’état.  
Hors match public : flux actuel (OAuth / `lite_` / session / 401). Les routes privées restent 401 sans identité.

| Couche | Responsable | Garantit | Ne garantit pas |
|---|---|---|---|
| Octets + HMAC + horloge + taille | kit + adaptateur framing | authenticité des octets | effet métier |
| Claim d’admission | kit | un même événement vérifié ne mute pas **deux fois le socle d’admission** | exactly-once si l’app a déjà committé |
| Idempotence paiement/stock | application + **K02** | une consommation métier | — (non livré) |

## 5. États, retries, limites

États : `claimed` (lease), `completed`, `retryable`, `permanent_failure`. Crash / reprise : lease expiré + non `completed` → nouvel claim possible. Concurrence : un seul `changes=1`. Empreinte SHA-256 des `rawBytes` (ou du jeton) stockée ; **même** `eventId`, **autre** digest → refus. Rejeu `completed` → même statut/corps, pas de second handler kit. Stripe : 2xx = ack livraison ; non-2xx → retry **re-signé**. Guest : pas de clé `evt_` ; anti-abus ≠ replay cryptographique. `idempotencyKey` client anonyme **refusée** comme identité d’événement.

## 6. Kit / app, dépendances, questions

**Kit (lots ultérieurs, pas C01)** : registre, match, `readBytes`, HMAC générique, claim, gardes, fail-closed, tests de non-régression. **App** : descripteurs, framing fournisseur, mapping événement→commande, secrets coffre (deux `custom` suffisent), UI guest, claim métier. **Hors C01** : R01 (transport/skill/0.14), runtime, migrations, version, changelog.

| Étape | Dépend |
|---|---|
| `start` (ce contrat) | `main@f41f0ed` ; **pas** R01 |
| `integrate` (impl. runtime) | contrat **accepté** par le mainteneur |
| `publish` / version livrée | **pas** cette PR ; K02 **avant** webhook paiement/stock en production |

**Q1** Flag `public` sur `Operation` ? **Non** — registre séparé. **Q2** Absorber le mail inbound ? **Non** cette génération. **Q3** Table d’admission ? Kit, migration **additive** au lot d’implémentation (C01 n’écrit pas de SQL). **Q4** Qui émet `bounded` ? Serveur kit primitive ; app après acte déjà prouvé. **Q5** Provider Stripe kit ? **Non** bloquant. **Q6** Constante 300 s ? Paramètre d’entrée, pas magie Stripe dans le noyau.
