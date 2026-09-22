# Contrat de module Lite — restauration de parité

Adaptation du contrat `packages/app-runtime/src/module-contract.ts` de Creezio. Les handlers sont côté serveur, la déclaration sérialisable des champs est partagée par le formulaire, la validation et HTTP/MCP.

`createBrandModuleRegistry(app, modules)` exige un propriétaire pour chaque entité déclarée. Un module peut posséder plusieurs entités. Les doublons, schémas divergents, opérations d’un autre module et migrations attribuées à une table étrangère sont refusés. `defineExtensions` collecte les opérations avant les contrôles de collisions et d’accès existants.

Le dossier `app/modules/<id>/` contient schema.json canonique, contrat, PRD, interview, recette et changelog. Les schémas importés par appDefinition sont ces fichiers ; brand.json est un instantané de compatibilité, régénéré par `npm run sync:module-schemas` et contrôlé avant build. `lite module` crée cette unité ; un registre personnalisé exige une fusion explicite. `scripts/check-module-contracts.mjs` s’exécute avant typecheck et build, vérifie les contributions, les documents et les migrations déclarées. Les recettes métier et navigateur restent à écrire et à exécuter ; ce contrôle structurel ne les remplace pas.

## Écriture et lecture

Le `beforeWrite` global vérifie les règles transversales **avant** le `beforeWrite` du module. Les hooks `beforeCreate`, `beforeUpdate`, `beforeArchive`, `afterRead` et `afterList` sont rattachés à l’entité. Les projections de lecture restent hors stockage et ne changent ni identifiants ni versions. Les lectures ont déjà passé les filtres d’espace et de droits. Les changements produits par beforeCreate/beforeUpdate sont revalidés avant la transaction.

Le portage ne déplace pas les données existantes. L’adaptateur d’entité disponible reste `records` ; les opérations D1 spécifiques conservent leurs transactions, contraintes et contrôles métier. Déclarer des tables ne constitue ni un bac à sable SQL ni un adaptateur relationnel universel. Les hooks d’effets après transaction et la validation complète des écritures spécifiques restent à compléter.

## Contributions reprises

- Démonstrations : collecteur Creezio réutilisé et défauts servis par le lecteur existant, avec overrides D1.
- Assistant : contextes de module filtrés par accès ; descripteurs d’entités et d’outils conservés dans le contrat. L’exécution reste dans le catalogue autorisé. Les projections de sources d’entités restent à raccorder.
- Onboarding : composition et fusion historiques, composant Wizard repris, contenu par espace et progression par utilisateur dans D1. Une sauvegarde échouée affiche son erreur sans avancer.
- Migrations : fichiers SQL additifs détenus par le module ; le runner D1 reste la seule autorité d’application. Les anciennes migrations ne sont jamais renumérotées.

## Adoption

Fusionner explicitement app/modules, app/app-extensions, les entrées HTTP/MCP/Worker et le schéma/migrations ajoutés ; ne pas écraser les règles de l’application. `doctor` refuse désormais un pont hôte incomplet. Valider une app générée et l’app existante, dont les comportements et les droits doivent être conservés.

Cette restauration n’est pas une certification de parité complète : administration Database, contrat de stockage relationnel, recherche enrichie et exécution durable du mail demandent leurs lots propres.
