# Connexion OAuth du MCP

Depuis Lite 0.8.0, `/api/mcp` accepte OAuth 2.1 et les clés personnelles déjà disponibles. Il continue à exposer le même registre d’opérations, les mêmes validations et les mêmes règles métier que l’application. Aucun serveur local ou dépendance au dépôt Creezio original n’est nécessaire.

Dans ChatGPT, ajouter l’URL publique complète du MCP, choisir OAuth et laisser les identifiants client vides pour l’inscription automatique. Le client ouvre l’autorisation ; l’utilisateur se connecte avec son compte Sites existant, choisit l’espace, puis accepte la lecture seule ou la lecture et écriture. L’administration **MCP → Accès/clients** affiche les connexions accordées et permet de les révoquer. Un administrateur ne peut pas révoquer la connexion du propriétaire.

La connexion ChatGPT du navigateur reste gérée par Sites. Les chemins réservés `/signin-with-chatgpt`, `/signout-with-chatgpt` et `/callback` ne sont pas redéfinis. Un compte sans appartenance à un espace ne reçoit aucun accès par OAuth. Le nom du client enregistré est une déclaration du client ; l’écran affiche aussi le domaine de retour et demande un consentement à chaque autorisation.

| Route | Fonction |
| --- | --- |
| `/.well-known/oauth-protected-resource` et `/.well-known/oauth-protected-resource/api/mcp` | Ressource canonique, serveur d’autorisation, portées |
| `/.well-known/oauth-authorization-server` et `/.well-known/oauth-authorization-server/api/mcp` | Découverte OAuth, PKCE, inscription, révocation |
| `/oauth/register` | Inscription persistante du client (DCR) |
| `/oauth/authorize` | Validation de la demande et ouverture du consentement |
| `/oauth/consent` | Compte Sites, espace et droits accordés |
| `/oauth/decision` | Décision explicite avec origine et nonce contrôlés |
| `/oauth/token` | Échange du code et renouvellement |
| `/oauth/revoke` | Révocation par le client OAuth |

Les clients publics (`none`), `client_secret_post` et `client_secret_basic` sont pris en charge. Les secrets DCR n’expirent pas implicitement après la première connexion. Les métadonnées n’annoncent pas CIMD, OIDC ou un flux non implémenté. L’émetteur correspond à l’origine servie par Sites ; la ressource est exactement cette origine suivie de `/api/mcp`. Toutes les réponses d’autorisation vers une adresse validée, y compris les refus, incluent `iss` et préservent `state`.

PKCE S256 est obligatoire. Le code expire après dix minutes et son utilisation est atomique. Il est lié au client, à l’adresse de retour exacte, à la ressource et au vérificateur. Les portées `crm:read` et `crm:write` reprennent le contrat Creezio ; l’écriture requiert aussi la lecture. L’utilisateur peut réduire les droits demandés, jamais les augmenter. Le rôle viewer ne peut pas accorder l’écriture.

Les jetons d’accès opaques durent une heure. Le renouvellement est limité à trente jours après le consentement, avec rotation atomique ; le rejeu d’un ancien jeton révoque toute sa connexion. Le client doit sérialiser les renouvellements. Les codes, secrets, jetons et nonces sont stockés par empreinte SHA-256. Ils ne passent pas dans le journal des requêtes API/MCP. L’inscription et les demandes de jetons sont limitées par compteurs D1, sans conserver les adresses IP brutes.

Chaque appel MCP vérifie la ressource, l’expiration, la révocation, l’utilisateur, son appartenance actuelle, ses politiques et les interrupteurs d’outils. Un jeton OAuth MCP n’ouvre pas les routes administrateur ni les intégrations contenant des secrets. Les données métier et les anciennes clés ne sont pas modifiées par la migration 0009.

Contrats de référence : [authentification MCP dans ChatGPT](https://developers.openai.com/plugins/build/auth) et [autorisation MCP 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).
