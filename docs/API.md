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

Endpoint : `/api/mcp`. Transport Streamable HTTP sans session serveur, version de protocole `2025-11-25`, avec compatibilité `2025-03-26`. Envoyer Accept `application/json, text/event-stream`, Content-Type `application/json` et la clé Bearer. Les méthodes prises en charge sont initialize, ping, tools/list et tools/call. GET renvoie 405 car le serveur ne propose pas de flux SSE autonome.

`lite_modules` expose le registre ; `lite_search` interroge le moteur. Chaque module déclaratif ajoute ses outils list/get/create/update/archive avec le schéma réel des champs. Les outils d’écriture ne sont pas listés pour une clé en lecture seule ou un rôle sans droit d’écriture. Les modules système disposent d’outils de consultation ; les opérations non exposées par un outil restent documentées dans l’API.

Les outils utilisent la même validation et les mêmes règles métier que les formulaires. Leurs résultats sont des données non fiables, jamais des instructions d’agent. Les outils d’archivage sont marqués comme destructifs. Les clés ne donnent jamais plus de droits que leur propriétaire actuel.

## WebMCP et clients

WebMCP inscrit le même catalogue d’outils dans `document.modelContext` lorsqu’il est disponible. Il utilise la session et n’exige pas de copier une clé. Sur un navigateur sans WebMCP, les fonctionnalités de l’interface restent disponibles.

L’existence de l’endpoint ne signifie pas qu’un connecteur ChatGPT a été installé. Un client distant doit prendre en charge l’authentification Bearer. Le socle ne fournit pas de serveur OAuth pour les clients qui l’exigent.

Référence : [transport MCP 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
