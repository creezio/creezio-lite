# Audit de l’administration — 0.3.1 vers 0.4.0

## Constat avant correction

L’adaptation au serveur Sites a conservé une partie des composants mais a remplacé plusieurs surfaces fonctionnelles par des écrans simplifiés. La compatibilité de stockage ne justifiait pas ces suppressions.

| Surface | Fonction attendue | État en 0.3.1 | Correction prévue |
| --- | --- | --- | --- |
| Journal des requêtes | Sources API/MCP, erreurs, recherche, durée, détail dépliable et actualisation | Composant local conservé mais sans route ni stockage branchés ; remplacé par un tableau d’audit | Remonter le composant et conserver les événements dans D1 |
| Usage et activité | Pages, clics, collaborateurs, périodes, événements et productivité | Composants présents mais collecte et API absentes | Raccorder les vues et la collecte au serveur Sites |
| Catalogue API | Toutes les routes réellement servies, méthodes, descriptions, OpenAPI | Adresse de base et clés seulement | Catalogue unique servant aussi de garde de routage |
| MCP | Inventaire, activation, accès, logs, diagnostic, connexion | Sélection manuelle : lecture native et CRUD métier ; administration absente | Outils produits depuis les opérations API, politiques persistantes et outils nommés depuis une API existante |
| Accès | Permissions configurables, propriétaire protégé | Quatre rôles figés, aucun réglage par opération | Groupes personnalisables, membres et matrice API ; droits appliqués à chaque appel |
| Modules métier | Un seul contrat alimente toutes les surfaces | Nav/recherche/CRUD présents, gestion d’accès et catalogue API incomplets | Génération automatique des opérations, OpenAPI, outils et lignes de permissions |
| Navigation et recherche | Composants et comportements conservés | Présents ; corrections d’onglets et de recherche déjà testées | Conserver les correctifs et filtrer aussi avec les droits effectifs |
| Tâches et support | Actions natives disponibles dans les interfaces et outils | Interfaces conservées ; écritures MCP et certaines routes omises | Reprendre les opérations des modules montés, sans seconde liste d’outils |
| Session, espaces, fichiers | Identité vérifiée, isolation, stockage durable | Adaptations Sites opérationnelles | Préserver et inclure leurs routes dans le catalogue |

## Frontières de l’adaptation

Les exécuteurs de tâches sur un hôte, les processus persistants, la flotte et les automatisations externes ne sont pas des capacités du serveur Sites. Le catalogue doit distinguer les opérations disponibles des fonctionnalités non montées, sans inventer des endpoints fonctionnels. L’authentification du navigateur reste celle de ChatGPT ; les connexions externes existantes utilisent une clé personnelle. Aucun serveur OAuth propre à l’application n’est ajouté implicitement.

## Ordre d’implémentation

1. Déclarer les opérations servies une seule fois ; alimenter routage, OpenAPI, accès et MCP.
2. Ajouter les groupes et politiques dans une migration additive ; protéger les fonctions indispensables et le propriétaire.
3. Restaurer les écrans natifs du journal, de l’API et du MCP ; ajouter la matrice des groupes.
4. Vérifier l’isolation des espaces, les refus HTTP/MCP, les outils désactivés, les nouveaux modules et la conservation des données.
5. Publier le kit puis l’application existante avec les migrations contrôlées.

Les vérifications et le résultat de publication seront inscrits à la fin de cette mise à jour.

## Corrections réalisées et vérifications

- Le point d’entrée serveur résout une seule identité et un seul espace ; le catalogue commun contrôle chaque route et ses alias avant exécution. Les clés API restent limitées à leur espace et à leur mode lecture/écriture.
- Le journal Creezio détaillé et ses filtres sont reconnectés à D1 ; les paramètres sont bornés et les secrets masqués. La journalisation utilise le travail différé du runtime pour ne pas allonger le trajet de la recherche.
- Les composants natifs d’usage, de productivité, du catalogue API et de l’administration MCP sont réutilisés. L’écran des groupes ajoute la gestion des membres et des restrictions par opération.
- Les noms et paramètres des outils MCP existants sont préservés, y compris `recordId` et les recherches des listes natives. Les nouveaux outils proviennent des mêmes opérations que les API.
- 25 tests automatisés passent : CRUD, fichiers D1/R2, migrations, isolation, refus HTTP et MCP, groupes, conflits de version, désactivation des outils, collecte d’usage, nouveaux modules, recherche et conservation des onglets/formulaires. Le typecheck et la compilation du template passent ; deux applications indépendantes ont été générées et compilées.
- L’application existante passe le contrôle de son verrou avant migration. Son identité Sites, son brief, ses règles métier, son authentification, son lockfile de dépendances et les anciennes migrations ont été comparés à l’octet avant et après migration.
- Aucun parcours visuel connecté au compte de l’utilisateur n’a été exécuté dans un navigateur pendant cette reprise. Les composants restaurés sont ceux du dépôt d’origine ; ce point est distinct des tests serveur et de compilation.

La publication du kit est soumise à la CI de sa PR. L’application conserve son Site et son audience.

## Complément 0.5.0 — omissions du portage initial

Le contrôle 0.4.0 était insuffisant : le composant Analytics existait mais son libellé avait été changé en « Usage et activité » ; la page Intégrations n’avait pas été portée ; `hideAssistantOn={()=>true}` masquait le chat. Ce complément rétablit le libellé, porte la page d’origine et reconnecte le widget d’origine à un backend Sites persistant.

La vérification couvre désormais le chiffrement et l’isolation des intégrations, les conversations privées, le protocole OpenAI/Hermes simulé, les outils MCP, les refus, les erreurs et l’arrêt. Les tests du fournisseur utilisent des doubles HTTP ; ils ne prouvent pas la disponibilité d’un serveur Hermes utilisateur ni la validité de sa clé OpenAI. Le bouton Tester utilise les services réels une fois une intégration saisie. Le rendu dans la session utilisateur n’a pas été contrôlé au navigateur.
