# Application Lite sur GPT Sites

1. Lire `brand.json`, `lite.lock.json` et `.openai/hosting.json`. Ce projet est une application indépendante du kit.
2. Utiliser les compétences Sites pour configurer, construire et publier. Réutiliser son `project_id`, son audience et ses bindings ; ne jamais réinitialiser une application existante.
3. Déclarer un nouveau module métier dans `brand.json`. Le registre inscrit automatiquement sa navigation, son API, sa recherche et ses outils MCP. Les opérations passent par les mêmes validations serveur.
4. Préserver les composants et le thème dans `runtime/`. Modifier le métier dans `app/` et `app/business-rules.ts`. Une modification du runtime doit être portée dans le kit pour profiter aux prochaines applications.
5. Les données vivent dans D1, les fichiers dans R2. Ne pas remplacer les services persistants par des fixtures. Les migrations déjà appliquées sont immuables.
6. L’identité navigateur vient de `getChatGPTUser()`. Ne pas créer les routes réservées de connexion ChatGPT ni accepter une identité ou un rôle fournis par le navigateur.
7. Vérifier les permissions, l’espace, l’origine des mutations et les conflits de version côté serveur. Ne pas transmettre une clé API dans l’URL, les logs ou Git.
8. Conserver pnpm et le lockfile. Les imports `@lite/*` sont des sources locales, sans registre privé à installer.
9. Tester les parcours métier, la recherche, les accès refusés, le typecheck et le build avant publication. Vérifier le statut final de déploiement.
10. Le dépôt du kit est indiqué par `lite.lock.json.sourceRepository`. Suivre son guide de mise à jour ; ne pas copier une app dans le dépôt du kit.
