# @creezio/sites-adapter

Profil asynchrone D1 de Creezio Lite. Ce package compose le kernel original et les modules nav/support/interactive-demo avec des dépôts D1 isolés par espace. Le kanban humain utilise un service D1 conforme au contrat de l’UI tasks.

`handleNativeApi(request, context)` renvoie `null` pour les routes hors de son périmètre. `context.identity` doit provenir du dispatcher Sites vérifié. Une identité fournie par le corps ou des headers publics n’est pas acceptable.

Les sources de chaque module restent dans leur package upstream. Les extensions de persistance sont optionnelles et conservent le chemin SQLite initial. Voir `docs/COMPATIBILITY.md` à la racine pour les limites ; aucun runner, authentification historique ou stockage SQLite n’est simulé.

Vérification : `node --test tests/native.test.mjs` depuis la racine avec les dépendances du template installées. La suite utilise D1 réel via Miniflare et teste aussi les accès refusés entre espaces.
