# Lite

Un socle autonome pour créer des logiciels métier directement dans GPT Sites, avec un backend Cloudflare Workers, une base D1 et des fichiers R2.

Décrivez votre application à ChatGPT et fournissez ce dépôt. [START-HERE.md](START-HERE.md) guide la création d’une application indépendante, jusqu’à sa publication.

- Interface à onglets, navigation configurable, formulaires, tableaux, tâches, support, documents, équipe et espaces.
- Déclaration unique des modules : navigation, recherche plein texte, API et outils MCP sont disponibles automatiquement.
- Administration de la recherche par module et par champ. Les fiches existantes sont reprises par une indexation progressive ; les écritures suivantes mettent l’index à jour dans la même transaction.
- API et serveur MCP HTTP avec clés personnelles, expiration, révocation et choix lecture/écriture. WebMCP utilise la session de l’application.
- Permissions serveur, séparation des espaces, contrôle des versions, journal et fichiers privés.

Les composants du socle sont livrés en source dans `runtime/`. Ils évoluent dans ce dépôt. Aucun serveur desktop, service d’automatisation ou moteur de recherche externe n’est requis.

## Commencer

```bash
pnpm --dir template install --frozen-lockfile
node bin/lite.mjs create --spec examples/services.json --out /chemin/mon-app
node bin/lite.mjs doctor --app /chemin/mon-app
```

Ouvrir ensuite le projet avec Sites et suivre son `AGENTS.md`. Ne pas publier le template lui-même comme nouvelle application.

## Documentation

- [Modules](docs/MODULES.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Recherche](docs/SEARCH.md)
- [API et MCP](docs/API.md)
- [Mises à jour](docs/UPDATES.md)
- [Maintenance et notifications](docs/MAINTENANCE.md)
- [Validation](docs/VALIDATION.md)

La recherche textuelle est insensible à la casse et aux accents et accepte les préfixes. Elle n’effectue pas de correction orthographique ni d’OCR. Pour les pièces jointes, elle couvre les noms et métadonnées, pas leur contenu binaire. Une connexion ChatGPT à un serveur MCP distant dépend aussi des modes d’authentification pris en charge par le client ; aucun connecteur n’est automatiquement installé.

Les vérifications effectuées et leurs limites sont décrites dans [VALIDATION.md](docs/VALIDATION.md).
