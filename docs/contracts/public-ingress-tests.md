# Entrées publiques — cartographie d’essais (C01)

Lot **documentation**. Aucun test nouveau, aucune suite coûteuse, aucun `runtime/` modifié. Preuves = lecture des sources 0.13.1 ci-dessous. Les fixtures consommateur (`tests/contracts/public-ingress/`, `docs/audit/2026-09-17.md`, `docs/CONVERSION.md` WinHub) **ne sont pas observées** ; ne pas les supposer.

## 1. Non-régression déjà couverte (à conserver)

| Surface | Fichier observé | Fait |
|---|---|---|
| Inbound mail, 401 sans jeton, 403 domaine, dédup `external_key`, jeton absent des logs | `tests/mail.test.mjs` | Exception actuelle ≠ HMAC Stripe |
| Isolation espaces, invitation `invites/accept`, bootstrap `ws_` | `tests/runtime.test.mjs` | Pas d’espace sans adhésion |
| Commandes, `expectedVersion`, MCP, clé `lite_`, OAuth, `token_workspace` | `tests/domain-operations.test.mjs` | Identité obligatoire aujourd’hui |
| MCP / OAuth, 401 hors session | `tests/mcp-oauth.test.mjs`, `tests/search-mcp.test.mjs` | `/api/mcp` n’est pas public |
| Journal sans corps / secrets | `tests/request-logs.test.mjs`, mail inbound | Coffre et jetons hors logs |
| Unicité id/route/outil | `defineExtensions` / `assertUniqueOperations` (`commands.ts`, `operations.ts`, `catalog.ts`) | Collision au **démarrage** |

C01 n’exécute pas ces suites pour « prouver » une capacité nouvelle.

## 2. Matrice négative (lot d’implémentation ultérieur)

Chaque ligne = refus **avant** mutation métier, sans secret en réponse/log.

| Cas | Attendu | Note |
|---|---|---|
| JSON multibyte (é, C3 A9) HMAC sur octets bruts | vérif OK si signature sur ces octets | Interdit : décoder puis HMAC la chaîne JS |
| UTF-8 invalide dans le corps | HMAC si calculé sur les octets ; JSON ensuite **refusé** (`fatal` / 400) | `readJson` actuel décode non-fatal + plafond 64 KiB — **ne pas** l’utiliser avant HMAC |
| Re-sérialisation `JSON.stringify` comme message HMAC | refus / non-correspondance | Docs Stripe : corps **non muté** |
| Signature absente, `v0` seul, `v1` ne matchant pas | 401/400 admission | Ignorer schémas ≠ `v1` (doc Stripe) |
| `t=` hors `maxSkewSeconds` (horloge **serveur**) | refus fraîcheur | Retry Stripe = **nouveau** `t`/`v1`, même `evt_` |
| `Content-Length` / corps > `maxBytes` | 413 `payload_too_large` | Réutiliser `readBytes` |
| Type hors `contentTypes` | 415 | Ne pas parser JSON d’abord |
| Timeout handler / lecture | 504/408 fail-closed | Pas de hang illimité |
| `?workspace=` / `workspaceId` ≠ tenant serveur | 403 | Y compris UUID/`ws_` **d’un autre** org |
| Tenant libre, slug, regex `[a-z0-9-]{8,80}` | **ne pas** l’ajouter ; `ws_` reste admissible comme id **déjà** en base | Client ne choisit pas le vendeur |
| Collision route publique × privée / mail inbound / alias | throw déclaration (`OperationCatalogError` ou équivalent public) | Même exigence que `assertUniqueOperations` |
| `command()` existante + bool public | **interdit** | Reste 401 sans session |
| Session ChatGPT sur route privée | inchangé 401 sans identité | Non-régression `dispatchRequest` après OAuth/clé |
| `POST /api/mcp` sans identité | 401 | Pas d’outil public |
| Clé `lite_` sur entrée publique | 403 `token_scope` / non match public→privé | `tokenAllowed` structurellement faux |
| Origin / CORS / nonce comme « identité » guest | **insuffisant** | `checkOrigin` ≠ preuve humaine |
| HMAC secret dans le navigateur guest | **interdit** | |
| Guest crédit / stock / confirm-payment | **interdit** | `signed` ou `bounded` seulement |
| `bounded` sans acquisition serveur documentée | refuser le descripteur | ≠ captcha, ≠ guest |
| Concurrence deux POST même `eventId` | un claim ; l’autre replay ou 409 lease | Pas de moteur transactionnel |
| Crash après commit métier, avant ack | retry possible | **Pas** exactly-once ; K02 |
| Même `eventId`, digest différent | refus collision | |
| `expectedVersion: 'none'` comme replay | **non** | Défaut `command()` si `target==='module'` (`commands.ts` L43–46) |
| Secret dans `meta` / client / log / URL | **non** | Coffre `secret_box` uniquement |
| Coffre / table claim absents alors que requis | fail-closed | Pas de succès simulé |
| Limite sur `cf-connecting-ip` comme anti-abus guest | **non** comme preuve | En-tête non fiable hors bordure |

Tests crash/concurrence : **minimum utile** (deux writers D1 + lease expiré + reprise), pas un framework. Mocks HMAC / horloge ; **aucun** appel Stripe réel ; secrets fictifs.

## 3. Fichiers kit exacts (lecture C01)

`runtime/modules/sites-adapter/src/{dispatch,catalog,index,context}.ts` ; `runtime/core/{types,commands,operations,http,api,mail,integrations,access-tokens,mcp,mcp-oauth,scope,observability}.ts` ; `runtime/modules/api-kernel/src/types.ts` (façade `rawBody` string — **hors** Sites) ; `template/drizzle/0000_*.sql` (`lite_orgs.id` texte) ; `docs/{API,MAIL,ARCHITECTURE}.md`. **Non touchés** : runtime, tests, migrations, version, changelog, skill/transport R01.

## 4. Hors observation / hors C01

Dépôt applicatif, fixtures WH-K01, parcours Site authentifié, implémentation, migration claim, version kit, fusion, release, déploiement. Ce document ne revendique **aucune** capacité livrée.
