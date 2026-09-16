# Maintenance du kit et mises à jour des applications

## Propriété et réception

Un responsable commun possède les revues, fusions et publications de ce dépôt. Chaque application conserve son propre pilote, son dépôt, son métier, ses données, ses tests et son Site. Les agents applicatifs remontent les correctifs réutilisables par PR ; les agents délégués ne fusionnent ni ne publient eux-mêmes.

Avant une mutation, réconcilier les PR, les commits, la CI et les runs déjà existants. Reprendre le même agent pour une correction ; ne pas lancer de doublon. Le responsable détient un verrou coopératif propre au dépôt, dont le chemin et le jeton sont enregistrés dans son registre privé. Aucun verrou ancien n'est volé automatiquement. Les fusions sont séquentielles et utilisent le SHA de tête attendu.

La réception examine le diff actuel, les dépendances et des preuves de régression pertinentes. Une CI verte ne remplace pas la revue. Le kit ne doit pas embarquer du métier spécifique à une seule application. Les modifications doivent conserver les contrats des autres consommateurs. Après changement de base, refaire les contrôles affectés.

Les missions de réalisation déléguées à Cursor suivent le standard `.cursor/skills/lite-orchestration/` (rôles, sélection du modèle choisie une fois à l’attribution et préflight, brief, checkpoints, réception, déduplication et réconciliation des lancements). Ce dossier est la seule source ; le responsable du kit le fait évoluer par PR et le distribue par version. Les orchestrateurs applicatifs l’adoptent par `lite adopt` et conservent leurs mandats.

## Publication

1. Préparer une PR avec version cohérente, changelog et instructions de migration. Maintenir package.json, package-lock.json, template/package.json, les versions API/MCP et les tests correspondants.
2. Relire et vérifier les tests du kit, check, typecheck/build, exemples et les parcours affectés. Fusionner après succès de la CI de la tête courante.
3. Le workflow `release.yml` attend la réussite du workflow `Lite` sur le commit exact de main. Il publie `vX.Y.Z`, son SHA et les notes de version. Une release ou un tag existants ne sont jamais déplacés. Un main plus récent rend la tentative précédente obsolète.
4. Vérifier la réussite réelle de la publication. Une fusion seule n'est pas une release ; une erreur de publication reste une prochaine action à traiter. Le déclenchement manuel reprend le même contrôle de CI et de version.

## Distribution et réception applicative

Chaque dépôt applicatif embarque `scripts/check-lite-update.mjs` et `.github/workflows/lite-update.yml`. Le générateur les copie automatiquement aux nouvelles applications. La veille consulte la dernière release stable, résout le tag en SHA exact et vérifie sa version dans package.json. Elle utilise uniquement le jeton GitHub Actions du dépôt applicatif, avec lecture des contenus et écriture des issues.

Une seule issue est créée par version, même après relance. Le responsable du kit déclenche le workflow à chaque release publiée ; il s’exécute aussi au changement du verrou et manuellement. Aucun schedule/cron n’est installé dans les applications. Les erreurs d'accès ou d'API échouent explicitement, sans annoncer une livraison réussie. La publication de release dans GitHub continue sans le PC ; la coordination et le déclenchement des notifications par une tâche locale nécessitent que son hôte soit disponible.

Le pilote applicatif reprend une PR existante ou en ouvre une depuis son main courant. Il lit la release et le guide au SHA annoncé, exécute doctor puis upgrade sans écriture, intègre les fichiers compatibles et fusionne explicitement les adaptations hors runtime. Il préserve données, migrations, identité Sites et secrets. Il relit, teste les régressions et les accès, vérifie CI et build, puis publie sur le Site existant dans son mandat. Il consigne version/commit, PR, résultats et déploiement avant de clôturer l'issue. La veille ne clôture jamais sur la seule présence d'une version dans le verrou.

Une notification n'autorise pas à ignorer un conflit ni à forcer une migration. Un report explicite reste visible dans l'issue. Les mises à jour déjà intégrées au dépôt mais non vérifiées en production restent à suivre.

## Registre privé et reprise

Le responsable conserve un registre privé : application, dépôt/source, Site, tâche propriétaire, version observée, version cible, issue/PR, état du déploiement et prochaine action. Ne pas mettre la liste des applications privées dans ce dépôt public.

Pour un Site sans dépôt GitHub applicatif, notifier sa tâche propriétaire et enregistrer le suivi dans ce registre. Une nouvelle application doit être inscrite au registre et recevoir la veille ; son absence de dépôt ou de pilote reste un écart explicite, pas un succès simulé.

Une routine du responsable reprend les PR, les releases et ce registre toutes les 30 minutes. Pendant un tour actif, elle enchaîne les actions disponibles sans attendre le prochain réveil. Elle signale uniquement les publications, intégrations, erreurs ou décisions nécessaires et reste silencieuse si rien ne change. Cette routine coordonne les tâches applicatives mais ne remplace pas leurs tests ni leurs mandats de publication.
