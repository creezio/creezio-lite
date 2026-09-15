# Compatibilité Creezio → Creezio Lite 0.1

Cette version est une cible web autonome, construite à partir des conventions Creezio et de fichiers identifiés dans UPSTREAM.json. Elle ne prétend pas faire fonctionner tous les packages du monorepo original.

| Domaine original | Livraison Lite |
|---|---|
| BrandSpec / factory | Brief JSON, validation et génération autonome ; nouveau format, pas d'import automatique de tout YAML historique |
| Shell UI | Thème original, registre de navigation et EntityHeader repris ; composition web sidebar/onglets/recherche reconstruite avec les primitives accessibles du starter Sites |
| API kernel | Préfixe `/api/v1`, modules métier et validation dans un backend Worker indépendant ; contrats propres à Lite, sans import du kernel Node complet ni compatibilité directe promise avec ses clients |
| Auth / access-control | Identité ChatGPT fournie par Sites, quatre rôles, espaces et invitations ; aucun mot de passe ou JWT Creezio historique migré |
| Platform-core / SQLite | Stockage D1 asynchrone ; les anciens drivers synchrones sont remplacés. Pas de migration automatique des fichiers SQLite existants |
| Isolation core/brand/plugin | Une base D1 par application, tables communes séparées des futures tables métier et filtrage par espace ; pas de bases physiques par plugin |
| Database / modules | CRUD déclaratif JSON, formulaires, filtres, pagination, contrôle de version et archivage ; tables/requêtes spécialisées possibles pour les règles relationnelles |
| Tasks / support | Créables comme modules de suivi ; pas de runner IA ni de système de tickets complet migré |
| Search | Recherche de sous-chaîne D1 déclarée `d1-contains` ; pas de Meilisearch, recherche floue ou indexation sémantique embarquée |
| Fichiers | R2 et métadonnées D1, limite 10 Mo par fichier, téléchargement privé à l'espace |
| Observability | Journal des écritures, identifiants de requêtes et healthcheck ; pas de console de flotte ni de logs système |
| MCP | Outils navigateur WebMCP pour les modules, lorsque le navigateur les supporte ; le serveur MCP distant/OAuth du kit n'est pas porté |
| Automations | Validation avant écriture et routes métier ; aucune file durable, relance planifiée ou garantie de travail après réponse incluse |
| Mails / integrations / Granola / Grokbot | Points d'extension HTTP possibles ; ces intégrations ne sont pas implémentées dans la livraison initiale |
| Onboarding / interactive-demo / landing | Pages métier à construire selon le brief ; les moteurs complets Creezio ne sont pas portés |
| Hermes / n8n | Exclus à la demande du propriétaire |
| Electron / browser-host / host-runtime / Docker / fleet | Exclus de cette cible d'hébergement |
| Plugins comme processus séparés | Exclus ; modules compilés et routes ajoutés à la construction de l'app |
| Propagation | Snapshot versionné avec empreintes, doctor, contrôle des modifications et upgrade explicite ; pas de publication npm de Lite réalisée |

Le kit est adapté aux applications de gestion. Un vrai registre de stock, un agenda avec exclusion des doubles réservations ou une comptabilité nécessite des tables, contraintes et transactions métier, au-delà des formulaires déclaratifs. La taille des données, le trafic et les quotas sont ceux du compte Sites utilisé ; ils ne sont pas illimités.

L'envoi d'e-mails, une recherche avancée, des calculs longs ou des tâches programmées peuvent être ajoutés via des services externes compatibles HTTP. Leur disponibilité, leur coût et leur configuration doivent être vérifiés au moment du besoin.
