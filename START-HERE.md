# Créer une application avec Lite

L’objectif est une application indépendante hébergée dans GPT Sites. Le dépôt est le kit, pas le répertoire de toutes les applications.

1. Lire le besoin métier. Produire un brief JSON avec `id`, `name`, `description` et `modules`, sur le modèle de `examples/services.json` ou `examples/catalogue.json`.
2. Préserver le design du socle. Les composants existants possèdent la navigation, les onglets, la recherche, les tableaux et les modales.
3. Installer les dépendances figées du template avec pnpm. Utiliser les compétences Sites disponibles pour la configuration d’exécution et les installations en environnement géré.
4. Exécuter `node bin/lite.mjs create --spec /chemin/brief.json --out /chemin/application-vide` depuis ce dépôt. Le dossier cible doit être vide.
5. Suivre le `AGENTS.md` de l’application. Son `.openai/hosting.json` contient les bindings D1/R2 et aucun `project_id` transmis depuis le kit. Réutiliser un identifiant uniquement lorsqu’on modifie cette même application.
6. Avant le métier, valider la première publication du socle et sa persistance selon [la procédure Sites](template/SITES-PUBLISHING.md). Ajouter le métier dans les déclarations de modules et les règles métier. Ne pas recopier manuellement les listes de navigation, recherche ou outils.
7. Exécuter le doctor, les tests des règles métier, le typecheck et le build. Vérifier les parcours de création, modification, recherche et refus d’accès.
8. Enregistrer et publier avec Sites, vérifier le résultat final et remettre l’URL déployée.

## Ajouter un module

Déclarer les champs dans un fichier JSON, puis lancer :

```bash
node bin/lite.mjs module --app /chemin/application --spec /chemin/module.json
```

Cette commande ajoute le schéma canonique du module et régénère son instantané `brand.json`. Elle génère sa table relationnelle D1, son schéma Drizzle et sa migration. La prochaine compilation branche navigation, formulaire/tableau, API CRUD, recherche et outils MCP. Voir [docs/MODULES.md](docs/MODULES.md) pour les limites et les règles métier avancées.

## Mise à jour d’une application existante

Lire [docs/UPDATES.md](docs/UPDATES.md). Ne jamais réinitialiser une application ni écraser ses migrations, son brief ou son identité Sites. Le numéro de version et les empreintes du runtime sont dans `lite.lock.json`.

## Orchestrer le développement

Le générateur installe dans chaque application la compétence `.cursor/skills/lite-orchestration/` (source canonique du kit) et la règle `.cursor/rules/lite-orchestration.mdc` : Astra orchestre et décide, Cursor réalise avec une sélection de modèle choisie une fois à l’attribution (Fable 5.1 par défaut) et vérifiée par préflight. Pour une application existante, depuis le checkout du kit : `node bin/lite.mjs adopt --app /chemin/application` (inspection), puis `--apply` ; un conflit local ou un lien symbolique sur un chemin géré est refusé et signalé, les règles métier et `AGENTS.md` ne sont pas modifiés.

## Abonner l’application aux correctifs

Publier son code dans son propre dépôt GitHub et activer Actions et Issues. Le template embarque la veille `.github/workflows/lite-update.yml` et son script : les nouvelles releases du kit créent une demande de mise à jour dans le dépôt applicatif. Le pilote traite cette demande par une branche testée, puis vérifie le Site existant. Lire [la procédure de maintenance](docs/MAINTENANCE.md).
