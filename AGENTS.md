# Creezio Lite — instructions de travail

## Avant de commencer

- Nouvelle application : lire `START-HERE.md`, puis utiliser le générateur. Le kit n'est pas un Site à déployer tel quel.
- Maintenance du kit : modifier `packages/core/src`, `packages/ui/src`, `template`, la CLI et les docs concernées. `template/creezio` est une copie générée et gitignorée ; la reconstruire avec `npm run sync:template`.
- Les fonctions métier spécifiques restent dans l'application générée. Aucun identifiant de client, Site, serveur ni secret dans le kit.
- Le workflow de publication relève de la compétence Sites installée dans la conversation. Aucun script du kit ne remplace les contrôles de cette plateforme.

## Contrats du socle

- Runtime serveur : Cloudflare Worker, D1 asynchrone, R2. Aucun `node:sqlite`, `better-sqlite3`, `child_process`, Docker, Electron, Hermes, n8n ni Meilisearch local dans le bundle runtime.
- L'identité provient du dispatcher Sites via `getChatGPTUser`. Ne jamais authentifier un utilisateur à partir d'un identifiant envoyé par le client.
- Toute lecture/écriture de donnée métier exige une appartenance à l'espace, vérifiée côté serveur. Toutes les requêtes sont paramétrées et filtrées par `org_id`.
- Les mutations du navigateur vérifient l'origine ; ne pas enlever le contrôle pour faciliter un test.
- Les modules déclaratifs valident leur définition et toutes les écritures. Les mises à jour exigent une version. Les changements et leur journal partagent une transaction D1.
- D1 est la source de vérité des données ; R2 stocke les fichiers. Aucun remplacement silencieux par localStorage ou une liste en mémoire.
- La recherche Lite est explicitement `d1-contains`, indépendante du moteur Meilisearch du Creezio d'origine.
- Ne pas modifier les migrations déjà appliquées ; ajouter des migrations. Aucun seed ou backfill volumineux dans les migrations.
- D1/R2 n'ont pas de transaction commune : préserver les compensations et les téléchargements privés.

## Vérification avant diffusion

1. `npm run sync:template`.
2. Installer les dépendances du template en conservant `pnpm-lock.yaml`. Dans ChatGPT, utiliser le workflow Sites pour le projet existant.
3. `npm test` : les tests Miniflare nécessitent les dépendances du template. Ne pas les convertir en tests ignorés pour rendre le résultat vert.
4. Typecheck et build du template, puis générer et construire les deux briefs de `examples/`.
5. `npm run check` contrôle les sources, les instructions et l'absence d'identifiant de Site dans le template.
6. Toute modification des sources distribuées exige une nouvelle version après la publication initiale. Maintenir `CHANGELOG.md`, `UPSTREAM.json` et `docs/VALIDATION.md`.

Les changements génériques se font dans le kit, puis se propagent aux applications avec contrôle d'intégrité. Ne pas affaiblir les tests d'isolation pour contourner une régression.
