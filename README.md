# Creezio Lite

Un socle réutilisable pour créer des applications métier dans **ChatGPT Sites** : backend, données persistantes, fichiers, interface et génération d'applications depuis un brief.

**Démarrer dans ChatGPT :** copiez ce message dans une conversation disposant de Sites et de l'accès GitHub :

> Je veux créer une app à partir de Creezio Lite : https://github.com/creezio/creezio-lite. Lis d'abord AGENTS.md et START-HERE.md. Mon application doit permettre de [objectif, utilisateurs et fonctions]. Utilise le générateur du dépôt, développe les fonctions demandées, puis publie mon application dans GPT Sites. Crée un projet indépendant du kit et conserve ses données entre les visites.

Le lien du dépôt est nécessaire dans une nouvelle conversation. Le nom seul n'installe pas un plugin et ne donne pas automatiquement accès au code. ChatGPT doit disposer des capacités de lecture/exécution du projet et de publication Sites ; sinon il doit préciser la capacité manquante.

## Inclus dans la version 0.1.0

- Générateur déterministe depuis un brief JSON, sans token npm et sans serveur Creezio à configurer.
- Interface Creezio : palette or/encre, sidebar, onglets, recherche, formulaires, listes, documents, équipe et journal.
- Backend Worker, D1 pour les données et R2 pour les fichiers. Toutes les écritures sont persistantes.
- Connexion **Sign in with ChatGPT**. Espaces indépendants, rôles propriétaire/administrateur/collaborateur/lecture seule, invitations liées à une adresse e-mail.
- Modules déclaratifs : texte, texte long, e-mail, nombre, date, sélection et booléen ; validation côté serveur, pagination, filtres et recherche textuelle.
- Éditions avec contrôle de version, archivage et journal transactionnel des changements.
- Fichiers privés à l'espace, téléchargement forcé, limite de 10 Mo par fichier.
- Points d'extension pour règles métier et routes spécialisées.
- Outils WebMCP lorsque le navigateur les prend en charge ; les autorisations restent vérifiées par le backend.
- Verrouillage de la version du socle, vérification d'intégrité et mise à niveau sans écraser les modifications métier.

Il s'agit d'un **dérivé ciblé** de Creezio, pas d'un port intégral de ses services desktop. La provenance des fichiers repris est dans [UPSTREAM.json](UPSTREAM.json). L'architecture garde une API HTTP et la séparation kit/métier ; ses contrats, son stockage et son runtime sont propres à Lite. Voir la [matrice de compatibilité](docs/COMPATIBILITY.md).

## Génération locale

Node.js 24 ou plus récent est requis pour la CLI et les tests du kit. Aucune installation n'est nécessaire pour générer le projet.

```bash
git clone https://github.com/creezio/creezio-lite.git
cd creezio-lite
node bin/creezio-lite.mjs create --spec examples/services.json --out ../mon-app
node bin/creezio-lite.mjs doctor --app ../mon-app
```

Dans ChatGPT, suivre ensuite le workflow **Sites** installé : configuration de l'environnement, installation selon le lockfile fourni, build, enregistrement du Site et publication. L'application générée contient toutes ses sources ; elle ne dépend pas de chemins de cette machine. Aucun identifiant Sites n'est hérité du kit.

En développement hors ChatGPT, utiliser le gestionnaire indiqué par `packageManager` dans l'application (`pnpm`), puis `pnpm install --frozen-lockfile`. Voir [le guide de développement](docs/DEVELOPMENT.md) pour les migrations D1 locales et les tests.

## Organisation

| Chemin | Rôle |
|---|---|
| `START-HERE.md`, `AGENTS.md` | Entrée pour une nouvelle conversation ChatGPT |
| `bin/creezio-lite.mjs` | Création, doctor et upgrade |
| `packages/core/src` | Backend indépendant du framework et validation |
| `packages/ui/src` | Interface réutilisable et fichiers adaptés depuis Creezio |
| `template` | Application Vinext/React compatible Sites, schéma et migration D1 |
| `examples` | Deux briefs produit différents et exécutables |
| `tests` | Isolation, permissions, stockage, D1/R2, génération et mises à jour |
| `docs` | Contrats API, extensions, sécurité et publication |

Chaque application générée possède sa configuration `brand.json`, son code métier, son projet Sites et son stockage. Les applications ne partagent ni identifiants de déploiement, ni utilisateurs internes, ni données.

## Maintenance

Le socle livré dans chaque application est un **snapshot versionné et vérifié par SHA-256**. Il n'y a pas de publication npm de Creezio Lite dans cette livraison. Les dépendances tierces sont verrouillées par `pnpm-lock.yaml`.

```bash
node bin/creezio-lite.mjs upgrade --app ../mon-app
node bin/creezio-lite.mjs upgrade --app ../mon-app --apply
```

La première commande inspecte ; la seconde applique une mise à jour compatible et conserve une sauvegarde. Les différences locales dans le socle bloquent l'écrasement. Une évolution du schéma commun exige une migration explicite. Toute mise à jour doit être suivie de tests, d'un build et d'une nouvelle publication de l'application. [Procédure complète](docs/UPDATES.md).

Les fichiers repris de Creezio conservent le statut de licence du projet d'origine (`UNLICENSED`). Les composants tiers conservent leurs licences incluses. La mise à disposition du dépôt ne transforme pas Creezio en projet sous licence MIT.
