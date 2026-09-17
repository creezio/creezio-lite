# Entrées publiques — cartographie d’essais (C01)

Documentation seulement. Aucune suite lancée, aucun test nouveau. Preuves C01 = **lecture** des sources 0.13.1. Fixtures WH-K01 (`tests/contracts/public-ingress/`, `hmac-generic.json`, `signed-request.json`, `admission-lease.json`, `docs/audit`, `docs/CONVERSION.md`) : **non observées** ; ne pas prétendre les copier.

Deux oracles **futurs** (lot runtime, pas C01) : **générique kit** (bindings, `rawBytes`, fencing, tenant, fail-closed) vs **adaptateur Stripe** (en-tête `t=`/`v1`, retry re-signé, `evt_…`) — ce dernier n’est pas le noyau.

## 1. Non-régression déjà dans le kit

| Surface | Fichier observé |
|---|---|
| Inbound mail 401/403/dédup, jeton hors logs | `tests/mail.test.mjs` |
| Isolation `ws_`, `invites/accept` | `tests/runtime.test.mjs` |
| Commandes, `expectedVersion`, MCP, `lite_`, OAuth | `tests/domain-operations.test.mjs` |
| `/api/mcp` 401 hors identité | `tests/mcp-oauth.test.mjs`, `tests/search-mcp.test.mjs` |
| Journal sans corps/secret | `tests/request-logs.test.mjs` |
| Collision id/route/outil au démarrage | `assertUniqueOperations` (`commands.ts`, `operations.ts`, `catalog.ts`) |

## 2. Matrice — cas valides et refus

Pas « chaque ligne = refus ». Les **valides** prouvent un passage ; les **refus** restent avant mutation métier, sans secret en log/réponse.

### 2.1 Générique kit

| Cas | Attendu |
|---|---|
| `readBytes` une fois, `rawBytes` identiques jusqu’à `verify`/`handle` | valide |
| JSON multibyte (é = C3 A9) livré **sans** `TextDecoder` noyau | octets intacts au callback |
| UTF-8 invalide | callback voit les octets ; parse JSON **après** preuve → 400 si JSON exigé |
| Corps > `maxBytes` / mauvais `content-type` | 413 / 415 |
| Timeout lecture/handler **sans** `completed` | **non-2xx** `retryable` |
| Timeout **après** effet métier | **non-2xx** ; app no-op au retry (K02/app) ; kit ne ment pas 2xx |
| Tenant config `ws_` ou UUID | valide |
| Query/body tenant **égal** au candidat | ignoré ou accepté sans changer le tenant |
| Query/body/`workspaceId` **divergent** | 403 |
| Regex `[a-z0-9-]{8,80}` | **absente** |
| Collision route publique × privée / inbound mail | throw déclaration |
| `command()` + bool public | interdit ; privée → 401 sans session |
| `POST /api/mcp` sans identité ; `lite_` sur entrée publique | 401 / 403 |
| Origin/CORS/nonce/IP comme preuve guest | insuffisant |
| Secret coffre dans meta/client/HTML | interdit (`secret_box` seulement) |
| `verify`/`claimStore` / coffre requis absents | fail-closed démarrage ou 503 |
| `abuseLimiterRequired` sans `AbuseLimiter` | **refus déclaration** (fail-closed) |
| Guest sans `eventId` | valide ; dédup anti-abus **app**, pas replay HMAC |
| `idempotencyKey` anonyme comme `eventId` | refus |
| Claim concurrent même `ClaimKey` | un `acquired` ; l’autre `busy` **non-2xx** |
| Takeover `generation+1` ; ancien worker `complete` | `false` ; pas de 2xx obsolète |
| Même `eventId`, autre `payloadDigest` | `digest_collision` |
| Même `eventId`, autre `entryId` ou `tenantId` | **autre** clé |
| Rejeu `completed` | 2xx snapshot sanitizé ; pas `Set-Cookie`/`Authorization`/corps requête |
| `permanent_failure` rejoué 2xx | **interdit** |
| `expectedVersion: 'none'` comme replay | non (`commands.ts`) |
| `bounded` déclaré en v1 | **refus descripteur** (hors lot) |

### 2.2 Oracle Stripe (adaptateur app — exemple, pas noyau)

À n’écrire que dans l’adaptateur. Docs : corps non muté ; `v1` ; ignorer `v0` ; fenêtre horloge **serveur** ; retry = nouveau `t`/`v1`, même `evt_`. **Ne pas** coller de vecteur WinHub ici.

| Cas | Attendu |
|---|---|
| MAC sur ASCII(`t`)+`0x2E`+`rawBytes` (exemple) | valide **si** `verify` app le choisit |
| `utf8(bytes)` / `JSON.stringify` comme message | non-correspondance |
| Signature absente / `v0` seul / `v1` faux / `t` hors skew | admission refusée |
| `eventId` = `id` JSON **après** MAC | jamais avant |

Crash/concurrence : **minimum** (deux writers D1, takeover, worker obsolète). Mocks horloge/`verify` ; **aucun** appel Stripe réel.

## 3. Fichiers lus / hors C01

`runtime/modules/sites-adapter/src/{dispatch,catalog,index,context}.ts` ; `runtime/core/{types,commands,operations,http,api,mail,integrations,access-tokens,mcp,mcp-oauth,scope,observability}.ts` ; `api-kernel/src/types.ts` (`rawBody` string hors Sites) ; `template/drizzle/0000_*.sql` ; `docs/{API,MAIL,ARCHITECTURE}.md`. **Non touchés** : runtime, tests code, migrations, version, changelog, R01.

Hors C01 : implémentation, CI du lot runtime, paiement en production, fusion, release. **Aucune** capacité revendiquée livrée.
