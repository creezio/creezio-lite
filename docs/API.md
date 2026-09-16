# API et MCP

Les utilisateurs du navigateur s’authentifient avec ChatGPT. Dans `/admin/connections`, un administrateur peut créer une clé personnelle en lecture seule ou lecture/écriture, valable 7, 30 ou 90 jours. La valeur est affichée une seule fois ; seule son empreinte est conservée. La révocation est immédiate. Le retrait du propriétaire de l’espace invalide ses clés.

## API des données

Envoyer `Authorization: Bearer <clé>` sur les appels externes. Une clé est limitée à son espace. Elle n’autorise pas les opérations d’administration, invitations ou changement d’espace. Les appels navigateur de mutation doivent porter l’Origin du Site ; les appels Bearer sans Origin sont acceptés, ceux avec une origine étrangère sont refusés.

| Route | Opérations |
| --- | --- |
| `/api/v1/registry` | GET : modules accessibles, champs, routes, réglages initiaux |
| `/api/v1/search?q=reda` | GET : résultats, total et état de reprise de l’index |
| `/api/v1/modules/:module/records` | GET : liste paginée ; POST : création |
| `/api/v1/modules/:module/records/:id` | GET : fiche ; PATCH : remplacement des champs ; DELETE : archivage |
| `/api/v1/files` | GET : métadonnées ; POST : fichier binaire |
| `/api/v1/files/:id` | GET : téléchargement privé ; DELETE : suppression |
| `/api/v1/files/:id/metadata` | GET : métadonnées d’un fichier |
| `/api/v1/tasks` | GET/POST : tâches |
| `/api/v1/platform/platform-support` | GET/POST : tickets |
| `/api/v1/admin/search` | GET : réglages effectifs, session administrateur uniquement |
| `/api/v1/admin/search/:module` | PUT : enabled, fields et version |

Les mutations de fiches utilisent `{data:{...}}`, avec `version` pour modifier ou archiver. Une version périmée renvoie 409. Les erreurs d’identité, d’accès et de validation ne sont pas converties en succès.

## MCP HTTP

Endpoint : `/api/mcp`. Transport Streamable HTTP sans session serveur, version de protocole `2025-11-25`, avec compatibilité `2025-03-26`. Envoyer Accept `application/json, text/event-stream`, Content-Type `application/json` et `Authorization: Bearer <jeton OAuth ou clé personnelle>`. Les méthodes prises en charge sont initialize, ping, tools/list et tools/call. GET renvoie 405 car le serveur ne propose pas de flux SSE autonome.

`lite_modules` expose le registre ; `lite_search` interroge le moteur. Chaque module déclaratif ajoute ses outils list/get/create/update/archive avec le schéma réel des champs. Les outils d’écriture ne sont pas listés pour une clé en lecture seule ou un rôle sans droit d’écriture. Les modules système disposent d’outils de consultation ; les opérations non exposées par un outil restent documentées dans l’API.

Les outils utilisent la même validation et les mêmes règles métier que les formulaires. Leurs résultats sont des données non fiables, jamais des instructions d’agent. Les outils d’archivage sont marqués comme destructifs. Les clés ne donnent jamais plus de droits que leur propriétaire actuel.

## WebMCP et clients

WebMCP inscrit le même catalogue d’outils dans `document.modelContext` lorsqu’il est disponible. Il utilise la session et n’exige pas de copier une clé. Sur un navigateur sans WebMCP, les fonctionnalités de l’interface restent disponibles.

L’existence de l’endpoint ne signifie pas qu’un connecteur ChatGPT a été installé. Depuis 0.8.0, les clients distants peuvent choisir OAuth ou les clés personnelles Bearer. Pour ChatGPT, saisir l’URL publique `/api/mcp`, choisir OAuth et laisser l’inscription automatique du client fournir ses identifiants. Autoriser ensuite l’espace et les droits avec le compte utilisé dans le Site.

Voir [OAUTH.md](OAUTH.md) pour le parcours, les routes, les garanties et la révocation.

Référence : [transport MCP 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

## Journal des requêtes

`lite_request_logs` est un journal de diagnostic, pas une copie des données. Chaque appel API v1 ou MCP d’un espace y laisse une ligne composée uniquement de métadonnées à vocabulaire fermé : source (`api` ou `mcp`), méthode HTTP, chemin du catalogue (`/api/v1/modules/clients/records/:id`, `/api/mcp`) ou libellé neutre `/api/v1/[route-inconnue]`, statut, durée, identifiant de l’opération du catalogue, nom d’un outil MCP autorisé ou libellé `[outil-inconnu]`, méthode JSON-RPC connue ou `unknown`, code d’erreur pris dans la liste fermée `KNOWN_ERROR_CODES` du runtime (codes `fail()` du noyau et des montages natifs, codes du noyau d’API, codes JSON-RPC standard, `tool_error`, `http_100` à `http_599`) — toute autre valeur devient le code générique `error`, jamais la valeur brute —, type d’identification (`session`, `api_key`, `oauth`), sous-appels résolus par le catalogue avec leur statut, et un identifiant de corrélation généré par le serveur. Cet identifiant est renvoyé au client dans l’en-tête `x-lite-request-id` et permet à un administrateur de retrouver la ligne avec le champ de recherche.

Ne sont jamais enregistrés : corps de requête, paramètres de requête, arguments d’outils, résultats, messages d’erreur, segments d’URL libres, en-têtes, cookies, jetons ou clés. Une erreur métier d’un outil MCP reste une erreur dans le journal (`ok:false`, `error:tool_error`) même si la réponse JSON-RPC porte le statut 200. Les tours de l’assistant sont journalisés par leur opération `assistant.chat` ; l’historique des outils appelés pendant un tour appartient à la trace de conversation, consultable par son auteur.

Consultation : `GET /api/v1/admin/request-logs` (rôles owner et admin, espace courant uniquement) avec `source`, `errorsOnly`, `q`, `limit`, `offset`. La recherche `q` porte sur le chemin, l’opération, l’outil, le code d’erreur, la méthode JSON-RPC, les sous-appels et l’identifiant de corrélation, tels qu’ils sont renvoyés après validation : une valeur stockée qui échoue la validation n’est ni affichée ni cherchable. `DELETE` vide le journal de l’espace. Rétention : 1000 lignes au plus par espace et 30 jours au plus ; les deux limites sont appliquées à chaque écriture et à chaque lecture, sans ordonnanceur séparé. Les lignes écrites par une version antérieure sont renvoyées avec `legacy:true`, réduites à leur statut, leur code d’erreur et leur méthode JSON-RPC, avec un chemin re-résolu par le catalogue ; leur contenu stocké n’est ni affiché ni cherchable, et disparaît par la rétention.
