# Application générée avec Creezio Lite

1. Lire `README.md`, `brand.json`, `creezio-lite.lock.json` et `.openai/hosting.json`. L'identité de l'app est indépendante de celle du kit.
2. Cette application utilise le socle Creezio Lite. Son guide : https://github.com/creezio/creezio-lite/blob/main/START-HERE.md.
3. Utiliser les compétences Sites installées pour configurer l'environnement, installer, construire, enregistrer et publier le projet existant. Préserver le lockfile et l'architecture. Ne pas lancer un second initializer sur le projet.
4. Modifier les fonctionnalités métier dans `brand.json`, `app`, les routes spécifiques et `db/schema.ts`. Les fichiers `creezio/` constituent un snapshot versionné : corriger le kit pour les changements génériques. Une modification locale du socle bloque son upgrade automatique.
5. Données persistantes dans D1 (`DB`), fichiers dans R2 (`BUCKET`). Générer les migrations via `db:generate`; ne pas modifier celles qui ont été appliquées.
6. Connexion via les helpers de `app/chatgpt-auth.ts`. L'app ne possède pas les routes réservées `/signin-with-chatgpt`, `/signout-with-chatgpt` et `/callback`. La simulation de connexion locale ne doit jamais entrer dans le bundle publié.
7. Vérifier les permissions et l'appartenance à l'espace côté serveur. Aucun client ne choisit son identité ou son rôle. Le CRUD générique ne garantit pas de règles entre plusieurs documents : ajouter une contrainte ou une transaction spécialisée quand nécessaire.
8. Préserver `.openai/hosting.json.project_id` lorsqu'il existe. Ne jamais reprendre le projet Sites d'une autre app. Garder les secrets dans les paramètres d'environnement Sites.
9. Tester les parcours métier, les cas d'accès refusé, le typecheck et le build avant publication. Vérifier le statut final Sites et remettre l'URL réellement déployée.
10. Ne pas écrire l'application dans le dépôt source `creezio/creezio-lite`. Utiliser le dépôt demandé par l'utilisateur et/ou le dépôt propre au projet Sites.
