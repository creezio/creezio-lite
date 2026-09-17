# Entrées publiques — cartographie d’essais (C01)

Doc seulement. Fixtures WH-K01 **non observées**. Oracles futurs : **kit générique** vs **adaptateur Stripe** (pas le noyau).

## 1. Non-régression observée

| Surface | Fichier |
|---|---|
| Inbound mail 401/403/dédup, jeton hors logs | `tests/mail.test.mjs` |
| `ws_`, `invites/accept` | `tests/runtime.test.mjs` |
| Commandes, MCP, `lite_`, OAuth | `tests/domain-operations.test.mjs` |
| `/api/mcp` 401 | `tests/mcp-oauth.test.mjs`, `tests/search-mcp.test.mjs` |
| Journal sans secret | `tests/request-logs.test.mjs` |
| Collision catalogue | `assertUniqueOperations` |

## 2. Matrice (valides et refus)

### 2.1 Kit générique

| Cas | Attendu |
|---|---|
| `rawBytes` une lecture jusqu’à `verify`/`admitGuest`/`handle` | valide |
| GET guest **sans** `Content-Type` ni corps | **pas** 415 ; `rawBytes` vide |
| GET avec corps JSON | refus (lecture) |
| POST sans JSON / > `maxBytes` | 415 / 413 |
| Multibyte / UTF-8 invalide livrés intacts | parse JSON **après** preuve seulement |
| Tenant = config `ws_` / UUID ; `resolveTenant` sans `Request` | valide |
| Corps `workspaceId` lu **avant** `verify` | **interdit** (mutation) |
| Champ tenant JSON **après** parse ≠ config | refus **app** |
| `?workspace=` n’altère pas le tenant | valide |
| Collision route / `command()` publique / MCP / `lite_` | throw / 401 / 403 |
| `admitGuest` absent **ou** panne (`unavailable`/throw) | fail-closed / refus ; **pas** de `handle` |
| `limiter` (ou autre) ∈ `requires`, binding absent / `ready()===false` | **refus déclaration** |
| `limiter.admit()` panne en requête | refus ; **pas** de `handle` |
| Guest **sans** `ClaimStore` | valide (aucune persistance kit) |
| `claim`/`complete` invoqués pour guest | **interdit** |
| Decrypt coffre **après** `verify` | **interdit** |
| Tenant config → vault → `verify` → parse | **seule** séquence |
| Rejeu `completed` rappelle `complete` (ancien fence) | **interdit** ; renvoyer snapshot |
| CAS `key+token+generation+state=processing` faux | pas de 2xx |
| Snapshot `{ok:true}` en `permanent_failure` / `{ok:false}` en `completed` | **interdit** |
| Timeout après effet métier | effets **non** annulés ; idempotence **app** requise |
| `params.token` transmis ; clair absent logs/snapshot | valide |
| `view` borné au handler (ids, montant affiché) | valide |
| `/payer` admission **crédite** / confirme paiement | **interdit** |
| Origin/CORS/IP comme preuve ; texte `policy` sans `requires` honorés | insuffisant ; capacités **prouvées** |
| `verify` non-HMAC (MAC machine callback) | valide si `ok` |
| `verify` HMAC-only imposé noyau | **interdit** |
| `claim` → `busy` / `attempts_exhausted` / `permanent_failure` | **non-2xx** ; pas de succès handler |
| Concurrent `ClaimKey` | un `acquired` ; l’autre `busy` |
| Takeover ; `complete(fence)` `false` | **pas** de 2xx obsolète |
| `failPermanent`/`retry`/`renew` **sans** `fence.key` | **interdit** |
| `handle` `permanent` | `failPermanent` ; 4xx ; pas `completed` |
| Digest collision / autre route ou tenant | collision / autre clé |
| Rejeu `completed` sanitizé | pas cookie/auth/jeton/PII ; **pas** `complete` |
| Coffre / `claimStore` **signed** absent | fail-closed ou 503 |
| Magasin jetons `bounded` kit / descripteur `bounded` v1 | **refus** |
| `expectedVersion: 'none'` = replay | non |

### 2.2 Oracle Stripe (adaptateur)

Docs officielles. Pas de vecteur WinHub ici. MAC exemple ASCII(`t`)+`0x2E`+`rawBytes` **si** `verify` le choisit ; `utf8(bytes)` / `stringify` → échec ; `v0` / skew / signature absente → refus ; `evt_` **après** MAC.

Crash : deux writers, takeover, `complete` faux. Mocks ; **aucun** appel Stripe.

## 3. Fichiers lus / hors C01

`sites-adapter/src/{dispatch,catalog,index,context}.ts` ; `runtime/core/{types,commands,operations,http,api,mail,integrations,access-tokens,mcp,mcp-oauth,scope,observability}.ts` ; `api-kernel/src/types.ts` ; `template/drizzle/0000_*.sql` ; `docs/{API,MAIL,ARCHITECTURE}.md`. **Non touchés** : runtime, tests, migrations, version, R01.

Aucune capacité runtime livrée. Revue indépendante ; fusion/PR = mainteneur.
