# Mises à jour

Chaque application possède son runtime versionné, son brief, ses migrations, ses données et son identité Sites. Une évolution du kit ne modifie pas automatiquement une application déjà publiée.

1. Choisir un commit du kit et lire son changelog.
2. Vérifier que le projet applicatif est sauvegardé dans Git et que son `project_id` est celui du Site à modifier.
3. Lancer `node bin/lite.mjs upgrade --app /chemin/app` pour obtenir le rapport sans écriture.
4. Utiliser `--apply` lorsque le schéma est compatible et qu’aucun fichier du runtime n’a été modifié localement. Une sauvegarde est conservée dans `.lite-backups/`.
5. Fusionner explicitement les éventuelles évolutions de `app/`, `build/`, des dépendances et des autres fichiers du template. L’upgrade du runtime ne les remplace pas.
6. Vérifier, construire et publier sur le même Site.

Un schéma différent ou un runtime modifié bloque l’upgrade. Analyser la différence ; ne pas falsifier les empreintes pour masquer un conflit.

## Migration d’une application 0.2 vers 0.3

Cette version change la structure du runtime et ajoute trois migrations. Elle exige une migration applicative explicite : conserver `brand.json`, les règles métier, `.openai/hosting.json`, les données et les migrations 0000/0001 avec leurs métadonnées ; ajouter 0002/0003/0004 et leurs nouvelles entrées de journal ; intégrer les nouveaux fichiers du template et le runtime autonome ; produire le verrou 0.3 après contrôle des sources. Ne jamais rejouer une création d’app sur le projet existant.

Les cookies d’espace précédents sont reconnus puis contrôlés par les règles d’appartenance. Le chargement des onglets peut reprendre un état existant de même format. Aucun enregistrement métier n’est supprimé par ces migrations. L’index reprend les données existantes par lots à la première recherche.

## Migration 0.3.1 vers 0.4.0

Fusion applicative explicite nécessaire : préserver le brief, les règles métier, les bindings, l’identité Sites et les migrations 0000 à 0004 à l’octet. Ajouter 0005_admin_operations.sql, son snapshot et l’entrée de journal. Intégrer les nouveaux fichiers du runtime, les pages admin, le provider d’usage et l’alias TypeScript `@lite/core/*`. Régénérer le verrou depuis ces sources après vérification. La migration ajoute les groupes, politiques, journal des requêtes et événements d’usage ; elle ne réécrit aucune donnée métier.
