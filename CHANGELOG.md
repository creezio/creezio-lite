# Versions de Lite

## 0.10.2 — Migrations D1 locales fiables

- Le script local conserve les triggers SQL complets et applique chaque migration avec son marqueur dans une même transaction D1.
- Une migration échouée est annulée ; une migration déjà appliquée ne rejoue pas, y compris après redémarrage de la base locale persistée.
- Utilise Miniflare fourni par la version verrouillée de Wrangler ; aucune dépendance ou migration SQL nouvelle.
- Les applications existantes doivent intégrer explicitement `scripts/migrate-local.mjs`, hors du runtime mis à jour automatiquement.

## 0.10.1 — Publication et suivi des applications

- Release GitHub stable au SHA exact de main après CI réussie ; aucun déplacement de tag.
- Veille livrée avec les applications : une issue par version, sans secret inter-dépôts ni mise à jour aveugle.
- Responsable commun du kit, suivi distinct des tests, intégrations et déploiements applicatifs.
- Chargeur de tests natifs compatible avec les chemins Windows pour permettre la revue locale.

## 0.10.0 — Transports des agents

- Transports Cursor et xAI injectables, avec états et capacités explicites ; aucune activation d’agent ou dépense automatique.
- Validation fermée des requêtes, erreurs minimisées, expiration et annulation couvrant aussi la résolution des identifiants.
- Tests sur transports simulés et Worker ; pas de nouvelle table, migration, UI ou secret.
- Conserve le correctif de journaux 0.9.1. Les applications adoptent le runtime par l’upgrade vérifié.

## 0.9.1 — Journal des requêtes minimisé

- Journal limité aux métadonnées et codes d’erreur à vocabulaire fermé ; corps, paramètres et arguments exclus.
- Anciennes lignes projetées et recherchées uniquement après filtrage, sans exposition de leurs détails historiques.
- Identifiant de corrélation de requête et rétention bornée conservés ; aucune migration ni rotation de secret.
- Versions des diagnostics API et MCP alignées avec celle du kit.

## 0.9.0 — Pilotage fiable et chat mobile

- File de commandes D1 indépendante du SSE, connexion WebSocket et secours HTTP.
- Une fenêtre de travail active par utilisateur et espace, reprise explicite et chat mobile plein écran pilotant l’ordinateur.
- Traces persistantes du navigateur et sauvegarde progressive des tours IA.
- Vérification du transport sur le Worker compilé et du curseur natif.

## 0.8.1 — Validation du consentement OAuth

- Corrige la politique de référent de la seule page de consentement : les formulaires natifs transmettent l’origine du Site.
- Conserve les refus des origines absentes, nulles ou étrangères, le contrôle du nonce et les droits serveur.
- Aucun changement des données, des secrets, des migrations ni des autres pages.

## 0.8.0 — OAuth MCP

- Raccorde OAuth 2.1 au MCP existant : découverte publique, inscription des clients, PKCE S256, consentement via le compte Sites, renouvellement et révocation.
- Chaque connexion reste liée à un utilisateur, un espace et aux droits actuels ; les codes sont à usage unique et les jetons sont hachés dans D1.
- L’administration MCP affiche les connexions OAuth avec leur révocation ; les clés personnelles, le chat, Mail et le curseur natif sont conservés.
- Migration additive 0009 et nouvelles routes OAuth, sans nouveau secret d’environnement ni fournisseur d’identité.

## 0.7.0 — Curseur de l’assistant rétabli

- Relie OpenAI et Hermes aux actions UI natives : repérage, clic visible, saisie et défilement dans l’application.
- Conserve le curseur animé original et ses événements de clic ; le modèle attend le résultat du navigateur.
- Migration additive 0008 : relais D1 privé, réservation unique, expiration, arrêt et refus des réponses rejouées.
- Un résultat UI négatif apparaît en erreur ; les champs de secrets sont exclus et les saisies sont masquées dans les traces.

## 0.5.0 — Intégrations et assistant restaurés

- Restaure le chat flottant et son panneau natif : historique privé dans D1, flux de réponse, arrêt, actions et traces.
- Porte la page Intégrations d’origine : secrets AES-GCM, références, versions, activation et test ; profils OpenAI et Hermes configurables.
- Relie le chat aux API OpenAI et Hermes avec les outils issus du registre MCP, droits et désactivations revérifiés pendant chaque tour.
- Rétablit le nom Analytics dans le menu et la page. Ajoute la migration additive 0006 et la configuration serveur du coffre.
- Corrige l’adaptateur de test SQLite pour exécuter les batches atomiquement comme D1, y compris pendant un flux de réponse.


## 0.4.0

- Restauration des composants Creezio de journal des requêtes, statistiques d’usage, catalogue API et administration MCP, raccordés à D1.
- Catalogue unique des opérations réellement montées : routes natives et métier, alias, OpenAPI, outils MCP et matrice des accès.
- Groupes personnalisés, membres et restrictions par API, avec concurrence optimiste, isolation des espaces et propriétaire protégé.
- Activation/désactivation persistante des outils ; création d’outils nommés depuis une API ; exécution HTTP MCP et WebMCP soumise aux mêmes contrôles.
- Journal des requêtes conservé par espace (1 000 entrées) et collecte d’usage avec identité contrôlée côté serveur.
- Migration 0005 additive ; conservation des modules, de la recherche et du comportement des onglets.

## 0.3.1

- Réduction des échanges D1 d’une recherche sur un index prêt : 17 vers 3, sans écriture. Les réglages restent lus à chaque requête.
- Reprise de l’index par lots regroupés, limitée aux sources encore incomplètes. Une première recherche sur une petite base nécessite cinq échanges, sans série d’initialisations par source.
- Regroupement des résultats et du comptage dans une transaction de lecture, y compris dans les listes métier.
- Mesure du temps applicatif dans l’en-tête Server-Timing, sans texte recherché ni donnée personnelle.
- Test de performance structurelle sur D1 réel : limite des échanges, absence d’écriture à chaud, changements immédiats des champs, des données et réindexation.

## 0.3.0

- Socle autonome consacré à GPT Sites, avec sources locales, générateur et documentation propres.
- Recherche des données sur D1/FTS5, reprise des données existantes et indexation transactionnelle des écritures.
- Administration de la recherche par module et par champ, avec isolation par espace et permissions serveur.
- Registre commun pour les modules métier, leur navigation, leurs routes API et leurs outils MCP.
- Serveur MCP HTTP et clés personnelles avec expiration, droits limités et révocation.
- Ouverture des fiches depuis les résultats ; préservation du shell, du centrage de la recherche et de l’isolation des onglets.
- Migrations additives et procédure de mise à jour des applications existantes.

Les versions précédentes restent consultables dans l’historique Git.
