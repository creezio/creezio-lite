# Architecture

- `runtime/core` : validation des modules, CRUD D1, recherche FTS5, permissions, clés API et outils MCP.
- `runtime/modules` : composants du shell et modules système locaux (session, navigation, tâches, support, visites), plus leur adaptation au serveur Sites.
- `runtime/ui` : vues métier, administration de la recherche, connexions et WebMCP.
- `template` : application Vinext/React, identité du produit, routes, migrations et configuration Sites.
- `bin/lite.mjs` : création, ajout de module, doctor et upgrade contrôlé.

Le serveur reçoit une identité vérifiée par Sites pour les utilisateurs du navigateur. Pour l’API et MCP, une clé personnelle peut identifier son propriétaire et un espace précis. Une clé ne transporte pas de rôle figé : l’appartenance et les droits actuels restent contrôlés en base.

Chaque requête de données porte l’espace autorisé. Les lecteurs ne peuvent pas écrire ; les clés ne permettent pas l’administration des comptes ni la création d’autres clés. Les requêtes navigateur qui modifient les données vérifient leur origine.

D1 possède les enregistrements, l’audit, les réglages et l’index. R2 possède les octets des fichiers. Ces deux services ne partagent pas de transaction : les compensations et la révocation des métadonnées empêchent qu’un échec rende un fichier supprimé publiquement accessible.

Les onglets conservés figent séparément leur contexte de route. Les styles du shell possèdent la géométrie des composants ; une règle ciblée empêche le cumul des translations de la recherche avec Tailwind 4.

Les imports `@lite/*` désignent exclusivement des fichiers de ce dépôt. Les dépendances externes React, Vinext, Radix, Tailwind et autres bibliothèques UI sont figées par le lockfile du template. Les modules locaux ne requièrent ni registre npm privé ni publication séparée.
